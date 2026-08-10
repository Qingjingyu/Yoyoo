import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type {
  AttachmentAccessGrantRecord,
  AttachmentProvenance,
  AttachmentRecord,
  AttachmentStatus,
  LinkedAttachmentRecord,
} from "@/domain/collaboration";
import { withTransaction } from "@/server/postgres/transaction";

interface AttachmentRow {
  id: string;
  workspace_id: string;
  uploader_principal_id: string;
  object_key: string;
  original_name: string;
  declared_media_type: string;
  detected_media_type: string | null;
  size_bytes: string | number | null;
  sha256: string | null;
  status: AttachmentStatus;
  provenance: AttachmentProvenance;
  source_run_id: string | null;
  error_code: string | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface LinkedAttachmentRow extends AttachmentRow {
  room_id: string;
  message_id: string;
  position: number;
  linked_at: Date;
}

interface AccessGrantRow {
  id: string;
  workspace_id: string;
  room_id: string;
  attachment_id: string;
  run_id: string;
  principal_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapAttachment(row: AttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    uploaderPrincipalId: row.uploader_principal_id,
    objectKey: row.object_key,
    originalName: row.original_name,
    declaredMediaType: row.declared_media_type,
    detectedMediaType: row.detected_media_type,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    sha256: row.sha256,
    status: row.status,
    provenance: row.provenance,
    sourceRunId: row.source_run_id,
    errorCode: row.error_code,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLinkedAttachment(row: LinkedAttachmentRow): LinkedAttachmentRecord {
  return {
    ...mapAttachment(row),
    roomId: row.room_id,
    messageId: row.message_id,
    position: row.position,
    linkedAt: row.linked_at,
  };
}

function mapGrant(row: AccessGrantRow): AttachmentAccessGrantRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    roomId: row.room_id,
    attachmentId: row.attachment_id,
    runId: row.run_id,
    principalId: row.principal_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function selectAttachment(
  client: Pool | PoolClient,
  attachmentId: string,
): Promise<AttachmentRecord | null> {
  const result = await client.query<AttachmentRow>(
    "SELECT * FROM attachments WHERE id = $1",
    [attachmentId],
  );
  return result.rows[0] ? mapAttachment(result.rows[0]) : null;
}

export class AttachmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentConflictError";
  }
}

export class AttachmentPermissionError extends Error {
  constructor(message = "Attachment is not accessible") {
    super(message);
    this.name = "AttachmentPermissionError";
  }
}

export class AttachmentRepository {
  constructor(private readonly pool: Pool) {}

  async createPending(input: {
    workspaceId: string;
    uploaderPrincipalId: string;
    objectKey: string;
    originalName: string;
    declaredMediaType: string;
    expiresAt: Date;
    provenance?: AttachmentProvenance;
    sourceRunId?: string | null;
  }): Promise<{ duplicate: boolean; attachment: AttachmentRecord }> {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `attachment-object:${input.objectKey}`,
      ]);
      const existing = await client.query<AttachmentRow>(
        "SELECT * FROM attachments WHERE object_key = $1",
        [input.objectKey],
      );
      if (existing.rows[0]) {
        const attachment = mapAttachment(existing.rows[0]);
        if (
          attachment.workspaceId !== input.workspaceId ||
          attachment.uploaderPrincipalId !== input.uploaderPrincipalId ||
          attachment.originalName !== input.originalName ||
          attachment.declaredMediaType !== input.declaredMediaType ||
          attachment.provenance !== (input.provenance ?? "human_upload") ||
          attachment.sourceRunId !== (input.sourceRunId ?? null)
        ) {
          throw new AttachmentConflictError(
            "Object key already belongs to a different upload",
          );
        }
        return { duplicate: true, attachment };
      }

      const membership = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM workspace_members
           JOIN workspaces ON workspaces.id = workspace_members.workspace_id
           JOIN principals ON principals.id = workspace_members.principal_id
           WHERE workspace_members.workspace_id = $1
             AND workspace_members.principal_id = $2
             AND workspace_members.status = 'active'
             AND workspaces.status = 'active'
             AND principals.status = 'active'
         ) AS exists`,
        [input.workspaceId, input.uploaderPrincipalId],
      );
      if (!membership.rows[0].exists) {
        throw new AttachmentPermissionError(
          "Uploader is not an active workspace member",
        );
      }

      const result = await client.query<AttachmentRow>(
        `INSERT INTO attachments
          (id, workspace_id, uploader_principal_id, object_key, original_name,
           declared_media_type, provenance, source_run_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          randomUUID(),
          input.workspaceId,
          input.uploaderPrincipalId,
          input.objectKey,
          input.originalName,
          input.declaredMediaType,
          input.provenance ?? "human_upload",
          input.sourceRunId ?? null,
          input.expiresAt,
        ],
      );
      return { duplicate: false, attachment: mapAttachment(result.rows[0]) };
    });
  }

  async markReady(input: {
    attachmentId: string;
    principalId: string;
    detectedMediaType: string;
    sizeBytes: number;
    sha256: string;
  }): Promise<AttachmentRecord> {
    return withTransaction(this.pool, async (client) => {
      const current = await client.query<AttachmentRow>(
        "SELECT * FROM attachments WHERE id = $1 FOR UPDATE",
        [input.attachmentId],
      );
      if (!current.rows[0]) throw new AttachmentConflictError("Attachment not found");
      const attachment = mapAttachment(current.rows[0]);
      if (attachment.uploaderPrincipalId !== input.principalId) {
        throw new AttachmentPermissionError(
          "Attachment is not owned by the current principal",
        );
      }
      if (attachment.status === "ready") {
        if (
          attachment.detectedMediaType === input.detectedMediaType &&
          attachment.sizeBytes === input.sizeBytes &&
          attachment.sha256 === input.sha256
        ) {
          return attachment;
        }
        throw new AttachmentConflictError("Attachment is already ready");
      }
      if (attachment.status !== "pending") {
        throw new AttachmentConflictError("Attachment is not pending");
      }

      const result = await client.query<AttachmentRow>(
        `UPDATE attachments
         SET detected_media_type = $2, size_bytes = $3, sha256 = $4,
             status = 'ready', updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [
          input.attachmentId,
          input.detectedMediaType,
          input.sizeBytes,
          input.sha256,
        ],
      );
      return mapAttachment(result.rows[0]);
    });
  }

  async markFailed(input: {
    attachmentId: string;
    principalId: string;
    errorCode: string;
    expiresAt: Date;
  }): Promise<AttachmentRecord> {
    const result = await this.pool.query<AttachmentRow>(
      `UPDATE attachments
       SET status = 'failed', error_code = $3, expires_at = $4, updated_at = NOW()
       WHERE id = $1 AND uploader_principal_id = $2 AND status = 'pending'
       RETURNING *`,
      [input.attachmentId, input.principalId, input.errorCode, input.expiresAt],
    );
    if (!result.rows[0]) {
      throw new AttachmentConflictError("Pending attachment not found");
    }
    return mapAttachment(result.rows[0]);
  }

  async linkReadyToMessage(input: {
    workspaceId: string;
    roomId: string;
    messageId: string;
    principalId: string;
    attachmentIds: string[];
  }): Promise<LinkedAttachmentRecord[]> {
    const attachmentIds = [...new Set(input.attachmentIds)];
    if (attachmentIds.length === 0 || attachmentIds.length > 10) {
      throw new AttachmentConflictError("Between one and ten attachments are required");
    }

    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `message-attachments:${input.messageId}`,
      ]);
      const linked = await this.listForMessageWithClient(client, input.messageId);
      if (linked.length > 0) {
        if (
          linked.length === attachmentIds.length &&
          linked.every((attachment) => attachmentIds.includes(attachment.id))
        ) {
          return linked;
        }
        throw new AttachmentConflictError("Message already has different attachments");
      }

      const message = await client.query<{ id: string }>(
        `SELECT room_messages.id
         FROM room_messages
         JOIN rooms ON rooms.id = room_messages.room_id
         JOIN room_members ON room_members.room_id = rooms.id
         WHERE room_messages.id = $1
           AND room_messages.room_id = $2
           AND rooms.workspace_id = $3
           AND rooms.status = 'active'
           AND room_messages.sender_principal_id = $4
           AND room_members.principal_id = $4
           AND room_members.status = 'active'`,
        [input.messageId, input.roomId, input.workspaceId, input.principalId],
      );
      if (!message.rows[0]) {
        throw new AttachmentPermissionError(
          "Message is not writable by the current principal",
        );
      }

      const attachments = await client.query<AttachmentRow>(
        `SELECT * FROM attachments
         WHERE id = ANY($1::uuid[])
           AND workspace_id = $2
         FOR UPDATE`,
        [attachmentIds, input.workspaceId],
      );
      if (
        attachments.rows.some(
          (row) => row.uploader_principal_id !== input.principalId,
        )
      ) {
        throw new AttachmentPermissionError(
          "Attachment is not owned by the current principal",
        );
      }
      if (attachments.rowCount !== attachmentIds.length) {
        throw new AttachmentConflictError("An attachment was not found");
      }
      if (attachments.rows.some((row) => row.status !== "ready")) {
        throw new AttachmentConflictError("Every attachment must be ready");
      }

      const alreadyLinked = await client.query<{ attachment_id: string }>(
        `SELECT attachment_id FROM message_attachments
         WHERE attachment_id = ANY($1::uuid[])`,
        [attachmentIds],
      );
      if ((alreadyLinked.rowCount ?? 0) > 0) {
        throw new AttachmentConflictError("An attachment is already linked");
      }

      await client.query(
        `INSERT INTO message_attachments
          (workspace_id, room_id, message_id, attachment_id, position)
         SELECT $1, $2, $3, value::uuid, ordinal - 1
         FROM unnest($4::text[]) WITH ORDINALITY AS selected(value, ordinal)`,
        [input.workspaceId, input.roomId, input.messageId, attachmentIds],
      );
      await client.query(
        `UPDATE attachments SET expires_at = NULL, updated_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [attachmentIds],
      );
      return this.listForMessageWithClient(client, input.messageId);
    });
  }

  async listForMessage(messageId: string): Promise<LinkedAttachmentRecord[]> {
    return this.listForMessageWithClient(this.pool, messageId);
  }

  async listForRoom(roomId: string): Promise<LinkedAttachmentRecord[]> {
    const result = await this.pool.query<LinkedAttachmentRow>(
      `SELECT attachments.*, message_attachments.room_id,
              message_attachments.message_id, message_attachments.position,
              message_attachments.linked_at
       FROM message_attachments
       JOIN attachments ON attachments.id = message_attachments.attachment_id
       JOIN room_messages ON room_messages.id = message_attachments.message_id
       WHERE message_attachments.room_id = $1 AND attachments.status = 'ready'
         AND room_messages.retracted_at IS NULL
       ORDER BY message_attachments.linked_at, message_attachments.message_id,
                message_attachments.position`,
      [roomId],
    );
    return result.rows.map(mapLinkedAttachment);
  }

  async getForRoomMember(input: {
    attachmentId: string;
    roomId: string;
    principalId: string;
  }): Promise<LinkedAttachmentRecord | null> {
    const result = await this.pool.query<LinkedAttachmentRow>(
      `SELECT attachments.*, message_attachments.room_id,
              message_attachments.message_id, message_attachments.position,
              message_attachments.linked_at
       FROM message_attachments
       JOIN attachments ON attachments.id = message_attachments.attachment_id
       JOIN room_messages ON room_messages.id = message_attachments.message_id
       JOIN rooms ON rooms.id = message_attachments.room_id
       JOIN room_members
         ON room_members.room_id = message_attachments.room_id
        AND room_members.principal_id = $3
       JOIN workspace_members
         ON workspace_members.workspace_id = message_attachments.workspace_id
        AND workspace_members.principal_id = $3
       JOIN principals ON principals.id = $3
       WHERE message_attachments.attachment_id = $1
         AND message_attachments.room_id = $2
         AND attachments.status = 'ready'
         AND room_messages.retracted_at IS NULL
         AND room_members.status = 'active'
         AND workspace_members.status = 'active'
         AND principals.status = 'active'
         AND rooms.status IN ('active', 'archived')`,
      [input.attachmentId, input.roomId, input.principalId],
    );
    return result.rows[0] ? mapLinkedAttachment(result.rows[0]) : null;
  }

  private async listForMessageWithClient(
    client: Pool | PoolClient,
    messageId: string,
  ): Promise<LinkedAttachmentRecord[]> {
    const result = await client.query<LinkedAttachmentRow>(
      `SELECT attachments.*, message_attachments.room_id,
              message_attachments.message_id, message_attachments.position,
              message_attachments.linked_at
       FROM message_attachments
       JOIN attachments ON attachments.id = message_attachments.attachment_id
       JOIN room_messages ON room_messages.id = message_attachments.message_id
       WHERE message_attachments.message_id = $1
         AND room_messages.retracted_at IS NULL
       ORDER BY message_attachments.position`,
      [messageId],
    );
    return result.rows.map(mapLinkedAttachment);
  }

  async createAccessGrant(input: {
    workspaceId: string;
    roomId: string;
    attachmentId: string;
    runId: string;
    principalId: string;
    expiresAt: Date;
  }): Promise<AttachmentAccessGrantRecord> {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `attachment-grant:${input.attachmentId}:${input.runId}:${input.principalId}`,
      ]);
      const existing = await client.query<AccessGrantRow>(
        `SELECT * FROM attachment_access_grants
         WHERE attachment_id = $1 AND run_id = $2 AND principal_id = $3`,
        [input.attachmentId, input.runId, input.principalId],
      );
      if (existing.rows[0]) return mapGrant(existing.rows[0]);

      const eligible = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM room_runs
           JOIN rooms ON rooms.id = room_runs.room_id
           JOIN room_members ON room_members.room_id = room_runs.room_id
             AND room_members.principal_id = room_runs.target_agent_principal_id
           JOIN message_attachments
             ON message_attachments.message_id = room_runs.trigger_message_id
             AND message_attachments.room_id = room_runs.room_id
           JOIN room_messages
             ON room_messages.id = room_runs.trigger_message_id
           WHERE room_runs.id = $1
             AND room_runs.room_id = $2
             AND room_runs.target_agent_principal_id = $3
             AND rooms.workspace_id = $4
             AND rooms.status = 'active'
             AND room_members.status = 'active'
             AND room_messages.retracted_at IS NULL
             AND message_attachments.attachment_id = $5
         ) AS exists`,
        [
          input.runId,
          input.roomId,
          input.principalId,
          input.workspaceId,
          input.attachmentId,
        ],
      );
      if (!eligible.rows[0].exists) {
        throw new AttachmentPermissionError(
          "Attachment grant does not match an eligible Agent run",
        );
      }

      const result = await client.query<AccessGrantRow>(
        `INSERT INTO attachment_access_grants
          (id, workspace_id, room_id, attachment_id, run_id, principal_id,
           expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          randomUUID(),
          input.workspaceId,
          input.roomId,
          input.attachmentId,
          input.runId,
          input.principalId,
          input.expiresAt,
        ],
      );
      return mapGrant(result.rows[0]);
    });
  }

  async getAgentOutputScope(input: {
    runId: string;
    principalId: string;
  }): Promise<{ workspaceId: string; roomId: string } | null> {
    const result = await this.pool.query<{
      workspace_id: string;
      room_id: string;
    }>(
      `SELECT rooms.workspace_id, room_runs.room_id
       FROM room_runs
       JOIN rooms ON rooms.id = room_runs.room_id
       JOIN room_members
         ON room_members.room_id = room_runs.room_id
        AND room_members.principal_id = room_runs.target_agent_principal_id
       JOIN workspace_members
         ON workspace_members.workspace_id = rooms.workspace_id
        AND workspace_members.principal_id = room_runs.target_agent_principal_id
       JOIN principals ON principals.id = room_runs.target_agent_principal_id
       WHERE room_runs.id = $1
         AND room_runs.target_agent_principal_id = $2
         AND room_runs.status IN ('queued', 'running', 'waiting')
         AND rooms.status = 'active'
         AND room_members.status = 'active'
         AND workspace_members.status = 'active'
         AND principals.status = 'active'`,
      [input.runId, input.principalId],
    );
    return result.rows[0]
      ? {
          workspaceId: result.rows[0].workspace_id,
          roomId: result.rows[0].room_id,
        }
      : null;
  }

  async getGrantedAttachment(input: {
    grantId: string;
    principalId: string;
    now: Date;
  }): Promise<AttachmentRecord | null> {
    const result = await this.pool.query<AttachmentRow>(
      `SELECT attachments.*
       FROM attachment_access_grants
       JOIN attachments ON attachments.id = attachment_access_grants.attachment_id
       JOIN message_attachments
         ON message_attachments.attachment_id = attachment_access_grants.attachment_id
        AND message_attachments.room_id = attachment_access_grants.room_id
       JOIN room_messages ON room_messages.id = message_attachments.message_id
       JOIN room_runs ON room_runs.id = attachment_access_grants.run_id
       JOIN room_members
         ON room_members.room_id = attachment_access_grants.room_id
         AND room_members.principal_id = attachment_access_grants.principal_id
       JOIN workspace_members
         ON workspace_members.workspace_id = attachment_access_grants.workspace_id
         AND workspace_members.principal_id = attachment_access_grants.principal_id
       JOIN principals ON principals.id = attachment_access_grants.principal_id
       WHERE attachment_access_grants.id = $1
         AND attachment_access_grants.principal_id = $2
         AND attachment_access_grants.revoked_at IS NULL
         AND attachment_access_grants.expires_at > $3
         AND room_runs.target_agent_principal_id = $2
         AND room_members.status = 'active'
         AND workspace_members.status = 'active'
         AND principals.status = 'active'
         AND room_messages.retracted_at IS NULL
         AND attachments.status = 'ready'`,
      [input.grantId, input.principalId, input.now],
    );
    return result.rows[0] ? mapAttachment(result.rows[0]) : null;
  }

  async getGrantedAttachmentByScope(input: {
    attachmentId: string;
    runId: string;
    principalId: string;
    now: Date;
  }): Promise<AttachmentRecord | null> {
    const result = await this.pool.query<AttachmentRow>(
      `SELECT attachments.*
       FROM attachment_access_grants
       JOIN attachments ON attachments.id = attachment_access_grants.attachment_id
       JOIN message_attachments
         ON message_attachments.attachment_id = attachment_access_grants.attachment_id
        AND message_attachments.room_id = attachment_access_grants.room_id
       JOIN room_messages ON room_messages.id = message_attachments.message_id
       JOIN room_runs ON room_runs.id = attachment_access_grants.run_id
       JOIN rooms ON rooms.id = attachment_access_grants.room_id
       JOIN room_members
         ON room_members.room_id = attachment_access_grants.room_id
        AND room_members.principal_id = attachment_access_grants.principal_id
       JOIN workspace_members
         ON workspace_members.workspace_id = attachment_access_grants.workspace_id
        AND workspace_members.principal_id = attachment_access_grants.principal_id
       JOIN principals ON principals.id = attachment_access_grants.principal_id
       WHERE attachment_access_grants.attachment_id = $1
         AND attachment_access_grants.run_id = $2
         AND attachment_access_grants.principal_id = $3
         AND attachment_access_grants.revoked_at IS NULL
         AND attachment_access_grants.expires_at > $4
         AND room_runs.target_agent_principal_id = $3
         AND room_runs.room_id = attachment_access_grants.room_id
         AND rooms.workspace_id = attachment_access_grants.workspace_id
         AND rooms.status IN ('active', 'archived')
         AND room_members.status = 'active'
         AND workspace_members.status = 'active'
         AND principals.status = 'active'
         AND attachments.workspace_id = attachment_access_grants.workspace_id
         AND room_messages.retracted_at IS NULL
         AND attachments.status = 'ready'`,
      [input.attachmentId, input.runId, input.principalId, input.now],
    );
    return result.rows[0] ? mapAttachment(result.rows[0]) : null;
  }

  async revokeAccessGrant(grantId: string): Promise<void> {
    await this.pool.query(
      `UPDATE attachment_access_grants
       SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW()
       WHERE id = $1`,
      [grantId],
    );
  }

  async listExpiredUnlinked(now: Date): Promise<AttachmentRecord[]> {
    const result = await this.pool.query<AttachmentRow>(
      `SELECT * FROM attachments
       WHERE status IN ('pending', 'failed') AND expires_at < $1
         AND NOT EXISTS (
           SELECT 1 FROM message_attachments
           WHERE message_attachments.attachment_id = attachments.id
         )
       ORDER BY expires_at, id`,
      [now],
    );
    return result.rows.map(mapAttachment);
  }

  async listExpiredPending(now: Date): Promise<AttachmentRecord[]> {
    const result = await this.pool.query<AttachmentRow>(
      `SELECT * FROM attachments
       WHERE status = 'pending' AND expires_at < $1
         AND NOT EXISTS (
           SELECT 1 FROM message_attachments
           WHERE message_attachments.attachment_id = attachments.id
         )
       ORDER BY expires_at, id`,
      [now],
    );
    return result.rows.map(mapAttachment);
  }

  async deleteExpiredUnlinked(attachmentId: string, now: Date): Promise<void> {
    await this.pool.query(
      `DELETE FROM attachments
       WHERE id = $1 AND status IN ('pending', 'failed') AND expires_at < $2
         AND NOT EXISTS (
           SELECT 1 FROM message_attachments
           WHERE message_attachments.attachment_id = attachments.id
         )`,
      [attachmentId, now],
    );
  }

  async deletePending(attachmentId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM attachments
       WHERE id = $1 AND status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM message_attachments
           WHERE message_attachments.attachment_id = attachments.id
         )`,
      [attachmentId],
    );
  }

  getById(attachmentId: string): Promise<AttachmentRecord | null> {
    return selectAttachment(this.pool, attachmentId);
  }
}
