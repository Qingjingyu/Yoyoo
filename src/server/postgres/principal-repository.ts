import { createHash, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type {
  AgentBindingRecord,
  PrincipalKind,
  PrincipalRecord,
} from "@/domain/collaboration";
import { GATEWAY_ADAPTER_ID } from "@/server/postgres/agent-gateway-repository";
import { withTransaction } from "@/server/postgres/transaction";

const CONNECTED_WINDOW_MS = 45_000;

interface PrincipalRow {
  id: string;
  kind: PrincipalKind;
  external_key: string;
  handle: string;
  display_name: string;
  status: PrincipalRecord["status"];
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

interface AgentBindingRow {
  principal_id: string;
  adapter_id: string;
  config_key: string | null;
  capabilities: Record<string, unknown>;
  status: AgentBindingRecord["status"];
  created_at: Date;
  updated_at: Date;
}

interface AICardMappingRow {
  issuer: string;
  client_id: string;
  subject: string;
  principal_id: string;
  created_at: Date;
  updated_at: Date;
  last_verified_at: Date;
}

export interface AICardIdentityMappingRecord {
  issuer: string;
  clientId: string;
  subject: string;
  principalId: string;
  createdAt: Date;
  updatedAt: Date;
  lastVerifiedAt: Date;
}

export interface AICardAgentDirectoryRecord {
  principalId: string;
  workspaceId: string;
  handle: string;
  displayName: string;
  authenticationMode: "aicard";
  credentialStatus: null;
  connectionStatus: "never_connected" | "connected" | "offline";
  tokenHint: null;
  credentialVersion: null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class AICardIdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AICardIdentityConflictError";
  }
}

function mapPrincipal(row: PrincipalRow): PrincipalRecord {
  return {
    id: row.id,
    kind: row.kind,
    externalKey: row.external_key,
    handle: row.handle,
    displayName: row.display_name,
    status: row.status,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentBinding(row: AgentBindingRow): AgentBindingRecord {
  return {
    principalId: row.principal_id,
    adapterId: row.adapter_id,
    configKey: row.config_key,
    capabilities: row.capabilities,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAICardMapping(row: AICardMappingRow): AICardIdentityMappingRecord {
  return {
    issuer: row.issuer,
    clientId: row.client_id,
    subject: row.subject,
    principalId: row.principal_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastVerifiedAt: row.last_verified_at,
  };
}

async function selectAICardMapping(
  client: Pool | PoolClient,
  input: { issuer: string; clientId: string; subject: string },
): Promise<{ mapping: AICardMappingRow; principal: PrincipalRow } | null> {
  const result = await client.query<AICardMappingRow & PrincipalRow>(
    `SELECT mappings.issuer, mappings.client_id, mappings.subject,
            mappings.principal_id, mappings.created_at,
            mappings.updated_at, mappings.last_verified_at,
            principals.id, principals.kind, principals.external_key,
            principals.handle, principals.display_name, principals.status,
            principals.metadata, principals.created_at AS principal_created_at,
            principals.updated_at AS principal_updated_at
     FROM aicard_identity_mappings AS mappings
     JOIN principals ON principals.id = mappings.principal_id
     WHERE mappings.issuer = $1
       AND mappings.client_id = $2
       AND mappings.subject = $3`,
    [input.issuer, input.clientId, input.subject],
  );
  const row = result.rows[0] as (AICardMappingRow & PrincipalRow & {
    principal_created_at: Date;
    principal_updated_at: Date;
  }) | undefined;
  if (!row) return null;
  return {
    mapping: row,
    principal: {
      id: row.id,
      kind: row.kind,
      external_key: row.external_key,
      handle: row.handle,
      display_name: row.display_name,
      status: row.status,
      metadata: row.metadata,
      created_at: row.principal_created_at,
      updated_at: row.principal_updated_at,
    },
  };
}

async function activateAICardAgentMembership(
  client: PoolClient,
  workspaceId: string,
  principalId: string,
): Promise<void> {
  const result = await client.query(
    `INSERT INTO workspace_members (workspace_id, principal_id, role)
     SELECT workspaces.id, principals.id, 'member'
     FROM workspaces CROSS JOIN principals
     WHERE workspaces.id = $1
       AND workspaces.status = 'active'
       AND principals.id = $2
       AND principals.kind = 'agent'
       AND principals.status = 'active'
     ON CONFLICT (workspace_id, principal_id) DO UPDATE SET
       role = 'member', status = 'active', updated_at = NOW()
     RETURNING principal_id`,
    [workspaceId, principalId],
  );
  if (result.rowCount !== 1) {
    throw new AICardIdentityConflictError(
      'The AI Card Agent cannot join the requested workspace',
    );
  }
  await client.query(
    `INSERT INTO agent_bindings
      (principal_id, adapter_id, capabilities, status)
     VALUES ($1, $2, $3::jsonb, 'enabled')
     ON CONFLICT (principal_id) DO UPDATE SET
       adapter_id = EXCLUDED.adapter_id,
       config_key = NULL,
       capabilities = EXCLUDED.capabilities,
       status = 'enabled',
       updated_at = NOW()`,
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
}

function aicardConnectionStatus(
  lastSeenAt: Date | null,
  sessionExpiresAt: Date | null,
  now = new Date(),
): AICardAgentDirectoryRecord["connectionStatus"] {
  if (!lastSeenAt) return "never_connected";
  if (
    !sessionExpiresAt
    || sessionExpiresAt.getTime() <= now.getTime()
    || now.getTime() - lastSeenAt.getTime() > CONNECTED_WINDOW_MS
  ) {
    return "offline";
  }
  return "connected";
}

export class PrincipalRepository {
  constructor(private readonly pool: Pool) {}

  async listAICardAgents(
    workspaceId: string,
  ): Promise<AICardAgentDirectoryRecord[]> {
    const result = await this.pool.query<{
      principal_id: string;
      workspace_id: string;
      handle: string;
      display_name: string;
      last_seen_at: Date | null;
      session_expires_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT DISTINCT ON (principals.id)
              principals.id AS principal_id,
              members.workspace_id,
              principals.handle,
              principals.display_name,
              presence.last_seen_at,
              presence.session_expires_at,
              principals.created_at,
              GREATEST(
                principals.updated_at,
                mappings.updated_at,
                members.updated_at,
                COALESCE(presence.updated_at, principals.updated_at)
              )
                AS updated_at
       FROM workspace_members AS members
       JOIN principals ON principals.id = members.principal_id
       JOIN aicard_identity_mappings AS mappings
         ON mappings.principal_id = principals.id
       LEFT JOIN agent_gateway_credentials AS credentials
         ON credentials.principal_id = principals.id
        AND credentials.workspace_id = members.workspace_id
       LEFT JOIN agent_gateway_runtime_presence AS presence
         ON presence.principal_id = principals.id
        AND presence.workspace_id = members.workspace_id
       WHERE members.workspace_id = $1
         AND members.status = 'active'
         AND principals.kind = 'agent'
         AND principals.status = 'active'
         AND credentials.principal_id IS NULL
       ORDER BY principals.id, mappings.updated_at DESC`,
      [workspaceId],
    );
    return result.rows.map((row) => ({
      principalId: row.principal_id,
      workspaceId: row.workspace_id,
      handle: row.handle,
      displayName: row.display_name,
      authenticationMode: "aicard",
      credentialStatus: null,
      connectionStatus: aicardConnectionStatus(
        row.last_seen_at,
        row.session_expires_at,
      ),
      tokenHint: null,
      credentialVersion: null,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async create(input: {
    kind: PrincipalKind;
    externalKey: string;
    handle: string;
    displayName: string;
    metadata?: Record<string, unknown>;
  }): Promise<PrincipalRecord> {
    const result = await this.pool.query<PrincipalRow>(
      `INSERT INTO principals
        (id, kind, external_key, handle, display_name, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING *`,
      [
        randomUUID(),
        input.kind,
        input.externalKey,
        input.handle,
        input.displayName,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapPrincipal(result.rows[0]);
  }

  async get(principalId: string): Promise<PrincipalRecord> {
    const result = await this.pool.query<PrincipalRow>(
      "SELECT * FROM principals WHERE id = $1",
      [principalId],
    );
    if (!result.rows[0]) throw new Error(`Unknown principal: ${principalId}`);
    return mapPrincipal(result.rows[0]);
  }

  async getByExternalKey(externalKey: string): Promise<PrincipalRecord | null> {
    const result = await this.pool.query<PrincipalRow>(
      "SELECT * FROM principals WHERE external_key = $1",
      [externalKey],
    );
    return result.rows[0] ? mapPrincipal(result.rows[0]) : null;
  }

  async mapAICardIdentity(input: {
    issuer: string;
    clientId: string;
    subject: string;
    principalType: "human" | "ai";
    displayName: string;
    handle: string;
    principalId?: string;
    workspaceId?: string;
  }): Promise<{
    created: boolean;
    principal: PrincipalRecord;
    mapping: AICardIdentityMappingRecord;
  }> {
    return withTransaction(this.pool, async (client) => {
      if (input.workspaceId && input.principalType !== 'ai') {
        throw new AICardIdentityConflictError(
          'Only AI Card Agents can receive an Agent workspace membership',
        );
      }
      const lockKey = JSON.stringify([input.issuer, input.clientId, input.subject]);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey]);
      const expectedKind: PrincipalKind = input.principalType === "ai" ? "agent" : "human";
      const existing = await selectAICardMapping(client, input);

      if (existing) {
        if (existing.principal.kind !== expectedKind) {
          throw new AICardIdentityConflictError(
            "AI Card principal type conflicts with the existing Yoyoo identity",
          );
        }
        const principalResult = await client.query<PrincipalRow>(
          `UPDATE principals
           SET handle = $2, display_name = $3, updated_at = NOW()
           WHERE id = $1 AND status = 'active'
           RETURNING *`,
          [existing.principal.id, input.handle, input.displayName],
        );
        if (!principalResult.rows[0]) {
          throw new AICardIdentityConflictError(
            "The mapped Yoyoo identity is not active",
          );
        }
        const mappingResult = await client.query<AICardMappingRow>(
          `UPDATE aicard_identity_mappings
           SET updated_at = NOW(), last_verified_at = NOW()
           WHERE issuer = $1 AND client_id = $2 AND subject = $3
           RETURNING *`,
          [input.issuer, input.clientId, input.subject],
        );
        if (input.workspaceId) {
          await activateAICardAgentMembership(client, input.workspaceId, existing.principal.id);
        }
        return {
          created: false,
          principal: mapPrincipal(principalResult.rows[0]),
          mapping: mapAICardMapping(mappingResult.rows[0]),
        };
      }

      if (input.principalId) {
        const principalResult = await client.query<PrincipalRow>(
          `UPDATE principals
           SET handle = $2, display_name = $3, updated_at = NOW()
           WHERE id = $1 AND kind = $4 AND status = 'active'
           RETURNING *`,
          [input.principalId, input.handle, input.displayName, expectedKind],
        );
        if (!principalResult.rows[0]) {
          throw new AICardIdentityConflictError(
            "The requested local Yoyoo identity cannot be linked to this AI Card",
          );
        }
        try {
          const mappingResult = await client.query<AICardMappingRow>(
            `INSERT INTO aicard_identity_mappings
              (issuer, client_id, subject, principal_id)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [input.issuer, input.clientId, input.subject, input.principalId],
          );
          if (input.workspaceId) {
            await activateAICardAgentMembership(client, input.workspaceId, input.principalId);
          }
          return {
            created: false,
            principal: mapPrincipal(principalResult.rows[0]),
            mapping: mapAICardMapping(mappingResult.rows[0]),
          };
        } catch (error) {
          if ((error as { code?: string }).code === "23505") {
            throw new AICardIdentityConflictError(
              "The local Yoyoo identity is already linked to another AI Card",
            );
          }
          throw error;
        }
      }

      const principalId = randomUUID();
      const identityDigest = createHash("sha256")
        .update(lockKey, "utf8")
        .digest("hex");
      const principalResult = await client.query<PrincipalRow>(
        `INSERT INTO principals
          (id, kind, external_key, handle, display_name, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING *`,
        [
          principalId,
          expectedKind,
          `aicard:${identityDigest}`,
          input.handle,
          input.displayName,
          JSON.stringify({ identityProvider: "aicard" }),
        ],
      );
      const mappingResult = await client.query<AICardMappingRow>(
        `INSERT INTO aicard_identity_mappings
          (issuer, client_id, subject, principal_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [input.issuer, input.clientId, input.subject, principalId],
      );
      if (input.workspaceId) {
        await activateAICardAgentMembership(client, input.workspaceId, principalId);
      }
      return {
        created: true,
        principal: mapPrincipal(principalResult.rows[0]),
        mapping: mapAICardMapping(mappingResult.rows[0]),
      };
    });
  }

  async bindAgent(input: {
    principalId: string;
    adapterId: string;
    configKey?: string | null;
    capabilities?: Record<string, unknown>;
    status?: AgentBindingRecord["status"];
  }): Promise<AgentBindingRecord> {
    const result = await this.pool.query<AgentBindingRow>(
      `INSERT INTO agent_bindings
        (principal_id, adapter_id, config_key, capabilities, status)
       SELECT id, $2, $3, $4::jsonb, $5
       FROM principals
       WHERE id = $1 AND kind = 'agent' AND status = 'active'
       ON CONFLICT (principal_id) DO UPDATE SET
         adapter_id = EXCLUDED.adapter_id,
         config_key = EXCLUDED.config_key,
         capabilities = EXCLUDED.capabilities,
         status = EXCLUDED.status,
         updated_at = NOW()
       RETURNING *`,
      [
        input.principalId,
        input.adapterId,
        input.configKey ?? null,
        JSON.stringify(input.capabilities ?? {}),
        input.status ?? "enabled",
      ],
    );
    if (!result.rows[0]) {
      throw new Error(`Principal ${input.principalId} is not an active Agent`);
    }
    return mapAgentBinding(result.rows[0]);
  }

  async getAgentBinding(principalId: string): Promise<AgentBindingRecord> {
    const result = await this.pool.query<AgentBindingRow>(
      "SELECT * FROM agent_bindings WHERE principal_id = $1",
      [principalId],
    );
    if (!result.rows[0]) throw new Error(`Agent binding not found: ${principalId}`);
    return mapAgentBinding(result.rows[0]);
  }
}
