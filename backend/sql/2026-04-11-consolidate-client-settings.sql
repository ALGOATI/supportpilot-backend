-- Consolidate businesses → client_settings
-- The businesses table never existed in Supabase. All code that read/wrote it
-- silently failed. This migration adds the missing columns to client_settings
-- so it can serve as the single source of truth for plan, limits, Wix payment
-- state, and calendar integration data.

-- email lives in auth.users — do not duplicate it here.
ALTER TABLE client_settings
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS ai_model text DEFAULT 'openai/gpt-4o-mini',
  ADD COLUMN IF NOT EXISTS max_messages integer DEFAULT 500,
  ADD COLUMN IF NOT EXISTS max_knowledge integer DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_whatsapp_numbers integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS messages_used integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plan_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS trial_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS wix_order_id text,
  ADD COLUMN IF NOT EXISTS wix_plan_id text,
  ADD COLUMN IF NOT EXISTS plan_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS has_used_trial boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_calendar_tokens jsonb,
  ADD COLUMN IF NOT EXISTS google_calendar_id text,
  ADD COLUMN IF NOT EXISTS calendar_feed_token text,
  ADD COLUMN IF NOT EXISTS timezone text;
