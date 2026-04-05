"use client";

import { t, DashboardLanguage } from "@/lib/i18n";

interface UpgradePromptProps {
  feature: string;
  language?: DashboardLanguage;
}

const FEATURE_KEYS: Record<string, string> = {
  full_analytics: "upgrade_full_analytics",
  monthly_reports: "upgrade_monthly_reports",
  escalation_insights: "upgrade_escalation_insights",
  google_calendar: "upgrade_google_calendar",
  ai_tone_customization: "upgrade_ai_tone",
  instagram: "upgrade_instagram",
  team_access: "upgrade_team_access",
};

export default function UpgradePrompt({ feature, language = "english" }: UpgradePromptProps) {
  const tr = (key: string) => t(language, key);
  const labelKey = FEATURE_KEYS[feature] || feature;
  const upgradeToTier = feature === "team_access" || feature === "dedicated_onboarding"
    ? "Business"
    : "Pro";

  return (
    <div
      style={{
        border: "1px solid #bfdbfe",
        borderRadius: 12,
        padding: "16px 20px",
        background: "#eff6ff",
        marginTop: 12,
      }}
    >
      <div style={{ fontWeight: 700, color: "#1e40af", fontSize: 14, marginBottom: 4 }}>
        {tr("upgrade_to")} {upgradeToTier}
      </div>
      <div style={{ color: "#1e3a8a", fontSize: 13 }}>
        {tr(labelKey)} {tr("upgrade_available_on")} {upgradeToTier}+.
      </div>
    </div>
  );
}
