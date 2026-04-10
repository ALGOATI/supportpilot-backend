"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import DashboardShell from "../_components/DashboardShell";
import { useDashboardLanguage } from "@/lib/useDashboardLanguage";
import { t } from "@/lib/i18n";
import { getBackendUrl } from "@/lib/backend-url";

type ReleaseChecks = {
  business_profile_completed: boolean;
  opening_hours_configured: boolean;
  business_type_selected: boolean;
  whatsapp_connected: boolean;
  ai_enabled: boolean;
  plan_selected: boolean;
};

type ReleaseStatusResponse = {
  ready_to_launch: boolean;
  plan: string;
  models?: {
    main_reply?: string | null;
    safety_check?: string | null;
    extraction?: string | null;
  };
  checks: ReleaseChecks;
  missing_items: Array<keyof ReleaseChecks>;
  completion: {
    done: number;
    total: number;
    percent: number;
  };
  public_urls?: {
    backend_base_url?: string;
    whatsapp_webhook_url?: string;
    widget_script_url?: string;
  };
};

const checklistLabels: Record<keyof ReleaseChecks, string> = {
  business_profile_completed: "Business profile completed",
  opening_hours_configured: "Opening hours configured",
  business_type_selected: "Business type selected",
  whatsapp_connected: "WhatsApp connected",
  ai_enabled: "AI enabled",
  plan_selected: "Plan selected",
};

export default function IntegrationsPage() {
  const router = useRouter();
  const backendUrl = useMemo(() => getBackendUrl(), []);
  const { language: dashboardLanguage, tr } = useDashboardLanguage();

  const [loading, setLoading] = useState(true);
  const [releaseStatus, setReleaseStatus] = useState<ReleaseStatusResponse | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  // WhatsApp integration state
  const [waPhoneNumberId, setWaPhoneNumberId] = useState("");
  const [waWabaId, setWaWabaId] = useState("");
  const [waAccessToken, setWaAccessToken] = useState("");
  const [waConnected, setWaConnected] = useState(false);
  const [waSaving, setWaSaving] = useState(false);
  const [waStatus, setWaStatus] = useState<string | null>(null);

  // Calendar integration state
  const [calFeedUrl, setCalFeedUrl] = useState<string | null>(null);
  const [calCopied, setCalCopied] = useState(false);
  const [calGoogleConnected, setCalGoogleConnected] = useState(false);
  const [calGoogleLoading, setCalGoogleLoading] = useState(false);
  const [calPlan, setCalPlan] = useState<string>("starter");

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

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (token) {
        const releaseResp = await fetch(`${backendUrl}/api/release-status`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (releaseResp.ok) {
          const releaseJson = (await releaseResp.json()) as ReleaseStatusResponse;
          setReleaseStatus(releaseJson);
          setReleaseError(null);
          if (releaseJson.plan) setCalPlan(releaseJson.plan);
        } else {
          setReleaseError("Failed to load release readiness.");
        }

        try {
          const waResp = await fetch(`${backendUrl}/api/integrations/whatsapp/status`, {
            cache: "no-store",
            headers: { Authorization: `Bearer ${token}` },
          });
          if (waResp.ok) {
            const waJson = await waResp.json();
            setWaConnected(!!waJson.whatsapp_connected);
            if (waJson.phone_number_id) setWaPhoneNumberId(waJson.phone_number_id);
            if (waJson.waba_id) setWaWabaId(waJson.waba_id);
          }
        } catch {
          // ignore
        }

        try {
          const [feedResp, googleResp] = await Promise.all([
            fetch(`${backendUrl}/api/calendar/feed-url`, {
              cache: "no-store",
              headers: { Authorization: `Bearer ${token}` },
            }),
            fetch(`${backendUrl}/api/calendar/google/status`, {
              cache: "no-store",
              headers: { Authorization: `Bearer ${token}` },
            }),
          ]);
          if (feedResp.ok) {
            const feedJson = await feedResp.json();
            if (feedJson.feed_url) setCalFeedUrl(feedJson.feed_url);
          }
          if (googleResp.ok) {
            const googleJson = await googleResp.json();
            setCalGoogleConnected(!!googleJson.connected);
          }
        } catch {
          // ignore
        }
      }

      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [backendUrl, router]);

  async function connectWhatsApp() {
    setWaSaving(true);
    setWaStatus(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setWaStatus("Not authenticated");
      setWaSaving(false);
      return;
    }

    if (!waPhoneNumberId.trim() || !waWabaId.trim() || !waAccessToken.trim()) {
      setWaStatus("All three fields are required");
      setWaSaving(false);
      return;
    }

    try {
      const resp = await fetch(`${backendUrl}/api/integrations/whatsapp/connect`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phone_number_id: waPhoneNumberId.trim(),
          waba_id: waWabaId.trim(),
          access_token: waAccessToken.trim(),
        }),
      });

      const json = await resp.json();
      if (resp.ok && json.ok) {
        setWaConnected(true);
        setWaAccessToken("");
        setWaStatus("Connected successfully");
      } else {
        setWaStatus(json.error || "Connection failed");
      }
    } catch {
      setWaStatus("Network error");
    }

    setWaSaving(false);
  }

  async function disconnectWhatsApp() {
    setWaSaving(true);
    setWaStatus(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setWaSaving(false);
      return;
    }

    try {
      const resp = await fetch(`${backendUrl}/api/integrations/whatsapp/disconnect`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await resp.json();
      if (resp.ok && json.ok) {
        setWaConnected(false);
        setWaPhoneNumberId("");
        setWaWabaId("");
        setWaAccessToken("");
        setWaStatus("Disconnected");
      } else {
        setWaStatus(json.error || "Disconnect failed");
      }
    } catch {
      setWaStatus("Network error");
    }

    setWaSaving(false);
  }

  async function copyFeedUrl() {
    if (!calFeedUrl) return;
    try {
      await navigator.clipboard.writeText(calFeedUrl);
      setCalCopied(true);
      setTimeout(() => setCalCopied(false), 2000);
    } catch {
      const input = document.createElement("input");
      input.value = calFeedUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCalCopied(true);
      setTimeout(() => setCalCopied(false), 2000);
    }
  }

  async function connectGoogleCalendar() {
    setCalGoogleLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setCalGoogleLoading(false);
      return;
    }

    try {
      const resp = await fetch(`${backendUrl}/api/calendar/google/connect`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await resp.json();
      if (resp.ok && json.auth_url) {
        window.location.href = json.auth_url;
      } else {
        alert(json.error || t(dashboardLanguage, "calendar_google_error"));
        setCalGoogleLoading(false);
      }
    } catch {
      alert(t(dashboardLanguage, "calendar_google_error"));
      setCalGoogleLoading(false);
    }
  }

  async function disconnectGoogleCalendar() {
    setCalGoogleLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setCalGoogleLoading(false);
      return;
    }

    try {
      const resp = await fetch(`${backendUrl}/api/calendar/google/disconnect`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        setCalGoogleConnected(false);
      }
    } catch {
      // ignore
    }
    setCalGoogleLoading(false);
  }

  if (loading) {
    return (
      <DashboardShell title={tr("integrations")} subtitle={tr("integrations_subtitle")}>
        <div style={{ maxWidth: 900 }}>
          <p>{t(dashboardLanguage, "loading")}</p>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title={tr("integrations")} subtitle={tr("integrations_subtitle")}>
      <div style={{ maxWidth: 900, color: "#111827" }}>
        <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
          {/* Release Readiness */}
          <div
            style={{
              border: "1px solid rgba(0,0,0,0.12)",
              borderRadius: 14,
              padding: 14,
              background: "white",
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 8, color: "#111827" }}>
              Release Readiness
            </div>
            <div style={{ color: "#334155", fontWeight: 700, fontSize: 13 }}>
              {releaseStatus
                ? `${releaseStatus.completion.done}/${releaseStatus.completion.total} checks complete`
                : releaseError || "Loading release checklist..."}
            </div>
            {releaseStatus ? (
              <div style={{ marginTop: 6, color: "#475569", fontSize: 12 }}>
                Plan: <strong>{releaseStatus.plan}</strong> · Main model:{" "}
                <code>{releaseStatus.models?.main_reply || "Not configured"}</code>
              </div>
            ) : null}
            <div
              style={{
                marginTop: 8,
                display: "inline-flex",
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 800,
                color: releaseStatus?.ready_to_launch ? "#166534" : "#92400e",
                background: releaseStatus?.ready_to_launch ? "#dcfce7" : "#fef3c7",
              }}
            >
              {releaseStatus?.ready_to_launch ? "Ready to launch" : "Not ready yet"}
            </div>

            {releaseStatus ? (
              <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                {(Object.entries(releaseStatus.checks) as Array<[keyof ReleaseChecks, boolean]>).map(
                  ([key, done]) => (
                    <div
                      key={key}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        border: "1px solid rgba(15,23,42,0.08)",
                        borderRadius: 10,
                        padding: "8px 10px",
                      }}
                    >
                      <span style={{ color: "#0f172a", fontWeight: 600 }}>{checklistLabels[key]}</span>
                      <span
                        style={{
                          color: done ? "#166534" : "#b91c1c",
                          fontWeight: 800,
                          fontSize: 12,
                        }}
                      >
                        {done ? "Complete" : "Needs setup"}
                      </span>
                    </div>
                  )
                )}
              </div>
            ) : null}

            {releaseStatus?.public_urls?.whatsapp_webhook_url ? (
              <div style={{ marginTop: 10, fontSize: 12, color: "#475569" }}>
                WhatsApp webhook URL: <code>{releaseStatus.public_urls.whatsapp_webhook_url}</code>
              </div>
            ) : null}
            {releaseStatus?.public_urls?.widget_script_url ? (
              <div style={{ marginTop: 4, fontSize: 12, color: "#475569" }}>
                Widget script URL: <code>{releaseStatus.public_urls.widget_script_url}</code>
              </div>
            ) : null}
          </div>

          {/* WhatsApp Integration */}
          <div
            style={{
              border: "1px solid rgba(0,0,0,0.12)",
              borderRadius: 14,
              padding: 14,
              background: "white",
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 8, color: "#111827" }}>
              WhatsApp Integration
            </div>

            <div
              style={{
                display: "inline-flex",
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 800,
                color: waConnected ? "#166534" : "#92400e",
                background: waConnected ? "#dcfce7" : "#fef3c7",
                marginBottom: 12,
              }}
            >
              {waConnected ? "Connected" : "Not Connected"}
            </div>

            {waConnected ? (
              <div>
                <div style={{ fontSize: 13, color: "#475569", marginBottom: 4 }}>
                  Phone Number ID: <code>{waPhoneNumberId}</code>
                </div>
                <div style={{ fontSize: 13, color: "#475569", marginBottom: 4 }}>
                  WABA ID: <code>{waWabaId}</code>
                </div>
                <div style={{ fontSize: 13, color: "#475569", marginBottom: 10 }}>
                  Access Token: <code>••••••••</code>
                </div>
                <button
                  onClick={disconnectWhatsApp}
                  disabled={waSaving}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 10,
                    border: "1px solid #ef4444",
                    background: "white",
                    color: "#ef4444",
                    cursor: waSaving ? "not-allowed" : "pointer",
                    fontWeight: 800,
                    fontSize: 13,
                  }}
                >
                  {waSaving ? "Disconnecting..." : "Disconnect WhatsApp"}
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>Phone Number ID</span>
                  <input
                    type="text"
                    value={waPhoneNumberId}
                    onChange={(e) => setWaPhoneNumberId(e.target.value)}
                    placeholder="e.g. 123456789012345"
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid rgba(0,0,0,0.15)",
                      color: "#111827",
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>WhatsApp Business Account ID</span>
                  <input
                    type="text"
                    value={waWabaId}
                    onChange={(e) => setWaWabaId(e.target.value)}
                    placeholder="e.g. 109876543210"
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid rgba(0,0,0,0.15)",
                      color: "#111827",
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>Permanent Access Token</span>
                  <input
                    type="password"
                    value={waAccessToken}
                    onChange={(e) => setWaAccessToken(e.target.value)}
                    placeholder="Paste your token here"
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid rgba(0,0,0,0.15)",
                      color: "#111827",
                    }}
                  />
                </label>
                <button
                  onClick={connectWhatsApp}
                  disabled={waSaving}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.15)",
                    background: waSaving ? "#eee" : "#111827",
                    color: waSaving ? "#999" : "white",
                    cursor: waSaving ? "not-allowed" : "pointer",
                    fontWeight: 900,
                  }}
                >
                  {waSaving ? "Connecting..." : "Connect WhatsApp"}
                </button>
              </div>
            )}

            {waStatus && (
              <div style={{ marginTop: 8, fontWeight: 700, fontSize: 13, color: "#111827" }}>
                {waStatus}
              </div>
            )}
          </div>

          {/* Calendar Integration */}
          <div
            style={{
              border: "1px solid rgba(0,0,0,0.12)",
              borderRadius: 14,
              padding: 14,
              background: "white",
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 8, color: "#111827" }}>
              {t(dashboardLanguage, "calendar_integration")}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#334155", marginBottom: 6 }}>
                {t(dashboardLanguage, "calendar_feed_url")}
              </div>
              <p style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
                {t(dashboardLanguage, "calendar_feed_description")}
              </p>

              {calFeedUrl ? (
                <>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <input
                      type="text"
                      readOnly
                      value={calFeedUrl}
                      style={{
                        flex: 1,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid rgba(0,0,0,0.15)",
                        fontSize: 12,
                        color: "#475569",
                        background: "#f8fafc",
                      }}
                    />
                    <button
                      onClick={copyFeedUrl}
                      style={{
                        padding: "8px 14px",
                        borderRadius: 8,
                        border: "1px solid rgba(0,0,0,0.15)",
                        background: calCopied ? "#dcfce7" : "white",
                        color: calCopied ? "#166534" : "#111827",
                        cursor: "pointer",
                        fontWeight: 800,
                        fontSize: 12,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {calCopied
                        ? t(dashboardLanguage, "calendar_copied")
                        : t(dashboardLanguage, "calendar_copy_url")}
                    </button>
                  </div>

                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      {t(dashboardLanguage, "calendar_how_to_add")}:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 2 }}>
                      <li>{t(dashboardLanguage, "calendar_google_instructions")}</li>
                      <li>{t(dashboardLanguage, "calendar_apple_instructions")}</li>
                      <li>{t(dashboardLanguage, "calendar_outlook_instructions")}</li>
                    </ul>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  {t(dashboardLanguage, "calendar_loading")}
                </div>
              )}
            </div>

            <div
              style={{
                borderTop: "1px solid rgba(0,0,0,0.08)",
                paddingTop: 14,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, color: "#334155", marginBottom: 8 }}>
                {t(dashboardLanguage, "calendar_google_sync")}
              </div>

              {calPlan === "pro" || calPlan === "business" || calPlan === "enterprise" ? (
                <>
                  <div
                    style={{
                      display: "inline-flex",
                      padding: "4px 10px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 800,
                      color: calGoogleConnected ? "#166534" : "#92400e",
                      background: calGoogleConnected ? "#dcfce7" : "#fef3c7",
                      marginBottom: 10,
                    }}
                  >
                    {calGoogleConnected
                      ? t(dashboardLanguage, "calendar_google_connected")
                      : t(dashboardLanguage, "calendar_google_not_connected")}
                  </div>

                  <div>
                    {calGoogleConnected ? (
                      <button
                        onClick={disconnectGoogleCalendar}
                        disabled={calGoogleLoading}
                        style={{
                          padding: "8px 14px",
                          borderRadius: 10,
                          border: "1px solid #ef4444",
                          background: "white",
                          color: "#ef4444",
                          cursor: calGoogleLoading ? "not-allowed" : "pointer",
                          fontWeight: 800,
                          fontSize: 13,
                        }}
                      >
                        {calGoogleLoading
                          ? t(dashboardLanguage, "calendar_disconnecting")
                          : t(dashboardLanguage, "calendar_disconnect_google")}
                      </button>
                    ) : (
                      <button
                        onClick={connectGoogleCalendar}
                        disabled={calGoogleLoading}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 12,
                          border: "1px solid rgba(0,0,0,0.15)",
                          background: calGoogleLoading ? "#eee" : "#111827",
                          color: calGoogleLoading ? "#999" : "white",
                          cursor: calGoogleLoading ? "not-allowed" : "pointer",
                          fontWeight: 900,
                          fontSize: 13,
                        }}
                      >
                        {calGoogleLoading
                          ? t(dashboardLanguage, "calendar_connecting")
                          : t(dashboardLanguage, "calendar_connect_google")}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: "#f8fafc",
                    border: "1px solid rgba(0,0,0,0.08)",
                    fontSize: 13,
                    color: "#64748b",
                    fontWeight: 600,
                  }}
                >
                  {t(dashboardLanguage, "calendar_upgrade_notice")}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
