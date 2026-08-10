CREATE TABLE agent_gateway_credentials (
  principal_id UUID PRIMARY KEY REFERENCES principals(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint TEXT NOT NULL
    CHECK (char_length(token_hint) BETWEEN 6 AND 16),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  FOREIGN KEY (workspace_id, principal_id)
    REFERENCES workspace_members(workspace_id, principal_id) ON DELETE CASCADE,
  CHECK (updated_at >= created_at),
  CHECK (last_seen_at IS NULL OR last_seen_at >= created_at),
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX agent_gateway_credentials_workspace_idx
  ON agent_gateway_credentials (workspace_id, status, updated_at DESC, principal_id);

CREATE INDEX agent_gateway_credentials_presence_idx
  ON agent_gateway_credentials (status, last_seen_at DESC)
  WHERE status = 'active';

CREATE TABLE agent_gateway_jobs (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL UNIQUE REFERENCES room_runs(id) ON DELETE CASCADE,
  principal_id UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
  request JSONB NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'leased', 'completed', 'failed')),
  lease_id UUID,
  leased_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  result JSONB CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  result_digest TEXT CHECK (
    result_digest IS NULL OR result_digest ~ '^[0-9a-f]{64}$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  CHECK (updated_at >= created_at),
  CHECK (
    (status = 'queued'
      AND lease_id IS NULL
      AND leased_at IS NULL
      AND lease_expires_at IS NULL
      AND result IS NULL
      AND result_digest IS NULL
      AND finished_at IS NULL)
    OR (status = 'leased'
      AND lease_id IS NOT NULL
      AND leased_at IS NOT NULL
      AND lease_expires_at > leased_at
      AND result IS NULL
      AND result_digest IS NULL
      AND finished_at IS NULL)
    OR (status IN ('completed', 'failed')
      AND lease_id IS NOT NULL
      AND leased_at IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND result IS NOT NULL
      AND result_digest IS NOT NULL
      AND finished_at IS NOT NULL)
  )
);

CREATE INDEX agent_gateway_jobs_claim_idx
  ON agent_gateway_jobs (principal_id, status, lease_expires_at, created_at, id)
  WHERE status IN ('queued', 'leased');

CREATE INDEX agent_gateway_jobs_terminal_idx
  ON agent_gateway_jobs (principal_id, finished_at DESC, id)
  WHERE status IN ('completed', 'failed');
