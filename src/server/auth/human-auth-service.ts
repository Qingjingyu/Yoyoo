import { createHmac, randomBytes } from "node:crypto";

import {
  normalizeLoginHandle,
  verifyPassword,
} from "@/server/auth/password";
import { hashOpaqueToken, issueSessionToken } from "@/server/auth/session-token";
import type {
  HumanCredentialRecord,
  HumanSessionRecord,
  LoginThrottleRecord,
} from "@/server/postgres/human-auth-repository";

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
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
  resolveSession(tokenHash: Buffer, now?: Date): Promise<HumanSessionRecord | null>;
  revokeSession(tokenHash: Buffer, now?: Date): Promise<boolean>;
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

function throttleHash(pepper: Buffer, type: "account" | "source", value: string): Buffer {
  return createHmac("sha256", pepper).update(`${type}:${value}`, "utf8").digest();
}

function isLocked(record: LoginThrottleRecord | null, now: Date): boolean {
  return Boolean(record?.lockedUntil && record.lockedUntil.getTime() > now.getTime());
}

export class HumanAuthService {
  private readonly pepper: Buffer;
  private readonly sessionTtlMs: number;

  constructor(
    private readonly store: HumanAuthStore,
    options: { pepper: Buffer; sessionTtlMs?: number },
  ) {
    if (options.pepper.length < 32) {
      throw new Error("Human authentication pepper must be at least 256 bits");
    }
    this.pepper = options.pepper;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  }

  async login(input: {
    loginHandle: string;
    password: string;
    source: string;
    now?: Date;
  }): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
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

    if (!credential || !passwordMatches) {
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

  resolveSession(token: string, now = new Date()): Promise<HumanSessionRecord | null> {
    return this.store.resolveSession(hashOpaqueToken(token), now);
  }

  logout(token: string, now = new Date()): Promise<boolean> {
    return this.store.revokeSession(hashOpaqueToken(token), now);
  }
}

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
