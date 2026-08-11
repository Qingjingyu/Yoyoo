import { createHash, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type {
  ListenerPolicy,
  MembershipRole,
  MembershipStatus,
  PrincipalKind,
  RoomMemberCandidateRecord,
  RoomMemberRecord,
  RoomKind,
  RoomMessageKind,
  RoomMessageRecord,
  RoomMessageRevisionAction,
  RoomMessageRevisionRecord,
  RoomMessageStatus,
  RoomRecord,
  RoomSummaryRecord,
} from "@/domain/collaboration";
import { withTransaction } from "@/server/postgres/transaction";
import type { RoutableRoomMember } from "@/server/message-router";

interface RoomRow {
  id: string;
  workspace_id: string;
  legacy_conversation_id: string | null;
  name: string;
  purpose: string;
  kind: RoomKind;
  direct_human_principal_id: string | null;
  direct_agent_principal_id: string | null;
  status: RoomRecord["status"];
  created_by_principal_id: string;
  created_at: Date;
  updated_at: Date;
}

interface RoomSummaryRow extends RoomRow {
  last_message_preview: string | null;
  last_message_at: Date | null;
  last_activity_at: Date;
  unread_count: string | number;
  pinned_at: Date | null;
}

interface ManageableRoomRow extends RoomRow {
  member_role: MembershipRole;
}

interface RoomMemberRow {
  room_id: string;
  principal_id: string;
  principal_kind: PrincipalKind;
  display_name: string;
  role: MembershipRole;
  listener_policy: ListenerPolicy;
  status: MembershipStatus;
  joined_at: Date;
  updated_at: Date;
}

interface RoomMemberCandidateRow {
  principal_id: string;
  principal_kind: PrincipalKind;
  display_name: string;
  workspace_role: MembershipRole;
}

interface RoomMessageRow {
  id: string;
  room_id: string;
  sender_principal_id: string;
  kind: RoomMessageKind;
  content: string;
  status: RoomMessageStatus;
  idempotency_key: string | null;
  reply_to_message_id: string | null;
  thread_root_message_id: string | null;
  mentioned_principal_ids: string[];
  revision_number: number;
  retracted_at: Date | null;
  retracted_by_principal_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface RoomMessageRevisionRow {
  id: string;
  room_id: string;
  message_id: string;
  revision_number: number;
  action: RoomMessageRevisionAction;
  actor_principal_id: string;
  content: string;
  mentioned_principal_ids: string[];
  created_at: Date;
}

interface MutableRoomMessageRow extends RoomMessageRow {
  room_status: RoomRecord["status"];
  actor_membership_status: MembershipStatus;
  sender_kind: PrincipalKind;
  has_attachment: boolean;
  has_active_run: boolean;
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

function mapRoomSummary(row: RoomSummaryRow): RoomSummaryRecord {
  return {
    ...mapRoom(row),
    lastMessagePreview: row.last_message_preview,
    lastMessageAt: row.last_message_at,
    lastActivityAt: row.last_activity_at,
    unreadCount: Number(row.unread_count),
    pinnedAt: row.pinned_at,
  };
}

function mapMember(row: RoomMemberRow): RoomMemberRecord {
  return {
    roomId: row.room_id,
    principalId: row.principal_id,
    principalKind: row.principal_kind,
    displayName: row.display_name,
    role: row.role,
    listenerPolicy: row.listener_policy,
    status: row.status,
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: RoomMessageRow): RoomMessageRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    senderPrincipalId: row.sender_principal_id,
    kind: row.kind,
    content: row.content,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    replyToMessageId: row.reply_to_message_id,
    threadRootMessageId: row.thread_root_message_id,
    mentionedPrincipalIds: row.mentioned_principal_ids,
    revisionNumber: row.revision_number,
    retractedAt: row.retracted_at,
    retractedByPrincipalId: row.retracted_by_principal_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessageRevision(
  row: RoomMessageRevisionRow,
): RoomMessageRevisionRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    messageId: row.message_id,
    revisionNumber: row.revision_number,
    action: row.action,
    actorPrincipalId: row.actor_principal_id,
    content: row.content,
    mentionedPrincipalIds: row.mentioned_principal_ids,
    createdAt: row.created_at,
  };
}

function stableRoomId(workspaceId: string, idempotencyKey: string): string {
  const hex = createHash("sha256")
    .update(`room:${workspaceId}:${idempotencyKey}`, "utf8")
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export class RoomNotFoundError extends Error {
  constructor() {
    super("Room was not found or is not accessible");
    this.name = "RoomNotFoundError";
  }
}

export class RoomPermissionError extends Error {
  constructor() {
    super("Only a room owner can manage this room");
    this.name = "RoomPermissionError";
  }
}

export class RoomLifecycleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoomLifecycleConflictError";
  }
}

export class RoomMembershipConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoomMembershipConflictError";
  }
}

export class MessageNotFoundError extends Error {
  constructor() {
    super("Message was not found or is not accessible");
    this.name = "MessageNotFoundError";
  }
}

export class MessageMutationPermissionError extends Error {
  constructor() {
    super("Only the human sender can change this message");
    this.name = "MessageMutationPermissionError";
  }
}

export class MessageRevisionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageRevisionConflictError";
  }
}

export class MessageIdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used for a different message request");
    this.name = "MessageIdempotencyConflictError";
  }
}

async function selectManageableRoom(
  client: PoolClient,
  roomId: string,
  principalId: string,
): Promise<ManageableRoomRow> {
  const result = await client.query<ManageableRoomRow>(
    `SELECT rooms.*, room_members.role AS member_role
     FROM rooms
     JOIN room_members ON room_members.room_id = rooms.id
     JOIN workspace_members
       ON workspace_members.workspace_id = rooms.workspace_id
      AND workspace_members.principal_id = room_members.principal_id
     JOIN principals ON principals.id = room_members.principal_id
     JOIN workspaces ON workspaces.id = rooms.workspace_id
     WHERE rooms.id = $1
       AND room_members.principal_id = $2
       AND room_members.status = 'active'
       AND workspace_members.status = 'active'
       AND principals.status = 'active'
       AND workspaces.status = 'active'`,
    [roomId, principalId],
  );
  if (!result.rows[0]) throw new RoomNotFoundError();
  if (result.rows[0].member_role !== "owner") throw new RoomPermissionError();
  return result.rows[0];
}

async function selectMessage(
  client: Pool | PoolClient,
  messageId: string,
): Promise<RoomMessageRecord> {
  const result = await client.query<RoomMessageRow>(
    `SELECT room_messages.*,
       COALESCE(
         array_agg(message_mentions.mentioned_principal_id
           ORDER BY message_mentions.mentioned_principal_id)
           FILTER (WHERE message_mentions.mentioned_principal_id IS NOT NULL),
         ARRAY[]::uuid[]
       ) AS mentioned_principal_ids
     FROM room_messages
     LEFT JOIN message_mentions ON message_mentions.message_id = room_messages.id
     WHERE room_messages.id = $1
     GROUP BY room_messages.id`,
    [messageId],
  );
  if (!result.rows[0]) throw new Error(`Unknown room message: ${messageId}`);
  return mapMessage(result.rows[0]);
}

async function selectMessageForMutation(
  client: PoolClient,
  input: { roomId: string; messageId: string; actorPrincipalId: string },
): Promise<MutableRoomMessageRow> {
  const result = await client.query<MutableRoomMessageRow>(
    `SELECT room_messages.*,
       ARRAY(
         SELECT message_mentions.mentioned_principal_id
         FROM message_mentions
         WHERE message_mentions.message_id = room_messages.id
         ORDER BY message_mentions.mentioned_principal_id
       ) AS mentioned_principal_ids,
       rooms.status AS room_status,
       actor_membership.status AS actor_membership_status,
       sender.kind AS sender_kind,
       EXISTS (
         SELECT 1 FROM message_attachments
         WHERE message_attachments.message_id = room_messages.id
       ) AS has_attachment,
       EXISTS (
         SELECT 1 FROM room_runs
         WHERE (
           room_runs.trigger_message_id = room_messages.id
           OR room_runs.output_message_id = room_messages.id
         )
           AND room_runs.status IN ('queued', 'running', 'waiting')
       ) AS has_active_run
     FROM room_messages
     JOIN rooms ON rooms.id = room_messages.room_id
     JOIN room_members AS actor_membership
       ON actor_membership.room_id = room_messages.room_id
      AND actor_membership.principal_id = $3
     JOIN principals AS sender ON sender.id = room_messages.sender_principal_id
     WHERE room_messages.room_id = $1 AND room_messages.id = $2
     FOR UPDATE OF room_messages`,
    [input.roomId, input.messageId, input.actorPrincipalId],
  );
  if (!result.rows[0] || result.rows[0].actor_membership_status !== "active") {
    throw new MessageNotFoundError();
  }
  return result.rows[0];
}

export class RoomRepository {
  private readonly maxMessageAttachmentBytes: number;

  constructor(
    private readonly pool: Pool,
    options: { maxMessageAttachmentBytes?: number } = {},
  ) {
    this.maxMessageAttachmentBytes =
      options.maxMessageAttachmentBytes ?? 100 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxMessageAttachmentBytes) || this.maxMessageAttachmentBytes <= 0) {
      throw new RangeError("maxMessageAttachmentBytes must be a positive safe integer");
    }
  }

  async create(input: {
    workspaceId: string;
    name: string;
    createdByPrincipalId: string;
  }): Promise<RoomRecord> {
    return withTransaction(this.pool, async (client) => {
      const membership = await client.query<{ role: MembershipRole }>(
        `SELECT role FROM workspace_members
         WHERE workspace_id = $1 AND principal_id = $2 AND status = 'active'`,
        [input.workspaceId, input.createdByPrincipalId],
      );
      if (!membership.rows[0]) {
        throw new Error(
          `Principal ${input.createdByPrincipalId} is not an active workspace member`,
        );
      }
      const room = await client.query<RoomRow>(
        `INSERT INTO rooms
          (id, workspace_id, name, created_by_principal_id)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [randomUUID(), input.workspaceId, input.name, input.createdByPrincipalId],
      );
      await client.query(
        `INSERT INTO room_members
          (room_id, principal_id, role, listener_policy)
         VALUES ($1, $2, 'owner', 'always')`,
        [room.rows[0].id, input.createdByPrincipalId],
      );
      await client.query(
        `INSERT INTO room_member_states (room_id, principal_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [room.rows[0].id, input.createdByPrincipalId],
      );
      return mapRoom(room.rows[0]);
    });
  }

  async createWithWorkspaceAgents(input: {
    workspaceId: string;
    name: string;
    createdByPrincipalId: string;
    idempotencyKey: string;
  }): Promise<{ duplicate: boolean; room: RoomRecord }> {
    return withTransaction(this.pool, async (client) => {
      const roomId = stableRoomId(input.workspaceId, input.idempotencyKey);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `room-create:${input.workspaceId}:${input.idempotencyKey}`,
      ]);
      const existing = await client.query<RoomRow>(
        "SELECT * FROM rooms WHERE id = $1",
        [roomId],
      );
      if (existing.rows[0]) {
        return { duplicate: true, room: mapRoom(existing.rows[0]) };
      }

      const owner = await client.query<{ principal_id: string }>(
        `SELECT principal_id FROM workspace_members
         WHERE workspace_id = $1 AND principal_id = $2
           AND role = 'owner' AND status = 'active'`,
        [input.workspaceId, input.createdByPrincipalId],
      );
      if (!owner.rows[0]) {
        throw new Error("Only an active workspace owner can create a room");
      }

      const created = await client.query<RoomRow>(
        `INSERT INTO rooms
          (id, workspace_id, name, created_by_principal_id)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [roomId, input.workspaceId, input.name, input.createdByPrincipalId],
      );
      await client.query(
        `INSERT INTO room_members
          (room_id, principal_id, role, listener_policy)
         VALUES ($1, $2, 'owner', 'always')`,
        [roomId, input.createdByPrincipalId],
      );
      await client.query(
        `INSERT INTO room_members
          (room_id, principal_id, role, listener_policy)
         SELECT $1, workspace_members.principal_id, 'member', 'mention_only'
         FROM workspace_members
         JOIN principals ON principals.id = workspace_members.principal_id
         JOIN agent_bindings ON agent_bindings.principal_id = principals.id
         WHERE workspace_members.workspace_id = $2
           AND workspace_members.status = 'active'
           AND principals.kind = 'agent'
           AND principals.status = 'active'
           AND agent_bindings.status = 'enabled'
           AND agent_bindings.adapter_id <> 'yoyoo-agent-gateway'
         ON CONFLICT (room_id, principal_id) DO UPDATE SET
           role = 'member', listener_policy = 'mention_only',
           status = 'active', updated_at = NOW()`,
        [roomId, input.workspaceId],
      );
      await client.query(
        `INSERT INTO room_member_states (room_id, principal_id)
         SELECT room_id, principal_id FROM room_members WHERE room_id = $1
         ON CONFLICT DO NOTHING`,
        [roomId],
      );
      return { duplicate: false, room: mapRoom(created.rows[0]) };
    });
  }

  async createDirect(input: {
    workspaceId: string;
    humanPrincipalId: string;
    agentPrincipalId: string;
  }): Promise<{ duplicate: boolean; room: RoomRecord }> {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `direct-room:${input.workspaceId}:${input.humanPrincipalId}:${input.agentPrincipalId}`,
      ]);
      const eligible = await client.query<{
        principal_id: string;
        kind: PrincipalKind;
        display_name: string;
        has_binding: boolean;
      }>(
        `SELECT workspace_members.principal_id, principals.kind,
                principals.display_name,
                EXISTS (
                  SELECT 1 FROM agent_bindings
                  WHERE agent_bindings.principal_id = principals.id
                    AND agent_bindings.status = 'enabled'
                ) AS has_binding
         FROM workspace_members
         JOIN principals ON principals.id = workspace_members.principal_id
         WHERE workspace_members.workspace_id = $1
           AND workspace_members.status = 'active'
           AND principals.status = 'active'
           AND workspace_members.principal_id = ANY($2::uuid[])`,
        [input.workspaceId, [input.humanPrincipalId, input.agentPrincipalId]],
      );
      const human = eligible.rows.find(
        (member) => member.principal_id === input.humanPrincipalId,
      );
      const agent = eligible.rows.find(
        (member) => member.principal_id === input.agentPrincipalId,
      );
      if (human?.kind !== "human" || agent?.kind !== "agent" || !agent.has_binding) {
        throw new RoomMembershipConflictError(
          "A direct room requires one active human and one active Agent",
        );
      }

      const existing = await client.query<RoomRow>(
        `SELECT * FROM rooms
         WHERE workspace_id = $1 AND kind = 'direct'
           AND direct_human_principal_id = $2
           AND direct_agent_principal_id = $3
         FOR UPDATE`,
        [input.workspaceId, input.humanPrincipalId, input.agentPrincipalId],
      );
      if (existing.rows[0]) {
        const restored = await client.query<RoomRow>(
          `UPDATE rooms SET status = 'active', updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [existing.rows[0].id],
        );
        await client.query(
          `UPDATE room_members SET status = 'active', updated_at = NOW()
           WHERE room_id = $1 AND principal_id = ANY($2::uuid[])`,
          [existing.rows[0].id, [input.humanPrincipalId, input.agentPrincipalId]],
        );
        await client.query(
          `INSERT INTO room_member_states (room_id, principal_id, hidden_at)
           VALUES ($1, $2, NULL)
           ON CONFLICT (room_id, principal_id) DO UPDATE
             SET hidden_at = NULL, updated_at = NOW()`,
          [existing.rows[0].id, input.humanPrincipalId],
        );
        return { duplicate: true, room: mapRoom(restored.rows[0]) };
      }

      const roomId = randomUUID();
      const room = await client.query<RoomRow>(
        `INSERT INTO rooms
          (id, workspace_id, name, kind, direct_human_principal_id,
           direct_agent_principal_id, created_by_principal_id)
         VALUES ($1, $2, $3, 'direct', $4, $5, $4)
         RETURNING *`,
        [
          roomId,
          input.workspaceId,
          agent.display_name,
          input.humanPrincipalId,
          input.agentPrincipalId,
        ],
      );
      await client.query(
        `INSERT INTO room_members
          (room_id, principal_id, role, listener_policy)
         VALUES
          ($1, $2, 'owner', 'always'),
          ($1, $3, 'member', 'mention_only')`,
        [roomId, input.humanPrincipalId, input.agentPrincipalId],
      );
      await client.query(
        `INSERT INTO room_member_states (room_id, principal_id)
         VALUES ($1, $2), ($1, $3)`,
        [roomId, input.humanPrincipalId, input.agentPrincipalId],
      );
      return { duplicate: false, room: mapRoom(room.rows[0]) };
    });
  }

  async listAccessible(
    workspaceId: string,
    principalId: string,
  ): Promise<RoomRecord[]> {
    const result = await this.pool.query<RoomRow>(
      `SELECT rooms.* FROM rooms
       JOIN room_members ON room_members.room_id = rooms.id
       JOIN workspace_members
         ON workspace_members.workspace_id = rooms.workspace_id
        AND workspace_members.principal_id = room_members.principal_id
       JOIN principals ON principals.id = room_members.principal_id
       JOIN workspaces ON workspaces.id = rooms.workspace_id
       WHERE rooms.workspace_id = $1
         AND rooms.status = 'active'
         AND room_members.principal_id = $2
         AND room_members.status = 'active'
         AND workspace_members.status = 'active'
         AND principals.status = 'active'
         AND workspaces.status = 'active'
       ORDER BY rooms.created_at, rooms.id`,
      [workspaceId, principalId],
    );
    return result.rows.map(mapRoom);
  }

  async listAccessibleSummaries(
    workspaceId: string,
    principalId: string,
  ): Promise<{ active: RoomSummaryRecord[]; archived: RoomSummaryRecord[] }> {
    const result = await this.pool.query<RoomSummaryRow>(
      `SELECT rooms.*,
              LEFT(last_message.content, 160) AS last_message_preview,
              last_message.created_at AS last_message_at,
              GREATEST(
                rooms.updated_at,
                COALESCE(last_message.created_at, rooms.updated_at)
              ) AS last_activity_at,
              COALESCE(unread.unread_count, 0::bigint) AS unread_count,
              room_member_states.pinned_at
       FROM rooms
       JOIN room_members ON room_members.room_id = rooms.id
       JOIN workspace_members
         ON workspace_members.workspace_id = rooms.workspace_id
        AND workspace_members.principal_id = room_members.principal_id
       JOIN principals ON principals.id = room_members.principal_id
       JOIN workspaces ON workspaces.id = rooms.workspace_id
       LEFT JOIN room_member_states
         ON room_member_states.room_id = rooms.id
        AND room_member_states.principal_id = $2
       LEFT JOIN room_messages AS read_cursor
         ON read_cursor.id = room_member_states.last_read_message_id
       LEFT JOIN LATERAL (
         SELECT room_messages.content, room_messages.created_at
         FROM room_messages
         WHERE room_messages.room_id = rooms.id
           AND room_messages.status = 'completed'
           AND room_messages.retracted_at IS NULL
         ORDER BY room_messages.created_at DESC, room_messages.id DESC
         LIMIT 1
       ) AS last_message ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS unread_count
         FROM room_messages AS unread_message
         WHERE unread_message.room_id = rooms.id
           AND unread_message.status = 'completed'
           AND unread_message.retracted_at IS NULL
           AND unread_message.sender_principal_id <> $2
           AND (
             read_cursor.id IS NULL
             OR (unread_message.created_at, unread_message.id)
                > (read_cursor.created_at, read_cursor.id)
           )
       ) AS unread ON TRUE
       WHERE rooms.workspace_id = $1
         AND room_members.principal_id = $2
         AND room_members.status = 'active'
         AND workspace_members.status = 'active'
         AND principals.status = 'active'
         AND workspaces.status = 'active'
         AND (
           rooms.status = 'archived'
           OR room_member_states.hidden_at IS NULL
           OR last_message.created_at > room_member_states.hidden_at
         )
       ORDER BY CASE
                  WHEN rooms.status = 'active'
                       AND room_member_states.pinned_at IS NOT NULL THEN 0
                  WHEN rooms.status = 'active' THEN 1
                  ELSE 2
                END,
                room_member_states.pinned_at DESC NULLS LAST,
                last_activity_at DESC, rooms.id`,
      [workspaceId, principalId],
    );
    const summaries = result.rows.map(mapRoomSummary);
    return {
      active: summaries.filter((room) => room.status === "active"),
      archived: summaries.filter((room) => room.status === "archived"),
    };
  }

  async rename(input: {
    roomId: string;
    principalId: string;
    name: string;
  }): Promise<RoomRecord> {
    return withTransaction(this.pool, async (client) => {
      const room = await selectManageableRoom(client, input.roomId, input.principalId);
      if (room.status !== "active") {
        throw new RoomLifecycleConflictError("An archived room cannot be renamed");
      }
      const updated = await client.query<RoomRow>(
        `UPDATE rooms SET name = $2, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [input.roomId, input.name],
      );
      return mapRoom(updated.rows[0]);
    });
  }

  async updatePurpose(input: {
    roomId: string;
    principalId: string;
    purpose: string;
  }): Promise<RoomRecord> {
    return withTransaction(this.pool, async (client) => {
      const room = await selectManageableRoom(client, input.roomId, input.principalId);
      if (room.status !== "active") {
        throw new RoomLifecycleConflictError(
          "An archived room cannot change its purpose",
        );
      }
      const updated = await client.query<RoomRow>(
        `UPDATE rooms SET purpose = $2, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [input.roomId, input.purpose],
      );
      return mapRoom(updated.rows[0]);
    });
  }

  async setStatus(input: {
    roomId: string;
    principalId: string;
    status: RoomRecord["status"];
  }): Promise<RoomRecord> {
    return withTransaction(this.pool, async (client) => {
      const room = await selectManageableRoom(client, input.roomId, input.principalId);
      if (room.status === input.status) return mapRoom(room);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `room-lifecycle:${room.workspace_id}`,
      ]);
      if (input.status === "archived") {
        const activeRuns = await client.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM room_runs
             WHERE room_id = $1 AND status IN ('queued', 'running', 'waiting')
           ) AS exists`,
          [input.roomId],
        );
        if (activeRuns.rows[0].exists) {
          throw new RoomLifecycleConflictError(
            "A room with active Agent runs cannot be archived",
          );
        }
        const active = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM rooms
           WHERE workspace_id = $1 AND status = 'active'`,
          [room.workspace_id],
        );
        if (Number(active.rows[0].count) <= 1) {
          throw new RoomLifecycleConflictError(
            "The final active room cannot be archived",
          );
        }
      }
      const updated = await client.query<RoomRow>(
        `UPDATE rooms SET status = $2, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [input.roomId, input.status],
      );
      return mapRoom(updated.rows[0]);
    });
  }

  async get(roomId: string): Promise<RoomRecord> {
    const result = await this.pool.query<RoomRow>("SELECT * FROM rooms WHERE id = $1", [
      roomId,
    ]);
    if (!result.rows[0]) throw new Error(`Unknown room: ${roomId}`);
    return mapRoom(result.rows[0]);
  }

  async getAccessible(roomId: string, principalId: string): Promise<RoomRecord> {
    const result = await this.pool.query<RoomRow>(
      `SELECT rooms.* FROM rooms
       JOIN room_members ON room_members.room_id = rooms.id
       JOIN workspace_members
         ON workspace_members.workspace_id = rooms.workspace_id
        AND workspace_members.principal_id = room_members.principal_id
       JOIN principals ON principals.id = room_members.principal_id
       JOIN workspaces ON workspaces.id = rooms.workspace_id
       WHERE rooms.id = $1
         AND rooms.status = 'active'
         AND room_members.principal_id = $2
         AND room_members.status = 'active'
         AND workspace_members.status = 'active'
         AND principals.status = 'active'
         AND workspaces.status = 'active'`,
      [roomId, principalId],
    );
    if (!result.rows[0]) throw new RoomNotFoundError();
    return mapRoom(result.rows[0]);
  }

  async addMember(input: {
    roomId: string;
    principalId: string;
    role: MembershipRole;
    listenerPolicy: ListenerPolicy;
  }): Promise<RoomMemberRecord> {
    const result = await this.pool.query<RoomMemberRow>(
      `WITH eligible AS (
         SELECT rooms.id AS room_id, workspace_members.principal_id
         FROM rooms
         JOIN workspace_members
           ON workspace_members.workspace_id = rooms.workspace_id
          AND workspace_members.principal_id = $2
          AND workspace_members.status = 'active'
         JOIN principals
           ON principals.id = workspace_members.principal_id
          AND principals.status = 'active'
         WHERE rooms.id = $1 AND rooms.status = 'active'
       ), inserted AS (
         INSERT INTO room_members
           (room_id, principal_id, role, listener_policy)
         SELECT room_id, principal_id, $3, $4 FROM eligible
         ON CONFLICT (room_id, principal_id) DO UPDATE SET
           role = EXCLUDED.role,
           listener_policy = EXCLUDED.listener_policy,
           status = 'active',
           updated_at = NOW()
         RETURNING *
       )
       SELECT inserted.*, principals.kind AS principal_kind,
              principals.display_name
       FROM inserted JOIN principals ON principals.id = inserted.principal_id`,
      [input.roomId, input.principalId, input.role, input.listenerPolicy],
    );
    if (!result.rows[0]) {
      throw new Error(`Principal ${input.principalId} is not an active workspace member`);
    }
    return mapMember(result.rows[0]);
  }

  async listEligibleMembers(input: {
    roomId: string;
    principalId: string;
  }): Promise<RoomMemberCandidateRecord[]> {
    return withTransaction(this.pool, async (client) => {
      const room = await selectManageableRoom(client, input.roomId, input.principalId);
      if (room.status !== "active") {
        throw new RoomMembershipConflictError(
          "An archived room cannot change membership",
        );
      }
      if (room.kind === "direct") {
        return [];
      }
      const result = await client.query<RoomMemberCandidateRow>(
        `SELECT workspace_members.principal_id,
                principals.kind AS principal_kind,
                principals.display_name,
                workspace_members.role AS workspace_role
         FROM workspace_members
         JOIN principals ON principals.id = workspace_members.principal_id
         LEFT JOIN agent_bindings ON agent_bindings.principal_id = principals.id
         LEFT JOIN agent_gateway_credentials AS gateway_credentials
           ON gateway_credentials.principal_id = principals.id
         LEFT JOIN agent_gateway_runtime_presence AS runtime_presence
           ON runtime_presence.principal_id = principals.id
          AND runtime_presence.workspace_id = workspace_members.workspace_id
         LEFT JOIN room_members
           ON room_members.room_id = $1
          AND room_members.principal_id = workspace_members.principal_id
         WHERE workspace_members.workspace_id = $2
           AND workspace_members.status = 'active'
           AND principals.status = 'active'
           AND (
             principals.kind <> 'agent'
             OR (
               agent_bindings.status = 'enabled'
               AND (
                 agent_bindings.adapter_id <> 'yoyoo-agent-gateway'
                 OR (
                   (
                     gateway_credentials.status = 'active'
                     AND gateway_credentials.last_seen_at >= NOW() - INTERVAL '45 seconds'
                   )
                   OR (
                     runtime_presence.session_expires_at > NOW()
                     AND runtime_presence.last_seen_at >= NOW() - INTERVAL '45 seconds'
                   )
                 )
               )
             )
           )
           AND (room_members.principal_id IS NULL OR room_members.status = 'removed')
         ORDER BY CASE principals.kind WHEN 'human' THEN 0 ELSE 1 END,
                  principals.display_name, workspace_members.principal_id`,
        [input.roomId, room.workspace_id],
      );
      return result.rows.map((row) => ({
        principalId: row.principal_id,
        principalKind: row.principal_kind,
        displayName: row.display_name,
        workspaceRole: row.workspace_role,
      }));
    });
  }

  async addMemberByOwner(input: {
    roomId: string;
    actorPrincipalId: string;
    memberPrincipalId: string;
  }): Promise<RoomMemberRecord> {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `room-membership:${input.roomId}`,
      ]);
      const room = await selectManageableRoom(
        client,
        input.roomId,
        input.actorPrincipalId,
      );
      if (room.status !== "active") {
        throw new RoomMembershipConflictError(
          "An archived room cannot change membership",
        );
      }
      if (room.kind === "direct") {
        throw new RoomMembershipConflictError(
          "Direct-room membership cannot be changed",
        );
      }
      const result = await client.query<RoomMemberRow>(
        `WITH eligible AS (
           SELECT rooms.id AS room_id, workspace_members.principal_id,
                  principals.kind AS principal_kind,
                  principals.display_name
           FROM rooms
           JOIN workspace_members
             ON workspace_members.workspace_id = rooms.workspace_id
            AND workspace_members.principal_id = $2
            AND workspace_members.status = 'active'
           JOIN principals
             ON principals.id = workspace_members.principal_id
            AND principals.status = 'active'
           WHERE rooms.id = $1 AND rooms.status = 'active'
         ), inserted AS (
           INSERT INTO room_members
             (room_id, principal_id, role, listener_policy)
           SELECT room_id, principal_id, 'member',
                  CASE principal_kind WHEN 'agent' THEN 'mention_only'
                                      ELSE 'always' END
           FROM eligible
           ON CONFLICT (room_id, principal_id) DO UPDATE SET
             listener_policy = EXCLUDED.listener_policy,
             status = 'active',
             updated_at = NOW()
           RETURNING *
         )
         SELECT inserted.*, principals.kind AS principal_kind,
                principals.display_name
         FROM inserted
         JOIN principals ON principals.id = inserted.principal_id`,
        [input.roomId, input.memberPrincipalId],
      );
      if (!result.rows[0]) {
        throw new RoomMembershipConflictError(
          "The principal is not an active workspace member",
        );
      }
      await client.query(
        `INSERT INTO room_member_states (room_id, principal_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [input.roomId, input.memberPrincipalId],
      );
      return mapMember(result.rows[0]);
    });
  }

  async removeMember(input: {
    roomId: string;
    actorPrincipalId: string;
    memberPrincipalId: string;
  }): Promise<RoomMemberRecord> {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `room-membership:${input.roomId}`,
      ]);
      const room = await selectManageableRoom(
        client,
        input.roomId,
        input.actorPrincipalId,
      );
      if (room.status !== "active") {
        throw new RoomMembershipConflictError(
          "An archived room cannot change membership",
        );
      }
      if (room.kind === "direct") {
        throw new RoomMembershipConflictError(
          "Direct-room membership cannot be changed",
        );
      }
      const target = await client.query<RoomMemberRow>(
        `SELECT room_members.*, principals.kind AS principal_kind,
                principals.display_name
         FROM room_members
         JOIN principals ON principals.id = room_members.principal_id
         WHERE room_members.room_id = $1 AND room_members.principal_id = $2
         FOR UPDATE`,
        [input.roomId, input.memberPrincipalId],
      );
      if (!target.rows[0]) {
        throw new RoomMembershipConflictError("The room member does not exist");
      }
      if (target.rows[0].role === "owner") {
        throw new RoomMembershipConflictError("The room owner cannot be removed");
      }
      if (target.rows[0].status === "removed") return mapMember(target.rows[0]);
      if (target.rows[0].principal_kind === "agent") {
        const activeRun = await client.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM room_runs
             WHERE room_id = $1 AND target_agent_principal_id = $2
               AND status IN ('queued', 'running', 'waiting')
           ) AS exists`,
          [input.roomId, input.memberPrincipalId],
        );
        if (activeRun.rows[0].exists) {
          throw new RoomMembershipConflictError(
            "An Agent with an active run cannot be removed",
          );
        }
      }
      const updated = await client.query<RoomMemberRow>(
        `UPDATE room_members SET status = 'removed', updated_at = NOW()
         WHERE room_id = $1 AND principal_id = $2
         RETURNING *`,
        [input.roomId, input.memberPrincipalId],
      );
      return mapMember({
        ...updated.rows[0],
        principal_kind: target.rows[0].principal_kind,
        display_name: target.rows[0].display_name,
      });
    });
  }

  async listMembers(roomId: string): Promise<RoomMemberRecord[]> {
    const result = await this.pool.query<RoomMemberRow>(
      `SELECT room_members.*, principals.kind AS principal_kind,
              principals.display_name
       FROM room_members
       JOIN principals ON principals.id = room_members.principal_id
       JOIN rooms ON rooms.id = room_members.room_id
       JOIN workspaces ON workspaces.id = rooms.workspace_id
       JOIN workspace_members
         ON workspace_members.workspace_id = rooms.workspace_id
        AND workspace_members.principal_id = room_members.principal_id
       WHERE room_members.room_id = $1
         AND principals.status = 'active'
         AND workspaces.status = 'active'
         AND workspace_members.status = 'active'
       ORDER BY room_members.joined_at, room_members.principal_id`,
      [roomId],
    );
    return result.rows.map(mapMember);
  }

  async listRoutableMembers(roomId: string): Promise<RoutableRoomMember[]> {
    const result = await this.pool.query<{
      principal_id: string;
      kind: PrincipalKind;
      status: MembershipStatus;
      listener_policy: ListenerPolicy;
      adapter_id: string | null;
    }>(
      `SELECT room_members.principal_id, principals.kind, room_members.status,
              room_members.listener_policy, agent_bindings.adapter_id
       FROM room_members
       JOIN principals ON principals.id = room_members.principal_id
       JOIN rooms ON rooms.id = room_members.room_id
       JOIN workspaces ON workspaces.id = rooms.workspace_id
       JOIN workspace_members
         ON workspace_members.workspace_id = rooms.workspace_id
        AND workspace_members.principal_id = room_members.principal_id
       LEFT JOIN agent_bindings
         ON agent_bindings.principal_id = room_members.principal_id
        AND agent_bindings.status = 'enabled'
       WHERE room_members.room_id = $1
         AND principals.status = 'active'
         AND workspaces.status = 'active'
         AND workspace_members.status = 'active'
       ORDER BY room_members.joined_at, room_members.principal_id`,
      [roomId],
    );
    return result.rows.map((row) => ({
      principalId: row.principal_id,
      kind: row.kind,
      status: row.status,
      listenerPolicy: row.listener_policy,
      adapterId: row.adapter_id,
    }));
  }

  async createMessage(input: {
    roomId: string;
    senderPrincipalId: string;
    kind: RoomMessageKind;
    content: string;
    status: RoomMessageStatus;
    idempotencyKey: string;
    mentionedPrincipalIds?: string[];
    attachmentIds?: string[];
    replyToMessageId?: string | null;
    threadRootMessageId?: string | null;
  }): Promise<{ duplicate: boolean; message: RoomMessageRecord }> {
    if (!input.content.trim() && (input.attachmentIds?.length ?? 0) === 0) {
      throw new Error("A message requires text or an attachment");
    }
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `room-message:${input.roomId}:${input.idempotencyKey}`,
      ]);
      const sender = await client.query<{ id: string }>(
        `SELECT room_members.principal_id AS id
         FROM room_members
         JOIN rooms ON rooms.id = room_members.room_id
         JOIN workspaces ON workspaces.id = rooms.workspace_id
         JOIN workspace_members
           ON workspace_members.workspace_id = rooms.workspace_id
          AND workspace_members.principal_id = room_members.principal_id
         JOIN principals ON principals.id = room_members.principal_id
         WHERE room_members.room_id = $1
           AND room_members.principal_id = $2
           AND room_members.status = 'active'
           AND rooms.status = 'active'
           AND workspaces.status = 'active'
           AND workspace_members.status = 'active'
           AND principals.status = 'active'`,
        [input.roomId, input.senderPrincipalId],
      );
      if (!sender.rows[0]) {
        throw new RoomLifecycleConflictError(
          "Messages can only be sent by an active member to an active room",
        );
      }
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM room_messages
         WHERE room_id = $1 AND idempotency_key = $2`,
        [input.roomId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        const existingMessage = await selectMessage(client, existing.rows[0].id);
        const requestedAttachmentIds = [...new Set(input.attachmentIds ?? [])];
        const requestedMentionIds = [...new Set(input.mentionedPrincipalIds ?? [])].sort();
        const linked = await client.query<{ attachment_id: string }>(
          `SELECT attachment_id FROM message_attachments
           WHERE message_id = $1 ORDER BY position`,
          [existing.rows[0].id],
        );
        const linkedAttachmentIds = linked.rows.map((row) => row.attachment_id);
        if (
          existingMessage.senderPrincipalId !== input.senderPrincipalId
          || existingMessage.kind !== input.kind
          || existingMessage.content !== input.content
          || existingMessage.status !== input.status
          || existingMessage.replyToMessageId !== (input.replyToMessageId ?? null)
          || existingMessage.threadRootMessageId !== (input.threadRootMessageId ?? null)
          || existingMessage.mentionedPrincipalIds.length !== requestedMentionIds.length
          || existingMessage.mentionedPrincipalIds.some(
            (id, index) => id !== requestedMentionIds[index],
          )
          ||
          requestedAttachmentIds.length !== linkedAttachmentIds.length ||
          requestedAttachmentIds.some((id, index) => id !== linkedAttachmentIds[index])
        ) {
          throw new MessageIdempotencyConflictError();
        }
        return {
          duplicate: true,
          message: existingMessage,
        };
      }

      const attachmentIds = [...new Set(input.attachmentIds ?? [])];
      if (attachmentIds.length > 10) {
        throw new Error("A message can contain at most ten attachments");
      }
      let workspaceId: string | null = null;
      if (attachmentIds.length > 0) {
        const room = await client.query<{ workspace_id: string }>(
          "SELECT workspace_id FROM rooms WHERE id = $1 AND status = 'active'",
          [input.roomId],
        );
        if (!room.rows[0]) throw new Error("Room is not active");
        workspaceId = room.rows[0].workspace_id;
        const attachments = await client.query<{
          id: string;
          uploader_principal_id: string;
          size_bytes: string | number | null;
          status: string;
        }>(
          `SELECT id, uploader_principal_id, size_bytes, status FROM attachments
           WHERE id = ANY($1::uuid[]) AND workspace_id = $2
           FOR UPDATE`,
          [attachmentIds, workspaceId],
        );
        if ((attachments.rowCount ?? 0) !== attachmentIds.length) {
          throw new Error("An attachment was not found");
        }
        if (
          attachments.rows.some(
            (attachment) => attachment.uploader_principal_id !== input.senderPrincipalId,
          )
        ) {
          throw new Error("Attachment is not owned by the message sender");
        }
        if (attachments.rows.some((attachment) => attachment.status !== "ready")) {
          throw new Error("Every attachment must be ready");
        }
        const totalBytes = attachments.rows.reduce(
          (sum, attachment) => sum + Number(attachment.size_bytes ?? 0),
          0,
        );
        if (totalBytes > this.maxMessageAttachmentBytes) {
          throw new Error("Message attachments exceed the 100 MiB limit");
        }
        const linked = await client.query<{ attachment_id: string }>(
          "SELECT attachment_id FROM message_attachments WHERE attachment_id = ANY($1::uuid[])",
          [attachmentIds],
        );
        if ((linked.rowCount ?? 0) > 0) {
          throw new Error("An attachment is already linked");
        }
      }

      const mentionedPrincipalIds = [...new Set(input.mentionedPrincipalIds ?? [])];
      if (mentionedPrincipalIds.length > 0) {
        const mentions = await client.query<{ principal_id: string }>(
          `SELECT room_members.principal_id
           FROM room_members
           JOIN rooms ON rooms.id = room_members.room_id
           JOIN workspaces ON workspaces.id = rooms.workspace_id
           JOIN workspace_members
             ON workspace_members.workspace_id = rooms.workspace_id
            AND workspace_members.principal_id = room_members.principal_id
           JOIN principals ON principals.id = room_members.principal_id
           WHERE room_members.room_id = $1
             AND room_members.status = 'active'
             AND workspace_members.status = 'active'
             AND principals.status = 'active'
             AND workspaces.status = 'active'
             AND room_members.principal_id = ANY($2::uuid[])`,
          [input.roomId, mentionedPrincipalIds],
        );
        if (mentions.rowCount !== mentionedPrincipalIds.length) {
          throw new RoomMembershipConflictError(
            "A mentioned principal is not an active room member",
          );
        }
      }

      const contextualIds = [input.replyToMessageId, input.threadRootMessageId].filter(
        (value): value is string => Boolean(value),
      );
      if (contextualIds.length > 0) {
        const context = await client.query<{ id: string }>(
          `SELECT id FROM room_messages
           WHERE room_id = $1 AND id = ANY($2::uuid[])`,
          [input.roomId, contextualIds],
        );
        if (context.rowCount !== new Set(contextualIds).size) {
          throw new Error("Reply or thread context does not belong to this room");
        }
      }

      const messageId = randomUUID();
      await client.query(
        `INSERT INTO room_messages
          (id, room_id, sender_principal_id, kind, content, status,
           idempotency_key, reply_to_message_id, thread_root_message_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          messageId,
          input.roomId,
          input.senderPrincipalId,
          input.kind,
          input.content,
          input.status,
          input.idempotencyKey,
          input.replyToMessageId ?? null,
          input.threadRootMessageId ?? null,
        ],
      );
      if (mentionedPrincipalIds.length > 0) {
        await client.query(
          `INSERT INTO message_mentions (message_id, mentioned_principal_id)
           SELECT $1, unnest($2::uuid[])`,
          [messageId, mentionedPrincipalIds],
        );
      }
      if (attachmentIds.length > 0) {
        await client.query(
          `INSERT INTO message_attachments
            (workspace_id, room_id, message_id, attachment_id, position)
           SELECT $1, $2, $3, value::uuid, ordinal - 1
           FROM unnest($4::text[]) WITH ORDINALITY AS selected(value, ordinal)`,
          [workspaceId, input.roomId, messageId, attachmentIds],
        );
        await client.query(
          `UPDATE attachments SET expires_at = NULL, updated_at = NOW()
           WHERE id = ANY($1::uuid[])`,
          [attachmentIds],
        );
      }
      await client.query(
        `INSERT INTO room_message_revisions
          (id, room_id, message_id, revision_number, action,
           actor_principal_id, content, mentioned_principal_ids)
         VALUES ($1, $2, $3, 1, 'created', $4, $5, $6::uuid[])`,
        [
          randomUUID(),
          input.roomId,
          messageId,
          input.senderPrincipalId,
          input.content,
          mentionedPrincipalIds,
        ],
      );
      return { duplicate: false, message: await selectMessage(client, messageId) };
    });
  }

  async editMessage(input: {
    roomId: string;
    messageId: string;
    actorPrincipalId: string;
    content: string;
    expectedRevisionNumber: number;
  }): Promise<RoomMessageRecord> {
    return withTransaction(this.pool, async (client) => {
      const message = await selectMessageForMutation(client, input);
      if (
        message.sender_principal_id === input.actorPrincipalId &&
        !message.retracted_at &&
        message.revision_number === input.expectedRevisionNumber + 1 &&
        message.content === input.content
      ) {
        return selectMessage(client, input.messageId);
      }
      this.assertMessageCanMutate(message, input.actorPrincipalId, input.expectedRevisionNumber);
      if (!input.content.trim() && !message.has_attachment) {
        throw new MessageRevisionConflictError(
          "A message without attachments cannot be empty",
        );
      }
      const revisionNumber = message.revision_number + 1;
      await client.query(
        `UPDATE room_messages
         SET content = $3, revision_number = $4, updated_at = NOW()
         WHERE room_id = $1 AND id = $2`,
        [input.roomId, input.messageId, input.content, revisionNumber],
      );
      await client.query(
        `INSERT INTO room_message_revisions
          (id, room_id, message_id, revision_number, action,
           actor_principal_id, content, mentioned_principal_ids)
         VALUES ($1, $2, $3, $4, 'edited', $5, $6, $7::uuid[])`,
        [
          randomUUID(),
          input.roomId,
          input.messageId,
          revisionNumber,
          input.actorPrincipalId,
          input.content,
          message.mentioned_principal_ids,
        ],
      );
      return selectMessage(client, input.messageId);
    });
  }

  async retractMessage(input: {
    roomId: string;
    messageId: string;
    actorPrincipalId: string;
    expectedRevisionNumber: number;
  }): Promise<RoomMessageRecord> {
    return withTransaction(this.pool, async (client) => {
      const message = await selectMessageForMutation(client, input);
      if (
        message.sender_principal_id === input.actorPrincipalId &&
        message.retracted_by_principal_id === input.actorPrincipalId &&
        message.revision_number === input.expectedRevisionNumber + 1
      ) {
        return selectMessage(client, input.messageId);
      }
      this.assertMessageCanMutate(message, input.actorPrincipalId, input.expectedRevisionNumber);
      const revisionNumber = message.revision_number + 1;
      await client.query(
        `UPDATE room_messages
         SET content = '', revision_number = $4, retracted_at = NOW(),
             retracted_by_principal_id = $3, updated_at = NOW()
         WHERE room_id = $1 AND id = $2`,
        [input.roomId, input.messageId, input.actorPrincipalId, revisionNumber],
      );
      await client.query(
        `INSERT INTO room_message_revisions
          (id, room_id, message_id, revision_number, action,
           actor_principal_id, content, mentioned_principal_ids)
         VALUES ($1, $2, $3, $4, 'retracted', $5, $6, $7::uuid[])`,
        [
          randomUUID(),
          input.roomId,
          input.messageId,
          revisionNumber,
          input.actorPrincipalId,
          message.content,
          message.mentioned_principal_ids,
        ],
      );
      await client.query("DELETE FROM message_mentions WHERE message_id = $1", [
        input.messageId,
      ]);
      return selectMessage(client, input.messageId);
    });
  }

  async listMessageRevisions(
    messageId: string,
  ): Promise<RoomMessageRevisionRecord[]> {
    const result = await this.pool.query<RoomMessageRevisionRow>(
      `SELECT * FROM room_message_revisions
       WHERE message_id = $1
       ORDER BY revision_number`,
      [messageId],
    );
    return result.rows.map(mapMessageRevision);
  }

  private assertMessageCanMutate(
    message: MutableRoomMessageRow,
    actorPrincipalId: string,
    expectedRevisionNumber: number,
  ): void {
    if (
      message.sender_principal_id !== actorPrincipalId ||
      message.sender_kind !== "human" ||
      message.kind !== "message"
    ) {
      throw new MessageMutationPermissionError();
    }
    if (message.room_status !== "active") {
      throw new RoomLifecycleConflictError("An archived room cannot change messages");
    }
    if (message.status !== "completed" || message.has_active_run) {
      throw new MessageRevisionConflictError(
        "A message with active execution cannot be changed",
      );
    }
    if (message.retracted_at) {
      throw new MessageRevisionConflictError("A retracted message cannot be changed");
    }
    if (message.revision_number !== expectedRevisionNumber) {
      throw new MessageRevisionConflictError("The message revision is stale");
    }
  }

  async listMessages(roomId: string): Promise<RoomMessageRecord[]> {
    const result = await this.pool.query<RoomMessageRow>(
      `SELECT room_messages.*,
         COALESCE(
           array_agg(message_mentions.mentioned_principal_id
             ORDER BY message_mentions.mentioned_principal_id)
             FILTER (WHERE message_mentions.mentioned_principal_id IS NOT NULL),
           ARRAY[]::uuid[]
         ) AS mentioned_principal_ids
       FROM room_messages
       LEFT JOIN message_mentions ON message_mentions.message_id = room_messages.id
       WHERE room_messages.room_id = $1
       GROUP BY room_messages.id
       ORDER BY room_messages.created_at, room_messages.id`,
      [roomId],
    );
    return result.rows.map(mapMessage);
  }

  getMessage(messageId: string): Promise<RoomMessageRecord> {
    return selectMessage(this.pool, messageId);
  }
}
