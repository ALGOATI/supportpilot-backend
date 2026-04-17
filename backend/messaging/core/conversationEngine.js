import { normalizeBookingExtractionDate } from "../../utils/dateNormalization.js";
import crypto from "crypto";

export function createConversationEngine(deps) {
  const {
    supabaseAdmin,
    loadBusinessTimezone,
    loadStructuredBusinessKnowledge,
    loadKnowledgeBaseForPrompt,
    getActiveBookingDraft,
    buildActiveBookingDraftContext,
    normalizeBusinessType,
    buildIndustryTemplateGuidance,
    styleRules,
    getPreferredLanguagePromptHint,
    getUsageFromOpenRouterResponse,
    estimateCostUsd,
    extractStructuredData,
    EMPTY_EXTRACTION,
    getOrCreateConversationMap,
    getConversationByIdForUser,
    insertMessageWithFallback,
    upsertConversationRecord,
    detectFlowIntentOverride,
    detectPreferredReplyLanguage,
    saveConversationPreferredLanguage,
    loadConversationPreferredLanguage,
    loadUserPlan,
    loadBusinessMaxMessages,
    getPlanLimits,
    getModelForTask,
    getModelsForPlan,
    getMonthStartIso,
    countMonthlyAiConversations,
    reserveConversationUsageAndIncrement,
    getUsageMonthKey,
    tryDirectKnowledgeAnswer,
    evaluateResponseSafety,
    createEscalationNotification,
    shouldTreatMessageAsBookingStart,
    isBookingCorrectionMessage,
    isBookingCancellationRequest,
    hasAnyBookingDraftField,
    upsertBookingDraft,
    isBookingConfirmationMessage,
    finalizeBookingDraft,
    isNewBookingRequest,
    ESCALATION_REPLY_MESSAGE,
    maybeForwardPausedInboundToOwner,
    incrementMonthlyStat,
    syncBookingToCalendar,
  } = deps;

  function getTodayIsoDateInTimezone(timeZone) {
    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: timeZone || "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      return formatter.format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }

  // Maps plan name to model-routing tier for quality-of-service params only.
  // NOT used for billing limits — those are derived from planConfig.js.
  function mapPlanToTier(plan) {
    const p = String(plan || "").trim().toLowerCase();
    if (p === "pro") return "pro";
    if (p === "enterprise" || p === "business") return "enterprise";
    return "starter"; // trial, starter, standard, basic, etc.
  }

  function getRoutedModel(plan, task) {
    if (typeof getModelForTask === "function") {
      return getModelForTask(plan, task);
    }
    const limits = typeof getPlanLimits === "function" ? getPlanLimits(plan) : null;
    const taskModels = limits?.models || null;
    if (task === "extraction") {
      return taskModels?.extraction || limits?.aiModel || null;
    }
    if (task === "safety_check") {
      return taskModels?.safety_check || limits?.aiModel || null;
    }
    return taskModels?.main_reply || limits?.aiModel || null;
  }

  function parsePositiveInt(value, fallback) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
    return fallback;
  }

  function countMessageChars(text) {
    return Array.from(String(text || "")).length;
  }

  function getHistoryRowLimit(plan) {
    const normalizedPlan = mapPlanToTier(plan);
    if (normalizedPlan === "enterprise") {
      return parsePositiveInt(process.env.HISTORY_ROWS_ENTERPRISE, 14);
    }
    if (normalizedPlan === "pro") {
      return parsePositiveInt(process.env.HISTORY_ROWS_PRO, 10);
    }
    return parsePositiveInt(process.env.HISTORY_ROWS_STARTER, 8);
  }

  function getReplyTokenCap(plan) {
    const normalizedPlan = mapPlanToTier(plan);
    if (normalizedPlan === "enterprise") {
      return parsePositiveInt(process.env.OPENROUTER_MAX_TOKENS_ENTERPRISE, 360);
    }
    if (normalizedPlan === "pro") {
      return parsePositiveInt(process.env.OPENROUTER_MAX_TOKENS_PRO, 220);
    }
    return parsePositiveInt(process.env.OPENROUTER_MAX_TOKENS_STARTER, 120);
  }

  function getRelevantHistoryRowLimit(plan) {
    const normalizedPlan = mapPlanToTier(plan);
    if (normalizedPlan === "enterprise") {
      return parsePositiveInt(process.env.HISTORY_RELEVANT_ROWS_ENTERPRISE, 10);
    }
    if (normalizedPlan === "pro") {
      return parsePositiveInt(process.env.HISTORY_RELEVANT_ROWS_PRO, 7);
    }
    return parsePositiveInt(process.env.HISTORY_RELEVANT_ROWS_STARTER, 5);
  }

  function getHistoryCharBudget(plan) {
    const normalizedPlan = mapPlanToTier(plan);
    if (normalizedPlan === "enterprise") {
      return parsePositiveInt(process.env.HISTORY_CONTEXT_CHARS_ENTERPRISE, 2600);
    }
    if (normalizedPlan === "pro") {
      return parsePositiveInt(process.env.HISTORY_CONTEXT_CHARS_PRO, 1800);
    }
    return parsePositiveInt(process.env.HISTORY_CONTEXT_CHARS_STARTER, 1200);
  }

  function getKnowledgePromptItemLimit(plan) {
    const normalizedPlan = mapPlanToTier(plan);
    if (normalizedPlan === "enterprise") {
      return parsePositiveInt(process.env.KNOWLEDGE_PROMPT_ITEMS_ENTERPRISE, 7);
    }
    if (normalizedPlan === "pro") {
      return parsePositiveInt(process.env.KNOWLEDGE_PROMPT_ITEMS_PRO, 5);
    }
    return parsePositiveInt(process.env.KNOWLEDGE_PROMPT_ITEMS_STARTER, 3);
  }

  function getKnowledgePromptCharBudget(plan) {
    const normalizedPlan = mapPlanToTier(plan);
    if (normalizedPlan === "enterprise") {
      return parsePositiveInt(process.env.KNOWLEDGE_PROMPT_CHARS_ENTERPRISE, 2200);
    }
    if (normalizedPlan === "pro") {
      return parsePositiveInt(process.env.KNOWLEDGE_PROMPT_CHARS_PRO, 1400);
    }
    return parsePositiveInt(process.env.KNOWLEDGE_PROMPT_CHARS_STARTER, 900);
  }

  function normalizeHistoryText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildTextTokenSet(value) {
    return new Set(
      normalizeHistoryText(value)
        .split(" ")
        .filter((token) => token.length > 2)
    );
  }

  function computeTokenOverlapScore(baseTokens, candidateText) {
    if (!baseTokens || baseTokens.size === 0) return 0;
    const candidateTokens = buildTextTokenSet(candidateText);
    if (candidateTokens.size === 0) return 0;
    let overlap = 0;
    for (const token of candidateTokens) {
      if (baseTokens.has(token)) overlap += 1;
    }
    return overlap / Math.max(baseTokens.size, candidateTokens.size);
  }

  function getHistoryRowCombinedText(row) {
    return [row?.customer_message, row?.ai_reply, row?.human_reply]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  function selectRelevantHistoryRows({
    rows,
    userMessage,
    plan,
    latestIntentHint = null,
    includeBookingContext = false,
  }) {
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const rowLimit = getRelevantHistoryRowLimit(plan);
    const charBudget = getHistoryCharBudget(plan);
    const queryTokens = buildTextTokenSet(userMessage);
    const bookingBoost =
      includeBookingContext || latestIntentHint === "booking"
        ? /\b(book|booking|reserve|reservation|table|date|time|party|guest|cancel|reschedule)\b/i
        : null;

    let priorAssistantIndex = -1;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index]?.ai_reply || rows[index]?.human_reply) {
        priorAssistantIndex = index;
        break;
      }
    }

    const scored = rows.map((row, index) => {
      const text = getHistoryRowCombinedText(row);
      const recencyScore = rows.length <= 1 ? 1 : index / (rows.length - 1);
      const overlapScore = computeTokenOverlapScore(queryTokens, text);
      const bookingScore =
        bookingBoost && bookingBoost.test(String(text || "")) ? 0.35 : 0;
      return {
        index,
        row,
        score: recencyScore * 0.55 + overlapScore * 1.4 + bookingScore,
      };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.index - a.index;
    });

    const chosenIndexes = new Set();
    if (priorAssistantIndex >= 0) chosenIndexes.add(priorAssistantIndex);

    for (const entry of scored) {
      if (chosenIndexes.size >= rowLimit) break;
      chosenIndexes.add(entry.index);
    }

    let selected = Array.from(chosenIndexes)
      .sort((a, b) => a - b)
      .map((index) => ({ index, row: rows[index] }));

    let usedChars = 0;
    const constrained = [];
    for (const item of selected) {
      const rowText = getHistoryRowCombinedText(item.row);
      const rowChars = countMessageChars(rowText);
      const required = item.index === priorAssistantIndex;
      if (!required && usedChars + rowChars > charBudget) continue;
      constrained.push(item.row);
      usedChars += rowChars;
    }

    if (!constrained.length && rows.length) {
      return [rows[rows.length - 1]];
    }
    return constrained;
  }

  const CLOSING_PHRASE_LANGUAGE_BY_TEXT = new Map([
    ["tack", "sv"],
    ["tack sa mycket", "sv"],
    ["hej da", "sv"],
    ["hejdå", "sv"],
    ["hejda", "sv"],
    ["thanks", "en"],
    ["thank you", "en"],
    ["bye", "en"],
    ["bye bye", "en"],
    ["شكرا", "ar"],
    ["تمام شكرا", "ar"],
  ]);

  function normalizeIntentText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function detectClosingMessage(text) {
    const normalized = normalizeIntentText(text);
    if (!normalized) return { isClosing: false, languageCode: null };

    if (CLOSING_PHRASE_LANGUAGE_BY_TEXT.has(normalized)) {
      return {
        isClosing: true,
        languageCode: CLOSING_PHRASE_LANGUAGE_BY_TEXT.get(normalized) || null,
      };
    }

    const bookingOrRequestKeywords =
      /\b(book|booking|reserve|reservation|table|cancel|reschedule|menu|hours|address|location|where|when|what|how|can|could|help|problem|question)\b/i;
    if (bookingOrRequestKeywords.test(normalized)) {
      return { isClosing: false, languageCode: null };
    }

    const startedByClosing = Array.from(CLOSING_PHRASE_LANGUAGE_BY_TEXT.entries()).find(
      ([phrase]) => normalized.startsWith(`${phrase} `) && normalized.split(" ").length <= 6
    );
    if (startedByClosing) {
      return { isClosing: true, languageCode: startedByClosing[1] };
    }

    return { isClosing: false, languageCode: null };
  }

  function getClosingReply(languageCode) {
    if (languageCode === "sv") {
      return "Tack! Hor av dig nar som helst om du behover nagot mer.";
    }
    if (languageCode === "ar") {
      return "شكراً! راسلنا في أي وقت إذا احتجت أي شيء.";
    }
    return "Thanks! Message us anytime if you need anything else.";
  }

  function hasConversationClosedMarker(extractedData) {
    if (!extractedData) return false;
    if (typeof extractedData === "object") {
      return extractedData.conversation_closed === true;
    }
    if (typeof extractedData === "string") {
      try {
        const parsed = JSON.parse(extractedData);
        return parsed?.conversation_closed === true;
      } catch {
        return false;
      }
    }
    return false;
  }

  function trimHistoryToActiveSegment(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    let lastClosedIndex = -1;
    for (let index = 0; index < rows.length; index += 1) {
      if (hasConversationClosedMarker(rows[index]?.extracted_data)) {
        lastClosedIndex = index;
      }
    }
    if (lastClosedIndex === -1) return rows;
    return rows.slice(lastClosedIndex + 1);
  }

  async function clearActiveBookingDraftOnClose({
    userId,
    conversationId = null,
    externalUserId = null,
  }) {
    let draft = null;
    try {
      draft = await getActiveBookingDraft({
        userId,
        conversationId,
        externalUserId,
      });
    } catch (err) {
      console.error("Active booking draft lookup failed:", err?.message || err);
    }

    if (!draft?.id && externalUserId) {
      try {
        draft = await getActiveBookingDraft({
          userId,
          conversationId: null,
          externalUserId,
        });
      } catch (err) {
        console.error("External booking draft lookup failed:", err?.message || err);
      }
    }

    if (!draft?.id) return false;

    await finalizeBookingDraft({
      bookingId: draft.id,
      userId,
      status: "completed",
    });
    return true;
  }

  function shouldIncludeBookingContext({ userMessage, latestIntentHint, activeBookingDraft }) {
    if (activeBookingDraft?.id) return true;
    if (latestIntentHint === "booking") return true;
    const normalizedText = String(userMessage || "").toLowerCase();
    return /\b(book|booking|reserve|reservation|table|date|time|party|guest|guests|cancel|reschedule)\b/.test(
      normalizedText
    );
  }

  async function maybeStartNewBooking({ userId, text, currentDraft }) {
    if (!currentDraft) return null;
    if (!isNewBookingRequest(text)) return currentDraft;
    await finalizeBookingDraft({
      bookingId: currentDraft.id,
      userId,
      status: "cancelled",
    });
    if (syncBookingToCalendar) {
      syncBookingToCalendar({ userId, bookingId: currentDraft.id, status: "cancelled" }).catch((err) =>
        console.error("Calendar sync (new booking cancel) failed:", err?.message)
      );
    }
    return null;
  }
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async function buildAiReply({
    userId,
    userMessage,
    conversationId,
    externalUserId = null,
    includeCurrentMessage = true,
    preferredReplyLanguage = null,
    suppressActiveBookingContext = false,
    latestIntentHint = null,
  }) {
    const { data: settings, error: dbError } = await supabaseAdmin
      .from("client_settings")
      .select("business, plan, tone, reply_length")
      .eq("user_id", userId)
      .maybeSingle();

    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }

    const fallbackBusiness = settings?.business || "No business info provided.";
    const plan = mapPlanToTier(settings?.plan || "starter");
    const tone = settings?.tone || "professional";
    const replyLength = settings?.reply_length || "concise";
    const { data: businessRow } = await supabaseAdmin
      .from("client_settings")
      .select("ai_model")
      .eq("user_id", userId)
      .maybeSingle();
    const rawAiModel = businessRow?.ai_model || "gpt-4o-mini";
    const model = rawAiModel.includes("/") ? rawAiModel : `openai/${rawAiModel}`;
    const extractionModel = getRoutedModel(plan, "extraction") || model;
    const safetyModel = getRoutedModel(plan, "safety_check") || model;
    const planModels =
      typeof getModelsForPlan === "function"
        ? getModelsForPlan(plan)
        : {
            main_reply: model,
            extraction: extractionModel,
            safety_check: safetyModel,
          };
    const historyRowLimit = getHistoryRowLimit(plan);
    const replyTokenCap = getReplyTokenCap(plan);
    const knowledgePromptItemLimit = getKnowledgePromptItemLimit(plan);
    const knowledgePromptCharBudget = getKnowledgePromptCharBudget(plan);
    const businessTimezone = await loadBusinessTimezone(userId);
    const todayIsoDate = getTodayIsoDateInTimezone(businessTimezone);
    const structuredKnowledge = await loadStructuredBusinessKnowledge(userId);
    let activeBookingDraft = null;
    if (!suppressActiveBookingContext) {
      try {
        activeBookingDraft = await getActiveBookingDraft({
          userId,
          conversationId,
          externalUserId,
        });
      } catch (bookingDraftErr) {
        console.error("Active booking draft query failed:", bookingDraftErr?.message || bookingDraftErr);
      }
    }
    const includeBookingContext = shouldIncludeBookingContext({
      userMessage,
      latestIntentHint,
      activeBookingDraft,
    });
    const activeBookingContext = includeBookingContext
      ? buildActiveBookingDraftContext(activeBookingDraft)
      : "";
    const learnedKnowledgeContext = await loadKnowledgeBaseForPrompt(userId, {
      userMessage,
      maxItems: knowledgePromptItemLimit,
      maxChars: knowledgePromptCharBudget,
    });
    const business = structuredKnowledge.hasStructuredData
      ? structuredKnowledge.businessContext
      : fallbackBusiness;
    const businessType = normalizeBusinessType(structuredKnowledge.businessType);
    const industryGuidance = buildIndustryTemplateGuidance(businessType);

    if (!model) {
      throw new Error("No OpenRouter model configured");
    }

    const { toneRule, lengthRule } = styleRules(tone, replyLength);

    let history = [];
    const historyWithHuman = await supabaseAdmin
      .from("messages")
      .select("customer_message, ai_reply, human_reply, extracted_data, created_at")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(historyRowLimit);

    if (
      historyWithHuman.error &&
      String(historyWithHuman.error.message || "").toLowerCase().includes("human_reply")
    ) {
      const fallbackHistory = await supabaseAdmin
        .from("messages")
        .select("customer_message, ai_reply, extracted_data, created_at")
        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(historyRowLimit);
      if (fallbackHistory.error) {
        console.error("History fetch failed:", fallbackHistory.error.message);
      }
      history = (fallbackHistory.data || []).slice().reverse();
    } else {
      if (historyWithHuman.error) {
        console.error("History fetch failed:", historyWithHuman.error.message);
      }
      history = (historyWithHuman.data || []).slice().reverse();
    }
    history = trimHistoryToActiveSegment(history);
    history = selectRelevantHistoryRows({
      rows: history,
      userMessage,
      plan,
      latestIntentHint,
      includeBookingContext,
    });

    const historyMessages = [];
    for (const row of history || []) {
      historyMessages.push(
        ...[
          row.customer_message && { role: "user", content: row.customer_message },
          row.ai_reply && { role: "assistant", content: row.ai_reply },
          row.human_reply && { role: "assistant", content: row.human_reply },
        ].filter(Boolean)
      );
    }

    const preferredLanguageName = getPreferredLanguagePromptHint(preferredReplyLanguage);
    const starterConcisionRule =
      plan === "starter"
        ? "- Starter mode: use 1-2 short sentences unless you are collecting booking fields."
        : "";

    const systemPrompt = `
You are SupportPilot, an AI customer support assistant for a business.

Hard rules:
- Only use the business info provided. Do not invent details.
- If unsure, ask ONE short follow-up question OR say you'll connect a human.
- NEVER ask again for information the user already provided earlier in this conversation.
- Do NOT repeat the user's message back unless necessary.
- Keep replies short and efficient by default.
- Do not add filler, disclaimers, or repeated confirmations.
- If the user is booking: collect missing details step-by-step (date, time, people, name, phone). Confirm what you have, ask only what's missing.
- If the user corrects booking details (for example "no I meant 10" or "actually Friday"), update only the corrected fields and keep the rest of the current draft.
- Acknowledge corrections briefly and confirm the updated booking details naturally.
- Use opening times from "Business hours" only.
- Use menu availability status exactly; if unavailable, clearly say unavailable and offer alternatives if known.
- Obey booking rules exactly. If booking is disabled, do not accept bookings.
- Interpret relative date phrases ("today", "tomorrow", "tonight", "next friday") as real calendar dates using the business timezone.
- Only ask for a specific date if the user's date wording is truly ambiguous.
- Prioritize the latest user request over older conversation flows.
- If the latest request changes topic (for example booking -> address/hours/menu/language), switch intent immediately.

Style:
- ${toneRule}
- ${lengthRule}
- ${starterConcisionRule || "Keep concise and natural."}

Language:
- Preferred reply language for this conversation: ${preferredLanguageName || "Not set"}.
- If preferred language is set, reply in that language unless the user asks to change it.
- If preferred language is not set, mirror the user's latest language when clear.

Date context:
- Today (ISO): ${todayIsoDate}
- Business timezone: ${businessTimezone}

Latest intent hint:
- ${latestIntentHint || "none"}

Industry template:
- Business type: ${businessType}
- Template priorities:
${industryGuidance}

${learnedKnowledgeContext || "Learned business knowledge:\n- None yet."}

${activeBookingContext || "Active booking draft:\n- None."}

Business info:
${business}
    `.trim();

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_URL,
        "X-Title": process.env.APP_TITLE,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...historyMessages,
          ...(includeCurrentMessage ? [{ role: "user", content: userMessage }] : []),
        ],
        temperature: 0.4,
        max_tokens: replyTokenCap,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      const error = new Error(errText);
      error.statusCode = resp.status;
      throw error;
    }

    const data = await resp.json();
    const usage = getUsageFromOpenRouterResponse(data);
    const reply = data?.choices?.[0]?.message?.content?.trim() || "Sorry, I couldn't generate a reply.";

    let extractedData = { ...EMPTY_EXTRACTION };
    try {
      extractedData = await extractStructuredData({
        model: extractionModel,
        historyMessages: includeCurrentMessage
          ? [...historyMessages, { role: "user", content: userMessage }]
          : historyMessages,
        userMessage,
        assistantReply: reply,
        business,
        businessTimezone,
        todayIsoDate,
      });
    } catch (extractErr) {
      console.error("Extraction failed:", extractErr?.message || extractErr);
    }

    return {
      reply,
      plan,
      tone,
      replyLength,
      model,
      models: {
        main_reply: model,
        extraction: extractionModel,
        safety_check: safetyModel,
        ...planModels,
      },
      usage,
      estimatedCostUsd: estimateCostUsd({
        model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      }),
      extractedData,
    };
  }
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async function handleIncomingMessage({
    userId,
    channel,
    conversationId = null,
    externalConversationId = null,
    externalUserId = null,
    text,
    shouldSendExternalReply = false,
  }) {
    if (!userId) throw new Error("Missing userId");
    if (!channel) throw new Error("Missing channel");
    if (!text || !String(text).trim()) throw new Error("Missing text");
    const normalizedText = String(text).trim();

    // Track every inbound message for analytics
    if (typeof incrementMonthlyStat === "function") {
      try {
        await incrementMonthlyStat({ businessId: userId, statName: "total_inbound_messages" });
      } catch (_e) { /* non-critical */ }
    }

    const _replyStartMs = Date.now();

    let resolvedConversationId = conversationId;
    let resolvedExternalConversationId = externalConversationId;
    let resolvedExternalUserId = externalUserId;

    if (!resolvedConversationId) {
      if (!externalConversationId) {
        resolvedConversationId = crypto.randomUUID();
      } else {
        const map = await getOrCreateConversationMap({
          userId,
          channel,
          externalConversationId,
          externalUserId,
        });
        resolvedConversationId = map.conversationId;
        resolvedExternalConversationId = map.externalConversationId;
        resolvedExternalUserId = map.externalUserId;
      }
    }

    const existingConversation = await getConversationByIdForUser({
      userId,
      conversationId: resolvedConversationId,
    });
    let usedConversationsThisMonthFromNewConversation = null;
    if (!existingConversation) {
      const monthKey =
        typeof getUsageMonthKey === "function" ? getUsageMonthKey(new Date()) : null;
      if (
        monthKey &&
        typeof reserveConversationUsageAndIncrement === "function"
      ) {
        try {
          const nextUsage = await reserveConversationUsageAndIncrement({
            userId,
            conversationId: resolvedConversationId,
            monthKey,
          });
          const asNumber = Number(nextUsage);
          if (Number.isFinite(asNumber)) {
            usedConversationsThisMonthFromNewConversation = asNumber;
          }
        } catch (usageIncrementErr) {
          console.error(
            "Usage increment failed:",
            usageIncrementErr?.message || usageIncrementErr
          );
        }
      }
    }

    if (
      existingConversation?.status === "escalated" ||
      existingConversation?.ai_paused === true ||
      existingConversation?.state === "human_mode"
    ) {
      const { error: logErr } = await insertMessageWithFallback({
        user_id: userId,
        conversation_id: resolvedConversationId,
        channel,
        customer_message: normalizedText,
        ai_reply: null,
        extracted_data: {
          intent: "other",
          confidence: "low",
          escalation_reason: "uncertain",
        },
        escalated: existingConversation?.status === "escalated",
      });

      if (logErr) {
        throw new Error(logErr.message || "Failed to store inbound escalated message");
      }

      await upsertConversationRecord({
        userId,
        conversationId: resolvedConversationId,
        channel,
        externalConversationId: resolvedExternalConversationId,
        externalUserId: resolvedExternalUserId,
        firstMessage: normalizedText,
        lastMessagePreview: normalizedText,
        extractedData: null,
        statusOverride: existingConversation?.status === "escalated" ? "escalated" : "open",
        priorityOverride: existingConversation?.priority === "high" ? "high" : null,
        stateOverride:
          existingConversation?.ai_paused === true ||
          existingConversation?.state === "human_mode"
            ? "human_mode"
            : existingConversation?.state || null,
      });

      if (
        channel === "whatsapp" &&
        resolvedExternalUserId &&
        typeof maybeForwardPausedInboundToOwner === "function"
      ) {
        try {
          await maybeForwardPausedInboundToOwner({
            userId,
            from: resolvedExternalUserId,
            incomingText: normalizedText,
            conversationId: resolvedConversationId,
          });
        } catch (ownerNotifyErr) {
          console.error("Paused-mode owner forwarding failed:", ownerNotifyErr?.message || ownerNotifyErr);
        }
      }

      return {
        ok: true,
        userId,
        channel,
        conversationId: resolvedConversationId,
        externalConversationId: resolvedExternalConversationId,
        externalUserId: resolvedExternalUserId,
        reply: null,
        extractedData: null,
        planUsed: null,
        toneUsed: null,
        replyLengthUsed: null,
        modelUsed: null,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        estimatedCostUsd: null,
        confidence: "low",
        escalationReason: "uncertain",
        escalated: existingConversation?.status === "escalated",
        shouldSendExternalReply: false,
      };
    }

    const businessTimezone = await loadBusinessTimezone(userId);
    const flowOverride = detectFlowIntentOverride(normalizedText);
    const detectedLanguage = detectPreferredReplyLanguage(normalizedText);
    if (detectedLanguage) {
      await saveConversationPreferredLanguage({
        userId,
        conversationId: resolvedConversationId,
        languageCode: detectedLanguage,
      });
    }
    const preferredReplyLanguage =
      detectedLanguage ||
      (await loadConversationPreferredLanguage({
        userId,
        conversationId: resolvedConversationId,
      }));

    const userPlan = await loadUserPlan(userId);
    const planLimits = getPlanLimits(userPlan);
    const businessMaxMessages = typeof loadBusinessMaxMessages === "function"
      ? await loadBusinessMaxMessages(userId)
      : null;
    const maxMessageChars = Number(planLimits?.maxMessageChars) || 300;
    if (countMessageChars(normalizedText) > maxMessageChars) {
      const lengthLimitReply = "Please shorten your message.";
      const extractedData = {
        intent: flowOverride.intentOverride || "other",
        status: "incomplete",
        confidence: "high",
        escalation_reason: "none",
        message_too_long: true,
      };

      const { error: logErr } = await insertMessageWithFallback({
        user_id: userId,
        conversation_id: resolvedConversationId,
        channel,
        customer_message: normalizedText,
        ai_reply: lengthLimitReply,
        model_used: "input_limit",
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        extracted_data: extractedData,
        escalated: false,
      });

      if (logErr) throw new Error(logErr.message || "Failed to store over-length message");

      await upsertConversationRecord({
        userId,
        conversationId: resolvedConversationId,
        channel,
        externalConversationId: resolvedExternalConversationId,
        externalUserId: resolvedExternalUserId,
        firstMessage: normalizedText,
        lastMessagePreview: lengthLimitReply,
        extractedData,
        statusOverride: "waiting_customer",
        intentOverride: flowOverride.intentOverride,
      });

      return {
        ok: true,
        userId,
        channel,
        conversationId: resolvedConversationId,
        externalConversationId: resolvedExternalConversationId,
        externalUserId: resolvedExternalUserId,
        reply: lengthLimitReply,
        extractedData,
        planUsed: planLimits.plan,
        toneUsed: null,
        replyLengthUsed: null,
        modelUsed: "input_limit",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        estimatedCostUsd: 0,
        confidence: "high",
        escalationReason: "none",
        escalated: false,
        shouldSendExternalReply: Boolean(shouldSendExternalReply),
      };
    }

    const closeIntent = detectClosingMessage(normalizedText);
    if (closeIntent.isClosing) {
      let bookingDraftCleared = false;
      try {
        bookingDraftCleared = await clearActiveBookingDraftOnClose({
          userId,
          conversationId: resolvedConversationId,
          externalUserId: resolvedExternalUserId,
        });
      } catch (bookingCloseErr) {
        console.error("Closing booking draft clear failed:", bookingCloseErr?.message || bookingCloseErr);
      }

      const replyLanguage = preferredReplyLanguage || closeIntent.languageCode || "en";
      const closingReply = getClosingReply(replyLanguage);
      const closingExtractedData = {
        intent: "other",
        status: "complete",
        confidence: "high",
        escalation_reason: "none",
        conversation_closed: true,
        booking_draft_cleared: bookingDraftCleared,
      };

      const { error: closingLogErr } = await insertMessageWithFallback({
        user_id: userId,
        conversation_id: resolvedConversationId,
        channel,
        customer_message: normalizedText,
        ai_reply: closingReply,
        model_used: "close_intent",
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        extracted_data: closingExtractedData,
        escalated: false,
      });

      if (closingLogErr) throw new Error(closingLogErr.message || "Failed to store closing message");

      await upsertConversationRecord({
        userId,
        conversationId: resolvedConversationId,
        channel,
        externalConversationId: resolvedExternalConversationId,
        externalUserId: resolvedExternalUserId,
        firstMessage: normalizedText,
        lastMessagePreview: closingReply,
        extractedData: closingExtractedData,
        statusOverride: "resolved",
        intentOverride: "other",
        stateOverride: "resolved",
      });

      return {
        ok: true,
        userId,
        channel,
        conversationId: resolvedConversationId,
        externalConversationId: resolvedExternalConversationId,
        externalUserId: resolvedExternalUserId,
        reply: closingReply,
        extractedData: closingExtractedData,
        planUsed: planLimits.plan,
        toneUsed: null,
        replyLengthUsed: null,
        modelUsed: "close_intent",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        estimatedCostUsd: 0,
        confidence: "high",
        escalationReason: "none",
        escalated: false,
        shouldSendExternalReply: Boolean(shouldSendExternalReply),
      };
    }

    const directKnowledge = await tryDirectKnowledgeAnswer({
      userId,
      userMessage: normalizedText,
      businessTimezone,
    });

    if (directKnowledge?.reply) {
      const safety = evaluateResponseSafety({
        text: normalizedText,
        reply: directKnowledge.reply,
        extractedData: directKnowledge.extractedData,
      });
      const isEscalationTransition =
        safety.shouldEscalate && existingConversation?.status !== "escalated";
      const finalReply = safety.shouldEscalate
        ? ESCALATION_REPLY_MESSAGE
        : directKnowledge.reply;
      const extractedDataWithSafety = {
        ...directKnowledge.extractedData,
        confidence: safety.confidence,
        escalation_reason: safety.escalationReason,
      };

      const { error: logErr } = await insertMessageWithFallback({
        user_id: userId,
        conversation_id: resolvedConversationId,
        channel,
        customer_message: normalizedText,
        ai_reply: finalReply,
        model_used: directKnowledge.source,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        extracted_data: extractedDataWithSafety,
        escalated: safety.shouldEscalate,
      });

      if (logErr) throw new Error(logErr.message || "Failed to store inbound message");

      await upsertConversationRecord({
        userId,
        conversationId: resolvedConversationId,
        channel,
        externalConversationId: resolvedExternalConversationId,
        externalUserId: resolvedExternalUserId,
        firstMessage: normalizedText,
        lastMessagePreview: finalReply || normalizedText,
        extractedData: extractedDataWithSafety,
        statusOverride: safety.shouldEscalate ? "escalated" : "waiting_customer",
        priorityOverride: safety.isRiskyEscalation ? "high" : null,
        intentOverride: flowOverride.intentOverride,
        stateOverride:
          flowOverride.intentOverride === "faq" || flowOverride.intentOverride === "other"
            ? "idle"
            : null,
      });

      if (isEscalationTransition) {
        try {
          await createEscalationNotification({
            userId,
            conversationId: resolvedConversationId,
            channel,
            externalUserId: resolvedExternalUserId,
            customerMessage: normalizedText,
          });
        } catch (notifyErr) {
          console.error("Escalation notification failed:", notifyErr?.message || notifyErr);
        }
      }

      if (typeof incrementMonthlyStat === "function") {
        try {
          await incrementMonthlyStat({ businessId: userId, statName: "ai_messages_sent" });
          if (!existingConversation) {
            await incrementMonthlyStat({ businessId: userId, statName: "ai_conversations_handled" });
          }
          if (isEscalationTransition) {
            await incrementMonthlyStat({ businessId: userId, statName: "human_escalations" });
          }
          // Track response time for running average
          const _replyElapsedMs = Date.now() - _replyStartMs;
          if (_replyElapsedMs > 0 && _replyElapsedMs < 300000) {
            await incrementMonthlyStat({ businessId: userId, statName: "total_response_time_ms", delta: _replyElapsedMs });
            await incrementMonthlyStat({ businessId: userId, statName: "response_time_count" });
          }
        } catch (_e) { /* non-critical */ }
      }

      return {
        ok: true,
        userId,
        channel,
        conversationId: resolvedConversationId,
        externalConversationId: resolvedExternalConversationId,
        externalUserId: resolvedExternalUserId,
        reply: finalReply,
        extractedData: extractedDataWithSafety,
        planUsed: "knowledge_lookup",
        toneUsed: null,
        replyLengthUsed: null,
        modelUsed: directKnowledge.source,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        estimatedCostUsd: 0,
        confidence: safety.confidence,
        escalationReason: safety.escalationReason,
        escalated: safety.shouldEscalate,
        shouldSendExternalReply: Boolean(shouldSendExternalReply),
      };
    }

    const monthStartIso = getMonthStartIso(new Date());
    let usedConversationsThisMonth = usedConversationsThisMonthFromNewConversation;
    if (!Number.isFinite(Number(usedConversationsThisMonth))) {
      usedConversationsThisMonth = await countMonthlyAiConversations(
        userId,
        monthStartIso
      );
    } else {
      usedConversationsThisMonth = Number(usedConversationsThisMonth);
    }
    const hasMonthlyLimit = businessMaxMessages !== null && businessMaxMessages > 0;
    const isOverLimit =
      hasMonthlyLimit && usedConversationsThisMonth >= businessMaxMessages;

    if (isOverLimit) {
      const softLimitReply =
        "Thanks for your message. Our team will get back to you shortly.";

      const softLimitExtractedData = {
        intent: flowOverride.intentOverride || "other",
        status: "incomplete",
        confidence: "high",
        escalation_reason: "uncertain",
        plan_limit_reached: true,
      };

      const { error: logErr } = await insertMessageWithFallback({
        user_id: userId,
        conversation_id: resolvedConversationId,
        channel,
        customer_message: normalizedText,
        ai_reply: softLimitReply,
        model_used: "plan_limit",
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        extracted_data: softLimitExtractedData,
        escalated: false,
      });

      if (logErr) throw new Error(logErr.message || "Failed to store over-limit message");

      await upsertConversationRecord({
        userId,
        conversationId: resolvedConversationId,
        channel,
        externalConversationId: resolvedExternalConversationId,
        externalUserId: resolvedExternalUserId,
        firstMessage: normalizedText,
        lastMessagePreview: softLimitReply || normalizedText,
        extractedData: softLimitExtractedData,
        statusOverride: "waiting_customer",
        priorityOverride: "high",
        intentOverride: flowOverride.intentOverride,
      });

      return {
        ok: true,
        userId,
        channel,
        conversationId: resolvedConversationId,
        externalConversationId: resolvedExternalConversationId,
        externalUserId: resolvedExternalUserId,
        reply: softLimitReply,
        extractedData: softLimitExtractedData,
        planUsed: planLimits.plan,
        toneUsed: null,
        replyLengthUsed: null,
        modelUsed: "plan_limit",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        estimatedCostUsd: 0,
        confidence: "high",
        escalationReason: "uncertain",
        escalated: false,
        shouldSendExternalReply: Boolean(shouldSendExternalReply),
      };
    }

    const {
      reply: aiReply,
      plan,
      tone,
      replyLength,
      model,
      usage,
      estimatedCostUsd,
      extractedData,
    } = await buildAiReply({
      userId,
      userMessage: normalizedText,
      conversationId: resolvedConversationId,
      externalUserId: resolvedExternalUserId,
      includeCurrentMessage: true,
      preferredReplyLanguage,
      suppressActiveBookingContext: flowOverride.overrideBookingFlow,
      latestIntentHint: flowOverride.intentOverride,
    });

    const normalizedExtractedData = normalizeBookingExtractionDate(extractedData, {
      timeZone: businessTimezone,
    });

    let bookingSignal = false;
    let bookingComplete = false;
    try {
      bookingSignal =
        !flowOverride.overrideBookingFlow &&
        shouldTreatMessageAsBookingStart(normalizedText, normalizedExtractedData);
      if (bookingSignal) {
        const correctionMessage = isBookingCorrectionMessage(normalizedText);
        let activeDraft = await getActiveBookingDraft({
          userId,
          conversationId: resolvedConversationId,
          externalUserId: resolvedExternalUserId,
        });

        if (!correctionMessage) {
          activeDraft = await maybeStartNewBooking({
            userId,
            text: normalizedText,
            currentDraft: activeDraft,
          });
        }

        if (isBookingCancellationRequest(normalizedText) && activeDraft?.id) {
          await finalizeBookingDraft({
            bookingId: activeDraft.id,
            userId,
            status: "cancelled",
          });
          // Non-blocking calendar sync — remove from Google Calendar
          if (syncBookingToCalendar) {
            syncBookingToCalendar({ userId, bookingId: activeDraft.id, status: "cancelled" }).catch((err) =>
              console.error("Calendar sync (cancel) failed:", err?.message)
            );
          }
        } else if (
          normalizedExtractedData.intent === "booking" ||
          (correctionMessage && activeDraft?.id && hasAnyBookingDraftField(normalizedExtractedData))
        ) {
          const draft = await upsertBookingDraft({
            userId,
            channel,
            conversationId: resolvedConversationId,
            externalUserId: resolvedExternalUserId,
            extractedData: normalizedExtractedData,
            existingDraft: activeDraft,
          });

          const isCompleteExtraction =
            normalizedExtractedData.status === "complete" &&
            Boolean(normalizedExtractedData.date) &&
            Boolean(normalizedExtractedData.time) &&
            Boolean(normalizedExtractedData.people) &&
            Boolean(normalizedExtractedData.name) &&
            Boolean(normalizedExtractedData.phone);
          bookingComplete = isCompleteExtraction;

          if (draft?.id && isCompleteExtraction && isBookingConfirmationMessage(normalizedText)) {
            await finalizeBookingDraft({
              bookingId: draft.id,
              userId,
              status: "confirmed",
            });
            // Non-blocking calendar sync (Google Calendar + ICS feed)
            if (syncBookingToCalendar) {
              syncBookingToCalendar({ userId, bookingId: draft.id, status: "confirmed" }).catch((err) =>
                console.error("Calendar sync (confirm) failed:", err?.message)
              );
            }
          }
        }
      }
    } catch (bookingSyncErr) {
      console.error("Booking draft sync failed:", bookingSyncErr?.message || bookingSyncErr);
    }

    const safety = evaluateResponseSafety({
      text: normalizedText,
      reply: aiReply,
      extractedData: normalizedExtractedData,
    });
    const isEscalationTransition =
      safety.shouldEscalate && existingConversation?.status !== "escalated";

    const finalReply = safety.shouldEscalate ? ESCALATION_REPLY_MESSAGE : aiReply;
    const extractedDataWithSafety = {
      ...normalizedExtractedData,
      confidence: safety.confidence,
      escalation_reason: safety.escalationReason,
    };
    let nextStateOverride = null;
    if (bookingSignal) {
      nextStateOverride = bookingComplete ? "booking_confirmed" : "booking_collecting";
    } else if (flowOverride.intentOverride === "faq" || flowOverride.intentOverride === "other") {
      nextStateOverride = "idle";
    }
    if (existingConversation?.state === "booking_confirmed" && bookingSignal) {
      nextStateOverride = "booking_collecting";
    }

    const { error: logErr } = await insertMessageWithFallback({
      user_id: userId,
      conversation_id: resolvedConversationId,
      channel,
      customer_message: normalizedText,
      ai_reply: finalReply,
      model_used: model,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
      estimated_cost_usd: estimatedCostUsd,
      extracted_data: extractedDataWithSafety,
      escalated: safety.shouldEscalate,
    });

    if (logErr) throw new Error(logErr.message || "Failed to store inbound message");

    await upsertConversationRecord({
      userId,
      conversationId: resolvedConversationId,
      channel,
      externalConversationId: resolvedExternalConversationId,
      externalUserId: resolvedExternalUserId,
      firstMessage: normalizedText,
      lastMessagePreview: finalReply || normalizedText,
      extractedData: extractedDataWithSafety,
      statusOverride: safety.shouldEscalate ? "escalated" : "waiting_customer",
      priorityOverride: safety.isRiskyEscalation ? "high" : null,
      intentOverride: flowOverride.intentOverride,
      stateOverride: nextStateOverride,
    });

    if (isEscalationTransition) {
      try {
        await createEscalationNotification({
          userId,
          conversationId: resolvedConversationId,
          channel,
          externalUserId: resolvedExternalUserId,
          customerMessage: normalizedText,
        });
      } catch (notifyErr) {
        console.error("Escalation notification failed:", notifyErr?.message || notifyErr);
      }
    }

    if (typeof incrementMonthlyStat === "function") {
      try {
        await incrementMonthlyStat({ businessId: userId, statName: "ai_messages_sent" });
        if (!existingConversation) {
          await incrementMonthlyStat({ businessId: userId, statName: "ai_conversations_handled" });
        }
        if (isEscalationTransition) {
          await incrementMonthlyStat({ businessId: userId, statName: "human_escalations" });
        }
        // Track response time for running average
        const _replyElapsedMs = Date.now() - _replyStartMs;
        if (_replyElapsedMs > 0 && _replyElapsedMs < 300000) {
          await incrementMonthlyStat({ businessId: userId, statName: "total_response_time_ms", delta: _replyElapsedMs });
          await incrementMonthlyStat({ businessId: userId, statName: "response_time_count" });
        }
      } catch (_e) { /* non-critical */ }
    }

    return {
      ok: true,
      userId,
      channel,
      conversationId: resolvedConversationId,
      externalConversationId: resolvedExternalConversationId,
      externalUserId: resolvedExternalUserId,
      reply: finalReply,
      extractedData: extractedDataWithSafety,
      planUsed: plan,
      toneUsed: tone,
      replyLengthUsed: replyLength,
      modelUsed: model,
      usage,
      estimatedCostUsd,
      confidence: safety.confidence,
      escalationReason: safety.escalationReason,
      escalated: safety.shouldEscalate,
      shouldSendExternalReply: Boolean(shouldSendExternalReply),
    };
  }

  return {
    handleIncomingMessage,
    buildAiReply,
    maybeStartNewBooking,
  };
}
