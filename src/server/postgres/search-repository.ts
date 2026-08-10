import type { Pool } from "pg";

import type { AttachmentProvenance } from "@/domain/collaboration";

export type SearchResultKind = "message" | "file";
export type SearchResourceCategory = "message" | "image" | "document" | "archive" | "agent_output";

export interface SearchResultRecord {
  id: string;
  kind: SearchResultKind;
  category: SearchResourceCategory;
  workspaceId: string;
  roomId: string;
  roomName: string;
  messageId: string;
  senderPrincipalId: string;
  senderDisplayName: string;
  text: string;
  mediaType: string | null;
  provenance: AttachmentProvenance | null;
  createdAt: Date;
}

interface SearchRow {
  id: string;
  kind: SearchResultKind;
  category: SearchResourceCategory;
  workspace_id: string;
  room_id: string;
  room_name: string;
  message_id: string;
  sender_principal_id: string;
  sender_display_name: string;
  text: string;
  media_type: string | null;
  provenance: AttachmentProvenance | null;
  created_at: Date;
}

function mapResult(row: SearchRow): SearchResultRecord {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    workspaceId: row.workspace_id,
    roomId: row.room_id,
    roomName: row.room_name,
    messageId: row.message_id,
    senderPrincipalId: row.sender_principal_id,
    senderDisplayName: row.sender_display_name,
    text: row.text,
    mediaType: row.media_type,
    provenance: row.provenance,
    createdAt: row.created_at,
  };
}

export class SearchRepository {
  constructor(private readonly pool: Pool) {}

  async search(input: {
    workspaceId: string;
    principalId: string;
    query: string;
    roomId?: string;
    senderPrincipalId?: string;
    category?: SearchResourceCategory | "file";
    from?: Date;
    to?: Date;
    before?: { createdAt: Date; id: string };
    limit: number;
  }): Promise<SearchResultRecord[]> {
    const pattern = `%${input.query.replace(/[\\%_]/gu, "\\$&")}%`;
    const result = await this.pool.query<SearchRow>(
      `WITH visible_rooms AS (
         SELECT rooms.id, rooms.workspace_id, rooms.name
         FROM rooms
         JOIN room_members
           ON room_members.room_id = rooms.id
          AND room_members.principal_id = $2
         JOIN workspace_members
           ON workspace_members.workspace_id = rooms.workspace_id
          AND workspace_members.principal_id = $2
         JOIN principals ON principals.id = $2
         WHERE rooms.workspace_id = $1
           AND rooms.status IN ('active', 'archived')
           AND room_members.status = 'active'
           AND workspace_members.status = 'active'
           AND principals.status = 'active'
       ), candidates AS (
         SELECT messages.id, 'message'::text AS kind,
                'message'::text AS category, visible_rooms.workspace_id,
                visible_rooms.id AS room_id, visible_rooms.name AS room_name,
                messages.id AS message_id, messages.sender_principal_id,
                sender.display_name AS sender_display_name,
                left(messages.content, 320) AS text,
                NULL::text AS media_type, NULL::text AS provenance,
                messages.created_at
         FROM visible_rooms
         JOIN room_messages AS messages ON messages.room_id = visible_rooms.id
         JOIN principals AS sender ON sender.id = messages.sender_principal_id
         WHERE messages.status = 'completed'
           AND messages.retracted_at IS NULL
           AND btrim(messages.content) <> ''
           AND messages.content ILIKE $3 ESCAPE '\\'
         UNION ALL
         SELECT attachments.id, 'file'::text AS kind,
                CASE
                  WHEN attachments.provenance = 'agent_output' THEN 'agent_output'
                  WHEN COALESCE(attachments.detected_media_type,
                                attachments.declared_media_type) LIKE 'image/%' THEN 'image'
                  WHEN COALESCE(attachments.detected_media_type,
                                attachments.declared_media_type) IN
                       ('application/zip', 'application/x-zip-compressed') THEN 'archive'
                  ELSE 'document'
                END AS category,
                visible_rooms.workspace_id, visible_rooms.id AS room_id,
                visible_rooms.name AS room_name,
                message_attachments.message_id,
                attachments.uploader_principal_id AS sender_principal_id,
                uploader.display_name AS sender_display_name,
                attachments.original_name AS text,
                COALESCE(attachments.detected_media_type,
                         attachments.declared_media_type) AS media_type,
                attachments.provenance, message_attachments.linked_at AS created_at
         FROM visible_rooms
         JOIN message_attachments ON message_attachments.room_id = visible_rooms.id
         JOIN room_messages AS source_message
           ON source_message.id = message_attachments.message_id
         JOIN attachments ON attachments.id = message_attachments.attachment_id
         JOIN principals AS uploader ON uploader.id = attachments.uploader_principal_id
         WHERE attachments.status = 'ready'
           AND source_message.retracted_at IS NULL
           AND attachments.original_name ILIKE $3 ESCAPE '\\'
       )
       SELECT * FROM candidates
       WHERE ($4::uuid IS NULL OR room_id = $4)
         AND ($5::uuid IS NULL OR sender_principal_id = $5)
         AND ($6::text IS NULL
           OR ($6 = 'file' AND kind = 'file')
           OR category = $6)
         AND ($7::timestamptz IS NULL OR created_at >= $7)
         AND ($8::timestamptz IS NULL OR created_at <= $8)
         AND ($9::timestamptz IS NULL OR (created_at, id) < ($9, $10::uuid))
       ORDER BY created_at DESC, id DESC
       LIMIT $11`,
      [
        input.workspaceId,
        input.principalId,
        pattern,
        input.roomId ?? null,
        input.senderPrincipalId ?? null,
        input.category ?? null,
        input.from ?? null,
        input.to ?? null,
        input.before?.createdAt ?? null,
        input.before?.id ?? null,
        input.limit,
      ],
    );
    return result.rows.map(mapResult);
  }

  async canReadRoom(input: {
    roomId: string;
    principalId: string;
  }): Promise<boolean> {
    const result = await this.pool.query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM rooms
         JOIN room_members ON room_members.room_id = rooms.id
         JOIN workspace_members
           ON workspace_members.workspace_id = rooms.workspace_id
          AND workspace_members.principal_id = room_members.principal_id
         JOIN principals ON principals.id = room_members.principal_id
         WHERE rooms.id = $1
           AND room_members.principal_id = $2
           AND rooms.status IN ('active', 'archived')
           AND room_members.status = 'active'
           AND workspace_members.status = 'active'
           AND principals.status = 'active'
       ) AS allowed`,
      [input.roomId, input.principalId],
    );
    return result.rows[0]?.allowed ?? false;
  }

  async listRoomFiles(input: {
    roomId: string;
    principalId: string;
  }): Promise<SearchResultRecord[]> {
    const allowed = await this.canReadRoom(input);
    if (!allowed) return [];
    const result = await this.pool.query<SearchRow>(
      `SELECT attachments.id, 'file'::text AS kind,
              CASE
                WHEN attachments.provenance = 'agent_output' THEN 'agent_output'
                WHEN COALESCE(attachments.detected_media_type,
                              attachments.declared_media_type) LIKE 'image/%' THEN 'image'
                WHEN COALESCE(attachments.detected_media_type,
                              attachments.declared_media_type) IN
                     ('application/zip', 'application/x-zip-compressed') THEN 'archive'
                ELSE 'document'
              END AS category,
              rooms.workspace_id, rooms.id AS room_id, rooms.name AS room_name,
              message_attachments.message_id,
              attachments.uploader_principal_id AS sender_principal_id,
              uploader.display_name AS sender_display_name,
              attachments.original_name AS text,
              COALESCE(attachments.detected_media_type,
                       attachments.declared_media_type) AS media_type,
              attachments.provenance, message_attachments.linked_at AS created_at
       FROM message_attachments
       JOIN room_messages AS source_message
         ON source_message.id = message_attachments.message_id
       JOIN attachments ON attachments.id = message_attachments.attachment_id
       JOIN rooms ON rooms.id = message_attachments.room_id
       JOIN principals AS uploader ON uploader.id = attachments.uploader_principal_id
       WHERE message_attachments.room_id = $1
         AND attachments.status = 'ready'
         AND source_message.retracted_at IS NULL
       ORDER BY message_attachments.linked_at DESC, attachments.id DESC`,
      [input.roomId],
    );
    return result.rows.map(mapResult);
  }
}
