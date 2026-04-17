// Customer-facing messages when a business is inactive.
// Deliberately vague — don't expose internal subscription details.
const INACTIVE_REPLY = {
  en: "This service is temporarily unavailable. Please contact the business directly.",
  sv: "Denna tjänst är tillfälligt otillgänglig. Vänligen kontakta företaget direkt.",
  ar: "هذه الخدمة غير متوفرة مؤقتاً. يرجى التواصل مع النشاط التجاري مباشرة.",
};

function detectLanguageFromText(text) {
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017E]/.test(text)) return "sv";
  return "en";
}

function getInactiveReply(language = "en") {
  return INACTIVE_REPLY[language] || INACTIVE_REPLY.en;
}

export function createWhatsAppAdapter(deps) {
  const {
    supabaseAdmin,
    store,
    engine,
    getClientWhatsAppConfig,
    findClientByPhoneNumberId,
    isBusinessActive,
    incrementMonthlyUsage,
    incrementMonthlyStat,
    learnFromHumanReply,
  } = deps;

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

  function normalizePhoneForMatch(value) {
    return String(value || "").replace(/[^\d]/g, "");
  }

  async function maybeForwardPausedInboundToOwner({
    userId,
    from,
    incomingText,
    conversationId,
    clientConfig,
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

    // Load per-client config if not already provided
    const config = clientConfig || (getClientWhatsAppConfig
      ? await getClientWhatsAppConfig(userId)
      : null);
    const text = `Customer ${from} (${conversationId}): ${incomingText}`;
    await sendWhatsAppTextMessage({ to: ownerPhone, text, clientConfig: config });
  }

  async function processBusinessOwnerWhatsAppReply({ userId, incomingText, from, clientConfig }) {
    const pausedConversations = store.getPausedWhatsAppConversations
      ? await store.getPausedWhatsAppConversations(userId)
      : [];

    if (pausedConversations.length > 1) {
      console.log("[WA DEBUG] owner_reply:ambiguous_multiple_paused_conversations", {
        userId,
        from,
        count: pausedConversations.length,
        preview: String(incomingText || "").slice(0, 120),
      });
      return {
        handled: true,
        sentToCustomer: false,
        ambiguous: true,
        pausedConversationCount: pausedConversations.length,
      };
    }

    const conversation =
      pausedConversations[0] || (await store.getLatestPausedWhatsAppConversation(userId));
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

    // Use per-client config if provided, otherwise load it
    const config = clientConfig || (getClientWhatsAppConfig
      ? await getClientWhatsAppConfig(userId)
      : null);
    await sendWhatsAppTextMessage({ to: customerRecipient, text: incomingText, clientConfig: config });

    const insertPayload = {
      user_id: userId,
      conversation_id: conversation.id,
      channel: "whatsapp",
      customer_message: "",
      ai_reply: "",
      human_reply: incomingText,
      extracted_data: {
        human_reply_source: "owner_whatsapp",
      },
      escalated: conversation.status === "escalated",
    };

    if (store.insertMessageWithFallback) {
      const { error: msgErr } = await store.insertMessageWithFallback(insertPayload);
      if (msgErr) throw new Error(msgErr.message || "Failed to store owner WhatsApp reply");
    } else {
      const { error: msgErr } = await supabaseAdmin.from("messages").insert(insertPayload);
      if (msgErr) throw new Error(msgErr.message || "Failed to store owner WhatsApp reply");
    }

    const nowIso = new Date().toISOString();
    const nextStatus = conversation.status === "escalated" ? "escalated" : "waiting_customer";
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
  // eslint-disable-next-line sonarjs/cognitive-complexity
  function parseInboundMessages(body, expectedPhoneNumberId) {
    const events = [];
    const entries = Array.isArray(body?.entry) ? body.entry : [];

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value || {};
        const metadata = value?.metadata || {};
        const phoneNumberId = metadata?.phone_number_id || "";
        const messages = Array.isArray(value?.messages) ? value.messages : [];

        if (!messages.length) continue;
        if (expectedPhoneNumberId && phoneNumberId !== expectedPhoneNumberId) {
          console.log("[WA DEBUG] webhook:skip_phone_number_id_mismatch", {
            phoneNumberId,
            expectedPhoneNumberId,
          });
          continue;
        }

        for (const msg of messages) {
          if (msg?.type !== "text") continue;
          const incomingText = String(msg?.text?.body || "").trim();
          const from = String(msg?.from || "").trim();
          const metaMessageId = String(msg?.id || "").trim();
          if (!incomingText || !from) continue;
          events.push({ from, incomingText, metaMessageId, phoneNumberId });
        }
      }
    }

    return events;
  }
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async function handleInboundWebhook({ body }) {
    let rawBody = "";
    try {
      rawBody = JSON.stringify(body);
    } catch {
      rawBody = "[unserializable body]";
    }
    console.log("[WA DEBUG] webhook:raw_body", rawBody);

    // Accept all phone_number_ids for multi-client routing;
    // pass empty string so parseInboundMessages does not filter.
    const events = parseInboundMessages(body, "");

    for (const event of events) {
      const { from, incomingText, metaMessageId, phoneNumberId } = event;
      console.log("[WA DEBUG] webhook:parsed_message", {
        from,
        incomingText,
        metaMessageId,
        phoneNumberId,
      });

      const timings = {};
      const t0 = Date.now();
      const markStage = (label) => {
        timings[label] = Date.now() - t0;
      };

      let stage = "resolveClientByPhoneNumberId";
      try {
        stage = "resolveBusinessOwnerByPhone";
        const ownerMatch = await store.resolveBusinessOwnerByPhone(from);
        if (ownerMatch?.ambiguous) {
          console.warn("[WA DEBUG] webhook:owner_match_ambiguous_skip_owner_mode", {
            from,
            matchCount: ownerMatch.matchCount || null,
          });
        }
        if (ownerMatch?.userId) {
          console.log("[WA DEBUG] webhook:owner_reply_detected", {
            from,
            ownerUserId: ownerMatch.userId,
          });
          stage = "dedupeInboundMessage";
          const ownerDuplicate = await store.reserveWhatsAppInboundMessage({
            metaMessageId,
            userId: ownerMatch.userId,
            externalUserId: from,
            conversationId: null,
          });
          if (ownerDuplicate) {
            console.log("[WA DEBUG] webhook:skip_duplicate_owner_message", {
              from,
              metaMessageId,
            });
            continue;
          }

          stage = "processBusinessOwnerWhatsAppReply";
          // Load per-client config for the owner so reply goes through their account
          const ownerConfig = getClientWhatsAppConfig
            ? await getClientWhatsAppConfig(ownerMatch.userId)
            : null;
          await processBusinessOwnerWhatsAppReply({
            userId: ownerMatch.userId,
            incomingText,
            from,
            clientConfig: ownerConfig,
          });
          continue;
        }

        // Multi-client routing: resolve client by the phone_number_id from webhook metadata
        stage = "resolveClientByPhoneNumberId";
        let clientId = null;
        if (findClientByPhoneNumberId && phoneNumberId) {
          clientId = await findClientByPhoneNumberId(phoneNumberId);
          if (clientId) {
            console.log("[WA DEBUG] webhook:resolved_client_by_phone_number_id", {
              phoneNumberId,
              clientId,
            });
          }
        }

        if (!clientId) {
          console.warn("[WA] webhook:unresolvable_message — no tenant found for phone_number_id, dropping message", {
            phoneNumberId,
            from,
            metaMessageId,
          });
          continue;
        }
        markStage("resolveTenantMs");
        console.log("[WA DEBUG] webhook:chosen_clientId", { from, clientId });

        stage = "dedupeInboundMessage";
        const isDuplicate = await store.reserveWhatsAppInboundMessage({
          metaMessageId,
          userId: clientId,
          externalUserId: from,
          conversationId: null,
        });
        if (isDuplicate) {
          console.log("[WA DEBUG] webhook:skip_duplicate_message", {
            from,
            metaMessageId,
          });
          continue;
        }

        // Gate: check plan is active and within message limit BEFORE calling AI
        if (typeof isBusinessActive === "function") {
          stage = "checkBusinessActive";
          const activeCheck = await isBusinessActive(clientId);
          if (!activeCheck.active) {
            console.log(`⛔ [WA] Business ${clientId} inactive (${activeCheck.reason}) — message blocked`);
            try {
              const cfg = getClientWhatsAppConfig
                ? await getClientWhatsAppConfig(clientId)
                : null;
              await sendWhatsAppTextMessage({
                to: from,
                text: getInactiveReply(detectLanguageFromText(incomingText)),
                clientConfig: cfg,
              });
            } catch (sendErr) {
              console.error("[WA] Failed to send inactive notice:", sendErr?.message || sendErr);
            }
            continue;
          }
        }

        stage = "handleIncomingMessage";
        const engineStartMs = Date.now();
        const result = await engine.handleIncomingMessage({
          userId: clientId,
          channel: "whatsapp",
          externalConversationId: from,
          externalUserId: from,
          text: incomingText,
          shouldSendExternalReply: true,
        });
        timings.engineHandleMs = Date.now() - engineStartMs;
        if (result?.timings) {
          Object.assign(timings, result.timings);
        }

        if (result.reply && String(result.reply).trim()) {
          stage = "sendWhatsAppTextMessage";
          // Load per-client WhatsApp config for sending
          const clientConfig = getClientWhatsAppConfig
            ? await getClientWhatsAppConfig(clientId)
            : null;
          const sendStartMs = Date.now();
          await sendWhatsAppTextMessage({ to: from, text: result.reply, clientConfig });
          timings.sendMetaMs = Date.now() - sendStartMs;

          // Increment usage counter after a successful AI reply is delivered
          if (typeof incrementMonthlyUsage === "function") {
            try {
              await incrementMonthlyUsage({ businessId: clientId });
            } catch (usageErr) {
              console.error("[WA] Usage increment failed:", usageErr?.message || usageErr);
            }
          }
          if (typeof incrementMonthlyStat === "function") {
            try {
              await incrementMonthlyStat({ businessId: clientId, statName: "ai_messages_sent" });
            } catch (_e) { /* non-critical */ }
          }
        } else {
          console.log("[WA DEBUG] webhook:skip_send_no_ai_reply", {
            from,
            metaMessageId,
            escalated: result.escalated,
          });
        }
      } catch (innerErr) {
        console.error("WhatsApp message handling failed:", {
          stage,
          error: innerErr?.message || innerErr,
        });
      } finally {
        timings.totalMs = Date.now() - t0;
        console.log("[WA TIMING] webhook:event_summary", {
          from,
          metaMessageId,
          ...timings,
        });
      }
    }

    return { ok: true };
  }

  return {
    sendWhatsAppTextMessage,
    maybeForwardPausedInboundToOwner,
    processBusinessOwnerWhatsAppReply,
    parseInboundMessages,
    handleInboundWebhook,
  };
}
