import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { agentEventSchema, type AgentEvent } from "@/agents/contract";

export type RunStatus = "queued" | "running" | "completed" | "stopped" | "failed";

export interface RunRecord {
  id: string;
  conversationId: string;
  userMessageId: string;
  agentMessageId: string | null;
  adapterId: string;
  retryOfRunId: string | null;
  retryIdempotencyKey: string | null;
  status: RunStatus;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunExecutionContext extends RunRecord {
  message: string;
}

export interface StoredRunEvent {
  runId: string;
  sequence: number;
  event: AgentEvent;
  createdAt: Date;
}

interface RunRow {
  id: string;
  conversation_id: string;
  user_message_id: string;
  agent_message_id: string | null;
  adapter_id: string;
  retry_of_run_id: string | null;
  retry_idempotency_key: string | null;
  status: RunStatus;
  error_code: string | null;
  error_message: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface RunContextRow extends RunRow {
  message: string;
}

interface EventRow {
  run_id: string;
  sequence: string;
  payload: AgentEvent;
  created_at: Date;
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

async function createTerminalMessage(
  client: PoolClient,
  run: RunRow,
  status: "completed" | "stopped" | "failed",
  content: string,
): Promise<string | null> {
  if (!content.trim()) return null;
  const messageId = randomUUID();
  await client.query(
    `INSERT INTO messages
      (id, conversation_id, sender_type, content, status)
     VALUES ($1, $2, 'agent', $3, $4)`,
    [messageId, run.conversation_id, content, status],
  );
  return messageId;
}

export class RunRepository {
  constructor(private readonly pool: Pool) {}

  async get(runId: string): Promise<RunRecord> {
    const result = await this.pool.query<RunRow>("SELECT * FROM runs WHERE id = $1", [runId]);
    if (!result.rows[0]) throw new Error(`Unknown run: ${runId}`);
    return mapRun(result.rows[0]);
  }

  async getExecutionContext(runId: string): Promise<RunExecutionContext> {
    const result = await this.pool.query<RunContextRow>(
      `SELECT runs.*, messages.content AS message
       FROM runs JOIN messages ON messages.id = runs.user_message_id
       WHERE runs.id = $1`,
      [runId],
    );
    if (!result.rows[0]) throw new Error(`Unknown run: ${runId}`);
    return { ...mapRun(result.rows[0]), message: result.rows[0].message };
  }

  async findActiveForConversation(conversationId: string): Promise<RunRecord | null> {
    const result = await this.pool.query<RunRow>(
      `SELECT * FROM runs
       WHERE conversation_id = $1 AND status IN ('queued', 'running')
       ORDER BY created_at DESC LIMIT 1`,
      [conversationId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async claim(runId: string): Promise<RunRecord | null> {
    const result = await this.pool.query<RunRow>(
      `UPDATE runs
       SET status = 'running', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
       WHERE id = $1 AND status = 'queued' RETURNING *`,
      [runId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async listEvents(runId: string, afterSequence = 0): Promise<StoredRunEvent[]> {
    const result = await this.pool.query<EventRow>(
      `SELECT run_id, sequence::text, payload, created_at
       FROM run_events
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

  async appendEvent(runId: string, rawEvent: AgentEvent): Promise<RunRecord> {
    const event = agentEventSchema.parse(rawEvent);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const runResult = await client.query<RunRow>(
        "SELECT * FROM runs WHERE id = $1 FOR UPDATE",
        [runId],
      );
      const run = runResult.rows[0];
      if (!run) throw new Error(`Unknown run: ${runId}`);
      if (["completed", "stopped", "failed"].includes(run.status)) {
        throw new Error(`Run ${runId} is already terminal`);
      }

      const sequenceResult = await client.query<{ next_sequence: string }>(
        `SELECT (COALESCE(MAX(sequence), 0) + 1)::text AS next_sequence
         FROM run_events WHERE run_id = $1`,
        [runId],
      );
      const expectedSequence = Number(sequenceResult.rows[0].next_sequence);
      if (event.sequence !== expectedSequence) {
        throw new Error(
          `Run event sequence must be ${expectedSequence}, received ${event.sequence}`,
        );
      }

      await client.query(
        `INSERT INTO run_events (run_id, sequence, event_type, payload)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [runId, event.sequence, event.type, JSON.stringify(event)],
      );

      let updated: RunRow;
      if (event.type === "completed") {
        const agentMessageId = await createTerminalMessage(
          client,
          run,
          "completed",
          event.text,
        );
        const result = await client.query<RunRow>(
          `UPDATE runs SET status = 'completed', agent_message_id = $2,
           finished_at = NOW(), updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [runId, agentMessageId],
        );
        updated = result.rows[0];
      } else if (event.type === "failed" || event.type === "stopped") {
        const partial = await client.query<{ content: string }>(
          `SELECT COALESCE(string_agg(payload->>'delta', '' ORDER BY sequence), '') AS content
           FROM run_events WHERE run_id = $1 AND event_type = 'text_delta'`,
          [runId],
        );
        const agentMessageId = await createTerminalMessage(
          client,
          run,
          event.type,
          partial.rows[0].content,
        );
        const errorCode = event.type === "failed" ? event.error.code : null;
        const errorMessage = event.type === "failed" ? event.error.message : null;
        const result = await client.query<RunRow>(
          `UPDATE runs SET status = $2, agent_message_id = $3,
           error_code = $4, error_message = $5, finished_at = NOW(), updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [runId, event.type, agentMessageId, errorCode, errorMessage],
        );
        updated = result.rows[0];
      } else {
        const result = await client.query<RunRow>(
          "UPDATE runs SET updated_at = NOW() WHERE id = $1 RETURNING *",
          [runId],
        );
        updated = result.rows[0];
      }

      await client.query("COMMIT");
      return mapRun(updated);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async failInterruptedRuns(): Promise<string[]> {
    const active = await this.pool.query<{ id: string }>(
      "SELECT id FROM runs WHERE status IN ('queued', 'running') ORDER BY created_at",
    );
    const reconciled: string[] = [];
    for (const { id } of active.rows) {
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
