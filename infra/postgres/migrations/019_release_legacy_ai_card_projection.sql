-- AI Card is now authoritative. The legacy projection can be cleared only by
-- the guarded owner-cutover operation after a verified mapping and session exist.
DROP TRIGGER IF EXISTS principals_prevent_ai_card_public_id_change ON principals;
DROP FUNCTION IF EXISTS prevent_ai_card_public_id_change();
