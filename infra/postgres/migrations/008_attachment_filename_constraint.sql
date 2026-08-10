ALTER TABLE attachments
  DROP CONSTRAINT attachments_original_name_check,
  ADD CONSTRAINT attachments_original_name_check CHECK (
    char_length(btrim(original_name)) BETWEEN 1 AND 255
    AND original_name !~ '[\\/]'
  );
