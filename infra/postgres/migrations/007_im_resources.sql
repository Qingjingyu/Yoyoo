CREATE TABLE attachments (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uploader_principal_id UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE
    CHECK (
      char_length(object_key) BETWEEN 16 AND 240
      AND object_key ~ '^[a-z0-9][a-z0-9/_-]+$'
    ),
  original_name TEXT NOT NULL
    CHECK (
      char_length(btrim(original_name)) BETWEEN 1 AND 255
      AND original_name !~ '[\\/]'
      AND position(chr(0) IN original_name) = 0
    ),
  declared_media_type TEXT NOT NULL
    CHECK (char_length(btrim(declared_media_type)) BETWEEN 1 AND 255),
  detected_media_type TEXT
    CHECK (
      detected_media_type IS NULL
      OR char_length(btrim(detected_media_type)) BETWEEN 1 AND 255
    ),
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes > 0),
  sha256 TEXT CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'failed')),
  provenance TEXT NOT NULL DEFAULT 'human_upload'
    CHECK (provenance IN ('human_upload', 'agent_output')),
  source_run_id UUID REFERENCES room_runs(id) ON DELETE SET NULL,
  error_code TEXT
    CHECK (
      error_code IS NULL
      OR char_length(btrim(error_code)) BETWEEN 1 AND 80
    ),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (workspace_id, uploader_principal_id)
    REFERENCES workspace_members(workspace_id, principal_id) ON DELETE RESTRICT,
  CHECK (updated_at >= created_at),
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (
    (status = 'pending'
      AND detected_media_type IS NULL
      AND size_bytes IS NULL
      AND sha256 IS NULL
      AND error_code IS NULL
      AND expires_at IS NOT NULL)
    OR (status = 'ready'
      AND detected_media_type IS NOT NULL
      AND size_bytes IS NOT NULL
      AND sha256 IS NOT NULL
      AND error_code IS NULL)
    OR (status = 'failed'
      AND error_code IS NOT NULL
      AND expires_at IS NOT NULL)
  ),
  CHECK (
    (provenance = 'human_upload' AND source_run_id IS NULL)
    OR (provenance = 'agent_output' AND source_run_id IS NOT NULL)
  )
);

CREATE INDEX attachments_workspace_status_idx
  ON attachments (workspace_id, status, created_at DESC, id);

CREATE INDEX attachments_uploader_status_idx
  ON attachments (uploader_principal_id, status, created_at DESC, id);

CREATE INDEX attachments_expiry_idx
  ON attachments (expires_at, id)
  WHERE expires_at IS NOT NULL;

CREATE TABLE message_attachments (
  workspace_id UUID NOT NULL,
  room_id UUID NOT NULL,
  message_id UUID NOT NULL,
  attachment_id UUID NOT NULL,
  position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 9),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, attachment_id),
  UNIQUE (message_id, position),
  UNIQUE (attachment_id),
  UNIQUE (attachment_id, room_id, workspace_id),
  FOREIGN KEY (room_id, workspace_id)
    REFERENCES rooms(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (message_id, room_id)
    REFERENCES room_messages(id, room_id) ON DELETE CASCADE,
  FOREIGN KEY (attachment_id, workspace_id)
    REFERENCES attachments(id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX message_attachments_room_idx
  ON message_attachments (room_id, linked_at DESC, message_id, position);

CREATE TABLE attachment_access_grants (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  room_id UUID NOT NULL,
  attachment_id UUID NOT NULL,
  run_id UUID NOT NULL,
  principal_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attachment_id, run_id, principal_id),
  FOREIGN KEY (room_id, workspace_id)
    REFERENCES rooms(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (attachment_id, room_id, workspace_id)
    REFERENCES message_attachments(attachment_id, room_id, workspace_id)
    ON DELETE CASCADE,
  FOREIGN KEY (run_id, room_id)
    REFERENCES room_runs(id, room_id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, principal_id)
    REFERENCES room_members(room_id, principal_id) ON DELETE CASCADE,
  CHECK (expires_at > created_at),
  CHECK (updated_at >= created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX attachment_access_grants_principal_active_idx
  ON attachment_access_grants (principal_id, expires_at, attachment_id, run_id)
  WHERE revoked_at IS NULL;

CREATE INDEX attachment_access_grants_expiry_idx
  ON attachment_access_grants (expires_at, id)
  WHERE revoked_at IS NULL;
