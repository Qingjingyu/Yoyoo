CREATE TABLE aicard_identity_mappings (
  issuer TEXT NOT NULL CHECK (char_length(btrim(issuer)) BETWEEN 8 AND 2048),
  client_id TEXT NOT NULL
    CHECK (client_id ~ '^[a-z][a-z0-9_-]{2,63}$'),
  subject TEXT NOT NULL
    CHECK (subject ~ '^sub_[A-Za-z0-9_-]{43}$'),
  principal_id UUID NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (issuer, client_id, subject),
  UNIQUE (issuer, client_id, principal_id),
  CHECK (updated_at >= created_at),
  CHECK (last_verified_at >= created_at)
);

CREATE INDEX aicard_identity_mappings_principal_idx
  ON aicard_identity_mappings (principal_id, issuer, client_id);
