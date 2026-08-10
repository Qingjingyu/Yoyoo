import type { Pool, PoolClient } from "pg";

import type { RoomMemberStateRecord, RoomStatus } from "@/domain/collaboration";
import { RoomLifecycleConflictError, RoomNotFoundError } from "@/server/postgres/room-repository";
import { withTransaction } from "@/server/postgres/transaction";

interface MemberStateRow {
  room_id: string;
  principal_id: string;
  last_read_message_id: string | null;
  reading_message_id: string | null;
  draft_content: string;
  draft_revision: string | number;
  last_read_at: Date | null;
  reading_position_updated_at: Date | null;
  draft_updated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface LockedMemberStateRow extends MemberStateRow {
  room_status: RoomStatus;
}

function mapState(row: MemberStateRow): RoomMemberStateRecord {
  return {
    roomId: row.room_id,
    principalId: row.principal_id,
    lastReadMessageId: row.last_read_message_id,
    readingMessageId: row.reading_message_id,
    draftContent: row.draft_content,
    draftRevision: Number(row.draft_revision),
    lastReadAt: row.last_read_at,
    readingPositionUpdatedAt: row.reading_position_updated_at,
    draftUpdatedAt: row.draft_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DraftRevisionConflictError extends Error {
  constructor() {
    super("The room draft revision is stale");
    this.name = "DraftRevisionConflictError";
  }
}

async function ensureState(
  client: Pool | PoolClient,
  roomId: string,
  principalId: string,
): Promise<MemberStateRow> {
  const result = await client.query<MemberStateRow>(
    `INSERT INTO room_member_states (room_id, principal_id)
     SELECT room_members.room_id, room_members.principal_id
     FROM room_members
     JOIN rooms ON rooms.id = room_members.room_id
     JOIN workspace_members
       ON workspace_members.workspace_id = rooms.workspace_id
      AND workspace_members.principal_id = room_members.principal_id
     JOIN principals ON principals.id = room_members.principal_id
     WHERE room_members.room_id = $1
       AND room_members.principal_id = $2
       AND room_members.status = 'active'
       AND workspace_members.status = 'active'
       AND principals.status = 'active'
     ON CONFLICT (room_id, principal_id) DO UPDATE
       SET updated_at = room_member_states.updated_at
     RETURNING *`,
    [roomId, principalId],
  );
  if (!result.rows[0]) throw new RoomNotFoundError();
  return result.rows[0];
}

async function lockState(
  client: PoolClient,
  roomId: string,
  principalId: string,
): Promise<LockedMemberStateRow> {
  await ensureState(client, roomId, principalId);
  const result = await client.query<LockedMemberStateRow>(
    `SELECT room_member_states.*, rooms.status AS room_status
     FROM room_member_states
     JOIN rooms ON rooms.id = room_member_states.room_id
     WHERE room_member_states.room_id = $1
       AND room_member_states.principal_id = $2
     FOR UPDATE OF room_member_states`,
    [roomId, principalId],
  );
  if (!result.rows[0]) throw new RoomNotFoundError();
  return result.rows[0];
}

export class MemberStateRepository {
  constructor(private readonly pool: Pool) {}

  async get(roomId: string, principalId: string): Promise<RoomMemberStateRecord> {
    return mapState(await ensureState(this.pool, roomId, principalId));
  }

  async updateRead(input: {
    roomId: string;
    principalId: string;
    lastReadMessageId?: string;
    readingMessageId?: string;
  }): Promise<RoomMemberStateRecord> {
    if (!input.lastReadMessageId && !input.readingMessageId) {
      throw new SyntaxError("A read or reading-position message is required");
    }
    return withTransaction(this.pool, async (client) => {
      const state = await lockState(client, input.roomId, input.principalId);
      const requestedIds = [...new Set([
        input.lastReadMessageId,
        input.readingMessageId,
      ].filter((value): value is string => Boolean(value)))];
      const requested = await client.query<{
        id: string;
        created_at: Date;
      }>(
        `SELECT id, created_at FROM room_messages
         WHERE room_id = $1 AND id = ANY($2::uuid[])`,
        [input.roomId, requestedIds],
      );
      if (requested.rowCount !== requestedIds.length) {
        throw new RoomNotFoundError();
      }
      const byId = new Map(requested.rows.map((message) => [message.id, message]));
      let shouldAdvance = false;
      if (input.lastReadMessageId) {
        if (!state.last_read_message_id) {
          shouldAdvance = true;
        } else {
          const current = await client.query<{ id: string; created_at: Date }>(
            `SELECT id, created_at FROM room_messages
             WHERE room_id = $1 AND id = $2`,
            [input.roomId, state.last_read_message_id],
          );
          const next = byId.get(input.lastReadMessageId)!;
          const previous = current.rows[0];
          shouldAdvance = !previous
            || next.created_at > previous.created_at
            || (next.created_at.getTime() === previous.created_at.getTime()
              && next.id >= previous.id);
        }
      }
      const result = await client.query<MemberStateRow>(
        `UPDATE room_member_states SET
           last_read_message_id = CASE WHEN $3 THEN $4 ELSE last_read_message_id END,
           last_read_at = CASE WHEN $3 THEN NOW() ELSE last_read_at END,
           reading_message_id = COALESCE($5, reading_message_id),
           reading_position_updated_at = CASE
             WHEN $5::uuid IS NOT NULL THEN NOW() ELSE reading_position_updated_at END,
           updated_at = NOW()
         WHERE room_id = $1 AND principal_id = $2
         RETURNING *`,
        [
          input.roomId,
          input.principalId,
          shouldAdvance,
          input.lastReadMessageId ?? null,
          input.readingMessageId ?? null,
        ],
      );
      return mapState(result.rows[0]);
    });
  }

  async saveDraft(input: {
    roomId: string;
    principalId: string;
    content: string;
    expectedRevision: number;
  }): Promise<RoomMemberStateRecord> {
    return withTransaction(this.pool, async (client) => {
      const state = await lockState(client, input.roomId, input.principalId);
      if (state.room_status !== "active") {
        throw new RoomLifecycleConflictError("An archived room cannot save a draft");
      }
      const currentRevision = Number(state.draft_revision);
      if (
        currentRevision === input.expectedRevision + 1
        && state.draft_content === input.content
      ) {
        return mapState(state);
      }
      if (currentRevision !== input.expectedRevision) {
        throw new DraftRevisionConflictError();
      }
      const result = await client.query<MemberStateRow>(
        `UPDATE room_member_states
         SET draft_content = $3, draft_revision = draft_revision + 1,
             draft_updated_at = NOW(), updated_at = NOW()
         WHERE room_id = $1 AND principal_id = $2
         RETURNING *`,
        [input.roomId, input.principalId, input.content],
      );
      return mapState(result.rows[0]);
    });
  }

  async clearDraftAfterSend(input: {
    roomId: string;
    principalId: string;
    submittedRevision: number;
  }): Promise<RoomMemberStateRecord> {
    return withTransaction(this.pool, async (client) => {
      const state = await lockState(client, input.roomId, input.principalId);
      const currentRevision = Number(state.draft_revision);
      if (currentRevision === input.submittedRevision && state.draft_content !== "") {
        const result = await client.query<MemberStateRow>(
          `UPDATE room_member_states
           SET draft_content = '', draft_revision = draft_revision + 1,
               draft_updated_at = NOW(), updated_at = NOW()
           WHERE room_id = $1 AND principal_id = $2
           RETURNING *`,
          [input.roomId, input.principalId],
        );
        return mapState(result.rows[0]);
      }
      return mapState(state);
    });
  }
}
