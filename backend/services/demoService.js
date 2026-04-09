import crypto from "node:crypto";
import {
  SCHEMA_CACHE_TEXT,
  ESCALATION_REPLY_MESSAGE,
} from "../config/constants.js";

/**
 * Demo conversation seeding. Used by /api/demo/generate.
 *
 * Depends on a few helpers that still live in server.js (booking timezone +
 * message-insert fallback). They're injected via deps so demoService stays
 * decoupled and can be moved before the rest of server.js is refactored.
 */
export function createDemoService({
  supabaseAdmin,
  getTodayIsoDateInTimezone,
  loadBusinessTimezone,
  insertMessageWithFallback,
}) {
  async function setUserDemoModeFlag({ userId, enabled }) {
    try {
      const { error } = await supabaseAdmin
        .from("client_settings")
        .upsert(
          {
            user_id: userId,
            demo_mode: Boolean(enabled),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

      if (!error) return;

      const errText = String(error.message || "").toLowerCase();
      if (errText.includes("demo_mode")) return;
      throw new Error(error.message);
    } catch (err) {
      const message = String(err?.message || "").toLowerCase();
      if (message.includes("demo_mode") || message.includes(SCHEMA_CACHE_TEXT)) return;
      throw err;
    }
  }

  function demoScenariosForDate(todayIso) {
    return [
      {
        title: "Vegan menu question",
        intent: "faq",
        status: "waiting_customer",
        priority: "normal",
        state: "idle",
        thread: [
          {
            customer: "Hello, do you have vegan food?",
            ai: "Yes, we do. We have vegan pasta, grilled vegetables, and a vegan burger. Would you like the full menu highlights?",
            extractedData: { intent: "faq", status: "incomplete", missing: [] },
            escalated: false,
          },
        ],
      },
      {
        title: "Booking for Friday",
        intent: "booking",
        status: "waiting_customer",
        priority: "normal",
        state: "booking_confirmed",
        thread: [
          {
            customer: "I want to book a table for 4 on Friday",
            ai: "Great, I can help with that. What time on Friday would you like the table?",
            extractedData: {
              intent: "booking",
              date: todayIso,
              time: null,
              people: "4",
              name: null,
              phone: null,
              status: "incomplete",
              missing: ["time", "name", "phone"],
            },
            escalated: false,
          },
          {
            customer: "19:00, name is Sara and phone is 0701234567",
            ai: "Perfect, you are booked for 4 guests on Friday at 19:00 under Sara (0701234567). See you then.",
            extractedData: {
              intent: "booking",
              date: todayIso,
              time: "19:00",
              people: "4",
              name: "Sara",
              phone: "0701234567",
              status: "complete",
              missing: [],
            },
            escalated: false,
          },
        ],
      },
      {
        title: "Opening hours",
        intent: "faq",
        status: "waiting_customer",
        priority: "normal",
        state: "idle",
        thread: [
          {
            customer: "What time do you close?",
            ai: "We close at 22:00 on weekdays and 23:00 on Friday and Saturday.",
            extractedData: { intent: "faq", status: "incomplete", missing: [] },
            escalated: false,
          },
        ],
      },
      {
        title: "Address inquiry",
        intent: "faq",
        status: "waiting_customer",
        priority: "normal",
        state: "idle",
        thread: [
          {
            customer: "Where are you located?",
            ai: "We are at Storgatan 12, Stockholm. If you want, I can also share nearby parking info.",
            extractedData: { intent: "faq", status: "incomplete", missing: [] },
            escalated: false,
          },
        ],
      },
      {
        title: "Refund request",
        intent: "complaint",
        status: "escalated",
        priority: "high",
        state: "human_mode",
        thread: [
          {
            customer: "I want a refund",
            ai: ESCALATION_REPLY_MESSAGE,
            extractedData: {
              intent: "other",
              confidence: "low",
              escalation_reason: "refund",
              status: "incomplete",
              missing: [],
            },
            escalated: true,
          },
        ],
      },
      {
        title: "Menu and pricing",
        intent: "faq",
        status: "waiting_customer",
        priority: "normal",
        state: "idle",
        thread: [
          {
            customer: "Can I see your menu prices?",
            ai: "Of course. Main dishes range from 120 to 210 SEK, and lunch specials start at 99 SEK.",
            extractedData: { intent: "faq", status: "incomplete", missing: [] },
            escalated: false,
          },
        ],
      },
      {
        title: "Allergy question",
        intent: "complaint",
        status: "escalated",
        priority: "high",
        state: "human_mode",
        thread: [
          {
            customer: "I have a severe nut allergy, can you guarantee no cross contamination?",
            ai: ESCALATION_REPLY_MESSAGE,
            extractedData: {
              intent: "other",
              confidence: "low",
              escalation_reason: "allergy",
              status: "incomplete",
              missing: [],
            },
            escalated: true,
          },
        ],
      },
      {
        title: "Large party booking",
        intent: "booking",
        status: "waiting_customer",
        priority: "normal",
        state: "booking_collecting",
        thread: [
          {
            customer: "Can I reserve for 10 people tomorrow?",
            ai: "Yes, we can check that. Please share your preferred time, name, and phone number.",
            extractedData: {
              intent: "booking",
              date: todayIso,
              time: null,
              people: "10",
              name: null,
              phone: null,
              status: "incomplete",
              missing: ["time", "name", "phone"],
            },
            escalated: false,
          },
        ],
      },
      {
        title: "Complaint follow-up",
        intent: "complaint",
        status: "escalated",
        priority: "high",
        state: "human_mode",
        thread: [
          {
            customer: "Your staff was rude yesterday and I want to speak to the manager",
            ai: ESCALATION_REPLY_MESSAGE,
            extractedData: {
              intent: "other",
              confidence: "low",
              escalation_reason: "complaint",
              status: "incomplete",
              missing: [],
            },
            escalated: true,
          },
        ],
      },
      {
        title: "Takeaway options",
        intent: "faq",
        status: "waiting_customer",
        priority: "normal",
        state: "idle",
        thread: [
          {
            customer: "Do you do takeaway and delivery?",
            ai: "Yes, we offer takeaway all day and delivery between 12:00 and 21:30.",
            extractedData: { intent: "faq", status: "incomplete", missing: [] },
            escalated: false,
          },
        ],
      },
      {
        title: "Booking change request",
        intent: "booking",
        status: "waiting_customer",
        priority: "normal",
        state: "booking_collecting",
        thread: [
          {
            customer: "I need to change my booking from 4 people to 6",
            ai: "No problem, I updated it to 6 guests. Please confirm the date and time so I can finalize it.",
            extractedData: {
              intent: "booking",
              date: null,
              time: null,
              people: "6",
              name: null,
              phone: null,
              status: "incomplete",
              missing: ["date", "time", "name", "phone"],
            },
            escalated: false,
          },
        ],
      },
      {
        title: "Language switch request",
        intent: "faq",
        status: "waiting_customer",
        priority: "normal",
        state: "idle",
        thread: [
          {
            customer: "Kan du svara på svenska?",
            ai: "Absolut, jag kan svara på svenska. Hur kan jag hjälpa dig?",
            extractedData: { intent: "faq", status: "incomplete", missing: [] },
            escalated: false,
          },
        ],
      },
    ];
  }

  async function insertDemoConversationRow(row) {
    const base = {
      id: row.id,
      user_id: row.user_id,
      channel: row.channel,
      external_conversation_id: row.external_conversation_id,
      external_user_id: row.external_user_id,
      title: row.title,
      status: row.status,
      last_message_at: row.last_message_at,
      last_message_preview: row.last_message_preview,
      intent: row.intent,
      priority: row.priority,
      created_at: row.created_at,
      updated_at: row.updated_at,
      manual_mode: row.manual_mode,
      state: row.state,
    };

    let payload = { ...base };
    let { error } = await supabaseAdmin
      .from("conversations")
      .upsert(payload, { onConflict: "id" });

    if (!error) return;

    const errText = String(error.message || "").toLowerCase();
    if (errText.includes("manual_mode")) {
      const retryPayload = { ...payload };
      delete retryPayload.manual_mode;
      const retry = await supabaseAdmin
        .from("conversations")
        .upsert(retryPayload, { onConflict: "id" });
      error = retry.error;
      payload = retryPayload;
      if (!error) return;
    }

    const errText2 = String(error?.message || "").toLowerCase();
    if (errText2.includes("state")) {
      const retryPayload = { ...payload };
      delete retryPayload.state;
      const retry = await supabaseAdmin
        .from("conversations")
        .upsert(retryPayload, { onConflict: "id" });
      error = retry.error;
      if (!error) return;
    }

    throw new Error(error.message);
  }

  async function generateDemoConversations({ userId, count = 12 }) {
    const safeCount = Math.max(10, Math.min(20, Number(count) || 12));
    const todayIso = getTodayIsoDateInTimezone(await loadBusinessTimezone(userId));
    const scenarios = demoScenariosForDate(todayIso);
    const nowMs = Date.now();

    let conversationsInserted = 0;
    let messagesInserted = 0;

    for (let i = 0; i < safeCount; i++) {
      const scenario = scenarios[i % scenarios.length];
      const conversationId = crypto.randomUUID();
      const startTimeMs = nowMs - (safeCount - i) * 6 * 60 * 1000;
      const thread = Array.isArray(scenario.thread) ? scenario.thread : [];
      const lastTurn = thread.at(-1) || null;
      const lastPreview = String(lastTurn?.ai || lastTurn?.customer || "").slice(0, 280);
      const isEscalated = scenario.status === "escalated";
      const startIso = new Date(startTimeMs).toISOString();
      const endIso = new Date(startTimeMs + Math.max(thread.length - 1, 0) * 60 * 1000).toISOString();

      await insertDemoConversationRow({
        id: conversationId,
        user_id: userId,
        channel: "dashboard",
        external_conversation_id: null,
        external_user_id: null,
        title: `${scenario.title} ${i + 1}`,
        status: scenario.status || "waiting_customer",
        last_message_at: endIso,
        last_message_preview: lastPreview,
        intent: scenario.intent || "other",
        priority: scenario.priority || "normal",
        manual_mode: isEscalated,
        state: scenario.state || (isEscalated ? "human_mode" : "idle"),
        created_at: startIso,
        updated_at: endIso,
      });

      conversationsInserted += 1;

      for (let t = 0; t < thread.length; t++) {
        const turn = thread[t];
        const createdAt = new Date(startTimeMs + t * 60 * 1000).toISOString();
        const { error } = await insertMessageWithFallback({
          user_id: userId,
          conversation_id: conversationId,
          channel: "dashboard",
          customer_message: String(turn.customer || "").trim() || "Hello",
          ai_reply: String(turn.ai || "").trim() || "Thanks for your message.",
          model_used: "demo_seed",
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          estimated_cost_usd: 0,
          extracted_data: turn.extractedData || { intent: scenario.intent || "other" },
          escalated: Boolean(turn.escalated),
          created_at: createdAt,
        });

        if (error) throw new Error(error.message || "Failed to insert demo message");
        messagesInserted += 1;
      }
    }

    return {
      conversationsInserted,
      messagesInserted,
    };
  }

  return {
    setUserDemoModeFlag,
    demoScenariosForDate,
    insertDemoConversationRow,
    generateDemoConversations,
  };
}
