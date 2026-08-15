import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type {
  AgentGatewayAgentRecord,
  AgentGatewayConnectionStatus,
  AgentGatewayCredentialStatus,
  AgentGatewayJobRecord,
  AgentGatewayPermission,
  AgentGatewaySessionRecord,
} from "@/domain/collaboration";
import { withTransaction } from "@/server/postgres/transaction";

export const GATEWAY_ADAPTER_ID = "yoyoo-agent-gateway";
const CONNECTED_WINDOW_MS = 45_000;

interface GatewayAgentRow {
  principal_id: string;
  workspace_id: string;
  handle: string;
  display_name: string;
  credential_status: AgentGatewayCredentialStatus;
  token_hint: string;
  credential_version: number;
  last_seen_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface GatewaySessionRow {
  principal_id: string;
  workspace_id: string;
  handle: string;
  display_name: string;
  credential_version: number | null;
  capabilities: Record<string, unknown>;
}

interface GatewayJobRow {
  id: string;
  run_id: string;
  principal_id: string;
  request: Record<string, unknown>;
  status: AgentGatewayJobRecord["status"];
  lease_id: string | null;
  leased_at: Date | null;
  lease_expires_at: Date | null;
  result: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
}

export class AgentGatewayAuthorizationError extends Error {
  constructor(message = "The current principal cannot manage workspace Agents") {
    super(message);
    this.name = "AgentGatewayAuthorizationError";
  }
}

export class AgentGatewayConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentGatewayConflictError";
  }
}

function issueToken(): string {
  return `yya_${randomBytes(32).toString("base64url")}`;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function resultDigest(result: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(result), "utf8").digest("hex");
}

function connectionStatus(
  row: GatewayAgentRow,
  now = new Date(),
): AgentGatewayConnectionStatus {
  if (row.credential_status === "revoked") return "revoked";
  if (!row.last_seen_at) return "never_connected";
  return now.getTime() - row.last_seen_at.getTime() <= CONNECTED_WINDOW_MS
    ? "connected"
    : "offline";
}

function mapAgent(row: GatewayAgentRow, now?: Date): AgentGatewayAgentRecord {
  return {
    principalId: row.principal_id,
    workspaceId: row.workspace_id,
    handle: row.handle,
    displayName: row.display_name,
    credentialStatus: row.credential_status,
    connectionStatus: connectionStatus(row, now),
    tokenHint: row.token_hint,
    credentialVersion: row.credential_version,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSession(row: GatewaySessionRow): AgentGatewaySessionRecord {
  const configured = row.capabilities.permissions;
  const allowed = new Set<AgentGatewayPermission>([
    "message.read",
    "message.write",
    "attachment.read",
    "attachment.write",
  ]);
  const permissions = configured === undefined
    ? null
    : Array.isArray(configured)
      ? configured.filter((value): value is AgentGatewayPermission =>
          typeof value === "string" && allowed.has(value as AgentGatewayPermission))
      : [];
  return {
    principalId: row.principal_id,
    workspaceId: row.workspace_id,
    handle: row.handle,
    displayName: row.display_name,
    credentialVersion: row.credential_version,
    permissions,
  };
}

function mapJob(row: GatewayJobRow): AgentGatewayJobRecord {
  return {
    id: row.id,
    runId: row.run_id,
    principalId: row.principal_id,
    request: row.request,
    status: row.status,
    leaseId: row.lease_id,
    leasedAt: row.leased_at,
    leaseExpiresAt: row.lease_expires_at,
    result: row.result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

async function assertWorkspaceOwner(
  client: Pool | PoolClient,
  workspaceId: string,
  actorPrincipalId: string,
): Promise<void> {
  const owner = await client.query<{ workspace_id: string }>(
    `SELECT workspace_members.workspace_id
     FROM workspace_members
     JOIN workspaces ON workspaces.id = workspace_members.workspace_id
     JOIN principals ON principals.id = workspace_members.principal_id
     WHERE workspace_members.workspace_id = $1
       AND workspace_members.principal_id = $2
       AND workspace_members.role = 'owner'
       AND workspace_members.status = 'active'
       AND workspaces.status = 'active'
       AND principals.status = 'active'`,
    [workspaceId, actorPrincipalId],
  );
  if (!owner.rows[0]) throw new AgentGatewayAuthorizationError();
}

async function selectManagedAgent(
  client: Pool | PoolClient,
  workspaceId: string,
  principalId: string,
): Promise<GatewayAgentRow> {
  const result = await client.query<GatewayAgentRow>(
    `SELECT credentials.principal_id, credentials.workspace_id,
            principals.handle, principals.display_name,
            credentials.status AS credential_status, credentials.token_hint,
            credentials.version AS credential_version, credentials.last_seen_at,
            credentials.created_at, credentials.updated_at
     FROM agent_gateway_credentials AS credentials
     JOIN principals ON principals.id = credentials.principal_id
     WHERE credentials.workspace_id = $1 AND credentials.principal_id = $2`,
    [workspaceId, principalId],
  );
  if (!result.rows[0]) {
    throw new AgentGatewayAuthorizationError(
      "The Agent does not belong to the managed workspace",
    );
  }
  return result.rows[0];
}

export class AgentGatewayRepository {
  constructor(private readonly pool: Pool) {}

  async createAgent(input: {
    workspaceId: string;
    actorPrincipalId: string;
    handle: string;
    displayName: string;
  }): Promise<{ agent: AgentGatewayAgentRecord; token: string }> {
    const token = issueToken();
    const hash = tokenHash(token);
    const hint = token.slice(-8);
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `gateway-agent:${input.workspaceId}`,
      ]);
      await assertWorkspaceOwner(client, input.workspaceId, input.actorPrincipalId);

      const duplicateHandle = await client.query<{ principal_id: string }>(
        `SELECT workspace_members.principal_id
         FROM workspace_members
         JOIN principals ON principals.id = workspace_members.principal_id
         WHERE workspace_members.workspace_id = $1
           AND workspace_members.status = 'active'
           AND lower(principals.handle) = lower($2)
         LIMIT 1`,
        [input.workspaceId, input.handle],
      );
      if (duplicateHandle.rows[0]) {
        throw new AgentGatewayConflictError("The Agent handle is already in use");
      }

      const principalId = randomUUID();
      await client.query(
        `INSERT INTO principals
          (id, kind, external_key, handle, display_name)
         VALUES ($1, 'agent', $2, $3, $4)`,
        [
          principalId,
          `agent:gateway:${principalId}`,
          input.handle,
          input.displayName,
        ],
      );
      await client.query(
        `INSERT INTO workspace_members (workspace_id, principal_id, role)
         VALUES ($1, $2, 'member')`,
        [input.workspaceId, principalId],
      );
      await client.query(
        `INSERT INTO agent_bindings
          (principal_id, adapter_id, capabilities, status)
         VALUES ($1, $2, $3::jsonb, 'enabled')`,
        [
          principalId,
          GATEWAY_ADAPTER_ID,
          JSON.stringify({
            streaming: false,
            cancellation: false,
            delegation: false,
            artifacts: false,
            attachments: true,
          }),
        ],
      );
      const credential = await client.query<GatewayAgentRow>(
        `WITH inserted AS (
           INSERT INTO agent_gateway_credentials
             (principal_id, workspace_id, token_hash, token_hint)
           VALUES ($1, $2, $3, $4)
           RETURNING *
         )
         SELECT inserted.principal_id, inserted.workspace_id,
                principals.handle, principals.display_name,
                inserted.status AS credential_status, inserted.token_hint,
                inserted.version AS credential_version, inserted.last_seen_at,
                inserted.created_at, inserted.updated_at
         FROM inserted
         JOIN principals ON principals.id = inserted.principal_id`,
        [principalId, input.workspaceId, hash, hint],
      );
      return { agent: mapAgent(credential.rows[0]), token };
    });
  }

  async authenticate(token: string): Promise<AgentGatewaySessionRecord | null> {
    if (!/^yya_[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const result = await this.pool.query<GatewaySessionRow>(
      `SELECT credentials.principal_id, credentials.workspace_id,
              principals.handle, principals.display_name,
              credentials.version AS credential_version,
              agent_bindings.capabilities
       FROM agent_gateway_credentials AS credentials
       JOIN principals ON principals.id = credentials.principal_id
       JOIN workspace_members
         ON workspace_members.workspace_id = credentials.workspace_id
        AND workspace_members.principal_id = credentials.principal_id
       JOIN workspaces ON workspaces.id = credentials.workspace_id
       JOIN agent_bindings ON agent_bindings.principal_id = credentials.principal_id
       WHERE credentials.token_hash = $1
         AND credentials.status = 'active'
         AND principals.status = 'active'
         AND workspace_members.status = 'active'
         AND workspaces.status = 'active'
         AND agent_bindings.status = 'enabled'
         AND agent_bindings.adapter_id = $2`,
      [tokenHash(token), GATEWAY_ADAPTER_ID],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async authenticateAICardRuntime(input: {
    issuer: string;
    clientId: string;
    subject: string;
    nodeId: string;
    expiresAt: Date;
  }): Promise<AgentGatewaySessionRecord | null> {
    const now = new Date();
    if (input.expiresAt.getTime() <= now.getTime()) return null;
    const result = await this.pool.query<GatewaySessionRow>(
      `WITH candidates AS (
         SELECT mappings.principal_id, members.workspace_id,
                principals.handle, principals.display_name,
                agent_bindings.capabilities
         FROM aicard_identity_mappings AS mappings
         JOIN principals ON principals.id = mappings.principal_id
         JOIN workspace_members AS members
           ON members.principal_id = principals.id
         JOIN workspaces ON workspaces.id = members.workspace_id
         JOIN agent_bindings ON agent_bindings.principal_id = principals.id
         WHERE mappings.issuer = $1
           AND mappings.client_id = $2
           AND mappings.subject = $3
           AND principals.kind = 'agent'
           AND principals.status = 'active'
           AND members.status = 'active'
           AND workspaces.status = 'active'
           AND agent_bindings.adapter_id = $7
           AND agent_bindings.status = 'enabled'
       ),
       resolved AS (
         SELECT * FROM candidates
         WHERE (SELECT COUNT(*) FROM candidates) = 1
       ),
       upserted AS (
         INSERT INTO agent_gateway_runtime_presence
           (principal_id, workspace_id, issuer, client_id, subject, node_id,
            session_expires_at, last_seen_at, created_at, updated_at)
         SELECT principal_id, workspace_id, $1, $2, $3, $4,
                $5::timestamptz, $6::timestamptz,
                $6::timestamptz, $6::timestamptz
         FROM resolved
         ON CONFLICT (principal_id) DO UPDATE SET
           workspace_id = EXCLUDED.workspace_id,
           issuer = EXCLUDED.issuer,
           client_id = EXCLUDED.client_id,
           subject = EXCLUDED.subject,
           node_id = EXCLUDED.node_id,
           session_expires_at = EXCLUDED.session_expires_at,
           last_seen_at = EXCLUDED.last_seen_at,
           updated_at = EXCLUDED.updated_at
         RETURNING principal_id
       )
       SELECT resolved.principal_id, resolved.workspace_id,
              resolved.handle, resolved.display_name,
              NULL::integer AS credential_version,
              resolved.capabilities
       FROM resolved
       JOIN upserted ON upserted.principal_id = resolved.principal_id`,
      [
        input.issuer,
        input.clientId,
        input.subject,
        input.nodeId,
        input.expiresAt,
        now,
        GATEWAY_ADAPTER_ID,
      ],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async listAgents(input: {
    workspaceId: string;
    actorPrincipalId: string;
    now?: Date;
  }): Promise<AgentGatewayAgentRecord[]> {
    await assertWorkspaceOwner(this.pool, input.workspaceId, input.actorPrincipalId);
    const result = await this.pool.query<GatewayAgentRow>(
      `SELECT credentials.principal_id, credentials.workspace_id,
              principals.handle, principals.display_name,
              credentials.status AS credential_status, credentials.token_hint,
              credentials.version AS credential_version, credentials.last_seen_at,
              credentials.created_at, credentials.updated_at
       FROM agent_gateway_credentials AS credentials
       JOIN principals ON principals.id = credentials.principal_id
       WHERE credentials.workspace_id = $1
       ORDER BY credentials.created_at, credentials.principal_id`,
      [input.workspaceId],
    );
    return result.rows.map((row) => mapAgent(row, input.now));
  }

  async heartbeat(
    principalId: string,
    now = new Date(),
  ): Promise<AgentGatewayAgentRecord> {
    const result = await this.pool.query<GatewayAgentRow>(
      `WITH updated AS (
         UPDATE agent_gateway_credentials
         SET last_seen_at = $2, updated_at = $2
         WHERE principal_id = $1 AND status = 'active'
         RETURNING *
       )
       SELECT updated.principal_id, updated.workspace_id,
              principals.handle, principals.display_name,
              updated.status AS credential_status, updated.token_hint,
              updated.version AS credential_version, updated.last_seen_at,
              updated.created_at, updated.updated_at
       FROM updated
       JOIN principals ON principals.id = updated.principal_id`,
      [principalId, now],
    );
    if (!result.rows[0]) {
      throw new AgentGatewayAuthorizationError("The Agent credential is not active");
    }
    return mapAgent(result.rows[0], now);
  }

  async rotateCredential(input: {
    workspaceId: string;
    actorPrincipalId: string;
    principalId: string;
  }): Promise<{ agent: AgentGatewayAgentRecord; token: string }> {
    const token = issueToken();
    return withTransaction(this.pool, async (client) => {
      await assertWorkspaceOwner(client, input.workspaceId, input.actorPrincipalId);
      await selectManagedAgent(client, input.workspaceId, input.principalId);
      const result = await client.query<GatewayAgentRow>(
        `WITH updated AS (
           UPDATE agent_gateway_credentials
           SET token_hash = $3, token_hint = $4, status = 'active',
               version = version + 1, last_seen_at = NULL,
               revoked_at = NULL, updated_at = NOW()
           WHERE workspace_id = $1 AND principal_id = $2
           RETURNING *
         )
         SELECT updated.principal_id, updated.workspace_id,
                principals.handle, principals.display_name,
                updated.status AS credential_status, updated.token_hint,
                updated.version AS credential_version, updated.last_seen_at,
                updated.created_at, updated.updated_at
         FROM updated
         JOIN principals ON principals.id = updated.principal_id`,
        [input.workspaceId, input.principalId, tokenHash(token), token.slice(-8)],
      );
      await client.query(
        `UPDATE agent_bindings SET status = 'enabled', updated_at = NOW()
         WHERE principal_id = $1 AND adapter_id = $2`,
        [input.principalId, GATEWAY_ADAPTER_ID],
      );
      return { agent: mapAgent(result.rows[0]), token };
    });
  }

  async revokeCredential(input: {
    workspaceId: string;
    actorPrincipalId: string;
    principalId: string;
  }): Promise<AgentGatewayAgentRecord> {
    return withTransaction(this.pool, async (client) => {
      await assertWorkspaceOwner(client, input.workspaceId, input.actorPrincipalId);
      await selectManagedAgent(client, input.workspaceId, input.principalId);
      const result = await client.query<GatewayAgentRow>(
        `WITH updated AS (
           UPDATE agent_gateway_credentials
           SET status = 'revoked', revoked_at = COALESCE(revoked_at, NOW()),
               updated_at = NOW()
           WHERE workspace_id = $1 AND principal_id = $2
           RETURNING *
         )
         SELECT updated.principal_id, updated.workspace_id,
                principals.handle, principals.display_name,
                updated.status AS credential_status, updated.token_hint,
                updated.version AS credential_version, updated.last_seen_at,
                updated.created_at, updated.updated_at
         FROM updated
         JOIN principals ON principals.id = updated.principal_id`,
        [input.workspaceId, input.principalId],
      );
      await client.query(
        `UPDATE agent_bindings SET status = 'disabled', updated_at = NOW()
         WHERE principal_id = $1 AND adapter_id = $2`,
        [input.principalId, GATEWAY_ADAPTER_ID],
      );
      return mapAgent(result.rows[0]);
    });
  }

  async enqueueJob(input: {
    runId: string;
    request: Record<string, unknown>;
  }): Promise<AgentGatewayJobRecord> {
    const result = await this.pool.query<GatewayJobRow>(
      `INSERT INTO agent_gateway_jobs (id, run_id, principal_id, request)
       SELECT $1, room_runs.id, room_runs.target_agent_principal_id, $3::jsonb
       FROM room_runs
       JOIN agent_bindings
         ON agent_bindings.principal_id = room_runs.target_agent_principal_id
       WHERE room_runs.id = $2
         AND room_runs.adapter_id = $4
         AND agent_bindings.adapter_id = $4
         AND agent_bindings.status = 'enabled'
       ON CONFLICT (run_id) DO UPDATE SET updated_at = agent_gateway_jobs.updated_at
       RETURNING agent_gateway_jobs.*`,
      [randomUUID(), input.runId, JSON.stringify(input.request), GATEWAY_ADAPTER_ID],
    );
    if (!result.rows[0]) {
      throw new AgentGatewayAuthorizationError(
        "The run is not assigned to an active Gateway Agent",
      );
    }
    return mapJob(result.rows[0]);
  }

  async getJobByRunId(runId: string): Promise<AgentGatewayJobRecord | null> {
    const result = await this.pool.query<GatewayJobRow>(
      "SELECT * FROM agent_gateway_jobs WHERE run_id = $1",
      [runId],
    );
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  }

  async claimJob(input: {
    principalId: string;
    now?: Date;
    leaseMs?: number;
  }): Promise<AgentGatewayJobRecord | null> {
    const now = input.now ?? new Date();
    const leaseMs = Math.min(Math.max(input.leaseMs ?? 30_000, 1_000), 120_000);
    return withTransaction(this.pool, async (client) => {
      const candidate = await client.query<{ id: string }>(
        `SELECT jobs.id
         FROM agent_gateway_jobs AS jobs
         LEFT JOIN agent_gateway_credentials AS credentials
           ON credentials.principal_id = jobs.principal_id
         LEFT JOIN agent_gateway_runtime_presence AS runtime_presence
           ON runtime_presence.principal_id = jobs.principal_id
         JOIN agent_bindings ON agent_bindings.principal_id = jobs.principal_id
         WHERE jobs.principal_id = $1
           AND (
             credentials.status = 'active'
             OR (
               runtime_presence.session_expires_at > $3
               AND runtime_presence.last_seen_at > $3::timestamptz
                 - ($4::double precision * INTERVAL '1 millisecond')
             )
           )
           AND agent_bindings.status = 'enabled'
           AND agent_bindings.adapter_id = $2
           AND NOT EXISTS (
             SELECT 1
             FROM agent_gateway_jobs AS active_jobs
             WHERE active_jobs.principal_id = jobs.principal_id
               AND active_jobs.status = 'leased'
               AND active_jobs.lease_expires_at > $3
           )
           AND (jobs.status = 'queued'
             OR (jobs.status = 'leased' AND jobs.lease_expires_at <= $3))
         ORDER BY jobs.created_at, jobs.id
         FOR UPDATE OF jobs SKIP LOCKED
         LIMIT 1`,
        [input.principalId, GATEWAY_ADAPTER_ID, now, CONNECTED_WINDOW_MS],
      );
      if (!candidate.rows[0]) return null;
      const leaseId = randomUUID();
      const result = await client.query<GatewayJobRow>(
        `UPDATE agent_gateway_jobs
         SET status = 'leased', lease_id = $2, leased_at = $3::timestamptz,
             lease_expires_at = $3::timestamptz
               + ($4::double precision * INTERVAL '1 millisecond'),
             updated_at = $3::timestamptz
         WHERE id = $1 RETURNING *`,
        [candidate.rows[0].id, leaseId, now, leaseMs],
      );
      return mapJob(result.rows[0]);
    });
  }

  async settleJob(input: {
    principalId: string;
    jobId: string;
    leaseId: string;
    result: Record<string, unknown>;
    now?: Date;
  }): Promise<{ duplicate: boolean; job: AgentGatewayJobRecord }> {
    const digest = resultDigest(input.result);
    const now = input.now ?? new Date();
    return withTransaction(this.pool, async (client) => {
      const existing = await client.query<GatewayJobRow & { result_digest: string | null }>(
        "SELECT * FROM agent_gateway_jobs WHERE id = $1 FOR UPDATE",
        [input.jobId],
      );
      const job = existing.rows[0];
      if (!job || job.principal_id !== input.principalId) {
        throw new AgentGatewayAuthorizationError(
          "The job is not assigned to the authenticated Agent",
        );
      }
      if (job.status === "completed" || job.status === "failed") {
        if (job.lease_id === input.leaseId && job.result_digest === digest) {
          return { duplicate: true, job: mapJob(job) };
        }
        throw new AgentGatewayConflictError("The job already has a different result");
      }
      if (
        job.status !== "leased" ||
        job.lease_id !== input.leaseId ||
        !job.lease_expires_at ||
        job.lease_expires_at <= now
      ) {
        throw new AgentGatewayConflictError("The job lease is no longer valid");
      }
      const status = input.result.type === "failed" ? "failed" : "completed";
      const updated = await client.query<GatewayJobRow>(
        `UPDATE agent_gateway_jobs
         SET status = $2, result = $3::jsonb, result_digest = $4,
             finished_at = $5::timestamptz, updated_at = $5::timestamptz
         WHERE id = $1 RETURNING *`,
        [input.jobId, status, JSON.stringify(input.result), digest, now],
      );
      return { duplicate: false, job: mapJob(updated.rows[0]) };
    });
  }
}
