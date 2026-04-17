/* ================================
  WhatsApp helpers: client config + phone number resolution, paused
  conversation lookup, inbound deduping, message sending, owner-side
  forwarding, and owner reply handling.
================================ */
export function createWhatsAppService({ supabaseAdmin, learnFromHumanReply }) {
  // --- Multi-client WhatsApp helpers ---

  async function getClientWhatsAppConfig(userId) {
    if (!userId) return null;
    const { data, error } = await supabaseAdmin
      .from("client_settings")
      .select("whatsapp_phone_number_id, whatsapp_access_token, whatsapp_connected")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.error("[WA] getClientWhatsAppConfig error:", error.message);
      return null;
    }
    if (!data?.whatsapp_connected || !data?.whatsapp_access_token || !data?.whatsapp_phone_number_id) {
      return null;
    }
    return {
      phoneNumberId: data.whatsapp_phone_number_id,
      accessToken: data.whatsapp_access_token,
      connected: true,
    };
  }

  async function findClientByPhoneNumberId(phoneNumberId) {
    if (!phoneNumberId) return null;
    const { data, error } = await supabaseAdmin
      .from("client_settings")
      .select("user_id")
      .eq("whatsapp_phone_number_id", phoneNumberId)
      .eq("whatsapp_connected", true)
      .maybeSingle();
    if (error) {
      console.error("[WA] findClientByPhoneNumberId error:", error.message);
      return null;
    }
    return data?.user_id || null;
  }

  async function isWhatsAppConnected(userId) {
    const config = await getClientWhatsAppConfig(userId);
    return !!config?.connected;
  }

  // --- End multi-client WhatsApp helpers ---

  function normalizePhoneForMatch(value) {
    return String(value || "").replaceAll(/[^\d]/g, "");
  }

  async function resolveBusinessOwnerByPhone(rawPhone) {
    const normalizedSender = normalizePhoneForMatch(rawPhone);
    if (!normalizedSender) return null;

    const { data, error } = await supabaseAdmin
      .from("client_settings")
      .select("user_id,owner_phone_number")
      .not("owner_phone_number", "is", null)
      .limit(5000);

    if (error) {
      const errText = String(error.message || "").toLowerCase();
      if (
        errText.includes("owner_phone_number") ||
        errText.includes(SCHEMA_CACHE_TEXT) ||
        errText.includes(DOES_NOT_EXIST_TEXT)
      ) {
        return null;
      }
      throw new Error(error.message);
    }

    const matches = [];
    for (const row of data || []) {
      const candidate = normalizePhoneForMatch(row?.owner_phone_number);
      if (!candidate) continue;
      if (candidate === normalizedSender) {
        matches.push({
          userId: row.user_id,
          businessOwnerPhone: row.owner_phone_number,
        });
      }
    }

    if (matches.length === 1) {
      return matches[0];
    }

    if (matches.length > 1) {
      console.warn("[WA DEBUG] owner_phone_match_ambiguous", {
        normalizedSender,
        matchCount: matches.length,
      });
      return {
        ambiguous: true,
        matchCount: matches.length,
      };
    }

    return null;
  }

  async function getPausedWhatsAppConversations(userId) {
    const { data, error } = await supabaseAdmin
      .from("conversations")
      .select("id,status,state,ai_paused,external_user_id,external_conversation_id,last_message_at")
      .eq("user_id", userId)
      .eq("channel", "whatsapp")
      .order("last_message_at", { ascending: false })
      .limit(50);

    if (error) throw new Error(error.message);

    return (data || []).filter(
      (row) =>
        row?.ai_paused === true ||
        row?.status === "escalated" ||
        row?.state === "human_mode"
    );
  }

  async function getLatestPausedWhatsAppConversation(userId) {
    const paused = await getPausedWhatsAppConversations(userId);
    return paused[0] || null;
  }

  async function reserveWhatsAppInboundMessage({
    metaMessageId,
    userId = null,
    externalUserId = null,
    conversationId = null,
  }) {
    const safeMessageId = String(metaMessageId || "").trim();
    if (!safeMessageId) return false;

    const { error } = await supabaseAdmin.from("whatsapp_inbound_events").insert({
      meta_message_id: safeMessageId,
      user_id: userId || null,
      external_user_id: String(externalUserId || "").trim() || null,
      conversation_id: conversationId || null,
    });

    if (!error) return false;

    const errorText = String(error.message || "").toLowerCase();
    if (
      error.code === "23505" ||
      errorText.includes("duplicate key") ||
      errorText.includes("unique constraint")
    ) {
      return true;
    }

    if (
      errorText.includes("whatsapp_inbound_events") &&
      (errorText.includes(DOES_NOT_EXIST_TEXT) || errorText.includes(SCHEMA_CACHE_TEXT))
    ) {
      console.warn(
        "[WA DEBUG] webhook:dedupe_table_missing - continuing without dedupe",
        error.message
      );
      return false;
    }

    throw new Error(error.message);
  }

  async function sendWhatsAppTextMessage({ to, text, clientConfig }) {
    if (!clientConfig?.accessToken || !clientConfig?.phoneNumberId) {
      throw new Error("Missing WhatsApp credentials — per-client config required");
    }

    const token = String(clientConfig.accessToken).trim();
    const phoneNumberId = clientConfig.phoneNumberId;

    const resp = await fetch(
      `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
        }),
      }
    );

    const responseText = await resp.text();
    console.log("[WA DEBUG] sendWhatsAppTextMessage:graph_response", {
      to,
      status: resp.status,
      body: responseText,
    });
    if (!resp.ok) {
      throw new Error(`WhatsApp send failed (HTTP ${resp.status}): ${responseText}`);
    }
    return responseText;
  }

  async function maybeForwardPausedInboundToOwner({
    userId,
    from,
    incomingText,
    conversationId,
  }) {
    if (!userId || !from || !incomingText) return;

    const { data, error } = await supabaseAdmin
      .from("client_settings")
      .select("owner_phone_number")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      const errText = String(error.message || "").toLowerCase();
      if (errText.includes("owner_phone_number")) return;
      throw new Error(error.message);
    }

    const ownerPhone = String(data?.owner_phone_number || "").trim();
    if (!ownerPhone) return;

    const normalizedOwner = normalizePhoneForMatch(ownerPhone);
    const normalizedFrom = normalizePhoneForMatch(from);
    if (!normalizedOwner || !normalizedFrom || normalizedOwner === normalizedFrom) return;

    const config = await getClientWhatsAppConfig(userId);
    const text = `Customer ${from} (${conversationId}): ${incomingText}`;
    await sendWhatsAppTextMessage({ to: ownerPhone, text, clientConfig: config });
  }

  async function processBusinessOwnerWhatsAppReply({
    userId,
    incomingText,
    from,
  }) {
    const conversation = await getLatestPausedWhatsAppConversation(userId);
    if (!conversation?.id) {
      console.log("[WA DEBUG] owner_reply:no_paused_conversation", { userId, from });
      return { handled: true, sentToCustomer: false };
    }

    const customerRecipient =
      String(conversation.external_user_id || "").trim() ||
      String(conversation.external_conversation_id || "").trim();
    if (!customerRecipient) {
      console.log("[WA DEBUG] owner_reply:missing_customer_recipient", {
        userId,
        conversationId: conversation.id,
      });
      return { handled: true, sentToCustomer: false };
    }

    const config = await getClientWhatsAppConfig(userId);
    await sendWhatsAppTextMessage({ to: customerRecipient, text: incomingText, clientConfig: config });

    const { error: msgErr } = await supabaseAdmin.from("messages").insert({
      user_id: userId,
      conversation_id: conversation.id,
      channel: "whatsapp",
      customer_message: "",
      ai_reply: "",
      human_reply: incomingText,
      escalated: false,
    });
    if (msgErr) throw new Error(msgErr.message || "Failed to store owner WhatsApp reply");

    const nowIso = new Date().toISOString();
    const nextStatus =
      conversation.status === "escalated" ? "escalated" : "waiting_customer";
    const { error: convoErr } = await supabaseAdmin
      .from("conversations")
      .update({
        status: nextStatus,
        state: "human_mode",
        ai_paused: true,
        last_message_at: nowIso,
        last_message_preview: String(incomingText).slice(0, 280),
        updated_at: nowIso,
      })
      .eq("id", conversation.id)
      .eq("user_id", userId);

    if (convoErr) throw new Error(convoErr.message || "Failed to update conversation");

    // Learn from the owner's reply so future questions get answered automatically
    if (typeof learnFromHumanReply === "function") {
      try {
        await learnFromHumanReply({
          userId,
          conversationId: conversation.id,
          humanReply: incomingText,
          forceLearn: false,
        });
      } catch (learnErr) {
        console.error("WhatsApp owner reply learning failed:", learnErr?.message || learnErr);
      }
    }

    return {
      handled: true,
      sentToCustomer: true,
      conversationId: conversation.id,
      customerRecipient,
    };
  }

  return {
    getClientWhatsAppConfig,
    findClientByPhoneNumberId,
    isWhatsAppConnected,
    normalizePhoneForMatch,
    resolveBusinessOwnerByPhone,
    getPausedWhatsAppConversations,
    getLatestPausedWhatsAppConversation,
    reserveWhatsAppInboundMessage,
    sendWhatsAppTextMessage,
    maybeForwardPausedInboundToOwner,
    processBusinessOwnerWhatsAppReply,
  };
}
