function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTokens(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2);
}

function scoreSimilarity(question, message) {
  const questionTokens = getTokens(question);
  const messageTokens = new Set(getTokens(message));
  if (!questionTokens.length || messageTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of questionTokens) {
    if (messageTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(questionTokens.length, 1);
}

function escapeIlikePattern(value) {
  return String(value || "").replace(/[\\%_]/g, "\\$&");
}

export function createKnowledgeService({ supabaseAdmin }) {
  async function loadKnowledgeBase(businessId, options = {}) {
    const activeOnly = options.activeOnly !== false;
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 200));

    let query = supabaseAdmin
      .from("knowledge_base")
      .select("id,business_id,user_id,question,answer,source,is_active,updated_at")
      .eq("business_id", businessId)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (activeOnly) {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;
    if (!error) return Array.isArray(data) ? data : [];

    // Fallback for older schemas that do not have is_active.
    if (String(error.message || "").toLowerCase().includes("is_active")) {
      const fallback = await supabaseAdmin
        .from("knowledge_base")
        .select("id,business_id,user_id,question,answer,source,updated_at")
        .eq("business_id", businessId)
        .order("updated_at", { ascending: false })
        .limit(limit);

      if (fallback.error) throw new Error(fallback.error.message);
      return (fallback.data || []).map((row) => ({ ...row, is_active: true }));
    }

    throw new Error(error.message);
  }

  function findBestLocalMatch(rows, message) {
    const normalizedMessage = normalizeText(message);
    if (!normalizedMessage) return null;

    const list = Array.isArray(rows) ? rows : [];
    const exact = list.find((row) => normalizeText(row?.question) === normalizedMessage);
    if (exact) return { row: exact, matchType: "exact" };

    const contains = list.find((row) => {
      const normalizedQuestion = normalizeText(row?.question);
      if (!normalizedQuestion) return false;
      if (normalizedQuestion.length < 6) return false;
      return (
        normalizedMessage.includes(normalizedQuestion) ||
        normalizedQuestion.includes(normalizedMessage)
      );
    });
    if (contains) return { row: contains, matchType: "contains" };

    const ranked = list
      .map((row) => ({ row, score: scoreSimilarity(row?.question, message) }))
      .filter((entry) => entry.score >= 0.7)
      .sort((a, b) => b.score - a.score);

    if (ranked.length > 0) return { row: ranked[0].row, matchType: "similarity" };
    return null;
  }

  async function findCachedAnswer({ businessId, message, prefetchedRows = null }) {
    const localRows = Array.isArray(prefetchedRows)
      ? prefetchedRows
      : await loadKnowledgeBase(businessId, { activeOnly: true, limit: 300 });

    const localMatch = findBestLocalMatch(localRows, message);
    if (localMatch?.row?.answer) {
      return {
        id: localMatch.row.id,
        answer: String(localMatch.row.answer),
        source: String(localMatch.row.source || "manual"),
        matchType: localMatch.matchType,
      };
    }

    const messageText = String(message || "").trim();
    if (!messageText) return null;

    const directSearch = escapeIlikePattern(messageText.slice(0, 120));
    const ilike = await supabaseAdmin
      .from("knowledge_base")
      .select("id,answer,source")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .ilike("question", `%${directSearch}%`)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let ilikeData = ilike.data;
    if (ilike.error) {
      if (!String(ilike.error.message || "").toLowerCase().includes("is_active")) {
        throw new Error(ilike.error.message);
      }
      const fallback = await supabaseAdmin
        .from("knowledge_base")
        .select("id,answer,source")
        .eq("business_id", businessId)
        .ilike("question", `%${directSearch}%`)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (fallback.error) throw new Error(fallback.error.message);
      ilikeData = fallback.data;
    }

    if (ilikeData?.answer) {
      return {
        id: ilikeData.id,
        answer: String(ilikeData.answer),
        source: String(ilikeData.source || "manual"),
        matchType: "ilike",
      };
    }

    return null;
  }

  async function learnFromOwnerReply({ businessId, question, answer }) {
    const cleanQuestion = String(question || "").trim();
    const cleanAnswer = String(answer || "").trim();
    if (!cleanQuestion || !cleanAnswer) {
      return { learned: false, reason: "missing_input", knowledgeId: null };
    }

    const normalizedQuestion = normalizeText(cleanQuestion);
    const existing = await supabaseAdmin
      .from("knowledge_base")
      .select("id,question")
      .eq("business_id", businessId)
      .order("updated_at", { ascending: false })
      .limit(300);

    if (existing.error) throw new Error(existing.error.message);
    const existingRows = Array.isArray(existing.data) ? existing.data : [];
    const match = existingRows.find(
      (row) => normalizeText(row?.question) === normalizedQuestion
    );

    const nowIso = new Date().toISOString();
    if (match?.id) {
      const update = await supabaseAdmin
        .from("knowledge_base")
        .update({
          answer: cleanAnswer,
          source: "learned",
          business_id: businessId,
          user_id: businessId,
          confidence: "high",
          is_active: true,
          updated_at: nowIso,
        })
        .eq("id", match.id)
        .eq("business_id", businessId);

      if (update.error) throw new Error(update.error.message);
      return { learned: true, reason: "updated_existing", knowledgeId: match.id };
    }

    const insert = await supabaseAdmin
      .from("knowledge_base")
      .insert({
        business_id: businessId,
        user_id: businessId,
        question: cleanQuestion,
        answer: cleanAnswer,
        source: "learned",
        confidence: "high",
        tags: [],
        is_active: true,
        updated_at: nowIso,
      })
      .select("id")
      .maybeSingle();

    if (insert.error) throw new Error(insert.error.message);
    return {
      learned: true,
      reason: "inserted",
      knowledgeId: insert.data?.id || null,
    };
  }

  return {
    normalizeText,
    loadKnowledgeBase,
    findCachedAnswer,
    learnFromOwnerReply,
  };
}
