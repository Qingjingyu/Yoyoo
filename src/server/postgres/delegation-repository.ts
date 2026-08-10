import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { DelegationRecord, DelegationStatus } from "@/domain/collaboration";
import { withTransaction } from "@/server/postgres/transaction";

interface DelegationRow {
  id: string;
  room_id: string;
  delegator_principal_id: string;
  delegate_principal_id: string;
  parent_run_id: string;
  child_run_id: string | null;
  objective: string;
  status: DelegationStatus;
  idempotency_key: string;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
}

function mapDelegation(row: DelegationRow): DelegationRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    delegatorPrincipalId: row.delegator_principal_id,
    delegatePrincipalId: row.delegate_principal_id,
    parentRunId: row.parent_run_id,
    childRunId: row.child_run_id,
    objective: row.objective,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

export class DelegationRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: {
    roomId: string;
    delegatorPrincipalId: string;
    delegatePrincipalId: string;
    parentRunId: string;
    childRunId?: string | null;
    objective: string;
    status?: DelegationStatus;
    idempotencyKey: string;
  }): Promise<{ duplicate: boolean; delegation: DelegationRecord }> {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `delegation:${input.roomId}:${input.idempotencyKey}`,
      ]);
      const existing = await client.query<DelegationRow>(
        `SELECT * FROM delegations
         WHERE room_id = $1 AND idempotency_key = $2`,
        [input.roomId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        return { duplicate: true, delegation: mapDelegation(existing.rows[0]) };
      }

      const members = await client.query<{ principal_id: string }>(
        `SELECT room_members.principal_id
         FROM room_members
         JOIN principals ON principals.id = room_members.principal_id
         WHERE room_members.room_id = $1 AND room_members.status = 'active'
           AND principals.kind = 'agent' AND principals.status = 'active'
           AND room_members.principal_id = ANY($2::uuid[])`,
        [input.roomId, [input.delegatorPrincipalId, input.delegatePrincipalId]],
      );
      if (members.rowCount !== 2) {
        throw new Error("Delegator and delegate must be active Agent room members");
      }
      const parent = await client.query<{ id: string }>(
        `SELECT id FROM room_runs
         WHERE id = $1 AND room_id = $2 AND target_agent_principal_id = $3`,
        [input.parentRunId, input.roomId, input.delegatorPrincipalId],
      );
      if (!parent.rows[0]) throw new Error("Parent run does not belong to the delegator");
      if (input.childRunId) {
        const child = await client.query<{ id: string }>(
          `SELECT id FROM room_runs
           WHERE id = $1 AND room_id = $2 AND target_agent_principal_id = $3`,
          [input.childRunId, input.roomId, input.delegatePrincipalId],
        );
        if (!child.rows[0]) throw new Error("Child run does not belong to the delegate");
      }

      const status = input.status ?? "requested";
      const result = await client.query<DelegationRow>(
        `INSERT INTO delegations
          (id, room_id, delegator_principal_id, delegate_principal_id,
           parent_run_id, child_run_id, objective, status, idempotency_key,
           finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
           CASE WHEN $8 IN ('completed', 'stopped', 'failed') THEN NOW() ELSE NULL END)
         RETURNING *`,
        [
          randomUUID(),
          input.roomId,
          input.delegatorPrincipalId,
          input.delegatePrincipalId,
          input.parentRunId,
          input.childRunId ?? null,
          input.objective,
          status,
          input.idempotencyKey,
        ],
      );
      return { duplicate: false, delegation: mapDelegation(result.rows[0]) };
    });
  }

  async listForRoom(roomId: string): Promise<DelegationRecord[]> {
    const result = await this.pool.query<DelegationRow>(
      `SELECT * FROM delegations WHERE room_id = $1 ORDER BY created_at, id`,
      [roomId],
    );
    return result.rows.map(mapDelegation);
  }

  async settleByChildRun(input: {
    childRunId: string;
    status: "completed" | "stopped" | "failed";
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<DelegationRecord | null> {
    const result = await this.pool.query<DelegationRow>(
      `UPDATE delegations SET
         status = $2,
         error_code = CASE WHEN $2 = 'failed' THEN $3 ELSE NULL END,
         error_message = CASE WHEN $2 = 'failed' THEN $4 ELSE NULL END,
         finished_at = NOW(),
         updated_at = NOW()
       WHERE child_run_id = $1
         AND status NOT IN ('completed', 'stopped', 'failed')
       RETURNING *`,
      [
        input.childRunId,
        input.status,
        input.errorCode ?? null,
        input.errorMessage ?? null,
      ],
    );
    return result.rows[0] ? mapDelegation(result.rows[0]) : null;
  }
}
