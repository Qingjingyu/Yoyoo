import { createHash, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import {
  agentEventSchema,
  agentRunRequestSchema,
  type AgentEvent,
  type AgentRunRequest,
  type RoomHistoryMessage,
} from "@/agents/contract";
import type {
  CollaborationRunRecord,
  CollaborationRunStatus,
  PrincipalKind,
} from "@/domain/collaboration";
import { withTransaction } from "@/server/postgres/transaction";
import { selectRecentRoomContext } from "@/agents/room-context";

interface CollaborationRunRow {
  id: string;
  room_id: string;
  trigger_message_id: string;
  target_agent_principal_id: string;
  output_message_id: string | null;
  adapter_id: string;
  trigger_type: CollaborationRunRecord["triggerType"];
  status: CollaborationRunStatus;
  idempotency_key: string;
  retry_of_run_id: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ExecutionRow extends CollaborationRunRow {
  workspace_id: string;
  message: string;
  sender_principal_id: string;
  sender_kind: PrincipalKind;
  sender_display_name: string;
  reply_to_message_id: string | null;
  thread_root_message_id: string | null;
  trigger_created_at: Date;
}

interface HistoryRow {
  id: string;
  sender_principal_id: string;
  sender_kind: PrincipalKind;
  sender_display_name: string;
  content: string;
}

interface AttachmentContextRow {
  id: string;
  message_id: string;
  original_name: string;
  media_type: string;
  size_bytes: string | number;
  sha256: string;
  provenance: "human_upload" | "agent_output";
}

interface StoredEventRow {
  run_id: string;
  sequence: string;
  payload: AgentEvent;
  created_at: Date;
}

export interface StoredCollaborationRunEvent {
  runId: string;
  sequence: number;
  event: AgentEvent;
  createdAt: Date;
}

export interface CollaborationRunExecutionContext {
  run: CollaborationRunRecord;
  request: AgentRunRequest;
}

function mapRun(row: CollaborationRunRow): CollaborationRunRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    triggerMessageId: row.trigger_message_id,
    targetAgentPrincipalId: row.target_agent_principal_id,
    outputMessageId: row.output_message_id,
    adapterId: row.adapter_id,
    triggerType: row.trigger_type,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    retryOfRunId: row.retry_of_run_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stableKey(namespace: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join(":"), "utf8").digest("hex");
  return `${namespace}:${digest}`;
}

async function insertTerminalMessage(
  client: PoolClient,
  run: CollaborationRunRow,
  status: "completed" | "stopped" | "failed",
  content: string,
  force = false,
): Promise<string | null> {
  if (!content.trim() && !force) return null;
  const messageId = randomUUID();
  await client.query(
    `INSERT INTO room_messages
      (id, room_id, sender_principal_id, kind, content, status)
     VALUES ($1, $2, $3, 'message', $4, $5)`,
    [messageId, run.room_id, run.target_agent_principal_id, content, status],
  );
  await client.query(
    `INSERT INTO room_message_revisions
      (id, room_id, message_id, revision_number, action,
       actor_principal_id, content, mentioned_principal_ids)
     VALUES ($1, $2, $3, 1, 'created', $4, $5, ARRAY[]::uuid[])`,
    [randomUUID(), run.room_id, messageId, run.target_agent_principal_id, content],
  );
  return messageId;
}

async function linkProducedAttachments(
  client: PoolClient,
  run: CollaborationRunRow,
  messageId: string,
  attachmentIds: string[],
): Promise<void> {
  if (attachmentIds.length === 0) return;
  const eligible = await client.query<{
    id: string;
    workspace_id: string;
    size_bytes: string;
  }>(
    `SELECT attachments.id, attachments.workspace_id,
            attachments.size_bytes::text
     FROM attachments
     JOIN rooms ON rooms.workspace_id = attachments.workspace_id
     WHERE attachments.id = ANY($1::uuid[])
       AND rooms.id = $2
       AND attachments.uploader_principal_id = $3
       AND attachments.source_run_id = $4
       AND attachments.provenance = 'agent_output'
       AND attachments.status = 'ready'
       AND NOT EXISTS (
         SELECT 1 FROM message_attachments
         WHERE message_attachments.attachment_id = attachments.id
       )`,
    [attachmentIds, run.room_id, run.target_agent_principal_id, run.id],
  );
  if (eligible.rowCount !== attachmentIds.length) {
    throw new Error("Produced attachment does not belong to this Agent run");
  }
  const totalBytes = eligible.rows.reduce(
    (total, attachment) => total + Number(attachment.size_bytes),
    0,
  );
  if (totalBytes > 100 * 1024 * 1024) {
    throw new Error("Produced attachments exceed the message size limit");
  }
  const workspaceId = eligible.rows[0].workspace_id;
  await client.query(
    `INSERT INTO message_attachments
       (workspace_id, room_id, message_id, attachment_id, position)
     SELECT $1, $2, $3, attachment_id, (ordinality - 1)::smallint
     FROM unnest($4::uuid[]) WITH ORDINALITY AS selected(attachment_id, ordinality)`,
    [workspaceId, run.room_id, messageId, attachmentIds],
  );
}

async function loadMessageContext(
  client: Pool,
  messageId: string | null,
): Promise<{
  messageId: string;
  senderPrincipalId: string;
  content: string;
} | null> {
  if (!messageId) return null;
  const result = await client.query<{
    id: string;
    sender_principal_id: string;
    content: string;
  }>(
    `SELECT id, sender_principal_id, content FROM room_messages
     WHERE id = $1 AND retracted_at IS NULL`,
    [messageId],
  );
  return result.rows[0]
    ? {
        messageId: result.rows[0].id,
        senderPrincipalId: result.rows[0].sender_principal_id,
        content: result.rows[0].content,
      }
    : null;
}

export class CollaborationRunRepository {
  constructor(private readonly pool: Pool) {}

  async createForMessage(input: {
    roomId: string;
    triggerMessageId: string;
    targets: Array<{ principalId: string; adapterId: string }>;
  }): Promise<CollaborationRunRecord[]> {
    return withTransaction(this.pool, async (client) => {
      const message = await client.query<{ id: string }>(
        `SELECT id FROM room_messages
         WHERE id = $1 AND room_id = $2 AND retracted_at IS NULL`,
        [input.triggerMessageId, input.roomId],
      );
      if (!message.rows[0]) throw new Error("Trigger message does not belong to the room");

      const records: CollaborationRunRecord[] = [];
      for (const target of input.targets) {
        const idempotencyKey = stableKey(
          "message",
          input.triggerMessageId,
          target.principalId,
        );
        const result = await client.query<CollaborationRunRow>(
          `INSERT INTO room_runs
            (id, room_id, trigger_message_id, target_agent_principal_id,
             adapter_id, trigger_type, status, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, 'message', 'queued', $6)
           ON CONFLICT (room_id, idempotency_key) DO UPDATE
             SET updated_at = room_runs.updated_at
           RETURNING *`,
          [
            randomUUID(),
            input.roomId,
            input.triggerMessageId,
            target.principalId,
            target.adapterId,
            idempotencyKey,
          ],
        );
        records.push(mapRun(result.rows[0]));
      }
      return records;
    });
  }

  async createDelegatedRun(input: {
    parentRunId: string;
    delegatePrincipalId: string;
    adapterId: string;
    idempotencyKey: string;
  }): Promise<{ duplicate: boolean; run: CollaborationRunRecord }> {
    return withTransaction(this.pool, async (client) => {
      const parent = await client.query<CollaborationRunRow>(
        "SELECT * FROM room_runs WHERE id = $1 FOR UPDATE",
        [input.parentRunId],
      );
      if (!parent.rows[0]) throw new Error(`Unknown parent run: ${input.parentRunId}`);
      const key = stableKey("delegation", input.parentRunId, input.idempotencyKey);
      const existing = await client.query<CollaborationRunRow>(
        `SELECT * FROM room_runs WHERE room_id = $1 AND idempotency_key = $2`,
        [parent.rows[0].room_id, key],
      );
      if (existing.rows[0]) return { duplicate: true, run: mapRun(existing.rows[0]) };
      const created = await client.query<CollaborationRunRow>(
        `INSERT INTO room_runs
          (id, room_id, trigger_message_id, target_agent_principal_id,
           adapter_id, trigger_type, status, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, 'delegation', 'queued', $6)
         RETURNING *`,
        [
          randomUUID(),
          parent.rows[0].room_id,
          parent.rows[0].trigger_message_id,
          input.delegatePrincipalId,
          input.adapterId,
          key,
        ],
      );
      return { duplicate: false, run: mapRun(created.rows[0]) };
    });
  }

  async createRetry(
    runId: string,
    idempotencyKey: string,
  ): Promise<{ duplicate: boolean; run: CollaborationRunRecord }> {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `room-retry:${runId}:${idempotencyKey}`,
      ]);
      const sourceResult = await client.query<CollaborationRunRow>(
        "SELECT * FROM room_runs WHERE id = $1 FOR UPDATE",
        [runId],
      );
      const source = sourceResult.rows[0];
      if (!source) throw new Error(`Unknown collaboration run: ${runId}`);
      const key = stableKey("retry", runId, idempotencyKey);
      const existing = await client.query<CollaborationRunRow>(
        `SELECT * FROM room_runs WHERE room_id = $1 AND idempotency_key = $2`,
        [source.room_id, key],
      );
      if (existing.rows[0]) return { duplicate: true, run: mapRun(existing.rows[0]) };
      if (source.status !== "failed" && source.status !== "stopped") {
        throw new Error(`Collaboration run ${runId} is not retryable from ${source.status}`);
      }
      const trigger = await client.query<{ id: string }>(
        `SELECT id FROM room_messages
         WHERE id = $1 AND room_id = $2 AND retracted_at IS NULL`,
        [source.trigger_message_id, source.room_id],
      );
      if (!trigger.rows[0]) {
        throw new Error("A run whose trigger message was retracted cannot be retried");
      }
      const active = await client.query<{ id: string }>(
        `SELECT id FROM room_runs
         WHERE room_id = $1 AND target_agent_principal_id = $2
           AND status IN ('queued', 'running', 'waiting')
         LIMIT 1`,
        [source.room_id, source.target_agent_principal_id],
      );
      if (active.rows[0]) {
        throw new Error("The target Agent already has an active run in this room");
      }
      const created = await client.query<CollaborationRunRow>(
        `INSERT INTO room_runs
          (id, room_id, trigger_message_id, target_agent_principal_id,
           adapter_id, trigger_type, status, idempotency_key, retry_of_run_id)
         VALUES ($1, $2, $3, $4, $5, 'retry', 'queued', $6, $7)
         RETURNING *`,
        [
          randomUUID(),
          source.room_id,
          source.trigger_message_id,
          source.target_agent_principal_id,
          source.adapter_id,
          key,
          runId,
        ],
      );
      return { duplicate: false, run: mapRun(created.rows[0]) };
    });
  }

  async get(runId: string): Promise<CollaborationRunRecord> {
    const result = await this.pool.query<CollaborationRunRow>(
      "SELECT * FROM room_runs WHERE id = $1",
      [runId],
    );
    if (!result.rows[0]) throw new Error(`Unknown collaboration run: ${runId}`);
    return mapRun(result.rows[0]);
  }

  async listForRoom(roomId: string): Promise<CollaborationRunRecord[]> {
    const result = await this.pool.query<CollaborationRunRow>(
      `SELECT * FROM room_runs WHERE room_id = $1 ORDER BY created_at, id`,
      [roomId],
    );
    return result.rows.map(mapRun);
  }

  async listForTrigger(triggerMessageId: string): Promise<CollaborationRunRecord[]> {
    const result = await this.pool.query<CollaborationRunRow>(
      `SELECT * FROM room_runs WHERE trigger_message_id = $1 ORDER BY created_at, id`,
      [triggerMessageId],
    );
    return result.rows.map(mapRun);
  }

  async claim(runId: string): Promise<CollaborationRunRecord | null> {
    const result = await this.pool.query<CollaborationRunRow>(
      `UPDATE room_runs SET
         status = 'running', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
       WHERE id = $1 AND status = 'queued' RETURNING *`,
      [runId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async getExecutionContext(runId: string): Promise<CollaborationRunExecutionContext> {
    const result = await this.pool.query<ExecutionRow>(
      `SELECT room_runs.*, rooms.workspace_id,
              COALESCE(delegations.objective, room_messages.content) AS message,
              room_messages.sender_principal_id,
              sender.kind AS sender_kind,
              sender.display_name AS sender_display_name,
              room_messages.reply_to_message_id,
              room_messages.thread_root_message_id,
              room_messages.created_at AS trigger_created_at
       FROM room_runs
       JOIN rooms ON rooms.id = room_runs.room_id
       JOIN room_messages ON room_messages.id = room_runs.trigger_message_id
       JOIN principals AS sender ON sender.id = room_messages.sender_principal_id
       LEFT JOIN delegations ON delegations.child_run_id = room_runs.id
       WHERE room_runs.id = $1
         AND room_messages.retracted_at IS NULL`,
      [runId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Unknown collaboration run: ${runId}`);
    const [members, mentions, historyRows, replyTo, threadRoot, attachments] = await Promise.all([
      this.pool.query<{
        principal_id: string;
        kind: PrincipalKind;
        display_name: string;
        listener_policy: "always" | "mention_only" | "muted";
      }>(
        `SELECT room_members.principal_id, principals.kind,
                principals.display_name, room_members.listener_policy
         FROM room_members
         JOIN principals ON principals.id = room_members.principal_id
         WHERE room_members.room_id = $1 AND room_members.status = 'active'
         ORDER BY room_members.joined_at, room_members.principal_id`,
        [row.room_id],
      ),
      this.pool.query<{ mentioned_principal_id: string }>(
        `SELECT mentioned_principal_id FROM message_mentions
         WHERE message_id = $1 ORDER BY mentioned_principal_id`,
        [row.trigger_message_id],
      ),
      this.pool.query<HistoryRow>(
        `SELECT messages.id, messages.sender_principal_id,
                sender.kind AS sender_kind,
                sender.display_name AS sender_display_name,
                messages.content
         FROM room_messages AS messages
         JOIN principals AS sender ON sender.id = messages.sender_principal_id
         WHERE messages.room_id = $1
           AND messages.status = 'completed'
           AND messages.retracted_at IS NULL
           AND (messages.created_at, messages.id) < ($2::timestamptz, $3::uuid)
         ORDER BY messages.created_at DESC, messages.id DESC
         LIMIT 24`,
        [row.room_id, row.trigger_created_at, row.trigger_message_id],
      ),
      loadMessageContext(this.pool, row.reply_to_message_id),
      loadMessageContext(this.pool, row.thread_root_message_id),
      this.pool.query<AttachmentContextRow>(
        `SELECT attachments.id, message_attachments.message_id,
                attachments.original_name,
                COALESCE(attachments.detected_media_type,
                         attachments.declared_media_type) AS media_type,
                attachments.size_bytes, attachments.sha256,
                attachments.provenance
         FROM message_attachments
         JOIN attachments ON attachments.id = message_attachments.attachment_id
         WHERE message_attachments.message_id = $1
           AND attachments.status = 'ready'
           AND attachments.size_bytes IS NOT NULL
           AND attachments.sha256 IS NOT NULL
         ORDER BY message_attachments.position`,
        [row.trigger_message_id],
      ),
    ]);
    const request = agentRunRequestSchema.parse({
      runId: row.id,
      workspaceId: row.workspace_id,
      roomId: row.room_id,
      triggerMessageId: row.trigger_message_id,
      triggerType: row.trigger_type,
      message: row.message,
      sender: {
        principalId: row.sender_principal_id,
        kind: row.sender_kind,
        displayName: row.sender_display_name,
      },
      members: members.rows.map((member) => ({
        principalId: member.principal_id,
        kind: member.kind,
        displayName: member.display_name,
        listenerPolicy: member.listener_policy,
      })),
      mentionedPrincipalIds: mentions.rows.map((mention) => mention.mentioned_principal_id),
      history: selectRecentRoomContext(
        historyRows.rows.reverse().map<RoomHistoryMessage>((message) => ({
          messageId: message.id,
          senderPrincipalId: message.sender_principal_id,
          senderKind: message.sender_kind,
          senderDisplayName: message.sender_display_name,
          content: message.content,
        })),
      ),
      replyTo,
      threadRoot,
      attachments: attachments.rows.map((attachment) => ({
        attachmentId: attachment.id,
        messageId: attachment.message_id,
        originalName: attachment.original_name,
        mediaType: attachment.media_type,
        sizeBytes: Number(attachment.size_bytes),
        sha256: attachment.sha256,
        provenance: attachment.provenance,
        resource: {
          method: "GET",
          path: `/api/v1/agent-gateway/resources/${attachment.id}?runId=${row.id}`,
        },
      })),
    });
    return { run: mapRun(row), request };
  }

  async listEvents(runId: string, afterSequence = 0): Promise<StoredCollaborationRunEvent[]> {
    const result = await this.pool.query<StoredEventRow>(
      `SELECT run_id, sequence::text, payload, created_at
       FROM room_run_events
       WHERE run_id = $1 AND sequence > $2 ORDER BY sequence`,
      [runId, afterSequence],
    );
    return result.rows.map((row) => ({
      runId: row.run_id,
      sequence: Number(row.sequence),
      event: agentEventSchema.parse(row.payload),
      createdAt: row.created_at,
    }));
  }

  async appendEvent(runId: string, rawEvent: AgentEvent): Promise<CollaborationRunRecord> {
    const event = agentEventSchema.parse(rawEvent);
    return withTransaction(this.pool, async (client) => {
      const runResult = await client.query<CollaborationRunRow>(
        "SELECT * FROM room_runs WHERE id = $1 FOR UPDATE",
        [runId],
      );
      const run = runResult.rows[0];
      if (!run) throw new Error(`Unknown collaboration run: ${runId}`);
      if (["completed", "stopped", "failed"].includes(run.status)) {
        throw new Error(`Collaboration run ${runId} is already terminal`);
      }
      const sequence = await client.query<{ next_sequence: string }>(
        `SELECT (COALESCE(MAX(sequence), 0) + 1)::text AS next_sequence
         FROM room_run_events WHERE run_id = $1`,
        [runId],
      );
      const expectedSequence = Number(sequence.rows[0].next_sequence);
      if (event.sequence !== expectedSequence) {
        throw new Error(
          `Agent event sequence must be ${expectedSequence}, received ${event.sequence}`,
        );
      }
      await client.query(
        `INSERT INTO room_run_events (run_id, sequence, event_type, payload)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [runId, event.sequence, event.type, JSON.stringify(event)],
      );

      let updated: CollaborationRunRow;
      if (event.type === "completed") {
        const attachmentIds = event.attachmentIds ?? [];
        const outputMessageId = await insertTerminalMessage(
          client,
          run,
          "completed",
          event.text,
          attachmentIds.length > 0,
        );
        if (outputMessageId) {
          await linkProducedAttachments(client, run, outputMessageId, attachmentIds);
        }
        const result = await client.query<CollaborationRunRow>(
          `UPDATE room_runs SET status = 'completed', output_message_id = $2,
           finished_at = NOW(), updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [runId, outputMessageId],
        );
        updated = result.rows[0];
      } else if (event.type === "failed" || event.type === "stopped") {
        const partial = await client.query<{ content: string }>(
          `SELECT COALESCE(string_agg(payload->>'delta', '' ORDER BY sequence), '') AS content
           FROM room_run_events WHERE run_id = $1 AND event_type = 'text_delta'`,
          [runId],
        );
        const outputMessageId = await insertTerminalMessage(
          client,
          run,
          event.type,
          partial.rows[0].content,
        );
        const result = await client.query<CollaborationRunRow>(
          `UPDATE room_runs SET status = $2, output_message_id = $3,
           error_code = $4, error_message = $5,
           finished_at = NOW(), updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [
            runId,
            event.type,
            outputMessageId,
            event.type === "failed" ? event.error.code : null,
            event.type === "failed" ? event.error.message : null,
          ],
        );
        updated = result.rows[0];
      } else {
        const result = await client.query<CollaborationRunRow>(
          "UPDATE room_runs SET updated_at = NOW() WHERE id = $1 RETURNING *",
          [runId],
        );
        updated = result.rows[0];
      }
      if (["completed", "stopped", "failed"].includes(event.type)) {
        await client.query(
          `UPDATE delegations SET
             status = $2,
             error_code = CASE WHEN $2 = 'failed' THEN $3 ELSE NULL END,
             error_message = CASE WHEN $2 = 'failed' THEN $4 ELSE NULL END,
             finished_at = NOW(),
             updated_at = NOW()
           WHERE child_run_id = $1
             AND status NOT IN ('completed', 'stopped', 'failed')`,
          [
            runId,
            event.type,
            event.type === "failed" ? event.error.code : null,
            event.type === "failed" ? event.error.message : null,
          ],
        );
      }
      return mapRun(updated);
    });
  }

  async requeueInterruptedRuns(adapterId: string): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE room_runs
       SET status = 'queued', started_at = NULL, updated_at = NOW()
       WHERE adapter_id = $1
         AND status IN ('queued', 'running', 'waiting')
       RETURNING id`,
      [adapterId],
    );
    return result.rows.map(({ id }) => id);
  }

  async failInterruptedRuns(excludedAdapterIds: string[] = []): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM room_runs
       WHERE status IN ('queued', 'running', 'waiting')
         AND NOT (adapter_id = ANY($1::text[]))
       ORDER BY created_at`,
      [excludedAdapterIds],
    );
    const reconciled: string[] = [];
    for (const { id } of result.rows) {
      const events = await this.listEvents(id);
      await this.appendEvent(id, {
        sequence: (events.at(-1)?.sequence ?? 0) + 1,
        type: "failed",
        error: {
          code: "PROCESS_RESTARTED",
          message: "The previous Agent run ended when the service restarted",
          retriable: true,
        },
      });
      reconciled.push(id);
    }
    return reconciled;
  }
}
