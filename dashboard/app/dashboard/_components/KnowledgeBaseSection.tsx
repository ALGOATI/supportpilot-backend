"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getBackendUrl } from "@/lib/backend-url";
import { useToast } from "./Toast";
import { primaryBtnStyle, secondaryBtnStyle, dangerBtnStyle, EmptyState } from "./ui";

type KnowledgeRow = {
  id: string;
  question: string;
  answer: string;
  source: "human_reply" | "manual" | "imported";
  confidence: "high" | "medium" | "low";
  tags: string[];
  is_active: boolean;
  updated_at: string;
};

export default function KnowledgeBaseSection() {
  const router = useRouter();
  const { notify } = useToast();
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rows, setRows] = useState<KnowledgeRow[]>([]);
  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");
  const [knowledgeLimit, setKnowledgeLimit] = useState<{ current: number; max: number; limitReached: boolean } | null>(null);

  const loadRows = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.push("/login");
      return;
    }

    const { data, error } = await supabase
      .from("knowledge_base")
      .select("id,question,answer,source,confidence,tags,is_active,updated_at")
      .order("updated_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error(error);
      setRows([]);
      setLoading(false);
      return;
    }

    setRows((data || []) as KnowledgeRow[]);
    setLoading(false);
  }, [router]);

  const loadKnowledgeLimit = useCallback(async () => {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return;
    try {
      const res = await fetch(`${getBackendUrl()}/api/knowledge/limit`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setKnowledgeLimit(await res.json());
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadRows();
    void loadKnowledgeLimit();
  }, [loadRows, loadKnowledgeLimit]);

  const focusAddForm = useCallback(() => {
    if (typeof document === "undefined") return;
    const el = document.getElementById("kb-new-question") as HTMLInputElement | null;
    el?.focus();
  }, []);

  async function addManualEntry() {
    const question = newQuestion.trim();
    const answer = newAnswer.trim();
    if (!question || !answer) {
      notify("Both question and answer are required.", "error");
      return;
    }

    if (knowledgeLimit?.limitReached) return;

    setSavingId("new");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) {
        router.push("/login");
        return;
      }

      const { error } = await supabase.from("knowledge_base").insert({
        user_id: user.id,
        question,
        answer,
        source: "manual",
        confidence: "high",
        tags: [],
        is_active: true,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;

      setNewQuestion("");
      setNewAnswer("");
      await loadRows();
      await loadKnowledgeLimit();
      notify("Entry added");
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : "Failed to add entry";
      notify(message, "error");
    } finally {
      setSavingId(null);
    }
  }

  async function updateRow(row: KnowledgeRow) {
    setSavingId(row.id);
    try {
      const { error } = await supabase
        .from("knowledge_base")
        .update({
          question: row.question,
          answer: row.answer,
          source: row.source,
          confidence: row.confidence,
          tags: row.tags,
          is_active: row.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      if (error) throw error;
      await loadRows();
      notify("Entry saved");
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : "Failed to save entry";
      notify(message, "error");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteRow(id: string) {
    setSavingId(id);
    try {
      const { error } = await supabase.from("knowledge_base").delete().eq("id", id);
      if (error) throw error;
      await loadRows();
      await loadKnowledgeLimit();
      notify("Entry deleted");
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : "Failed to delete entry";
      notify(message, "error");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, background: "#fbfcff" }}>
        <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 14, fontWeight: 800, color: "#0f172a" }}>
          Add manual knowledge
        </h3>

        {knowledgeLimit && knowledgeLimit.max > 0 && (
          <div style={{
            marginBottom: 10,
            padding: "8px 12px",
            borderRadius: 8,
            background: knowledgeLimit.limitReached ? "#fef2f2" : "#f0fdf4",
            border: `1px solid ${knowledgeLimit.limitReached ? "#fecaca" : "#bbf7d0"}`,
            fontSize: 13,
            fontWeight: 600,
            color: knowledgeLimit.limitReached ? "#dc2626" : "#166534",
          }}>
            {knowledgeLimit.current} / {knowledgeLimit.max} items used
            {knowledgeLimit.limitReached && " — limit reached. Upgrade your plan for more."}
          </div>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          <input
            id="kb-new-question"
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder="Question"
            style={field}
            disabled={!!knowledgeLimit?.limitReached}
          />
          <textarea
            value={newAnswer}
            onChange={(e) => setNewAnswer(e.target.value)}
            placeholder="Answer"
            rows={3}
            style={field}
            disabled={!!knowledgeLimit?.limitReached}
          />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={addManualEntry}
              disabled={savingId === "new" || !!knowledgeLimit?.limitReached}
              style={{
                ...primaryBtnStyle,
                opacity: knowledgeLimit?.limitReached || savingId === "new" ? 0.6 : 1,
                cursor: knowledgeLimit?.limitReached ? "not-allowed" : "pointer",
              }}
            >
              {savingId === "new" ? "Adding..." : "Add entry"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {loading ? (
          <p style={{ color: "#64748b" }}>Loading...</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="◉"
            title="No knowledge entries yet"
            description="Add Q&A above so the assistant can answer common questions confidently. Replies you send to escalated chats also get learned automatically."
            actionLabel="Add your first entry"
            onAction={focusAddForm}
          />
        ) : (
          rows.map((row, idx) => (
            <div key={row.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "white" }}>
              <div style={{ marginBottom: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={pill}>{row.source}</span>
                <span style={pill}>{row.confidence}</span>
                <span style={pill}>{row.is_active ? "active" : "inactive"}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>{new Date(row.updated_at).toLocaleString()}</span>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <input
                  value={row.question}
                  onChange={(e) => {
                    const next = [...rows];
                    next[idx] = { ...next[idx], question: e.target.value };
                    setRows(next);
                  }}
                  style={field}
                />
                <textarea
                  value={row.answer}
                  rows={3}
                  onChange={(e) => {
                    const next = [...rows];
                    next[idx] = { ...next[idx], answer: e.target.value };
                    setRows(next);
                  }}
                  style={field}
                />

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                  <select
                    value={row.source}
                    onChange={(e) => {
                      const next = [...rows];
                      next[idx] = { ...next[idx], source: e.target.value as KnowledgeRow["source"] };
                      setRows(next);
                    }}
                    style={field}
                  >
                    <option value="human_reply">human_reply</option>
                    <option value="manual">manual</option>
                    <option value="imported">imported</option>
                  </select>
                  <select
                    value={row.confidence}
                    onChange={(e) => {
                      const next = [...rows];
                      next[idx] = { ...next[idx], confidence: e.target.value as KnowledgeRow["confidence"] };
                      setRows(next);
                    }}
                    style={field}
                  >
                    <option value="high">high</option>
                    <option value="medium">medium</option>
                    <option value="low">low</option>
                  </select>
                  <label style={{ ...field, display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={row.is_active}
                      onChange={(e) => {
                        const next = [...rows];
                        next[idx] = { ...next[idx], is_active: e.target.checked };
                        setRows(next);
                      }}
                    />
                    Active
                  </label>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button
                    onClick={() => deleteRow(row.id)}
                    disabled={savingId === row.id}
                    style={{ ...dangerBtnStyle, opacity: savingId === row.id ? 0.6 : 1 }}
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => updateRow(row)}
                    disabled={savingId === row.id}
                    style={{ ...secondaryBtnStyle, opacity: savingId === row.id ? 0.6 : 1 }}
                  >
                    {savingId === row.id ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const field: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #d1d9e6",
  background: "white",
  color: "#111827",
  fontSize: 14,
  boxSizing: "border-box",
};

const pill: React.CSSProperties = {
  fontSize: 12,
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  color: "#475569",
  fontWeight: 600,
};
