/** @vitest-environment node */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import type { DatabaseError } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresPool } from "@/server/postgres/client";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "../..");
const migrationScript = join(projectRoot, "scripts/db-migrate.mjs");
const migrationsDirectory = join(projectRoot, "infra/postgres/migrations");
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";

async function runMigrations(directory = migrationsDirectory) {
  const { stdout } = await execFileAsync(process.execPath, [migrationScript], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      MIGRATIONS_DIR: directory,
    },
  });

  return JSON.parse(stdout.trim()) as {
    applied: string[];
    skipped: string[];
  };
}

function expectPostgresCode(error: unknown, code: string): void {
  expect((error as DatabaseError).code).toBe(code);
}

describe("PostgreSQL foundation", () => {
  const pool = createPostgresPool(databaseUrl);

  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("treats a second migration run as a checksum-verified no-op", async () => {
    const result = await runMigrations();

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([
      "001_conversation_core.sql",
      "002_retry_idempotency.sql",
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
    ]);

    const migrationCounts = await pool.query<{ version: string; count: string }>(
      `SELECT version, COUNT(*)::text AS count
       FROM schema_migrations
       WHERE version = ANY($1::text[])
       GROUP BY version
       ORDER BY version`,
      [[
        "001_conversation_core.sql",
        "002_retry_idempotency.sql",
        "003_multi_principal_workspace.sql",
      ]],
    );
    expect(migrationCounts.rows).toEqual([
      { version: "001_conversation_core.sql", count: "1" },
      { version: "002_retry_idempotency.sql", count: "1" },
      { version: "003_multi_principal_workspace.sql", count: "1" },
    ]);
  });

  it("rejects a changed migration after that version has been applied", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "yoyoo-migrations-"));
    const migrationName = "001_conversation_core.sql";

    try {
      const original = await readFile(join(migrationsDirectory, migrationName), "utf8");
      await writeFile(
        join(temporaryDirectory, migrationName),
        `${original}\n-- an applied migration must never be rewritten\n`,
      );

      await expect(runMigrations(temporaryDirectory)).rejects.toMatchObject({
        stderr: expect.stringContaining("checksum mismatch"),
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("enforces conversation, message, run, and event invariants", async () => {
    const conversationId = randomUUID();
    const otherConversationId = randomUUID();
    const userMessageId = randomUUID();
    const otherUserMessageId = randomUUID();
    const agentMessageId = randomUUID();
    const runId = randomUUID();
    const idempotencyKey = randomUUID();

    await pool.query(
      `INSERT INTO conversations (id, owner_id, agent_id)
       VALUES ($1, $2, $3), ($4, $2, $3)`,
      [conversationId, "owner-test", "test-agent", otherConversationId],
    );

    await expect(
      pool.query(
        `INSERT INTO conversations (id, owner_id, agent_id, status)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), "owner-test", "test-agent", "invented"],
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectPostgresCode(error, "23514");
      return true;
    });

    await expect(
      pool.query(
        `INSERT INTO messages
          (id, conversation_id, sender_type, content, status, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), conversationId, "human", "   ", "completed", randomUUID()],
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectPostgresCode(error, "23514");
      return true;
    });

    await pool.query(
      `INSERT INTO messages
        (id, conversation_id, sender_type, content, status, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userMessageId, conversationId, "human", "你好", "completed", idempotencyKey],
    );

    await expect(
      pool.query(
        `INSERT INTO messages
          (id, conversation_id, sender_type, content, status, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), conversationId, "human", "重复", "completed", idempotencyKey],
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectPostgresCode(error, "23505");
      return true;
    });

    await pool.query(
      `INSERT INTO messages
        (id, conversation_id, sender_type, content, status, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6), ($7, $8, $9, $10, $11, $12)`,
      [
        otherUserMessageId,
        otherConversationId,
        "human",
        "另一个对话可以复用同一个键",
        "completed",
        idempotencyKey,
        agentMessageId,
        conversationId,
        "agent",
        "你好，我是 Yoyoo。",
        "completed",
        null,
      ],
    );

    await pool.query(
      `INSERT INTO runs
        (id, conversation_id, user_message_id, agent_message_id, adapter_id, status,
         started_at, finished_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [runId, conversationId, userMessageId, agentMessageId, "test-agent", "completed"],
    );

    await pool.query(
      `INSERT INTO run_events (run_id, sequence, event_type, payload)
       VALUES ($1, 1, 'status', '{"status":"running"}'::jsonb),
              ($1, 2, 'completed', '{"text":"你好，我是 Yoyoo。"}'::jsonb)`,
      [runId],
    );

    await expect(
      pool.query(
        `INSERT INTO run_events (run_id, sequence, event_type, payload)
         VALUES ($1, 2, 'completed', '{}'::jsonb)`,
        [runId],
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectPostgresCode(error, "23505");
      return true;
    });
  });
});
