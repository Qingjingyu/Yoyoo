import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type {
  MembershipRole,
  MembershipStatus,
  PrincipalKind,
  WorkspaceMemberRecord,
  WorkspaceRecord,
} from "@/domain/collaboration";
import { withTransaction } from "@/server/postgres/transaction";

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  status: WorkspaceRecord["status"];
  created_at: Date;
  updated_at: Date;
}

interface WorkspaceMemberRow {
  workspace_id: string;
  principal_id: string;
  principal_kind: PrincipalKind;
  display_name: string;
  role: MembershipRole;
  status: MembershipStatus;
  joined_at: Date;
  updated_at: Date;
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

function mapMember(row: WorkspaceMemberRow): WorkspaceMemberRecord {
  return {
    workspaceId: row.workspace_id,
    principalId: row.principal_id,
    principalKind: row.principal_kind,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
  };
}

export class WorkspaceRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: {
    slug: string;
    name: string;
    ownerPrincipalId: string;
  }): Promise<WorkspaceRecord> {
    return withTransaction(this.pool, async (client) => {
      const owner = await client.query<{ id: string }>(
        `SELECT id FROM principals
         WHERE id = $1 AND kind = 'human' AND status = 'active'`,
        [input.ownerPrincipalId],
      );
      if (!owner.rows[0]) {
        throw new Error(`Principal ${input.ownerPrincipalId} is not an active human`);
      }
      const workspace = await client.query<WorkspaceRow>(
        `INSERT INTO workspaces (id, slug, name)
         VALUES ($1, $2, $3) RETURNING *`,
        [randomUUID(), input.slug, input.name],
      );
      await client.query(
        `INSERT INTO workspace_members (workspace_id, principal_id, role)
         VALUES ($1, $2, 'owner')`,
        [workspace.rows[0].id, input.ownerPrincipalId],
      );
      return mapWorkspace(workspace.rows[0]);
    });
  }

  async addMember(input: {
    workspaceId: string;
    principalId: string;
    role: MembershipRole;
  }): Promise<WorkspaceMemberRecord> {
    const result = await this.pool.query<WorkspaceMemberRow>(
      `WITH inserted AS (
         INSERT INTO workspace_members (workspace_id, principal_id, role)
         SELECT workspaces.id, principals.id, $3
         FROM workspaces CROSS JOIN principals
         WHERE workspaces.id = $1 AND workspaces.status = 'active'
           AND principals.id = $2 AND principals.status = 'active'
         ON CONFLICT (workspace_id, principal_id) DO UPDATE SET
           role = EXCLUDED.role, status = 'active', updated_at = NOW()
         RETURNING *
       )
       SELECT inserted.*, principals.kind AS principal_kind,
              principals.display_name
       FROM inserted JOIN principals ON principals.id = inserted.principal_id`,
      [input.workspaceId, input.principalId, input.role],
    );
    if (!result.rows[0]) {
      throw new Error("Workspace or active principal not found");
    }
    return mapMember(result.rows[0]);
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMemberRecord[]> {
    const result = await this.pool.query<WorkspaceMemberRow>(
      `SELECT workspace_members.*, principals.kind AS principal_kind,
              principals.display_name
       FROM workspace_members
       JOIN principals ON principals.id = workspace_members.principal_id
       WHERE workspace_members.workspace_id = $1
       ORDER BY workspace_members.joined_at, workspace_members.principal_id`,
      [workspaceId],
    );
    return result.rows.map(mapMember);
  }
}
