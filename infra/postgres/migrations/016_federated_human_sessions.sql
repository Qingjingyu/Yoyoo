ALTER TABLE human_sessions
  DROP CONSTRAINT human_sessions_principal_id_fkey,
  ALTER COLUMN credential_version DROP NOT NULL,
  ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'password',
  ADD COLUMN identity_issuer TEXT,
  ADD COLUMN identity_client_id TEXT,
  ADD COLUMN identity_subject TEXT,
  ADD CONSTRAINT human_sessions_principal_id_fkey
    FOREIGN KEY (principal_id) REFERENCES principals(id) ON DELETE CASCADE,
  ADD CONSTRAINT human_sessions_auth_method_check
    CHECK (auth_method IN ('password', 'aicard')),
  ADD CONSTRAINT human_sessions_auth_binding_check
    CHECK (
      (
        auth_method = 'password'
        AND credential_version IS NOT NULL
        AND identity_issuer IS NULL
        AND identity_client_id IS NULL
        AND identity_subject IS NULL
      )
      OR
      (
        auth_method = 'aicard'
        AND credential_version IS NULL
        AND identity_issuer IS NOT NULL
        AND identity_client_id IS NOT NULL
        AND identity_subject IS NOT NULL
      )
    ),
  ADD CONSTRAINT human_sessions_aicard_identity_fkey
    FOREIGN KEY (identity_issuer, identity_client_id, identity_subject)
    REFERENCES aicard_identity_mappings (issuer, client_id, subject)
    ON DELETE RESTRICT;

CREATE INDEX human_sessions_aicard_identity_idx
  ON human_sessions (identity_issuer, identity_client_id, identity_subject)
  WHERE auth_method = 'aicard' AND revoked_at IS NULL;
