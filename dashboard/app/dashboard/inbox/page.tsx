"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, useSearchParams } from "next/navigation";
import DashboardShell from "../_components/DashboardShell";
import styles from "./inbox-layout.module.css";
import { useDashboardLanguage } from "@/lib/useDashboardLanguage";
import { getBackendUrl } from "@/lib/backend-url";

type ConversationRow = {
  id: string;
  channel: string;
  external_conversation_id: string | null;
  external_user_id: string | null;
  title: string;
  status: "open" | "waiting_customer" | "escalated" | "resolved";
  last_message_at: string;
  last_message_preview: string;
  intent: "booking" | "faq" | "complaint" | "other";
  priority: "low" | "normal" | "high";
  manual_mode?: boolean;
  ai_paused?: boolean;
};

type MsgRow = {
  id: string;
  created_at: string;
  channel: string;
  customer_message: string | null;
  ai_reply: string | null;
  human_reply: string | null;
  extracted_data?: {
    intent?: "booking" | "faq" | "complaint" | "other";
    date?: string | null;
    time?: string | null;
    people?: string | number | null;
    human_reply_source?: string | null;
  } | null;
};

type ThreadResponse = {
  conversationId: string;
  conversation: ConversationRow | null;
  messages: MsgRow[];
};

export default function InboxPage() {
  const router = useRouter();
  const { tr } = useDashboardLanguage();
  const searchParams = useSearchParams();
  const selectedFromUrl = searchParams.get("c") || "";
  const backendUrl = useMemo(() => getBackendUrl(), []);

  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [authUserId, setAuthUserId] = useState("");
  const [convos, setConvos] = useState<ConversationRow[]>([]);
  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [selectedConversation, setSelectedConversation] = useState<ConversationRow | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ConversationRow["status"] | "all">("all");
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyStatus, setReplyStatus] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [unreadConversationIds, setUnreadConversationIds] = useState<string[]>([]);
  const threadBottomRef = useRef<HTMLDivElement | null>(null);
  const isUserSwitching = useRef(false);
  const selectedConversationRef = useRef<ConversationRow | null>(null);
  selectedConversationRef.current = selectedConversation;

  const fmt = useMemo(() => (d: string) => new Date(d).toLocaleString(), []);
  const bookingSummary = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const extracted = messages[i]?.extracted_data;
      if (!extracted || extracted.intent !== "booking") continue;
      const date = String(extracted.date || "").trim();
      const time = String(extracted.time || "").trim();
      const peopleRaw = extracted.people;
      const people = peopleRaw === null || peopleRaw === undefined ? "" : String(peopleRaw).trim();
      if (!date && !time && !people) continue;
      return {
        date: date || "—",
        time: time || "—",
        people: people || "—",
      };
    }
    return null;
  }, [messages]);

  const filteredConvos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return convos.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (!q) return true;
      return [
        c.id,
        c.title,
        c.external_conversation_id || "",
        c.external_user_id || "",
        c.channel,
        c.intent,
        c.status,
        c.priority,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [convos, search, statusFilter]);

  const unreadConversationSet = useMemo(
    () => new Set(unreadConversationIds.filter(Boolean)),
    [unreadConversationIds]
  );

  const sortConversations = useCallback((rows: ConversationRow[]) => {
    return rows
      .slice()
      .sort(
        (a, b) =>
          new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
      );
  }, []);

  const upsertConversation = useCallback(
    (incoming: ConversationRow) => {
      setConvos((prev) => {
        const idx = prev.findIndex((row) => row.id === incoming.id);
        if (idx === -1) return sortConversations([incoming, ...prev]);
        const next = prev.slice();
        next[idx] = { ...next[idx], ...incoming };
        return sortConversations(next);
      });
      setSelectedConversation((prev) => {
        if (!prev || prev.id !== incoming.id) return prev;
        return { ...prev, ...incoming };
      });
    },
    [sortConversations]
  );

  const loadConversations = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      router.push("/login");
      return [] as ConversationRow[];
    }

    const resp = await fetch(`${backendUrl}/api/conversations`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!resp.ok) {
      console.error(await resp.text());
      return [] as ConversationRow[];
    }

    const json = await resp.json();
    const rows = (json?.conversations ?? []) as ConversationRow[];
    setConvos(sortConversations(rows));
    return rows;
  }, [backendUrl, router, sortConversations]);

  const loadUnreadNotificationConversations = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { data, error } = await supabase
      .from("notifications")
      .select("conversation_id")
      .eq("user_id", userData.user.id)
      .eq("read", false);

    if (error) {
      const text = String(error.message || "").toLowerCase();
      if (text.includes("notifications") && (text.includes("does not exist") || text.includes("schema cache"))) {
        setUnreadConversationIds([]);
        return;
      }
      console.error("Unread notification fetch failed:", error.message);
      return;
    }

    const ids = (data || [])
      .map((row) => String(row?.conversation_id || "").trim())
      .filter(Boolean);
    setUnreadConversationIds(Array.from(new Set(ids)));
  }, []);

  const loadThread = useCallback(
    async (conversationId: string) => {
      if (!conversationId) {
        setSelectedConversation(null);
        setMessages([]);
        return;
      }

      setThreadLoading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        router.push("/login");
        return;
      }

      const resp = await fetch(
        `${backendUrl}/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!resp.ok) {
        console.error(await resp.text());
        setSelectedConversation(null);
        setMessages([]);
        setThreadLoading(false);
        return;
      }

      const json = (await resp.json()) as ThreadResponse;
      setSelectedConversation(json?.conversation || null);
      const threadMessages = Array.isArray(json?.messages) ? json.messages : [];
      setMessages(threadMessages.length > 200 ? threadMessages.slice(-200) : threadMessages);
      setThreadLoading(false);
    },
    [backendUrl, router]
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!userData.user) {
        router.push("/login");
        return;
      }
      setAuthUserId(userData.user.id);

      const rows = await loadConversations();
      if (cancelled) return;
      await loadUnreadNotificationConversations();
      if (cancelled) return;
      const initialId = selectedFromUrl || rows?.[0]?.id || "";
      setSelectedConversationId(initialId);
      if (initialId) {
        await loadThread(initialId);
      }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [router, selectedFromUrl, loadConversations, loadThread, loadUnreadNotificationConversations]);

  useEffect(() => {
    if (!authUserId) return;

    const channel = supabase
      .channel(`inbox-conversations-${authUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `user_id=eq.${authUserId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const deletedId = String((payload.old as { id?: string } | null)?.id || "");
            if (!deletedId) return;
            setConvos((prev) => prev.filter((row) => row.id !== deletedId));
            if (selectedConversationId === deletedId) {
              setSelectedConversation(null);
              setMessages([]);
            }
            return;
          }

          const next = (payload.new || {}) as Partial<ConversationRow>;
          const mapped: ConversationRow = {
            id: String(next.id || ""),
            channel: String(next.channel || "dashboard"),
            external_conversation_id:
              next.external_conversation_id === null
                ? null
                : String(next.external_conversation_id || ""),
            external_user_id:
              next.external_user_id === null ? null : String(next.external_user_id || ""),
            title: String(next.title || ""),
            status:
              next.status === "open" ||
              next.status === "waiting_customer" ||
              next.status === "escalated" ||
              next.status === "resolved"
                ? next.status
                : "open",
            last_message_at: String(next.last_message_at || new Date().toISOString()),
            last_message_preview: String(next.last_message_preview || ""),
            intent:
              next.intent === "booking" ||
              next.intent === "faq" ||
              next.intent === "complaint" ||
              next.intent === "other"
                ? next.intent
                : "other",
            priority:
              next.priority === "low" || next.priority === "normal" || next.priority === "high"
                ? next.priority
                : "normal",
            manual_mode: Boolean((next as { manual_mode?: boolean } | null)?.manual_mode),
            ai_paused: Boolean((next as { ai_paused?: boolean } | null)?.ai_paused),
          };

          if (!mapped.id) return;
          upsertConversation(mapped);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [authUserId, upsertConversation]);

  useEffect(() => {
    if (!selectedConversationId) return;

    const MAX_MESSAGES = 200;

    const channel = supabase
      .channel(`inbox-messages-${selectedConversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selectedConversationId}`,
        },
        (payload) => {
          const conv = selectedConversationRef.current;
          const next = (payload.new || {}) as Partial<MsgRow>;
          const messageRow: MsgRow = {
            id: String(next.id || ""),
            created_at: String(next.created_at || new Date().toISOString()),
            channel: String(next.channel || conv?.channel || "dashboard"),
            customer_message:
              next.customer_message === null ? null : String(next.customer_message || ""),
            ai_reply: next.ai_reply === null ? null : String(next.ai_reply || ""),
            human_reply: next.human_reply === null ? null : String(next.human_reply || ""),
            extracted_data:
              next.extracted_data && typeof next.extracted_data === "object"
                ? (next.extracted_data as MsgRow["extracted_data"])
                : null,
          };

          if (!messageRow.id) return;

          setMessages((prev) => {
            if (prev.some((row) => row.id === messageRow.id)) return prev;
            const updated = [...prev, messageRow];
            return updated.length > MAX_MESSAGES ? updated.slice(-MAX_MESSAGES) : updated;
          });

          const preview =
            messageRow.human_reply?.trim() ||
            messageRow.ai_reply?.trim() ||
            messageRow.customer_message?.trim() ||
            "";
          if (preview) {
            upsertConversation({
              id: selectedConversationId,
              channel: messageRow.channel,
              external_conversation_id: conv?.external_conversation_id || null,
              external_user_id: conv?.external_user_id || null,
              title: conv?.title || "Conversation",
              status: conv?.status || "open",
              last_message_at: messageRow.created_at,
              last_message_preview: preview,
              intent: conv?.intent || "other",
              priority: conv?.priority || "normal",
              manual_mode: Boolean(conv?.manual_mode),
              ai_paused: Boolean(conv?.ai_paused),
            });
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedConversationId, upsertConversation]);

  useEffect(() => {
    threadBottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [selectedConversationId, messages.length, threadLoading]);

  async function selectConversation(nextId: string) {
    if (!nextId || nextId === selectedConversationId) return;
    isUserSwitching.current = true;
    setSelectedConversationId(nextId);
    setReplyStatus(null);
    router.replace(`/dashboard/inbox?c=${encodeURIComponent(nextId)}`);
    await loadThread(nextId);
    isUserSwitching.current = false;
  }

  async function sendReply() {
    const message = replyText.trim();
    if (!message || !selectedConversationId || sendingReply) return;

    setSendingReply(true);
    setReplyStatus(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        router.push("/login");
        return;
      }

      const resp = await fetch(`${backendUrl}/api/conversation/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversationId: selectedConversationId,
          message,
        }),
      });

      const text = await resp.text();
      let data: { error?: string } | null = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }

      if (!resp.ok) {
        throw new Error(data?.error || text || `HTTP ${resp.status}`);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          created_at: new Date().toISOString(),
          channel: selectedConversation?.channel || "dashboard",
          customer_message: null,
          ai_reply: null,
          human_reply: message,
        },
      ]);
      setReplyText("");
      setReplyStatus(`${tr("send")} ✓`);
      await loadThread(selectedConversationId);
      await loadConversations();
      await loadUnreadNotificationConversations();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send reply";
      setReplyStatus(`Send failed: ${msg}`);
    } finally {
      setSendingReply(false);
    }
  }

  async function setConversationStatus(nextStatus: ConversationRow["status"]) {
    if (!selectedConversationId || updatingStatus) return;
    setUpdatingStatus(true);
    setReplyStatus(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        router.push("/login");
        return;
      }

      const resp = await fetch(
        `${backendUrl}/api/conversations/${encodeURIComponent(selectedConversationId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: nextStatus }),
        }
      );

      const text = await resp.text();
      let data: { conversation?: ConversationRow; error?: string } | null = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }

      if (!resp.ok) {
        throw new Error(data?.error || text || `HTTP ${resp.status}`);
      }

      const updated = data?.conversation || null;
      if (updated) {
        setSelectedConversation(updated);
        setConvos((prev) =>
          prev.map((row) =>
            row.id === updated.id
              ? {
                  ...row,
                  status: updated.status,
                  manual_mode: Boolean(updated.manual_mode),
                  ai_paused: Boolean(updated.ai_paused),
                }
              : row
          )
        );
      }
      setReplyStatus(
        nextStatus === "escalated"
          ? "Escalation lock enabled. AI auto-replies are blocked."
          : "Conversation status updated."
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update status";
      setReplyStatus(`Status update failed: ${msg}`);
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function resumeAi() {
    if (!selectedConversationId || updatingStatus) return;
    setUpdatingStatus(true);
    setReplyStatus(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        router.push("/login");
        return;
      }

      const resp = await fetch(
        `${backendUrl}/api/conversations/${encodeURIComponent(selectedConversationId)}/resume-ai`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const text = await resp.text();
      let data: { conversation?: ConversationRow; error?: string } | null = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }

      if (!resp.ok) {
        throw new Error(data?.error || text || `HTTP ${resp.status}`);
      }

      const updated = data?.conversation || null;
      if (updated) {
        upsertConversation({
          ...updated,
          manual_mode: Boolean(updated.manual_mode),
          ai_paused: Boolean(updated.ai_paused),
        });
      } else {
        await loadConversations();
      }
      setReplyStatus("AI auto-replies resumed for this conversation.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to resume AI";
      setReplyStatus(`Resume failed: ${msg}`);
    } finally {
      setUpdatingStatus(false);
    }
  }

  return (
    <DashboardShell title={tr("inbox")} subtitle={tr("inbox_subtitle")}>
      <div className={styles.wrap}>
        <div className={styles.toolbar}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr("search_placeholder")}
            className={styles.input}
          />
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as ConversationRow["status"] | "all")
            }
            className={styles.select}
          >
            <option value="all">{tr("all_statuses")}</option>
            <option value="open">{tr("open")}</option>
            <option value="waiting_customer">{tr("waiting_customer")}</option>
            <option value="escalated">{tr("escalated")}</option>
            <option value="resolved">{tr("resolved")}</option>
          </select>
        </div>

        <div className={styles.workspace}>
          <section className={styles.listPanel}>
            {loading ? <div className={styles.empty}>Loading conversations...</div> : null}
            {!loading && filteredConvos.length === 0 ? (
              <div className={styles.empty}>No conversations found.</div>
            ) : null}
            {!loading
              ? filteredConvos.map((c) => (
                <article
                  key={c.id}
                  className={`${styles.item} ${
                    selectedConversationId === c.id ? styles.itemActive : ""
                  }`}
                  onClick={() => void selectConversation(c.id)}
                >
                  {unreadConversationSet.has(c.id) ? (
                    <span className={styles.notifyDot} title="Unread escalation notification" />
                  ) : null}
                  <div className={styles.line}>
                    <span className={styles.title}>{c.title || "Untitled conversation"}</span>
                    {c.status === "escalated" ? (
                        <span className={styles.escalatedDot} title="Escalated conversation" />
                      ) : null}
                      <span className={styles.muted} style={{ marginLeft: "auto" }}>
                        {fmt(c.last_message_at)}
                      </span>
                    </div>
                    <div className={styles.muted}>
                      {c.channel} • {c.external_user_id || "Unknown"}
                    </div>
                    <div className={styles.preview}>{c.last_message_preview || "—"}</div>
                    <div className={styles.line}>
                    <span className={styles.pill}>
                      {c.status === "open"
                        ? tr("open")
                        : c.status === "waiting_customer"
                        ? tr("waiting_customer")
                        : c.status === "escalated"
                        ? tr("escalated")
                        : tr("resolved")}
                    </span>
                      <span className={styles.pill}>{c.intent}</span>
                      <span className={styles.pill}>{c.priority}</span>
                    </div>
                  </article>
                ))
              : null}
          </section>

          <section className={styles.threadPanel}>
            {!selectedConversationId ? (
              <div className={styles.empty}>Select a conversation to view thread.</div>
            ) : (
              <>
                <div className={styles.threadHead}>
                  <div className={styles.threadHeadTop}>
                    <div style={{ minWidth: 220 }}>
                      <strong className={styles.threadTitle}>
                        {selectedConversation?.title || "Conversation"}
                      </strong>
                      <div className={styles.muted}>
                        {tr("customer")}: {selectedConversation?.external_user_id || "Unknown"}
                      </div>
                    </div>
                    <div className={styles.threadBadges}>
                      <span className={styles.pill}>
                      {selectedConversation?.status === "open"
                        ? tr("open")
                        : selectedConversation?.status === "waiting_customer"
                        ? tr("waiting_customer")
                        : selectedConversation?.status === "escalated"
                        ? tr("escalated")
                        : selectedConversation?.status === "resolved"
                        ? tr("resolved")
                        : tr("open")}
                      </span>
                      <span className={styles.pill}>{selectedConversation?.channel || "dashboard"}</span>
                      <span className={styles.pill}>{selectedConversation?.priority || "normal"}</span>
                    </div>
                  </div>

                  {bookingSummary ? (
                    <div className={styles.bookingSummary}>
                      <span className={styles.bookingTitle}>{tr("bookings")}:</span>
                      <span className={styles.pill}>{tr("date")}: {bookingSummary.date}</span>
                      <span className={styles.pill}>{tr("time")}: {bookingSummary.time}</span>
                      <span className={styles.pill}>{tr("people")}: {bookingSummary.people}</span>
                    </div>
                  ) : null}

                  <div className={styles.threadActions}>
                    <button
                      className={styles.button}
                      onClick={() => void setConversationStatus("open")}
                      disabled={updatingStatus}
                    >
                      {updatingStatus ? tr("loading") : tr("mark_handled")}
                    </button>
                    <button
                      className={styles.button}
                      onClick={() => void resumeAi()}
                      disabled={updatingStatus}
                    >
                      {updatingStatus ? tr("loading") : tr("resume_ai")}
                    </button>
                    {selectedConversation?.status === "escalated" ||
                    selectedConversation?.manual_mode ||
                    selectedConversation?.ai_paused ? (
                      <button
                        className={styles.button}
                        onClick={() => router.push("/dashboard/escalated")}
                        disabled={updatingStatus}
                      >
                        {tr("open_in_escalated")}
                      </button>
                    ) : null}
                    {!selectedConversation?.manual_mode &&
                    !selectedConversation?.ai_paused &&
                    selectedConversation?.status !== "escalated" ? (
                      <button
                        className={styles.button}
                        onClick={() => void setConversationStatus("escalated")}
                        disabled={updatingStatus}
                      >
                        {updatingStatus ? tr("loading") : tr("set_escalated_ai_off")}
                      </button>
                    ) : null}
                  </div>
                  {selectedConversation?.manual_mode || selectedConversation?.ai_paused ? (
                    <div className={styles.muted}>{tr("human_handling")}</div>
                  ) : null}
                </div>

                <div className={styles.messages}>
                  {threadLoading ? <div className={styles.empty}>Loading thread...</div> : null}
                  {!threadLoading && messages.length === 0 ? (
                    <div className={styles.empty}>No messages yet.</div>
                  ) : null}
                  {!threadLoading
                    ? messages.map((m) => {
                        const nodes: React.ReactNode[] = [];

                        if (m.customer_message && m.customer_message.trim()) {
                          nodes.push(
                            <div key={`${m.id}:customer`} className={`${styles.msgRow} ${styles.toEnd}`}>
                              <div>
                                <div className={`${styles.msgMeta} ${styles.msgMetaEnd}`}>Customer</div>
                                <div className={`${styles.bubble} ${styles.bubbleUser}`}>
                                  {m.customer_message}
                                </div>
                              </div>
                            </div>
                          );
                        }

                        if (m.ai_reply && m.ai_reply.trim()) {
                          nodes.push(
                            <div key={`${m.id}:ai`} className={styles.msgRow}>
                              <div>
                                <div className={styles.msgMeta}>AI reply</div>
                                <div className={`${styles.bubble} ${styles.bubbleAi}`}>{m.ai_reply}</div>
                              </div>
                            </div>
                          );
                        }

                        if (m.human_reply && m.human_reply.trim()) {
                          const humanReplySource =
                            String(m.extracted_data?.human_reply_source || "").trim().toLowerCase();
                          const humanReplyLabel =
                            humanReplySource === "owner_whatsapp"
                              ? "Human reply (Owner WhatsApp)"
                              : "Human reply";
                          nodes.push(
                            <div key={`${m.id}:human`} className={styles.msgRow}>
                              <div>
                                <div className={styles.msgMeta}>{humanReplyLabel}</div>
                                <div className={`${styles.bubble} ${styles.bubbleHuman}`}>
                                  {m.human_reply}
                                </div>
                              </div>
                            </div>
                          );
                        }

                        return nodes;
                      })
                    : null}
                  <div ref={threadBottomRef} />
                </div>

                <div className={styles.composer}>
                  <div className={styles.composerRow}>
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={tr("type_manual_reply")}
                      className={styles.textarea}
                    />
                    <button
                      onClick={() => void sendReply()}
                      disabled={sendingReply || !replyText.trim()}
                      className={styles.button}
                    >
                      {sendingReply ? tr("sending") : tr("send")}
                    </button>
                  </div>
                  {replyStatus ? <div className={styles.muted}>{replyStatus}</div> : null}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </DashboardShell>
  );
}
