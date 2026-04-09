/* ================================
  Analytics overview: aggregates 7-day messages, conversations, channels,
  bookings, escalations, response times, and token/cost totals.
================================ */
export function createAnalyticsService({ supabaseAdmin }) {
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async function buildAnalyticsOverview(userId) {
    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startOf7d = new Date(startOfToday);
    startOf7d.setUTCDate(startOf7d.getUTCDate() - 6);

    const { data: messageRows, error: messageErr } = await supabaseAdmin
      .from("messages")
      .select(
        "id,created_at,channel,conversation_id,customer_message,ai_reply,total_tokens,estimated_cost_usd"
      )
      .eq("user_id", userId)
      .gte("created_at", startOf7d.toISOString())
      .order("created_at", { ascending: true })
      .limit(5000);

    if (messageErr) throw new Error(messageErr.message);

    const { data: conversationRows, error: conversationErr } = await supabaseAdmin
      .from("conversations")
      .select("id,channel,intent,status,created_at,last_message_at")
      .eq("user_id", userId)
      .gte("last_message_at", startOf7d.toISOString())
      .limit(5000);

    if (conversationErr) throw new Error(conversationErr.message);

    const rows = messageRows || [];
    const conversations = conversationRows || [];
    const byChannelMap = new Map();
    let messagesToday = 0;
    let messages7d = rows.length;
    let totalTokens7d = 0;
    let estimatedCost7d = 0;
    let hasAnyCost = false;
    let responsePairs = 0;
    let responseTimeTotal = 0;

    for (const row of rows) {
      const createdAt = new Date(row.created_at);
      if (createdAt >= startOfToday) messagesToday++;
      byChannelMap.set(row.channel, (byChannelMap.get(row.channel) || 0) + 1);
      if (Number.isFinite(Number(row.total_tokens))) {
        totalTokens7d += Number(row.total_tokens);
      }
      if (row.estimated_cost_usd !== null && row.estimated_cost_usd !== undefined) {
        estimatedCost7d += Number(row.estimated_cost_usd) || 0;
        hasAnyCost = true;
      }
    }

    const convoToday = conversations.filter(
      (row) => new Date(row.created_at) >= startOfToday
    ).length;
    const bookings7d = conversations.filter((row) => row.intent === "booking").length;
    const escalated7d = conversations.filter((row) => row.status === "escalated").length;

    const groupedMessages = new Map();
    for (const row of rows) {
      const key = row.conversation_id || `row:${row.id}`;
      if (!groupedMessages.has(key)) groupedMessages.set(key, []);
      groupedMessages.get(key).push(row);
    }

    for (const convoRows of groupedMessages.values()) {
      let pendingCustomerAt = null;
      for (const row of convoRows) {
        const createdMs = new Date(row.created_at).getTime();
        if (row.customer_message) {
          pendingCustomerAt = createdMs;
        }
        if (row.ai_reply && !row.customer_message && pendingCustomerAt !== null) {
          responseTimeTotal += Math.max(0, createdMs - pendingCustomerAt);
          responsePairs++;
          pendingCustomerAt = null;
        }
      }
    }

    return {
      messages_today: messagesToday,
      messages_7d: messages7d,
      conversations_today: convoToday,
      conversations_7d: conversations.length,
      by_channel: Array.from(byChannelMap.entries()).map(([channel, count]) => ({
        channel,
        count,
      })),
      bookings_7d: bookings7d,
      escalated_7d: escalated7d,
      avg_response_time_ms:
        responsePairs > 0 ? Math.round(responseTimeTotal / responsePairs) : null,
      total_tokens_7d: totalTokens7d || null,
      estimated_cost_usd_7d: hasAnyCost
        ? Number(estimatedCost7d.toFixed(6))
        : null,
    };
  }

  return {
    buildAnalyticsOverview,
  };
}
