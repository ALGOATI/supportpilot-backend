"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import DashboardShell from "../_components/DashboardShell";
import { useDashboardLanguage } from "@/lib/useDashboardLanguage";
import { getBackendUrl } from "@/lib/backend-url";

type EscalatedConversation = {
  id: string;
  title: string | null;
  channel: string | null;
  external_user_id: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  status: "open" | "waiting_customer" | "escalated" | "resolved";
  escalation_reason?: string | null;
};

export default function EscalatedPage() {
  const router = useRouter();
  const { tr } = useDashboardLanguage();
  const [rows, setRows] = useState<EscalatedConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const backendUrl = useMemo(() => getBackendUrl(), []);

  const fmt = useMemo(
    () => (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—"),
    []
  );

  const loadEscalated = useCallback(async () => {
    setError(null);
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.push("/login");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      router.push("/login");
      return;
    }

    const resp = await fetch(`${backendUrl}/api/conversations/escalated`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await resp.json().catch(() => null);
    if (!resp.ok) {
      setError(String(json?.error || "Failed to load escalated conversations"));
      setLoading(false);
      return;
    }

    setRows((json?.conversations || []) as EscalatedConversation[]);
    setLoading(false);
  }, [backendUrl, router]);

  useEffect(() => {
    void loadEscalated();
  }, [loadEscalated]);

  async function markHandled(conversationId: string) {
    setBusyId(conversationId);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch(
        `${backendUrl}/api/conversations/${encodeURIComponent(conversationId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: "open" }),
        }
      );

      const json = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(json?.error || "Failed to update status"));

      setRows((prev) => prev.filter((row) => row.id !== conversationId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to mark handled");
    } finally {
      setBusyId(null);
    }
  }

  async function resumeAi(conversationId: string) {
    setBusyId(conversationId);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch(
        `${backendUrl}/api/conversations/${encodeURIComponent(conversationId)}/resume-ai`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const json = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(json?.error || "Failed to resume AI"));

      setRows((prev) => prev.filter((row) => row.id !== conversationId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to resume AI");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <DashboardShell title={tr("escalated")} subtitle={tr("escalated_subtitle")}>
      <div style={{ maxWidth: 1040 }}>
        {error ? (
          <div
            style={{
              marginBottom: 12,
              border: "1px solid #fecaca",
              borderRadius: 10,
              padding: "10px 12px",
              color: "#991b1b",
              background: "#fef2f2",
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        ) : null}

        {loading ? (
          <p>{tr("loading")}</p>
        ) : rows.length === 0 ? (
          <div
            style={{
              border: "1px solid rgba(15,23,42,0.12)",
              borderRadius: 14,
              background: "#fff",
              padding: "24px 18px",
              color: "#475569",
              fontWeight: 600,
            }}
          >
            {tr("no_escalated_conversations")}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {rows.map((row) => {
              const channel = String(row.channel || "dashboard");
              const customer = String(row.external_user_id || "Unknown");

              return (
                <article
                  key={row.id}
                  style={{
                    border: "1px solid rgba(15,23,42,0.12)",
                    borderRadius: 14,
                    background: "#fff",
                    padding: 14,
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ minWidth: 220 }}>
                      <div style={{ fontWeight: 800, fontSize: 17, color: "#0f172a" }}>
                        {row.title || `${tr("escalated")} #${row.id.slice(0, 8)}`}
                      </div>
                      <div style={{ marginTop: 4, color: "#475569", fontSize: 13 }}>
                        {tr("customer")}: {customer}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Badge label={channel} tone="neutral" />
                      <Badge label={tr("escalated")} tone="danger" />
                    </div>
                  </div>

                  <div style={{ color: "#0f172a", fontSize: 14, lineHeight: 1.45 }}>
                    {row.last_message_preview || "—"}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                    <Meta label={tr("escalation_reason")} value={row.escalation_reason || "—"} />
                    <Meta label={tr("last_message_time")} value={fmt(row.last_message_at)} />
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Link
                      href={`/dashboard/inbox?c=${encodeURIComponent(row.id)}`}
                      style={btn("primary")}
                    >
                      {tr("open_conversation")}
                    </Link>
                    <button
                      type="button"
                      onClick={() => void markHandled(row.id)}
                      disabled={busyId === row.id}
                      style={btn("default")}
                    >
                      {busyId === row.id ? tr("loading") : tr("mark_handled")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void resumeAi(row.id)}
                      disabled={busyId === row.id}
                      style={btn("default")}
                    >
                      {busyId === row.id ? tr("loading") : tr("resume_ai")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function btn(type: "primary" | "default"): React.CSSProperties {
  if (type === "primary") {
    return {
      border: "1px solid rgba(29,78,216,0.35)",
      background: "#eff6ff",
      color: "#1e3a8a",
      borderRadius: 9,
      padding: "8px 12px",
      fontWeight: 700,
      textDecoration: "none",
      fontSize: 13,
    };
  }
  return {
    border: "1px solid rgba(15,23,42,0.14)",
    background: "#f8fafc",
    color: "#0f172a",
    borderRadius: 9,
    padding: "8px 12px",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  };
}

function Badge({ label, tone }: { label: string; tone: "neutral" | "danger" }) {
  const style: React.CSSProperties =
    tone === "danger"
      ? { border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b" }
      : { border: "1px solid #cbd5e1", background: "#f8fafc", color: "#334155" };

  return (
    <span
      style={{
        ...style,
        fontSize: 12,
        fontWeight: 700,
        borderRadius: 999,
        padding: "4px 10px",
        textTransform: "lowercase",
      }}
    >
      {label}
    </span>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(15,23,42,0.1)",
        borderRadius: 10,
        padding: "8px 10px",
        background: "#f8fafc",
      }}
    >
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ marginTop: 2, color: "#0f172a", fontSize: 13, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
