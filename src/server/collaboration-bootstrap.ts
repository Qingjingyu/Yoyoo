import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type {
  AgentBindingRecord,
  PrincipalRecord,
  WorkspaceRecord,
  RoomRecord,
} from "@/domain/collaboration";
import { withTransaction } from "@/server/postgres/transaction";

export interface CollaborationAgentSeed {
  adapterId: string;
  displayName: string;
  handle: string;
  capabilities: Record<string, unknown>;
  externalKey?: string;
}

export interface CollaborationBootstrap {
  principal: PrincipalRecord;
  workspace: WorkspaceRecord;
  room: RoomRecord;
  agents: Array<{
    principal: PrincipalRecord;
    binding: AgentBindingRecord;
  }>;
}

interface PrincipalRow {
  id: string;
  kind: PrincipalRecord["kind"];
  external_key: string;
  handle: string;
  display_name: string;
  status: PrincipalRecord["status"];
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  status: WorkspaceRecord["status"];
  created_at: Date;
  updated_at: Date;
}

interface RoomRow {
  id: string;
  workspace_id: string;
  legacy_conversation_id: string | null;
  name: string;
  purpose: string;
  kind: RoomRecord["kind"];
  direct_human_principal_id: string | null;
  direct_agent_principal_id: string | null;
  status: RoomRecord["status"];
  created_by_principal_id: string;
  created_at: Date;
  updated_at: Date;
}

interface BindingRow {
  principal_id: string;
  adapter_id: string;
  config_key: string | null;
  capabilities: Record<string, unknown>;
  status: AgentBindingRecord["status"];
  created_at: Date;
  updated_at: Date;
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

function mapWorkspace(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRoom(row: RoomRow): RoomRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    legacyConversationId: row.legacy_conversation_id,
    name: row.name,
    purpose: row.purpose,
    kind: row.kind,
    directHumanPrincipalId: row.direct_human_principal_id,
    directAgentPrincipalId: row.direct_agent_principal_id,
    status: row.status,
    createdByPrincipalId: row.created_by_principal_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBinding(row: BindingRow): AgentBindingRecord {
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

function localSlug(ownerId: string): string {
  const digest = createHash("sha256").update(ownerId).digest("hex").slice(0, 24);
  return `local-${digest}`;
}

export async function bootstrapLocalCollaboration(
  pool: Pool,
  ownerId: string,
  agentSeeds: CollaborationAgentSeed[],
): Promise<CollaborationBootstrap> {
  return withTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `local-collaboration:${ownerId}`,
    ]);
    const owner = await client.query<PrincipalRow>(
      `INSERT INTO principals
        (id, kind, external_key, handle, display_name)
       VALUES ($1, 'human', $2, $3, 'Su Bai')
       ON CONFLICT (external_key) DO UPDATE SET
         display_name = EXCLUDED.display_name, status = 'active', updated_at = NOW()
       RETURNING *`,
      [randomUUID(), `human:${ownerId}`, ownerId.slice(0, 80)],
    );
    const workspace = await client.query<WorkspaceRow>(
      `INSERT INTO workspaces (id, slug, name)
       VALUES ($1, $2, 'Yoyoo Space')
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name, status = 'active', updated_at = NOW()
       RETURNING *`,
      [randomUUID(), localSlug(ownerId)],
    );
    await client.query(
      `INSERT INTO workspace_members (workspace_id, principal_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (workspace_id, principal_id) DO UPDATE SET
         role = 'owner', status = 'active', updated_at = NOW()`,
      [workspace.rows[0].id, owner.rows[0].id],
    );
    const existingRoom = await client.query<RoomRow>(
      `SELECT * FROM rooms
       WHERE workspace_id = $1 AND status = 'active'
       ORDER BY created_at LIMIT 1`,
      [workspace.rows[0].id],
    );
    const room = existingRoom.rows[0]
      ? existingRoom
      : await client.query<RoomRow>(
          `INSERT INTO rooms
            (id, workspace_id, name, created_by_principal_id)
           VALUES ($1, $2, '协作室', $3) RETURNING *`,
          [randomUUID(), workspace.rows[0].id, owner.rows[0].id],
        );
    await client.query(
      `INSERT INTO room_members
        (room_id, principal_id, role, listener_policy)
       VALUES ($1, $2, 'owner', 'always')
       ON CONFLICT (room_id, principal_id) DO UPDATE SET
         role = 'owner', listener_policy = 'always', status = 'active', updated_at = NOW()`,
      [room.rows[0].id, owner.rows[0].id],
    );

    const agents: CollaborationBootstrap["agents"] = [];
    for (const seed of agentSeeds) {
      const principal = await client.query<PrincipalRow>(
        `INSERT INTO principals
          (id, kind, external_key, handle, display_name)
         VALUES ($1, 'agent', $2, $3, $4)
         ON CONFLICT (external_key) DO UPDATE SET
           handle = EXCLUDED.handle,
           display_name = EXCLUDED.display_name,
           status = 'active',
           updated_at = NOW()
         RETURNING *`,
        [
          randomUUID(),
          seed.externalKey ?? `agent:${seed.adapterId}`,
          seed.handle,
          seed.displayName,
        ],
      );
      const binding = await client.query<BindingRow>(
        `INSERT INTO agent_bindings
          (principal_id, adapter_id, capabilities, status)
         VALUES ($1, $2, $3::jsonb, 'enabled')
         ON CONFLICT (principal_id) DO UPDATE SET
           adapter_id = EXCLUDED.adapter_id,
           capabilities = EXCLUDED.capabilities,
           status = 'enabled',
           updated_at = NOW()
         RETURNING *`,
        [principal.rows[0].id, seed.adapterId, JSON.stringify(seed.capabilities)],
      );
      await client.query(
        `INSERT INTO workspace_members (workspace_id, principal_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT (workspace_id, principal_id) DO UPDATE SET
           role = 'member', status = 'active', updated_at = NOW()`,
        [workspace.rows[0].id, principal.rows[0].id],
      );
      await client.query(
        `INSERT INTO room_members
          (room_id, principal_id, role, listener_policy)
         VALUES ($1, $2, 'member', 'mention_only')
         ON CONFLICT (room_id, principal_id) DO UPDATE SET
           role = 'member', listener_policy = 'mention_only',
           status = 'active', updated_at = NOW()`,
        [room.rows[0].id, principal.rows[0].id],
      );
      agents.push({
        principal: mapPrincipal(principal.rows[0]),
        binding: mapBinding(binding.rows[0]),
      });
    }
    return {
      principal: mapPrincipal(owner.rows[0]),
      workspace: mapWorkspace(workspace.rows[0]),
      room: mapRoom(room.rows[0]),
      agents,
    };
  });
}
