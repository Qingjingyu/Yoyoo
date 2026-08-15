import { createHash, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { GATEWAY_ADAPTER_ID } from "@/server/postgres/agent-gateway-repository";
import { withTransaction } from "@/server/postgres/transaction";

export type AgentAdmissionPermission =
  | "message.read"
  | "message.write"
  | "attachment.read"
  | "attachment.write";

export class AgentAdmissionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentAdmissionConflictError";
  }
}

export interface AgentAdmissionResult {
  invitationId: string;
  principalId: string;
  cardId: string;
  displayName: string;
  handle: string;
  nodeId: string;
  roomIds: string[];
  permissions: AgentAdmissionPermission[];
  status: "admitted";
}

export interface AgentAdmissionInvitationRecord {
  invitationId: string;
  displayName: string;
  machineName: string | null;
  roomIds: string[];
  permissions: AgentAdmissionPermission[];
  status: "pending" | "admitted" | "expired" | "revoked" | "failed";
  expiresAt: Date;
  cardId: string | null;
  principalId: string | null;
  nodeId: string | null;
  createdAt: Date;
  admittedAt: Date | null;
}

interface InvitationRow {
  invitation_id: string;
  workspace_id: string;
  aicard_invitation_id: string;
  display_name: string;
  machine_name: string | null;
  permissions: AgentAdmissionPermission[];
  status: "pending" | "admitted" | "revoked" | "failed";
  expires_at: Date;
  claim_id: string | null;
  identity_issuer: string | null;
  identity_client_id: string | null;
  identity_subject: string | null;
  node_id: string | null;
  principal_id: string | null;
  card_id: string | null;
  created_by_principal_id: string;
  created_at: Date;
  admitted_at: Date | null;
}

async function roomIds(client: Pool | PoolClient, invitationId: string): Promise<string[]> {
  const result = await client.query<{ room_id: string }>(
    `SELECT room_id FROM agent_admission_rooms
     WHERE invitation_id = $1 ORDER BY room_id`,
    [invitationId],
  );
  return result.rows.map((row) => row.room_id);
}

export class AgentAdmissionRepository {
  constructor(private readonly pool: Pool) {}

  async createInvitation(input: {
    invitationId: string;
    workspaceId: string;
    createdByPrincipalId: string;
    displayName: string;
    machineName: string;
    aicardInvitationId: string;
    ticketHash: Buffer;
    roomIds: string[];
    permissions: AgentAdmissionPermission[];
    expiresAt: Date;
  }): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const uniqueRooms = [...new Set(input.roomIds)].sort();
      const allowed = await client.query<{ room_id: string }>(
        `SELECT rooms.id AS room_id
         FROM rooms
         JOIN room_members owner_room
           ON owner_room.room_id = rooms.id
          AND owner_room.principal_id = $2
          AND owner_room.role = 'owner' AND owner_room.status = 'active'
         JOIN workspace_members owner_workspace
           ON owner_workspace.workspace_id = rooms.workspace_id
          AND owner_workspace.principal_id = $2
          AND owner_workspace.role = 'owner' AND owner_workspace.status = 'active'
         WHERE rooms.workspace_id = $1 AND rooms.status = 'active'
           AND rooms.id = ANY($3::uuid[])
         ORDER BY rooms.id`,
        [input.workspaceId, input.createdByPrincipalId, uniqueRooms],
      );
      if (!uniqueRooms.length || allowed.rowCount !== uniqueRooms.length) {
        throw new AgentAdmissionConflictError("只能授权当前空间中由你管理的有效会话");
      }
      await client.query(
        `INSERT INTO agent_admission_invitations
          (invitation_id, workspace_id, created_by_principal_id,
           aicard_invitation_id, display_name, machine_name, ticket_hash, permissions, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          input.invitationId,
          input.workspaceId,
          input.createdByPrincipalId,
          input.aicardInvitationId,
          input.displayName,
          input.machineName,
          input.ticketHash,
          input.permissions,
          input.expiresAt,
        ],
      );
      await client.query(
        `INSERT INTO agent_admission_rooms (invitation_id, room_id)
         SELECT $1, unnest($2::uuid[])`,
        [input.invitationId, uniqueRooms],
      );
    });
  }

  async listInvitations(input: {
    workspaceId: string;
    createdByPrincipalId: string;
    now?: Date;
  }): Promise<AgentAdmissionInvitationRecord[]> {
    const now = input.now ?? new Date();
    const result = await this.pool.query<InvitationRow>(
      `SELECT invitations.*
       FROM agent_admission_invitations invitations
       WHERE invitations.workspace_id = $1
         AND invitations.created_by_principal_id = $2
       ORDER BY invitations.created_at DESC`,
      [input.workspaceId, input.createdByPrincipalId],
    );
    return Promise.all(result.rows.map(async (row) => ({
      invitationId: row.invitation_id,
      displayName: row.display_name,
      machineName: row.machine_name,
      roomIds: await roomIds(this.pool, row.invitation_id),
      permissions: row.permissions,
      status: row.status === "pending" && row.expires_at.getTime() <= now.getTime()
        ? "expired" as const
        : row.status,
      expiresAt: row.expires_at,
      cardId: row.card_id,
      principalId: row.principal_id,
      nodeId: row.node_id,
      createdAt: row.created_at,
      admittedAt: row.admitted_at,
    })));
  }

  async prepareRevocation(input: {
    invitationId: string;
    workspaceId: string;
    createdByPrincipalId: string;
  }): Promise<{
    invitationId: string;
    aicardInvitationId: string;
    status: "pending" | "admitted";
  } | null> {
    const result = await this.pool.query<Pick<InvitationRow,
      "invitation_id" | "aicard_invitation_id" | "status"
    >>(
      `SELECT invitation_id, aicard_invitation_id, status
       FROM agent_admission_invitations
       WHERE invitation_id = $1 AND workspace_id = $2
         AND created_by_principal_id = $3 AND status IN ('pending', 'admitted')`,
      [input.invitationId, input.workspaceId, input.createdByPrincipalId],
    );
    const row = result.rows[0];
    if (!row || (row.status !== "pending" && row.status !== "admitted")) return null;
    return {
      invitationId: row.invitation_id,
      aicardInvitationId: row.aicard_invitation_id,
      status: row.status,
    };
  }

  async finalizeRevocation(input: {
    invitationId: string;
    workspaceId: string;
    createdByPrincipalId: string;
    now?: Date;
  }): Promise<boolean> {
    return withTransaction(this.pool, async (client) => {
      const selected = await client.query<InvitationRow>(
        `SELECT * FROM agent_admission_invitations
         WHERE invitation_id = $1 AND workspace_id = $2
           AND created_by_principal_id = $3
         FOR UPDATE`,
        [input.invitationId, input.workspaceId, input.createdByPrincipalId],
      );
      const invitation = selected.rows[0];
      if (!invitation || !["pending", "admitted"].includes(invitation.status)) return false;
      if (invitation.status === "admitted" && invitation.principal_id) {
        await client.query(
          `UPDATE agent_bindings
           SET status = 'disabled', updated_at = $2
           WHERE principal_id = $1 AND adapter_id = $3`,
          [invitation.principal_id, input.now ?? new Date(), GATEWAY_ADAPTER_ID],
        );
        await client.query(
          `DELETE FROM agent_gateway_runtime_presence WHERE principal_id = $1`,
          [invitation.principal_id],
        );
      }
      const result = await client.query(
        `UPDATE agent_admission_invitations
         SET status = 'revoked', revoked_at = $4, updated_at = $4
         WHERE invitation_id = $1 AND workspace_id = $2
           AND created_by_principal_id = $3 AND status IN ('pending', 'admitted')`,
        [
          input.invitationId,
          input.workspaceId,
          input.createdByPrincipalId,
          input.now ?? new Date(),
        ],
      );
      return result.rowCount === 1;
    });
  }

  async claim(input: {
    invitationId: string;
    ticketHash: Buffer;
    claimId: string;
    issuer: string;
    clientId: string;
    subject: string;
    nodeId: string;
    machineName: string;
    cardId: string;
    displayName: string;
    handle: string;
    now?: Date;
  }): Promise<AgentAdmissionResult> {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query<InvitationRow>(
        `SELECT * FROM agent_admission_invitations
         WHERE invitation_id = $1 AND ticket_hash = $2
         FOR UPDATE`,
        [input.invitationId, input.ticketHash],
      );
      const invitation = result.rows[0];
      if (!invitation) throw new AgentAdmissionConflictError("接入邀请无效");
      if (invitation.status === "admitted") {
        if (
          invitation.claim_id !== input.claimId
          || invitation.identity_subject !== input.subject
          || !invitation.principal_id
          || !invitation.node_id
          || !invitation.card_id
        ) {
          throw new AgentAdmissionConflictError("接入邀请已经被使用");
        }
        const principal = await client.query<{ display_name: string; handle: string }>(
          "SELECT display_name, handle FROM principals WHERE id = $1",
          [invitation.principal_id],
        );
        return {
          invitationId: invitation.invitation_id,
          principalId: invitation.principal_id,
          cardId: invitation.card_id,
          displayName: principal.rows[0]!.display_name,
          handle: principal.rows[0]!.handle,
          nodeId: invitation.node_id,
          roomIds: await roomIds(client, invitation.invitation_id),
          permissions: invitation.permissions,
          status: "admitted",
        };
      }
      if (invitation.status !== "pending") {
        throw new AgentAdmissionConflictError("接入邀请已经失效");
      }
      if (invitation.expires_at.getTime() <= (input.now ?? new Date()).getTime()) {
        throw new AgentAdmissionConflictError("接入邀请已经过期");
      }

      const lockKey = JSON.stringify([input.issuer, input.clientId, input.subject]);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey]);
      const mapped = await client.query<{ principal_id: string; card_id: string | null }>(
        `SELECT principal_id, card_id FROM aicard_identity_mappings
         WHERE issuer = $1 AND client_id = $2 AND subject = $3`,
        [input.issuer, input.clientId, input.subject],
      );
      let principalId = mapped.rows[0]?.principal_id;
      if (mapped.rows[0]?.card_id && mapped.rows[0].card_id !== input.cardId) {
        throw new AgentAdmissionConflictError("AI Card 身份与已有映射冲突");
      }
      if (!principalId) {
        principalId = randomUUID();
        const digest = createHash("sha256").update(lockKey).digest("hex");
        await client.query(
          `INSERT INTO principals
            (id, kind, external_key, handle, display_name, metadata)
           VALUES ($1, 'agent', $2, $3, $4, $5::jsonb)`,
          [
            principalId,
            `aicard:${digest}`,
            input.handle,
            input.displayName,
            JSON.stringify({ identityProvider: "aicard" }),
          ],
        );
        await client.query(
          `INSERT INTO aicard_identity_mappings
            (issuer, client_id, subject, principal_id, card_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [input.issuer, input.clientId, input.subject, principalId, input.cardId],
        );
      } else {
        const updated = await client.query(
          `UPDATE principals SET handle = $2, display_name = $3, updated_at = NOW()
           WHERE id = $1 AND kind = 'agent' AND status = 'active'`,
          [principalId, input.handle, input.displayName],
        );
        if (updated.rowCount !== 1) throw new AgentAdmissionConflictError("Agent 身份不可用");
        await client.query(
          `UPDATE aicard_identity_mappings
           SET card_id = COALESCE(card_id, $4), last_verified_at = NOW(), updated_at = NOW()
           WHERE issuer = $1 AND client_id = $2 AND subject = $3`,
          [input.issuer, input.clientId, input.subject, input.cardId],
        );
      }

      await client.query(
        `INSERT INTO workspace_members (workspace_id, principal_id, role, status)
         VALUES ($1, $2, 'member', 'active')
         ON CONFLICT (workspace_id, principal_id) DO UPDATE
           SET status = 'active', updated_at = NOW()`,
        [invitation.workspace_id, principalId],
      );
      const rooms = await roomIds(client, invitation.invitation_id);
      const memberships = await client.query(
        `INSERT INTO room_members
          (room_id, principal_id, role, listener_policy, status)
         SELECT admission_rooms.room_id, $2, 'member', 'mention_only', 'active'
         FROM agent_admission_rooms admission_rooms
         JOIN rooms ON rooms.id = admission_rooms.room_id
          AND rooms.workspace_id = $3 AND rooms.status = 'active'
         WHERE admission_rooms.invitation_id = $1
         ON CONFLICT (room_id, principal_id) DO UPDATE
           SET status = 'active', updated_at = NOW()
         RETURNING room_id`,
        [invitation.invitation_id, principalId, invitation.workspace_id],
      );
      if (memberships.rowCount !== rooms.length) {
        throw new AgentAdmissionConflictError("授权会话已经发生变化，请重新创建邀请");
      }
      await client.query(
        `INSERT INTO agent_bindings
          (principal_id, adapter_id, capabilities, status)
         VALUES ($1, $2, $3::jsonb, 'enabled')
         ON CONFLICT (principal_id) DO UPDATE
           SET adapter_id = EXCLUDED.adapter_id,
               capabilities = EXCLUDED.capabilities,
               status = 'enabled', updated_at = NOW()`,
        [principalId, GATEWAY_ADAPTER_ID, JSON.stringify({ permissions: invitation.permissions })],
      );
      await client.query(
        `UPDATE agent_admission_invitations
         SET status = 'admitted', claim_id = $2, identity_issuer = $3,
             identity_client_id = $4, identity_subject = $5, node_id = $6,
             machine_name = $7, principal_id = $8, card_id = $9,
             admitted_at = NOW(), updated_at = NOW()
         WHERE invitation_id = $1`,
        [
          invitation.invitation_id,
          input.claimId,
          input.issuer,
          input.clientId,
          input.subject,
          input.nodeId,
          input.machineName,
          principalId,
          input.cardId,
        ],
      );
      return {
        invitationId: invitation.invitation_id,
        principalId,
        cardId: input.cardId,
        displayName: input.displayName,
        handle: input.handle,
        nodeId: input.nodeId,
        roomIds: rooms,
        permissions: invitation.permissions,
        status: "admitted",
      };
    });
  }
}
