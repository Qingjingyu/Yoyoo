ALTER TABLE rooms
  ADD COLUMN purpose TEXT NOT NULL DEFAULT ''
    CHECK (char_length(purpose) <= 500);

ALTER TABLE room_member_states
  ADD COLUMN pinned_at TIMESTAMPTZ,
  ADD COLUMN hidden_at TIMESTAMPTZ;

CREATE INDEX room_member_states_principal_pinned_idx
  ON room_member_states (principal_id, pinned_at DESC, room_id)
  WHERE pinned_at IS NOT NULL;
