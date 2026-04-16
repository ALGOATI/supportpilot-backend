import { getPlanLimits } from "../config/modelRouting.js";
import { getPlanDefaults } from "../config/planConfig.js";
import { SCHEMA_CACHE_TEXT, DOES_NOT_EXIST_TEXT } from "../config/constants.js";

/**
 * Plan + monthly-usage helpers. Bundled together because they all share
 * the same supabaseAdmin closure and call into one another.
 */
export function createPlanService({ supabaseAdmin }) {
  function countMessageChars(text) {
    return Array.from(String(text || "")).length;
  }

  function getMessageLimitForPlan(plan) {
    return getPlanLimits(plan).maxMessageChars;
  }

  function getMessageLengthValidation({ text, plan }) {
    const maxMessageChars = getMessageLimitForPlan(plan);
    const messageLength = countMessageChars(text);
    return {
      maxMessageChars,
      messageLength,
      isTooLong: messageLength > maxMessageChars,
    };
  }

  function buildMessageTooLongPayload(maxMessageChars) {
    return {
      error: "Please shorten your message.",
      code: "message_too_long",
      maxMessageChars,
    };
  }

  function getMonthStartIso(date = new Date()) {
    const d = new Date(date);
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }

  function getUsageMonthKey(date = new Date()) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) {
      return getUsageMonthKey(new Date());
    }
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }

  function getUsageMonthKeyFromMonthStartIso(monthStartIso) {
    if (!monthStartIso) return getUsageMonthKey(new Date());
    const parsed = new Date(monthStartIso);
    if (Number.isNaN(parsed.getTime())) return getUsageMonthKey(new Date());
    return getUsageMonthKey(parsed);
  }

  function isMissingClientUsageSchemaError(error) {
    const text = String(error?.message || "").toLowerCase();
    return (
      text.includes("client_usage") ||
      text.includes("increment_client_usage") ||
      text.includes(SCHEMA_CACHE_TEXT) ||
      text.includes(DOES_NOT_EXIST_TEXT)
    );
  }

  function isDuplicateKeyError(error) {
    if (String(error?.code || "").trim() === "23505") return true;
    const text = String(error?.message || "").toLowerCase();
    return text.includes("duplicate key") || text.includes("unique");
  }

  async function countMonthlyAiConversationsFromMessages(
    userId,
    monthStartIso = getMonthStartIso()
  ) {
    const buildMonthlyMessagesQuery = (columns) =>
      supabaseAdmin
        .from("messages")
        .select(columns)
        .eq("user_id", userId)
        .gte("created_at", monthStartIso)
        .not("ai_reply", "is", null)
        .neq("ai_reply", "");

    let rows = [];
    const withModel = await buildMonthlyMessagesQuery("conversation_id,model_used")
      .limit(10000);
    if (withModel.error) {
      const errText = String(withModel.error.message || "").toLowerCase();
      const canFallback =
        errText.includes("model_used") ||
        errText.includes(SCHEMA_CACHE_TEXT) ||
        errText.includes(DOES_NOT_EXIST_TEXT);

      if (!canFallback) {
        throw new Error(withModel.error.message);
      }

      const fallback = await buildMonthlyMessagesQuery("conversation_id").limit(10000);
      if (fallback.error) throw new Error(fallback.error.message);
      rows = (fallback.data || []).map((row) => ({ ...row, model_used: null }));
    } else {
      rows = withModel.data || [];
    }

    const set = new Set();
    for (const row of rows || []) {
      const conversationId = String(row?.conversation_id || "").trim();
      if (!conversationId) continue;
      set.add(conversationId);
    }
    return set.size;
  }

  async function getMonthlyUsageSnapshot({
    userId,
    monthKey = getUsageMonthKey(new Date()),
    fallbackMonthStartIso = getMonthStartIso(new Date()),
  }) {
    const usageRow = await supabaseAdmin
      .from("client_usage")
      .select("conversations_used")
      .eq("client_id", userId)
      .eq("month", monthKey)
      .maybeSingle();

    if (!usageRow.error) {
      return Number(usageRow.data?.conversations_used || 0);
    }

    if (!isMissingClientUsageSchemaError(usageRow.error)) {
      throw new Error(usageRow.error.message);
    }

    return countMonthlyAiConversationsFromMessages(userId, fallbackMonthStartIso);
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async function reserveConversationUsageAndIncrement({
    userId,
    conversationId,
    monthKey = getUsageMonthKey(new Date()),
  }) {
    if (!userId || !conversationId) return null;

    const dedupeInsert = await supabaseAdmin
      .from("client_usage_conversations")
      .insert({
        client_id: userId,
        month: monthKey,
        conversation_id: conversationId,
      });

    if (dedupeInsert.error) {
      if (isDuplicateKeyError(dedupeInsert.error)) {
        return getMonthlyUsageSnapshot({
          userId,
          monthKey,
          fallbackMonthStartIso: getMonthStartIso(new Date(`${monthKey}-01T00:00:00.000Z`)),
        });
      }

      if (!isMissingClientUsageSchemaError(dedupeInsert.error)) {
        throw new Error(dedupeInsert.error.message);
      }

      return null;
    }

    const incrementResp = await supabaseAdmin.rpc("increment_client_usage", {
      p_client_id: userId,
      p_month: monthKey,
      p_delta: 1,
    });

    if (!incrementResp.error) {
      const value = Number(incrementResp.data);
      return Number.isFinite(value) ? value : null;
    }

    if (!isMissingClientUsageSchemaError(incrementResp.error)) {
      throw new Error(incrementResp.error.message);
    }

    const existingUsage = await supabaseAdmin
      .from("client_usage")
      .select("id,conversations_used")
      .eq("client_id", userId)
      .eq("month", monthKey)
      .maybeSingle();

    if (existingUsage.error && !isMissingClientUsageSchemaError(existingUsage.error)) {
      throw new Error(existingUsage.error.message);
    }

    if (existingUsage.data?.id) {
      const nextCount = Number(existingUsage.data.conversations_used || 0) + 1;
      const updateResp = await supabaseAdmin
        .from("client_usage")
        .update({ conversations_used: nextCount })
        .eq("id", existingUsage.data.id)
        .eq("client_id", userId);
      if (updateResp.error && !isMissingClientUsageSchemaError(updateResp.error)) {
        throw new Error(updateResp.error.message);
      }
      return nextCount;
    }

    const insertResp = await supabaseAdmin.from("client_usage").insert({
      client_id: userId,
      month: monthKey,
      conversations_used: 1,
    });
    if (insertResp.error && !isMissingClientUsageSchemaError(insertResp.error)) {
      throw new Error(insertResp.error.message);
    }
    return 1;
  }

  async function countMonthlyAiConversations(userId, monthStartIso = getMonthStartIso()) {
    const monthKey = getUsageMonthKeyFromMonthStartIso(monthStartIso);
    return getMonthlyUsageSnapshot({
      userId,
      monthKey,
      fallbackMonthStartIso: monthStartIso,
    });
  }

  async function loadUserPlan(userId) {
    const { data, error } = await supabaseAdmin
      .from("client_settings")
      .select("plan")
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && data?.plan) return data.plan;
    return "starter";
  }

  async function isBusinessActive(userId) {
    const { data: biz, error } = await supabaseAdmin
      .from("client_settings")
      .select("user_id, plan, subscription_status")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return { active: false, reason: `Database error: ${error.message}` };
    }
    if (!biz) {
      return { active: false, reason: "Business not found" };
    }

    const status = String(biz.subscription_status || "active").toLowerCase();
    const blockedStatuses = new Set(["canceled", "unpaid", "incomplete_expired"]);
    if (blockedStatuses.has(status)) {
      return { active: false, reason: `Subscription ${status}` };
    }

    const maxMessages = getPlanDefaults(biz.plan).max_messages;
    if (maxMessages && maxMessages > 0) {
      const monthKey = new Date().toISOString().slice(0, 7);
      const { data: usage } = await supabaseAdmin
        .from("usage")
        .select("ai_replies_used")
        .eq("business_id", userId)
        .eq("month", monthKey)
        .maybeSingle();

      if (usage && usage.ai_replies_used >= maxMessages) {
        return { active: false, reason: "Monthly message limit reached" };
      }
    }

    return { active: true, reason: null };
  }

  async function loadBusinessMaxMessages(userId) {
    const plan = await loadUserPlan(userId);
    return getPlanDefaults(plan).max_messages;
  }

  return {
    countMessageChars,
    getMessageLimitForPlan,
    getMessageLengthValidation,
    buildMessageTooLongPayload,
    getMonthStartIso,
    getUsageMonthKey,
    getUsageMonthKeyFromMonthStartIso,
    isMissingClientUsageSchemaError,
    isDuplicateKeyError,
    countMonthlyAiConversationsFromMessages,
    getMonthlyUsageSnapshot,
    reserveConversationUsageAndIncrement,
    countMonthlyAiConversations,
    loadUserPlan,
    loadBusinessMaxMessages,
    isBusinessActive,
  };
}
