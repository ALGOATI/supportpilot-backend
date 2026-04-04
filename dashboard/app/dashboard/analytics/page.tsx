"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import DashboardShell from "../_components/DashboardShell";
import { getBackendUrl } from "@/lib/backend-url";
import { useDashboardLanguage } from "@/lib/useDashboardLanguage";

type MonthlyStats = {
  current_month: string;
  previous_month: string;
  ai_conversations_handled: number;
  ai_messages_sent: number;
  human_escalations: number;
  total_inbound_messages: number;
  ai_resolution_rate: number;
  hours_saved: number;
  avg_response_time_ms: number;
  prev_ai_conversations_handled: number;
  prev_ai_messages_sent: number;
  prev_human_escalations: number;
  prev_ai_resolution_rate: number;
  prev_hours_saved: number;
  prev_avg_response_time_ms: number;
};

type DayVolume = { date: string; total: number; ai: number; human: number };
type TopQuestion = { question: string; count: number };
type UsageSummary = {
  plan: string;
  conversations_used: number;
  limit: number | null;
  percent_used: number | null;
  days_until_reset: number;
};

const EMPTY_MONTHLY: MonthlyStats = {
  current_month: "",
  previous_month: "",
  ai_conversations_handled: 0,
  ai_messages_sent: 0,
  human_escalations: 0,
  total_inbound_messages: 0,
  ai_resolution_rate: 0,
  hours_saved: 0,
  avg_response_time_ms: 0,
  prev_ai_conversations_handled: 0,
  prev_ai_messages_sent: 0,
  prev_human_escalations: 0,
  prev_ai_resolution_rate: 0,
  prev_hours_saved: 0,
  prev_avg_response_time_ms: 0,
};

function formatResponseTime(ms: number) {
  if (!ms) return "\u2014";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function AnalyticsPage() {
  const router = useRouter();
  const { tr } = useDashboardLanguage();
  const [loading, setLoading] = useState(true);
  const [monthly, setMonthly] = useState<MonthlyStats>(EMPTY_MONTHLY);
  const [dailyVolume, setDailyVolume] = useState<DayVolume[]>([]);
  const [topQuestions, setTopQuestions] = useState<TopQuestion[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!userData.user) { router.push("/login"); return; }
      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;
      const token = sessionData.session?.access_token;
      if (!token) { router.push("/login"); return; }

      const backendUrl = getBackendUrl();
      const headers = { Authorization: `Bearer ${token}` };

      const [statsRes, volumeRes, questionsRes, usageRes] = await Promise.all([
        fetch(`${backendUrl}/api/analytics/monthly-stats`, { headers }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${backendUrl}/api/analytics/daily-volume`, { headers }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${backendUrl}/api/analytics/top-questions`, { headers }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${backendUrl}/api/analytics/usage-summary`, { headers }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      if (cancelled) return;

      if (statsRes) setMonthly({ ...EMPTY_MONTHLY, ...statsRes });
      if (volumeRes?.days) setDailyVolume(volumeRes.days);
      if (questionsRes?.questions) setTopQuestions(questionsRes.questions);
      if (usageRes) setUsage(usageRes);

      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [router]);

  return (
    <DashboardShell title={tr("analytics")} subtitle={tr("analytics_subtitle")}>
      <div style={{ maxWidth: 1020 }}>
        {loading ? (
          <p style={{ marginTop: 16 }}>{tr("loading")}</p>
        ) : (
          <>
            {/* Top row: 4 key value cards */}
            <div style={topCardGrid}>
              <KeyValueCard
                title={tr("ai_conversations_handled")}
                value={monthly.ai_conversations_handled.toLocaleString()}
                trend={<TrendIndicator current={monthly.ai_conversations_handled} previous={monthly.prev_ai_conversations_handled} tr={tr} />}
              />
              <ResolutionCard
                title={tr("ai_resolution_rate")}
                rate={monthly.ai_resolution_rate}
                prevRate={monthly.prev_ai_resolution_rate}
                tr={tr}
              />
              <KeyValueCard
                title={tr("avg_response_time")}
                value={formatResponseTime(monthly.avg_response_time_ms)}
                trend={monthly.prev_avg_response_time_ms > 0 ? (
                  <TrendIndicator current={monthly.avg_response_time_ms} previous={monthly.prev_avg_response_time_ms} invertTrend tr={tr} />
                ) : <span style={{ color: "#6B7280", fontSize: 12 }}>{tr("no_previous_data")}</span>}
              />
              <KeyValueCard
                title={tr("hours_saved")}
                value={`${monthly.hours_saved} hrs`}
                trend={<TrendIndicator current={monthly.hours_saved} previous={monthly.prev_hours_saved} tr={tr} />}
                accent="#7C3AED"
              />
            </div>

            {/* Daily volume chart */}
            <section style={{ ...panel, marginTop: 18 }}>
              <h2 style={sectionTitle}>{tr("daily_message_volume")}</h2>
              <DailyVolumeChart days={dailyVolume} />
            </section>

            {/* Bottom row: Top questions + Usage */}
            <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
              <section style={panel}>
                <h2 style={sectionTitle}>{tr("top_questions")}</h2>
                {topQuestions.length === 0 ? (
                  <p style={{ color: "#6B7280", fontSize: 14 }}>{tr("no_data")}</p>
                ) : (
                  <ol style={{ margin: 0, paddingLeft: 20 }}>
                    {topQuestions.map((q, i) => (
                      <li key={i} style={{ padding: "6px 0", color: "#111827", fontSize: 14, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                        <span>{q.question}</span>
                        <span style={{ float: "right", color: "#6B7280", fontWeight: 700 }}>({q.count})</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section style={panel}>
                <h2 style={sectionTitle}>{tr("usage_this_month")}</h2>
                {usage ? (
                  <div style={{ display: "grid", gap: 14 }}>
                    <UsageBar used={usage.conversations_used} limit={usage.limit} tr={tr} />
                    <div style={infoRow}>
                      <span style={{ color: "#374151", fontWeight: 700 }}>{tr("plan")}</span>
                      <strong style={{ color: "#111827", textTransform: "capitalize" }}>{usage.plan}</strong>
                    </div>
                    <div style={infoRow}>
                      <span style={{ color: "#374151", fontWeight: 700 }}>{tr("resets_in_days").replace("{days}", String(usage.days_until_reset))}</span>
                    </div>
                  </div>
                ) : (
                  <p style={{ color: "#6B7280", fontSize: 14 }}>{tr("no_data")}</p>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}

/* ─── Sub-components ─── */

function KeyValueCard({ title, value, trend, accent }: Readonly<{
  title: string; value: string; trend: React.ReactNode; accent?: string;
}>) {
  return (
    <div style={{ ...card, borderTop: accent ? `3px solid ${accent}` : undefined }}>
      <div style={{ color: "#374151", fontSize: 13, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color: accent || "#111827", marginTop: 6 }}>{value}</div>
      <div style={{ marginTop: 4 }}>{trend}</div>
    </div>
  );
}

function TrendIndicator({ current, previous, invertTrend, tr }: Readonly<{
  current: number; previous: number; invertTrend?: boolean; tr: (k: string) => string;
}>) {
  if (previous === 0) return <span style={{ color: "#6B7280", fontSize: 12 }}>{tr("no_previous_data")}</span>;
  const diff = current - previous;
  const pct = Math.round((diff / previous) * 100);
  const isPositive = invertTrend ? diff <= 0 : diff >= 0;
  const arrow = diff > 0 ? "\u2191" : diff < 0 ? "\u2193" : "";
  const color = isPositive ? "#059669" : "#DC2626";
  return (
    <span style={{ fontSize: 12, color }}>
      {arrow} {Math.abs(pct)}% {tr("vs_last_month")}
    </span>
  );
}

function ResolutionCard({ title, rate, prevRate, tr }: Readonly<{
  title: string; rate: number; prevRate: number; tr: (k: string) => string;
}>) {
  const color = rate >= 80 ? "#059669" : rate >= 50 ? "#D97706" : "#DC2626";
  const bg = rate >= 80 ? "#ECFDF5" : rate >= 50 ? "#FFFBEB" : "#FEF2F2";
  return (
    <div style={{ ...card, borderLeft: `4px solid ${color}` }}>
      <div style={{ color: "#374151", fontSize: 13, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color, marginTop: 6 }}>{rate}%</div>
      <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          display: "inline-block", padding: "2px 8px", borderRadius: 8,
          background: bg, color, fontSize: 11, fontWeight: 700,
        }}>
          {rate >= 80 ? "Great" : rate >= 50 ? "OK" : "Needs attention"}
        </span>
        <TrendIndicator current={rate} previous={prevRate} tr={tr} />
      </div>
    </div>
  );
}

function DailyVolumeChart({ days }: Readonly<{ days: DayVolume[] }>) {
  if (days.length === 0) return <p style={{ color: "#6B7280", fontSize: 14 }}>No data</p>;

  const maxTotal = Math.max(...days.map(d => d.total), 1);
  const chartHeight = 140;

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: chartHeight, minWidth: days.length * 18 }}>
        {days.map((d) => {
          const aiH = (d.ai / maxTotal) * chartHeight;
          const humanH = (d.human / maxTotal) * chartHeight;
          return (
            <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", minWidth: 14 }} title={`${d.date}: ${d.total} (AI: ${d.ai}, Human: ${d.human})`}>
              <div style={{ width: "80%", background: "#3B82F6", borderRadius: "3px 3px 0 0", height: aiH || 0 }} />
              <div style={{ width: "80%", background: "#93C5FD", height: humanH || 0 }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "#9CA3AF" }}>
        <span>{days[0]?.date.slice(5)}</span>
        <span>{days[Math.floor(days.length / 2)]?.date.slice(5)}</span>
        <span>{days[days.length - 1]?.date.slice(5)}</span>
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: "#6B7280" }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#3B82F6", borderRadius: 2, marginRight: 4 }} />AI</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#93C5FD", borderRadius: 2, marginRight: 4 }} />Human</span>
      </div>
    </div>
  );
}

function UsageBar({ used, limit, tr }: Readonly<{
  used: number; limit: number | null; tr: (k: string) => string;
}>) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const barColor = pct >= 95 ? "#DC2626" : pct >= 80 ? "#D97706" : "#3B82F6";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 14, fontWeight: 700, color: "#111827" }}>
        <span>{used.toLocaleString()} / {limit ? limit.toLocaleString() : tr("unlimited")} {tr("messages_used")}</span>
      </div>
      {limit && (
        <div style={{ height: 10, background: "#F3F4F6", borderRadius: 6, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 6, transition: "width 0.3s" }} />
        </div>
      )}
    </div>
  );
}

/* ─── Styles ─── */

const topCardGrid = {
  marginTop: 16,
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 12,
};

const card = {
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 14,
  background: "white",
  padding: 14,
};

const panel = {
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 14,
  background: "white",
  padding: 14,
};

const sectionTitle = {
  margin: "0 0 12px 0",
  fontSize: 18,
  fontWeight: 900 as const,
  color: "#111827",
};

const infoRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid rgba(0,0,0,0.06)",
};
