"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardShell from "../_components/DashboardShell";
import { getBackendUrl } from "@/lib/backend-url";

export default function DevtoolsPage() {
  const router = useRouter();
  const backendUrl = useMemo(() => getBackendUrl(), []);

  const [userEmail, setUserEmail] = useState("");
  const [externalConversationId, setExternalConversationId] = useState("");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!userEmail.trim() || !externalConversationId.trim() || !text.trim()) {
      setStatus("Fill in email, external conversation ID, and text.");
      return;
    }

    setSubmitting(true);
    setStatus(null);

    try {
      const resp = await fetch(`${backendUrl}/dev/simulate/whatsapp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userEmail: userEmail.trim(),
          externalConversationId: externalConversationId.trim(),
          from: externalConversationId.trim(),
          text: text.trim(),
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || `HTTP ${resp.status}`);
      }

      router.push(`/dashboard/inbox/${encodeURIComponent(data.conversationId)}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DashboardShell title="Devtools" subtitle="Simulator and diagnostics">
      <div style={{ maxWidth: 900, color: "#111827" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Devtools</h1>
      </div>

      <form
        onSubmit={submit}
        style={{
          marginTop: 20,
          display: "grid",
          gap: 12,
          border: "1px solid rgba(0,0,0,0.12)",
          borderRadius: 14,
          padding: 16,
          background: "white",
        }}
      >
        <div style={{ fontWeight: 900 }}>Simulate WhatsApp message</div>

        <input
          value={userEmail}
          onChange={(e) => setUserEmail(e.target.value)}
          placeholder="Supabase user email"
          style={inputStyle}
        />

        <input
          value={externalConversationId}
          onChange={(e) => setExternalConversationId(e.target.value)}
          placeholder="External conversation ID (e.g. whatsapp-thread-123)"
          style={inputStyle}
        />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Incoming WhatsApp text"
          rows={5}
          style={{ ...inputStyle, resize: "vertical" }}
        />

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: 220,
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.15)",
            background: submitting ? "#e5e7eb" : "white",
            color: "#111827",
            cursor: submitting ? "not-allowed" : "pointer",
            fontWeight: 900,
          }}
        >
          {submitting ? "Simulating…" : "Simulate WhatsApp"}
        </button>

        {status ? <div style={{ fontWeight: 700, color: "#b91c1c" }}>{status}</div> : null}
      </form>
      </div>
    </DashboardShell>
  );
}

const inputStyle = {
  width: "100%",
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.15)",
  background: "white",
  color: "#111827",
};
