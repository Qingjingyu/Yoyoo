CREATE TABLE principals (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'agent', 'system')),
  external_key TEXT NOT NULL UNIQUE
    CHECK (char_length(btrim(external_key)) BETWEEN 1 AND 200),
  handle TEXT NOT NULL
    CHECK (char_length(btrim(handle)) BETWEEN 1 AND 80),
  display_name TEXT NOT NULL
    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (updated_at >= created_at)
);

CREATE INDEX principals_kind_status_idx ON principals (kind, status, created_at);

CREATE TABLE workspaces (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (updated_at >= created_at)
);

CREATE TABLE workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  principal_id UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'removed')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, principal_id),
  CHECK (updated_at >= joined_at)
);

CREATE INDEX workspace_members_principal_idx
  ON workspace_members (principal_id, status, workspace_id);

CREATE TABLE rooms (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  legacy_conversation_id UUID UNIQUE
    REFERENCES conversations(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 240),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_by_principal_id UUID NOT NULL
    REFERENCES principals(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_id),
  CHECK (updated_at >= created_at)
);

CREATE INDEX rooms_workspace_status_idx
  ON rooms (workspace_id, status, updated_at DESC, id);

CREATE TABLE room_members (
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  principal_id UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  listener_policy TEXT NOT NULL DEFAULT 'mention_only'
    CHECK (listener_policy IN ('always', 'mention_only', 'muted')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'removed')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, principal_id),
  CHECK (updated_at >= joined_at)
);

CREATE INDEX room_members_principal_idx
  ON room_members (principal_id, status, room_id);

CREATE TABLE room_messages (
  id UUID PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_principal_id UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL DEFAULT 'message'
    CHECK (kind IN ('message', 'intervention', 'system')),
  content TEXT NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 32000),
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'streaming', 'completed', 'stopped', 'failed')),
  idempotency_key TEXT,
  reply_to_message_id UUID,
  thread_root_message_id UUID,
  legacy_message_id UUID UNIQUE REFERENCES messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, room_id),
  FOREIGN KEY (reply_to_message_id, room_id)
    REFERENCES room_messages(id, room_id) ON DELETE SET NULL (reply_to_message_id),
  FOREIGN KEY (thread_root_message_id, room_id)
    REFERENCES room_messages(id, room_id) ON DELETE SET NULL (thread_root_message_id),
  CHECK (updated_at >= created_at),
  CHECK (reply_to_message_id IS NULL OR reply_to_message_id <> id),
  CHECK (thread_root_message_id IS NULL OR thread_root_message_id <> id),
  CHECK (
    idempotency_key IS NULL
    OR char_length(btrim(idempotency_key)) BETWEEN 1 AND 128
  )
);

CREATE UNIQUE INDEX room_messages_idempotency_unique
  ON room_messages (room_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX room_messages_chronological_idx
  ON room_messages (room_id, created_at, id);

CREATE INDEX room_messages_thread_idx
  ON room_messages (room_id, thread_root_message_id, created_at, id)
  WHERE thread_root_message_id IS NOT NULL;

CREATE TABLE message_mentions (
  message_id UUID NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
  mentioned_principal_id UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, mentioned_principal_id)
);

CREATE INDEX message_mentions_principal_idx
  ON message_mentions (mentioned_principal_id, created_at, message_id);

CREATE TABLE agent_bindings (
  principal_id UUID PRIMARY KEY REFERENCES principals(id) ON DELETE CASCADE,
  adapter_id TEXT NOT NULL
    CHECK (char_length(btrim(adapter_id)) BETWEEN 1 AND 80),
  config_key TEXT
    CHECK (config_key IS NULL OR char_length(btrim(config_key)) BETWEEN 1 AND 128),
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(capabilities) = 'object'),
  status TEXT NOT NULL DEFAULT 'enabled'
    CHECK (status IN ('enabled', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (updated_at >= created_at)
);

CREATE INDEX agent_bindings_adapter_idx
  ON agent_bindings (adapter_id, status, principal_id);

CREATE TABLE room_runs (
  id UUID PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  trigger_message_id UUID NOT NULL,
  target_agent_principal_id UUID NOT NULL
    REFERENCES principals(id) ON DELETE RESTRICT,
  output_message_id UUID,
  adapter_id TEXT NOT NULL
    CHECK (char_length(btrim(adapter_id)) BETWEEN 1 AND 80),
  trigger_type TEXT NOT NULL DEFAULT 'message'
    CHECK (trigger_type IN ('message', 'delegation', 'retry')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'waiting', 'completed', 'stopped', 'failed')),
  idempotency_key TEXT NOT NULL
    CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 128),
  retry_of_run_id UUID REFERENCES room_runs(id) ON DELETE SET NULL,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, room_id),
  FOREIGN KEY (trigger_message_id, room_id)
    REFERENCES room_messages(id, room_id) ON DELETE RESTRICT,
  FOREIGN KEY (output_message_id, room_id)
    REFERENCES room_messages(id, room_id) ON DELETE SET NULL (output_message_id),
  CHECK (updated_at >= created_at),
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at),
  CHECK (
    (status IN ('completed', 'stopped', 'failed') AND finished_at IS NOT NULL)
    OR (status IN ('queued', 'running', 'waiting') AND finished_at IS NULL)
  ),
  CHECK (
    (status = 'failed' AND error_code IS NOT NULL AND error_message IS NOT NULL)
    OR (status <> 'failed' AND error_code IS NULL AND error_message IS NULL)
  )
);

CREATE UNIQUE INDEX room_runs_idempotency_unique
  ON room_runs (room_id, idempotency_key);

CREATE INDEX room_runs_room_chronological_idx
  ON room_runs (room_id, created_at, id);

CREATE INDEX room_runs_agent_active_idx
  ON room_runs (target_agent_principal_id, status, created_at)
  WHERE status IN ('queued', 'running', 'waiting');

CREATE TABLE room_run_events (
  run_id UUID NOT NULL REFERENCES room_runs(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'status', 'text_delta', 'message', 'delegation', 'artifact',
      'completed', 'failed', 'stopped'
    )),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, sequence)
);

CREATE INDEX room_run_events_created_at_idx
  ON room_run_events (run_id, created_at, sequence);

CREATE TABLE delegations (
  id UUID PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  delegator_principal_id UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
  delegate_principal_id UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
  parent_run_id UUID NOT NULL,
  child_run_id UUID,
  objective TEXT NOT NULL CHECK (char_length(btrim(objective)) BETWEEN 1 AND 8000),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'accepted', 'running', 'completed', 'stopped', 'failed')),
  idempotency_key TEXT NOT NULL
    CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 128),
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  FOREIGN KEY (parent_run_id, room_id)
    REFERENCES room_runs(id, room_id) ON DELETE CASCADE,
  FOREIGN KEY (child_run_id, room_id)
    REFERENCES room_runs(id, room_id) ON DELETE SET NULL (child_run_id),
  CHECK (delegator_principal_id <> delegate_principal_id),
  CHECK (updated_at >= created_at),
  CHECK (finished_at IS NULL OR finished_at >= created_at),
  CHECK (
    (status = 'failed' AND error_code IS NOT NULL AND error_message IS NOT NULL)
    OR (status <> 'failed' AND error_code IS NULL AND error_message IS NULL)
  )
);

CREATE UNIQUE INDEX delegations_idempotency_unique
  ON delegations (room_id, idempotency_key);

CREATE INDEX delegations_room_status_idx
  ON delegations (room_id, status, created_at, id);

CREATE TABLE artifacts (
  id UUID PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  producer_principal_id UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
  source_run_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'markdown', 'file')),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000000),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'superseded', 'failed')),
  idempotency_key TEXT NOT NULL
    CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (source_run_id, room_id)
    REFERENCES room_runs(id, room_id) ON DELETE RESTRICT,
  CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX artifacts_idempotency_unique
  ON artifacts (room_id, idempotency_key);

CREATE INDEX artifacts_room_created_idx
  ON artifacts (room_id, created_at, id);

-- The global system principal is used only for observable platform messages.
INSERT INTO principals (id, kind, external_key, handle, display_name)
VALUES (md5('system:yoyoo')::uuid, 'system', 'system:yoyoo', 'yoyoo', 'Yoyoo')
ON CONFLICT (external_key) DO NOTHING;

INSERT INTO principals (id, kind, external_key, handle, display_name, created_at, updated_at)
SELECT
  md5('human:' || owner_id)::uuid,
  'human',
  'human:' || owner_id,
  left(owner_id, 80),
  left(owner_id, 120),
  MIN(created_at),
  MAX(updated_at)
FROM conversations
GROUP BY owner_id
ON CONFLICT (external_key) DO NOTHING;

INSERT INTO principals (id, kind, external_key, handle, display_name, created_at, updated_at)
SELECT
  md5('agent:' || agent_id)::uuid,
  'agent',
  'agent:' || agent_id,
  left(agent_id, 80),
  left(agent_id, 120),
  MIN(created_at),
  MAX(updated_at)
FROM conversations
GROUP BY agent_id
ON CONFLICT (external_key) DO NOTHING;

INSERT INTO workspaces (id, slug, name, status, created_at, updated_at)
SELECT
  md5('workspace:' || owner_id)::uuid,
  'legacy-' || left(md5(owner_id), 24),
  left(owner_id || '''s Space', 120),
  'active',
  MIN(created_at),
  MAX(updated_at)
FROM conversations
GROUP BY owner_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspace_members (workspace_id, principal_id, role, joined_at, updated_at)
SELECT
  md5('workspace:' || owner_id)::uuid,
  md5('human:' || owner_id)::uuid,
  'owner',
  MIN(created_at),
  MAX(updated_at)
FROM conversations
GROUP BY owner_id
ON CONFLICT (workspace_id, principal_id) DO NOTHING;

INSERT INTO workspace_members (workspace_id, principal_id, role, joined_at, updated_at)
SELECT
  md5('workspace:' || owner_id)::uuid,
  md5('agent:' || agent_id)::uuid,
  'member',
  MIN(created_at),
  MAX(updated_at)
FROM conversations
GROUP BY owner_id, agent_id
ON CONFLICT (workspace_id, principal_id) DO NOTHING;

INSERT INTO rooms (
  id, workspace_id, legacy_conversation_id, name, status,
  created_by_principal_id, created_at, updated_at
)
SELECT
  id,
  md5('workspace:' || owner_id)::uuid,
  id,
  COALESCE(title, 'Conversation'),
  status,
  md5('human:' || owner_id)::uuid,
  created_at,
  updated_at
FROM conversations
ON CONFLICT (id) DO NOTHING;

INSERT INTO room_members (room_id, principal_id, role, listener_policy, joined_at, updated_at)
SELECT
  id,
  md5('human:' || owner_id)::uuid,
  'owner',
  'always',
  created_at,
  updated_at
FROM conversations
ON CONFLICT (room_id, principal_id) DO NOTHING;

INSERT INTO room_members (room_id, principal_id, role, listener_policy, joined_at, updated_at)
SELECT
  id,
  md5('agent:' || agent_id)::uuid,
  'member',
  'mention_only',
  created_at,
  updated_at
FROM conversations
ON CONFLICT (room_id, principal_id) DO NOTHING;

INSERT INTO room_members (room_id, principal_id, role, listener_policy, joined_at, updated_at)
SELECT
  id,
  md5('system:yoyoo')::uuid,
  'member',
  'muted',
  created_at,
  updated_at
FROM conversations
ON CONFLICT (room_id, principal_id) DO NOTHING;

INSERT INTO room_messages (
  id, room_id, sender_principal_id, kind, content, status, idempotency_key,
  legacy_message_id, created_at, updated_at
)
SELECT
  messages.id,
  messages.conversation_id,
  CASE messages.sender_type
    WHEN 'human' THEN md5('human:' || conversations.owner_id)::uuid
    WHEN 'agent' THEN md5('agent:' || conversations.agent_id)::uuid
    ELSE md5('system:yoyoo')::uuid
  END,
  CASE WHEN messages.sender_type = 'system' THEN 'system' ELSE 'message' END,
  messages.content,
  messages.status,
  messages.idempotency_key,
  messages.id,
  messages.created_at,
  messages.updated_at
FROM messages
JOIN conversations ON conversations.id = messages.conversation_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_bindings (
  principal_id, adapter_id, capabilities, status, created_at, updated_at
)
SELECT
  md5('agent:' || conversations.agent_id)::uuid,
  conversations.agent_id,
  '{}'::jsonb,
  'enabled',
  MIN(conversations.created_at),
  MAX(conversations.updated_at)
FROM conversations
GROUP BY conversations.agent_id
ON CONFLICT (principal_id) DO NOTHING;

INSERT INTO room_runs (
  id, room_id, trigger_message_id, target_agent_principal_id,
  output_message_id, adapter_id, trigger_type, status, idempotency_key,
  retry_of_run_id, error_code, error_message, started_at, finished_at,
  created_at, updated_at
)
SELECT
  runs.id,
  runs.conversation_id,
  runs.user_message_id,
  md5('agent:' || conversations.agent_id)::uuid,
  runs.agent_message_id,
  runs.adapter_id,
  CASE WHEN runs.retry_of_run_id IS NULL THEN 'message' ELSE 'retry' END,
  runs.status,
  'legacy-run:' || runs.id::text,
  runs.retry_of_run_id,
  runs.error_code,
  runs.error_message,
  runs.started_at,
  runs.finished_at,
  runs.created_at,
  runs.updated_at
FROM runs
JOIN conversations ON conversations.id = runs.conversation_id
ORDER BY runs.created_at, runs.id
ON CONFLICT (id) DO NOTHING;

INSERT INTO room_run_events (run_id, sequence, event_type, payload, created_at)
SELECT run_id, sequence, event_type, payload, created_at
FROM run_events
ON CONFLICT (run_id, sequence) DO NOTHING;
