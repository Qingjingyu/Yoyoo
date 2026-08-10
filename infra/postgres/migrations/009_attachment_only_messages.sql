ALTER TABLE room_messages
  DROP CONSTRAINT room_messages_content_check,
  ADD CONSTRAINT room_messages_content_check CHECK (
    char_length(btrim(content)) BETWEEN 0 AND 32000
  );
