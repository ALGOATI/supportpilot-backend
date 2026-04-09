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
  import { createCorsMiddleware } from "./config/cors.js";
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
    normalizeSetupHoursRows,
    normalizeSetupMenuItems,
  } from "./services/setupService.js";
  import { createConversationStoreService } from "./services/conversationStoreService.js";
  import { createDemoRouter } from "./routes/demo.js";
  import { createKnowledgeRouter } from "./routes/knowledge.js";
  import { createConversationsRouter } from "./routes/conversations.js";
  import { createDevtoolsRouter } from "./routes/devtools.js";
  import { createAuthRouter } from "./routes/auth.js";
  import { createAnalyticsRouter } from "./routes/analytics.js";
  import { createSettingsRouter } from "./routes/settings.js";
  import { createIntegrationsRouter } from "./routes/integrations.js";
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
    SCHEMA_CACHE_TEXT,
    DOES_NOT_EXIST_TEXT,
    DEFAULT_TIMEZONE,
    NOT_PROVIDED_LABEL,
    OPENROUTER_CHAT_COMPLETIONS_URL,
    KB_SELECT_FIELDS,
    BOOKING_SELECT_FIELDS,
    MENU_EXTRACTION_ERROR_MESSAGE,
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

  app.use(
    createSettingsRouter({
      supabaseAdmin,
      requireSupabaseUser,
      loadUserPlan,
      normalizeBusinessType,
      normalizeImportedMenuItems,
      extractFirstJsonArray,
    })
  );

  /* ================================
    SECURE AI REPLY ROUTE
  ================================ */
  app.use(
    createConversationsRouter({
      supabaseAdmin,
      requireSupabaseUser,
      verifyWidgetClient,
      loadUserPlan,
      getMessageLimitForPlan,
      getMessageLengthValidation,
      buildMessageTooLongPayload,
      processReplyJob,
      buildLegacyConversations,
      detectConversationTags,
      buildConversationTitle,
      updateConversationManualMode,
      getConversationByIdForUser,
      getClientWhatsAppConfig,
      learnFromHumanReply,
      knowledgeService,
      openAiSupportService,
      usageService,
      monthlyStatsService,
      messaging,
    })
  );

  app.use(
    createIntegrationsRouter({
      supabaseAdmin,
      requireSupabaseUser,
      loadUserPlan,
      calendarService,
      findClientByPhoneNumberId,
      messaging,
      wixWebhookService,
      wixPaymentService,
    })
  );

  app.use(
    createDemoRouter({
      requireSupabaseUser,
      setUserDemoModeFlag,
      generateDemoConversations,
    })
  );

  app.use(createDevtoolsRouter({ findUserByEmail, messaging }));

  // Meta webhook verification endpoint.

  app.use(
    createAnalyticsRouter({
      supabaseAdmin,
      requireSupabaseUser,
      buildAnalyticsOverview,
      monthlyStatsService,
      loadUserPlan,
      loadBusinessMaxMessages,
      getMonthStartIso,
      countMonthlyAiConversations,
    })
  );


  /* ================================
    CHECK EMAIL EXISTS (pre-login)
  ================================ */
  app.use(createAuthRouter({ supabaseAdmin }));

  app.use(errorHandler);

  /* ================================
    START SERVER
  ================================ */
  app.listen(PORT, () => {
    console.log(`\n✅ SupportPilot backend running on http://localhost:${PORT}\n`);
    setInterval(runOneQueuedJob, JOB_WORKER_POLL_MS);
    console.log(`🧰 Job worker started (poll: ${JOB_WORKER_POLL_MS}ms)`);
  });

  
