ALTER TABLE principals
  ALTER COLUMN ai_card_id DROP DEFAULT;

UPDATE principals
SET ai_card_id = 'AI_100002'
WHERE ai_card_id = 'AI_100001'
  AND kind <> 'human'
  AND NOT EXISTS (
    SELECT 1 FROM principals WHERE kind = 'human'
  );

SELECT setval(
  'ai_card_public_id_sequence',
  COALESCE(
    (
      SELECT MAX(substring(ai_card_id FROM 4)::BIGINT)
      FROM principals
      WHERE ai_card_id <> 'AI_100001'
    ),
    100002
  ),
  EXISTS (SELECT 1 FROM principals WHERE ai_card_id <> 'AI_100001')
);

CREATE FUNCTION assign_ai_card_public_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ai_card_id IS NOT NULL THEN
    RAISE EXCEPTION 'AI Card ID is assigned by the database';
  END IF;

  IF NEW.kind = 'human' THEN
    PERFORM pg_advisory_xact_lock(hashtext('yoyoo-ai-card-first-human-v1'));
  END IF;

  IF NEW.kind = 'human'
     AND NOT EXISTS (
       SELECT 1 FROM principals WHERE ai_card_id = 'AI_100001'
     ) THEN
    NEW.ai_card_id := 'AI_100001';
  ELSE
    NEW.ai_card_id := 'AI_' || nextval('ai_card_public_id_sequence')::TEXT;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER principals_assign_ai_card_public_id
BEFORE INSERT ON principals
FOR EACH ROW EXECUTE FUNCTION assign_ai_card_public_id();

CREATE FUNCTION prevent_ai_card_public_id_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ai_card_id IS DISTINCT FROM OLD.ai_card_id THEN
    RAISE EXCEPTION 'AI Card ID is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER principals_prevent_ai_card_public_id_change
BEFORE UPDATE OF ai_card_id ON principals
FOR EACH ROW EXECUTE FUNCTION prevent_ai_card_public_id_change();
