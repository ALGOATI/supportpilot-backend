// ─── PLAN DEFAULTS ────────────────────────────────────────────────────────────
// Single source of truth for per-tier limits and AI model defaults.
// Every other file MUST import from here — never duplicate these numbers.
//
// Keys must match the `plan` column values stored in the `businesses` table.
// ─────────────────────────────────────────────────────────────────────────────

export const PLAN_DEFAULTS = {
  trial: {
    ai_model: "gpt-4o-mini",
    max_messages: 500,
    max_knowledge: 10,
    max_whatsapp_numbers: 1,
    trial_days: 30,
    google_calendar: false,
  },
  starter: {
    ai_model: "gpt-4o-mini",
    max_messages: 1000,
    max_knowledge: 30,
    max_whatsapp_numbers: 1,
    google_calendar: false,
  },
  pro: {
    ai_model: "gpt-4o",
    max_messages: 3000,
    max_knowledge: 75,
    max_whatsapp_numbers: 3,
    google_calendar: true,
  },
  business: {
    ai_model: "gpt-4o",
    max_messages: 10000,
    max_knowledge: -1,
    max_whatsapp_numbers: 5,
    google_calendar: true,
  },
};

// Wix plan UUID → tier name
// Keys come from Wix Dashboard → Pricing Plans → plan IDs.
export const WIX_PLAN_IDS = {
  "9f7ad82a-556f-4efe-8313-f92c97e32ced": "trial",
  "52047902-84a6-4770-af0a-0625ecbf4ddb": "starter",
  "0fbd8afc-d50c-436f-81b1-00f01f9ff93b": "pro",
  "30aac473-bbac-4a84-ac05-482a518949a6": "business",
};

/**
 * Returns the plan defaults for a given tier name.
 * Falls back to starter if the tier is unknown.
 */
export function getPlanDefaults(tier) {
  return PLAN_DEFAULTS[tier] || PLAN_DEFAULTS.starter;
}

/**
 * Returns the tier name for a given Wix plan UUID, or null if unknown.
 */
export function getTierFromWixPlanId(wixPlanId) {
  return WIX_PLAN_IDS[wixPlanId] || null;
}
