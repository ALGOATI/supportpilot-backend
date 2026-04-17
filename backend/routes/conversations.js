import express from "express";
import crypto from "node:crypto";
import {
  SERVER_ERROR_MESSAGE,
  CONVERSATION_NOT_FOUND_MESSAGE,
  CONVERSATION_DETAIL_SELECT_FIELDS,
  QUEUED_JOB_SELECT_FIELDS,
} from "../config/constants.js";
import { UUID_REGEX } from "../middleware/auth.js";
import { publicRateLimit, widgetRateLimit } from "../middleware/rateLimiter.js";
import { sanitizeExternalIdentifier } from "../config/utils.js";
import { getPlanDefaults } from "../config/planConfig.js";

/* ================================
  Conversation routes — covers the dashboard reply queue, inbound message
  intake (dashboard / WhatsApp / website widget), conversation listing
  and detail, manual replies, and the public /api/chat passthrough.
================================ */
export function createConversationsRouter({
  supabaseAdmin,
  requireSupabaseUser,
  verifyWidgetClient,
  // services
  loadUserPlan,
  getMessageLimitForPlan,
  getMessageLengthValidation,
  buildMessageTooLongPayload,
  processReplyJob,
  buildLegacyConversations,
  detectConversationTags,
  buildConversationTitle,
  getConversationByIdForUser,
  getClientWhatsAppConfig,
  learnFromHumanReply,
  knowledgeService,
  openAiSupportService,
  usageService,
  monthlyStatsService,
  messaging,
}) {
  const router = express.Router();

  router.post("/api/reply", requireSupabaseUser, async (req, res) => {
    try {
      const userMessage = String(req.body?.userMessage || "").trim();
      const { conversationId } = req.body || {};
      const convoId = conversationId || crypto.randomUUID();

      if (!userMessage) {
        return res.status(400).json({ error: "Missing 'userMessage'" });
      }

      const userPlan = await loadUserPlan(req.user.id);
      const lengthValidation = getMessageLengthValidation({
        text: userMessage,
        plan: userPlan,
      });
      if (lengthValidation.isTooLong) {
        return res.status(400).json(
          buildMessageTooLongPayload(lengthValidation.maxMessageChars)
        );
      }

      const { data: job, error: jobErr } = await supabaseAdmin
        .from("jobs")
        .insert({
          user_id: req.user.id,
          conversation_id: convoId,
          channel: "dashboard",
          customer_message: userMessage,
          status: "queued",
        })
        .select("id, conversation_id")
        .single();

      if (jobErr) {
        return res.status(500).json({ error: jobErr.message });
      }

      return res.json({
        ok: true,
        jobId: job.id,
        conversationId: job.conversation_id,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  // eslint-disable-next-line sonarjs/cognitive-complexity
  router.get("/api/job/:id", requireSupabaseUser, async (req, res) => {
    try {
      const jobId = req.params.id;
      let { data: job, error } = await supabaseAdmin
        .from("jobs")
        .select("id,status,result,error,conversation_id")
        .eq("id", jobId)
        .eq("user_id", req.user.id)
        .maybeSingle();

      if (error) return res.status(500).json({ error: error.message });
      if (!job) return res.status(404).json({ error: "Job not found" });

      // Fallback path: if a queued job is polled, try to process it immediately.
      if (job.status === "queued") {
        const { data: claimedJob, error: claimErr } = await supabaseAdmin
          .from("jobs")
          .update({
            status: "processing",
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId)
          .eq("user_id", req.user.id)
          .eq("status", "queued")
          .select(
            QUEUED_JOB_SELECT_FIELDS
          )
          .maybeSingle();

        if (claimErr) {
          console.error("Job poll claim failed:", claimErr.message);
        } else if (claimedJob) {
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
              console.error("Job poll done update failed:", doneErr.message);
            }
          } catch (runErr) {
            const { error: failErr } = await supabaseAdmin
              .from("jobs")
              .update({
                status: "failed",
                error: String(runErr?.message || runErr || "Job failed"),
                updated_at: new Date().toISOString(),
              })
              .eq("id", claimedJob.id);
            if (failErr) {
              console.error("Job poll failed update failed:", failErr.message);
            }
          }

          const refresh = await supabaseAdmin
            .from("jobs")
            .select("id,status,result,error,conversation_id")
            .eq("id", jobId)
            .eq("user_id", req.user.id)
            .maybeSingle();
          if (!refresh.error && refresh.data) {
            job = refresh.data;
          }
        }
      }

      return res.json({
        ok: true,
        status: job.status,
        result: job.result,
        error: job.error,
        conversationId: job.conversation_id,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.post("/api/inbound", publicRateLimit, requireSupabaseUser, async (req, res) => {
    try {
      const channel = String(req.body?.channel || "").trim().toLowerCase();
      const externalConversationId = String(req.body?.externalConversationId || "").trim();
      const externalUserId = String(req.body?.externalUserId || "").trim() || null;
      const text = String(req.body?.text || "").trim();
      const clientId = String(req.body?.clientId || "").trim();

      if (!["dashboard", "whatsapp", "instagram", "website"].includes(channel)) {
        return res.status(400).json({ error: "Invalid 'channel'" });
      }

      if (!externalConversationId || !text || !clientId) {
        return res.status(400).json({
          error:
            "Missing required fields: channel, externalConversationId, text, clientId",
        });
      }

      // clientId must belong to the authenticated user — prevents acting as another account
      if (clientId !== req.user.id) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const userPlan = await loadUserPlan(clientId);
      const lengthValidation = getMessageLengthValidation({ text, plan: userPlan });
      if (lengthValidation.isTooLong) {
        return res.status(400).json(
          buildMessageTooLongPayload(lengthValidation.maxMessageChars)
        );
      }

      const result = await messaging.conversationEngine.handleIncomingMessage({
        userId: clientId,
        channel,
        externalConversationId,
        externalUserId,
        text,
        shouldSendExternalReply: channel === "whatsapp",
      });

      return res.json({
        reply: result.reply,
        conversationId: result.conversationId,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.get("/api/widget/config", widgetRateLimit, verifyWidgetClient, async (req, res) => {
    try {
      const clientId = String(req.query?.clientId || "").trim();
      if (!clientId) {
        return res.status(400).json({ error: "Missing 'clientId'" });
      }

      const plan = await loadUserPlan(clientId);
      const maxMessageChars = getMessageLimitForPlan(plan);
      return res.json({
        ok: true,
        channel: "website",
        plan,
        maxMessageChars,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.post("/api/widget/message", widgetRateLimit, verifyWidgetClient, async (req, res) => {
    try {
      const clientId = String(req.body?.clientId || "").trim();
      const text = String(req.body?.text || "").trim();
      const incomingConversationId = String(req.body?.conversationId || "").trim();
      const visitorId = sanitizeExternalIdentifier(req.body?.visitorId, "visitor");
      const externalConversationId = sanitizeExternalIdentifier(
        req.body?.externalConversationId || `website:${visitorId}`,
        "website"
      );

      if (!clientId || !text) {
        return res
          .status(400)
          .json({ error: "Missing required fields: clientId, text" });
      }

      const plan = await loadUserPlan(clientId);
      const lengthValidation = getMessageLengthValidation({ text, plan });
      if (lengthValidation.isTooLong) {
        return res.status(400).json(
          buildMessageTooLongPayload(lengthValidation.maxMessageChars)
        );
      }

      const result = await messaging.conversationEngine.handleIncomingMessage({
        userId: clientId,
        channel: "website",
        conversationId: incomingConversationId || null,
        externalConversationId,
        externalUserId: visitorId,
        text,
        shouldSendExternalReply: false,
      });

      return res.json({
        ok: true,
        channel: "website",
        reply: result.reply || "",
        conversationId: result.conversationId || incomingConversationId || null,
        externalConversationId,
        visitorId,
        plan,
        maxMessageChars: lengthValidation.maxMessageChars,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.get("/api/conversations", requireSupabaseUser, async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("conversations")
        .select(
          "id,user_id,channel,external_conversation_id,external_user_id,title,status,state,last_message_at,last_message_preview,intent,priority,ai_paused,created_at,updated_at"
        )
        .eq("user_id", req.user.id)
        .order("last_message_at", { ascending: false })
        .limit(500);

      if (error) {
        console.error("Conversations query failed, falling back to messages:", error.message);
        const fallback = await buildLegacyConversations(req.user.id);
        return res.json({ conversations: fallback });
      }

      if (!data || data.length === 0) {
        const fallback = await buildLegacyConversations(req.user.id);
        return res.json({ conversations: fallback });
      }

      return res.json({
        conversations: data || [],
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.get("/api/conversations/escalated", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;

      const [escalatedConversationsQuery, escalatedMessagesQuery] = await Promise.all([
        supabaseAdmin
          .from("conversations")
          .select(
            "id,user_id,channel,external_conversation_id,external_user_id,title,status,state,last_message_at,last_message_preview,intent,priority,ai_paused,created_at,updated_at"
          )
          .eq("user_id", userId)
          .eq("status", "escalated")
          .order("last_message_at", { ascending: false })
          .limit(500),
        supabaseAdmin
          .from("messages")
          .select("conversation_id,created_at,escalated,extracted_data")
          .eq("user_id", userId)
          .eq("escalated", true)
          .order("created_at", { ascending: false })
          .limit(2000),
      ]);

      if (escalatedConversationsQuery.error) {
        return res.status(500).json({ error: escalatedConversationsQuery.error.message });
      }
      if (escalatedMessagesQuery.error) {
        return res.status(500).json({ error: escalatedMessagesQuery.error.message });
      }

      const escalatedByConversation = new Map();
      for (const row of escalatedMessagesQuery.data || []) {
        const conversationId = String(row?.conversation_id || "").trim();
        if (!conversationId) continue;
        if (escalatedByConversation.has(conversationId)) continue;
        escalatedByConversation.set(conversationId, row);
      }

      const convoMap = new Map();
      for (const convo of escalatedConversationsQuery.data || []) {
        convoMap.set(convo.id, convo);
      }

      const missingConversationIds = Array.from(escalatedByConversation.keys()).filter(
        (id) => !convoMap.has(id)
      );

      if (missingConversationIds.length) {
        const { data: extraConversations, error: extraErr } = await supabaseAdmin
          .from("conversations")
          .select(
            "id,user_id,channel,external_conversation_id,external_user_id,title,status,state,last_message_at,last_message_preview,intent,priority,ai_paused,created_at,updated_at"
          )
          .eq("user_id", userId)
          .in("id", missingConversationIds.slice(0, 500));

        if (extraErr) {
          return res.status(500).json({ error: extraErr.message });
        }

        for (const convo of extraConversations || []) {
          convoMap.set(convo.id, convo);
        }
      }

      const rows = Array.from(convoMap.values())
        .map((convo) => {
          const escalatedMsg = escalatedByConversation.get(convo.id);
          const reason = String(escalatedMsg?.extracted_data?.escalation_reason || "").trim() || null;
          return {
            ...convo,
            escalation_reason: reason,
            escalated_at: escalatedMsg?.created_at || null,
          };
        })
        .sort((a, b) => +new Date(b.last_message_at || b.updated_at || 0) - +new Date(a.last_message_at || a.updated_at || 0));

      return res.json({ conversations: rows });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  // eslint-disable-next-line sonarjs/cognitive-complexity
  router.get("/api/conversations/:conversationId/messages", requireSupabaseUser, async (req, res) => {
    try {
      const conversationId = req.params.conversationId;
      const syntheticNoConvoId = conversationId.startsWith("no-convo:")
        ? conversationId.slice("no-convo:".length)
        : null;
      const messageLookupColumn = syntheticNoConvoId ? "id" : "conversation_id";
      const messageLookupValue = syntheticNoConvoId || conversationId;

      let { data: conversation, error: convoErr } = await supabaseAdmin
        .from("conversations")
        .select(
          CONVERSATION_DETAIL_SELECT_FIELDS
        )
        .eq("user_id", req.user.id)
        .eq("id", conversationId)
        .maybeSingle();

      if (convoErr) {
        console.error(
          "Conversation lookup failed, falling back to messages:",
          convoErr.message
        );
        conversation = null;
      }

      let data = null;
      let error = null;

      const withHumanReply = await supabaseAdmin
        .from("messages")
        .select(
          "id,created_at,channel,conversation_id,customer_message,ai_reply,human_reply,extracted_data"
        )
        .eq("user_id", req.user.id)
        .eq(messageLookupColumn, messageLookupValue)
        .order("created_at", { ascending: true });

      if (withHumanReply.error && String(withHumanReply.error.message || "").includes("human_reply")) {
        const fallback = await supabaseAdmin
          .from("messages")
          .select(
            "id,created_at,channel,conversation_id,customer_message,ai_reply,extracted_data"
          )
          .eq("user_id", req.user.id)
          .eq(messageLookupColumn, messageLookupValue)
          .order("created_at", { ascending: true });
        data = (fallback.data || []).map((row) => ({ ...row, human_reply: null }));
        error = fallback.error;
      } else {
        data = withHumanReply.data || [];
        error = withHumanReply.error;
      }

      if (error) return res.status(500).json({ error: error.message });
      if (!data || data.length === 0) {
        return res.status(404).json({ error: CONVERSATION_NOT_FOUND_MESSAGE });
      }

      if (!conversation) {
        const latest = data.at(-1);
        const { data: mapRow, error: mapErr } = await supabaseAdmin
          .from("conversation_map")
          .select("external_conversation_id, external_user_id")
          .eq("user_id", req.user.id)
          .eq("conversation_id", conversationId)
          .maybeSingle();

        if (mapErr) return res.status(500).json({ error: mapErr.message });

        const extractedData = latest?.extracted_data || null;
        const { intent, priority } = detectConversationTags({
          extractedData,
          text: latest?.customer_message || latest?.ai_reply || latest?.human_reply || "",
        });

        conversation = {
          id: conversationId,
          title: buildConversationTitle({
            channel: latest?.channel || "dashboard",
            externalUserId: mapRow?.external_user_id || null,
            firstMessage:
              data[0]?.customer_message || data[0]?.ai_reply || data[0]?.human_reply || "",
          }),
          status: "open",
          state: "idle",
          priority,
          intent,
          channel: latest?.channel || "dashboard",
          external_conversation_id: mapRow?.external_conversation_id || null,
          external_user_id: mapRow?.external_user_id || null,
          ai_paused: false,
          last_message_at: latest?.created_at || data[0]?.created_at,
          last_message_preview:
            latest?.customer_message || latest?.ai_reply || latest?.human_reply || "—",
        };
      }

      return res.json({
        conversationId,
        conversation,
        messages: data || [],
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  // eslint-disable-next-line sonarjs/cognitive-complexity
  router.post("/api/conversation/reply", requireSupabaseUser, async (req, res) => {
    try {
      const conversationId = String(req.body?.conversationId || "").trim();
      const message = String(req.body?.message || "").trim();
      const markForLearning = Boolean(req.body?.markForLearning);

      if (!conversationId || !message) {
        return res.status(400).json({ error: "Missing required fields: conversationId, message" });
      }

      const { data: conversation, error: convoErr } = await supabaseAdmin
        .from("conversations")
        .select("id,channel,status,state,external_conversation_id,external_user_id")
        .eq("id", conversationId)
        .eq("user_id", req.user.id)
        .maybeSingle();

      if (convoErr) return res.status(500).json({ error: convoErr.message });
      if (!conversation) return res.status(404).json({ error: CONVERSATION_NOT_FOUND_MESSAGE });

      let sentExternally = false;
      if (conversation.channel === "whatsapp") {
        let externalUserId = String(conversation.external_user_id || "").trim();
        if (!externalUserId) {
          const { data: mapRow, error: mapErr } = await supabaseAdmin
            .from("conversation_map")
            .select("external_user_id")
            .eq("user_id", req.user.id)
            .eq("conversation_id", conversationId)
            .maybeSingle();
          if (mapErr) return res.status(500).json({ error: mapErr.message });
          externalUserId = String(mapRow?.external_user_id || "").trim();
        }

        const to = externalUserId || String(conversation.external_conversation_id || "").trim();
        if (!to) {
          return res.status(400).json({ error: "Missing WhatsApp recipient on conversation" });
        }
        // Load per-client WhatsApp config for sending through the correct account
        const clientConfig = await getClientWhatsAppConfig(req.user.id);
        await messaging.whatsappAdapter.sendWhatsAppTextMessage({ to, text: message, clientConfig });
        sentExternally = true;
      }

      const insertPayload = {
        user_id: req.user.id,
        conversation_id: conversationId,
        channel: conversation.channel || "dashboard",
        customer_message: "",
        ai_reply: "",
        human_reply: message,
        escalated: false,
      };

      const { error: msgErr } = await supabaseAdmin.from("messages").insert(insertPayload);
      if (msgErr) return res.status(500).json({ error: msgErr.message });

      const nowIso = new Date().toISOString();
      const nextStatus =
        conversation.status === "escalated" ? "escalated" : "waiting_customer";
      const { error: convoUpdateErr } = await supabaseAdmin
        .from("conversations")
        .update({
          status: nextStatus,
          state: "human_mode",
          ai_paused: true,
          last_message_at: nowIso,
          last_message_preview: message.slice(0, 280),
          updated_at: nowIso,
        })
        .eq("id", conversationId)
        .eq("user_id", req.user.id);

      if (convoUpdateErr) return res.status(500).json({ error: convoUpdateErr.message });

      let learning = { learned: false, reason: "skipped" };
      try {
        learning = await learnFromHumanReply({
          userId: req.user.id,
          conversationId,
          humanReply: message,
          forceLearn: markForLearning,
        });
      } catch (learnErr) {
        console.error("Knowledge learning failed:", learnErr?.message || learnErr);
      }

      return res.json({
        success: true,
        ok: true,
        conversationId,
        channel: conversation.channel,
        sentExternally,
        learning,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.patch("/api/conversations/:conversationId", requireSupabaseUser, async (req, res) => {
    try {
      const conversationId = req.params.conversationId;
      const { title, status, priority } = req.body || {};

      const patch = {
        updated_at: new Date().toISOString(),
      };

      if (title !== undefined) {
        patch.title = String(title || "").trim();
      }
      if (status !== undefined) {
        if (!["open", "waiting_customer", "escalated", "resolved"].includes(status)) {
          return res.status(400).json({ error: "Invalid status" });
        }
        patch.status = status;
        if (status === "resolved") {
          patch.state = "resolved";
          patch.ai_paused = false;
        } else if (status === "escalated") {
          patch.state = "human_mode";
          patch.ai_paused = true;
        } else if (status === "open" || status === "waiting_customer") {
          patch.state = "idle";
          patch.ai_paused = false;
        }
      }
      if (priority !== undefined) {
        if (!["low", "normal", "high"].includes(priority)) {
          return res.status(400).json({ error: "Invalid priority" });
        }
        patch.priority = priority;
      }

      const { data, error } = await supabaseAdmin
        .from("conversations")
        .update(patch)
        .eq("id", conversationId)
        .eq("user_id", req.user.id)
        .select(
          CONVERSATION_DETAIL_SELECT_FIELDS
        )
        .maybeSingle();

      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: CONVERSATION_NOT_FOUND_MESSAGE });

      return res.json({ conversation: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.post(
    "/api/conversations/:conversationId/resume-ai",
    requireSupabaseUser,
    async (req, res) => {
      try {
        const conversationId = String(req.params.conversationId || "").trim();
        if (!conversationId) {
          return res.status(400).json({ error: "Missing conversationId" });
        }

        const conversation = await getConversationByIdForUser({
          userId: req.user.id,
          conversationId,
        });

        if (!conversation) {
          return res.status(404).json({ error: CONVERSATION_NOT_FOUND_MESSAGE });
        }

        let nextStatus = conversation.status || "open";
        if (conversation.status === "resolved") {
          nextStatus = "resolved";
        } else if (conversation.status === "escalated") {
          nextStatus = "open";
        }

        const { error } = await supabaseAdmin
          .from("conversations")
          .update({
            ai_paused: false,
            status: nextStatus,
            state: nextStatus === "resolved" ? "resolved" : "idle",
            updated_at: new Date().toISOString(),
          })
          .eq("id", conversationId)
          .eq("user_id", req.user.id);

        if (error) return res.status(500).json({ error: error.message });

        const { data: refreshed, error: readErr } = await supabaseAdmin
          .from("conversations")
          .select(
            CONVERSATION_DETAIL_SELECT_FIELDS
          )
          .eq("id", conversationId)
          .eq("user_id", req.user.id)
          .maybeSingle();

        if (readErr) return res.status(500).json({ error: readErr.message });
        return res.json({ success: true, ok: true, conversation: refreshed || null });
      } catch (e) {
        console.error(e);
        return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
      }
    }
  );

  router.patch("/api/conversations/:conversationId/actions", requireSupabaseUser, async (req, res) => {
    try {
      const conversationId = req.params.conversationId;
      const { action } = req.body || {};
      const statusByAction = {
        escalate: "escalated",
        close: "resolved",
        reopen: "open",
      };
      const nextStatus = statusByAction[action];

      if (!nextStatus) {
        return res.status(400).json({ error: "Invalid action" });
      }
      let nextState = "idle";
      if (nextStatus === "resolved") {
        nextState = "resolved";
      } else if (nextStatus === "escalated") {
        nextState = "human_mode";
      }

      const { data, error } = await supabaseAdmin
        .from("conversations")
        .update({
          status: nextStatus,
          state: nextState,
          ai_paused: nextStatus === "escalated",
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId)
        .eq("user_id", req.user.id)
        .select(
          CONVERSATION_DETAIL_SELECT_FIELDS
        )
        .maybeSingle();

      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: CONVERSATION_NOT_FOUND_MESSAGE });

      return res.json({ conversation: data });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  // eslint-disable-next-line sonarjs/cognitive-complexity
  router.post("/api/chat", publicRateLimit, async (req, res) => {
    try {
      const businessId = String(req.body?.business_id || "").trim();
      const message = String(req.body?.message || "").trim();

      if (!businessId || !message) {
        return res.status(400).json({ error: "Missing required fields: business_id, message" });
      }
      if (!UUID_REGEX.test(businessId)) {
        return res.status(400).json({ error: "Invalid business_id" });
      }

      const businessQuery = await supabaseAdmin
        .from("client_settings")
        .select("user_id,name,plan,ai_model")
        .eq("user_id", businessId)
        .maybeSingle();

      if (businessQuery.error) {
        return res.status(500).json({ error: businessQuery.error.message });
      }
      if (!businessQuery.data) {
        return res.status(404).json({ error: "Business not found" });
      }

      const business = businessQuery.data;
      const capState = await usageService.isGlobalDailyCapReached();
      if (capState.isReached) {
        await usageService.logGlobalCapAlert();
        console.error("[SAFETY] Global daily AI hard cap reached.", {
          date: capState.date,
          currentCount: capState.currentCount,
          cap: capState.cap,
        });
        return res.status(429).json({
          ok: false,
          code: "global_ai_paused",
          reply:
            "AI replies are temporarily paused right now. Please try again shortly.",
        });
      }

      const monthlyStatus = await usageService.getMonthlyUsageStatus({
        businessId,
        maxMessages: getPlanDefaults(business.plan).max_messages,
      });
      if (monthlyStatus.isOverLimit) {
        return res.status(429).json({
          ok: false,
          code: "plan_limit_reached",
          reply:
            "You've reached your monthly AI reply limit. Please upgrade your plan to continue.",
          limit: monthlyStatus.limit,
          used: monthlyStatus.usage.aiRepliesUsed,
          month: monthlyStatus.monthKey,
        });
      }

      const knowledgeBase = await knowledgeService.loadKnowledgeBase(businessId, {
        activeOnly: true,
        limit: 250,
      });
      const cachedAnswer = await knowledgeService.findCachedAnswer({
        businessId,
        message,
        prefetchedRows: knowledgeBase,
      });
      if (cachedAnswer?.answer) {
        return res.status(200).json({
          ok: true,
          cached: true,
          source: cachedAnswer.source,
          reply: cachedAnswer.answer,
        });
      }

      const aiResult = await openAiSupportService.generateReply({
        businessName: business.name || businessId,
        message,
        knowledgeBase,
        model: business.ai_model || "gpt-4o-mini",
      });

      const nextUsage = await usageService.incrementMonthlyUsage({
        businessId,
        monthKey: monthlyStatus.monthKey,
        delta: 1,
      });
      await usageService.logApiCall({
        businessId,
        tokensUsed: aiResult.tokensUsed,
        date: usageService.getDateKey(),
      });
      try {
        await monthlyStatsService.incrementMonthlyStat({ businessId, statName: "ai_messages_sent" });
      } catch (_e) { /* non-critical */ }

      return res.status(200).json({
        ok: true,
        cached: false,
        reply: aiResult.reply,
        usage: {
          month: monthlyStatus.monthKey,
          used: nextUsage,
          limit: monthlyStatus.limit,
        },
      });
    } catch (err) {
      console.error("API chat failed:", err?.message || err);
      return res.status(500).json({
        ok: false,
        error: "Failed to generate chat reply",
      });
    }
  });

  return router;
}
