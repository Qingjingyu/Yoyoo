import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type {
  ArtifactRecord,
  ArtifactStatus,
  ArtifactType,
} from "@/domain/collaboration";
import { withTransaction } from "@/server/postgres/transaction";

interface ArtifactRow {
  id: string;
  room_id: string;
  producer_principal_id: string;
  source_run_id: string;
  type: ArtifactType;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  status: ArtifactStatus;
  idempotency_key: string;
  created_at: Date;
  updated_at: Date;
}

function mapArtifact(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    producerPrincipalId: row.producer_principal_id,
    sourceRunId: row.source_run_id,
    type: row.type,
    title: row.title,
    content: row.content,
    metadata: row.metadata,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ArtifactRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: {
    roomId: string;
    producerPrincipalId: string;
    sourceRunId: string;
    type: ArtifactType;
    title: string;
    content: string;
    metadata?: Record<string, unknown>;
    status?: ArtifactStatus;
    idempotencyKey: string;
  }): Promise<{ duplicate: boolean; artifact: ArtifactRecord }> {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `artifact:${input.roomId}:${input.idempotencyKey}`,
      ]);
      const existing = await client.query<ArtifactRow>(
        `SELECT * FROM artifacts
         WHERE room_id = $1 AND idempotency_key = $2`,
        [input.roomId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        return { duplicate: true, artifact: mapArtifact(existing.rows[0]) };
      }

      const source = await client.query<{ id: string }>(
        `SELECT room_runs.id
         FROM room_runs
         JOIN room_members
           ON room_members.room_id = room_runs.room_id
          AND room_members.principal_id = $2
          AND room_members.status = 'active'
         WHERE room_runs.id = $1 AND room_runs.room_id = $3
           AND room_runs.target_agent_principal_id = $2`,
        [input.sourceRunId, input.producerPrincipalId, input.roomId],
      );
      if (!source.rows[0]) {
        throw new Error("Artifact source run does not belong to the producing Agent");
      }

      const result = await client.query<ArtifactRow>(
        `INSERT INTO artifacts
          (id, room_id, producer_principal_id, source_run_id, type, title,
           content, metadata, status, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
         RETURNING *`,
        [
          randomUUID(),
          input.roomId,
          input.producerPrincipalId,
          input.sourceRunId,
          input.type,
          input.title,
          input.content,
          JSON.stringify(input.metadata ?? {}),
          input.status ?? "ready",
          input.idempotencyKey,
        ],
      );
      return { duplicate: false, artifact: mapArtifact(result.rows[0]) };
    });
  }

  async listForRoom(roomId: string): Promise<ArtifactRecord[]> {
    const result = await this.pool.query<ArtifactRow>(
      `SELECT * FROM artifacts WHERE room_id = $1 ORDER BY created_at, id`,
      [roomId],
    );
    return result.rows.map(mapArtifact);
  }
}
