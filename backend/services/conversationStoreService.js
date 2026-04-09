import crypto from "node:crypto";
import {
  SCHEMA_CACHE_TEXT,
  DOES_NOT_EXIST_TEXT,
} from "../config/constants.js";
import {
  detectConversationTags,
  buildConversationTitle,
  buildRuleBasedConversationTitle,
  detectConversationTopic,
  detectTopicFromTitle,
  shouldUpdateConversationTitle,
} from "./aiService.js";

/* ================================
  Conversation store: read/write helpers around the conversations,
  conversation_map, and messages tables. Includes schema-tolerant
  fallbacks for the manual_mode/ai_paused/state columns and the legacy
  buildLegacyConversations aggregator used by /api/conversations when
  the conversations table is empty.
================================ */
export function createConversationStoreService({ supabaseAdmin }) {
  const VALID_CONVERSATION_STATES = new Set([
    "idle",
    "booking_collecting",
    "booking_confirmed",
    "human_mode",
    "resolved",
  ]);

  async function getConversationByIdForUser({ userId, conversationId }) {
    const withManualMode = await supabaseAdmin
      .from("conversations")
      .select("id,status,priority,intent,manual_mode,ai_paused,state")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!withManualMode.error) {
      return withManualMode.data || null;
    }

    const errText = String(withManualMode.error.message || "").toLowerCase();
    if (!errText.includes("manual_mode") && !errText.includes("ai_paused")) {
      throw new Error(withManualMode.error.message);
    }

    const fallback = await supabaseAdmin
      .from("conversations")
      .select("id,status,priority,intent")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (fallback.error) {
      throw new Error(fallback.error.message);
    }

    return fallback.data
      ? { ...fallback.data, manual_mode: false, ai_paused: false, state: "idle" }
      : null;
  }

  async function updateConversationManualMode({
    userId,
    conversationId,
    manualMode,
    statusOverride = null,
    stateOverride = null,
    lastMessagePreview = undefined,
  }) {
    const nowIso = new Date().toISOString();
    const patch = {
      manual_mode: Boolean(manualMode),
      ai_paused: Boolean(manualMode),
      updated_at: nowIso,
    };
    if (statusOverride) patch.status = statusOverride;
    if (stateOverride && VALID_CONVERSATION_STATES.has(stateOverride)) {
      patch.state = stateOverride;
    }
    if (lastMessagePreview !== undefined) {
      patch.last_message_at = nowIso;
      patch.last_message_preview = String(lastMessagePreview || "").slice(0, 280);
    }

    let { error } = await supabaseAdmin
      .from("conversations")
      .update(patch)
      .eq("id", conversationId)
      .eq("user_id", userId);

    if (!error) return null;

    const errText = String(error.message || "").toLowerCase();
    if (!errText.includes("manual_mode") && !errText.includes("ai_paused")) return error;

    const fallbackPatch = { updated_at: nowIso };
    if (statusOverride) fallbackPatch.status = statusOverride;
    if (stateOverride && VALID_CONVERSATION_STATES.has(stateOverride)) {
      fallbackPatch.state = stateOverride;
    }
    if (lastMessagePreview !== undefined) {
      fallbackPatch.last_message_at = nowIso;
      fallbackPatch.last_message_preview = String(lastMessagePreview || "").slice(0, 280);
    }

    const retry = await supabaseAdmin
      .from("conversations")
      .update(fallbackPatch)
      .eq("id", conversationId)
      .eq("user_id", userId);

    return retry.error || null;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  async function getOrCreateConversationMap({
    userId,
    channel,
    externalConversationId,
    externalUserId,
  }) {
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("conversation_map")
      .select("conversation_id, external_conversation_id, external_user_id")
      .eq("user_id", userId)
      .eq("channel", channel)
      .eq("external_conversation_id", externalConversationId)
      .maybeSingle();

    if (existingErr) {
      throw new Error(existingErr.message);
    }

    if (existing?.conversation_id) {
      const { data: mappedConversation, error: mappedConversationErr } = await supabaseAdmin
        .from("conversations")
        .select("id")
        .eq("id", existing.conversation_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (mappedConversationErr) {
        throw new Error(mappedConversationErr.message);
      }

      if (mappedConversation?.id) {
        return {
          conversationId: existing.conversation_id,
          externalConversationId: existing.external_conversation_id,
          externalUserId: existing.external_user_id,
        };
      }

      // Auto-repair stale conversation_map row by re-linking to existing conversation thread.
      const { data: existingConversationByExternal, error: byExternalErr } = await supabaseAdmin
        .from("conversations")
        .select("id,external_user_id")
        .eq("user_id", userId)
        .eq("channel", channel)
        .eq("external_conversation_id", externalConversationId)
        .maybeSingle();

      if (byExternalErr) {
        throw new Error(byExternalErr.message);
      }

      if (existingConversationByExternal?.id) {
        const { error: repairErr } = await supabaseAdmin
          .from("conversation_map")
          .update({
            conversation_id: existingConversationByExternal.id,
            external_user_id:
              externalUserId ||
              existing.external_user_id ||
              existingConversationByExternal.external_user_id ||
              null,
          })
          .eq("user_id", userId)
          .eq("channel", channel)
          .eq("external_conversation_id", externalConversationId);

        if (repairErr) {
          throw new Error(repairErr.message);
        }

        return {
          conversationId: existingConversationByExternal.id,
          externalConversationId: existing.external_conversation_id,
          externalUserId:
            externalUserId ||
            existing.external_user_id ||
            existingConversationByExternal.external_user_id ||
            null,
        };
      }

      return {
        conversationId: existing.conversation_id,
        externalConversationId: existing.external_conversation_id,
        externalUserId: existing.external_user_id,
      };
    }

    // conversation_map missing but conversations row may already exist for this external thread.
    const { data: existingConversationByExternal, error: byExternalErr } = await supabaseAdmin
      .from("conversations")
      .select("id,external_user_id")
      .eq("user_id", userId)
      .eq("channel", channel)
      .eq("external_conversation_id", externalConversationId)
      .maybeSingle();

    if (byExternalErr) {
      throw new Error(byExternalErr.message);
    }

    if (existingConversationByExternal?.id) {
      const { error: linkErr } = await supabaseAdmin.from("conversation_map").upsert(
        {
          user_id: userId,
          channel,
          external_conversation_id: externalConversationId,
          conversation_id: existingConversationByExternal.id,
          external_user_id:
            externalUserId || existingConversationByExternal.external_user_id || null,
        },
        { onConflict: "user_id,channel,external_conversation_id" }
      );

      if (linkErr) {
        throw new Error(linkErr.message);
      }

      return {
        conversationId: existingConversationByExternal.id,
        externalConversationId,
        externalUserId:
          externalUserId || existingConversationByExternal.external_user_id || null,
      };
    }

    const conversationId = crypto.randomUUID();
    const { error: insertErr } = await supabaseAdmin.from("conversation_map").insert({
      user_id: userId,
      channel,
      external_conversation_id: externalConversationId,
      conversation_id: conversationId,
      external_user_id: externalUserId || null,
    });

    if (insertErr) {
      throw new Error(insertErr.message);
    }

    return {
      conversationId,
      externalConversationId,
      externalUserId: externalUserId || null,
    };
  }
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async function upsertConversationRecord({
    userId,
    conversationId,
    channel,
    externalConversationId = null,
    externalUserId = null,
    firstMessage,
    lastMessagePreview,
    extractedData,
    statusOverride = null,
    priorityOverride = null,
    intentOverride = null,
    stateOverride = null,
  }) {
    const now = new Date().toISOString();
    const { intent, priority } = detectConversationTags({
      extractedData,
      text: firstMessage,
    });

    let existing = null;
    const withAutomationColumns = await supabaseAdmin
      .from("conversations")
      .select(
        "id, title, status, priority, intent, external_conversation_id, external_user_id, manual_mode, ai_paused, state"
      )
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (withAutomationColumns.error) {
      const errText = String(withAutomationColumns.error.message || "").toLowerCase();
      const canFallback =
        errText.includes("manual_mode") ||
        errText.includes("ai_paused") ||
        errText.includes("state") ||
        errText.includes(SCHEMA_CACHE_TEXT) ||
        errText.includes(DOES_NOT_EXIST_TEXT);

      if (!canFallback) {
        throw new Error(withAutomationColumns.error.message);
      }

      const fallback = await supabaseAdmin
        .from("conversations")
        .select(
          "id, title, status, priority, intent, external_conversation_id, external_user_id"
        )
        .eq("id", conversationId)
        .eq("user_id", userId)
        .maybeSingle();

      if (fallback.error) {
        throw new Error(fallback.error.message);
      }

      existing = fallback.data
        ? {
            ...fallback.data,
            manual_mode: false,
            ai_paused: false,
            state: "idle",
          }
        : null;
    } else {
      existing = withAutomationColumns.data || null;
    }

    const ruleTitle = buildRuleBasedConversationTitle({
      text: firstMessage,
      extractedData,
    });
    const fallbackTitle = buildConversationTitle({
      channel,
      externalUserId,
      firstMessage,
    });
    const proposedTitle = ruleTitle || fallbackTitle;
    const previousTopic = detectTopicFromTitle(existing?.title || "");
    const nextTopic = detectConversationTopic({
      text: firstMessage,
      extractedData,
    });
    const title = shouldUpdateConversationTitle({
      existingTitle: existing?.title,
      proposedTitle,
      channel,
      previousTopic,
      nextTopic,
    })
      ? proposedTitle
      : existing?.title || proposedTitle;

    const computedPriority =
      existing?.priority === "high" || priority === "high"
        ? "high"
        : existing?.priority || priority;

    let normalizedState = "idle";
    if (stateOverride && VALID_CONVERSATION_STATES.has(stateOverride)) {
      normalizedState = stateOverride;
    } else if (VALID_CONVERSATION_STATES.has(existing?.state)) {
      normalizedState = existing.state;
    }
    const shouldPauseAi =
      existing?.ai_paused === true ||
      existing?.manual_mode === true ||
      statusOverride === "escalated";

    let resolvedIntent = intent;
    const isValidIntentOverride =
      intentOverride === "booking" ||
      intentOverride === "faq" ||
      intentOverride === "complaint" ||
      intentOverride === "other";
    if (isValidIntentOverride) {
      resolvedIntent = intentOverride;
    } else if (existing?.intent === "booking") {
      resolvedIntent = "booking";
    }

    const basePayload = {
      id: conversationId,
      user_id: userId,
      channel,
      external_conversation_id:
        externalConversationId || existing?.external_conversation_id || null,
      external_user_id: externalUserId || existing?.external_user_id || null,
      title,
      status: statusOverride || existing?.status || "open",
      last_message_at: now,
      last_message_preview: String(lastMessagePreview || "").slice(0, 280),
      intent: resolvedIntent,
      priority: priorityOverride || computedPriority,
      manual_mode: existing?.manual_mode === true,
      ai_paused: shouldPauseAi,
      updated_at: now,
    };

    let upsertPayload = {
      ...basePayload,
      state: normalizedState,
    };

    let { error: upsertErr } = await supabaseAdmin
      .from("conversations")
      .upsert(upsertPayload, { onConflict: "id" });

    if (upsertErr) {
      const errText = String(upsertErr.message || "").toLowerCase();
      if (
        !errText.includes("state") &&
        !errText.includes("ai_paused") &&
        !errText.includes("manual_mode")
      ) {
        throw new Error(upsertErr.message);
      }
      upsertPayload = { ...basePayload };
      if (errText.includes("ai_paused")) {
        delete upsertPayload.ai_paused;
      }
      if (errText.includes("manual_mode")) {
        delete upsertPayload.manual_mode;
      }
      const retry = await supabaseAdmin
        .from("conversations")
        .upsert(upsertPayload, { onConflict: "id" });
      upsertErr = retry.error;
      if (upsertErr) {
        throw new Error(upsertErr.message);
      }
    }
  }

  async function buildLegacyConversations(userId) {
    let rows = null;
    let error = null;

    const withHumanReply = await supabaseAdmin
      .from("messages")
      .select(
        "id,created_at,channel,conversation_id,customer_message,ai_reply,human_reply,extracted_data"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (withHumanReply.error && String(withHumanReply.error.message || "").includes("human_reply")) {
      const fallback = await supabaseAdmin
        .from("messages")
        .select(
          "id,created_at,channel,conversation_id,customer_message,ai_reply,extracted_data"
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(500);
      rows = (fallback.data || []).map((row) => ({ ...row, human_reply: null }));
      error = fallback.error;
    } else {
      rows = withHumanReply.data || [];
      error = withHumanReply.error;
    }

    if (error) {
      throw new Error(error.message);
    }

    const conversationIds = Array.from(
      new Set((rows || []).map((r) => r.conversation_id).filter(Boolean))
    );

    const { data: maps, error: mapsErr } = conversationIds.length
      ? await supabaseAdmin
          .from("conversation_map")
          .select("conversation_id, external_conversation_id, external_user_id")
          .eq("user_id", userId)
          .in("conversation_id", conversationIds)
      : { data: [], error: null };

    if (mapsErr) {
      throw new Error(mapsErr.message);
    }

    const mapByConversation = new Map();
    for (const row of maps || []) {
      if (!mapByConversation.has(row.conversation_id)) {
        mapByConversation.set(row.conversation_id, row);
      }
    }

    const grouped = new Map();
    for (const row of rows || []) {
      const cid = row.conversation_id ?? `no-convo:${row.id}`;
      if (!grouped.has(cid)) {
        const mapRow = mapByConversation.get(row.conversation_id);
        const extractedData = row.extracted_data || null;
        const { intent, priority } = detectConversationTags({
          extractedData,
          text: row.customer_message || row.ai_reply || row.human_reply || "",
        });

        grouped.set(cid, {
          id: cid,
          user_id: userId,
          channel: row.channel,
          external_conversation_id: mapRow?.external_conversation_id || null,
          external_user_id: mapRow?.external_user_id || null,
          title: buildConversationTitle({
            channel: row.channel,
            externalUserId: mapRow?.external_user_id || null,
            firstMessage: row.customer_message || row.ai_reply || row.human_reply || "",
          }),
          status: "open",
          state: "idle",
          last_message_at: row.created_at,
          last_message_preview: row.customer_message || row.ai_reply || row.human_reply || "—",
          intent,
          priority,
          manual_mode: false,
          created_at: row.created_at,
          updated_at: row.created_at,
        });
      }
    }

    return Array.from(grouped.values()).sort(
      (a, b) => +new Date(b.last_message_at) - +new Date(a.last_message_at)
    );
  }

  return {
    VALID_CONVERSATION_STATES,
    getConversationByIdForUser,
    updateConversationManualMode,
    getOrCreateConversationMap,
    upsertConversationRecord,
    buildLegacyConversations,
  };
}
