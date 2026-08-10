CREATE TABLE agent_gateway_runtime_presence (
  principal_id UUID PRIMARY KEY REFERENCES principals(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL CHECK (char_length(btrim(issuer)) BETWEEN 8 AND 2048),
  client_id TEXT NOT NULL
    CHECK (client_id ~ '^[a-z][a-z0-9_-]{2,63}$'),
  subject TEXT NOT NULL
    CHECK (subject ~ '^sub_[A-Za-z0-9_-]{43}$'),
  node_id UUID NOT NULL,
  session_expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (issuer, client_id, subject),
  FOREIGN KEY (workspace_id, principal_id)
    REFERENCES workspace_members(workspace_id, principal_id) ON DELETE CASCADE,
  FOREIGN KEY (issuer, client_id, subject)
    REFERENCES aicard_identity_mappings(issuer, client_id, subject) ON DELETE CASCADE,
  CHECK (session_expires_at > last_seen_at),
  CHECK (updated_at >= created_at)
);

CREATE INDEX agent_gateway_runtime_presence_workspace_idx
  ON agent_gateway_runtime_presence
  (workspace_id, session_expires_at DESC, last_seen_at DESC, principal_id);
