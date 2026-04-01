-- ============================================================
-- Migration: Wix Payment Onboarding — extend businesses table
-- Date: 2026-03-27
-- ============================================================
-- Adds plan config columns (ai_model, limits, trial tracking)
-- to the existing businesses table. Keeps existing columns
-- (email, name, plan) intact for backward compatibility.
--
-- Column mapping vs spec:
--   id           = user_id   (PK already references auth.users)
--   email        = owner_email
--   name         = owner_name
--   plan         = plan_tier
-- ============================================================

-- 1. Add new columns
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS ai_model text,
  ADD COLUMN IF NOT EXISTS max_messages integer,
  ADD COLUMN IF NOT EXISTS max_knowledge integer DEFAULT -1,
  ADD COLUMN IF NOT EXISTS max_whatsapp_numbers integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS messages_used integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plan_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS trial_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS has_used_trial boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS wix_plan_id text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 2. Extend plan check constraint to support new tier names
ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_plan_check;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_plan_check
  CHECK (plan IN ('trial', 'starter', 'standard', 'pro', 'enterprise', 'business'));

-- 3. Indexes
CREATE INDEX IF NOT EXISTS businesses_email_idx
  ON public.businesses (email);

CREATE INDEX IF NOT EXISTS businesses_plan_active_idx
  ON public.businesses (plan_active);

-- Partial index: active trials (for expiry checks)
CREATE INDEX IF NOT EXISTS businesses_trial_active_idx
  ON public.businesses (trial_expires_at)
  WHERE plan = 'trial' AND plan_active = true;

-- 4. Backfill defaults for existing rows
UPDATE public.businesses SET plan_active = true WHERE plan_active IS NULL;
UPDATE public.businesses SET has_used_trial = false WHERE has_used_trial IS NULL;
UPDATE public.businesses SET messages_used = 0 WHERE messages_used IS NULL;

-- 5. Auto-update updated_at on every UPDATE
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_businesses_updated_at ON public.businesses;
CREATE TRIGGER trg_businesses_updated_at
  BEFORE UPDATE ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 6. RLS — users can SELECT and UPDATE their own record
-- (existing policies from billing-chat-foundation cover this,
--  but we recreate them here to be safe)
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "businesses_select_own" ON public.businesses;
CREATE POLICY "businesses_select_own"
  ON public.businesses FOR SELECT TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "businesses_update_own" ON public.businesses;
CREATE POLICY "businesses_update_own"
  ON public.businesses FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Keep insert/delete policies from previous migration
DROP POLICY IF EXISTS "businesses_insert_own" ON public.businesses;
CREATE POLICY "businesses_insert_own"
  ON public.businesses FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "businesses_delete_own" ON public.businesses;
CREATE POLICY "businesses_delete_own"
  ON public.businesses FOR DELETE TO authenticated
  USING (auth.uid() = id);

NOTIFY pgrst, 'reload schema';
