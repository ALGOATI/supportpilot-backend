-- Stripe billing columns on client_settings.
-- Replaces the Wix-specific columns (wix_order_id, wix_plan_id, plan_active,
-- trial_expires_at, has_used_trial) which are no longer written to but are
-- left in place to avoid a destructive drop. Run a follow-up migration to
-- drop them once all old data is archived.

ALTER TABLE client_settings
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'active';

-- Ensure the plan column exists and defaults to 'free' for new rows.
ALTER TABLE client_settings
  ADD COLUMN IF NOT EXISTS plan text DEFAULT 'free';

ALTER TABLE client_settings
  ALTER COLUMN plan SET DEFAULT 'free';

-- Migrate any legacy 'trial' plan values to 'free' so the app only has to
-- reason about the supported set (free / starter / pro). Legacy 'business'
-- rows are preserved for historical/internal accounts.
UPDATE client_settings SET plan = 'free' WHERE plan = 'trial' OR plan IS NULL;

-- Look up users quickly during webhook dispatch.
CREATE UNIQUE INDEX IF NOT EXISTS client_settings_stripe_customer_id_idx
  ON client_settings (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS client_settings_stripe_subscription_id_idx
  ON client_settings (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- RLS: users can read their own billing fields, but only the service role
-- (used by the backend) can write them. Adjust if your existing policies
-- already cover client_settings — this block is defensive/idempotent.
ALTER TABLE client_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_settings_select_own" ON client_settings;
CREATE POLICY "client_settings_select_own" ON client_settings
  FOR SELECT
  USING (auth.uid() = user_id);
