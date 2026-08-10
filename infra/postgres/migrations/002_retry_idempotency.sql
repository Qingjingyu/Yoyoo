ALTER TABLE runs
  ADD COLUMN retry_of_run_id UUID REFERENCES runs(id) ON DELETE CASCADE,
  ADD COLUMN retry_idempotency_key TEXT,
  ADD CONSTRAINT runs_retry_fields_together_check CHECK (
    (retry_of_run_id IS NULL AND retry_idempotency_key IS NULL)
    OR (
      retry_of_run_id IS NOT NULL
      AND char_length(btrim(retry_idempotency_key)) BETWEEN 1 AND 128
    )
  );

CREATE UNIQUE INDEX runs_retry_idempotency_unique
  ON runs (retry_of_run_id, retry_idempotency_key)
  WHERE retry_of_run_id IS NOT NULL;
