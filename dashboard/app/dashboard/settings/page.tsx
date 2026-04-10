"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import DashboardShell from "../_components/DashboardShell";
import { DashboardLanguage, t } from "@/lib/i18n";
import { usePlanFeatures } from "@/lib/usePlanFeatures";
import UpgradePrompt from "../_components/UpgradePrompt";

type Tone = "professional" | "friendly" | "casual";
type ReplyLength = "concise" | "normal" | "detailed";

export default function AISettingsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const { features } = usePlanFeatures();

  const [tone, setTone] = useState<Tone>("professional");
  const [replyLength, setReplyLength] = useState<ReplyLength>("concise");
  const [dashboardLanguage, setDashboardLanguage] = useState<DashboardLanguage>("english");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;
      const user = userData.user;

      if (!user) {
        router.push("/login");
        return;
      }

      const { data, error } = await supabase
        .from("client_settings")
        .select("tone, reply_length, dashboard_language")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) console.error(error);

      setTone((data?.tone as Tone) ?? "professional");
      setReplyLength((data?.reply_length as ReplyLength) ?? "concise");
      const lang = String((data as { dashboard_language?: string } | null)?.dashboard_language || "")
        .trim()
        .toLowerCase();
      if (lang === "english" || lang === "swedish" || lang === "arabic") {
        setDashboardLanguage(lang);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [router]);

  async function save() {
    setSaving(true);
    setStatus(null);

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      router.push("/login");
      return;
    }

    const payload = {
      user_id: user.id,
      tone,
      reply_length: replyLength,
      dashboard_language: dashboardLanguage,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("client_settings")
      .upsert(payload, { onConflict: "user_id" });

    if (error) {
      console.error(error);
      setStatus(`Save failed: ${error.message}`);
    } else {
      setStatus("Saved!");
    }

    setSaving(false);
  }

  if (loading) {
    return (
      <DashboardShell title={t(dashboardLanguage, "ai_settings")} subtitle={t(dashboardLanguage, "ai_settings_subtitle")}>
        <div style={{ maxWidth: 900 }}>
          <p>{t(dashboardLanguage, "loading")}</p>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title={t(dashboardLanguage, "ai_settings")} subtitle={t(dashboardLanguage, "ai_settings_subtitle")}>
      <div style={{ maxWidth: 900, color: "#111827" }}>
        <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
          {/* AI Style */}
          <div
            style={{
              border: "1px solid rgba(0,0,0,0.12)",
              borderRadius: 14,
              padding: 14,
              background: "white",
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 10, color: "#111827" }}>
              {t(dashboardLanguage, "ai_style")}
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 800 }}>{t(dashboardLanguage, "tone")}</span>
                <select
                  value={features.ai_tone_customization ? tone : "professional"}
                  onChange={(e) => setTone(e.target.value as Tone)}
                  disabled={!features.ai_tone_customization}
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,0.15)",
                    background: features.ai_tone_customization ? "white" : "#f1f5f9",
                    color: features.ai_tone_customization ? "#111827" : "#94a3b8",
                    cursor: features.ai_tone_customization ? "pointer" : "not-allowed",
                  }}
                >
                  <option value="professional">Professional</option>
                  <option value="friendly">Friendly</option>
                  <option value="casual">Casual</option>
                </select>
                {!features.ai_tone_customization && (
                  <UpgradePrompt feature="ai_tone_customization" language={dashboardLanguage} />
                )}
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 800 }}>{t(dashboardLanguage, "reply_length")}</span>
                <select
                  value={replyLength}
                  onChange={(e) => setReplyLength(e.target.value as ReplyLength)}
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,0.15)",
                    background: "white",
                    color: "#111827",
                  }}
                >
                  <option value="concise">Concise</option>
                  <option value="normal">Normal</option>
                  <option value="detailed">Detailed</option>
                </select>
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 800 }}>{t(dashboardLanguage, "dashboard_language")}</span>
                <select
                  value={dashboardLanguage}
                  onChange={(e) => setDashboardLanguage(e.target.value as DashboardLanguage)}
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,0.15)",
                    background: "white",
                    color: "#111827",
                  }}
                >
                  <option value="english">{t(dashboardLanguage, "english")}</option>
                  <option value="swedish">{t(dashboardLanguage, "swedish")}</option>
                  <option value="arabic">{t(dashboardLanguage, "arabic")}</option>
                </select>
              </label>
            </div>

            <p style={{ marginTop: 10, color: "#374151" }}>
              Professional = formal. Friendly = warm. Casual = relaxed.
            </p>
          </div>

          {/* Save */}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              onClick={save}
              disabled={saving}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.15)",
                background: saving ? "#eee" : "white",
                color: "#111827",
                cursor: saving ? "not-allowed" : "pointer",
                fontWeight: 900,
              }}
            >
              {saving ? t(dashboardLanguage, "saving") : t(dashboardLanguage, "save_settings")}
            </button>

            {status && <div style={{ fontWeight: 800, color: "#111827" }}>{status}</div>}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
