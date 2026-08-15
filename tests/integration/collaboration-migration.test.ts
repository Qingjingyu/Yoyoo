/** @vitest-environment node */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresPool } from "@/server/postgres/client";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "../..");
const migrationScript = join(projectRoot, "scripts/db-migrate.mjs");
const migrationsDirectory = join(projectRoot, "infra/postgres/migrations");
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";

const collaborationTables = [
  "agent_bindings",
  "agent_gateway_credentials",
  "agent_gateway_jobs",
  "artifacts",
  "attachment_access_grants",
  "attachments",
  "delegations",
  "message_attachments",
  "message_mentions",
  "principals",
  "room_member_states",
  "room_members",
  "room_message_revisions",
  "room_messages",
  "room_run_events",
  "room_runs",
  "rooms",
  "workspace_members",
  "workspaces",
] as const;

function scopedDatabaseUrl(schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

async function runMigrations(connectionString: string, directory = migrationsDirectory) {
  const { stdout } = await execFileAsync(process.execPath, [migrationScript], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      MIGRATIONS_DIR: directory,
    },
  });
  return JSON.parse(stdout.trim()) as { applied: string[]; skipped: string[] };
}

async function createIsolatedSchema(adminPool: Pool): Promise<{
  name: string;
  pool: Pool;
}> {
  const name = `collaboration_${randomUUID().replaceAll("-", "")}`;
  await adminPool.query(`CREATE SCHEMA "${name}"`);
  return {
    name,
    pool: createPostgresPool(scopedDatabaseUrl(name), { max: 2 }),
  };
}

describe("V0.2 collaboration migration", () => {
  const adminPool = createPostgresPool(databaseUrl, { max: 2 });
  const schemas: string[] = [];

  beforeAll(async () => {
    await runMigrations(databaseUrl);
  });

  afterAll(async () => {
    for (const schema of schemas) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await adminPool.end();
  });

  it("creates every durable collaboration object on a clean database", async () => {
    const result = await adminPool.query<{ tablename: string }>(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = current_schema()
         AND tablename = ANY($1::text[])
       ORDER BY tablename`,
      [collaborationTables],
    );

    expect(result.rows.map((row) => row.tablename)).toEqual(collaborationTables);
  });

  it("upgrades a V0.1 schema and backfills its conversation without data loss", async () => {
    const isolated = await createIsolatedSchema(adminPool);
    schemas.push(isolated.name);
    const legacyMigrations = await mkdtemp(join(tmpdir(), "yoyoo-v01-migrations-"));

    try {
      for (const filename of [
        "001_conversation_core.sql",
        "002_retry_idempotency.sql",
      ]) {
        await copyFile(
          join(migrationsDirectory, filename),
          join(legacyMigrations, filename),
        );
      }
      await runMigrations(scopedDatabaseUrl(isolated.name), legacyMigrations);

      const conversationId = randomUUID();
      const humanMessageId = randomUUID();
      const agentMessageId = randomUUID();
      const runId = randomUUID();
      await isolated.pool.query(
        `INSERT INTO conversations (id, owner_id, agent_id, title)
         VALUES ($1, 'subai', 'yos-primary', '旧对话')`,
        [conversationId],
      );
      await isolated.pool.query(
        `INSERT INTO messages
          (id, conversation_id, sender_type, content, status, idempotency_key)
         VALUES
          ($1, $3, 'human', '请开始工作', 'completed', 'legacy-message'),
          ($2, $3, 'agent', '已经完成。', 'completed', NULL)`,
        [humanMessageId, agentMessageId, conversationId],
      );
      await isolated.pool.query(
        `INSERT INTO runs
          (id, conversation_id, user_message_id, agent_message_id, adapter_id,
           status, started_at, finished_at)
         VALUES ($1, $2, $3, $4, 'yos-primary', 'completed', NOW(), NOW())`,
        [runId, conversationId, humanMessageId, agentMessageId],
      );
      await isolated.pool.query(
        `INSERT INTO run_events (run_id, sequence, event_type, payload)
         VALUES ($1, 1, 'completed', '{"sequence":1,"type":"completed","text":"已经完成。"}')`,
        [runId],
      );

      const migration = await runMigrations(scopedDatabaseUrl(isolated.name));

      expect(migration.applied).toEqual([
        "003_multi_principal_workspace.sql",
        "004_agent_gateway.sql",
        "005_aicard_identity_mapping.sql",
        "006_aicard_agent_runtime.sql",
        "007_im_resources.sql",
        "008_attachment_filename_constraint.sql",
        "009_attachment_only_messages.sql",
        "010_message_revisions.sql",
        "011_im_member_state.sql",
        "012_addressable_conversations.sql",
        "013_public_identity_auth.sql",
        "014_reserve_first_human_ai_card_id.sql",
        "015_aicard_authority_migration.sql",
        "016_federated_human_sessions.sql",
        "017_aicard_authorization_replay_guard.sql",
        "018_aicard_session_authority.sql",
        "019_release_legacy_ai_card_projection.sql",
        "020_agent_admission_invitations.sql",
        "021_agent_admission_revocation.sql",
        "022_agent_admission_machine_name.sql",
      ]);
      await expect(
        isolated.pool.query(
          `SELECT kind, external_key FROM principals ORDER BY kind, external_key`,
        ),
      ).resolves.toMatchObject({
        rows: [
          { kind: "agent", external_key: "agent:yos-primary" },
          { kind: "human", external_key: "human:subai" },
          { kind: "system", external_key: "system:yoyoo" },
        ],
      });

      const snapshot = await isolated.pool.query<{
        workspaces: string;
        rooms: string;
        messages: string;
        runs: string;
        events: string;
      }>(
        `SELECT
          (SELECT COUNT(*)::text FROM workspaces) AS workspaces,
          (SELECT COUNT(*)::text FROM rooms WHERE legacy_conversation_id = $1) AS rooms,
          (SELECT COUNT(*)::text FROM room_messages WHERE room_id = $1) AS messages,
          (SELECT COUNT(*)::text FROM room_runs WHERE id = $2) AS runs,
          (SELECT COUNT(*)::text FROM room_run_events WHERE run_id = $2) AS events`,
        [conversationId, runId],
      );
      expect(snapshot.rows[0]).toEqual({
        workspaces: "1",
        rooms: "1",
        messages: "2",
        runs: "1",
        events: "1",
      });

      const migratedMessage = await isolated.pool.query<{
        sender: string;
        content: string;
      }>(
        `SELECT principals.external_key AS sender, room_messages.content
         FROM room_messages
         JOIN principals ON principals.id = room_messages.sender_principal_id
         WHERE room_messages.id = $1`,
        [humanMessageId],
      );
      expect(migratedMessage.rows[0]).toEqual({
        sender: "human:subai",
        content: "请开始工作",
      });

      const addressableConversation = await isolated.pool.query<{
        purpose: string;
        pinned_at: Date | null;
        hidden_at: Date | null;
      }>(
        `SELECT rooms.purpose,
                room_member_states.pinned_at,
                room_member_states.hidden_at
         FROM rooms
         JOIN room_member_states ON room_member_states.room_id = rooms.id
         WHERE rooms.id = $1
         ORDER BY room_member_states.principal_id
         LIMIT 1`,
        [conversationId],
      );
      expect(addressableConversation.rows[0]).toEqual({
        purpose: "",
        pinned_at: null,
        hidden_at: null,
      });
    } finally {
      await isolated.pool.end();
      await rm(legacyMigrations, { recursive: true, force: true });
    }
  });
});
