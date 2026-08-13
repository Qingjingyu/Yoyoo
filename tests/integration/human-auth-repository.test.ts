/** @vitest-environment node */

import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashOpaqueToken } from "@/server/auth/session-token";
import { createPostgresPool } from "@/server/postgres/client";
import {
  HumanAuthConflictError,
  HumanAuthRepository,
} from "@/server/postgres/human-auth-repository";

const databaseUrl =
  process.env.TEST_DATABASE_URL
  ?? "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";

describe("human authentication repository", () => {
  const pool = createPostgresPool(databaseUrl, { max: 4 });
  const repository = new HumanAuthRepository(pool);
  let humanId: string;

  beforeAll(async () => {
    humanId = randomUUID();
    await pool.query(
      `INSERT INTO principals
        (id, kind, external_key, handle, display_name, ai_card_id)
       VALUES ($1, 'human', $2, 'auth-owner', 'Auth owner', 'AI_990001')`,
      [humanId, `human:auth-test:${humanId}`],
    );
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM login_throttles`);
    await pool.query(`DELETE FROM human_sessions WHERE principal_id = $1`, [humanId]);
    await pool.query(`DELETE FROM human_credentials WHERE principal_id = $1`, [humanId]);
    await pool.query(
      `DELETE FROM aicard_identity_mappings WHERE principal_id = $1`,
      [humanId],
    );
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM aicard_identity_mappings WHERE principal_id = $1`,
      [humanId],
    );
    await pool.query(`DELETE FROM principals WHERE id = $1`, [humanId]);
    await pool.end();
  });

  it("provisions a human once and resolves the normalized handle", async () => {
    const passwordHash = randomBytes(64);
    const passwordSalt = randomBytes(16);
    const recoveryHash = randomBytes(32);
    const credential = await repository.provisionCredential({
      principalId: humanId,
      loginHandle: "subai",
      passwordHash,
      passwordSalt,
      passwordAlgorithm: "scrypt-v1",
      recoveryCodeHash: recoveryHash,
    });

    expect(credential).toMatchObject({
      principalId: humanId,
      loginHandle: "subai",
      passwordAlgorithm: "scrypt-v1",
      credentialVersion: 1,
      status: "active",
    });
    await expect(repository.findCredential("SuBai")).resolves.toMatchObject({
      principalId: humanId,
      loginHandle: "subai",
      passwordHash,
      passwordSalt,
    });
    await expect(repository.provisionCredential({
      principalId: humanId,
      loginHandle: "another",
      passwordHash,
      passwordSalt,
      passwordAlgorithm: "scrypt-v1",
      recoveryCodeHash: recoveryHash,
    })).rejects.toBeInstanceOf(HumanAuthConflictError);
  });

  it("refuses to bind credentials to an Agent principal", async () => {
    const agentId = randomUUID();
    await pool.query(
      `INSERT INTO principals (id, kind, external_key, handle, display_name)
       VALUES ($1, 'agent', $2, 'auth-agent', 'Auth Agent')`,
      [agentId, `agent:auth-test:${agentId}`],
    );
    try {
      await expect(repository.provisionCredential({
        principalId: agentId,
        loginHandle: "agent-login",
        passwordHash: randomBytes(64),
        passwordSalt: randomBytes(16),
        passwordAlgorithm: "scrypt-v1",
        recoveryCodeHash: randomBytes(32),
      })).rejects.toBeInstanceOf(HumanAuthConflictError);
    } finally {
      await pool.query(`DELETE FROM principals WHERE id = $1`, [agentId]);
    }
  });

  it("resolves only active unexpired sessions with the current credential version", async () => {
    await repository.provisionCredential({
      principalId: humanId,
      loginHandle: "subai",
      passwordHash: randomBytes(64),
      passwordSalt: randomBytes(16),
      passwordAlgorithm: "scrypt-v1",
      recoveryCodeHash: randomBytes(32),
    });
    const token = "yys_test-token";
    const session = await repository.createSession({
      principalId: humanId,
      tokenHash: hashOpaqueToken(token),
      expiresAt: new Date("2026-08-13T00:00:00.000Z"),
      now: new Date("2026-08-12T00:00:00.000Z"),
    });

    await expect(
      repository.resolveSession(hashOpaqueToken(token), new Date("2026-08-12T01:00:00.000Z")),
    ).resolves.toMatchObject({
      sessionId: session.sessionId,
      principalId: humanId,
      aiCardId: expect.stringMatching(/^AI_/),
      loginHandle: "subai",
      authMethod: "password",
    });
    await expect(
      repository.resolveSession(hashOpaqueToken(token), new Date("2026-08-14T00:00:00.000Z")),
    ).resolves.toBeNull();

    await repository.revokeSession(hashOpaqueToken(token), new Date("2026-08-12T02:00:00.000Z"));
    await expect(
      repository.resolveSession(hashOpaqueToken(token), new Date("2026-08-12T02:01:00.000Z")),
    ).resolves.toBeNull();
  });

  it("creates an AI Card session without provisioning a Yoyoo password", async () => {
    const subject = `sub_${"F".repeat(43)}`;
    await pool.query(
      `INSERT INTO aicard_identity_mappings
        (issuer, client_id, subject, principal_id, card_id)
       VALUES ('https://id.yoyooai.test', 'yoyoo_dev', $1, $2, 'AI_990001')`,
      [subject, humanId],
    );
    const token = "yys_aicard-session";
    const session = await repository.createFederatedSession({
      principalId: humanId,
      issuer: "https://id.yoyooai.test",
      clientId: "yoyoo_dev",
      subject,
      authorizationStateHash: hashOpaqueToken("authorization-state"),
      federatedAuthorization: {
        ciphertext: randomBytes(48),
        iv: randomBytes(12),
        tag: randomBytes(16),
        refreshExpiresAt: new Date("2026-09-11T00:00:00.000Z"),
      },
      tokenHash: hashOpaqueToken(token),
      expiresAt: new Date("2026-08-13T00:00:00.000Z"),
      now: new Date("2026-08-12T00:00:00.000Z"),
    });

    await expect(
      repository.resolveSession(
        hashOpaqueToken(token),
        new Date("2026-08-12T01:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      sessionId: session.sessionId,
      principalId: humanId,
      aiCardId: "AI_990001",
      loginHandle: "auth-owner",
      authMethod: "aicard",
      federatedAuthorization: expect.objectContaining({
        issuer: "https://id.yoyooai.test",
        clientId: "yoyoo_dev",
        subject,
        lastValidatedAt: new Date("2026-08-12T00:00:00.000Z"),
      }),
    });
    await expect(repository.findCredential("auth-owner")).resolves.toBeNull();

    const rotated = {
      ciphertext: randomBytes(48),
      iv: randomBytes(12),
      tag: randomBytes(16),
      refreshExpiresAt: new Date("2026-09-10T23:55:00.000Z"),
    };
    await expect(repository.updateFederatedSessionAuthorization({
      sessionId: session.sessionId,
      federatedAuthorization: rotated,
      validatedAt: new Date("2026-08-12T00:05:00.000Z"),
    })).resolves.toBe(true);
    await expect(repository.resolveSession(
      hashOpaqueToken(token),
      new Date("2026-08-12T00:06:00.000Z"),
    )).resolves.toMatchObject({
      federatedAuthorization: {
        material: rotated,
        lastValidatedAt: new Date("2026-08-12T00:05:00.000Z"),
      },
    });

    await expect(repository.revokeSessionById(
      session.sessionId,
      new Date("2026-08-12T00:07:00.000Z"),
    )).resolves.toBe(true);
    const revoked = await pool.query<{
      revoked_at: Date | null;
      aicard_refresh_ciphertext: Buffer | null;
      aicard_refresh_iv: Buffer | null;
      aicard_refresh_tag: Buffer | null;
    }>(
      `SELECT revoked_at, aicard_refresh_ciphertext, aicard_refresh_iv,
              aicard_refresh_tag
       FROM human_sessions WHERE id = $1`,
      [session.sessionId],
    );
    expect(revoked.rows[0]).toMatchObject({
      revoked_at: new Date("2026-08-12T00:07:00.000Z"),
      aicard_refresh_ciphertext: null,
      aicard_refresh_iv: null,
      aicard_refresh_tag: null,
    });
  });

  it("replaces owner credentials and invalidates every existing session", async () => {
    const loginHandle = `auth-${humanId.slice(0, 12)}`;
    await repository.provisionCredential({
      principalId: humanId,
      loginHandle,
      passwordHash: randomBytes(64),
      passwordSalt: randomBytes(16),
      passwordAlgorithm: "scrypt-v1",
      recoveryCodeHash: randomBytes(32),
    });
    const token = "yys_before-password-reset";
    await repository.createSession({
      principalId: humanId,
      tokenHash: hashOpaqueToken(token),
      expiresAt: new Date("2027-08-13T00:00:00.000Z"),
      now: new Date("2027-08-12T00:00:00.000Z"),
    });

    const replacementHash = randomBytes(64);
    const replacement = await repository.replaceCredential({
      principalId: humanId,
      loginHandle: loginHandle.toUpperCase(),
      passwordHash: replacementHash,
      passwordSalt: randomBytes(16),
      passwordAlgorithm: "scrypt-v1",
      recoveryCodeHash: randomBytes(32),
      now: new Date("2027-08-12T02:00:00.000Z"),
    });

    expect(replacement).toMatchObject({
      loginHandle,
      passwordHash: replacementHash,
      credentialVersion: 2,
    });
    await expect(
      repository.resolveSession(
        hashOpaqueToken(token),
        new Date("2027-08-12T02:01:00.000Z"),
      ),
    ).resolves.toBeNull();
  });

  it("persists throttle state by opaque scope hash and clears it after success", async () => {
    const scopeHash = randomBytes(32);
    const first = await repository.recordLoginFailure(
      scopeHash,
      new Date("2026-08-12T00:00:00.000Z"),
    );
    expect(first).toMatchObject({ failureCount: 1, lockedUntil: null });

    for (let count = 0; count < 4; count += 1) {
      await repository.recordLoginFailure(
        scopeHash,
        new Date(`2026-08-12T00:0${count + 1}:00.000Z`),
      );
    }
    await expect(repository.getThrottle(scopeHash)).resolves.toMatchObject({
      failureCount: 5,
      lockedUntil: expect.any(Date),
    });
    await repository.clearThrottle(scopeHash);
    await expect(repository.getThrottle(scopeHash)).resolves.toBeNull();
  });
});
