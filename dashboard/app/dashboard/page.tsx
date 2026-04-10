"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import DashboardShell from "./_components/DashboardShell";
import { useDashboardLanguage } from "@/lib/useDashboardLanguage";
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

function resolveUsagePercent(
  usageData: { percent_used?: number | null } | null,
  analyticsData: { usagePercent?: number | null }
): number | null {
  if (usageData?.percent_used !== null && usageData?.percent_used !== undefined) {
    return Number(usageData.percent_used);
  }
  if (analyticsData?.usagePercent !== null && analyticsData?.usagePercent !== undefined) {
    return Number(analyticsData.usagePercent);
  }
  return null;
}

function resolveMonthlyLimit(
  usageData: { limit?: number | null } | null,
  analyticsData: { monthlyConversationLimit?: number | null }
): number | null {
  if (usageData?.limit !== null && usageData?.limit !== undefined) {
    return Number(usageData.limit);
  }
  if (analyticsData?.monthlyConversationLimit !== null && analyticsData?.monthlyConversationLimit !== undefined) {
    return Number(analyticsData.monthlyConversationLimit);
  }
  return null;
}

function resolveUsageWarningLevel(usagePercent: number | null): number | null {
  if (usagePercent === null) return null;
  if (usagePercent >= 100) return 100;
  if (usagePercent >= 95) return 95;
  if (usagePercent >= 80) return 80;
  return null;
}

export default function DashboardPage() {
  const router = useRouter();
  const { tr } = useDashboardLanguage();

  const checklistLabels: Record<keyof ReleaseChecks, string> = {
    business_profile_completed: tr("check_business_profile"),
    opening_hours_configured: tr("check_opening_hours"),
    business_type_selected: tr("check_business_type"),
    whatsapp_connected: tr("check_whatsapp"),
    ai_enabled: tr("check_ai_enabled"),
    plan_selected: tr("check_plan"),
  };
  const backendUrl = useMemo(() => getBackendUrl(), []);
  const [email, setEmail] = useState<string | null>(null);
  const [releaseStatus, setReleaseStatus] = useState<ReleaseStatusResponse | null>(null);
  const [analytics, setAnalytics] = useState({
    aiConversationsToday: 0,
    bookingsToday: 0,
    escalationsToday: 0,
    humanRepliesToday: 0,
    activeConversations: 0,
    plan: "starter",
    usedConversationsThisMonth: 0,
    monthlyConversationLimit: null as number | null,
    usagePercent: null as number | null,
    usageWarningLevel: null as number | null,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        router.push("/login");
        return;
      }
      setEmail(data.user.email ?? null);

      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;
      const token = sessionData.session?.access_token;
      if (!token) return;

      const setupResp = await fetch(`${backendUrl}/api/setup/status`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (cancelled) return;
      if (setupResp.ok) {
        const setupJson = await setupResp.json();
        if (!setupJson?.completed) {
          router.push("/setup");
          return;
        }
      }

      const [analyticsResp, usageResp, releaseResp] = await Promise.all([
        fetch(`${backendUrl}/api/dashboard/analytics`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        fetch(`${backendUrl}/api/usage`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        fetch(`${backendUrl}/api/release-status`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
      ]);
      if (cancelled) return;
      if (releaseResp.ok) {
        const releaseJson = (await releaseResp.json()) as ReleaseStatusResponse;
        setReleaseStatus(releaseJson);
      }
      if (!analyticsResp.ok) return;
      const analyticsData = await analyticsResp.json();
      const usageData = usageResp.ok ? await usageResp.json() : null;
      const usagePercent = resolveUsagePercent(usageData, analyticsData);
      const usageWarningLevel = resolveUsageWarningLevel(usagePercent);
      setAnalytics({
        aiConversationsToday: Number(analyticsData?.aiConversationsToday || 0),
        bookingsToday: Number(analyticsData?.bookingsToday || 0),
        escalationsToday: Number(analyticsData?.escalationsToday || 0),
        humanRepliesToday: Number(analyticsData?.humanRepliesToday || 0),
        activeConversations: Number(analyticsData?.activeConversations || 0),
        plan: String(analyticsData?.plan || "starter"),
        usedConversationsThisMonth: Number(
          usageData?.conversations_used ?? analyticsData?.usedConversationsThisMonth ?? 0
        ),
        monthlyConversationLimit: resolveMonthlyLimit(usageData, analyticsData),
        usagePercent,
        usageWarningLevel,
      });
    })();

    return () => { cancelled = true; };
  }, [backendUrl, router]);

  const usageProgressPercent =
    analytics.monthlyConversationLimit === null
      ? null
      : Math.max(0, Math.min(100, Number(analytics.usagePercent || 0)));

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <DashboardShell
      title={tr("overview")}
      subtitle={`${tr("logged_in_as")}: ${email ?? "..."}`}
    >
      <div style={{ maxWidth: 1000 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={logout}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid rgba(0,0,0,0.12)",
              background: "#f8fafc",
              color: "#111827",
              fontWeight: 600,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {tr("logout")}
          </button>
        </div>
      </div>

      <div
        style={{
          marginTop: 18,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          maxWidth: 1000,
        }}
      >
        <MetricCard label={tr("ai_conversations_today")} value={analytics.aiConversationsToday} />
        <MetricCard label={tr("bookings_today")} value={analytics.bookingsToday} />
        <MetricCard label={tr("escalations_today")} value={analytics.escalationsToday} />
        <MetricCard label={tr("human_replies_today")} value={analytics.humanRepliesToday} />
        <MetricCard label={tr("active_conversations")} value={analytics.activeConversations} />
        <MetricCard label={tr("current_plan")} value={String(analytics.plan || "starter")} />
      </div>
      <div
        style={{
          maxWidth: 1000,
          marginTop: 12,
          borderRadius: 12,
          border: "1px solid rgba(15,23,42,0.08)",
          background: "white",
          padding: "14px 16px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ color: "#0f172a", fontSize: 15 }}>{tr("launch_status")}</strong>
          <span
            style={{
              color: releaseStatus?.ready_to_launch ? "#166534" : "#92400e",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {releaseStatus?.ready_to_launch ? tr("ready_to_launch") : tr("setup_incomplete")}
          </span>
        </div>
        <div style={{ marginTop: 6, color: "#334155", fontWeight: 600, fontSize: 14 }}>
          {releaseStatus
            ? `${releaseStatus.completion.done}/${releaseStatus.completion.total} ${tr("checks_complete")}`
            : "—"}
        </div>
        {releaseStatus && !releaseStatus.ready_to_launch ? (
          <div style={{ marginTop: 8, color: "#475569", fontSize: 13 }}>
            {tr("missing_label")}{" "}
            {releaseStatus.missing_items
              .map((key) => checklistLabels[key] || key)
              .join(", ")}
          </div>
        ) : null}
        <div style={{ marginTop: 8 }}>
          <Link
            href="/dashboard/integrations"
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#1d4ed8",
              textDecoration: "none",
            }}
          >
            {tr("open_release_checklist")}
          </Link>
        </div>
      </div>
      <div
        style={{
          maxWidth: 1000,
          marginTop: 12,
          borderRadius: 12,
          border: "1px solid rgba(15,23,42,0.08)",
          background: "white",
          padding: "14px 16px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ color: "#0f172a", fontSize: 15 }}>{tr("ai_usage")}</strong>
          <span style={{ color: "#334155", fontWeight: 700, fontSize: 13 }}>
            {analytics.monthlyConversationLimit === null
              ? tr("unlimited")
              : `${analytics.usagePercent ?? 0}%`}
          </span>
        </div>
        <div style={{ marginTop: 6, color: "#334155", fontWeight: 600, fontSize: 14 }}>
          {analytics.monthlyConversationLimit === null
            ? `${analytics.usedConversationsThisMonth} / ${tr("unlimited")} ${tr("conversations_used")}`
            : `${analytics.usedConversationsThisMonth} / ${analytics.monthlyConversationLimit} ${tr("conversations_used")}`}
        </div>
        <div style={{ marginTop: 6, color: "#334155", fontSize: 13 }}>
          {tr("plan_label")} {analytics.plan}
        </div>
        <div style={{ marginTop: 6, color: "#334155", fontSize: 13 }}>
          {tr("model_label")} {releaseStatus?.models?.main_reply || tr("not_configured")}
        </div>
        {usageProgressPercent !== null ? (
          <div
            style={{
              marginTop: 10,
              height: 10,
              borderRadius: 999,
              background: "#e2e8f0",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${usageProgressPercent}%`,
                borderRadius: 999,
                background:
                  usageProgressPercent >= 95
                    ? "#dc2626"
                    : usageProgressPercent >= 80
                    ? "#f59e0b"
                    : "#2563eb",
                transition: "width 180ms ease",
              }}
            />
          </div>
        ) : null}
      </div>
      {analytics.usageWarningLevel ? (
        <div
          style={{
            maxWidth: 1000,
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(239,68,68,0.25)",
            background: "rgba(254,242,242,0.9)",
            color: "#991b1b",
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          {analytics.usageWarningLevel >= 100
            ? tr("usage_warning_100")
            : analytics.usageWarningLevel >= 95
            ? tr("usage_warning_95")
            : tr("usage_warning_80")}
          {analytics.usagePercent !== null ? ` (${analytics.usagePercent}%)` : ""}
        </div>
      ) : null}
    </DashboardShell>
  );
}

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(0,0,0,0.12)",
        borderRadius: 12,
        background: "#fff",
        padding: "12px 14px",
      }}
    >
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 28, lineHeight: 1.1, fontWeight: 900, color: "#0f172a" }}>
        {value}
      </div>
    </div>
  );
}
