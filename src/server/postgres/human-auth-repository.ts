import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { FederatedAuthorizationMaterial } from "@/server/auth/aicard-session-authority";
import { withTransaction } from "./transaction.ts";

const THROTTLE_WINDOW_MS = 15 * 60 * 1_000;
const THROTTLE_LOCK_MS = 15 * 60 * 1_000;
const THROTTLE_FAILURE_LIMIT = 5;

interface CredentialRow {
  principal_id: string;
  login_handle: string;
  password_hash: Buffer;
  password_salt: Buffer;
  password_algorithm: "scrypt-v1";
  recovery_code_hash: Buffer | null;
  recovery_code_used_at: Date | null;
  credential_version: number;
  status: "active" | "disabled";
  created_at: Date;
  updated_at: Date;
}

interface SessionRow {
  session_id: string;
  principal_id: string;
  ai_card_id: string;
  login_handle: string;
  display_name: string;
  auth_method: "password" | "aicard";
  expires_at: Date;
  identity_issuer: string | null;
  identity_client_id: string | null;
  identity_subject: string | null;
  authorization_state_hash: Buffer | null;
  aicard_refresh_ciphertext: Buffer | null;
  aicard_refresh_iv: Buffer | null;
  aicard_refresh_tag: Buffer | null;
  aicard_refresh_expires_at: Date | null;
  aicard_last_validated_at: Date | null;
}

interface ThrottleRow {
  failure_count: number;
  window_started_at: Date;
  locked_until: Date | null;
}

export interface HumanCredentialRecord {
  principalId: string;
  loginHandle: string;
  passwordHash: Buffer;
  passwordSalt: Buffer;
  passwordAlgorithm: "scrypt-v1";
  recoveryCodeHash: Buffer | null;
  recoveryCodeUsedAt: Date | null;
  credentialVersion: number;
  status: "active" | "disabled";
  createdAt: Date;
  updatedAt: Date;
}

export interface HumanSessionRecord {
  sessionId: string;
  principalId: string;
  aiCardId: string;
  loginHandle: string;
  displayName: string;
  authMethod: "password" | "aicard";
  expiresAt: Date;
  federatedAuthorization: {
    issuer: string;
    clientId: string;
    subject: string;
    authorizationStateHash: Buffer;
    material: FederatedAuthorizationMaterial;
    lastValidatedAt: Date;
  } | null;
}

export interface LoginThrottleRecord {
  failureCount: number;
  windowStartedAt: Date;
  lockedUntil: Date | null;
}

export class HumanAuthConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HumanAuthConflictError";
  }
}

function mapCredential(row: CredentialRow): HumanCredentialRecord {
  return {
    principalId: row.principal_id,
    loginHandle: row.login_handle,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    passwordAlgorithm: row.password_algorithm,
    recoveryCodeHash: row.recovery_code_hash,
    recoveryCodeUsedAt: row.recovery_code_used_at,
    credentialVersion: row.credential_version,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapThrottle(row: ThrottleRow): LoginThrottleRecord {
  return {
    failureCount: row.failure_count,
    windowStartedAt: row.window_started_at,
    lockedUntil: row.locked_until,
  };
}

export class HumanAuthRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async provisionCredential(input: {
    principalId: string;
    loginHandle: string;
    passwordHash: Buffer;
    passwordSalt: Buffer;
    passwordAlgorithm: "scrypt-v1";
    recoveryCodeHash: Buffer;
  }): Promise<HumanCredentialRecord> {
    try {
      const result = await this.pool.query<CredentialRow>(
        `INSERT INTO human_credentials
          (principal_id, login_handle, password_hash, password_salt,
           password_algorithm, recovery_code_hash)
         SELECT principals.id, $2, $3, $4, $5, $6
         FROM principals
         WHERE principals.id = $1
           AND principals.kind = 'human'
           AND principals.status = 'active'
         RETURNING *`,
        [
          input.principalId,
          input.loginHandle.toLowerCase(),
          input.passwordHash,
          input.passwordSalt,
          input.passwordAlgorithm,
          input.recoveryCodeHash,
        ],
      );
      if (!result.rows[0]) {
        throw new HumanAuthConflictError(
          "Credentials require an active human Principal",
        );
      }
      return mapCredential(result.rows[0]);
    } catch (error) {
      if (error instanceof HumanAuthConflictError) throw error;
      if ((error as { code?: string }).code === "23505") {
        throw new HumanAuthConflictError("The login credential already exists");
      }
      throw error;
    }
  }

  async replaceCredential(input: {
    principalId: string;
    loginHandle: string;
    passwordHash: Buffer;
    passwordSalt: Buffer;
    passwordAlgorithm: "scrypt-v1";
    recoveryCodeHash: Buffer;
    now?: Date;
  }): Promise<HumanCredentialRecord> {
    const now = input.now ?? new Date();
    return withTransaction(this.pool, async (client) => {
      const result = await client.query<CredentialRow>(
        `UPDATE human_credentials AS credentials
         SET login_handle = lower($2),
             password_hash = $3,
             password_salt = $4,
             password_algorithm = $5,
             recovery_code_hash = $6,
             recovery_code_used_at = NULL,
             credential_version = credentials.credential_version + 1,
             status = 'active',
             updated_at = $7
         FROM principals
         WHERE credentials.principal_id = $1
           AND principals.id = credentials.principal_id
           AND principals.kind = 'human'
           AND principals.status = 'active'
         RETURNING credentials.*`,
        [
          input.principalId,
          input.loginHandle,
          input.passwordHash,
          input.passwordSalt,
          input.passwordAlgorithm,
          input.recoveryCodeHash,
          now,
        ],
      );
      if (!result.rows[0]) {
        throw new HumanAuthConflictError("The human credential does not exist");
      }
      await client.query(
        `UPDATE human_sessions
         SET revoked_at = COALESCE(revoked_at, $2),
             aicard_refresh_ciphertext = NULL,
             aicard_refresh_iv = NULL,
             aicard_refresh_tag = NULL
         WHERE principal_id = $1 AND revoked_at IS NULL`,
        [input.principalId, now],
      );
      return mapCredential(result.rows[0]);
    });
  }

  async findCredential(loginHandle: string): Promise<HumanCredentialRecord | null> {
    const result = await this.pool.query<CredentialRow>(
      `SELECT credentials.*
       FROM human_credentials AS credentials
       JOIN principals ON principals.id = credentials.principal_id
       WHERE lower(credentials.login_handle) = lower($1)
         AND credentials.status = 'active'
         AND principals.kind = 'human'
         AND principals.status = 'active'`,
      [loginHandle],
    );
    return result.rows[0] ? mapCredential(result.rows[0]) : null;
  }

  async createSession(input: {
    principalId: string;
    tokenHash: Buffer;
    expiresAt: Date;
    now?: Date;
  }): Promise<{ sessionId: string; expiresAt: Date }> {
    const sessionId = randomUUID();
    const now = input.now ?? new Date();
    const result = await this.pool.query<{ id: string; expires_at: Date }>(
      `INSERT INTO human_sessions
        (id, principal_id, token_hash, credential_version, expires_at,
         last_seen_at, created_at)
       SELECT $1, credentials.principal_id, $3, credentials.credential_version,
              $4, $5, $5
       FROM human_credentials AS credentials
       JOIN principals ON principals.id = credentials.principal_id
       WHERE credentials.principal_id = $2
         AND credentials.status = 'active'
         AND principals.kind = 'human'
         AND principals.status = 'active'
       RETURNING id, expires_at`,
      [sessionId, input.principalId, input.tokenHash, input.expiresAt, now],
    );
    if (!result.rows[0]) {
      throw new HumanAuthConflictError("The human credential is not active");
    }
    return {
      sessionId: result.rows[0].id,
      expiresAt: result.rows[0].expires_at,
    };
  }

  async createFederatedSession(input: {
    principalId: string;
    issuer: string;
    clientId: string;
    subject: string;
    authorizationStateHash: Buffer;
    federatedAuthorization: FederatedAuthorizationMaterial;
    tokenHash: Buffer;
    expiresAt: Date;
    now?: Date;
  }): Promise<{ sessionId: string; expiresAt: Date }> {
    const sessionId = randomUUID();
    const now = input.now ?? new Date();
    let result;
    try {
      result = await this.pool.query<{ id: string; expires_at: Date }>(
        `INSERT INTO human_sessions
        (id, principal_id, token_hash, credential_version, auth_method,
         identity_issuer, identity_client_id, identity_subject, expires_at,
         authorization_state_hash, aicard_refresh_ciphertext,
         aicard_refresh_iv, aicard_refresh_tag, aicard_refresh_expires_at,
         aicard_last_validated_at, last_seen_at, created_at)
       SELECT $1, mappings.principal_id, $6, NULL, 'aicard',
              mappings.issuer, mappings.client_id, mappings.subject, $8, $7,
              $9, $10, $11, $12, $13, $13, $13
       FROM aicard_identity_mappings AS mappings
       JOIN principals ON principals.id = mappings.principal_id
       WHERE mappings.principal_id = $2
         AND mappings.issuer = $3
         AND mappings.client_id = $4
         AND mappings.subject = $5
         AND mappings.card_id IS NOT NULL
         AND principals.kind = 'human'
         AND principals.status = 'active'
       RETURNING id, expires_at`,
        [
          sessionId,
          input.principalId,
          input.issuer,
          input.clientId,
          input.subject,
          input.tokenHash,
          input.authorizationStateHash,
          input.expiresAt,
          input.federatedAuthorization.ciphertext,
          input.federatedAuthorization.iv,
          input.federatedAuthorization.tag,
          input.federatedAuthorization.refreshExpiresAt,
          now,
        ],
      );
    } catch (error) {
      if (
        (error as { code?: string; constraint?: string }).code === "23505"
        && (error as { constraint?: string }).constraint
          === "human_sessions_authorization_state_hash_unique"
      ) {
        throw new HumanAuthConflictError(
          "The AI Card authorization transaction was already consumed",
        );
      }
      throw error;
    }
    if (!result.rows[0]) {
      throw new HumanAuthConflictError(
        "The verified AI Card identity is not linked to an active human Principal",
      );
    }
    return {
      sessionId: result.rows[0].id,
      expiresAt: result.rows[0].expires_at,
    };
  }

  async resolveSession(tokenHash: Buffer, now = new Date()): Promise<HumanSessionRecord | null> {
    const result = await this.pool.query<SessionRow>(
      `WITH valid_session AS (
         SELECT sessions.id,
                CASE
                  WHEN sessions.auth_method = 'aicard' THEN mappings.card_id
                  ELSE principals.ai_card_id
                END AS ai_card_id,
                CASE
                  WHEN sessions.auth_method = 'aicard' THEN principals.handle
                  ELSE credentials.login_handle
                END AS login_handle,
                principals.display_name,
                sessions.auth_method,
                sessions.identity_issuer,
                sessions.identity_client_id,
                sessions.identity_subject,
                sessions.authorization_state_hash,
                sessions.aicard_refresh_ciphertext,
                sessions.aicard_refresh_iv,
                sessions.aicard_refresh_tag,
                sessions.aicard_refresh_expires_at,
                sessions.aicard_last_validated_at
         FROM human_sessions AS sessions
         JOIN principals ON principals.id = sessions.principal_id
         LEFT JOIN human_credentials AS credentials
           ON credentials.principal_id = sessions.principal_id
         LEFT JOIN aicard_identity_mappings AS mappings
           ON mappings.issuer = sessions.identity_issuer
          AND mappings.client_id = sessions.identity_client_id
          AND mappings.subject = sessions.identity_subject
          AND mappings.principal_id = sessions.principal_id
         WHERE sessions.token_hash = $1
           AND sessions.revoked_at IS NULL
           AND sessions.expires_at > $2
           AND principals.kind = 'human'
           AND principals.status = 'active'
           AND (
             (
               sessions.auth_method = 'password'
               AND sessions.credential_version = credentials.credential_version
               AND credentials.status = 'active'
             )
             OR
             (
               sessions.auth_method = 'aicard'
               AND mappings.card_id IS NOT NULL
             )
           )
       ), updated_session AS (
         UPDATE human_sessions AS sessions
         SET last_seen_at = $2
         FROM valid_session
         WHERE sessions.id = valid_session.id
         RETURNING sessions.id AS session_id, sessions.principal_id,
                   sessions.expires_at, valid_session.ai_card_id,
                   valid_session.login_handle, valid_session.display_name,
                   valid_session.auth_method, valid_session.identity_issuer,
                   valid_session.identity_client_id, valid_session.identity_subject,
                   valid_session.authorization_state_hash,
                   valid_session.aicard_refresh_ciphertext,
                   valid_session.aicard_refresh_iv,
                   valid_session.aicard_refresh_tag,
                   valid_session.aicard_refresh_expires_at,
                   valid_session.aicard_last_validated_at
       )
       SELECT * FROM updated_session`,
      [tokenHash, now],
    );
    const row = result.rows[0];
    return row
      ? {
          sessionId: row.session_id,
          principalId: row.principal_id,
          aiCardId: row.ai_card_id,
          loginHandle: row.login_handle,
          displayName: row.display_name,
          authMethod: row.auth_method,
          expiresAt: row.expires_at,
          federatedAuthorization: row.auth_method === "aicard"
            && row.identity_issuer
            && row.identity_client_id
            && row.identity_subject
            && row.authorization_state_hash
            && row.aicard_refresh_ciphertext
            && row.aicard_refresh_iv
            && row.aicard_refresh_tag
            && row.aicard_refresh_expires_at
            && row.aicard_last_validated_at
            ? {
                issuer: row.identity_issuer,
                clientId: row.identity_client_id,
                subject: row.identity_subject,
                authorizationStateHash: row.authorization_state_hash,
                material: {
                  ciphertext: row.aicard_refresh_ciphertext,
                  iv: row.aicard_refresh_iv,
                  tag: row.aicard_refresh_tag,
                  refreshExpiresAt: row.aicard_refresh_expires_at,
                },
                lastValidatedAt: row.aicard_last_validated_at,
              }
            : null,
        }
      : null;
  }

  async updateFederatedSessionAuthorization(input: {
    sessionId: string;
    federatedAuthorization: FederatedAuthorizationMaterial;
    validatedAt: Date;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE human_sessions
       SET aicard_refresh_ciphertext = $2,
           aicard_refresh_iv = $3,
           aicard_refresh_tag = $4,
           aicard_refresh_expires_at = $5,
           aicard_last_validated_at = $6
       WHERE id = $1 AND auth_method = 'aicard' AND revoked_at IS NULL`,
      [
        input.sessionId,
        input.federatedAuthorization.ciphertext,
        input.federatedAuthorization.iv,
        input.federatedAuthorization.tag,
        input.federatedAuthorization.refreshExpiresAt,
        input.validatedAt,
      ],
    );
    return result.rowCount === 1;
  }

  async revokeSessionById(sessionId: string, now = new Date()): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE human_sessions
       SET revoked_at = COALESCE(revoked_at, $2),
           aicard_refresh_ciphertext = NULL,
           aicard_refresh_iv = NULL,
           aicard_refresh_tag = NULL
       WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, now],
    );
    return result.rowCount === 1;
  }

  async revokeSession(tokenHash: Buffer, now = new Date()): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE human_sessions
       SET revoked_at = COALESCE(revoked_at, $2),
           aicard_refresh_ciphertext = NULL,
           aicard_refresh_iv = NULL,
           aicard_refresh_tag = NULL
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash, now],
    );
    return result.rowCount === 1;
  }

  async getThrottle(scopeHash: Buffer): Promise<LoginThrottleRecord | null> {
    const result = await this.pool.query<ThrottleRow>(
      `SELECT failure_count, window_started_at, locked_until
       FROM login_throttles WHERE scope_hash = $1`,
      [scopeHash],
    );
    return result.rows[0] ? mapThrottle(result.rows[0]) : null;
  }

  async recordLoginFailure(
    scopeHash: Buffer,
    now = new Date(),
  ): Promise<LoginThrottleRecord> {
    return withTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext(encode($1, 'hex')))", [
        scopeHash,
      ]);
      const current = await client.query<ThrottleRow>(
        `SELECT failure_count, window_started_at, locked_until
         FROM login_throttles WHERE scope_hash = $1 FOR UPDATE`,
        [scopeHash],
      );
      const existing = current.rows[0];
      const withinWindow = existing
        && now.getTime() - existing.window_started_at.getTime() < THROTTLE_WINDOW_MS;
      const failureCount = withinWindow ? existing.failure_count + 1 : 1;
      const windowStartedAt = withinWindow ? existing.window_started_at : now;
      const lockedUntil = failureCount >= THROTTLE_FAILURE_LIMIT
        ? new Date(now.getTime() + THROTTLE_LOCK_MS)
        : null;
      const result = await client.query<ThrottleRow>(
        `INSERT INTO login_throttles
          (scope_hash, failure_count, window_started_at, locked_until, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (scope_hash) DO UPDATE SET
           failure_count = EXCLUDED.failure_count,
           window_started_at = EXCLUDED.window_started_at,
           locked_until = EXCLUDED.locked_until,
           updated_at = EXCLUDED.updated_at
         RETURNING failure_count, window_started_at, locked_until`,
        [scopeHash, failureCount, windowStartedAt, lockedUntil, now],
      );
      return mapThrottle(result.rows[0]);
    });
  }

  async clearThrottle(scopeHash: Buffer): Promise<void> {
    await this.pool.query(`DELETE FROM login_throttles WHERE scope_hash = $1`, [scopeHash]);
  }
}
