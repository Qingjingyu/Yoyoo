CREATE SEQUENCE ai_card_public_id_sequence
  AS BIGINT
  START WITH 100001
  INCREMENT BY 1
  NO CYCLE;

ALTER TABLE principals
  ADD COLUMN ai_card_id TEXT;

WITH ranked_principals AS (
  SELECT
    principals.id,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM workspace_members
            WHERE workspace_members.principal_id = principals.id
              AND workspace_members.role = 'owner'
              AND workspace_members.status = 'active'
          ) THEN 0
          WHEN principals.kind = 'human' THEN 1
          WHEN principals.kind = 'agent' THEN 2
          ELSE 3
        END,
        principals.created_at,
        principals.id
    ) AS public_number
  FROM principals
)
UPDATE principals
SET ai_card_id = 'AI_' || (100000 + ranked_principals.public_number)::TEXT
FROM ranked_principals
WHERE principals.id = ranked_principals.id;

SELECT setval(
  'ai_card_public_id_sequence',
  GREATEST(100000 + (SELECT COUNT(*) FROM principals), 100000),
  (SELECT COUNT(*) FROM principals) > 0
);

ALTER TABLE principals
  ALTER COLUMN ai_card_id SET DEFAULT
    ('AI_' || nextval('ai_card_public_id_sequence')::TEXT),
  ALTER COLUMN ai_card_id SET NOT NULL,
  ADD CONSTRAINT principals_ai_card_id_format_check
    CHECK (ai_card_id ~ '^AI_[1-9][0-9]{5,}$'),
  ADD CONSTRAINT principals_ai_card_id_unique UNIQUE (ai_card_id);

CREATE TABLE human_credentials (
  principal_id UUID PRIMARY KEY REFERENCES principals(id) ON DELETE CASCADE,
  login_handle TEXT NOT NULL,
  password_hash BYTEA NOT NULL CHECK (octet_length(password_hash) >= 32),
  password_salt BYTEA NOT NULL CHECK (octet_length(password_salt) >= 16),
  password_algorithm TEXT NOT NULL
    CHECK (password_algorithm IN ('scrypt-v1')),
  recovery_code_hash BYTEA
    CHECK (recovery_code_hash IS NULL OR octet_length(recovery_code_hash) = 32),
  recovery_code_used_at TIMESTAMPTZ,
  credential_version INTEGER NOT NULL DEFAULT 1
    CHECK (credential_version > 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (login_handle = lower(login_handle)),
  CHECK (login_handle ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  CHECK (updated_at >= created_at),
  CHECK (recovery_code_used_at IS NULL OR recovery_code_hash IS NOT NULL)
);

CREATE UNIQUE INDEX human_credentials_login_handle_unique
  ON human_credentials (lower(login_handle));

CREATE TABLE human_sessions (
  id UUID PRIMARY KEY,
  principal_id UUID NOT NULL
    REFERENCES human_credentials(principal_id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  credential_version INTEGER NOT NULL CHECK (credential_version > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > created_at),
  CHECK (last_seen_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX human_sessions_principal_active_idx
  ON human_sessions (principal_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE login_throttles (
  scope_hash BYTEA PRIMARY KEY CHECK (octet_length(scope_hash) = 32),
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (updated_at >= window_started_at)
);

CREATE INDEX login_throttles_locked_idx
  ON login_throttles (locked_until)
  WHERE locked_until IS NOT NULL;
