import crypto from "node:crypto";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  QUEUED_JOB_SELECT_FIELDS,
  ESCALATION_REPLY_MESSAGE,
} from "../config/constants.js";
import { normalizeBookingExtractionDate } from "../utils/dateNormalization.js";
import { getPlanDefaults } from "../config/planConfig.js";
import {
  getPlanLimits,
  getModelForTask,
} from "../config/modelRouting.js";

/* ================================
  Conversation pipeline: today-in-timezone helper, buildAiReply (LLM
  prompt + extraction), insertMessageWithFallback (schema-tolerant
  message insert), handleIncomingMessage (centralized inbound pipeline
  used by all channels), processReplyJob and runOneQueuedJob (job
  worker loop). isJobWorkerRunning is closure-local to keep the
  serialized-worker invariant inside this module.
================================ */
export function createConversationPipelineService({
  supabaseAdmin,
  // service objects
  planService,
  knowledgeAnsweringService,
  bookingService,
  escalationService,
  whatsappService,
  // ai service plain exports
  styleRules,
  estimateCostUsd,
  getUsageFromOpenRouterResponse,
  evaluateResponseSafety,
  EMPTY_EXTRACTION,
  extractStructuredData,
  normalizeBusinessType,
  buildIndustryTemplateGuidance,
  // still in server.js (passed as live shims)
  getOrCreateConversationMap,
  getConversationByIdForUser,
  upsertConversationRecord,
}) {
  // messaging is created AFTER this factory in server.js because the
  // messaging system depends on insertMessageWithFallback (defined here).
  // server.js calls setMessaging() once that wiring is ready, and
  // processReplyJob references the captured `messaging` lazily at call time.
  let messaging = null;
  function setMessaging(value) {
    messaging = value;
  }
  const {
    loadUserPlan,
    loadBusinessMaxMessages,
    getMonthStartIso,
    countMonthlyAiConversations,
  } = planService;

  const {
    loadBusinessTimezone,
    loadStructuredBusinessKnowledge,
    loadKnowledgeBaseForPrompt,
    tryDirectKnowledgeAnswer,
  } = knowledgeAnsweringService;

  const {
    getActiveBookingDraft,
    buildActiveBookingDraftContext,
    getPreferredLanguagePromptHint,
    detectFlowIntentOverride,
    detectPreferredReplyLanguage,
    saveConversationPreferredLanguage,
    loadConversationPreferredLanguage,
    shouldTreatMessageAsBookingStart,
    isBookingCorrectionMessage,
    isBookingCancellationRequest,
    isBookingConfirmationMessage,
    finalizeBookingDraft,
    upsertBookingDraft,
    hasAnyBookingDraftField,
    maybeStartNewBooking,
  } = bookingService;

  const { createEscalationNotification } = escalationService;
  const { maybeForwardPausedInboundToOwner } = whatsappService;

  let isJobWorkerRunning = false;

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
    // Load settings
    const { data: settings, error: dbError } = await supabaseAdmin
      .from("client_settings")
      .select("business, plan, tone, reply_length")
      .eq("user_id", userId)
      .maybeSingle();

    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }

    const fallbackBusiness = settings?.business || "No business info provided.";
    const plan = settings?.plan || "starter";
    const planConfig = getPlanDefaults(plan);
    // Enforce tone gating: non-Pro/Business users always get "professional"
    const tone = planConfig.features?.ai_tone_customization
      ? (settings?.tone || "professional")
      : "professional";
    const replyLength = settings?.reply_length || "concise";
    const { data: businessRow } = await supabaseAdmin
      .from("client_settings")
      .select("ai_model")
      .eq("user_id", userId)
      .maybeSingle();
    const rawAiModel = businessRow?.ai_model || "gpt-4o-mini";
    const model = rawAiModel.includes("/") ? rawAiModel : `openai/${rawAiModel}`;
    const extractionModel = getModelForTask(plan, "extraction") || model;
    const businessTimezone = await loadBusinessTimezone(userId);
    const todayIsoDate = getTodayIsoDateInTimezone(businessTimezone);
    const structuredKnowledge = await loadStructuredBusinessKnowledge(userId);
    const learnedKnowledgeContext = await loadKnowledgeBaseForPrompt(userId);
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
    const activeBookingContext = buildActiveBookingDraftContext(activeBookingDraft);
    const business = structuredKnowledge.hasStructuredData
      ? structuredKnowledge.businessContext
      : fallbackBusiness;
    const businessType = normalizeBusinessType(structuredKnowledge.businessType);
    const industryGuidance = buildIndustryTemplateGuidance(businessType);

    if (!model) {
      throw new Error("No OpenRouter model configured");
    }

    const { toneRule, lengthRule } = styleRules(tone, replyLength);

    // Load latest conversation history and replay it in chronological order.
    let history = [];
    const historyWithHuman = await supabaseAdmin
      .from("messages")
      .select("customer_message, ai_reply, human_reply, created_at")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(16);

    if (
      historyWithHuman.error &&
      String(historyWithHuman.error.message || "").toLowerCase().includes("human_reply")
    ) {
      const fallbackHistory = await supabaseAdmin
        .from("messages")
        .select("customer_message, ai_reply, created_at")
        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(16);
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

    // Convert stored messages into OpenRouter chat format
    const historyMessages = [];
    for (const row of history || []) {
      const rowMsgs = [
        row.customer_message && { role: "user", content: row.customer_message },
        row.ai_reply && { role: "assistant", content: row.ai_reply },
        row.human_reply && { role: "assistant", content: row.human_reply },
      ].filter(Boolean);
      if (rowMsgs.length) historyMessages.push(...rowMsgs);
    }

    const preferredLanguageName = getPreferredLanguagePromptHint(preferredReplyLanguage);

    const systemPrompt = `
You are SupportPilot, an AI customer support assistant for a business.

Hard rules:
- Only use the business info provided. Do not invent details.
- If unsure, ask ONE short follow-up question OR say you'll connect a human.
- NEVER ask again for information the user already provided earlier in this conversation.
- Do NOT repeat the user's message back unless necessary.
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

    const resp = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      signal: AbortSignal.timeout(30000),
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
          ...(includeCurrentMessage
            ? [{ role: "user", content: userMessage }]
            : []),
        ],
        temperature: 0.4,
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
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I couldn't generate a reply.";

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

  async function insertMessageWithFallback(payload) {
    let insertPayload = { ...payload };
    let { error } = await supabaseAdmin.from("messages").insert(insertPayload);

    while (error) {
      const retryPayload = { ...insertPayload };
      const messageText = String(error.message || "").toLowerCase();

      if (messageText.includes("extracted_data")) delete retryPayload.extracted_data;
      if (messageText.includes("model_used")) delete retryPayload.model_used;
      if (messageText.includes("prompt_tokens")) delete retryPayload.prompt_tokens;
      if (messageText.includes("completion_tokens")) delete retryPayload.completion_tokens;
      if (messageText.includes("total_tokens")) delete retryPayload.total_tokens;
      if (messageText.includes("estimated_cost_usd")) delete retryPayload.estimated_cost_usd;

      if (Object.keys(retryPayload).length === Object.keys(insertPayload).length) {
        break;
      }

      insertPayload = retryPayload;
      const retry = await supabaseAdmin.from("messages").insert(insertPayload);
      error = retry.error;
    }

    return { error };
  }

  // Centralized incoming-message pipeline used by all channels.
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

    let resolvedConversationId = conversationId;
    let resolvedExternalConversationId = externalConversationId;
    let resolvedExternalUserId = externalUserId;

    if (!resolvedConversationId) {
      if (externalConversationId) {
        const map = await getOrCreateConversationMap({
          userId,
          channel,
          externalConversationId,
          externalUserId,
        });
        resolvedConversationId = map.conversationId;
        resolvedExternalConversationId = map.externalConversationId;
        resolvedExternalUserId = map.externalUserId;
      } else {
        // Internal channels may not have external IDs; create a stable internal thread.
        resolvedConversationId = crypto.randomUUID();
      }
    }

    const existingConversation = await getConversationByIdForUser({
      userId,
      conversationId: resolvedConversationId,
    });

    // Stop AI automation on escalated threads. Only human replies should continue.
    if (
      existingConversation?.status === "escalated" ||
      existingConversation?.manual_mode === true ||
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
          existingConversation?.manual_mode === true ||
          existingConversation?.ai_paused === true ||
          existingConversation?.state === "human_mode"
            ? "human_mode"
            : existingConversation?.state || null,
      });

      if (channel === "whatsapp" && resolvedExternalUserId) {
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
    const maxMessages = await loadBusinessMaxMessages(userId);
    const monthStartIso = getMonthStartIso(new Date());
    const usedConversationsThisMonth = await countMonthlyAiConversations(
      userId,
      monthStartIso
    );
    const hasMonthlyLimit = maxMessages !== null && maxMessages > 0;
    const isOverLimit =
      hasMonthlyLimit &&
      usedConversationsThisMonth >= maxMessages;

    if (isOverLimit) {
      const shouldSendSoftLimitMessage =
        String(process.env.PLAN_SOFT_LIMIT_SEND_FALLBACK || "true")
          .trim()
          .toLowerCase() !== "false";
      const softLimitReply = shouldSendSoftLimitMessage
        ? String(
            process.env.PLAN_SOFT_LIMIT_FALLBACK_MESSAGE ||
              "Thanks for your message. Our team will get back to you shortly."
          ).trim()
        : null;

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
        model_used: "plan_soft_limit",
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
        statusOverride: "open",
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
        modelUsed: "plan_soft_limit",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        estimatedCostUsd: 0,
        confidence: "high",
        escalationReason: "uncertain",
        escalated: false,
        shouldSendExternalReply: Boolean(shouldSendExternalReply && softLimitReply),
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

  async function processReplyJob(job) {
    // Check before calling AI — catches edge cases where limit hit between queue and processing
    const activeCheck = await planService.isBusinessActive(job.user_id);
    if (!activeCheck.active) {
      console.log(`⛔ [Job] Skipping job ${job.id} — business ${job.user_id} inactive (${activeCheck.reason})`);
      return { skipped: true, reason: activeCheck.reason };
    }

    const result = await messaging.conversationEngine.handleIncomingMessage({
      userId: job.user_id,
      channel: job.channel || "dashboard",
      conversationId: job.conversation_id,
      text: job.customer_message,
      shouldSendExternalReply: false,
    });

    return {
      reply: result.reply,
      planUsed: result.planUsed,
      conversationId: result.conversationId,
      toneUsed: result.toneUsed,
      replyLengthUsed: result.replyLengthUsed,
      modelUsed: result.modelUsed,
      extractedData: result.extractedData,
      confidence: result.confidence,
      escalationReason: result.escalationReason,
      escalated: result.escalated,
    };
  }

  async function runOneQueuedJob() {
    if (isJobWorkerRunning) return;
    isJobWorkerRunning = true;

    try {
      const { data: queuedJob, error: queueErr } = await supabaseAdmin
        .from("jobs")
        .select(
          QUEUED_JOB_SELECT_FIELDS
        )
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (queueErr) {
        console.error("Worker queue fetch failed:", queueErr.message);
        return;
      }

      if (!queuedJob) return;

      const { data: claimedJob, error: claimErr } = await supabaseAdmin
        .from("jobs")
        .update({
          status: "processing",
          attempts: (queuedJob.attempts || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", queuedJob.id)
        .eq("status", "queued")
        .select(
          QUEUED_JOB_SELECT_FIELDS
        )
        .maybeSingle();

      if (claimErr) {
        console.error("Worker claim failed:", claimErr.message);
        return;
      }

      if (!claimedJob) return;

      try {
        const result = await processReplyJob(claimedJob);
        const { error: doneErr } = await supabaseAdmin
          .from("jobs")
          .update({
            status: "done",
            result,
            error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", claimedJob.id);

        if (doneErr) {
          console.error("Worker done update failed:", doneErr.message);
        }
      } catch (err) {
        const { error: failErr } = await supabaseAdmin
          .from("jobs")
          .update({
            status: "failed",
            error: String(err?.message || err || "Job failed"),
            updated_at: new Date().toISOString(),
          })
          .eq("id", claimedJob.id);

        if (failErr) {
          console.error("Worker failed update failed:", failErr.message);
        }
      }
    } finally {
      isJobWorkerRunning = false;
    }
  }

  return {
    getTodayIsoDateInTimezone,
    buildAiReply,
    insertMessageWithFallback,
    handleIncomingMessage,
    processReplyJob,
    runOneQueuedJob,
    setMessaging,
  };
}
