# Plan: Consolidate `client_settings` into `businesses`

**Date:** 2026-04-01
**Status:** DRAFT - Review before executing

---

## 1. Column Inventory

### `client_settings` columns

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| user_id | uuid (PK) | — | References auth.users(id) |
| business | text | — | Free-text business description |
| plan | text | 'starter' | CHECK (starter, pro, enterprise) |
| tone | text | — | AI tone: professional, friendly, casual |
| reply_length | text | — | AI reply length: concise, normal, detailed |
| demo_mode | boolean | false | — |
| onboarding_completed | boolean | false | — |
| onboarding_completed_at | timestamptz | null | — |
| dashboard_language | text | 'english' | CHECK (english, swedish, arabic) |
| whatsapp_phone_number_id | text | null | Meta Phone Number ID |
| whatsapp_waba_id | text | null | WhatsApp Business Account ID |
| whatsapp_access_token | text | null | SENSITIVE - never expose to frontend |
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
| created_at | timestamptz | now() | — |
| updated_at | timestamptz | now() | Auto-updated via trigger |

### Overlap Analysis

| Column | client_settings | businesses | Overlap? |
|--------|:-:|:-:|----------|
| user_id / id | PK | PK | **YES** — same user, different column name |
| plan | `plan` | `plan` | **YES — CONFLICT**: cs allows (starter,pro,enterprise), biz allows (trial,starter,standard,pro,enterprise,business) |
| business / name | `business` (description) | `name` (display name) | Partial — different semantics |
| updated_at | yes | yes | Same purpose |
| email | — | yes | businesses only |
| tone | yes | — | client_settings only |
| reply_length | yes | — | client_settings only |
| demo_mode | yes | — | client_settings only |
| onboarding_completed | yes | — | client_settings only |
| onboarding_completed_at | yes | — | client_settings only |
| dashboard_language | yes | — | client_settings only |
| whatsapp_* (4 cols) | yes | — | client_settings only |
| plan_started_at | — | yes | businesses only |
| plan_expires_at | — | yes | businesses only |
| wix_order_id | — | yes | businesses only |
| wix_plan_id | — | yes | businesses only |
| ai_model | — | yes | businesses only |
| max_messages | — | yes | businesses only |
| max_knowledge | — | yes | businesses only |
| max_whatsapp_numbers | — | yes | businesses only |
| messages_used | — | yes | businesses only |
| plan_active | — | yes | businesses only |
| trial_expires_at | — | yes | businesses only |
| has_used_trial | — | yes | businesses only |

**Key conflict:** `plan` exists in BOTH tables. `wixPaymentService.js:280` and `wixWebhookService.js:189` explicitly sync plan from businesses → client_settings as "backward compatibility." If this sync ever fails silently, the two tables will diverge.

---

## 2. Dependency Map

### `client_settings` — 6 files, ~20 queries

| File | Line(s) | Op | Columns |
|------|---------|-----|---------|
| [server.js:485](backend/server.js#L485) | 485 | READ | user_id (existence check for widget) |
| [server.js:580](backend/server.js#L580) | 580 | WRITE | user_id, demo_mode, updated_at |
| [server.js:2993](backend/server.js#L2993) | 2993 | READ | business, plan, tone, reply_length |
| [server.js:3963](backend/server.js#L3963) | 3963 | READ | whatsapp_phone_number_id, whatsapp_access_token, whatsapp_connected |
| [server.js:3984](backend/server.js#L3984) | 3984 | READ | user_id (lookup by whatsapp_phone_number_id) |
| [server.js:4947](backend/server.js#L4947) | 4947 | READ | onboarding_completed |
| [server.js:5009](backend/server.js#L5009) | 5009 | READ | plan |
| [server.js:5301](backend/server.js#L5301) | 5301 | WRITE | user_id, business, plan, tone, reply_length, onboarding_completed, onboarding_completed_at, updated_at |
| [server.js:5331](backend/server.js#L5331) | 5331 | WRITE | user_id, onboarding_completed, onboarding_completed_at, updated_at |
| [server.js:5374](backend/server.js#L5374) | 5374 | WRITE | user_id, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, whatsapp_connected, updated_at |
| [server.js:5406](backend/server.js#L5406) | 5406 | READ | whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_connected |
| [server.js:5430](backend/server.js#L5430) | 5430 | WRITE | whatsapp_* → null, whatsapp_connected → false |
| [wixPaymentService.js:283](backend/services/wix/wixPaymentService.js#L283) | 283 | WRITE | user_id, plan, updated_at (legacy sync) |
| [wixWebhookService.js:189](backend/services/wix/wixWebhookService.js#L189) | 189 | WRITE | user_id, plan, updated_at (legacy sync) |
| [conversationEngine.js:433](backend/messaging/core/conversationEngine.js#L433) | 433 | READ | business, plan, tone, reply_length |
| [settings/page.tsx:86](dashboard/app/dashboard/settings/page.tsx#L86) | 86 | READ | business, tone, reply_length, dashboard_language |
| [settings/page.tsx:245](dashboard/app/dashboard/settings/page.tsx#L245) | 245 | WRITE | user_id, business, tone, reply_length, dashboard_language, updated_at |
| [useDashboardLanguage.ts:16](dashboard/lib/useDashboardLanguage.ts#L16) | 16 | READ | dashboard_language |
| [useDashboardLanguage.ts:41](dashboard/lib/useDashboardLanguage.ts#L41) | 41 | WRITE | user_id, dashboard_language, updated_at |

### `businesses` — 5 files, ~14 queries

| File | Line(s) | Op | Columns |
|------|---------|-----|---------|
| [server.js:434](backend/server.js#L434) | 434 | READ | plan (loadUserPlan) |
| [server.js:452](backend/server.js#L452) | 452 | READ | max_messages (loadBusinessMaxMessages) |
| [server.js:3007](backend/server.js#L3007) | 3007 | READ | ai_model |
| [server.js:6605](backend/server.js#L6605) | 6605 | READ | id, name, plan, max_messages, ai_model |
| [wixPaymentService.js:150](backend/services/wix/wixPaymentService.js#L150) | 150 | READ | id, has_used_trial |
| [wixPaymentService.js:181](backend/services/wix/wixPaymentService.js#L181) | 181 | READ | id (by email) |
| [wixPaymentService.js:236](backend/services/wix/wixPaymentService.js#L236) | 236 | WRITE | full upsert (15 columns) |
| [wixPaymentService.js:315](backend/services/wix/wixPaymentService.js#L315) | 315 | WRITE | plan_active, updated_at (expire trials) |
| [wixPaymentService.js:348](backend/services/wix/wixPaymentService.js#L348) | 348 | READ | id, plan, plan_active, trial_expires_at, max_messages |
| [wixPaymentService.js:370](backend/services/wix/wixPaymentService.js#L370) | 370 | WRITE | plan_active → false |
| [wixWebhookService.js:179](backend/services/wix/wixWebhookService.js#L179) | 179 | READ | id, email, plan (by email) |
| [wixWebhookService.js:256](backend/services/wix/wixWebhookService.js#L256) | 256 | WRITE | plan, max_messages, ai_model, plan_started_at, plan_expires_at, wix_order_id |
| [conversationEngine.js:447](backend/messaging/core/conversationEngine.js#L447) | 447 | READ | ai_model |

### Tables that reference `businesses` via FK

| Table | FK Column | On Delete |
|-------|-----------|-----------|
| usage | business_id | CASCADE |
| api_logs | business_id | CASCADE |
| knowledge_base | business_id | CASCADE |

No tables reference `client_settings` via FK.

---

## 3. Recommended Target Schema — unified `businesses`

```sql
CREATE TABLE public.businesses (
  -- Identity
  id                        uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                     text        UNIQUE,
  name                      text,                           -- display name (from current businesses.name)

  -- Plan & billing
  plan                      text        NOT NULL DEFAULT 'starter',
  plan_started_at           timestamptz,
  plan_expires_at           timestamptz,
  plan_active               boolean     NOT NULL DEFAULT true,
  wix_order_id              text,
  wix_plan_id               text,
  has_used_trial            boolean     NOT NULL DEFAULT false,
  trial_expires_at          timestamptz,

  -- Limits
  ai_model                  text,                           -- per-business override
  max_messages              integer,
  max_knowledge             integer     DEFAULT -1,
  max_whatsapp_numbers      integer     DEFAULT 1,
  messages_used             integer     DEFAULT 0,

  -- AI personality (migrated from client_settings)
  business_description      text,                           -- renamed from client_settings.business
  tone                      text,                           -- professional / friendly / casual
  reply_length              text,                           -- concise / normal / detailed

  -- Onboarding (migrated from client_settings)
  onboarding_completed      boolean     NOT NULL DEFAULT false,
  onboarding_completed_at   timestamptz,

  -- UI preferences (migrated from client_settings)
  dashboard_language        text        NOT NULL DEFAULT 'english',
  demo_mode                 boolean     NOT NULL DEFAULT false,

  -- WhatsApp integration (migrated from client_settings)
  whatsapp_phone_number_id  text,
  whatsapp_waba_id          text,
  whatsapp_access_token     text,                           -- NEVER expose to frontend
  whatsapp_connected        boolean     NOT NULL DEFAULT false,

  -- Timestamps
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz DEFAULT now(),

  -- Constraints
  CONSTRAINT businesses_plan_check
    CHECK (plan IN ('trial','starter','standard','pro','enterprise','business')),
  CONSTRAINT businesses_dashboard_language_check
    CHECK (dashboard_language IN ('english','swedish','arabic'))
);
```

### Column mapping

| Source | Source Column | Target Column | Notes |
|--------|-------------|---------------|-------|
| client_settings | user_id | id | rename |
| client_settings | business | business_description | rename to avoid confusion with table name |
| client_settings | plan | *(dropped)* | use businesses.plan as canonical source |
| client_settings | tone | tone | direct move |
| client_settings | reply_length | reply_length | direct move |
| client_settings | demo_mode | demo_mode | direct move |
| client_settings | onboarding_completed | onboarding_completed | direct move |
| client_settings | onboarding_completed_at | onboarding_completed_at | direct move |
| client_settings | dashboard_language | dashboard_language | direct move |
| client_settings | whatsapp_phone_number_id | whatsapp_phone_number_id | direct move |
| client_settings | whatsapp_waba_id | whatsapp_waba_id | direct move |
| client_settings | whatsapp_access_token | whatsapp_access_token | direct move |
| client_settings | whatsapp_connected | whatsapp_connected | direct move |
| client_settings | updated_at | updated_at | merged (take latest) |
| businesses | *(all columns)* | *(same name)* | stay in place |

---

## 4. Migration Plan

### Phase 1: Add columns to `businesses` (non-breaking)

**SQL migration:**

```sql
-- ============================================================
-- Migration: Consolidate client_settings into businesses
-- Phase 1: Add columns, backfill data
-- ============================================================

-- 1. Add new columns to businesses
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS business_description text,
  ADD COLUMN IF NOT EXISTS tone text,
  ADD COLUMN IF NOT EXISTS reply_length text,
  ADD COLUMN IF NOT EXISTS demo_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dashboard_language text NOT NULL DEFAULT 'english',
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_waba_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_access_token text,
  ADD COLUMN IF NOT EXISTS whatsapp_connected boolean NOT NULL DEFAULT false;

-- 2. Add constraint for dashboard_language
ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_dashboard_language_check
  CHECK (dashboard_language IN ('english', 'swedish', 'arabic'));

-- 3. Add WhatsApp indexes (matching existing client_settings indexes)
CREATE INDEX IF NOT EXISTS idx_businesses_wa_phone_number_id
  ON public.businesses (whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_wa_phone_unique
  ON public.businesses (whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id IS NOT NULL AND whatsapp_connected = true;

-- 4. Backfill data from client_settings → businesses
UPDATE public.businesses b
SET
  business_description = cs.business,
  tone                 = cs.tone,
  reply_length         = cs.reply_length,
  demo_mode            = COALESCE(cs.demo_mode, false),
  onboarding_completed = COALESCE(cs.onboarding_completed, false),
  onboarding_completed_at = cs.onboarding_completed_at,
  dashboard_language   = COALESCE(cs.dashboard_language, 'english'),
  whatsapp_phone_number_id = cs.whatsapp_phone_number_id,
  whatsapp_waba_id     = cs.whatsapp_waba_id,
  whatsapp_access_token = cs.whatsapp_access_token,
  whatsapp_connected   = COALESCE(cs.whatsapp_connected, false)
FROM public.client_settings cs
WHERE b.id = cs.user_id;

-- 5. Insert businesses rows for any client_settings users that don't have a businesses row yet
INSERT INTO public.businesses (
  id, email, name, plan,
  business_description, tone, reply_length,
  demo_mode, onboarding_completed, onboarding_completed_at,
  dashboard_language,
  whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, whatsapp_connected
)
SELECT
  cs.user_id,
  u.email,
  cs.business,
  COALESCE(cs.plan, 'starter'),
  cs.business,
  cs.tone,
  cs.reply_length,
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
);

-- 6. Update RLS policies to cover new sensitive columns
-- whatsapp_access_token is already protected by row-level "own row only" policy
-- No additional RLS changes needed since businesses already has select/insert/update/delete own-row policies
```

### Phase 2: Update all code to read/write from `businesses`

Every query below must be updated. The left column is the current code; change `.from("client_settings")` to `.from("businesses")` and adjust column names.

| # | File | Line | Current Query | Change Required |
|---|------|------|--------------|-----------------|
| 1 | [server.js](backend/server.js) | 485 | `SELECT user_id FROM client_settings WHERE user_id = clientId` | `SELECT id FROM businesses WHERE id = clientId` |
| 2 | [server.js](backend/server.js) | 580 | `UPSERT client_settings (user_id, demo_mode, ...)` | `UPDATE businesses SET demo_mode = ... WHERE id = userId` |
| 3 | [server.js](backend/server.js) | 2993 | `SELECT business, plan, tone, reply_length FROM client_settings` | `SELECT business_description, plan, tone, reply_length FROM businesses` (rename `business` → `business_description` in consuming code) |
| 4 | [server.js](backend/server.js) | 3007 | `SELECT ai_model FROM businesses` | No change needed (already reads businesses) |
| 5 | [server.js](backend/server.js) | 3963 | `SELECT whatsapp_phone_number_id, whatsapp_access_token, whatsapp_connected FROM client_settings` | Change to `FROM businesses`, match on `id` instead of `user_id` |
| 6 | [server.js](backend/server.js) | 3984 | `SELECT user_id FROM client_settings WHERE whatsapp_phone_number_id = ...` | `SELECT id FROM businesses WHERE whatsapp_phone_number_id = ... AND whatsapp_connected = true` |
| 7 | [server.js](backend/server.js) | 4947 | `SELECT onboarding_completed FROM client_settings` | Change to `FROM businesses` |
| 8 | [server.js](backend/server.js) | 5009 | `SELECT plan FROM client_settings` | Change to `FROM businesses` (already duplicated by loadUserPlan at line 434 — consider reusing) |
| 9 | [server.js](backend/server.js) | 5301 | `UPSERT client_settings (business, plan, tone, reply_length, onboarding_*)` | `UPDATE businesses SET business_description=..., tone=..., reply_length=..., onboarding_completed=..., onboarding_completed_at=... WHERE id = userId` |
| 10 | [server.js](backend/server.js) | 5331 | `UPSERT client_settings (onboarding_completed, ...)` | `UPDATE businesses SET onboarding_completed=..., onboarding_completed_at=... WHERE id = userId` |
| 11 | [server.js](backend/server.js) | 5374 | `UPSERT client_settings (whatsapp_*)` | `UPDATE businesses SET whatsapp_*=... WHERE id = userId` |
| 12 | [server.js](backend/server.js) | 5406 | `SELECT whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_connected FROM client_settings` | Change to `FROM businesses` |
| 13 | [server.js](backend/server.js) | 5430 | `UPDATE client_settings SET whatsapp_*=null` | `UPDATE businesses SET whatsapp_*=null WHERE id = userId` |
| 14 | [conversationEngine.js](backend/messaging/core/conversationEngine.js) | 433 | `SELECT business, plan, tone, reply_length FROM client_settings` | Change to `FROM businesses`, rename `business` → `business_description` |
| 15 | [wixPaymentService.js](backend/services/wix/wixPaymentService.js) | 283 | `UPSERT client_settings (plan)` legacy sync | **DELETE entirely** — no longer needed |
| 16 | [wixWebhookService.js](backend/services/wix/wixWebhookService.js) | 189 | `UPSERT client_settings (plan)` legacy sync | **DELETE entirely** — no longer needed |
| 17 | [settings/page.tsx](dashboard/app/dashboard/settings/page.tsx) | 86 | `SELECT business, tone, reply_length, dashboard_language FROM client_settings` | Change to `FROM businesses`, rename `business` → `business_description` |
| 18 | [settings/page.tsx](dashboard/app/dashboard/settings/page.tsx) | 245 | `UPSERT client_settings (business, tone, reply_length, dashboard_language)` | `UPDATE businesses SET business_description=..., tone=..., reply_length=..., dashboard_language=... WHERE id = userId` |
| 19 | [useDashboardLanguage.ts](dashboard/lib/useDashboardLanguage.ts) | 16 | `SELECT dashboard_language FROM client_settings` | Change to `FROM businesses` |
| 20 | [useDashboardLanguage.ts](dashboard/lib/useDashboardLanguage.ts) | 41 | `UPSERT client_settings (dashboard_language)` | `UPDATE businesses SET dashboard_language=... WHERE id = userId` |

**Also:** Remove `server.js:5078` schema compatibility check referencing `client_settings`.

### Phase 3: Remove `client_settings` table

After Phase 2 is deployed and verified:

```sql
-- Drop client_settings table (only after all code is migrated)
DROP TABLE IF EXISTS public.client_settings;
```

**Can `client_settings` be dropped entirely?** YES — once all code changes in Phase 2 are deployed, nothing references it. There are no foreign keys pointing to it.

---

## 5. Risk Assessment

### What could break?

| Risk | Severity | Mitigation |
|------|----------|------------|
| Dashboard reads `client_settings` directly via Supabase client (RLS) — if dashboard is deployed before backend, queries will fail on missing table | **HIGH** | Deploy backend + dashboard together, or keep `client_settings` as a VIEW during transition |
| WhatsApp webhook routing (`server.js:3984`) uses unique index on `whatsapp_phone_number_id` — new index on `businesses` must exist before old one is dropped | **HIGH** | Phase 1 migration creates the new index before any code changes |
| `onboarding_completed` UPSERT currently creates the `client_settings` row if none exists — `businesses` row may not exist for brand-new users who haven't gone through Wix payment | **MEDIUM** | Ensure onboarding endpoint does an UPSERT on `businesses` (insert row with defaults if missing) |
| Column rename: `business` → `business_description` — any code that destructures `data.business` will break | **MEDIUM** | Search all JS/TS for `.business` property access after the query changes; consider aliasing in SELECT: `business_description:business_description` or renaming in the response |
| `plan` constraint mismatch — `client_settings` allows (starter,pro,enterprise), `businesses` allows (trial,starter,standard,pro,enterprise,business) — if onboarding writes `plan` to businesses, it must use a valid value | **LOW** | Onboarding only writes starter/pro/enterprise which are all valid in businesses |

### Incremental or one-shot?

**Recommended: Two-phase incremental approach.**

1. **Phase 1** (migration only): Add columns, backfill data, create indexes. Zero code changes. This is fully reversible — just drop the new columns.
2. **Phase 2** (code changes): Update all queries in a single PR. Deploy backend + dashboard atomically. This is the "big bang" but the schema already supports both old and new queries during the transition window.
3. **Phase 3** (cleanup): Drop `client_settings` after monitoring for 1-2 weeks.

### Foreign keys and RLS

- **FK constraints:** No tables reference `client_settings`. Three tables (`usage`, `api_logs`, `knowledge_base`) reference `businesses.id` with ON DELETE CASCADE — unaffected by this migration.
- **RLS policies:** `businesses` already has `SELECT/INSERT/UPDATE/DELETE own-row` policies (`auth.uid() = id`). The new columns inherit these policies automatically. The `whatsapp_access_token` column is protected by the existing `businesses_select_own` policy (users can only read their own row). However, verify that the dashboard Supabase client does NOT select `whatsapp_access_token` — use explicit `.select(...)` column lists, never `select("*")`.

### Transition period (both tables exist)

During the window between Phase 1 and Phase 3:
- `client_settings` is read-only (no code writes to it after Phase 2)
- `businesses` is the single source of truth
- If a rollback of Phase 2 is needed, `client_settings` still has valid data (it was not modified)
- Consider creating a database VIEW `client_settings` that maps to `businesses` columns as a safety net, though this should not be necessary if deployment is atomic

---

## Summary of work

| Phase | Effort | Files changed |
|-------|--------|---------------|
| Phase 1: SQL migration | 1 migration file | 0 code files |
| Phase 2: Code update | ~20 query changes | 5 files (server.js, conversationEngine.js, wixPaymentService.js, wixWebhookService.js, settings/page.tsx, useDashboardLanguage.ts) |
| Phase 3: Cleanup | 1 migration file | 0 code files |

**Total queries to update:** 20
**Queries to delete:** 2 (legacy sync in wixPaymentService + wixWebhookService)
**New queries:** 0
