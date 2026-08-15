import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool, PoolClient } from "pg";

import { createPostgresPool } from "../src/server/postgres/client.ts";

const DEFAULT_OWNER_CARD_ID = "AI_100001";
const CARD_ID_PATTERN = /^AI_[1-9][0-9]{5,}$/;

export class AICardOwnerCutoverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AICardOwnerCutoverError";
  }
}

export interface AICardOwnerCutoverResult {
  applied: boolean;
  ownerPrincipalId: string;
  cardId: string;
  activeAICardSessions: number;
  activePasswordSessions: number;
  activeLegacyCredentials: number;
  legacyPrincipalCardIds: number;
  revokedPasswordSessions: number;
  disabledLegacyCredentials: number;
  clearedLegacyPrincipalCardIds: number;
}

interface CutoverInput {
  issuer: string;
  clientId: string;
  expectedCardId?: string;
  now?: Date;
  apply?: boolean;
}

interface OwnerRow {
  id: string;
}

interface MappingRow {
  subject: string;
  card_id: string | null;
}

interface CountRow {
  active_aicard_sessions: string;
  active_password_sessions: string;
  active_legacy_credentials: string;
  legacy_principal_card_ids: string;
}

function validatedInput(input: CutoverInput) {
  const issuer = new URL(input.issuer);
  if (issuer.pathname !== "/" || issuer.search || issuer.hash) {
    throw new AICardOwnerCutoverError("AI Card issuer must contain only an origin");
  }
  if (!/^[a-z][a-z0-9_-]{2,63}$/.test(input.clientId)) {
    throw new AICardOwnerCutoverError("AI Card client ID is invalid");
  }
  const expectedCardId = input.expectedCardId ?? DEFAULT_OWNER_CARD_ID;
  if (!CARD_ID_PATTERN.test(expectedCardId)) {
    throw new AICardOwnerCutoverError("Expected AI Card ID is invalid");
  }
  return {
    issuer: issuer.origin,
    clientId: input.clientId,
    expectedCardId,
    now: input.now ?? new Date(),
    apply: input.apply ?? false,
  };
}

async function inspectCutover(
  client: PoolClient,
  input: ReturnType<typeof validatedInput>,
): Promise<Omit<AICardOwnerCutoverResult,
  "applied" | "revokedPasswordSessions" | "disabledLegacyCredentials"
  | "clearedLegacyPrincipalCardIds">> {
  const owners = await client.query<OwnerRow>(
    `SELECT principals.id
     FROM principals
     WHERE principals.kind = 'human'
       AND principals.status = 'active'
       AND EXISTS (
         SELECT 1
         FROM workspace_members
         JOIN workspaces ON workspaces.id = workspace_members.workspace_id
         WHERE workspace_members.principal_id = principals.id
           AND workspace_members.role = 'owner'
           AND workspace_members.status = 'active'
           AND workspaces.status = 'active'
       )
     ORDER BY principals.id
     FOR UPDATE OF principals`,
  );
  if (owners.rowCount !== 1) {
    throw new AICardOwnerCutoverError(
      "Cutover requires exactly one active human workspace owner",
    );
  }
  const ownerPrincipalId = owners.rows[0].id;
  const mappings = await client.query<MappingRow>(
    `SELECT mappings.subject, mappings.card_id
     FROM aicard_identity_mappings AS mappings
     JOIN principals ON principals.id = mappings.principal_id
     WHERE mappings.issuer = $1
       AND mappings.client_id = $2
       AND mappings.principal_id = $3
       AND principals.kind = 'human'
       AND principals.status = 'active'
     FOR UPDATE OF mappings`,
    [input.issuer, input.clientId, ownerPrincipalId],
  );
  if (mappings.rowCount !== 1 || mappings.rows[0].card_id !== input.expectedCardId) {
    throw new AICardOwnerCutoverError(
      `Active owner is not verified as ${input.expectedCardId} by the configured AI Card authority`,
    );
  }
  const mapping = mappings.rows[0];
  const counts = await client.query<CountRow>(
    `SELECT
       (SELECT COUNT(*)
          FROM human_sessions
         WHERE principal_id = $1
           AND auth_method = 'aicard'
           AND identity_issuer = $2
           AND identity_client_id = $3
           AND identity_subject = $4
           AND revoked_at IS NULL
           AND expires_at > $5)::TEXT AS active_aicard_sessions,
       (SELECT COUNT(*)
          FROM human_sessions
         WHERE principal_id = $1
           AND auth_method = 'password'
           AND revoked_at IS NULL)::TEXT AS active_password_sessions,
       (SELECT COUNT(*)
          FROM human_credentials
         WHERE principal_id = $1
           AND status = 'active')::TEXT AS active_legacy_credentials,
       (SELECT COUNT(*)
          FROM principals
         WHERE ai_card_id IS NOT NULL)::TEXT AS legacy_principal_card_ids`,
    [
      ownerPrincipalId,
      input.issuer,
      input.clientId,
      mapping.subject,
      input.now,
    ],
  );
  const count = counts.rows[0];
  const activeAICardSessions = Number(count.active_aicard_sessions);
  if (activeAICardSessions < 1) {
    throw new AICardOwnerCutoverError(
      "Cutover requires an active AI Card session for the verified owner mapping",
    );
  }
  return {
    ownerPrincipalId,
    cardId: input.expectedCardId,
    activeAICardSessions,
    activePasswordSessions: Number(count.active_password_sessions),
    activeLegacyCredentials: Number(count.active_legacy_credentials),
    legacyPrincipalCardIds: Number(count.legacy_principal_card_ids),
  };
}

export async function finalizeAICardOwnerCutover(
  pool: Pool,
  rawInput: CutoverInput,
): Promise<AICardOwnerCutoverResult> {
  const input = validatedInput(rawInput);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `aicard-owner-cutover:${input.issuer}:${input.clientId}`,
    ]);
    const inspection = await inspectCutover(client, input);
    if (!input.apply) {
      await client.query("ROLLBACK");
      return {
        applied: false,
        ...inspection,
        revokedPasswordSessions: 0,
        disabledLegacyCredentials: 0,
        clearedLegacyPrincipalCardIds: 0,
      };
    }

    const revoked = await client.query(
      `UPDATE human_sessions
       SET revoked_at = COALESCE(revoked_at, $2)
       WHERE principal_id = $1
         AND auth_method = 'password'
         AND revoked_at IS NULL`,
      [inspection.ownerPrincipalId, input.now],
    );
    const disabled = await client.query(
      `UPDATE human_credentials
       SET status = 'disabled', updated_at = $2
       WHERE principal_id = $1 AND status = 'active'`,
      [inspection.ownerPrincipalId, input.now],
    );
    const cleared = await client.query(
      `UPDATE principals
       SET ai_card_id = NULL, updated_at = $1
       WHERE ai_card_id IS NOT NULL`,
      [input.now],
    );
    await client.query("COMMIT");
    return {
      applied: true,
      ...inspection,
      revokedPasswordSessions: revoked.rowCount ?? 0,
      disabledLegacyCredentials: disabled.rowCount ?? 0,
      clearedLegacyPrincipalCardIds: cleared.rowCount ?? 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function parseApplyArgument(args: string[]): boolean {
  const unknown = args.filter((argument) => argument !== "--apply");
  if (unknown.length) {
    throw new AICardOwnerCutoverError(`Unknown argument: ${unknown[0]}`);
  }
  return args.includes("--apply");
}

async function main(): Promise<void> {
  const issuer = process.env.YOYOO_AICARD_ISSUER?.trim();
  const clientId = process.env.YOYOO_AICARD_CLIENT_ID?.trim();
  if (!issuer || !clientId) {
    throw new AICardOwnerCutoverError(
      "YOYOO_AICARD_ISSUER and YOYOO_AICARD_CLIENT_ID are required",
    );
  }
  const pool = createPostgresPool();
  try {
    const result = await finalizeAICardOwnerCutover(pool, {
      issuer,
      clientId,
      apply: parseApplyArgument(process.argv.slice(2)),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

const isEntrypoint = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "AI Card cutover failed"}\n`);
    process.exitCode = 1;
  });
}
