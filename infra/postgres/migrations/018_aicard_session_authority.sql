ALTER TABLE human_sessions
  ADD COLUMN aicard_refresh_ciphertext BYTEA,
  ADD COLUMN aicard_refresh_iv BYTEA,
  ADD COLUMN aicard_refresh_tag BYTEA,
  ADD COLUMN aicard_refresh_expires_at TIMESTAMPTZ,
  ADD COLUMN aicard_last_validated_at TIMESTAMPTZ;

-- Sessions created before this migration did not retain renewable authorization
-- material, so they cannot prove that the central AI Card grant is still valid.
UPDATE human_sessions
SET revoked_at = COALESCE(revoked_at, NOW())
WHERE auth_method = 'aicard' AND revoked_at IS NULL;

ALTER TABLE human_sessions
  ADD CONSTRAINT human_sessions_aicard_refresh_iv_length_check
    CHECK (aicard_refresh_iv IS NULL OR octet_length(aicard_refresh_iv) = 12),
  ADD CONSTRAINT human_sessions_aicard_refresh_tag_length_check
    CHECK (aicard_refresh_tag IS NULL OR octet_length(aicard_refresh_tag) = 16),
  ADD CONSTRAINT human_sessions_aicard_refresh_material_check
    CHECK (
      (
        auth_method = 'password'
        AND aicard_refresh_ciphertext IS NULL
        AND aicard_refresh_iv IS NULL
        AND aicard_refresh_tag IS NULL
        AND aicard_refresh_expires_at IS NULL
        AND aicard_last_validated_at IS NULL
      )
      OR
      (
        auth_method = 'aicard'
        AND (
          revoked_at IS NOT NULL
          OR (
            aicard_refresh_ciphertext IS NOT NULL
            AND aicard_refresh_iv IS NOT NULL
            AND aicard_refresh_tag IS NOT NULL
            AND aicard_refresh_expires_at IS NOT NULL
            AND aicard_last_validated_at IS NOT NULL
          )
        )
      )
    );

CREATE INDEX human_sessions_aicard_validation_due_idx
  ON human_sessions (aicard_last_validated_at)
  WHERE auth_method = 'aicard' AND revoked_at IS NULL;
