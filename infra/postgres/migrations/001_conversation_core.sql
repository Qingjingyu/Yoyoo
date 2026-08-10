CREATE TABLE conversations (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL CHECK (char_length(btrim(owner_id)) BETWEEN 1 AND 128),
  agent_id TEXT NOT NULL CHECK (char_length(btrim(agent_id)) BETWEEN 1 AND 80),
  title TEXT CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 240),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (updated_at >= created_at)
);

CREATE TABLE messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL
    REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL
    CHECK (sender_type IN ('human', 'agent', 'system')),
  content TEXT NOT NULL
    CHECK (char_length(btrim(content)) BETWEEN 1 AND 32000),
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'streaming', 'completed', 'stopped', 'failed')),
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, conversation_id),
  CHECK (updated_at >= created_at),
  CHECK (
    idempotency_key IS NULL
    OR char_length(btrim(idempotency_key)) BETWEEN 1 AND 128
  )
);

CREATE UNIQUE INDEX messages_conversation_idempotency_unique
  ON messages (conversation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX messages_conversation_chronological_idx
  ON messages (conversation_id, created_at, id);

CREATE TABLE runs (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL
    REFERENCES conversations(id) ON DELETE CASCADE,
  user_message_id UUID NOT NULL,
  agent_message_id UUID,
  adapter_id TEXT NOT NULL
    CHECK (char_length(btrim(adapter_id)) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'stopped', 'failed')),
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_message_id, conversation_id)
    REFERENCES messages(id, conversation_id) ON DELETE RESTRICT,
  FOREIGN KEY (agent_message_id, conversation_id)
    REFERENCES messages(id, conversation_id) ON DELETE SET NULL (agent_message_id),
  CHECK (updated_at >= created_at),
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at),
  CHECK (
    (status IN ('completed', 'stopped', 'failed') AND finished_at IS NOT NULL)
    OR (status IN ('queued', 'running') AND finished_at IS NULL)
  ),
  CHECK (
    (status = 'failed' AND error_code IS NOT NULL AND error_message IS NOT NULL)
    OR (status <> 'failed' AND error_code IS NULL AND error_message IS NULL)
  )
);

CREATE INDEX runs_conversation_chronological_idx
  ON runs (conversation_id, created_at, id);

CREATE INDEX runs_non_terminal_idx
  ON runs (status, created_at)
  WHERE status IN ('queued', 'running');

CREATE TABLE run_events (
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('status', 'text_delta', 'completed', 'failed', 'stopped')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, sequence)
);

CREATE INDEX run_events_created_at_idx
  ON run_events (run_id, created_at);
