ALTER TABLE room_messages
  ADD COLUMN revision_number INTEGER NOT NULL DEFAULT 1
    CHECK (revision_number > 0),
  ADD COLUMN retracted_at TIMESTAMPTZ,
  ADD COLUMN retracted_by_principal_id UUID
    REFERENCES principals(id) ON DELETE RESTRICT,
  ADD CONSTRAINT room_messages_retraction_consistency_check CHECK (
    (retracted_at IS NULL AND retracted_by_principal_id IS NULL)
    OR (retracted_at IS NOT NULL AND retracted_by_principal_id IS NOT NULL)
  );

CREATE TABLE room_message_revisions (
  id UUID PRIMARY KEY,
  room_id UUID NOT NULL,
  message_id UUID NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  action TEXT NOT NULL CHECK (action IN ('created', 'edited', 'retracted')),
  actor_principal_id UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
  content TEXT NOT NULL CHECK (char_length(content) <= 32000),
  mentioned_principal_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, revision_number),
  FOREIGN KEY (message_id, room_id)
    REFERENCES room_messages(id, room_id) ON DELETE RESTRICT
);

CREATE INDEX room_message_revisions_message_idx
  ON room_message_revisions (message_id, revision_number DESC);

INSERT INTO room_message_revisions (
  id,
  room_id,
  message_id,
  revision_number,
  action,
  actor_principal_id,
  content,
  mentioned_principal_ids,
  created_at
)
SELECT
  gen_random_uuid(),
  room_messages.room_id,
  room_messages.id,
  1,
  'created',
  room_messages.sender_principal_id,
  room_messages.content,
  COALESCE(
    array_agg(message_mentions.mentioned_principal_id
      ORDER BY message_mentions.mentioned_principal_id)
      FILTER (WHERE message_mentions.mentioned_principal_id IS NOT NULL),
    ARRAY[]::UUID[]
  ),
  room_messages.created_at
FROM room_messages
LEFT JOIN message_mentions ON message_mentions.message_id = room_messages.id
GROUP BY room_messages.id;
