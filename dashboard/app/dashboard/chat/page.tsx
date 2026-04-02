"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import DashboardShell from "../_components/DashboardShell";
import { getBackendUrl } from "@/lib/backend-url";
import { useDashboardLanguage } from "@/lib/useDashboardLanguage";

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isTyping?: boolean;
};

type ReplyQueueResponse = {
  jobId?: string;
  conversationId?: string;
  error?: string;
  raw?: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function ChatPage() {
  const router = useRouter();
  const { tr } = useDashboardLanguage();

  const BACKEND_URL = useMemo(() => getBackendUrl(), []);

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");

  const [messages, setMessages] = useState<ChatMsg[]>([]);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Require login
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        router.push("/login");
        return;
      }
      setMessages([{ id: crypto.randomUUID(), role: "assistant", content: tr("chat_welcome") }]);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [router, tr]);

  async function typeAssistantText(full: string) {
    const MAX_MESSAGES = 200;
    const id = crypto.randomUUID();

    // Skip typewriter for long messages (>200 chars)
    if (full.length > 200) {
      setMessages((prev) => {
        const updated = [...prev, { id, role: "assistant" as const, content: full }];
        return updated.length > MAX_MESSAGES ? updated.slice(-MAX_MESSAGES) : updated;
      });
      return;
    }

    // Add empty assistant bubble in "typing" mode
    setMessages((prev) => [
      ...prev,
      { id, role: "assistant", content: "", isTyping: true },
    ]);

    // Typewriter effect — 3 chars per tick at ~16ms (one frame)
    const CHUNK_SIZE = 3;
    for (let i = CHUNK_SIZE; i <= full.length; i += CHUNK_SIZE) {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, content: full.slice(0, i) } : m))
      );
      await sleep(16);
    }

    // Ensure full content is set and finish typing
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content: full, isTyping: false } : m))
    );
  }

  async function pollJob(jobId: string, token: string) {
    const maxPolls = 120;
    for (let i = 0; i < maxPolls; i++) {
      await sleep(800);
      const jobRes = await fetch(`${BACKEND_URL}/api/job/${jobId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const jobText = await jobRes.text();
      let jobData: {
        status?: string;
        result?: { reply?: string };
        error?: string;
      } | null = null;
      try {
        jobData = JSON.parse(jobText);
      } catch {
        jobData = null;
      }

      if (!jobRes.ok) {
        const msg = jobData?.error || jobText || `HTTP ${jobRes.status}`;
        throw new Error(msg);
      }

      if (jobData?.status === "done") {
        return jobData?.result?.reply || "Sorry, I couldn't generate a reply.";
      }
      if (jobData?.status === "failed") {
        throw new Error(jobData?.error || "AI generation failed");
      }
    }

    throw new Error("Job timeout");
  }

  async function send() {
    const userMessage = input.trim();
    if (!userMessage || sending || aiThinking) return;

    setSending(true);
    setInput("");

    // Show user message immediately
    setMessages((prev) => {
      const updated = [...prev, { id: crypto.randomUUID(), role: "user" as const, content: userMessage }];
      return updated.length > 200 ? updated.slice(-200) : updated;
    });

    try {
      // Get access token for backend Authorization header
      const { data: sessionData, error: sessionErr } =
        await supabase.auth.getSession();

      if (sessionErr) throw new Error(sessionErr.message);

      const token = sessionData.session?.access_token;
      if (!token) {
        router.push("/login");
        return;
      }

      const res = await fetch(`${BACKEND_URL}/api/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userMessage,
          conversationId,
        }),
      });

      const text = await res.text();
      let data: ReplyQueueResponse | null = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }

      if (!res.ok) {
        const msg = data?.error || data?.raw || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      if (!data?.jobId) {
        throw new Error("Missing jobId from /api/reply");
      }
      if (data?.conversationId) setConversationId(data.conversationId);

      setAiThinking(true);
      const reply = await pollJob(String(data.jobId), token);
      setAiThinking(false);
      await typeAssistantText(reply);
    } catch (err: unknown) {
      setAiThinking(false);
      const message = err instanceof Error ? err.message : "Unknown error";
      await typeAssistantText(`❌ Error: ${message}`);
    } finally {
      setAiThinking(false);
      setSending(false);
    }
  }

  function newChat() {
    setConversationId(null);
    setMessages([{ id: crypto.randomUUID(), role: "assistant", content: tr("new_chat_welcome") }]);
  }

  if (loading) {
    return (
      <DashboardShell title="Chat Test" subtitle="AI test conversation">
        <div style={{ maxWidth: 900 }}>
        <p>Loading…</p>
        </div>
      </DashboardShell>
    );
  }

  let sendBtnLabel = tr("send");
  if (sending) sendBtnLabel = tr("sending");
  else if (aiThinking) sendBtnLabel = tr("waiting");

  return (
    <DashboardShell title={tr("chat_test")} subtitle={tr("chat_subtitle")}>
      <div style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Chat Test</h1>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={newChat}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.12)",
              background: "white",
              cursor: "pointer",
            }}
          >
            New chat
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, color: "#374151" }}>
        <div>
          Backend: <code>{BACKEND_URL}</code>
        </div>
        <div>
          Conversation ID:{" "}
          <code>{conversationId ?? tr("new_not_set")}</code>
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          border: "1px solid rgba(0,0,0,0.12)",
          borderRadius: 14,
          padding: 14,
          background: "white",
          minHeight: 360,
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          {messages.map((m) => {
            const isUser = m.role === "user";
            let roleLabel = tr("ai_label");
            if (isUser) roleLabel = tr("you");
            else if (m.isTyping) roleLabel = tr("ai_typing");
            return (
            <div
              key={m.id}
              style={{
                display: "flex",
                justifyContent: isUser ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "80%",
                  padding: "10px 12px",
                  borderRadius: 14,
                  border: "1px solid rgba(0,0,0,0.10)",
                  background: isUser ? "#f5f5f5" : "white",
                  whiteSpace: "pre-wrap",
                }}
              >
                <div style={{ fontSize: 12, color: "#374151", marginBottom: 6 }}>
                  {roleLabel}
                </div>
                <div style={{ color: "#111827" }}>{m.content}</div>
              </div>
            </div>
            );
          })}
          {aiThinking ? (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "80%",
                  padding: "10px 12px",
                  borderRadius: 14,
                  border: "1px solid rgba(0,0,0,0.10)",
                  background: "white",
                  whiteSpace: "pre-wrap",
                }}
              >
                <div style={{ fontSize: 12, color: "#374151", marginBottom: 6 }}>
                  AI
                </div>
                <div style={{ color: "#111827" }}>Thinking…</div>
              </div>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          placeholder="Type a message… (Enter = send, Shift+Enter = newline)"
          style={{
            flex: 1,
            padding: 12,
            borderRadius: 12,
            border: "2px solid #cbd5e1",
            background: "#ffffff",
            color: "#0f172a",
            boxShadow: "inset 0 0 0 1px rgba(148,163,184,0.18)",
            resize: "vertical",
          }}
          onFocus={(e) => {
            e.currentTarget.style.border = "2px solid #38bdf8";
            e.currentTarget.style.boxShadow =
              "0 0 0 2px rgba(56,189,248,0.25), inset 0 0 0 1px rgba(56,189,248,0.35)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.border = "2px solid #cbd5e1";
            e.currentTarget.style.boxShadow =
              "inset 0 0 0 1px rgba(148,163,184,0.18)";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />

        <button
          onClick={send}
          disabled={sending || aiThinking || !input.trim()}
          style={{
            width: 120,
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.15)",
            background: sending || aiThinking ? "#eee" : "white",
            cursor: sending || aiThinking ? "not-allowed" : "pointer",
            fontWeight: 900,
          }}
        >
          {sendBtnLabel}
        </button>
      </div>
      </div>
    </DashboardShell>
  );
}
