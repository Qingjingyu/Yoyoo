import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { hashPassword } from "@/server/auth/password";
import {
  HumanAuthenticationError,
  HumanAuthService,
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
    resolveSession: vi.fn().mockResolvedValue(null),
    revokeSession: vi.fn().mockResolvedValue(true),
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

describe("human authentication service", () => {
  const now = new Date("2026-08-12T00:00:00.000Z");
  const pepper = randomBytes(32);

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
