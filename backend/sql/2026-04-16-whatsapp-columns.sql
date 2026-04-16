-- Add owner_phone_number to client_settings
-- This is the business owner's personal WhatsApp number, used to identify
-- owner replies vs customer messages. Previously stored in business_profiles
-- as business_owner_phone; moving it to client_settings so all WhatsApp
-- credentials live in one table.

ALTER TABLE client_settings
  ADD COLUMN IF NOT EXISTS owner_phone_number text;

COMMENT ON COLUMN client_settings.owner_phone_number
  IS 'Business owner personal phone number — used to detect owner replies on WhatsApp';

-- Backfill from business_profiles if the column existed there
UPDATE client_settings cs
SET owner_phone_number = bp.business_owner_phone
FROM business_profiles bp
WHERE bp.user_id = cs.user_id
  AND bp.business_owner_phone IS NOT NULL
  AND cs.owner_phone_number IS NULL;
