DROP TRIGGER IF EXISTS principals_assign_ai_card_public_id ON principals;
DROP FUNCTION IF EXISTS assign_ai_card_public_id();
DROP SEQUENCE IF EXISTS ai_card_public_id_sequence;

ALTER TABLE principals
  ALTER COLUMN ai_card_id DROP NOT NULL;

ALTER TABLE aicard_identity_mappings
  ADD COLUMN card_id TEXT,
  ADD CONSTRAINT aicard_identity_mappings_card_id_format_check
    CHECK (card_id IS NULL OR card_id ~ '^AI_[1-9][0-9]{5,}$'),
  ADD CONSTRAINT aicard_identity_mappings_card_id_unique
    UNIQUE (issuer, client_id, card_id);
