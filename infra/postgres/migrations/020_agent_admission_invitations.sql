CREATE TABLE agent_admission_invitations (
  invitation_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_principal_id UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
  aicard_invitation_id UUID NOT NULL UNIQUE,
  display_name TEXT NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  ticket_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(ticket_hash) = 32),
  permissions TEXT[] NOT NULL CHECK (
    cardinality(permissions) BETWEEN 1 AND 4
    AND permissions <@ ARRAY[
      'message.read', 'message.write', 'attachment.read', 'attachment.write'
    ]::TEXT[]
  ),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'admitted', 'revoked', 'failed')),
  expires_at TIMESTAMPTZ NOT NULL,
  claim_id UUID UNIQUE,
  identity_issuer TEXT,
  identity_client_id TEXT,
  identity_subject TEXT,
  node_id UUID,
  principal_id UUID REFERENCES principals(id) ON DELETE RESTRICT,
  card_id TEXT,
  admitted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > created_at),
  CHECK ((status = 'admitted') = (admitted_at IS NOT NULL)),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CHECK (updated_at >= created_at)
);

CREATE INDEX agent_admission_invitations_workspace_idx
  ON agent_admission_invitations (workspace_id, created_at DESC);

CREATE TABLE agent_admission_rooms (
  invitation_id UUID NOT NULL
    REFERENCES agent_admission_invitations(invitation_id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  PRIMARY KEY (invitation_id, room_id)
);

CREATE INDEX agent_admission_rooms_room_idx
  ON agent_admission_rooms (room_id, invitation_id);
