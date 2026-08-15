ALTER TABLE agent_admission_invitations
  ADD COLUMN machine_name TEXT CHECK (
    machine_name IS NULL
    OR machine_name ~ '^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$'
  );
