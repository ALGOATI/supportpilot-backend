import {
  SCHEMA_CACHE_TEXT,
  DOES_NOT_EXIST_TEXT,
  BOOKING_SELECT_FIELDS,
} from "../config/constants.js";

/* ================================
  Booking helpers: draft management, intent/cancellation/confirmation
  detection, preferred reply language persistence, and active draft
  context for prompt rendering.
================================ */
export function createBookingService({ supabaseAdmin }) {
  function isMissingRelationError(error, relationName) {
    const text = String(error?.message || "").toLowerCase();
    return (
      (error?.code === "42P01" || text.includes(DOES_NOT_EXIST_TEXT)) &&
      text.includes(String(relationName || "").toLowerCase())
    );
  }

  function shouldTreatMessageAsBookingStart(text, extractedData) {
    const content = String(text || "").toLowerCase();
    if (extractedData?.intent === "booking") return true;
    return /\b(book|booking|reserve|reservation|table)\b/i.test(content);
  }

  function isNewBookingRequest(text) {
    const content = String(text || "").toLowerCase();
    return /\b(book again|another booking|new booking|another reservation|book a new)\b/i.test(
      content
    );
  }

  function isBookingCorrectionMessage(text) {
    const content = String(text || "").toLowerCase();
    return (
      /\b(no[, ]*i meant|no i meant|actually|correction|you made a mistake)\b/i.test(content) ||
      /\bnot\b.+\bbut\b/i.test(content) ||
      /\bnot\s+\d+\s+(people|persons|guests)\b/i.test(content)
    );
  }

  function isBookingCancellationRequest(text) {
    const content = String(text || "").toLowerCase();
    return /\b(cancel|cancel it|cancel booking|never mind|dont book|don't book)\b/i.test(content);
  }

  function isBookingConfirmationMessage(text) {
    const content = String(text || "").toLowerCase();
    return /\b(confirm|confirmed|go ahead|book it|that works|sounds good|yes please)\b/i.test(
      content
    );
  }

  function detectPreferredReplyLanguage(text) {
    const content = String(text || "").toLowerCase();
    if (!content) return null;

    if (
      /\b(reply in english|speak english|in english|english please)\b/i.test(content)
    ) {
      return "en";
    }

    if (
      /\b(kan du svara på svenska|svara på svenska|på svenska|svenska tack)\b/i.test(content)
    ) {
      return "sv";
    }

    if (
      /\b(تكلم بالعربية|بالعربية|عربي|العربية)\b/i.test(content) ||
      /\b(reply in arabic|speak arabic|in arabic)\b/i.test(content)
    ) {
      return "ar";
    }

    return null;
  }

  function getPreferredLanguagePromptHint(languageCode) {
    if (languageCode === "sv") {
      return "Swedish";
    }
    if (languageCode === "ar") {
      return "Arabic";
    }
    if (languageCode === "en") {
      return "English";
    }
    return null;
  }

  function detectFlowIntentOverride(text) {
    const content = String(text || "").toLowerCase();
    if (!content) {
      return { overrideBookingFlow: false, intentOverride: null };
    }

    const asksHuman =
      /\b(real person|human|staff|support|agent)\b/i.test(content) &&
      /\b(connect|talk|speak|need|want)\b/i.test(content);
    if (asksHuman) {
      return { overrideBookingFlow: true, intentOverride: "other" };
    }

    const asksLanguage =
      /\b(swedish|svenska|english|arabic|العربية|language|svara på)\b/i.test(content);
    if (asksLanguage) {
      return { overrideBookingFlow: true, intentOverride: "faq" };
    }

    const asksAddress = /\b(where are you|address|location|located)\b/i.test(content);
    if (asksAddress) {
      return { overrideBookingFlow: true, intentOverride: "faq" };
    }

    const asksHours = /\b(when are you open|opening hours|what time do you open|are you open today|hours|open|close)\b/i.test(
      content
    );
    if (asksHours) {
      return { overrideBookingFlow: true, intentOverride: "faq" };
    }

    const asksMenu = /\b(menu|what do you serve|what food do you have|food|dish|items)\b/i.test(
      content
    );
    if (asksMenu) {
      return { overrideBookingFlow: true, intentOverride: "faq" };
    }

    return { overrideBookingFlow: false, intentOverride: null };
  }

  async function loadConversationPreferredLanguage({ userId, conversationId }) {
    if (!userId || !conversationId) return null;
    const { data, error } = await supabaseAdmin
      .from("conversations")
      .select("preferred_reply_language")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      const errText = String(error.message || "").toLowerCase();
      if (
        errText.includes("preferred_reply_language") ||
        errText.includes(SCHEMA_CACHE_TEXT) ||
        errText.includes(DOES_NOT_EXIST_TEXT)
      ) {
        return null;
      }
      throw new Error(error.message);
    }

    const value = String(data?.preferred_reply_language || "").trim().toLowerCase();
    if (value === "sv" || value === "en" || value === "ar") return value;
    return null;
  }

  async function saveConversationPreferredLanguage({
    userId,
    conversationId,
    languageCode,
  }) {
    if (!userId || !conversationId || !languageCode) return;
    const code = String(languageCode || "").trim().toLowerCase();
    if (!["sv", "en", "ar"].includes(code)) return;

    const { error } = await supabaseAdmin
      .from("conversations")
      .update({
        preferred_reply_language: code,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .eq("user_id", userId);

    if (error) {
      const errText = String(error.message || "").toLowerCase();
      if (
        errText.includes("preferred_reply_language") ||
        errText.includes(SCHEMA_CACHE_TEXT) ||
        errText.includes(DOES_NOT_EXIST_TEXT)
      ) {
        return;
      }
      throw new Error(error.message);
    }
  }

  function normalizeDraftBookingField(value) {
    const normalized = String(value || "").trim();
    return normalized || null;
  }

  function hasAnyBookingDraftField(extractedData) {
    return Boolean(
      extractedData?.date ||
        extractedData?.time ||
        extractedData?.people ||
        extractedData?.name ||
        extractedData?.phone
    );
  }

  function buildActiveBookingDraftContext(draft) {
    if (!draft) return "";
    return [
      "Active booking draft:",
      `- Date: ${draft.booking_date || "missing"}`,
      `- Time: ${draft.booking_time || "missing"}`,
      `- People: ${draft.people || "missing"}`,
      `- Name: ${draft.customer_name || "missing"}`,
      `- Phone: ${draft.customer_phone || "missing"}`,
      "- Use this draft as the only active booking context. Ignore old confirmed/completed/cancelled bookings.",
    ].join("\n");
  }

  async function getActiveBookingDraft({
    userId,
    conversationId = null,
    externalUserId = null,
  }) {
    const query = supabaseAdmin
      .from("bookings")
      .select(
        BOOKING_SELECT_FIELDS
      )
      .eq("user_id", userId)
      .eq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (conversationId) {
      query.eq("conversation_id", conversationId);
    } else if (externalUserId) {
      query.eq("external_user_id", externalUserId);
    } else {
      return null;
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      if (isMissingRelationError(error, "bookings")) return null;
      throw new Error(error.message);
    }
    return data || null;
  }

  async function finalizeBookingDraft({ bookingId, userId, status }) {
    if (!bookingId || !userId || !status) return;
    const { error } = await supabaseAdmin
      .from("bookings")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bookingId)
      .eq("user_id", userId);
    if (error && !isMissingRelationError(error, "bookings")) {
      throw new Error(error.message);
    }
  }

  async function upsertBookingDraft({
    userId,
    channel,
    conversationId = null,
    externalUserId = null,
    extractedData,
    existingDraft = null,
  }) {
    const payload = {
      user_id: userId,
      conversation_id: conversationId || null,
      external_user_id: externalUserId || null,
      source_channel: channel || null,
      customer_name: normalizeDraftBookingField(extractedData?.name),
      customer_phone: normalizeDraftBookingField(extractedData?.phone),
      booking_date: normalizeDraftBookingField(extractedData?.date),
      booking_time: normalizeDraftBookingField(extractedData?.time),
      people: normalizeDraftBookingField(extractedData?.people),
      status: "draft",
      updated_at: new Date().toISOString(),
    };

    if (existingDraft?.id) {
      const updatePatch = {
        conversation_id: payload.conversation_id || existingDraft.conversation_id || null,
        external_user_id: payload.external_user_id || existingDraft.external_user_id || null,
        source_channel: payload.source_channel || existingDraft.source_channel || null,
        customer_name: payload.customer_name || existingDraft.customer_name || null,
        customer_phone: payload.customer_phone || existingDraft.customer_phone || null,
        booking_date: payload.booking_date || existingDraft.booking_date || null,
        booking_time: payload.booking_time || existingDraft.booking_time || null,
        people: payload.people || existingDraft.people || null,
        status: "draft",
        updated_at: payload.updated_at,
      };

      const { data, error } = await supabaseAdmin
        .from("bookings")
        .update(updatePatch)
        .eq("id", existingDraft.id)
        .eq("user_id", userId)
        .select(
          BOOKING_SELECT_FIELDS
        )
        .maybeSingle();

      if (error) {
        if (isMissingRelationError(error, "bookings")) return null;
        throw new Error(error.message);
      }
      return data || null;
    }

    const { data, error } = await supabaseAdmin
      .from("bookings")
      .insert(payload)
      .select(
        BOOKING_SELECT_FIELDS
      )
      .maybeSingle();

    if (error) {
      if (isMissingRelationError(error, "bookings")) return null;
      throw new Error(error.message);
    }
    return data || null;
  }

  async function maybeStartNewBooking({
    userId,
    text,
    currentDraft,
  }) {
    if (!currentDraft) return null;
    if (!isNewBookingRequest(text)) return currentDraft;
    await finalizeBookingDraft({
      bookingId: currentDraft.id,
      userId,
      status: "cancelled",
    });
    return null;
  }

  return {
    isMissingRelationError,
    shouldTreatMessageAsBookingStart,
    isNewBookingRequest,
    isBookingCorrectionMessage,
    isBookingCancellationRequest,
    isBookingConfirmationMessage,
    detectPreferredReplyLanguage,
    getPreferredLanguagePromptHint,
    detectFlowIntentOverride,
    loadConversationPreferredLanguage,
    saveConversationPreferredLanguage,
    normalizeDraftBookingField,
    hasAnyBookingDraftField,
    buildActiveBookingDraftContext,
    getActiveBookingDraft,
    finalizeBookingDraft,
    upsertBookingDraft,
    maybeStartNewBooking,
  };
}
