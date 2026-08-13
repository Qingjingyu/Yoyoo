import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { hashPassword } from "@/server/auth/password";
import {
  FederatedAuthorizationRejectedError,
  FederatedAuthorizationUnavailableError,
  HumanAuthenticationError,
  HumanAuthService,
  type AICardSessionAuthority,
  type FederatedAuthorizationMaterial,
  isHumanAuthenticationError,
  type HumanAuthStore,
} from "@/server/auth/human-auth-service";
import { hashOpaqueToken } from "@/server/auth/session-token";

function createStore(overrides: Partial<HumanAuthStore> = {}): HumanAuthStore {
  return {
    findCredential: vi.fn().mockResolvedValue(null),
    createSession: vi.fn().mockResolvedValue({
      sessionId: "session-id",
      expiresAt: new Date("2026-09-11T00:00:00.000Z"),
    }),
    createFederatedSession: vi.fn().mockResolvedValue({
      sessionId: "federated-session-id",
      expiresAt: new Date("2026-09-11T00:00:00.000Z"),
    }),
    resolveSession: vi.fn().mockResolvedValue(null),
    revokeSession: vi.fn().mockResolvedValue(true),
    updateFederatedSessionAuthorization: vi.fn().mockResolvedValue(true),
    revokeSessionById: vi.fn().mockResolvedValue(true),
    getThrottle: vi.fn().mockResolvedValue(null),
    recordLoginFailure: vi.fn().mockResolvedValue({
      failureCount: 1,
      windowStartedAt: new Date("2026-08-12T00:00:00.000Z"),
      lockedUntil: null,
    }),
    clearThrottle: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const protectedRefresh: FederatedAuthorizationMaterial = {
  ciphertext: Buffer.alloc(48, 1),
  iv: Buffer.alloc(12, 2),
  tag: Buffer.alloc(16, 3),
  refreshExpiresAt: new Date("2026-09-11T00:00:00.000Z"),
};

function createAuthority(
  overrides: Partial<AICardSessionAuthority> = {},
): AICardSessionAuthority {
  return {
    protectRefreshToken: vi.fn().mockReturnValue(protectedRefresh),
    refreshAuthorization: vi.fn().mockResolvedValue({
      ...protectedRefresh,
      ciphertext: Buffer.alloc(48, 4),
    }),
    ...overrides,
  };
}

function createFederatedSession(
  overrides: Record<string, unknown> = {},
) {
  return {
    sessionId: "federated-session-id",
    principalId: "principal-id",
    aiCardId: "AI_100001",
    loginHandle: "subai",
    displayName: "苏白",
    authMethod: "aicard" as const,
    expiresAt: new Date("2026-09-11T00:00:00.000Z"),
    federatedAuthorization: {
      issuer: "https://id.yoyooai.test",
      clientId: "yoyoo_dev",
      subject: `sub_${"A".repeat(43)}`,
      authorizationStateHash: Buffer.alloc(32, 7),
      material: protectedRefresh,
      lastValidatedAt: new Date("2026-08-12T00:00:00.000Z"),
    },
    ...overrides,
  };
}

describe("human authentication service", () => {
  const now = new Date("2026-08-12T00:00:00.000Z");
  const pepper = randomBytes(32);

  it("recognizes authentication errors across bundled module boundaries", () => {
    expect(isHumanAuthenticationError({
      name: "HumanAuthenticationError",
      code: "INVALID_CREDENTIALS",
      status: 401,
      message: "账号或密码不正确。",
    })).toBe(true);
    expect(isHumanAuthenticationError({
      name: "HumanAuthenticationError",
      code: "UNEXPECTED",
      status: 500,
      message: "no",
    })).toBe(false);
  });

  it("creates a revocable opaque session after valid credentials", async () => {
    const password = "A-secure-password-2026";
    const hashed = await hashPassword(password);
    const store = createStore({
      findCredential: vi.fn().mockResolvedValue({
        principalId: "principal-id",
        loginHandle: "subai",
        passwordHash: hashed.hash,
        passwordSalt: hashed.salt,
        passwordAlgorithm: hashed.algorithm,
        recoveryCodeHash: null,
        recoveryCodeUsedAt: null,
        credentialVersion: 1,
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
    });
    const service = new HumanAuthService(store, { pepper });

    const session = await service.login({
      loginHandle: "@SuBai",
      password,
      source: "203.0.113.7",
      now,
    });

    expect(session.token).toMatch(/^yys_/);
    expect(store.createSession).toHaveBeenCalledWith({
      principalId: "principal-id",
      tokenHash: hashOpaqueToken(session.token),
      expiresAt: new Date("2026-09-11T00:00:00.000Z"),
      now,
    });
    expect(store.clearThrottle).toHaveBeenCalledTimes(2);
  });

  it("creates an opaque session from a verified AI Card identity", async () => {
    const store = createStore();
    const authority = createAuthority();
    const service = new HumanAuthService(store, { aicardAuthority: authority });

    const session = await service.loginWithAICard({
      principalId: "principal-id",
      issuer: "https://id.yoyooai.test",
      clientId: "yoyoo_dev",
      subject: `sub_${"A".repeat(43)}`,
      authorizationStateHash: Buffer.alloc(32, 7),
      refreshToken: `rt_${"R".repeat(43)}`,
      refreshExpiresIn: 2_592_000,
      now,
    });

    expect(session.token).toMatch(/^yys_/);
    expect(store.createFederatedSession).toHaveBeenCalledWith({
      principalId: "principal-id",
      issuer: "https://id.yoyooai.test",
      clientId: "yoyoo_dev",
      subject: `sub_${"A".repeat(43)}`,
      authorizationStateHash: Buffer.alloc(32, 7),
      federatedAuthorization: protectedRefresh,
      tokenHash: hashOpaqueToken(session.token),
      expiresAt: new Date("2026-09-11T00:00:00.000Z"),
      now,
    });
    expect(authority.protectRefreshToken).toHaveBeenCalledWith({
      refreshToken: `rt_${"R".repeat(43)}`,
      authorizationStateHash: Buffer.alloc(32, 7),
      refreshExpiresAt: new Date("2026-09-11T00:00:00.000Z"),
    });
    expect(store.findCredential).not.toHaveBeenCalled();
  });

  it("rotates an AI Card refresh grant after the validation interval", async () => {
    const session = createFederatedSession();
    const store = createStore({
      resolveSession: vi.fn().mockResolvedValue(session),
    });
    const authority = createAuthority();
    const service = new HumanAuthService(store, { aicardAuthority: authority });
    const validationTime = new Date("2026-08-12T00:06:00.000Z");

    await expect(service.resolveSession("yys_token", validationTime))
      .resolves.toMatchObject({ principalId: "principal-id" });

    expect(authority.refreshAuthorization).toHaveBeenCalledWith({
      issuer: "https://id.yoyooai.test",
      clientId: "yoyoo_dev",
      subject: `sub_${"A".repeat(43)}`,
      authorizationStateHash: Buffer.alloc(32, 7),
      material: protectedRefresh,
      now: validationTime,
    });
    expect(store.updateFederatedSessionAuthorization).toHaveBeenCalledWith({
      sessionId: "federated-session-id",
      federatedAuthorization: {
        ...protectedRefresh,
        ciphertext: Buffer.alloc(48, 4),
      },
      validatedAt: validationTime,
    });
  });

  it("revokes the local session when AI Card rejects the refresh grant", async () => {
    const store = createStore({
      resolveSession: vi.fn().mockResolvedValue(createFederatedSession()),
    });
    const authority = createAuthority({
      refreshAuthorization: vi.fn().mockRejectedValue(
        new FederatedAuthorizationRejectedError(),
      ),
    });
    const service = new HumanAuthService(store, { aicardAuthority: authority });
    const validationTime = new Date("2026-08-12T00:06:00.000Z");

    await expect(service.resolveSession("yys_token", validationTime))
      .resolves.toBeNull();
    expect(store.revokeSessionById).toHaveBeenCalledWith(
      "federated-session-id",
      validationTime,
    );
  });

  it("allows a short provider outage but denies access after the grace window", async () => {
    const unavailable = createAuthority({
      refreshAuthorization: vi.fn().mockRejectedValue(
        new FederatedAuthorizationUnavailableError(),
      ),
    });
    const store = createStore({
      resolveSession: vi.fn().mockResolvedValue(createFederatedSession()),
    });
    const service = new HumanAuthService(store, { aicardAuthority: unavailable });

    await expect(service.resolveSession(
      "yys_token",
      new Date("2026-08-12T00:10:00.000Z"),
    )).resolves.toMatchObject({ principalId: "principal-id" });
    await expect(service.resolveSession(
      "yys_token",
      new Date("2026-08-12T00:16:00.000Z"),
    )).resolves.toBeNull();
    expect(store.revokeSessionById).not.toHaveBeenCalled();
  });

  it("refuses a valid credential outside the configured single-owner account", async () => {
    const password = "A-secure-password-2026";
    const hashed = await hashPassword(password);
    const store = createStore({
      findCredential: vi.fn().mockResolvedValue({
        principalId: "another-human",
        loginHandle: "ai_100002",
        passwordHash: hashed.hash,
        passwordSalt: hashed.salt,
        passwordAlgorithm: hashed.algorithm,
        recoveryCodeHash: null,
        recoveryCodeUsedAt: null,
        credentialVersion: 1,
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
    });
    const service = new HumanAuthService(store, {
      pepper,
      allowedLoginHandle: "ai_100001",
    });

    await expect(service.login({
      loginHandle: "AI_100002",
      password,
      source: "203.0.113.7",
      now,
    })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", status: 401 });
    expect(store.createSession).not.toHaveBeenCalled();
  });

  it("uses the same public failure for an unknown account and a wrong password", async () => {
    const unknownStore = createStore();
    const knownHash = await hashPassword("A-secure-password-2026");
    const wrongStore = createStore({
      findCredential: vi.fn().mockResolvedValue({
        principalId: "principal-id",
        loginHandle: "subai",
        passwordHash: knownHash.hash,
        passwordSalt: knownHash.salt,
        passwordAlgorithm: knownHash.algorithm,
        recoveryCodeHash: null,
        recoveryCodeUsedAt: null,
        credentialVersion: 1,
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
    });

    const errors = await Promise.all([
      new HumanAuthService(unknownStore, { pepper }).login({
        loginHandle: "unknown",
        password: "Wrong-password-2026",
        source: "203.0.113.7",
        now,
      }).catch((error: unknown) => error),
      new HumanAuthService(wrongStore, { pepper }).login({
        loginHandle: "subai",
        password: "Wrong-password-2026",
        source: "203.0.113.7",
        now,
      }).catch((error: unknown) => error),
    ]);

    for (const error of errors) {
      expect(error).toBeInstanceOf(HumanAuthenticationError);
      expect(error).toMatchObject({ code: "INVALID_CREDENTIALS", status: 401 });
    }
    expect(unknownStore.recordLoginFailure).toHaveBeenCalledTimes(2);
    expect(wrongStore.recordLoginFailure).toHaveBeenCalledTimes(2);
  });

  it("rejects a locked account before creating a session", async () => {
    const store = createStore({
      getThrottle: vi.fn().mockResolvedValue({
        failureCount: 5,
        windowStartedAt: now,
        lockedUntil: new Date("2026-08-12T00:15:00.000Z"),
      }),
    });
    const service = new HumanAuthService(store, { pepper });

    await expect(service.login({
      loginHandle: "subai",
      password: "A-secure-password-2026",
      source: "203.0.113.7",
      now,
    })).rejects.toMatchObject({ code: "LOGIN_LOCKED", status: 429 });
    expect(store.createSession).not.toHaveBeenCalled();
  });

  it("resolves and revokes only opaque session tokens", async () => {
    const store = createStore({
      resolveSession: vi.fn().mockResolvedValue({ principalId: "principal-id" }),
    });
    const service = new HumanAuthService(store, { pepper });

    await service.resolveSession("yys_token", now);
    await service.logout("yys_token", now);

    expect(store.resolveSession).toHaveBeenCalledWith(hashOpaqueToken("yys_token"), now);
    expect(store.revokeSession).toHaveBeenCalledWith(hashOpaqueToken("yys_token"), now);
  });
});
