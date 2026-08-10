ALTER TABLE rooms
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'group'
    CHECK (kind IN ('group', 'direct')),
  ADD COLUMN direct_human_principal_id UUID
    REFERENCES principals(id) ON DELETE RESTRICT,
  ADD COLUMN direct_agent_principal_id UUID
    REFERENCES principals(id) ON DELETE RESTRICT,
  ADD CONSTRAINT rooms_direct_pair_consistency_check CHECK (
    (kind = 'group'
      AND direct_human_principal_id IS NULL
      AND direct_agent_principal_id IS NULL)
    OR
    (kind = 'direct'
      AND direct_human_principal_id IS NOT NULL
      AND direct_agent_principal_id IS NOT NULL
      AND direct_human_principal_id <> direct_agent_principal_id)
  );

CREATE UNIQUE INDEX rooms_direct_pair_unique
  ON rooms (workspace_id, direct_human_principal_id, direct_agent_principal_id)
  WHERE kind = 'direct';

CREATE TABLE room_member_states (
  room_id UUID NOT NULL,
  principal_id UUID NOT NULL,
  last_read_message_id UUID,
  reading_message_id UUID,
  draft_content TEXT NOT NULL DEFAULT ''
    CHECK (char_length(draft_content) <= 32000),
  draft_revision BIGINT NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
  last_read_at TIMESTAMPTZ,
  reading_position_updated_at TIMESTAMPTZ,
  draft_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, principal_id),
  FOREIGN KEY (room_id, principal_id)
    REFERENCES room_members(room_id, principal_id) ON DELETE CASCADE,
  FOREIGN KEY (last_read_message_id, room_id)
    REFERENCES room_messages(id, room_id) ON DELETE SET NULL (last_read_message_id),
  FOREIGN KEY (reading_message_id, room_id)
    REFERENCES room_messages(id, room_id) ON DELETE SET NULL (reading_message_id),
  CHECK (updated_at >= created_at)
);

CREATE INDEX room_member_states_principal_idx
  ON room_member_states (principal_id, room_id);

INSERT INTO room_member_states (
  room_id,
  principal_id,
  last_read_message_id,
  reading_message_id,
  last_read_at,
  reading_position_updated_at
)
SELECT
  room_members.room_id,
  room_members.principal_id,
  latest.id,
  latest.id,
  CASE WHEN latest.id IS NULL THEN NULL ELSE NOW() END,
  CASE WHEN latest.id IS NULL THEN NULL ELSE NOW() END
FROM room_members
LEFT JOIN LATERAL (
  SELECT room_messages.id
  FROM room_messages
  WHERE room_messages.room_id = room_members.room_id
    AND room_messages.status = 'completed'
  ORDER BY room_messages.created_at DESC, room_messages.id DESC
  LIMIT 1
) AS latest ON TRUE;
