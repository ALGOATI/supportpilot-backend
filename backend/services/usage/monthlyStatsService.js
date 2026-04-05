function getMonthKey(date = new Date()) {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function createMonthlyStatsService({ supabaseAdmin }) {
  async function incrementMonthlyStat({ businessId, statName, delta = 1 }) {
    if (!businessId || !statName) return;
    const safeDelta = Math.max(0, Number(delta) || 0);
    if (safeDelta === 0) return;

    const { error: rpcErr } = await supabaseAdmin.rpc("increment_monthly_stat", {
      biz_id: businessId,
      stat_name: statName,
      increment_by: safeDelta,
    });

    if (rpcErr) {
      console.error("[MonthlyStats] RPC increment failed, falling back to upsert:", rpcErr.message);
      await fallbackUpsert({ businessId, statName, delta: safeDelta });
    }
  }

  async function fallbackUpsert({ businessId, statName, delta }) {
    const monthKey = getMonthKey();
    const { data: existing } = await supabaseAdmin
      .from("monthly_stats")
      .select("id," + statName)
      .eq("business_id", businessId)
      .eq("month", monthKey)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from("monthly_stats")
        .update({
          [statName]: (Number(existing[statName]) || 0) + delta,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin
        .from("monthly_stats")
        .insert({
          business_id: businessId,
          month: monthKey,
          [statName]: delta,
        });
    }
  }

  async function getMonthlyStats({ businessId, monthKey = getMonthKey() }) {
    const { data, error } = await supabaseAdmin
      .from("monthly_stats")
      .select("*")
      .eq("business_id", businessId)
      .eq("month", monthKey)
      .maybeSingle();

    if (error) throw new Error(error.message);
    const stats = data || {
      ai_conversations_handled: 0,
      ai_messages_sent: 0,
      human_escalations: 0,
      total_inbound_messages: 0,
      avg_response_time_ms: 0,
      total_response_time_ms: 0,
      response_time_count: 0,
    };
    // Compute avg from running totals (overrides the stored column)
    const totalMs = Number(stats.total_response_time_ms) || 0;
    const count = Number(stats.response_time_count) || 0;
    stats.avg_response_time_ms = count > 0 ? Math.round(totalMs / count) : 0;
    return stats;
  }

  function computeDerivedStats(stats) {
    const aiConversations = stats.ai_conversations_handled || 0;
    const escalations = stats.human_escalations || 0;
    const aiMessages = stats.ai_messages_sent || 0;
    const resolutionRate = aiConversations > 0
      ? Math.round(((aiConversations - escalations) / aiConversations) * 100)
      : 0;
    const hoursSaved = Math.round((aiMessages * 2) / 60 * 10) / 10; // 2 min per message
    return { resolutionRate, hoursSaved };
  }

  async function getMonthlyStatsWithComparison({ businessId }) {
    const now = new Date();
    const currentMonthKey = getMonthKey(now);
    const prevDate = new Date(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
    const prevMonthKey = getMonthKey(prevDate);

    const [current, previous] = await Promise.all([
      getMonthlyStats({ businessId, monthKey: currentMonthKey }),
      getMonthlyStats({ businessId, monthKey: prevMonthKey }),
    ]);

    const currentDerived = computeDerivedStats(current);
    const prevDerived = computeDerivedStats(previous);

    return {
      current_month: currentMonthKey,
      previous_month: prevMonthKey,
      ai_conversations_handled: current.ai_conversations_handled || 0,
      ai_messages_sent: current.ai_messages_sent || 0,
      human_escalations: current.human_escalations || 0,
      total_inbound_messages: current.total_inbound_messages || 0,
      ai_resolution_rate: currentDerived.resolutionRate,
      hours_saved: currentDerived.hoursSaved,
      avg_response_time_ms: current.avg_response_time_ms || 0,
      prev_ai_conversations_handled: previous.ai_conversations_handled || 0,
      prev_ai_messages_sent: previous.ai_messages_sent || 0,
      prev_human_escalations: previous.human_escalations || 0,
      prev_ai_resolution_rate: prevDerived.resolutionRate,
      prev_hours_saved: prevDerived.hoursSaved,
      prev_avg_response_time_ms: previous.avg_response_time_ms || 0,
    };
  }

  async function getMonthlyReport({ businessId, monthKey }) {
    const targetMonth = monthKey || getMonthKey();
    const [year, month] = targetMonth.split("-").map(Number);
    const prevDate = new Date(Date.UTC(year, month - 2, 1));
    const prevMonthKey = getMonthKey(prevDate);

    const [current, previous] = await Promise.all([
      getMonthlyStats({ businessId, monthKey: targetMonth }),
      getMonthlyStats({ businessId, monthKey: prevMonthKey }),
    ]);

    const currentDerived = computeDerivedStats(current);
    const prevDerived = computeDerivedStats(previous);

    const hasPreviousData = (previous.ai_conversations_handled || 0) > 0;

    const comparisons = hasPreviousData ? {
      conversations_change: (current.ai_conversations_handled || 0) - (previous.ai_conversations_handled || 0),
      conversations_change_pct: (previous.ai_conversations_handled || 0) > 0
        ? Math.round(((current.ai_conversations_handled - previous.ai_conversations_handled) / previous.ai_conversations_handled) * 100)
        : null,
      resolution_rate_change: currentDerived.resolutionRate - prevDerived.resolutionRate,
      hours_saved_change: Math.round((currentDerived.hoursSaved - prevDerived.hoursSaved) * 10) / 10,
      escalations_change: (current.human_escalations || 0) - (previous.human_escalations || 0),
    } : null;

    return {
      month: targetMonth,
      previous_month: prevMonthKey,
      has_previous_data: hasPreviousData,
      ai_conversations_handled: current.ai_conversations_handled || 0,
      ai_messages_sent: current.ai_messages_sent || 0,
      human_escalations: current.human_escalations || 0,
      ai_resolution_rate: currentDerived.resolutionRate,
      hours_saved: currentDerived.hoursSaved,
      avg_response_time_ms: current.avg_response_time_ms || 0,
      comparisons,
    };
  }

  return {
    getMonthKey,
    incrementMonthlyStat,
    getMonthlyStats,
    getMonthlyStatsWithComparison,
    getMonthlyReport,
  };
}
