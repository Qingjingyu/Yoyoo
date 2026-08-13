ALTER TABLE human_sessions
  ADD COLUMN authorization_state_hash BYTEA;

UPDATE human_sessions
SET authorization_state_hash = decode(
  md5(id::TEXT) || md5(id::TEXT || ':aicard-authorization-migration'),
  'hex'
)
WHERE auth_method = 'aicard' AND authorization_state_hash IS NULL;

ALTER TABLE human_sessions
  ADD CONSTRAINT human_sessions_authorization_state_hash_length_check
    CHECK (
      authorization_state_hash IS NULL
      OR octet_length(authorization_state_hash) = 32
    ),
  ADD CONSTRAINT human_sessions_aicard_authorization_state_check
    CHECK (
      (auth_method = 'password' AND authorization_state_hash IS NULL)
      OR
      (auth_method = 'aicard' AND authorization_state_hash IS NOT NULL)
    ),
  ADD CONSTRAINT human_sessions_authorization_state_hash_unique
    UNIQUE (authorization_state_hash);
