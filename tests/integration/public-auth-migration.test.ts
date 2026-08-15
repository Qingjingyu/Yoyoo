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
  process.env.TEST_DATABASE_URL
  ?? "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";

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
  const name = `public_auth_${randomUUID().replaceAll("-", "")}`;
  await adminPool.query(`CREATE SCHEMA "${name}"`);
  return {
    name,
    pool: createPostgresPool(scopedDatabaseUrl(name), { max: 4 }),
  };
}

async function copyReleasedMigrations(
  prefix: string,
  filenames: string[],
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  for (const filename of filenames) {
    await copyFile(
      join(migrationsDirectory, filename),
      join(directory, filename),
    );
  }
  return directory;
}

const releasedThrough014 = [
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
] as const;

describe("V0.15 public identity and auth migration", () => {
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

  it("upgrades 001-012 data with the workspace owner as AI_100001", async () => {
    const isolated = await createIsolatedSchema(adminPool);
    schemas.push(isolated.name);
    const releasedMigrations = await mkdtemp(join(tmpdir(), "yoyoo-v014-migrations-"));

    try {
      const filenames = Array.from(
        { length: 12 },
        (_, index) => `${String(index + 1).padStart(3, "0")}_`,
      );
      const sourceNames = [
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
      ];
      expect(sourceNames.map((name) => name.slice(0, 4))).toEqual(filenames);
      for (const filename of sourceNames) {
        await copyFile(
          join(migrationsDirectory, filename),
          join(releasedMigrations, filename),
        );
      }
      await runMigrations(scopedDatabaseUrl(isolated.name), releasedMigrations);

      const ownerId = randomUUID();
      const otherHumanId = randomUUID();
      const agentId = randomUUID();
      const systemId = randomUUID();
      const workspaceId = randomUUID();
      const roomId = randomUUID();
      const messageId = randomUUID();

      await isolated.pool.query(
        `INSERT INTO principals
          (id, kind, external_key, handle, display_name, created_at, updated_at)
         VALUES
          ($1, 'agent', 'agent:legacy', 'legacy-agent', 'Legacy Agent',
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
          ($2, 'human', 'human:other', 'other', 'Other Human',
           '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
          ($3, 'human', 'human:owner', 'subai', 'Su Bai',
           '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z'),
          ($4, 'system', 'system:public-auth-test', 'auth-system', 'Auth System',
           '2026-01-04T00:00:00Z', '2026-01-04T00:00:00Z')`,
        [agentId, otherHumanId, ownerId, systemId],
      );
      await isolated.pool.query(
        `INSERT INTO workspaces (id, slug, name) VALUES ($1, 'public-auth', 'Yoyoo')`,
        [workspaceId],
      );
      await isolated.pool.query(
        `INSERT INTO workspace_members (workspace_id, principal_id, role)
         VALUES ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'member')`,
        [workspaceId, ownerId, otherHumanId, agentId],
      );
      await isolated.pool.query(
        `INSERT INTO rooms (id, workspace_id, name, created_by_principal_id)
         VALUES ($1, $2, 'Existing room', $3)`,
        [roomId, workspaceId, ownerId],
      );
      await isolated.pool.query(
        `INSERT INTO room_members (room_id, principal_id, role)
         VALUES ($1, $2, 'owner')`,
        [roomId, ownerId],
      );
      await isolated.pool.query(
        `INSERT INTO room_messages
          (id, room_id, sender_principal_id, content, status)
         VALUES ($1, $2, $3, 'preserve me', 'completed')`,
        [messageId, roomId, ownerId],
      );

      const migration = await runMigrations(scopedDatabaseUrl(isolated.name));
      expect(migration.applied).toEqual([
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

      const identities = await isolated.pool.query<{
        id: string;
        ai_card_id: string;
      }>(`SELECT id, ai_card_id FROM principals ORDER BY ai_card_id`);
      expect(identities.rows[0]).toEqual({ id: ownerId, ai_card_id: "AI_100001" });
      expect(new Set(identities.rows.map((row) => row.ai_card_id)).size).toBe(
        identities.rows.length,
      );
      expect(identities.rows.map((row) => row.ai_card_id)).toEqual(
        identities.rows.map((_, index) => `AI_${100001 + index}`),
      );
      expect(identities.rows.map((row) => row.id)).toEqual(
        expect.arrayContaining([ownerId, otherHumanId, agentId, systemId]),
      );

      const preserved = await isolated.pool.query<{
        sender_principal_id: string;
        content: string;
      }>(
        `SELECT sender_principal_id, content FROM room_messages WHERE id = $1`,
        [messageId],
      );
      expect(preserved.rows[0]).toEqual({
        sender_principal_id: ownerId,
        content: "preserve me",
      });
    } finally {
      await isolated.pool.end();
      await rm(releasedMigrations, { recursive: true, force: true });
    }
  });

  it("allocates unique ascending IDs and never reuses a deleted number", async () => {
    const isolated = await createIsolatedSchema(adminPool);
    schemas.push(isolated.name);
    const releasedMigrations = await copyReleasedMigrations(
      "yoyoo-v015-migrations-",
      [...releasedThrough014],
    );

    try {
      await runMigrations(scopedDatabaseUrl(isolated.name), releasedMigrations);
      const firstHumanId = randomUUID();
      const firstHuman = await isolated.pool.query<{ ai_card_id: string }>(
        `INSERT INTO principals
          (id, kind, external_key, handle, display_name)
         VALUES ($1, 'human', 'human:first-owner', 'first-owner', 'First owner')
         RETURNING ai_card_id`,
        [firstHumanId],
      );
      expect(firstHuman.rows[0].ai_card_id).toBe("AI_100001");

      const ids = Array.from({ length: 8 }, () => randomUUID());
      const inserted = await Promise.all(
        ids.map((id, index) => isolated.pool.query<{ ai_card_id: string }>(
          `INSERT INTO principals
            (id, kind, external_key, handle, display_name)
           VALUES ($1, 'agent', $2, $3, $4)
           RETURNING ai_card_id`,
          [id, `agent:parallel:${index}`, `parallel-${index}`, `Parallel ${index}`],
        )),
      );
      const allocated = inserted.map((result) => result.rows[0].ai_card_id).sort();
      expect(new Set(allocated).size).toBe(8);
      expect(allocated).toEqual([
        "AI_100003",
        "AI_100004",
        "AI_100005",
        "AI_100006",
        "AI_100007",
        "AI_100008",
        "AI_100009",
        "AI_100010",
      ]);

      const allAllocated = await isolated.pool.query<{ ai_card_id: string }>(
        `SELECT ai_card_id FROM principals ORDER BY ai_card_id`,
      );
      expect(allAllocated.rows.map((row) => row.ai_card_id)).toEqual(
        Array.from({ length: 10 }, (_, index) => `AI_${100001 + index}`),
      );

      const deleted = allocated[7];
      await isolated.pool.query(`DELETE FROM principals WHERE ai_card_id = $1`, [deleted]);
      const next = await isolated.pool.query<{ ai_card_id: string }>(
        `INSERT INTO principals
          (id, kind, external_key, handle, display_name)
         VALUES ($1, 'agent', 'agent:after-delete', 'after-delete', 'After delete')
         RETURNING ai_card_id`,
        [randomUUID()],
      );
      expect(next.rows[0].ai_card_id).toBe("AI_100011");

      await expect(
        isolated.pool.query(
          `UPDATE principals SET ai_card_id = 'AI_999999' WHERE id = $1`,
          [firstHumanId],
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining("immutable") });
    } finally {
      await isolated.pool.end();
      await rm(releasedMigrations, { recursive: true, force: true });
    }
  });

  it("upgrades 001-014 without changing history and stops local AI Card issuance", async () => {
    const isolated = await createIsolatedSchema(adminPool);
    schemas.push(isolated.name);
    const releasedMigrations = await copyReleasedMigrations(
      "yoyoo-v016-migrations-",
      [...releasedThrough014],
    );

    try {
      await runMigrations(scopedDatabaseUrl(isolated.name), releasedMigrations);
      const ownerId = randomUUID();
      const workspaceId = randomUUID();
      const roomId = randomUUID();
      const messageId = randomUUID();
      const subject = `sub_${"A".repeat(43)}`;

      const owner = await isolated.pool.query<{ ai_card_id: string }>(
        `INSERT INTO principals
          (id, kind, external_key, handle, display_name)
         VALUES ($1, 'human', 'human:authority-owner', 'authority-owner', 'Authority Owner')
         RETURNING ai_card_id`,
        [ownerId],
      );
      expect(owner.rows[0].ai_card_id).toBe("AI_100001");
      await isolated.pool.query(
        `INSERT INTO workspaces (id, slug, name)
         VALUES ($1, 'authority-migration', 'Authority migration')`,
        [workspaceId],
      );
      await isolated.pool.query(
        `INSERT INTO workspace_members (workspace_id, principal_id, role)
         VALUES ($1, $2, 'owner')`,
        [workspaceId, ownerId],
      );
      await isolated.pool.query(
        `INSERT INTO rooms (id, workspace_id, name, created_by_principal_id)
         VALUES ($1, $2, 'Preserved room', $3)`,
        [roomId, workspaceId, ownerId],
      );
      await isolated.pool.query(
        `INSERT INTO room_members (room_id, principal_id, role)
         VALUES ($1, $2, 'owner')`,
        [roomId, ownerId],
      );
      await isolated.pool.query(
        `INSERT INTO room_messages
          (id, room_id, sender_principal_id, content, status)
         VALUES ($1, $2, $3, 'authority migration preserves me', 'completed')`,
        [messageId, roomId, ownerId],
      );

      const before = await isolated.pool.query<{
        principals: string;
        workspaces: string;
        workspace_members: string;
        rooms: string;
        room_members: string;
        room_messages: string;
      }>(
        `SELECT
          (SELECT COUNT(*) FROM principals)::TEXT AS principals,
          (SELECT COUNT(*) FROM workspaces)::TEXT AS workspaces,
          (SELECT COUNT(*) FROM workspace_members)::TEXT AS workspace_members,
          (SELECT COUNT(*) FROM rooms)::TEXT AS rooms,
          (SELECT COUNT(*) FROM room_members)::TEXT AS room_members,
          (SELECT COUNT(*) FROM room_messages)::TEXT AS room_messages`,
      );

      const migration = await runMigrations(scopedDatabaseUrl(isolated.name));
      expect(migration.applied).toEqual([
        "015_aicard_authority_migration.sql",
        "016_federated_human_sessions.sql",
        "017_aicard_authorization_replay_guard.sql",
        "018_aicard_session_authority.sql",
        "019_release_legacy_ai_card_projection.sql",
        "020_agent_admission_invitations.sql",
        "021_agent_admission_revocation.sql",
        "022_agent_admission_machine_name.sql",
      ]);

      const after = await isolated.pool.query<typeof before.rows[number]>(
        `SELECT
          (SELECT COUNT(*) FROM principals)::TEXT AS principals,
          (SELECT COUNT(*) FROM workspaces)::TEXT AS workspaces,
          (SELECT COUNT(*) FROM workspace_members)::TEXT AS workspace_members,
          (SELECT COUNT(*) FROM rooms)::TEXT AS rooms,
          (SELECT COUNT(*) FROM room_members)::TEXT AS room_members,
          (SELECT COUNT(*) FROM room_messages)::TEXT AS room_messages`,
      );
      expect(after.rows[0]).toEqual(before.rows[0]);

      const preserved = await isolated.pool.query<{
        ai_card_id: string;
        sender_principal_id: string;
      }>(
        `SELECT principals.ai_card_id, messages.sender_principal_id
         FROM principals
         JOIN room_messages AS messages ON messages.sender_principal_id = principals.id
         WHERE principals.id = $1 AND messages.id = $2`,
        [ownerId, messageId],
      );
      expect(preserved.rows[0]).toEqual({
        ai_card_id: "AI_100001",
        sender_principal_id: ownerId,
      });

      const unissued = await isolated.pool.query<{ ai_card_id: string | null }>(
        `INSERT INTO principals
          (id, kind, external_key, handle, display_name)
         VALUES ($1, 'human', 'human:federated-new', 'federated-new', 'Federated New')
         RETURNING ai_card_id`,
        [randomUUID()],
      );
      expect(unissued.rows[0].ai_card_id).toBeNull();

      await isolated.pool.query(
        `INSERT INTO aicard_identity_mappings
          (issuer, client_id, subject, principal_id, card_id)
         VALUES ('https://id.yoyooai.test', 'yoyoo_dev', $1, $2, 'AI_100001')`,
        [subject, ownerId],
      );
      const mapping = await isolated.pool.query<{ card_id: string }>(
        `SELECT card_id FROM aicard_identity_mappings
         WHERE issuer = 'https://id.yoyooai.test'
           AND client_id = 'yoyoo_dev'
           AND subject = $1`,
        [subject],
      );
      expect(mapping.rows[0].card_id).toBe("AI_100001");

      const allocator = await isolated.pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM pg_trigger
           JOIN pg_class ON pg_class.oid = pg_trigger.tgrelid
           JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
           WHERE pg_trigger.tgname = 'principals_assign_ai_card_public_id'
             AND NOT pg_trigger.tgisinternal
             AND pg_namespace.nspname = current_schema()
         )`,
      );
      expect(allocator.rows[0].exists).toBe(false);
    } finally {
      await isolated.pool.end();
      await rm(releasedMigrations, { recursive: true, force: true });
    }
  });

  it("creates credential, recovery, session, and throttle stores without plaintext fields", async () => {
    const isolated = await createIsolatedSchema(adminPool);
    schemas.push(isolated.name);

    try {
      await runMigrations(scopedDatabaseUrl(isolated.name));
      const columns = await isolated.pool.query<{
        table_name: string;
        column_name: string;
      }>(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = ANY($1::text[])
         ORDER BY table_name, ordinal_position`,
        [["human_credentials", "human_sessions", "login_throttles"]],
      );
      const names = columns.rows.map((row) => `${row.table_name}.${row.column_name}`);
      expect(names).toEqual(expect.arrayContaining([
        "human_credentials.password_hash",
        "human_credentials.password_salt",
        "human_credentials.recovery_code_hash",
        "human_sessions.token_hash",
        "human_sessions.auth_method",
        "human_sessions.identity_subject",
        "login_throttles.scope_hash",
      ]));
      expect(names.some((name) => /plaintext|raw_password|raw_token/.test(name))).toBe(false);
    } finally {
      await isolated.pool.end();
    }
  });
});
