DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'agent_admission_invitations'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%admitted%admitted_at%';

  IF constraint_name IS NULL THEN
    RAISE EXCEPTION 'admitted_at constraint was not found';
  END IF;
  EXECUTE format(
    'ALTER TABLE agent_admission_invitations DROP CONSTRAINT %I',
    constraint_name
  );
END $$;

ALTER TABLE agent_admission_invitations
  ADD CONSTRAINT agent_admission_invitations_admitted_at_check CHECK (
    (status = 'admitted' AND admitted_at IS NOT NULL)
    OR (status = 'revoked')
    OR (status NOT IN ('admitted', 'revoked') AND admitted_at IS NULL)
  );
