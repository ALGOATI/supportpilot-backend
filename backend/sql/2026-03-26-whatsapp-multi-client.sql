-- Multi-client WhatsApp integration: per-client WhatsApp credentials
-- Safe migration: adds columns to existing client_settings table

ALTER TABLE client_settings
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_waba_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_access_token text,
  ADD COLUMN IF NOT EXISTS whatsapp_connected boolean NOT NULL DEFAULT false;

-- Index for fast webhook routing: find client by their phone_number_id
CREATE INDEX IF NOT EXISTS idx_client_settings_wa_phone_number_id
  ON client_settings (whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id IS NOT NULL;

-- Ensure no two clients register the same phone_number_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_settings_wa_phone_number_id_unique
  ON client_settings (whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id IS NOT NULL AND whatsapp_connected = true;

-- RLS: never expose access_token to frontend
-- The existing RLS policy on client_settings already restricts to user_id = auth.uid().
-- Backend uses supabaseAdmin (service role) which bypasses RLS.
-- Frontend SELECT should never include whatsapp_access_token — enforced in app code.

COMMENT ON COLUMN client_settings.whatsapp_phone_number_id IS 'Meta Phone Number ID for this client WhatsApp Business account';
COMMENT ON COLUMN client_settings.whatsapp_waba_id IS 'WhatsApp Business Account ID';
COMMENT ON COLUMN client_settings.whatsapp_access_token IS 'Permanent access token — NEVER expose to frontend';
COMMENT ON COLUMN client_settings.whatsapp_connected IS 'Whether client has a connected WhatsApp account';
