-- Add currency column to client_settings so menu prices can be rendered with
-- the tenant's currency (e.g. "80 SEK") instead of a bare number.
ALTER TABLE client_settings
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'SEK';

UPDATE client_settings SET currency = 'SEK' WHERE currency IS NULL;
