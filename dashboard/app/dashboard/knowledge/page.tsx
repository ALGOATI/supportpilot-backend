"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import DashboardShell from "../_components/DashboardShell";

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

export default function KnowledgePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rows, setRows] = useState<KnowledgeRow[]>([]);
  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");

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

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  async function addManualEntry() {
    const question = newQuestion.trim();
    const answer = newAnswer.trim();
    if (!question || !answer) return;

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
    } catch (e) {
      console.error(e);
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
    } catch (e) {
      console.error(e);
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
    } catch (e) {
      console.error(e);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <DashboardShell title="Knowledge Base" subtitle="Learned and manual business answers">
      <div style={{ maxWidth: 980 }}>
      <div style={{ marginTop: 16, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 12, background: "white" }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Add manual knowledge</h2>
        <div style={{ display: "grid", gap: 10 }}>
          <input
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder="Question"
            style={field}
          />
          <textarea
            value={newAnswer}
            onChange={(e) => setNewAnswer(e.target.value)}
            placeholder="Answer"
            rows={3}
            style={field}
          />
          <button onClick={addManualEntry} disabled={savingId === "new"} style={actionBtn}>
            {savingId === "new" ? "Saving..." : "Add entry"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {loading ? (
          <p>Loading...</p>
        ) : rows.length === 0 ? (
          <p>No knowledge entries yet.</p>
        ) : (
          rows.map((row, idx) => (
            <div key={row.id} style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 12, background: "white" }}>
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

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
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

                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => updateRow(row)} disabled={savingId === row.id} style={actionBtn}>
                    {savingId === row.id ? "Saving..." : "Save"}
                  </button>
                  <button onClick={() => deleteRow(row.id)} disabled={savingId === row.id} style={dangerBtn}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      </div>
    </DashboardShell>
  );
}

const field: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(0,0,0,0.15)",
  background: "white",
  color: "#111827",
};

const actionBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid rgba(0,0,0,0.15)",
  background: "white",
  cursor: "pointer",
  fontWeight: 700,
};

const dangerBtn: React.CSSProperties = {
  ...actionBtn,
  color: "#b91c1c",
};

const pill: React.CSSProperties = {
  fontSize: 12,
  padding: "2px 8px",
  borderRadius: 999,
  border: "1px solid rgba(0,0,0,0.12)",
  background: "#f8fafc",
};
