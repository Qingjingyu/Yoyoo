import { createHmac, randomBytes } from "node:crypto";

import {
  normalizeLoginHandle,
  verifyPassword,
} from "@/server/auth/password";
import {
  FederatedAuthorizationRejectedError,
  FederatedAuthorizationUnavailableError,
  type AICardSessionAuthorityPort,
  type FederatedAuthorizationMaterial,
} from "@/server/auth/aicard-session-authority";
import { hashOpaqueToken, issueSessionToken } from "@/server/auth/session-token";
import type {
  HumanCredentialRecord,
  HumanSessionRecord,
  LoginThrottleRecord,
} from "@/server/postgres/human-auth-repository";

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const FEDERATED_VALIDATION_INTERVAL_MS = 5 * 60 * 1_000;
const FEDERATED_VALIDATION_GRACE_MS = 15 * 60 * 1_000;
const DUMMY_SALT = Buffer.alloc(16, 71);
const DUMMY_HASH = Buffer.alloc(64, 113);

export interface HumanAuthStore {
  findCredential(loginHandle: string): Promise<HumanCredentialRecord | null>;
  createSession(input: {
    principalId: string;
    tokenHash: Buffer;
    expiresAt: Date;
    now?: Date;
  }): Promise<{ sessionId: string; expiresAt: Date }>;
  createFederatedSession(input: {
    principalId: string;
    issuer: string;
    clientId: string;
    subject: string;
    authorizationStateHash: Buffer;
    federatedAuthorization: FederatedAuthorizationMaterial;
    tokenHash: Buffer;
    expiresAt: Date;
    now?: Date;
  }): Promise<{ sessionId: string; expiresAt: Date }>;
  resolveSession(tokenHash: Buffer, now?: Date): Promise<HumanSessionRecord | null>;
  revokeSession(tokenHash: Buffer, now?: Date): Promise<boolean>;
  updateFederatedSessionAuthorization(input: {
    sessionId: string;
    federatedAuthorization: FederatedAuthorizationMaterial;
    validatedAt: Date;
  }): Promise<boolean>;
  revokeSessionById(sessionId: string, now?: Date): Promise<boolean>;
  getThrottle(scopeHash: Buffer): Promise<LoginThrottleRecord | null>;
  recordLoginFailure(scopeHash: Buffer, now?: Date): Promise<LoginThrottleRecord>;
  clearThrottle(scopeHash: Buffer): Promise<void>;
}

export class HumanAuthenticationError extends Error {
  constructor(
    public readonly code: "INVALID_CREDENTIALS" | "LOGIN_LOCKED",
    public readonly status: 401 | 429,
    message: string,
  ) {
    super(message);
    this.name = "HumanAuthenticationError";
  }
}

export function isHumanAuthenticationError(
  error: unknown,
): error is HumanAuthenticationError {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<HumanAuthenticationError>;
  return candidate.name === "HumanAuthenticationError"
    && (candidate.code === "INVALID_CREDENTIALS" || candidate.code === "LOGIN_LOCKED")
    && (candidate.status === 401 || candidate.status === 429)
    && typeof candidate.message === "string";
}

function throttleHash(pepper: Buffer, type: "account" | "source", value: string): Buffer {
  return createHmac("sha256", pepper).update(`${type}:${value}`, "utf8").digest();
}

function isLocked(record: LoginThrottleRecord | null, now: Date): boolean {
  return Boolean(record?.lockedUntil && record.lockedUntil.getTime() > now.getTime());
}

export class HumanAuthService {
  private readonly pepper: Buffer | null;
  private readonly sessionTtlMs: number;
  private readonly allowedLoginHandle: string | null;
  private readonly aicardAuthority: AICardSessionAuthorityPort | null;

  constructor(
    private readonly store: HumanAuthStore,
    options: {
      pepper?: Buffer;
      sessionTtlMs?: number;
      allowedLoginHandle?: string;
      aicardAuthority?: AICardSessionAuthorityPort;
    },
  ) {
    if (options.pepper && options.pepper.length < 32) {
      throw new Error("Human authentication pepper must be at least 256 bits");
    }
    this.pepper = options.pepper ?? null;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.allowedLoginHandle = options.allowedLoginHandle
      ? normalizeLoginHandle(options.allowedLoginHandle)
      : null;
    this.aicardAuthority = options.aicardAuthority ?? null;
  }

  async login(input: {
    loginHandle: string;
    password: string;
    source: string;
    now?: Date;
  }): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
    if (!this.pepper) {
      throw new Error("Password login requires a configured authentication pepper");
    }
    const now = input.now ?? new Date();
    let normalizedHandle: string;
    try {
      normalizedHandle = normalizeLoginHandle(input.loginHandle);
    } catch {
      normalizedHandle = "invalid-handle";
    }
    const accountScope = throttleHash(this.pepper, "account", normalizedHandle);
    const sourceScope = throttleHash(this.pepper, "source", input.source);
    const throttles = await Promise.all([
      this.store.getThrottle(accountScope),
      this.store.getThrottle(sourceScope),
    ]);
    if (throttles.some((record) => isLocked(record, now))) {
      throw new HumanAuthenticationError(
        "LOGIN_LOCKED",
        429,
        "登录尝试过多，请稍后再试。",
      );
    }

    const credential = await this.store.findCredential(normalizedHandle);
    const passwordMatches = await verifyPassword(input.password, credential
      ? {
          algorithm: credential.passwordAlgorithm,
          hash: credential.passwordHash,
          salt: credential.passwordSalt,
        }
      : {
          algorithm: "scrypt-v1",
          hash: DUMMY_HASH,
          salt: DUMMY_SALT,
        });

    if (
      !credential
      || !passwordMatches
      || (this.allowedLoginHandle && normalizedHandle !== this.allowedLoginHandle)
    ) {
      await Promise.all([
        this.store.recordLoginFailure(accountScope, now),
        this.store.recordLoginFailure(sourceScope, now),
      ]);
      throw new HumanAuthenticationError(
        "INVALID_CREDENTIALS",
        401,
        "账号或密码不正确。",
      );
    }

    const token = issueSessionToken();
    const expiresAt = new Date(now.getTime() + this.sessionTtlMs);
    const session = await this.store.createSession({
      principalId: credential.principalId,
      tokenHash: hashOpaqueToken(token),
      expiresAt,
      now,
    });
    await Promise.all([
      this.store.clearThrottle(accountScope),
      this.store.clearThrottle(sourceScope),
    ]);
    return { token, sessionId: session.sessionId, expiresAt: session.expiresAt };
  }

  async loginWithAICard(input: {
    principalId: string;
    issuer: string;
    clientId: string;
    subject: string;
    authorizationStateHash: Buffer;
    refreshToken: string;
    refreshExpiresIn: number;
    now?: Date;
  }): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
    if (!this.aicardAuthority) {
      throw new Error("AI Card login requires a configured session authority");
    }
    const now = input.now ?? new Date();
    const token = issueSessionToken();
    const refreshExpiresAt = new Date(
      now.getTime() + input.refreshExpiresIn * 1_000,
    );
    const expiresAt = new Date(Math.min(
      now.getTime() + this.sessionTtlMs,
      refreshExpiresAt.getTime(),
    ));
    const federatedAuthorization = this.aicardAuthority.protectRefreshToken({
      refreshToken: input.refreshToken,
      authorizationStateHash: input.authorizationStateHash,
      refreshExpiresAt,
    });
    const session = await this.store.createFederatedSession({
      principalId: input.principalId,
      issuer: input.issuer,
      clientId: input.clientId,
      subject: input.subject,
      authorizationStateHash: input.authorizationStateHash,
      federatedAuthorization,
      tokenHash: hashOpaqueToken(token),
      expiresAt,
      now,
    });
    return { token, sessionId: session.sessionId, expiresAt: session.expiresAt };
  }

  async resolveSession(token: string, now = new Date()): Promise<HumanSessionRecord | null> {
    const session = await this.store.resolveSession(hashOpaqueToken(token), now);
    if (!session || session.authMethod !== "aicard") return session;
    const authorization = session.federatedAuthorization;
    if (!authorization || !this.aicardAuthority) return null;
    const validationAge = now.getTime() - authorization.lastValidatedAt.getTime();
    if (validationAge < FEDERATED_VALIDATION_INTERVAL_MS) return session;

    try {
      const rotated = await this.aicardAuthority.refreshAuthorization({
        issuer: authorization.issuer,
        clientId: authorization.clientId,
        subject: authorization.subject,
        authorizationStateHash: authorization.authorizationStateHash,
        material: authorization.material,
        now,
      });
      const updated = await this.store.updateFederatedSessionAuthorization({
        sessionId: session.sessionId,
        federatedAuthorization: rotated,
        validatedAt: now,
      });
      return updated ? session : null;
    } catch (error) {
      if (error instanceof FederatedAuthorizationRejectedError) {
        await this.store.revokeSessionById(session.sessionId, now);
        return null;
      }
      if (error instanceof FederatedAuthorizationUnavailableError) {
        return validationAge <= FEDERATED_VALIDATION_GRACE_MS ? session : null;
      }
      throw error;
    }
  }

  async getFederatedAccessToken(
    session: HumanSessionRecord,
    now = new Date(),
  ): Promise<string> {
    const authorization = session.federatedAuthorization;
    if (session.authMethod !== "aicard" || !authorization || !this.aicardAuthority) {
      throw new FederatedAuthorizationRejectedError("AI Card 登录授权不可用");
    }
    const rotated = await this.aicardAuthority.refreshAuthorizationForOperation({
      issuer: authorization.issuer,
      clientId: authorization.clientId,
      subject: authorization.subject,
      authorizationStateHash: authorization.authorizationStateHash,
      material: authorization.material,
      now,
    });
    const updated = await this.store.updateFederatedSessionAuthorization({
      sessionId: session.sessionId,
      federatedAuthorization: rotated.material,
      validatedAt: now,
    });
    if (!updated) throw new FederatedAuthorizationRejectedError("登录会话已经失效");
    return rotated.accessToken;
  }

  logout(token: string, now = new Date()): Promise<boolean> {
    return this.store.revokeSession(hashOpaqueToken(token), now);
  }
}

export {
  FederatedAuthorizationRejectedError,
  FederatedAuthorizationUnavailableError,
};
export type {
  AICardSessionAuthorityPort as AICardSessionAuthority,
  FederatedAuthorizationMaterial,
};

export function createAuthenticationPepper(value: string): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length < 32) {
    throw new Error("YOYOO_AUTH_PEPPER must contain at least 32 random bytes");
  }
  return decoded;
}

export function generateAuthenticationPepper(): string {
  return randomBytes(32).toString("base64url");
}
