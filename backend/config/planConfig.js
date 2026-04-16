// ─── PLAN DEFAULTS ────────────────────────────────────────────────────────────
// Single source of truth for per-tier limits and AI model defaults.
// Every other file MUST import from here — never duplicate these numbers.
//
// Keys must match the `plan` column values stored in the `client_settings` table.
// Supported values: 'free', 'starter', 'pro' (plus legacy 'business' for
// historical/internal accounts).
// ─────────────────────────────────────────────────────────────────────────────

export const PLAN_DEFAULTS = {
  free: {
    ai_model: "gpt-4o-mini",
    max_messages: 100,
    max_knowledge: 5,
    max_whatsapp_numbers: 0,
    google_calendar: false,
    features: {
      instagram: false,
      ai_tone_customization: false,
      full_analytics: false,
      monthly_reports: false,
      escalation_insights: false,
      google_calendar: false,
      team_access: false,
      priority_support: false,
      dedicated_onboarding: false,
    },
  },
  starter: {
    ai_model: "gpt-4o-mini",
    max_messages: 1000,
    max_knowledge: 30,
    max_whatsapp_numbers: 1,
    google_calendar: false,
    features: {
      instagram: false,
      ai_tone_customization: false,
      full_analytics: false,
      monthly_reports: false,
      escalation_insights: false,
      google_calendar: false,
      team_access: false,
      priority_support: false,
      dedicated_onboarding: false,
    },
  },
  pro: {
    ai_model: "gpt-4o",
    max_messages: 3000,
    max_knowledge: 75,
    max_whatsapp_numbers: 3,
    google_calendar: true,
    features: {
      instagram: true,
      ai_tone_customization: true,
      full_analytics: true,
      monthly_reports: true,
      escalation_insights: true,
      google_calendar: true,
      team_access: false,
      priority_support: true,
      dedicated_onboarding: false,
    },
  },
  business: {
    ai_model: "gpt-4o",
    max_messages: 10000,
    max_knowledge: -1,
    max_whatsapp_numbers: 5,
    google_calendar: true,
    features: {
      instagram: true,
      ai_tone_customization: true,
      full_analytics: true,
      monthly_reports: true,
      escalation_insights: true,
      google_calendar: true,
      team_access: true,
      priority_support: true,
      dedicated_onboarding: true,
    },
  },
};

/**
 * Returns the plan defaults for a given tier name.
 * Falls back to free if the tier is unknown.
 */
export function getPlanDefaults(tier) {
  return PLAN_DEFAULTS[tier] || PLAN_DEFAULTS.free;
}
