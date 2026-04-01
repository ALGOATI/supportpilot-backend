const USAGE_SELECT_FIELDS = "id,business_id,month,ai_replies_used";

function getMonthKey(date = new Date()) {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getDateKey(date = new Date()) {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDuplicateKeyError(error) {
  if (String(error?.code || "").trim() === "23505") return true;
  const text = String(error?.message || "").toLowerCase();
  return text.includes("duplicate key") || text.includes("unique");
}

export function createUsageService({
  supabaseAdmin,
  globalDailyCallCap = Number(process.env.GLOBAL_DAILY_AI_CALL_CAP || 10000),
}) {
  async function getOrCreateMonthlyUsage({ businessId, monthKey = getMonthKey() }) {
    const query = await supabaseAdmin
      .from("usage")
      .select(USAGE_SELECT_FIELDS)
      .eq("business_id", businessId)
      .eq("month", monthKey)
      .maybeSingle();

    if (query.error) throw new Error(query.error.message);
    if (query.data) {
      return {
        id: query.data.id,
        businessId: query.data.business_id,
        month: query.data.month,
        aiRepliesUsed: Number(query.data.ai_replies_used || 0),
      };
    }

    const insertResp = await supabaseAdmin
      .from("usage")
      .insert({
        business_id: businessId,
        month: monthKey,
        ai_replies_used: 0,
      })
      .select(USAGE_SELECT_FIELDS)
      .maybeSingle();

    if (!insertResp.error && insertResp.data) {
      return {
        id: insertResp.data.id,
        businessId: insertResp.data.business_id,
        month: insertResp.data.month,
        aiRepliesUsed: Number(insertResp.data.ai_replies_used || 0),
      };
    }

    if (!insertResp.error) {
      return {
        id: null,
        businessId,
        month: monthKey,
        aiRepliesUsed: 0,
      };
    }

    if (!isDuplicateKeyError(insertResp.error)) {
      throw new Error(insertResp.error.message);
    }

    const retry = await supabaseAdmin
      .from("usage")
      .select(USAGE_SELECT_FIELDS)
      .eq("business_id", businessId)
      .eq("month", monthKey)
      .maybeSingle();

    if (retry.error) throw new Error(retry.error.message);
    return {
      id: retry.data?.id || null,
      businessId,
      month: monthKey,
      aiRepliesUsed: Number(retry.data?.ai_replies_used || 0),
    };
  }

  async function getMonthlyUsageStatus({
    businessId,
    maxMessages,
    monthKey = getMonthKey(),
  }) {
    const usage = await getOrCreateMonthlyUsage({ businessId, monthKey });
    const limit = (maxMessages !== null && maxMessages !== undefined && maxMessages > 0)
      ? maxMessages
      : null;
    const isOverLimit = limit !== null && usage.aiRepliesUsed >= limit;
    return {
      monthKey,
      usage,
      limit,
      isOverLimit,
    };
  }

  async function incrementMonthlyUsage({
    businessId,
    monthKey = getMonthKey(),
    delta = 1,
  }) {
    const safeDelta = Math.max(0, Number(delta) || 0);
    if (safeDelta === 0) {
      const current = await getOrCreateMonthlyUsage({ businessId, monthKey });
      return current.aiRepliesUsed;
    }

    const rpcResp = await supabaseAdmin.rpc("increment_usage_replies", {
      p_business_id: businessId,
      p_month: monthKey,
      p_delta: safeDelta,
    });

    if (!rpcResp.error) {
      const value = Number(rpcResp.data);
      return Number.isFinite(value) ? value : 0;
    }

    const usage = await getOrCreateMonthlyUsage({ businessId, monthKey });
    const nextValue = usage.aiRepliesUsed + safeDelta;
    const updateResp = await supabaseAdmin
      .from("usage")
      .update({ ai_replies_used: nextValue })
      .eq("business_id", businessId)
      .eq("month", monthKey);

    if (updateResp.error) throw new Error(updateResp.error.message);
    return nextValue;
  }

  async function ensureUsageRowForCurrentMonth(businessId) {
    const usage = await getOrCreateMonthlyUsage({ businessId, monthKey: getMonthKey() });
    return usage;
  }

  async function logApiCall({
    businessId = null,
    tokensUsed = 0,
    date = getDateKey(),
  }) {
    const payload = {
      business_id: businessId,
      date,
      tokens_used: Number.isFinite(Number(tokensUsed)) ? Number(tokensUsed) : 0,
    };
    const { error } = await supabaseAdmin.from("api_logs").insert(payload);
    if (error) throw new Error(error.message);
  }

  async function getGlobalDailyApiCallCount({ date = getDateKey() } = {}) {
    const query = await supabaseAdmin
      .from("api_logs")
      .select("id", { count: "exact", head: true })
      .eq("date", date)
      .gte("tokens_used", 0);

    if (query.error) throw new Error(query.error.message);
    return Number(query.count || 0);
  }

  async function isGlobalDailyCapReached({ date = getDateKey() } = {}) {
    const currentCount = await getGlobalDailyApiCallCount({ date });
    return {
      date,
      currentCount,
      cap: globalDailyCallCap,
      isReached: currentCount >= globalDailyCallCap,
    };
  }

  async function logGlobalCapAlert({ date = getDateKey() } = {}) {
    const existing = await supabaseAdmin
      .from("api_logs")
      .select("id")
      .is("business_id", null)
      .eq("date", date)
      .eq("tokens_used", -1)
      .limit(1)
      .maybeSingle();

    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.id) return false;

    const insert = await supabaseAdmin.from("api_logs").insert({
      business_id: null,
      date,
      tokens_used: -1,
    });
    if (insert.error) throw new Error(insert.error.message);
    return true;
  }

  return {
    getMonthKey,
    getDateKey,
    getOrCreateMonthlyUsage,
    getMonthlyUsageStatus,
    incrementMonthlyUsage,
    ensureUsageRowForCurrentMonth,
    logApiCall,
    getGlobalDailyApiCallCount,
    isGlobalDailyCapReached,
    logGlobalCapAlert,
  };
}
