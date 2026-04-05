"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import DashboardShell from "../_components/DashboardShell";
import { getBackendUrl } from "@/lib/backend-url";
import { useDashboardLanguage } from "@/lib/useDashboardLanguage";
import { usePlanFeatures } from "@/lib/usePlanFeatures";
import UpgradePrompt from "../_components/UpgradePrompt";

type TopQuestion = { question: string; count: number };
type EscalationReason = { reason: string; count: number };
type Recommendation = { type: string; message: string };
type Comparisons = {
  conversations_change: number;
  conversations_change_pct: number | null;
  resolution_rate_change: number;
  hours_saved_change: number;
  escalations_change: number;
};

type MonthlyReport = {
  month: string;
  previous_month: string;
  has_previous_data: boolean;
  ai_conversations_handled: number;
  ai_messages_sent: number;
  human_escalations: number;
  ai_resolution_rate: number;
  hours_saved: number;
  avg_response_time_ms: number;
  comparisons: Comparisons | null;
  top_questions: TopQuestion[];
  escalation_reasons: EscalationReason[];
  escalation_rate: number;
  recommendations: Recommendation[];
};

function getMonthOptions(): { value: string; label: string }[] {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getUTCFullYear(), now.getUTCMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { year: "numeric", month: "long" });
    options.push({ value: key, label });
  }
  return options;
}

function formatResponseTime(ms: number) {
  if (!ms) return "\u2014";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function ReportsPage() {
  const router = useRouter();
  const { tr, language } = useDashboardLanguage();
  const { features, loading: planLoading } = usePlanFeatures();
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const [token, setToken] = useState<string | null>(null);

  const monthOptions = getMonthOptions();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!userData.user) { router.push("/login"); return; }
      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;
      const t = sessionData.session?.access_token;
      if (!t) { router.push("/login"); return; }
      setToken(t);
    })();

    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const backendUrl = getBackendUrl();
      const res = await fetch(`${backendUrl}/api/analytics/monthly-report?month=${selectedMonth}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (cancelled) return;
      if (res.ok) {
        setReport(await res.json());
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [token, selectedMonth]);

  const monthLabel = monthOptions.find(o => o.value === selectedMonth)?.label || selectedMonth;

  if (!planLoading && !features.monthly_reports) {
    return (
      <DashboardShell title={tr("reports")} subtitle={tr("reports_subtitle")}>
        <div style={{ maxWidth: 780, marginTop: 16 }}>
          <UpgradePrompt feature="monthly_reports" language={language} />
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title={tr("reports")} subtitle={tr("reports_subtitle")}>
      <div style={{ maxWidth: 780 }}>
        {/* Month selector */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: 14, fontWeight: 700, color: "#374151", marginRight: 10 }}>{tr("select_month")}</label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #D1D5DB", fontSize: 14, background: "white" }}
          >
            {monthOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <p>{tr("loading")}</p>
        ) : !report ? (
          <p style={{ color: "#6B7280" }}>{tr("no_data")}</p>
        ) : (
          <div style={reportContainer}>
            {/* Report Header */}
            <div style={reportHeader}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#111827" }}>
                SupportPilot {tr("monthly_report")}
              </h1>
              <p style={{ margin: "4px 0 0", fontSize: 16, color: "#374151" }}>{monthLabel}</p>
            </div>

            {/* Overview Section */}
            <ReportSection title={tr("overview_section")}>
              <BulletList items={[
                tr("ai_handled_conversations").replace("{count}", String(report.ai_conversations_handled)),
                tr("resolved_without_human").replace("{rate}", String(report.ai_resolution_rate)),
                tr("estimated_hours_saved").replace("{hours}", String(report.hours_saved)),
                tr("avg_response_time_report").replace("{time}", formatResponseTime(report.avg_response_time_ms)),
              ]} />
            </ReportSection>

            {/* Compared to Last Month */}
            {report.has_previous_data && report.comparisons ? (
              <ReportSection title={tr("compared_to_last_month")}>
                <BulletList items={[
                  `${tr("conversations")}: ${report.ai_conversations_handled.toLocaleString()} (${report.comparisons.conversations_change >= 0 ? "+" : ""}${report.comparisons.conversations_change_pct ?? 0}%)`,
                  `${tr("resolution_rate")}: ${report.ai_resolution_rate}% (${report.comparisons.resolution_rate_change >= 0 ? "+" : ""}${report.comparisons.resolution_rate_change}%)`,
                  `${tr("hours_saved")}: ${report.hours_saved} (${report.comparisons.hours_saved_change >= 0 ? tr("more_than_last_month").replace("{value}", String(report.comparisons.hours_saved_change)) : tr("less_than_last_month").replace("{value}", String(Math.abs(report.comparisons.hours_saved_change)))})`,
                ]} />
              </ReportSection>
            ) : (
              <ReportSection title={tr("compared_to_last_month")}>
                <p style={{ color: "#6B7280", fontSize: 14, margin: 0 }}>{tr("not_enough_data")}</p>
              </ReportSection>
            )}

            {/* Top Questions */}
            <ReportSection title={tr("most_common_questions")}>
              {report.top_questions.length === 0 ? (
                <p style={{ color: "#6B7280", fontSize: 14, margin: 0 }}>{tr("no_data")}</p>
              ) : (
                <ol style={{ margin: 0, paddingLeft: 20 }}>
                  {report.top_questions.map((q, i) => (
                    <li key={i} style={reportListItem}>
                      {q.question} — <strong>{q.count}</strong> {tr("times")}
                    </li>
                  ))}
                </ol>
              )}
            </ReportSection>

            {/* Escalation Summary */}
            <ReportSection title={tr("escalation_summary")}>
              <p style={{ fontSize: 14, color: "#111827", margin: "0 0 8px" }}>
                {report.human_escalations} {tr("conversations_escalated")}
              </p>
              {report.escalation_reasons.length > 0 && (
                <>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "#374151", margin: "8px 0 4px" }}>
                    {tr("top_escalation_reasons")}:
                  </p>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {report.escalation_reasons.map((r, i) => (
                      <li key={i} style={reportListItem}>
                        {r.reason} ({r.count})
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </ReportSection>

            {/* Recommendations */}
            <ReportSection title={tr("recommendations")} last>
              {report.recommendations.length === 0 ? (
                <p style={{ color: "#6B7280", fontSize: 14, margin: 0 }}>{tr("no_recommendations")}</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {report.recommendations.map((r, i) => (
                    <li key={i} style={reportListItem}>{r.message}</li>
                  ))}
                </ul>
              )}
            </ReportSection>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

/* ─── Sub-components ─── */

function ReportSection({ title, children, last }: Readonly<{
  title: string; children: React.ReactNode; last?: boolean;
}>) {
  return (
    <div style={{
      padding: "16px 0",
      borderBottom: last ? undefined : "1px solid rgba(0,0,0,0.08)",
    }}>
      <h2 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 900, color: "#111827" }}>{title}</h2>
      {children}
    </div>
  );
}

function BulletList({ items }: Readonly<{ items: string[] }>) {
  return (
    <ul style={{ margin: 0, paddingLeft: 20 }}>
      {items.map((item, i) => (
        <li key={i} style={reportListItem}>{item}</li>
      ))}
    </ul>
  );
}

/* ─── Styles ─── */

const reportContainer: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 14,
  background: "white",
  padding: "24px 28px",
};

const reportHeader: React.CSSProperties = {
  paddingBottom: 16,
  borderBottom: "2px solid #111827",
  marginBottom: 4,
};

const reportListItem: React.CSSProperties = {
  padding: "4px 0",
  fontSize: 14,
  color: "#111827",
  lineHeight: 1.6,
};
