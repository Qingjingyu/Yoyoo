import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { RunRecord } from "@/server/postgres/run-repository";

export interface ConversationRecord {
  id: string;
  ownerId: string;
  agentId: string;
  title: string | null;
  status: "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderType: "human" | "agent" | "system";
  content: string;
  status: "pending" | "streaming" | "completed" | "stopped" | "failed";
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubmissionRecord {
  duplicate: boolean;
  message: MessageRecord;
  run: RunRecord;
}

export interface RetryRecord {
  duplicate: boolean;
  run: RunRecord;
}

export class ConversationBusyError extends Error {
  constructor(conversationId: string) {
    super(`Conversation ${conversationId} already has an active run`);
    this.name = "ConversationBusyError";
  }
}

export class RunNotRetryableError extends Error {
  constructor(runId: string, status: string) {
    super(`Run ${runId} is not retryable from ${status}`);
    this.name = "RunNotRetryableError";
  }
}

interface ConversationRow {
  id: string;
  owner_id: string;
  agent_id: string;
  title: string | null;
  status: "active" | "archived";
  created_at: Date;
  updated_at: Date;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_type: MessageRecord["senderType"];
  content: string;
  status: MessageRecord["status"];
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
}

interface RunRow {
  id: string;
  conversation_id: string;
  user_message_id: string;
  agent_message_id: string | null;
  adapter_id: string;
  retry_of_run_id: string | null;
  retry_idempotency_key: string | null;
  status: RunRecord["status"];
  error_code: string | null;
  error_message: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    agentId: row.agent_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderType: row.sender_type,
    content: row.content,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: RunRow): RunRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userMessageId: row.user_message_id,
    agentMessageId: row.agent_message_id,
    adapterId: row.adapter_id,
    retryOfRunId: row.retry_of_run_id,
    retryIdempotencyKey: row.retry_idempotency_key,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class ConversationRepository {
  constructor(private readonly pool: Pool) {}

  async getOrCreateCurrent(ownerId: string, agentId: string): Promise<ConversationRecord> {
    return inTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `current:${ownerId}:${agentId}`,
      ]);
      const existing = await client.query<ConversationRow>(
        `SELECT * FROM conversations
         WHERE owner_id = $1 AND agent_id = $2 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
        [ownerId, agentId],
      );
      if (existing.rows[0]) return mapConversation(existing.rows[0]);

      const created = await client.query<ConversationRow>(
        `INSERT INTO conversations (id, owner_id, agent_id)
         VALUES ($1, $2, $3) RETURNING *`,
        [randomUUID(), ownerId, agentId],
      );
      return mapConversation(created.rows[0]);
    });
  }

  async listMessages(conversationId: string): Promise<MessageRecord[]> {
    const result = await this.pool.query<MessageRow>(
      `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at, id`,
      [conversationId],
    );
    return result.rows.map(mapMessage);
  }

  async createSubmission(input: {
    conversationId: string;
    adapterId: string;
    content: string;
    idempotencyKey: string;
  }): Promise<SubmissionRecord> {
    return inTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `submission:${input.conversationId}`,
      ]);
      const existingMessage = await client.query<MessageRow>(
        `SELECT * FROM messages WHERE conversation_id = $1 AND idempotency_key = $2`,
        [input.conversationId, input.idempotencyKey],
      );
      if (existingMessage.rows[0]) {
        const existingRun = await client.query<RunRow>(
          `SELECT * FROM runs WHERE user_message_id = $1 ORDER BY created_at LIMIT 1`,
          [existingMessage.rows[0].id],
        );
        if (!existingRun.rows[0]) {
          throw new Error("Idempotent message exists without its run");
        }
        return {
          duplicate: true,
          message: mapMessage(existingMessage.rows[0]),
          run: mapRun(existingRun.rows[0]),
        };
      }

      const activeRun = await client.query<{ id: string }>(
        `SELECT id FROM runs
         WHERE conversation_id = $1 AND status IN ('queued', 'running')
         LIMIT 1`,
        [input.conversationId],
      );
      if (activeRun.rows[0]) throw new ConversationBusyError(input.conversationId);

      const message = await client.query<MessageRow>(
        `INSERT INTO messages
          (id, conversation_id, sender_type, content, status, idempotency_key)
         VALUES ($1, $2, 'human', $3, 'completed', $4) RETURNING *`,
        [randomUUID(), input.conversationId, input.content, input.idempotencyKey],
      );
      const run = await client.query<RunRow>(
        `INSERT INTO runs
          (id, conversation_id, user_message_id, adapter_id, status)
         VALUES ($1, $2, $3, $4, 'queued') RETURNING *`,
        [randomUUID(), input.conversationId, message.rows[0].id, input.adapterId],
      );
      return {
        duplicate: false,
        message: mapMessage(message.rows[0]),
        run: mapRun(run.rows[0]),
      };
    });
  }

  async createRetry(runId: string, idempotencyKey: string): Promise<RetryRecord> {
    return inTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`retry:${runId}`]);
      const existing = await client.query<RunRow>(
        `SELECT * FROM runs
         WHERE retry_of_run_id = $1 AND retry_idempotency_key = $2`,
        [runId, idempotencyKey],
      );
      if (existing.rows[0]) {
        return { duplicate: true, run: mapRun(existing.rows[0]) };
      }
      const original = await client.query<RunRow>(
        "SELECT * FROM runs WHERE id = $1 FOR UPDATE",
        [runId],
      );
      const source = original.rows[0];
      if (!source) throw new Error(`Unknown run: ${runId}`);
      if (source.status !== "failed" && source.status !== "stopped") {
        throw new RunNotRetryableError(runId, source.status);
      }
      const activeRun = await client.query<{ id: string }>(
        `SELECT id FROM runs
         WHERE conversation_id = $1 AND status IN ('queued', 'running')
         LIMIT 1`,
        [source.conversation_id],
      );
      if (activeRun.rows[0]) throw new ConversationBusyError(source.conversation_id);
      const created = await client.query<RunRow>(
        `INSERT INTO runs
          (id, conversation_id, user_message_id, adapter_id, status,
           retry_of_run_id, retry_idempotency_key)
         VALUES ($1, $2, $3, $4, 'queued', $5, $6) RETURNING *`,
        [
          randomUUID(),
          source.conversation_id,
          source.user_message_id,
          source.adapter_id,
          runId,
          idempotencyKey,
        ],
      );
      return { duplicate: false, run: mapRun(created.rows[0]) };
    });
  }
}
