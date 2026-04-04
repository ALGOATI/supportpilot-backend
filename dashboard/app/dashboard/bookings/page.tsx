"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import DashboardShell from "../_components/DashboardShell";
import { useDashboardLanguage } from "@/lib/useDashboardLanguage";

type BookingExtracted = {
  intent?: "booking" | "faq" | "other";
  name?: string | null;
  date?: string | null;  // YYYY-MM-DD
  time?: string | null;  // HH:MM
  people?: number | null;
  phone?: string | null;
  status?: "incomplete" | "complete";
  missing?: string[];
  notes?: string | null;
};

type MsgRow = {
  id: string;
  created_at: string;
  conversation_id: string | null;
  extracted_data: BookingExtracted | null;
};

type BookingRow = {
  id: string;
  created_at: string;
  conversation_id: string | null;
  extracted: BookingExtracted;
  booking_status: "draft" | "confirmed" | "completed" | "cancelled";
};

export default function BookingsPage() {
  const router = useRouter();
  const { tr } = useDashboardLanguage();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "draft" | "confirmed" | "completed" | "cancelled"
  >("all");

  const fmt = useMemo(() => (d: string) => new Date(d).toLocaleString(), []);
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.booking_status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        row.extracted.name,
        row.extracted.phone,
        row.extracted.date,
        row.extracted.time,
        row.conversation_id,
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return haystack.includes(q);
    });
  }, [rows, query, statusFilter]);

  const stats = useMemo(() => {
    const total = rows.length;
    const draft = rows.filter((r) => r.booking_status === "draft").length;
    const confirmed = rows.filter((r) => r.booking_status === "confirmed").length;
    const completed = rows.filter((r) => r.booking_status === "completed").length;
    const actionNeeded = rows.filter((r) => r.booking_status === "draft" || r.booking_status === "cancelled").length;
    return { total, draft, confirmed, completed, actionNeeded };
  }, [rows]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!userData.user) {
        router.push("/login");
        return;
      }

      // Pull recent messages with extracted_data
      const bookingsResult = await supabase
        .from("bookings")
        .select(
          "id,created_at,conversation_id,customer_name,customer_phone,booking_date,booking_time,people,status"
        )
        .order("updated_at", { ascending: false })
        .limit(1000);

      if (cancelled) return;

      if (!bookingsResult.error && Array.isArray(bookingsResult.data)) {
        const mapped = bookingsResult.data.map((row) => ({
          id: row.id,
          created_at: row.created_at,
          conversation_id: row.conversation_id,
          booking_status: (row.status || "draft") as BookingRow["booking_status"],
          extracted: {
            intent: "booking" as const,
            name: row.customer_name,
            date: row.booking_date,
            time: row.booking_time,
            people:
              row.people === null || row.people === undefined || row.people === ""
                ? null
                : Number(row.people),
            phone: row.customer_phone,
            status: row.status === "confirmed" || row.status === "completed" ? "complete" : "incomplete",
          },
        })) as BookingRow[];

        setRows(
          mapped.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
        );
        setLoading(false);
        return;
      }

      // Fallback for older environments without bookings table.
      const { data, error } = await supabase
        .from("messages")
        .select("id, created_at, conversation_id, extracted_data")
        .order("created_at", { ascending: false })
        .limit(2000);

      if (error) {
        console.error(error);
        setLoading(false);
        return;
      }

      const msgs = (data ?? []) as MsgRow[];

      // Group: keep ONLY the newest booking-intent message per conversation_id
      const latestByConvo = new Map<string, BookingRow>();

      for (const m of msgs) {
        const cid = m.conversation_id;
        const ex = m.extracted_data;

        if (!cid || !ex) continue;
        if (ex.intent !== "booking") continue;

        // Because msgs are ordered DESC, first time we see cid is the newest row.
        if (!latestByConvo.has(cid)) {
          latestByConvo.set(cid, {
            id: m.id,
            created_at: m.created_at,
            conversation_id: cid,
            extracted: ex,
            booking_status: ex.status === "complete" ? "confirmed" : "draft",
          });
        }
      }

      const grouped = Array.from(latestByConvo.values()).sort(
        (a, b) => +new Date(b.created_at) - +new Date(a.created_at)
      );

      if (!cancelled) {
        setRows(grouped);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [router]);

  return (
    <DashboardShell title={tr("bookings")} subtitle={tr("bookings_subtitle")}>
      <div style={{ maxWidth: 1120 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, letterSpacing: "-0.02em" }}>{tr("bookings")}</h1>
        <div style={{ fontSize: 13, color: "#475569", fontWeight: 600 }}>
          {filteredRows.length} visible / {rows.length} total
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
        }}
      >
        <StatCard label="Total bookings" value={stats.total} tone="neutral" />
        <StatCard label="Drafts" value={stats.draft} tone="warning" />
        <StatCard label="Confirmed" value={stats.confirmed} tone="success" />
        <StatCard label="Completed" value={stats.completed} tone="neutral" />
        <StatCard label="Action needed" value={stats.actionNeeded} tone="danger" />
      </div>

      <div
        style={{
          marginTop: 14,
          border: "1px solid rgba(15,23,42,0.12)",
          borderRadius: 14,
          background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
          padding: 12,
          display: "grid",
          gridTemplateColumns: "1fr minmax(170px, 220px)",
          gap: 10,
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by customer, phone, date, conversation..."
          style={controlInput}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          style={controlInput}
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {loading ? (
        <p style={{ marginTop: 16 }}>{tr("loading")}</p>
      ) : rows.length === 0 ? (
        <p style={{ marginTop: 16 }}>{tr("no_bookings")}</p>
      ) : filteredRows.length === 0 ? (
        <p style={{ marginTop: 16, color: "#64748b", fontWeight: 600 }}>
          No bookings match this filter.
        </p>
      ) : (
        <div
          style={{
            marginTop: 16,
            border: "1px solid rgba(15,23,42,0.12)",
            borderRadius: 14,
            background: "white",
            overflow: "auto",
            boxShadow: "0 6px 18px rgba(15,23,42,0.06)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 920 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={th}>{tr("created")}</th>
                <th style={th}>{tr("name")}</th>
                <th style={th}>{tr("date")}</th>
                <th style={th}>{tr("time")}</th>
                <th style={th}>{tr("people")}</th>
                <th style={th}>{tr("phone")}</th>
                <th style={th}>{tr("status")}</th>
                <th style={th}>{tr("open_label")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => {
                const ex = r.extracted;
                const status = ex.status ?? "incomplete";

                return (
                  <tr key={r.id} style={{ background: "white" }}>
                    <td style={td}>{fmt(r.created_at)}</td>
                    <td style={td}>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>{ex.name ?? "Unknown customer"}</div>
                      {r.conversation_id ? (
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 3, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                          {r.conversation_id.slice(0, 8)}…
                        </div>
                      ) : null}
                    </td>
                    <td style={tdMono}>{ex.date ?? "—"}</td>
                    <td style={tdMono}>{ex.time ?? "—"}</td>
                    <td style={td}>{ex.people ?? "—"}</td>
                    <td style={tdMono}>{ex.phone ?? "—"}</td>
                    <td style={td}>
                      <StatusPill status={r.booking_status} />
                      {status !== "complete" && ex.missing?.length ? (
                        <div style={{ marginTop: 8, fontSize: 12, color: "#475569", lineHeight: 1.4 }}>
                          <strong>{tr("missing")}:</strong> {ex.missing.join(", ")}
                        </div>
                      ) : null}
                    </td>
                    <td style={td}>
                      {r.conversation_id ? (
                        <>
                          <Link
                            href={`/dashboard/inbox/${encodeURIComponent(r.conversation_id)}`}
                            style={{
                              display: "inline-block",
                              border: "1px solid rgba(30,64,175,0.25)",
                              borderRadius: 8,
                              padding: "6px 10px",
                              textDecoration: "none",
                              color: "#1e3a8a",
                              fontWeight: 700,
                              background: "#eff6ff",
                            }}
                          >
                            {tr("view_thread")}
                          </Link>
                        </>
                      ) : (
                        <span style={{ opacity: 0.6 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </DashboardShell>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 12px",
  borderBottom: "1px solid rgba(15,23,42,0.12)",
  fontSize: 13,
  color: "#334155",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const td: React.CSSProperties = {
  padding: "12px",
  borderBottom: "1px solid rgba(15,23,42,0.08)",
  verticalAlign: "top",
};

const tdMono: React.CSSProperties = {
  ...td,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  color: "#334155",
};

const controlInput: React.CSSProperties = {
  width: "100%",
  border: "1px solid rgba(15,23,42,0.18)",
  borderRadius: 10,
  padding: "10px 12px",
  background: "white",
  fontSize: 14,
  color: "#0f172a",
  outline: "none",
};

function statusStyle(status: BookingRow["booking_status"]): React.CSSProperties {
  if (status === "confirmed") {
    return {
      color: "#166534",
      background: "#ecfdf3",
      border: "1px solid #bbf7d0",
    };
  }
  if (status === "draft") {
    return {
      color: "#1e40af",
      background: "#eff6ff",
      border: "1px solid #bfdbfe",
    };
  }
  if (status === "cancelled") {
    return {
      color: "#991b1b",
      background: "#fef2f2",
      border: "1px solid #fecaca",
    };
  }
  return {
    color: "#334155",
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
  };
}

function StatusPill({ status }: { status: BookingRow["booking_status"] }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: 999,
        fontWeight: 800,
        fontSize: 12,
        textTransform: "capitalize",
        ...statusStyle(status),
      }}
    >
      {status}
    </span>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "success" | "warning" | "danger";
}) {
  const palette =
    tone === "success"
      ? { border: "rgba(22,163,74,0.24)", bg: "#f0fdf4", value: "#166534" }
      : tone === "warning"
      ? { border: "rgba(217,119,6,0.24)", bg: "#fffbeb", value: "#b45309" }
      : tone === "danger"
      ? { border: "rgba(220,38,38,0.24)", bg: "#fef2f2", value: "#991b1b" }
      : { border: "rgba(15,23,42,0.14)", bg: "#f8fafc", value: "#0f172a" };

  return (
    <div
      style={{
        border: `1px solid ${palette.border}`,
        borderRadius: 12,
        background: palette.bg,
        padding: "10px 12px",
      }}
    >
      <div style={{ fontSize: 12, color: "#475569", fontWeight: 700 }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 24, fontWeight: 900, color: palette.value }}>{value}</div>
    </div>
  );
}
