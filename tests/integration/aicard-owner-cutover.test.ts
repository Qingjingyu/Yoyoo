/** @vitest-environment node */

import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AICardOwnerCutoverError,
  finalizeAICardOwnerCutover,
} from "../../scripts/finalize-aicard-owner-cutover.mts";
import { createPostgresPool } from "@/server/postgres/client";

const databaseUrl = process.env.TEST_DATABASE_URL
  ?? "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";
const issuer = "https://id.yoyooai.test";
const clientId = "yoyoo_test";
const subject = `sub_${"C".repeat(43)}`;
const now = new Date("2026-08-15T10:00:00.000Z");

async function seedCutoverFixture(pool: Pool, options: {
  withMapping?: boolean;
  withFederatedSession?: boolean;
} = {}) {
  const ownerId = randomUUID();
  const workspaceId = randomUUID();
  const roomId = randomUUID();
  const withMapping = options.withMapping ?? true;
  const withFederatedSession = options.withFederatedSession ?? true;

  const system = await pool.query<{ id: string }>(
    `SELECT id FROM principals WHERE external_key = 'system:yoyoo'`,
  );
  const systemId = system.rows[0].id;
  await pool.query(
    `INSERT INTO principals
      (id, kind, external_key, handle, display_name, ai_card_id)
     VALUES ($1, 'human', 'human:cutover-owner', 'legacy-owner',
             'Legacy Owner', 'AI_100001')`,
    [ownerId],
  );
  await pool.query(
    `INSERT INTO workspaces (id, slug, name)
     VALUES ($1, $2, 'Cutover workspace')`,
    [workspaceId, `cutover-${workspaceId.slice(0, 8)}`],
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, principal_id, role)
     VALUES ($1, $2, 'owner')`,
    [workspaceId, ownerId],
  );
  await pool.query(
    `INSERT INTO rooms (id, workspace_id, name, created_by_principal_id)
     VALUES ($1, $2, 'Preserved room', $3)`,
    [roomId, workspaceId, ownerId],
  );
  await pool.query(
    `INSERT INTO room_members (room_id, principal_id, role)
     VALUES ($1, $2, 'owner')`,
    [roomId, ownerId],
  );
  await pool.query(
    `INSERT INTO human_credentials
      (principal_id, login_handle, password_hash, password_salt,
       password_algorithm, recovery_code_hash)
     VALUES ($1, 'ai_100001', $2, $3, 'scrypt-v1', $4)`,
    [ownerId, Buffer.alloc(64, 1), Buffer.alloc(16, 2), Buffer.alloc(32, 3)],
  );
  await pool.query(
    `INSERT INTO human_sessions
      (id, principal_id, token_hash, credential_version, auth_method,
       expires_at, last_seen_at, created_at)
     VALUES ($1, $2, $3, 1, 'password', $4, $5, $5)`,
    [
      randomUUID(),
      ownerId,
      Buffer.alloc(32, 4),
      new Date("2026-09-15T10:00:00.000Z"),
      new Date("2026-08-14T10:00:00.000Z"),
    ],
  );

  if (withMapping) {
    await pool.query(
      `INSERT INTO aicard_identity_mappings
        (issuer, client_id, subject, principal_id, card_id)
       VALUES ($1, $2, $3, $4, 'AI_100001')`,
      [issuer, clientId, subject, ownerId],
    );
  }
  if (withMapping && withFederatedSession) {
    await pool.query(
      `INSERT INTO human_sessions
        (id, principal_id, token_hash, credential_version, auth_method,
         identity_issuer, identity_client_id, identity_subject,
         authorization_state_hash, expires_at, aicard_refresh_ciphertext,
         aicard_refresh_iv, aicard_refresh_tag, aicard_refresh_expires_at,
         aicard_last_validated_at, last_seen_at, created_at)
       VALUES ($1, $2, $3, NULL, 'aicard', $4, $5, $6, $7, $8,
               $9, $10, $11, $12, $13, $13, $13)`,
      [
        randomUUID(),
        ownerId,
        Buffer.alloc(32, 5),
        issuer,
        clientId,
        subject,
        Buffer.alloc(32, 6),
        new Date("2026-09-15T10:00:00.000Z"),
        Buffer.alloc(48, 7),
        Buffer.alloc(12, 8),
        Buffer.alloc(16, 9),
        new Date("2026-09-15T10:00:00.000Z"),
        new Date("2026-08-15T09:59:00.000Z"),
      ],
    );
  }
  return { ownerId, systemId, workspaceId, roomId };
}

describe("AI Card owner cutover", () => {
  const adminPool = createPostgresPool(databaseUrl, { max: 2 });
  const schemas: string[] = [];

  beforeAll(async () => {
    await adminPool.query("SELECT 1");
  });

  afterAll(async () => {
    for (const schema of schemas) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await adminPool.end();
  });

  async function isolatedPool(): Promise<Pool> {
    const schema = `aicard_cutover_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl);
    url.searchParams.set("options", `-c search_path=${schema}`);
    const pool = createPostgresPool(url.toString(), { max: 2 });
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)(process.execPath, ["scripts/db-migrate.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url.toString() },
    });
    return pool;
  }

  it("reports readiness without changing legacy data by default", async () => {
    const pool = await isolatedPool();
    const fixture = await seedCutoverFixture(pool);
    try {
      const result = await finalizeAICardOwnerCutover(pool, {
        issuer,
        clientId,
        expectedCardId: "AI_100001",
        now,
        apply: false,
      });
      expect(result).toMatchObject({
        applied: false,
        ownerPrincipalId: fixture.ownerId,
        cardId: "AI_100001",
        activeAICardSessions: 1,
        activePasswordSessions: 1,
        activeLegacyCredentials: 1,
        legacyPrincipalCardIds: 2,
      });
      const credential = await pool.query<{ status: string }>(
        "SELECT status FROM human_credentials WHERE principal_id = $1",
        [fixture.ownerId],
      );
      expect(credential.rows[0]?.status).toBe("active");
    } finally {
      await pool.end();
    }
  });

  it("refuses cleanup until an authoritative owner mapping and session both exist", async () => {
    const pool = await isolatedPool();
    const fixture = await seedCutoverFixture(pool, { withMapping: false });
    try {
      await expect(finalizeAICardOwnerCutover(pool, {
        issuer,
        clientId,
        expectedCardId: "AI_100001",
        now,
        apply: true,
      })).rejects.toBeInstanceOf(AICardOwnerCutoverError);
      const state = await pool.query<{ status: string; ai_card_id: string }>(
        `SELECT credentials.status, principals.ai_card_id
         FROM human_credentials AS credentials
         JOIN principals ON principals.id = credentials.principal_id
         WHERE principals.id = $1`,
        [fixture.ownerId],
      );
      expect(state.rows[0]).toEqual({ status: "active", ai_card_id: "AI_100001" });
    } finally {
      await pool.end();
    }
  });

  it("revokes only legacy auth while preserving the owner and business graph", async () => {
    const pool = await isolatedPool();
    const fixture = await seedCutoverFixture(pool);
    try {
      const result = await finalizeAICardOwnerCutover(pool, {
        issuer,
        clientId,
        expectedCardId: "AI_100001",
        now,
        apply: true,
      });
      expect(result).toMatchObject({
        applied: true,
        revokedPasswordSessions: 1,
        disabledLegacyCredentials: 1,
        clearedLegacyPrincipalCardIds: 2,
      });
      const graph = await pool.query<{
        owners: string;
        rooms: string;
        room_members: string;
        mappings: string;
        active_aicard_sessions: string;
        active_password_sessions: string;
        active_credentials: string;
        legacy_card_ids: string;
      }>(
        `SELECT
          (SELECT COUNT(*) FROM workspace_members
             WHERE principal_id = $1 AND role = 'owner' AND status = 'active')::TEXT AS owners,
          (SELECT COUNT(*) FROM rooms WHERE id = $2)::TEXT AS rooms,
          (SELECT COUNT(*) FROM room_members
             WHERE room_id = $2 AND principal_id = $1)::TEXT AS room_members,
          (SELECT COUNT(*) FROM aicard_identity_mappings
             WHERE principal_id = $1 AND card_id = 'AI_100001')::TEXT AS mappings,
          (SELECT COUNT(*) FROM human_sessions
             WHERE principal_id = $1 AND auth_method = 'aicard' AND revoked_at IS NULL)::TEXT
             AS active_aicard_sessions,
          (SELECT COUNT(*) FROM human_sessions
             WHERE principal_id = $1 AND auth_method = 'password' AND revoked_at IS NULL)::TEXT
             AS active_password_sessions,
          (SELECT COUNT(*) FROM human_credentials
             WHERE principal_id = $1 AND status = 'active')::TEXT AS active_credentials,
          (SELECT COUNT(*) FROM principals WHERE ai_card_id IS NOT NULL)::TEXT AS legacy_card_ids`,
        [fixture.ownerId, fixture.roomId],
      );
      expect(graph.rows[0]).toEqual({
        owners: "1",
        rooms: "1",
        room_members: "1",
        mappings: "1",
        active_aicard_sessions: "1",
        active_password_sessions: "0",
        active_credentials: "0",
        legacy_card_ids: "0",
      });

      const repeated = await finalizeAICardOwnerCutover(pool, {
        issuer,
        clientId,
        expectedCardId: "AI_100001",
        now: new Date("2026-08-15T10:01:00.000Z"),
        apply: true,
      });
      expect(repeated).toMatchObject({
        revokedPasswordSessions: 0,
        disabledLegacyCredentials: 0,
        clearedLegacyPrincipalCardIds: 0,
      });
    } finally {
      await pool.end();
    }
  });
});
