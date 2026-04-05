# Plan: Consolidate `client_settings` into `businesses`

**Date:** 2026-04-05
**Status:** DRAFT — Review before executing

---

## 1. Column Inventory

### `client_settings` columns

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| user_id | uuid (PK) | — | References auth.users(id) |
| business | text | — | Free-text business description for AI context |
| plan | text | 'starter' | CHECK (starter, pro, enterprise) |
| tone | text | — | AI tone: professional, friendly, casual |
| reply_length | text | — | AI reply length: concise, normal, detailed |
| demo_mode | boolean | false | — |
| onboarding_completed | boolean | false | — |
| onboarding_completed_at | timestamptz | null | — |
| dashboard_language | text | 'english' | CHECK (english, swedish, arabic) |
| whatsapp_phone_number_id | text | null | Meta Phone Number ID |
| whatsapp_waba_id | text | null | WhatsApp Business Account ID |
| whatsapp_access_token | text | null | SENSITIVE — never expose to frontend |
| whatsapp_connected | boolean | false | — |
| updated_at | timestamptz | — | — |

### `businesses` columns

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | uuid (PK) | — | References auth.users(id) ON DELETE CASCADE |
| email | text (UNIQUE) | — | — |
| name | text | — | Business display name |
| plan | text | 'starter' | CHECK (trial, starter, standard, pro, enterprise, business) |
| plan_started_at | timestamptz | null | — |
| plan_expires_at | timestamptz | null | — |
| wix_order_id | text | null | — |
| wix_plan_id | text | null | — |
| ai_model | text | null | e.g. gpt-4o-mini, gpt-4o |
| max_messages | integer | null | Per-month message cap |
| max_knowledge | integer | -1 | Knowledge base item limit |
| max_whatsapp_numbers | integer | 1 | — |
| messages_used | integer | 0 | Current month message count |
| plan_active | boolean | true | — |
| trial_expires_at | timestamptz | null | — |
| has_used_trial | boolean | false | — |
| google_calendar_tokens | jsonb | null | OAuth tokens for Google Calendar |
| google_calendar_id | text | 'primary' | Target Google Calendar |
| calendar_feed_token | text | null | ICS subscription feed token |
| timezone | text | 'Europe/Stockholm' | Business timezone |
| created_at | timestamptz | now() | — |
| updated_at | timestamptz | now() | Auto-updated via trigger |

### Overlap Analysis

| Column | client_settings | businesses | Overlap? |
|--------|:-:|:-:|----------|
| user_id / id | PK | PK | **YES** — same user UUID, different column name |
| plan | `plan` | `plan` | **YES — CONFLICT**: cs allows (starter,pro,enterprise), biz allows (trial,starter,standard,pro,enterprise,business). Two Wix services explicitly sync plan from businesses → client_settings as "backward compat." If sync fails, tables diverge. |
| business / name | `business` (AI description) | `name` (display name) | Partial — different semantics, NOT the same field |
| updated_at | yes | yes | Same purpose |
| All other cs cols | yes | — | client_settings only |
| All other biz cols | — | yes | businesses only |

**Key conflict:** `plan` exists in BOTH tables. `wixPaymentService.js:283` and `wixWebhookService.js:263` explicitly sync plan from businesses → client_settings. This is the primary reason for consolidation.

---

## 2. Dependency Map

### `client_settings` — 5 files, ~18 queries

| File | Line | Op | Columns | Purpose |
|------|------|----|---------|---------|
| server.js | 489-493 | READ | user_id | Widget client existence check |
| server.js | 584-593 | WRITE | user_id, demo_mode, updated_at | Set demo mode flag |
| server.js | 2997-3001 | READ | business, plan, tone, reply_length | Load AI context settings |
| server.js | 3965-3969 | READ | whatsapp_phone_number_id, whatsapp_access_token, whatsapp_connected | Get WhatsApp config for sending |
| server.js | 3986-3991 | READ | user_id (lookup by whatsapp_phone_number_id) | Route inbound WhatsApp to correct client |
| server.js | 4952-4956 | READ | onboarding_completed | Check onboarding status |
| server.js | 5014-5018 | READ | plan | Get plan for release status |
| server.js | 5306-5308 | WRITE | user_id, onboarding_completed, onboarding_completed_at, updated_at | Complete onboarding |
| server.js | 5336-5338 | WRITE | user_id, onboarding_completed, onboarding_completed_at, updated_at | Skip onboarding |
| server.js | 5483-5495 | WRITE | user_id, whatsapp_*, updated_at | Connect WhatsApp |
| server.js | 5515-5519 | READ | whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_connected | WhatsApp status endpoint |
| server.js | 5539-5548 | WRITE | whatsapp_* → null, whatsapp_connected → false | Disconnect WhatsApp |
| conversationEngine.js | 439-443 | READ | business, plan, tone, reply_length | Load AI context for message generation |
| wixPaymentService.js | 281-287 | WRITE | user_id, plan, updated_at | Legacy sync after Wix payment |
| wixWebhookService.js | 187-199 | WRITE | user_id, plan, updated_at | Legacy sync after Wix webhook |
| useDashboardLanguage.ts | 15-19 | READ | dashboard_language | Load dashboard language |
| useDashboardLanguage.ts | 41-48 | WRITE | user_id, dashboard_language, updated_at | Save dashboard language |

### `businesses` — 5 files, ~16 queries

| File | Line | Op | Columns | Purpose |
|------|------|----|---------|---------|
| server.js | 438-442 | READ | plan | loadUserPlan() |
| server.js | 456-460 | READ | max_messages | loadBusinessMaxMessages() |
| server.js | 3011-3015 | READ | ai_model | Load AI model for context |
| server.js | 5446-5449 | READ | google_calendar_tokens, google_calendar_id | Google Calendar status |
| server.js | 6990-6994 | READ | id, name, plan, max_messages, ai_model | Business details for chat endpoint |
| conversationEngine.js | 453-457 | READ | ai_model | Load AI model for message generation |
| wixPaymentService.js | 149-153 | READ | id, has_used_trial | Trial guard check |
| wixPaymentService.js | 181-184 | READ | id | Find existing user by email |
| wixPaymentService.js | 235-239 | WRITE | Full upsert (15 columns) | Create/update business from Wix payment |
| wixPaymentService.js | 315-323 | WRITE | plan_active, updated_at | Deactivate expired trials |
| wixPaymentService.js | 348-351 | READ | id, plan, plan_active, trial_expires_at, max_messages | Check business activity |
| wixPaymentService.js | 370-372 | WRITE | plan_active → false | Auto-deactivate expired trial |
| wixWebhookService.js | 179-182 | READ | id, email, plan | Find business by email |
| wixWebhookService.js | 255-260 | WRITE | plan, max_messages, ai_model, plan_started_at, plan_expires_at, wix_order_id | Process webhook event |
| calendarService.js | 15-26 | READ/WRITE | calendar_feed_token | Get/create ICS feed token |
| calendarService.js | 33-37 | READ | id, name, calendar_feed_token | Generate ICS feed |
| calendarService.js | 140-157 | WRITE | google_calendar_tokens, google_calendar_id | Connect/disconnect Google Calendar |
| calendarService.js | 173-175 | WRITE | google_calendar_tokens | Auto-refresh OAuth tokens |
| calendarService.js | 251-254 | READ | id, name, timezone, google_calendar_tokens, google_calendar_id | Sync booking to calendar |

### Tables that reference `businesses` via FK

| Table | FK Column | On Delete |
|-------|-----------|-----------|
| usage | business_id | CASCADE |
| api_logs | business_id | CASCADE |
| knowledge_base | business_id | CASCADE |

No tables reference `client_settings` via FK. Safe to drop.

---

## 3. Recommended Target Schema — Unified `businesses`

### New columns to add to `businesses`

```sql
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS business_description text,
  ADD COLUMN IF NOT EXISTS tone text DEFAULT 'professional',
  ADD COLUMN IF NOT EXISTS reply_length text DEFAULT 'concise',
  ADD COLUMN IF NOT EXISTS demo_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_waba_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_access_token text,
  ADD COLUMN IF NOT EXISTS whatsapp_connected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dashboard_language text NOT NULL DEFAULT 'english';
```

### Column mapping from client_settings → businesses

| client_settings column | businesses column | Notes |
|----------------------|------------------|-------|
| `user_id` | `id` | Rename (same UUID) |
| `business` | `business_description` | Rename to avoid confusion with table name |
| `plan` | *(dropped)* | `businesses.plan` is the canonical source |
| `tone` | `tone` | Direct move |
| `reply_length` | `reply_length` | Direct move |
| `demo_mode` | `demo_mode` | Direct move |
| `onboarding_completed` | `onboarding_completed` | Direct move |
| `onboarding_completed_at` | `onboarding_completed_at` | Direct move |
| `dashboard_language` | `dashboard_language` | Direct move |
| `whatsapp_phone_number_id` | `whatsapp_phone_number_id` | Direct move |
| `whatsapp_waba_id` | `whatsapp_waba_id` | Direct move |
| `whatsapp_access_token` | `whatsapp_access_token` | Direct move |
| `whatsapp_connected` | `whatsapp_connected` | Direct move |
| `updated_at` | `updated_at` | Already exists |

---

## 4. Migration Plan

### Phase 1: SQL migration — add columns, backfill data (no code changes)

```sql
-- ============================================================
-- Migration: Consolidate client_settings into businesses
-- Phase 1: Add columns, backfill data
-- Date: 2026-04-XX
-- ============================================================

-- 1. Add new columns to businesses
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS business_description text,
  ADD COLUMN IF NOT EXISTS tone text DEFAULT 'professional',
  ADD COLUMN IF NOT EXISTS reply_length text DEFAULT 'concise',
  ADD COLUMN IF NOT EXISTS demo_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dashboard_language text NOT NULL DEFAULT 'english',
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_waba_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_access_token text,
  ADD COLUMN IF NOT EXISTS whatsapp_connected boolean NOT NULL DEFAULT false;

-- 2. Backfill from client_settings
UPDATE public.businesses b
SET
  business_description     = cs.business,
  tone                     = COALESCE(cs.tone, 'professional'),
  reply_length             = COALESCE(cs.reply_length, 'concise'),
  demo_mode                = COALESCE(cs.demo_mode, false),
  onboarding_completed     = COALESCE(cs.onboarding_completed, false),
  onboarding_completed_at  = cs.onboarding_completed_at,
  dashboard_language       = COALESCE(cs.dashboard_language, 'english'),
  whatsapp_phone_number_id = cs.whatsapp_phone_number_id,
  whatsapp_waba_id         = cs.whatsapp_waba_id,
  whatsapp_access_token    = cs.whatsapp_access_token,
  whatsapp_connected       = COALESCE(cs.whatsapp_connected, false)
FROM public.client_settings cs
WHERE b.id = cs.user_id;

-- 3. Handle orphaned client_settings rows (users with no businesses row)
INSERT INTO public.businesses (
  id, email, name, plan,
  business_description, tone, reply_length,
  demo_mode, onboarding_completed, onboarding_completed_at,
  dashboard_language,
  whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, whatsapp_connected
)
SELECT
  cs.user_id,
  LOWER(u.email),
  COALESCE(
    NULLIF(TRIM(u.raw_user_meta_data ->> 'name'), ''),
    SPLIT_PART(LOWER(u.email), '@', 1)
  ),
  COALESCE(NULLIF(TRIM(LOWER(cs.plan)), ''), 'starter'),
  cs.business,
  COALESCE(cs.tone, 'professional'),
  COALESCE(cs.reply_length, 'concise'),
  COALESCE(cs.demo_mode, false),
  COALESCE(cs.onboarding_completed, false),
  cs.onboarding_completed_at,
  COALESCE(cs.dashboard_language, 'english'),
  cs.whatsapp_phone_number_id,
  cs.whatsapp_waba_id,
  cs.whatsapp_access_token,
  COALESCE(cs.whatsapp_connected, false)
FROM public.client_settings cs
JOIN auth.users u ON u.id = cs.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.businesses b WHERE b.id = cs.user_id
)
ON CONFLICT (id) DO NOTHING;

-- 4. WhatsApp indexes on businesses (matching existing client_settings indexes)
CREATE INDEX IF NOT EXISTS idx_businesses_wa_phone_number_id
  ON public.businesses (whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_wa_phone_unique
  ON public.businesses (whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id IS NOT NULL AND whatsapp_connected = true;

-- 5. Dashboard language constraint
ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_dashboard_language_check;
ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_dashboard_language_check
  CHECK (dashboard_language IN ('english', 'swedish', 'arabic'));

NOTIFY pgrst, 'reload schema';
```

### Phase 2: Update all code (single PR, deploy backend + dashboard together)

#### Queries to change (20 total):

| # | File | Line | Change |
|---|------|------|--------|
| 1 | server.js | 489-493 | `from("client_settings").select("user_id").eq("user_id", ...)` → `from("businesses").select("id").eq("id", ...)` |
| 2 | server.js | 584-593 | `from("client_settings").upsert({user_id, demo_mode})` → `from("businesses").update({demo_mode}).eq("id", userId)` |
| 3 | server.js | 2997-3001 | `from("client_settings").select("business, plan, tone, reply_length")` → `from("businesses").select("business_description, plan, tone, reply_length")` + rename `settings.business` → `settings.business_description` in consuming code |
| 4 | server.js | 3011-3015 | **Merge** this separate `from("businesses").select("ai_model")` query into query #3 above: `select("business_description, plan, tone, reply_length, ai_model")` — eliminates a DB round-trip |
| 5 | server.js | 3965-3969 | `from("client_settings")` → `from("businesses")`, `.eq("user_id", ...)` → `.eq("id", ...)` |
| 6 | server.js | 3986-3991 | `from("client_settings").select("user_id")` → `from("businesses").select("id")`, return `data.id` instead of `data.user_id` |
| 7 | server.js | 4952-4956 | `from("client_settings")` → `from("businesses")`, `.eq("user_id", ...)` → `.eq("id", ...)` |
| 8 | server.js | 5014-5018 | `from("client_settings").select("plan")` → `from("businesses").select("plan")` (consider reusing `loadUserPlan()` instead) |
| 9 | server.js | 5306-5308 | `from("client_settings").upsert(...)` → `from("businesses").update({onboarding_completed, onboarding_completed_at}).eq("id", userId)` |
| 10 | server.js | 5336-5338 | Same as #9 (skip onboarding) |
| 11 | server.js | 5483-5495 | `from("client_settings").upsert({whatsapp_*})` → `from("businesses").update({whatsapp_*}).eq("id", req.user.id)` |
| 12 | server.js | 5515-5519 | `from("client_settings")` → `from("businesses")`, `.eq("user_id", ...)` → `.eq("id", ...)` |
| 13 | server.js | 5539-5548 | `from("client_settings").update(...)` → `from("businesses").update(...).eq("id", req.user.id)` |
| 14 | conversationEngine.js | 439-443 | `from("client_settings").select("business, plan, tone, reply_length")` → `from("businesses").select("business_description, plan, tone, reply_length, ai_model")` |
| 15 | conversationEngine.js | 453-457 | **Delete** this separate `from("businesses").select("ai_model")` query — merged into #14 |
| 16 | wixPaymentService.js | 281-287 | **Delete** the entire `syncLegacyPlan` try/catch block (syncs plan to client_settings) |
| 17 | wixWebhookService.js | 187-199 | **Delete** the `syncLegacyPlan` function |
| 18 | wixWebhookService.js | 263 | **Delete** the `await syncLegacyPlan(...)` call |
| 19 | useDashboardLanguage.ts | 15-19 | `from("client_settings").select("dashboard_language").eq("user_id", ...)` → `from("businesses").select("dashboard_language").eq("id", ...)` |
| 20 | useDashboardLanguage.ts | 41-48 | `from("client_settings").upsert({user_id, dashboard_language})` → `from("businesses").update({dashboard_language}).eq("id", userId)` |

#### Important code-level notes:
- **`business` → `business_description` rename**: Every place that reads `settings?.business` or `data?.business` from the old query must change to `settings?.business_description`. Affected: server.js (~line 3007), conversationEngine.js (~line 449).
- **`user_id` → `id` rename**: Every `.eq("user_id", ...)` becomes `.eq("id", ...)`. Every `data.user_id` becomes `data.id`.
- **`upsert` → `update`**: Since `businesses` rows are created by Wix payment webhook, onboarding/WhatsApp/settings endpoints can use `update` instead of `upsert`. However, if a user somehow reaches onboarding without a Wix payment (edge case), the `update` will silently do nothing. Consider keeping `upsert` with `onConflict: "id"` for safety.
- **Query merge bonus**: In `conversationEngine.js`, the two separate queries (client_settings + businesses) become one query, eliminating a DB round-trip on every AI reply.

### Phase 3: Drop client_settings (1-2 weeks after Phase 2)

```sql
-- Safety check first:
-- SELECT COUNT(*) FROM client_settings cs
-- WHERE NOT EXISTS (SELECT 1 FROM businesses b WHERE b.id = cs.user_id);
-- Should return 0

DROP TABLE IF EXISTS public.client_settings;
NOTIFY pgrst, 'reload schema';
```

**Can `client_settings` be dropped entirely?** YES. No foreign keys reference it. After Phase 2, no code reads or writes it.

---

## 5. Risk Assessment

### What could break?

| Risk | Severity | Mitigation |
|------|----------|------------|
| Dashboard reads `client_settings` via Supabase client RLS. If backend is deployed before dashboard update, dashboard breaks. | **HIGH** | Deploy dashboard and backend together in Phase 2. Or deploy dashboard first (it only reads). |
| WhatsApp unique index on `whatsapp_phone_number_id` — routing breaks if new index on `businesses` doesn't exist when code switches | **HIGH** | Phase 1 creates the index before any code changes |
| `upsert` → `update` for onboarding: if `businesses` row doesn't exist for a user (no Wix payment yet), `update` silently does nothing | **MEDIUM** | Use `upsert` with `onConflict: "id"` for onboarding and WhatsApp connect endpoints, or ensure business row always exists |
| Column rename `business` → `business_description` — any code destructuring `data.business` breaks | **MEDIUM** | Grep all JS/TS for `.business` after the query changes; the rename is deliberate to avoid confusion |
| During Phase 1-to-Phase 2 gap, new writes to `client_settings` (WhatsApp connects, onboarding, language changes) won't sync to `businesses` | **LOW** | Keep the gap short (same deploy session). Alternatively, add a temporary DB trigger to sync. |

### Incremental or one-shot?

**Recommended: Three-phase incremental.**

1. **Phase 1** (SQL only): Add columns, backfill. Zero code changes. Fully reversible — just drop new columns.
2. **Phase 2** (code changes): Single PR updating all queries. Deploy backend + dashboard atomically.
3. **Phase 3** (cleanup, 1-2 weeks later): Drop `client_settings` table after confirming no issues.

### RLS policies

- `businesses` already has full CRUD RLS: `auth.uid() = id` for SELECT/INSERT/UPDATE/DELETE
- New columns inherit these policies automatically
- `whatsapp_access_token` is protected by row-level policy (users read only their own row) — but app code must NEVER include it in frontend `.select()` calls (enforced in code today, no change needed)

### Foreign key constraints

- `businesses.id` references `auth.users(id) ON DELETE CASCADE` — set
- `usage`, `api_logs`, `knowledge_base` reference `businesses(id)` — unaffected
- `client_settings` has NO inbound FKs — safe to drop

---

## Summary

| Metric | Count |
|--------|-------|
| Columns to move from client_settings | 13 |
| Queries to update | 18 |
| Queries to delete (legacy sync) | 2 |
| Files to modify | 5 (server.js, conversationEngine.js, wixPaymentService.js, wixWebhookService.js, useDashboardLanguage.ts) |
| Dashboard files to modify | 1 (useDashboardLanguage.ts — check if settings/page.tsx also reads client_settings directly) |
| DB round-trips eliminated | 1 (conversationEngine.js merges 2 queries into 1) |
| Critical data conflict resolved | 1 (dual `plan` column) |
