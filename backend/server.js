import "./config/env.js"; // loads dotenv + validates required env vars (must be first)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeBookingExtractionDate } from "./utils/dateNormalization.js";
import { createMessagingSystem } from "./messaging/index.js";
import { createUsageService } from "./services/usage/usageService.js";
import { createMonthlyStatsService } from "./services/usage/monthlyStatsService.js";
import { createKnowledgeService } from "./services/knowledge/knowledgeService.js";
import { createOpenAiSupportService } from "./services/ai/openAiSupportService.js";
import { createWixWebhookService } from "./services/wix/wixWebhookService.js";
import { createWixPaymentService } from "./services/wix/wixPaymentService.js";
import { createCalendarService } from "./services/calendar/calendarService.js";
import { getPlanDefaults } from "./config/planConfig.js";
import {
  getPlanLimits,
  getModelsForPlan,
  getModelForTask,
} from "./config/modelRouting.js";

  import express from "express";
  import helmet from "helmet";
  import { createClient } from "@supabase/supabase-js";
  import crypto from "node:crypto";
  import { createCorsMiddleware } from "./config/cors.js";
  import { publicRateLimit, widgetRateLimit } from "./middleware/rateLimiter.js";
  import { errorHandler } from "./middleware/errorHandler.js";
  import { createAuthMiddleware } from "./middleware/auth.js";
  import { createPlanService } from "./services/planService.js";
  import { createEscalationService } from "./services/escalationService.js";
  import { createDemoService } from "./services/demoService.js";
  import { createKnowledgeAnsweringService } from "./services/knowledgeAnsweringService.js";
  import { createBookingService } from "./services/bookingService.js";
  import { createWhatsAppService } from "./services/whatsappService.js";
  import { createAnalyticsService } from "./services/analyticsService.js";
  import { createConversationPipelineService } from "./services/conversationPipelineService.js";
  import {
    resolveBackendPublicBaseUrl,
    isSchemaCompatibilityError,
    isAiGloballyReady,
    sanitizeExternalIdentifier,
  } from "./config/utils.js";
  import {
    normalizeSetupHoursRows,
    normalizeSetupMenuItems,
  } from "./services/setupService.js";
  import { createConversationStoreService } from "./services/conversationStoreService.js";
  import { createDemoRouter } from "./routes/demo.js";
  import { createKnowledgeRouter } from "./routes/knowledge.js";
  import {
    styleRules,
    parsePricingMap,
    estimateCostUsd,
    getUsageFromOpenRouterResponse,
    buildConversationTitle,
    detectConversationTopic,
    buildRuleBasedConversationTitle,
    detectTopicFromTitle,
    isGenericConversationTitle,
    shouldUpdateConversationTitle,
    detectConversationTags,
    normalizeBusinessType,
    buildIndustryTemplateGuidance,
    evaluateResponseSafety,
    EMPTY_EXTRACTION,
    extractFirstJsonObject,
    extractFirstJsonArray,
    normalizeImportedMenuItems,
    normalizeExtraction,
    extractStructuredData,
  } from "./services/aiService.js";
  import {
    SERVER_ERROR_MESSAGE,
    SCHEMA_CACHE_TEXT,
    DOES_NOT_EXIST_TEXT,
    DEFAULT_TIMEZONE,
    NOT_PROVIDED_LABEL,
    OPENROUTER_CHAT_COMPLETIONS_URL,
    KB_SELECT_FIELDS,
    BOOKING_SELECT_FIELDS,
    QUEUED_JOB_SELECT_FIELDS,
    CONVERSATION_DETAIL_SELECT_FIELDS,
    MENU_EXTRACTION_ERROR_MESSAGE,
    CONVERSATION_NOT_FOUND_MESSAGE,
    ESCALATION_REPLY_MESSAGE,
  } from "./config/constants.js";

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const widgetScriptPath = path.join(__dirname, "widget", "widget.js");

  const app = express();
  // Render terminates TLS at a proxy, so trust the first hop. Required for
  // express-rate-limit to read X-Forwarded-For correctly and for req.protocol.
  app.set("trust proxy", 1);
  const PORT = process.env.PORT || 3001;
  const JOB_WORKER_POLL_MS = Number(process.env.JOB_WORKER_POLL_MS || 500);

  /* ================================
    SECURITY HEADERS
  ================================ */
  app.use(
    helmet({
      // Allow external sites to load /widget.js as an embedded script.
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  app.use(createCorsMiddleware());

  app.use(express.json({
    limit: '1mb',
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));

  console.log("✅ CORS middleware applied");
  console.log("🚀 Starting SupportPilot backend on port:", PORT);
  console.log("[DEBUG] __dirname:", __dirname);

  /* ================================
    SUPABASE ADMIN CLIENT
  ================================ */
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const usageService = createUsageService({ supabaseAdmin });
  const monthlyStatsService = createMonthlyStatsService({ supabaseAdmin });
  const knowledgeService = createKnowledgeService({ supabaseAdmin });
  const openAiSupportService = createOpenAiSupportService({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const wixWebhookService = createWixWebhookService({
    supabaseAdmin,
    usageService,
    webhookSecret: process.env.WIX_WEBHOOK_SECRET,
  });
  const wixPaymentService = createWixPaymentService({
    supabaseAdmin,
    dashboardUrl: process.env.DASHBOARD_URL,
  });
  const calendarService = createCalendarService({ supabaseAdmin });


  const { verifyWidgetClient, requireSupabaseUser } = createAuthMiddleware({ supabaseAdmin });

  const planService = createPlanService({ supabaseAdmin });
  const {
    getMessageLimitForPlan,
    getMessageLengthValidation,
    buildMessageTooLongPayload,
    getMonthStartIso,
    getUsageMonthKey,
    reserveConversationUsageAndIncrement,
    countMonthlyAiConversations,
    loadUserPlan,
    loadBusinessMaxMessages,
  } = planService;

  const escalationService = createEscalationService({ supabaseAdmin });
  const {
    findUserByEmail,
    buildEscalationNotificationPreview,
    sendEscalationEmailNotification,
    createEscalationNotification,
  } = escalationService;

  const knowledgeAnsweringService = createKnowledgeAnsweringService({ supabaseAdmin });
  const {
    loadStructuredBusinessKnowledge,
    loadKnowledgeBaseForPrompt,
    tryDirectKnowledgeAnswer,
    learnFromHumanReply,
    loadBusinessTimezone,
  } = knowledgeAnsweringService;

  const analyticsService = createAnalyticsService({ supabaseAdmin });
  const { buildAnalyticsOverview } = analyticsService;

  const conversationStoreService = createConversationStoreService({ supabaseAdmin });
  const {
    getConversationByIdForUser,
    updateConversationManualMode,
    getOrCreateConversationMap,
    upsertConversationRecord,
    buildLegacyConversations,
  } = conversationStoreService;

  const whatsappService = createWhatsAppService({
    supabaseAdmin,
    updateConversationManualMode,
  });
  const {
    resolveWhatsAppClientId,
    getClientWhatsAppConfig,
    findClientByPhoneNumberId,
    resolveBusinessOwnerByPhone,
    getPausedWhatsAppConversations,
    getLatestPausedWhatsAppConversation,
    reserveWhatsAppInboundMessage,
    sendWhatsAppTextMessage,
    maybeForwardPausedInboundToOwner,
    processBusinessOwnerWhatsAppReply,
  } = whatsappService;

  const bookingService = createBookingService({ supabaseAdmin });
  const {
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
    hasAnyBookingDraftField,
    buildActiveBookingDraftContext,
    getActiveBookingDraft,
    finalizeBookingDraft,
    upsertBookingDraft,
    maybeStartNewBooking,
  } = bookingService;

  const conversationPipelineService = createConversationPipelineService({
    supabaseAdmin,
    planService,
    knowledgeAnsweringService,
    bookingService,
    escalationService,
    whatsappService,
    styleRules,
    estimateCostUsd,
    getUsageFromOpenRouterResponse,
    evaluateResponseSafety,
    EMPTY_EXTRACTION,
    extractStructuredData,
    normalizeBusinessType,
    buildIndustryTemplateGuidance,
    getOrCreateConversationMap,
    getConversationByIdForUser,
    upsertConversationRecord,
    wixPaymentService,
  });
  const {
    getTodayIsoDateInTimezone,
    buildAiReply,
    insertMessageWithFallback,
    handleIncomingMessage,
    processReplyJob,
    runOneQueuedJob,
  } = conversationPipelineService;

  const demoService = createDemoService({
    supabaseAdmin,
    getTodayIsoDateInTimezone,
    loadBusinessTimezone,
    insertMessageWithFallback,
  });
  const { setUserDemoModeFlag, generateDemoConversations } = demoService;


  /* ================================
    BASIC ROUTES
  ================================ */
  app.get("/", (req, res) => {
    res.send("SupportPilot backend is running ✅");
  });

  app.get("/widget.js", (req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    res.type("application/javascript");
    res.sendFile(widgetScriptPath);
  });

  app.get("/__cors", (req, res) => {
    res.json({
      ok: true,
      origin: req.headers.origin || null,
      message: "CORS debug endpoint",
    });
  });

  const lazyAdapters = {};
  const messaging = createMessagingSystem({
    lazyAdapters,
    storeDeps: {
      getConversationByIdForUser,
      upsertConversationRecord,
      insertMessageWithFallback,
      updateConversationManualMode,
      getOrCreateConversationMap,
      reserveWhatsAppInboundMessage,
      loadBusinessTimezone,
      loadUserPlan,
      loadBusinessMaxMessages,
      getPlanLimits,
      getModelForTask,
      getModelsForPlan,
      countMonthlyAiConversations,
      reserveConversationUsageAndIncrement,
      getUsageMonthKey,
      getMonthStartIso,
      resolveBusinessOwnerByPhone,
      getPausedWhatsAppConversations,
      getLatestPausedWhatsAppConversation,
    },
    coreDeps: {
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
      updateConversationManualMode,
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
      incrementMonthlyStat: monthlyStatsService.incrementMonthlyStat,
      syncBookingToCalendar: calendarService.syncBookingToCalendar,
    },
    channelDeps: {
      supabaseAdmin,
      resolveWhatsAppClientId,
      getClientWhatsAppConfig,
      findClientByPhoneNumberId,
      isBusinessActive: wixPaymentService.isBusinessActive,
      incrementMonthlyUsage: usageService.incrementMonthlyUsage,
      incrementMonthlyStat: monthlyStatsService.incrementMonthlyStat,
    },
  });

  // processReplyJob (inside conversationPipelineService) calls
  // messaging.conversationEngine.handleIncomingMessage. Wire it up now
  // that the messaging system is constructed.
  conversationPipelineService.setMessaging(messaging);

  /* ================================
    PLAN FEATURES ENDPOINT + KNOWLEDGE LIMIT CHECK
  ================================ */
  app.use(
    createKnowledgeRouter({
      supabaseAdmin,
      requireSupabaseUser,
      loadUserPlan,
      knowledgeService,
    })
  );

  app.get("/api/plan/features", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const plan = await loadUserPlan(userId);
      const planConfig = getPlanDefaults(plan);

      return res.json({
        tier: plan,
        features: planConfig.features || {},
        limits: {
          maxMessages: planConfig.max_messages,
          maxKnowledge: planConfig.max_knowledge,
          maxWhatsappNumbers: planConfig.max_whatsapp_numbers,
        },
      });
    } catch (err) {
      console.error("Plan features error:", err?.message || err);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  /* ================================
    SECURE AI REPLY ROUTE
  ================================ */
  app.post("/api/reply", requireSupabaseUser, async (req, res) => {
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
  app.get("/api/job/:id", requireSupabaseUser, async (req, res) => {
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

  app.get("/api/setup/status", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;

      const [settingsQ, profileQ, hoursQ] = await Promise.all([
        supabaseAdmin
          .from("client_settings")
          .select("onboarding_completed")
          .eq("user_id", userId)
          .maybeSingle(),
        supabaseAdmin
          .from("business_profiles")
          .select("business_name")
          .eq("user_id", userId)
          .maybeSingle(),
        supabaseAdmin
          .from("business_hours")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
      ]);

      const hasProfile =
        Boolean(String(profileQ.data?.business_name || "").trim()) && !profileQ.error;
      const hasHours = Number(hoursQ.count || 0) >= 7 && !hoursQ.error;

      const completedFromSettings =
        !settingsQ.error && Boolean(settingsQ.data?.onboarding_completed);
      const completed = completedFromSettings || (hasProfile && hasHours);

      return res.json({
        completed,
        hasProfile,
        hasHours,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });
  // eslint-disable-next-line sonarjs/cognitive-complexity
  app.get("/api/release-status", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const validBusinessTypes = new Set([
        "restaurant",
        "barber",
        "clinic",
        "retail",
        "other",
      ]);

      const [
        profileQ,
        hoursQ,
        settingsQ,
        whatsappMapQ,
        whatsappConversationQ,
      ] = await Promise.all([
        supabaseAdmin
          .from("business_profiles")
          .select("business_name,address,phone,business_type")
          .eq("user_id", userId)
          .maybeSingle(),
        supabaseAdmin
          .from("business_hours")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
        supabaseAdmin
          .from("client_settings")
          .select("plan")
          .eq("user_id", userId)
          .maybeSingle(),
        supabaseAdmin
          .from("conversation_map")
          .select("conversation_id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("channel", "whatsapp"),
        supabaseAdmin
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("channel", "whatsapp"),
      ]);

      let profile = profileQ.data || null;
      if (profileQ.error) {
        if (isSchemaCompatibilityError(profileQ.error, ["business_profiles", "business_type"])) {
          const fallbackProfile = await supabaseAdmin
            .from("business_profiles")
            .select("business_name,address,phone")
            .eq("user_id", userId)
            .maybeSingle();
          if (fallbackProfile.error) {
            if (
              !isSchemaCompatibilityError(fallbackProfile.error, [
                "business_profiles",
                "address",
                "phone",
              ])
            ) {
              throw new Error(fallbackProfile.error.message);
            }
            profile = null;
          } else {
            profile = {
              ...fallbackProfile.data,
              business_type: null,
            };
          }
        } else {
          throw new Error(profileQ.error.message);
        }
      }

      const businessName = String(profile?.business_name || "").trim();
      const address = String(profile?.address || "").trim();
      const phone = String(profile?.phone || "").trim();
      const businessType = String(profile?.business_type || "").trim().toLowerCase();

      const businessProfileCompleted = Boolean(businessName && address && phone);
      const businessTypeSelected = validBusinessTypes.has(businessType);

      let openingHoursConfigured = false;
      if (!hoursQ.error) {
        openingHoursConfigured = Number(hoursQ.count || 0) >= 7;
      } else if (
        !isSchemaCompatibilityError(hoursQ.error, ["business_hours", "day_of_week"])
      ) {
        throw new Error(hoursQ.error.message);
      }

      let plan = "starter";
      let planSelected = false;
      if (!settingsQ.error) {
        plan = settingsQ.data?.plan || "starter";
        planSelected = ["trial", "starter", "pro", "business"].includes(plan);
      } else if (
        !isSchemaCompatibilityError(settingsQ.error, ["client_settings", "plan"])
      ) {
        throw new Error(settingsQ.error.message);
      }

      let hasWhatsAppMap = false;
      if (!whatsappMapQ.error) {
        hasWhatsAppMap = Number(whatsappMapQ.count || 0) > 0;
      } else if (
        !isSchemaCompatibilityError(whatsappMapQ.error, ["conversation_map", "channel"])
      ) {
        throw new Error(whatsappMapQ.error.message);
      }

      let hasWhatsAppConversation = false;
      if (!whatsappConversationQ.error) {
        hasWhatsAppConversation = Number(whatsappConversationQ.count || 0) > 0;
      } else if (
        !isSchemaCompatibilityError(whatsappConversationQ.error, ["conversations", "channel"])
      ) {
        throw new Error(whatsappConversationQ.error.message);
      }

      const defaultClientId = String(process.env.WHATSAPP_DEFAULT_CLIENT_ID || "").trim();
      const whatsappConnected =
        hasWhatsAppMap || hasWhatsAppConversation || defaultClientId === userId;

      const aiEnabled = isAiGloballyReady();
      const models = getModelsForPlan(plan);

      const checks = {
        business_profile_completed: businessProfileCompleted,
        opening_hours_configured: openingHoursConfigured,
        business_type_selected: businessTypeSelected,
        whatsapp_connected: whatsappConnected,
        ai_enabled: aiEnabled,
        plan_selected: planSelected,
      };

      const missingItems = Object.entries(checks)
        .filter(([, isComplete]) => !isComplete)
        .map(([key]) => key);

      const total = Object.keys(checks).length;
      const done = total - missingItems.length;
      const percent = total > 0 ? Math.round((done / total) * 100) : 0;
      const readyToLaunch = missingItems.length === 0;

      const backendBaseUrl = resolveBackendPublicBaseUrl(req);

      return res.json({
        ready_to_launch: readyToLaunch,
        plan,
        models,
        checks,
        missing_items: missingItems,
        completion: {
          done,
          total,
          percent,
        },
        public_urls: {
          backend_base_url: backendBaseUrl,
          whatsapp_webhook_url: `${backendBaseUrl}/webhooks/whatsapp`,
          widget_script_url: `${backendBaseUrl}/widget.js`,
        },
      });
    } catch (e) {
      console.error("Release status endpoint failed:", e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.post("/api/setup/business", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const {
        business_name,
        address,
        phone,
        timezone,
        business_type,
      } = req.body || {};

      const payload = {
        user_id: userId,
        business_name: String(business_name || "").trim() || null,
        business_type: normalizeBusinessType(business_type),
        address: String(address || "").trim() || null,
        phone: String(phone || "").trim() || null,
        timezone: String(timezone || "").trim() || DEFAULT_TIMEZONE,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabaseAdmin
        .from("business_profiles")
        .upsert(payload, { onConflict: "user_id" });

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.post("/api/setup/hours", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const hours = normalizeSetupHoursRows(req.body?.hours);
      const nowIso = new Date().toISOString();
      const rows = hours.map((row) => ({
        user_id: userId,
        day_of_week: row.day_of_week,
        is_closed: row.is_closed,
        open_time: row.open_time,
        close_time: row.close_time,
        updated_at: nowIso,
      }));

      const { error } = await supabaseAdmin
        .from("business_hours")
        .upsert(rows, { onConflict: "user_id,day_of_week" });

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.post("/api/setup/menu", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const items = normalizeSetupMenuItems(req.body?.items);
      if (!items.length) return res.json({ ok: true, inserted: 0 });

      const nowIso = new Date().toISOString();
      const rows = items.map((row) => ({
        user_id: userId,
        name: row.name,
        price: row.price,
        description: row.description,
        category: row.category,
        available: true,
        tags: [],
        updated_at: nowIso,
      }));

      const { error } = await supabaseAdmin.from("menu_items").insert(rows);
      if (error) return res.status(500).json({ error: error.message });

      return res.json({ ok: true, inserted: rows.length });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });
  // eslint-disable-next-line sonarjs/cognitive-complexity
  app.post("/api/setup/booking-rules", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const maxPartyRaw = req.body?.max_party_size;
      const maxPartySize =
        maxPartyRaw === null || maxPartyRaw === undefined || maxPartyRaw === ""
          ? null
          : Number(maxPartyRaw);
      const bookingRequiredRaw =
        req.body?.booking_required ?? req.body?.booking_enabled ?? true;
      const advanceNoticeRaw = req.body?.advance_notice_minutes;
      const advanceNoticeMinutes =
        advanceNoticeRaw === null || advanceNoticeRaw === undefined || advanceNoticeRaw === ""
          ? null
          : Number(advanceNoticeRaw);

      const payload = {
        user_id: userId,
        booking_enabled: Boolean(bookingRequiredRaw),
        booking_required: Boolean(bookingRequiredRaw),
        require_name: true,
        require_phone: true,
        max_party_size: Number.isFinite(maxPartySize) ? maxPartySize : null,
        advance_notice_minutes: Number.isFinite(advanceNoticeMinutes)
          ? advanceNoticeMinutes
          : null,
        updated_at: new Date().toISOString(),
      };

      const bookingUpsert = await supabaseAdmin
        .from("booking_rules")
        .upsert(payload, { onConflict: "user_id" });
      if (bookingUpsert.error) {
        const errText = String(bookingUpsert.error.message || "").toLowerCase();
        if (
          errText.includes("booking_required") ||
          errText.includes("advance_notice_minutes")
        ) {
          const fallbackPayload = {
            user_id: userId,
            booking_enabled: Boolean(bookingRequiredRaw),
            require_name: true,
            require_phone: true,
            max_party_size: Number.isFinite(maxPartySize) ? maxPartySize : null,
            updated_at: new Date().toISOString(),
          };
          const fallback = await supabaseAdmin
            .from("booking_rules")
            .upsert(fallbackPayload, { onConflict: "user_id" });
          if (fallback.error) return res.status(500).json({ error: fallback.error.message });
        } else {
          return res.status(500).json({ error: bookingUpsert.error.message });
        }
      }

      const completePayload = {
        user_id: userId,
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const completion = await supabaseAdmin
        .from("client_settings")
        .upsert(completePayload, { onConflict: "user_id" });

      if (completion.error) {
        const errText = String(completion.error.message || "").toLowerCase();
        if (
          !errText.includes("onboarding_completed") &&
          !errText.includes("onboarding_completed_at")
        ) {
          return res.status(500).json({ error: completion.error.message });
        }
      }

      return res.json({ ok: true, completed: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.post("/api/setup/skip", requireSupabaseUser, async (req, res) => {
    try {
      const payload = {
        user_id: req.user.id,
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const completion = await supabaseAdmin
        .from("client_settings")
        .upsert(payload, { onConflict: "user_id" });

      if (completion.error) {
        const errText = String(completion.error.message || "").toLowerCase();
        if (
          !errText.includes("onboarding_completed") &&
          !errText.includes("onboarding_completed_at")
        ) {
          return res.status(500).json({ error: completion.error.message });
        }
      }

      return res.json({ ok: true, completed: true, skipped: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  // --- Calendar integration endpoints ---

  // ICS feed (public, token-authenticated — no Supabase user required)
  app.get("/api/calendar/feed/:businessId/:token", async (req, res) => {
    try {
      const { businessId, token } = req.params;
      if (!businessId || !token) return res.status(400).send("Missing parameters");

      const icsContent = await calendarService.generateIcsFeed(businessId, token);
      if (!icsContent) return res.status(404).send("Not found");

      res.set("Content-Type", "text/calendar; charset=utf-8");
      res.set("Content-Disposition", 'attachment; filename="bookings.ics"');
      return res.send(icsContent);
    } catch (e) {
      console.error("ICS feed error:", e);
      return res.status(500).send(SERVER_ERROR_MESSAGE);
    }
  });

  // Get calendar feed URL for the current business
  app.get("/api/calendar/feed-url", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const feedToken = await calendarService.getOrCreateFeedToken(userId);
      const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
      const feedUrl = `${baseUrl}/api/calendar/feed/${userId}/${feedToken}`;
      return res.json({ feed_url: feedUrl });
    } catch (e) {
      console.error("Calendar feed URL error:", e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  // Google Calendar OAuth — start connection (Pro/Business only)
  app.get("/api/calendar/google/connect", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const plan = await loadUserPlan(userId);
      const planConfig = getPlanDefaults(plan);

      if (!planConfig.google_calendar) {
        return res.status(403).json({ error: "Google Calendar sync requires Pro or Business plan" });
      }
      if (!calendarService.hasGoogleConfig()) {
        return res.status(501).json({ error: "Google Calendar integration not configured" });
      }

      const oauth2Client = await calendarService.createOAuth2Client();
      const authUrl = calendarService.getGoogleAuthUrl(oauth2Client, userId);
      return res.json({ auth_url: authUrl });
    } catch (e) {
      console.error("Google Calendar connect error:", e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  // Google Calendar OAuth — callback
  app.get("/api/calendar/google/callback", async (req, res) => {
    try {
      const { code, state: businessId } = req.query;
      if (!code || !businessId) return res.status(400).send("Missing code or state");

      await calendarService.handleGoogleCallback(code, businessId);

      const dashboardUrl = process.env.DASHBOARD_URL || "/";
      return res.redirect(`${dashboardUrl}?calendar=connected`);
    } catch (e) {
      console.error("Google Calendar callback error:", e);
      const dashboardUrl = process.env.DASHBOARD_URL || "/";
      return res.redirect(`${dashboardUrl}?calendar=error`);
    }
  });

  // Google Calendar — disconnect
  app.post("/api/calendar/google/disconnect", requireSupabaseUser, async (req, res) => {
    try {
      await calendarService.disconnectGoogleCalendar(req.user.id);
      return res.json({ ok: true });
    } catch (e) {
      console.error("Google Calendar disconnect error:", e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  // Google Calendar — connection status
  app.get("/api/calendar/google/status", requireSupabaseUser, async (req, res) => {
    try {
      const { data } = await supabaseAdmin
        .from("businesses")
        .select("google_calendar_tokens, google_calendar_id")
        .eq("id", req.user.id)
        .single();

      return res.json({
        connected: Boolean(data?.google_calendar_tokens),
        calendar_id: data?.google_calendar_id || "primary",
      });
    } catch (e) {
      console.error("Google Calendar status error:", e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  // --- Multi-client WhatsApp integration endpoints ---

  app.post("/api/integrations/whatsapp/connect", requireSupabaseUser, async (req, res) => {
    try {
      const phoneNumberId = String(req.body?.phone_number_id || "").trim();
      const wabaId = String(req.body?.waba_id || "").trim();
      const accessToken = String(req.body?.access_token || "").trim();

      if (!phoneNumberId || !wabaId || !accessToken) {
        return res.status(400).json({
          error: "Missing required fields: phone_number_id, waba_id, access_token",
        });
      }

      // Check if another client already uses this phone_number_id
      const existingOwner = await findClientByPhoneNumberId(phoneNumberId);
      if (existingOwner && existingOwner !== req.user.id) {
        return res.status(409).json({
          error: "This WhatsApp phone number is already connected to another account",
        });
      }

      const { error } = await supabaseAdmin
        .from("client_settings")
        .upsert(
          {
            user_id: req.user.id,
            whatsapp_phone_number_id: phoneNumberId,
            whatsapp_waba_id: wabaId,
            whatsapp_access_token: accessToken,
            whatsapp_connected: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({
        ok: true,
        whatsapp_connected: true,
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
      });
    } catch (e) {
      console.error("[WA] connect error:", e?.message);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.get("/api/integrations/whatsapp/status", requireSupabaseUser, async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("client_settings")
        .select("whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_connected")
        .eq("user_id", req.user.id)
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({
        whatsapp_connected: !!data?.whatsapp_connected,
        phone_number_id: data?.whatsapp_phone_number_id || null,
        waba_id: data?.whatsapp_waba_id || null,
        // access_token intentionally excluded — NEVER sent to frontend
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.post("/api/integrations/whatsapp/disconnect", requireSupabaseUser, async (req, res) => {
    try {
      const { error } = await supabaseAdmin
        .from("client_settings")
        .update({
          whatsapp_phone_number_id: null,
          whatsapp_waba_id: null,
          whatsapp_access_token: null,
          whatsapp_connected: false,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", req.user.id);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({ ok: true, whatsapp_connected: false });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  // --- End multi-client WhatsApp integration endpoints ---

  app.use(
    createDemoRouter({
      requireSupabaseUser,
      setUserDemoModeFlag,
      generateDemoConversations,
    })
  );

  app.post("/api/inbound", publicRateLimit, requireSupabaseUser, async (req, res) => {
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

  app.get("/api/widget/config", widgetRateLimit, verifyWidgetClient, async (req, res) => {
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

  app.post("/api/widget/message", widgetRateLimit, verifyWidgetClient, async (req, res) => {
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

  app.post(
    "/api/menu/import-photo",
    requireSupabaseUser,
    async (req, res) => {
      try {
        const userId = String(req.body?.userId || "").trim();
        const imageDataUrl = String(req.body?.imageDataUrl || "").trim();
        if (!imageDataUrl) return res.status(400).json({ error: "Missing image data" });

        // Validate it is an image data URI and within size limits (~7.5MB base64 → ~5MB image)
        if (!imageDataUrl.startsWith("data:image/")) {
          return res.status(400).json({ error: "Invalid image format" });
        }
        if (imageDataUrl.length > 10_000_000) {
          return res.status(413).json({ error: "Image too large (max ~7.5MB)" });
        }
        if (!userId || userId !== req.user.id) {
          return res.status(403).json({ error: "Forbidden" });
        }
        if (!process.env.OPENROUTER_API_KEY) {
          return res.status(500).json({ error: "Missing OPENROUTER_API_KEY" });
        }

        const visionPrompt = `
You are extracting menu items from a restaurant menu image.

Return ONLY JSON in this format:
[
  { "name": "...", "price": number, "description": "...", "category": "..." }
]

Rules:
- Extract all items visible
- Price must be numeric
- Description optional
- Category optional
- Do not include extra text
        `.trim();

        const visionResp = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
          method: "POST",
          signal: AbortSignal.timeout(30000),
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.APP_URL,
            "X-Title": process.env.APP_TITLE,
          },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: visionPrompt },
                  { type: "image_url", image_url: { url: imageDataUrl } },
                ],
              },
            ],
            temperature: 0,
          }),
        });

        if (!visionResp.ok) {
          const errorText = await visionResp.text();
          console.error("Menu photo extraction failed:", errorText);
          return res
            .status(422)
            .json({ error: MENU_EXTRACTION_ERROR_MESSAGE });
        }

        const visionData = await visionResp.json();
        const content = String(
          visionData?.choices?.[0]?.message?.content?.trim() || ""
        );
        const jsonArray = extractFirstJsonArray(content);

        if (!jsonArray) {
          return res
            .status(422)
            .json({ error: MENU_EXTRACTION_ERROR_MESSAGE });
        }

        let parsed;
        try {
          parsed = JSON.parse(jsonArray);
        } catch {
          return res
            .status(422)
            .json({ error: MENU_EXTRACTION_ERROR_MESSAGE });
        }

        const items = normalizeImportedMenuItems(parsed);
        if (!items.length) {
          return res
            .status(422)
            .json({ error: MENU_EXTRACTION_ERROR_MESSAGE });
        }

        return res.json({ items });
      } catch (e) {
        console.error("Menu photo import failed:", e);
        return res
          .status(500)
          .json({ error: MENU_EXTRACTION_ERROR_MESSAGE });
      }
    }
  );

  app.post("/api/menu/import-confirm", requireSupabaseUser, async (req, res) => {
    try {
      const userId = String(req.body?.userId || "").trim();
      const items = normalizeImportedMenuItems(req.body?.items);

      if (!userId || userId !== req.user.id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!items.length) {
        return res.status(400).json({ error: "No valid items to import" });
      }

      const nowIso = new Date().toISOString();
      const insertRows = items.map((item) => ({
        user_id: userId,
        name: item.name,
        price: item.price,
        description: item.description,
        category: item.category,
        available: true,
        tags: [],
        updated_at: nowIso,
      }));

      const { data, error } = await supabaseAdmin
        .from("menu_items")
        .insert(insertRows)
        .select("id,name,price,description,category,available,tags");

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({
        ok: true,
        inserted: data || [],
      });
    } catch (e) {
      console.error("Menu import confirm failed:", e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.get("/api/conversations", requireSupabaseUser, async (req, res) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("conversations")
        .select(
          "id,user_id,channel,external_conversation_id,external_user_id,title,status,state,last_message_at,last_message_preview,intent,priority,manual_mode,ai_paused,created_at,updated_at"
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

  app.get("/api/conversations/escalated", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;

      const [escalatedConversationsQuery, escalatedMessagesQuery] = await Promise.all([
        supabaseAdmin
          .from("conversations")
          .select(
            "id,user_id,channel,external_conversation_id,external_user_id,title,status,state,last_message_at,last_message_preview,intent,priority,manual_mode,created_at,updated_at"
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
            "id,user_id,channel,external_conversation_id,external_user_id,title,status,state,last_message_at,last_message_preview,intent,priority,manual_mode,created_at,updated_at"
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

  app.get("/api/conversations/:conversationId/messages", requireSupabaseUser, async (req, res) => {
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
          manual_mode: false,
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
  app.post("/api/conversation/reply", requireSupabaseUser, async (req, res) => {
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
          manual_mode: true,
          ai_paused: true,
          last_message_at: nowIso,
          last_message_preview: message.slice(0, 280),
          updated_at: nowIso,
        })
        .eq("id", conversationId)
        .eq("user_id", req.user.id);

      if (convoUpdateErr) {
        const fallbackErr = await updateConversationManualMode({
          userId: req.user.id,
          conversationId,
          manualMode: true,
          statusOverride: nextStatus,
          stateOverride: "human_mode",
          lastMessagePreview: message,
        });
        if (fallbackErr) return res.status(500).json({ error: fallbackErr.message });
      }

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

  app.patch("/api/conversations/:conversationId", requireSupabaseUser, async (req, res) => {
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
          patch.manual_mode = false;
          patch.ai_paused = false;
        } else if (status === "escalated") {
          patch.state = "human_mode";
          patch.manual_mode = true;
          patch.ai_paused = true;
        } else if (status === "open" || status === "waiting_customer") {
          patch.state = "idle";
          patch.manual_mode = false;
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

  app.post(
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
            manual_mode: false,
            ai_paused: false,
            status: nextStatus,
            state: nextStatus === "resolved" ? "resolved" : "idle",
            updated_at: new Date().toISOString(),
          })
          .eq("id", conversationId)
          .eq("user_id", req.user.id);

        if (error) {
          const fallbackErr = await updateConversationManualMode({
            userId: req.user.id,
            conversationId,
            manualMode: false,
            statusOverride: nextStatus,
            stateOverride: nextStatus === "resolved" ? "resolved" : "idle",
          });
          if (fallbackErr) return res.status(500).json({ error: fallbackErr.message });
        }

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

  app.patch("/api/conversations/:conversationId/actions", requireSupabaseUser, async (req, res) => {
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
          manual_mode: nextStatus === "escalated",
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

  app.post("/dev/simulate/whatsapp", async (req, res) => {
    try {
      const devSecret = req.get("x-dev-secret");
      if (
        process.env.NODE_ENV === "production" &&
        (!process.env.DEV_SIMULATOR_SECRET ||
          devSecret !== process.env.DEV_SIMULATOR_SECRET)
      ) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const { userEmail, externalConversationId, from, text } = req.body || {};
      if (!userEmail || !externalConversationId || !text) {
        return res.status(400).json({
          error: "Missing required fields: userEmail, externalConversationId, text",
        });
      }

      const user = await findUserByEmail(userEmail);
      if (!user) {
        return res.status(404).json({ error: "Supabase user not found" });
      }

      const result = await messaging.conversationEngine.handleIncomingMessage({
        userId: user.id,
        channel: "whatsapp",
        externalConversationId,
        externalUserId: from || null,
        text,
        shouldSendExternalReply: true,
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

  // Meta webhook verification endpoint.
  app.get("/webhooks/whatsapp", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === "subscribe" && token && expected && token === expected) {
      return res.status(200).send(String(challenge || ""));
    }
    return res.status(403).send("Forbidden");
  });

  // Real WhatsApp inbound webhook.
  app.post("/webhooks/whatsapp", async (req, res) => {
    // Verify Meta's HMAC-SHA256 signature when app secret is configured
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (appSecret) {
      const sigHeader = String(req.get("x-hub-signature-256") || "");
      const rawBody = req.rawBody;
      if (!sigHeader.startsWith("sha256=") || !rawBody) {
        return res.status(401).json({ error: "Missing or malformed signature" });
      }
      const expected = crypto
        .createHmac("sha256", appSecret)
        .update(rawBody)
        .digest("hex");
      const received = sigHeader.slice(7);
      const valid =
        received.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
      if (!valid) {
        return res.status(401).json({ error: "Invalid signature" });
      }
    }

    try {
      const result = await messaging.whatsappAdapter.handleInboundWebhook({
        body: req.body,
      });
      return res.status(200).json(result || { ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.get("/api/analytics/overview", requireSupabaseUser, async (req, res) => {
    try {
      const overview = await buildAnalyticsOverview(req.user.id);
      return res.json(overview);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.get("/api/analytics/monthly-stats", requireSupabaseUser, async (req, res) => {
    try {
      const stats = await monthlyStatsService.getMonthlyStatsWithComparison({
        businessId: req.user.id,
      });
      return res.json(stats);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.get("/api/analytics/today-stats", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const now = new Date();
      const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

      const [messagesResult, escalatedResult] = await Promise.all([
        supabaseAdmin
          .from("messages")
          .select("ai_reply,conversation_id")
          .eq("user_id", userId)
          .gte("created_at", todayStart.toISOString()),
        supabaseAdmin
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "escalated")
          .gte("created_at", todayStart.toISOString()),
      ]);

      const rows = messagesResult.data || [];
      const totalInbound = rows.length;
      const aiMessages = rows.filter(r => r.ai_reply).length;
      const aiConversationIds = new Set(rows.filter(r => r.ai_reply).map(r => r.conversation_id));
      const escalated = escalatedResult.count || 0;

      return res.json({
        total_inbound: totalInbound,
        ai_messages_sent: aiMessages,
        ai_conversations_handled: aiConversationIds.size,
        human_escalations: escalated,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.get("/api/analytics/daily-volume", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const now = new Date();
      const start30d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));

      const { data: rows, error } = await supabaseAdmin
        .from("messages")
        .select("created_at,ai_reply")
        .eq("user_id", userId)
        .gte("created_at", start30d.toISOString())
        .order("created_at", { ascending: true })
        .limit(10000);

      if (error) throw new Error(error.message);

      const dayMap = new Map();
      for (let d = 0; d < 30; d++) {
        const dt = new Date(start30d);
        dt.setUTCDate(dt.getUTCDate() + d);
        const key = dt.toISOString().slice(0, 10);
        dayMap.set(key, { date: key, total: 0, ai: 0, human: 0 });
      }

      for (const row of rows || []) {
        const key = new Date(row.created_at).toISOString().slice(0, 10);
        const entry = dayMap.get(key);
        if (!entry) continue;
        entry.total++;
        if (row.ai_reply) entry.ai++;
        else entry.human++;
      }

      return res.json({ days: Array.from(dayMap.values()) });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.get("/api/analytics/top-questions", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      const { data: rows, error } = await supabaseAdmin
        .from("messages")
        .select("customer_message")
        .eq("user_id", userId)
        .gte("created_at", monthStart.toISOString())
        .not("customer_message", "is", null)
        .neq("customer_message", "")
        .order("created_at", { ascending: false })
        .limit(5000);

      if (error) throw new Error(error.message);

      // Group by normalized first message (simple keyword grouping)
      const freq = new Map();
      for (const row of rows || []) {
        const msg = String(row.customer_message || "").trim().toLowerCase().slice(0, 120);
        if (!msg) continue;
        freq.set(msg, (freq.get(msg) || 0) + 1);
      }

      const sorted = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([question, count]) => ({ question, count }));

      return res.json({ questions: sorted });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.get("/api/analytics/escalation-reasons", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      const { data: rows, error } = await supabaseAdmin
        .from("conversations")
        .select("escalation_reason")
        .eq("user_id", userId)
        .eq("status", "escalated")
        .gte("created_at", monthStart.toISOString())
        .limit(5000);

      if (error) {
        const text = String(error.message || "").toLowerCase();
        if (text.includes("escalation_reason") || text.includes(SCHEMA_CACHE_TEXT)) {
          return res.json({ reasons: [], total: 0 });
        }
        throw new Error(error.message);
      }

      const freq = new Map();
      for (const row of rows || []) {
        const reason = String(row.escalation_reason || "Other").trim();
        freq.set(reason, (freq.get(reason) || 0) + 1);
      }

      const sorted = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => ({ reason, count }));

      return res.json({ reasons: sorted, total: (rows || []).length });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.get("/api/analytics/monthly-report", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;

      // Gate: monthly reports require Pro or Business
      const plan = await loadUserPlan(userId);
      const planConfig = getPlanDefaults(plan);
      if (!planConfig.features?.monthly_reports) {
        return res.status(403).json({
          error: "Monthly reports are available on Pro and Business plans.",
          upgrade_required: true,
        });
      }

      const monthParam = String(req.query.month || "").trim();
      const monthKey = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : monthlyStatsService.getMonthKey();

      const report = await monthlyStatsService.getMonthlyReport({
        businessId: userId,
        monthKey,
      });

      // Fetch top questions for this month
      const [year, month] = monthKey.split("-").map(Number);
      const monthStart = new Date(Date.UTC(year, month - 1, 1));
      const monthEnd = new Date(Date.UTC(year, month, 1));

      const [questionsResult, escalationsResult] = await Promise.all([
        supabaseAdmin
          .from("messages")
          .select("customer_message")
          .eq("user_id", userId)
          .gte("created_at", monthStart.toISOString())
          .lt("created_at", monthEnd.toISOString())
          .not("customer_message", "is", null)
          .neq("customer_message", "")
          .limit(5000),
        supabaseAdmin
          .from("conversations")
          .select("escalation_reason")
          .eq("user_id", userId)
          .eq("status", "escalated")
          .gte("created_at", monthStart.toISOString())
          .lt("created_at", monthEnd.toISOString())
          .limit(5000),
      ]);

      // Top questions
      const qFreq = new Map();
      for (const row of questionsResult.data || []) {
        const msg = String(row.customer_message || "").trim().toLowerCase().slice(0, 120);
        if (!msg) continue;
        qFreq.set(msg, (qFreq.get(msg) || 0) + 1);
      }
      const topQuestions = Array.from(qFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([question, count]) => ({ question, count }));

      // Escalation reasons
      const eFreq = new Map();
      for (const row of escalationsResult.data || []) {
        const reason = String(row.escalation_reason || "Other").trim();
        eFreq.set(reason, (eFreq.get(reason) || 0) + 1);
      }
      const escalationReasons = Array.from(eFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => ({ reason, count }));

      // Generate recommendations
      const recommendations = [];
      if (topQuestions.length > 0 && topQuestions[0].count >= 5) {
        recommendations.push({
          type: "faq",
          message: `"${topQuestions[0].question}" was asked ${topQuestions[0].count} times — consider adding it to your FAQ`,
        });
      }
      const escalationRate = report.ai_conversations_handled > 0
        ? Math.round((report.human_escalations / report.ai_conversations_handled) * 100)
        : 0;
      if (escalationRate > 20) {
        recommendations.push({
          type: "escalation_rate",
          message: `Your escalation rate is ${escalationRate}% — review escalated conversations and add common answers to your knowledge base`,
        });
      }
      const unknownEscalations = eFreq.get("Other") || 0;
      if (unknownEscalations > 10) {
        recommendations.push({
          type: "unknown_questions",
          message: `${unknownEscalations} escalations were for unclassified reasons — review and add answers to your knowledge base`,
        });
      }

      // Find busiest day of week
      const dayVolumes = await supabaseAdmin
        .from("messages")
        .select("created_at")
        .eq("user_id", userId)
        .gte("created_at", monthStart.toISOString())
        .lt("created_at", monthEnd.toISOString())
        .limit(10000);

      const dayCounts = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
      for (const row of dayVolumes.data || []) {
        const day = new Date(row.created_at).getUTCDay();
        dayCounts[day]++;
      }
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const busiestDayIdx = dayCounts.indexOf(Math.max(...dayCounts));
      if (dayCounts[busiestDayIdx] > 0) {
        recommendations.push({
          type: "busiest_day",
          message: `Your busiest day is ${dayNames[busiestDayIdx]} — consider adjusting staffing or AI availability`,
        });
      }

      return res.json({
        ...report,
        top_questions: topQuestions,
        escalation_reasons: escalationReasons,
        escalation_rate: escalationRate,
        recommendations,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.get("/api/analytics/usage-summary", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const now = new Date();
      const userPlan = await loadUserPlan(userId);
      const maxMessages = await loadBusinessMaxMessages(userId);
      const monthStartIso = getMonthStartIso(now);
      const conversationsUsed = await countMonthlyAiConversations(userId, monthStartIso);
      const limit = (maxMessages !== null && maxMessages > 0) ? maxMessages : null;
      const percentUsed = limit ? Math.round((conversationsUsed / limit) * 100) : null;

      // Days until reset (first day of next month)
      const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const daysUntilReset = Math.ceil((nextMonth.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      return res.json({
        plan: userPlan,
        conversations_used: conversationsUsed,
        limit,
        percent_used: percentUsed,
        days_until_reset: daysUntilReset,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.get("/api/usage", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const now = new Date();
      const userPlan = await loadUserPlan(userId);
      const maxMessages = await loadBusinessMaxMessages(userId);
      const monthStartIso = getMonthStartIso(now);
      const conversationsUsed = await countMonthlyAiConversations(userId, monthStartIso);
      const limit = (maxMessages !== null && maxMessages > 0) ? maxMessages : null;
      const percentUsed = limit ? Math.round((conversationsUsed / limit) * 100) : null;
      const mainReplyModel = getModelForTask(userPlan, "main_reply");

      return res.json({
        plan: userPlan,
        model_main_reply: mainReplyModel,
        conversations_used: conversationsUsed,
        limit,
        percent_used: percentUsed,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });
  // eslint-disable-next-line sonarjs/cognitive-complexity
  app.get("/api/dashboard/analytics", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const now = new Date();
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

      const [{ data: aiRows, error: aiErr }, { count: escalationsCount, error: escalationsErr }, { count: humanRepliesCount, error: humanRepliesErr }, { data: bookingMessageRows, error: bookingMessagesErr }, { data: bookingConfirmedRows, error: bookingConfirmedErr }] =
        await Promise.all([
          supabaseAdmin
            .from("messages")
            .select("conversation_id,ai_reply")
            .eq("user_id", userId)
            .gte("created_at", startOfToday.toISOString())
            .not("ai_reply", "is", null)
            .neq("ai_reply", "")
            .limit(5000),
          supabaseAdmin
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("escalated", true)
            .gte("created_at", startOfToday.toISOString()),
          supabaseAdmin
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .not("human_reply", "is", null)
            .neq("human_reply", "")
            .gte("created_at", startOfToday.toISOString()),
          supabaseAdmin
            .from("messages")
            .select("conversation_id")
            .eq("user_id", userId)
            .gte("created_at", startOfToday.toISOString())
            .filter("extracted_data->>intent", "eq", "booking")
            .filter("extracted_data->>status", "eq", "complete")
            .limit(5000),
          supabaseAdmin
            .from("conversations")
            .select("id")
            .eq("user_id", userId)
            .eq("state", "booking_confirmed")
            .gte("last_message_at", startOfToday.toISOString())
            .limit(5000),
        ]);

      if (aiErr) throw new Error(aiErr.message);
      if (escalationsErr) throw new Error(escalationsErr.message);
      if (humanRepliesErr) throw new Error(humanRepliesErr.message);
      if (bookingMessagesErr) throw new Error(bookingMessagesErr.message);

      let bookingConfirmedConversations = bookingConfirmedRows || [];
      if (bookingConfirmedErr) {
        const text = String(bookingConfirmedErr.message || "").toLowerCase();
        if (text.includes("state") || text.includes(SCHEMA_CACHE_TEXT) || text.includes(DOES_NOT_EXIST_TEXT)) {
          bookingConfirmedConversations = [];
        } else {
          throw new Error(bookingConfirmedErr.message);
        }
      }

      const aiConversationsToday = new Set(
        (aiRows || []).map((row) => String(row?.conversation_id || "").trim()).filter(Boolean)
      ).size;

      const bookingsSet = new Set(
        (bookingMessageRows || [])
          .map((row) => String(row?.conversation_id || "").trim())
          .filter(Boolean)
      );
      for (const row of bookingConfirmedConversations || []) {
        const id = String(row?.id || "").trim();
        if (id) bookingsSet.add(id);
      }

      let activeConversations = 0;
      const activeWithState = await supabaseAdmin
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("last_message_at", thirtyMinutesAgo.toISOString())
        .neq("state", "resolved");

      if (activeWithState.error) {
        const text = String(activeWithState.error.message || "").toLowerCase();
        if (text.includes("state") || text.includes(SCHEMA_CACHE_TEXT) || text.includes(DOES_NOT_EXIST_TEXT)) {
          const fallback = await supabaseAdmin
            .from("conversations")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .gte("last_message_at", thirtyMinutesAgo.toISOString())
            .neq("status", "resolved");
          if (fallback.error) throw new Error(fallback.error.message);
          activeConversations = Number(fallback.count || 0);
        } else {
          throw new Error(activeWithState.error.message);
        }
      } else {
        activeConversations = Number(activeWithState.count || 0);
      }

      const userPlan = await loadUserPlan(userId);
      const maxMessages = await loadBusinessMaxMessages(userId);
      const monthStartIso = getMonthStartIso(now);
      const usedConversationsThisMonth = await countMonthlyAiConversations(userId, monthStartIso);
      const planLimit = (maxMessages !== null && maxMessages > 0) ? maxMessages : null;
      const usagePercent = planLimit ? Math.round((usedConversationsThisMonth / planLimit) * 100) : null;
      let usageWarningLevel = null;
      if (planLimit) {
        if (usagePercent >= 100) usageWarningLevel = 100;
        else if (usagePercent >= 95) usageWarningLevel = 95;
        else if (usagePercent >= 80) usageWarningLevel = 80;
      }

      return res.json({
        aiConversationsToday,
        bookingsToday: bookingsSet.size,
        escalationsToday: Number(escalationsCount || 0),
        humanRepliesToday: Number(humanRepliesCount || 0),
        activeConversations,
        plan: userPlan,
        usedConversationsThisMonth,
        monthlyConversationLimit: planLimit,
        usagePercent,
        usageWarningLevel,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  app.post("/api/webhooks/wix", async (req, res) => {
    try {
      if (!String(process.env.WIX_WEBHOOK_SECRET || "").trim()) {
        return res.status(500).json({ error: "Server missing WIX_WEBHOOK_SECRET env var" });
      }

      const secretHeader =
        req.get("x-wix-secret") || req.get("authorization") || req.get("x-webhook-secret");
      if (!wixWebhookService.verifySecret(secretHeader)) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const result = await wixWebhookService.processEvent(req.body || {});
      return res.status(200).json({
        ok: true,
        ignored: Boolean(result.ignored),
        businessId: result.businessId,
        email: result.email,
        plan: result.plan,
        cancellation: result.cancellation,
        planStartedAt: result.planStartedAt,
        planExpiresAt: result.planExpiresAt,
        wixOrderId: result.orderId,
      });
    } catch (err) {
      const statusCode = Number(err?.statusCode) || 500;
      if (statusCode >= 500) {
        console.error("Wix webhook handling failed:", err?.message || err);
      }
      const responseError =
        statusCode >= 500 ? SERVER_ERROR_MESSAGE : String(err?.message || "Request failed");
      return res.status(statusCode).json({ error: responseError });
    }
  });

  /* ================================
    WIX PAYMENT WEBHOOK — ONBOARDING
  ================================ */
  app.post("/webhooks/wix/payment", async (req, res) => {
    try {
      // Verify webhook secret
      if (!String(process.env.WIX_WEBHOOK_SECRET || "").trim()) {
        return res.status(500).json({ error: "Server missing WIX_WEBHOOK_SECRET env var" });
      }

      const secretHeader =
        req.get("x-wix-secret") || req.get("authorization") || req.get("x-webhook-secret");
      if (!wixWebhookService.verifySecret(secretHeader)) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Expire stale trials on each webhook (lightweight, idempotent)
      await wixPaymentService.checkExpiredTrials().catch((e) =>
        console.warn("⚠️ Trial expiry check failed:", e?.message || e)
      );

      const result = await wixPaymentService.handlePaymentWebhook(req.body || {});
      return res.status(200).json(result);
    } catch (err) {
      const statusCode = Number(err?.statusCode) || 500;
      if (statusCode >= 500) {
        console.error("❌ Wix payment webhook failed:", err?.message || err);
      }
      const responseError =
        statusCode >= 500 ? SERVER_ERROR_MESSAGE : String(err?.message || "Request failed");
      return res.status(statusCode).json({ error: responseError });
    }
  });

  /* ================================
    CHECK EMAIL EXISTS (pre-login)
  ================================ */
  app.post("/api/auth/check-email", publicRateLimit, async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      // Try businesses table first (set by Wix payment webhook). When that
      // table is unavailable, fall back to scanning Supabase auth users.
      const { data: business, error: bizErr } = await supabaseAdmin
        .from("businesses")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (!bizErr && business) {
        return res.json({ exists: true });
      }

      // Fallback: paginate auth users (sufficient for early-stage user counts)
      let page = 1;
      const perPage = 200;
      while (page <= 25) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage,
        });
        if (error) break;
        const found = data?.users?.some((u) => (u.email || "").toLowerCase() === email);
        if (found) return res.json({ exists: true });
        if (!data?.users || data.users.length < perPage) break;
        page += 1;
      }

      return res.json({ exists: false });
    } catch (err) {
      console.error("Check email error:", err?.message || err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/api/chat", publicRateLimit, async (req, res) => {
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
        .from("businesses")
        .select("id,name,plan,max_messages,ai_model")
        .eq("id", businessId)
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
        maxMessages: business.max_messages,
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

  app.use(errorHandler);

  /* ================================
    START SERVER
  ================================ */
  app.listen(PORT, () => {
    console.log(`\n✅ SupportPilot backend running on http://localhost:${PORT}\n`);
    setInterval(runOneQueuedJob, JOB_WORKER_POLL_MS);
    console.log(`🧰 Job worker started (poll: ${JOB_WORKER_POLL_MS}ms)`);
  });

  
  app.post("/webhook-test", async (req, res) => {
  console.log("TEST WEBHOOK HIT");

  const message =
    req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (!message) return res.sendStatus(200);

  const from = message.from;

  await fetch(
    "https://graph.facebook.com/v19.0/YOUR_PHONE_NUMBER_ID/messages",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: from,
        text: { body: "Working ✅ (test route)" },
      }),
    }
  );

  res.sendStatus(200);
});