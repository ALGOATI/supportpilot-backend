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
  hasAnyModelConfigured,
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
  let isJobWorkerRunning = false;

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

  function pickModel(plan) {
    return getModelForTask(plan, "main_reply");
  }

  function normalizeBaseUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    let trimmed = raw;
    while (trimmed.endsWith("/")) {
      trimmed = trimmed.slice(0, -1);
    }
    if (!trimmed) return "";
    if (!/^https?:\/\//i.test(trimmed)) return "";
    return trimmed;
  }

  function resolveBackendPublicBaseUrl(req = null) {
    const configured = normalizeBaseUrl(process.env.BACKEND_PUBLIC_URL);
    if (configured) return configured;

    const host = String(req?.get?.("x-forwarded-host") || req?.get?.("host") || "").trim();
    const forwardedProto = String(req?.get?.("x-forwarded-proto") || "").trim().toLowerCase();
    const reqProto = String(req?.protocol || "").trim().toLowerCase();
    const proto = forwardedProto || reqProto || "http";

    if (host && (proto === "http" || proto === "https")) {
      return `${proto}://${host}`;
    }

    return `http://localhost:${PORT}`;
  }

  function isSchemaCompatibilityError(error, hints = []) {
    const text = String(error?.message || "").toLowerCase();
    if (!text) return false;
    if (text.includes(SCHEMA_CACHE_TEXT) || text.includes(DOES_NOT_EXIST_TEXT)) return true;
    return hints.some((hint) => text.includes(String(hint || "").toLowerCase()));
  }

  function isAiGloballyReady() {
    const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
    const hasModel = hasAnyModelConfigured();
    return Boolean(apiKey) && hasModel;
  }

  function sanitizeExternalIdentifier(value, fallbackPrefix = "id") {
    const raw = String(value || "")
      .trim()
      .replaceAll(/[^a-zA-Z0-9:_-]/g, "")
      .slice(0, 120);
    if (raw) return raw;
    return `${fallbackPrefix}:${crypto.randomUUID()}`;
  }

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

  // demoService depends on a few helpers that are still defined later in this
  // file (loadBusinessTimezone, getTodayIsoDateInTimezone, insertMessageWithFallback).
  // Those are async/function declarations, so they're hoisted; we wrap them in
  // arrow shims so the factory captures stable references that resolve at call time.
  const demoService = createDemoService({
    supabaseAdmin,
    getTodayIsoDateInTimezone: (...args) => getTodayIsoDateInTimezone(...args),
    loadBusinessTimezone: (...args) => loadBusinessTimezone(...args),
    insertMessageWithFallback: (...args) => insertMessageWithFallback(...args),
  });
  const { setUserDemoModeFlag, generateDemoConversations } = demoService;

  function normalizeSetupHoursRows(rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const normalized = [];

    for (const row of safeRows) {
      const dayOfWeek = Number(row?.day_of_week);
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) continue;

      const isClosed = Boolean(row?.is_closed);
      const openTime = String(row?.open_time || "").trim();
      const closeTime = String(row?.close_time || "").trim();

      normalized.push({
        day_of_week: dayOfWeek,
        is_closed: isClosed,
        open_time: isClosed ? null : openTime || null,
        close_time: isClosed ? null : closeTime || null,
      });
    }

    if (!normalized.length) {
      return Array.from({ length: 7 }).map((_, day) => ({
        day_of_week: day,
        is_closed: false,
        open_time: "09:00",
        close_time: "17:00",
      }));
    }

    return normalized;
  }

  function normalizeSetupMenuItems(items) {
    const safeItems = Array.isArray(items) ? items : [];
    const normalized = [];

    for (const raw of safeItems) {
      const name = String(raw?.name || "").trim();
      if (!name) continue;

      const rawPrice = raw?.price;
      const parsedPrice =
        rawPrice === null || rawPrice === undefined || rawPrice === ""
          ? null
          : Number(rawPrice);

      normalized.push({
        name,
        price: Number.isFinite(parsedPrice) ? parsedPrice : null,
        description: String(raw?.description || "").trim() || null,
        category: String(raw?.category || "").trim() || null,
      });
    }

    return normalized.slice(0, 300);
  }


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

  function hasStructuredBusinessData({
    profile,
    hours,
    menuItems,
    faqs,
    bookingRules,
  }) {
    const hasProfile = [
      profile?.business_name,
      profile?.niche,
      profile?.phone,
      profile?.address,
      profile?.timezone,
    ].some((value) => String(value || "").trim());

    const hasHours = Array.isArray(hours) && hours.some((row) => {
      return (
        row?.is_closed === true ||
        String(row?.open_time || "").trim() ||
        String(row?.close_time || "").trim()
      );
    });

    const hasMenu = Array.isArray(menuItems) && menuItems.some((row) => {
      return String(row?.name || "").trim();
    });

    const hasFaqs = Array.isArray(faqs) && faqs.some((row) => {
      return String(row?.question || "").trim() && String(row?.answer || "").trim();
    });

    const hasBookingRules =
      bookingRules &&
      (bookingRules.booking_enabled !== true ||
        bookingRules.require_name !== true ||
        bookingRules.require_phone !== true ||
        Number.isFinite(Number(bookingRules.max_party_size)));

    return Boolean(hasProfile || hasHours || hasMenu || hasFaqs || hasBookingRules);
  }
  // eslint-disable-next-line sonarjs/cognitive-complexity
  function buildStructuredBusinessContext({
    profile,
    hours,
    menuItems,
    faqs,
    bookingRules,
  }) {
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    const lines = [];
    lines.push(
      "Structured business knowledge:",
      "Profile:",
      `- Business name: ${String(profile?.business_name || "Unknown").trim() || "Unknown"}`,
      `- Business type: ${normalizeBusinessType(profile?.business_type)}`,
      `- Niche: ${String(profile?.niche || "generic").trim() || "generic"}`,
      `- Phone: ${String(profile?.phone || NOT_PROVIDED_LABEL).trim() || NOT_PROVIDED_LABEL}`,
      `- Address: ${String(profile?.address || NOT_PROVIDED_LABEL).trim() || NOT_PROVIDED_LABEL}`,
      `- Timezone: ${String(profile?.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE}`
    );

    lines.push("Business hours:");
    const sortedHours = (hours || [])
      .slice()
      .sort((a, b) => Number(a?.day_of_week || 0) - Number(b?.day_of_week || 0));

    if (sortedHours.length === 0) {
      lines.push("- No hours configured.");
    } else {
      for (const row of sortedHours) {
        const day = Number(row?.day_of_week);
        const dayLabel = Number.isInteger(day) && day >= 0 && day <= 6 ? dayNames[day] : `Day ${day}`;
        if (row?.is_closed) {
          lines.push(`- ${dayLabel}: Closed`);
          continue;
        }
        const openTime = String(row?.open_time || "").trim();
        const closeTime = String(row?.close_time || "").trim();
        if (!openTime || !closeTime) {
          lines.push(`- ${dayLabel}: Hours not set`);
          continue;
        }
        lines.push(`- ${dayLabel}: ${openTime} - ${closeTime}`);
      }
    }

    if (!menuItems || menuItems.length === 0) {
      lines.push("Menu items:", "- No menu items configured.");
    } else {
      lines.push("Menu items:");
      for (const item of menuItems.slice(0, 24)) {
        const name = String(item?.name || "").trim();
        if (!name) continue;
        const priceValue = item?.price === null || item?.price === undefined ? null : Number(item.price);
        const price = Number.isFinite(priceValue) ? `${priceValue}` : "N/A";
        const availability = item?.available === false ? "unavailable" : "available";
        const description = String(item?.description || "").trim().slice(0, 120);
        lines.push(
          `- ${name} | price: ${price} | status: ${availability}${
            description ? ` | description: ${description}` : ""
          }`
        );
      }
    }

    if (!faqs || faqs.length === 0) {
      lines.push("FAQs:", "- No FAQs configured.");
    } else {
      lines.push("FAQs:");
      for (const row of faqs.slice(0, 20)) {
        const question = String(row?.question || "").trim();
        const answer = String(row?.answer || "").trim().slice(0, 220);
        if (!question || !answer) continue;
        lines.push(`- Q: ${question}`, `  A: ${answer}`);
      }
    }

    const bookingEnabled =
      bookingRules?.booking_enabled === undefined || bookingRules?.booking_enabled === null
        ? true
        : Boolean(bookingRules.booking_enabled);
    const requireName =
      bookingRules?.require_name === undefined || bookingRules?.require_name === null
        ? true
        : Boolean(bookingRules.require_name);
    const requirePhone =
      bookingRules?.require_phone === undefined || bookingRules?.require_phone === null
        ? true
        : Boolean(bookingRules.require_phone);
    const maxPartySize = Number.isFinite(Number(bookingRules?.max_party_size))
      ? Number(bookingRules.max_party_size)
      : null;

    lines.push(
      "Booking rules:",
      `- Booking enabled: ${bookingEnabled ? "yes" : "no"}`,
      `- Require customer name: ${requireName ? "yes" : "no"}`,
      `- Require customer phone: ${requirePhone ? "yes" : "no"}`,
      `- Max party size: ${maxPartySize === null ? "not set" : String(maxPartySize)}`
    );

    return lines.join("\n");
  }

  async function loadStructuredBusinessKnowledge(userId) {
    const [
      profileQuery,
      hoursQuery,
      menuQuery,
      faqQuery,
      bookingQuery,
    ] = await Promise.all([
      supabaseAdmin
        .from("business_profiles")
        .select("business_name,business_type,niche,phone,address,timezone")
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("business_hours")
        .select("day_of_week,is_closed,open_time,close_time")
        .eq("user_id", userId)
        .order("day_of_week", { ascending: true }),
      supabaseAdmin
        .from("menu_items")
        .select("name,price,description,available")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(40),
      supabaseAdmin
        .from("faqs")
        .select("question,answer")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(40),
      supabaseAdmin
        .from("booking_rules")
        .select("booking_enabled,require_name,require_phone,max_party_size")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    if (profileQuery.error) console.error("business_profiles query failed:", profileQuery.error.message);
    if (hoursQuery.error) console.error("business_hours query failed:", hoursQuery.error.message);
    if (menuQuery.error) console.error("menu_items query failed:", menuQuery.error.message);
    if (faqQuery.error) console.error("faqs query failed:", faqQuery.error.message);
    if (bookingQuery.error) console.error("booking_rules query failed:", bookingQuery.error.message);

    const profile = profileQuery.data || null;
    const hours = Array.isArray(hoursQuery.data) ? hoursQuery.data : [];
    const menuItems = Array.isArray(menuQuery.data) ? menuQuery.data : [];
    const faqs = Array.isArray(faqQuery.data) ? faqQuery.data : [];
    const bookingRules = bookingQuery.data || null;

    const hasStructuredData = hasStructuredBusinessData({
      profile,
      hours,
      menuItems,
      faqs,
      bookingRules,
    });

    if (!hasStructuredData) {
      return {
        hasStructuredData: false,
        businessContext: "",
        businessType: "other",
      };
    }

    return {
      hasStructuredData: true,
      businessType: normalizeBusinessType(profile?.business_type),
      businessContext: buildStructuredBusinessContext({
        profile,
        hours,
        menuItems,
        faqs,
        bookingRules,
      }),
    };
  }

  async function loadBusinessKnowledgeForLookup(userId) {
    const cached = getKnowledgeLookupCacheValue(userId);
    if (cached) return cached;

    const [profileQ, hoursQ, menuQ, faqQ, bookingRulesQ] = await Promise.all([
      supabaseAdmin
        .from("business_profiles")
        .select("business_name,business_type,phone,address,timezone")
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("business_hours")
        .select("day_of_week,is_closed,open_time,close_time")
        .eq("user_id", userId),
      supabaseAdmin
        .from("menu_items")
        .select("name,price,description,available")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(120),
      supabaseAdmin
        .from("faqs")
        .select("question,answer")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(120),
      supabaseAdmin
        .from("booking_rules")
        .select("booking_enabled,require_name,require_phone,max_party_size")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    let knowledgeBase = [];
    try {
      const activeFirst = await supabaseAdmin
        .from("knowledge_base")
        .select(KB_SELECT_FIELDS)
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(120);

      if (activeFirst.error) {
        const fallback = await supabaseAdmin
          .from("knowledge_base")
          .select(KB_SELECT_FIELDS)
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(120);
        if (!fallback.error) {
          knowledgeBase = Array.isArray(fallback.data) ? fallback.data : [];
        }
      } else {
        knowledgeBase = Array.isArray(activeFirst.data) ? activeFirst.data : [];
      }
    } catch {
      knowledgeBase = [];
    }

    const knowledgeSnapshot = {
      profile: profileQ.data || null,
      hours: Array.isArray(hoursQ.data) ? hoursQ.data : [],
      menuItems: Array.isArray(menuQ.data) ? menuQ.data : [],
      faqs: Array.isArray(faqQ.data) ? faqQ.data : [],
      bookingRules: bookingRulesQ.data || null,
      knowledgeBase,
    };
    setKnowledgeLookupCacheValue(userId, knowledgeSnapshot);
    return knowledgeSnapshot;
  }

  function getWeekdayInTimezone(date, timeZone) {
    const str = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: timeZone || "UTC",
    }).format(date);
    const map = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    return map[String(str || "").toLowerCase()] ?? null;
  }

  function resolveRequestedDayOfWeek(text, timeZone) {
    const msg = String(text || "").toLowerCase();
    const dayWordMap = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    for (const [word, day] of Object.entries(dayWordMap)) {
      if (msg.includes(word)) return day;
    }
    const now = new Date();
    const todayDow = getWeekdayInTimezone(now, timeZone);
    if (todayDow === null) return null;
    if (msg.includes("today") || msg.includes("tonight")) return todayDow;
    if (msg.includes("tomorrow")) return (todayDow + 1) % 7;
    return null;
  }

  function normalizeTextForMatch(value) {
    return String(value || "")
      .toLowerCase()
      .replaceAll(/[^\p{L}\p{N}\s]/gu, " ")
      .replaceAll(/\s+/g, " ")
      .trim();
  }

  function containsAnyKeyword(text, keywords) {
    const normalized = normalizeTextForMatch(text);
    if (!normalized) return false;
    return keywords.some((kw) => normalized.includes(normalizeTextForMatch(kw)));
  }

  const KNOWLEDGE_LOOKUP_CACHE_TTL_MS = Math.max(
    0,
    Number(process.env.KNOWLEDGE_LOOKUP_CACHE_TTL_MS || 30000)
  );
  const KNOWLEDGE_LOOKUP_CACHE_MAX_KEYS = Math.max(
    50,
    Number(process.env.KNOWLEDGE_LOOKUP_CACHE_MAX_KEYS || 500)
  );
  const knowledgeLookupCache = new Map();

  function getKnowledgeLookupCacheValue(userId) {
    if (!KNOWLEDGE_LOOKUP_CACHE_TTL_MS) return null;
    const key = String(userId || "").trim();
    if (!key) return null;
    const cached = knowledgeLookupCache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      knowledgeLookupCache.delete(key);
      return null;
    }
    return cached.value || null;
  }

  function setKnowledgeLookupCacheValue(userId, value) {
    if (!KNOWLEDGE_LOOKUP_CACHE_TTL_MS) return;
    const key = String(userId || "").trim();
    if (!key) return;

    if (knowledgeLookupCache.size >= KNOWLEDGE_LOOKUP_CACHE_MAX_KEYS) {
      for (const [cacheKey, cacheValue] of knowledgeLookupCache.entries()) {
        if ((cacheValue?.expiresAt || 0) <= Date.now()) {
          knowledgeLookupCache.delete(cacheKey);
        }
      }
      if (knowledgeLookupCache.size >= KNOWLEDGE_LOOKUP_CACHE_MAX_KEYS) {
        const oldestKey = knowledgeLookupCache.keys().next().value;
        if (oldestKey) knowledgeLookupCache.delete(oldestKey);
      }
    }

    knowledgeLookupCache.set(key, {
      value,
      expiresAt: Date.now() + KNOWLEDGE_LOOKUP_CACHE_TTL_MS,
    });
  }

  function isLikelyQuestionMessage(text) {
    const raw = String(text || "").trim();
    if (!raw) return false;
    if (raw.includes("?") || raw.includes("؟")) return true;
    return /\b(what|when|where|which|who|how|can you|do you|is there|fraga|fråga|vad|var|nar|när|هل|متى|وين|كيف|شو)\b/i.test(
      raw
    );
  }

  const KNOWLEDGE_INTENT_KEYWORDS = {
    hours: [
      "when are you open",
      "opening hours",
      "what time do you open",
      "are you open today",
      "hours",
      "open",
      "close",
      "öppettider",
      "öppet",
      "stänger",
      "när öppnar ni",
      "متى تفتحون",
      "اوقات الدوام",
      "ساعات العمل",
      "مفتوح",
    ],
    address: [
      "where are you located",
      "address",
      "location",
      "where are you",
      "adress",
      "var ligger ni",
      "plats",
      "عنوان",
      "الموقع",
      "وين مكانكم",
    ],
    contact: [
      "phone",
      "contact",
      "call",
      "telefon",
      "nummer",
      "ring",
      "phone number",
      "رقم",
      "اتصال",
      "الهاتف",
    ],
    menu: [
      "menu",
      "what do you serve",
      "what food do you have",
      "food",
      "price",
      "dish",
      "item",
      "meny",
      "mat",
      "rätter",
      "pris",
      "menu",
      "المنيو",
      "الاسعار",
      "الاسعار",
      "اكل",
      "طعام",
    ],
    faq: ["faq", "question", "fråga", "vanliga frågor", "سؤال", "الاسئلة الشائعة"],
    booking_rules: [
      "booking rules",
      "max party",
      "max people",
      "party size",
      "bokningsregler",
      "max antal",
      "الحجز",
      "عدد الاشخاص",
    ],
    business_name: [
      "business name",
      "restaurant name",
      "company name",
      "what is your name",
      "namn",
      "företagsnamn",
      "اسم المطعم",
      "اسم الشركة",
      "اسمكم",
    ],
  };

  function detectKnowledgeIntent(text) {
    const content = String(text || "");
    if (!content.trim()) return null;

    const likelyComplex = /\b(refund|allergy|legal|medical|complaint|cancel booking|reschedule)\b/i.test(
      content
    );
    if (likelyComplex) return null;

    if (containsAnyKeyword(content, KNOWLEDGE_INTENT_KEYWORDS.hours)) return "hours";
    if (containsAnyKeyword(content, KNOWLEDGE_INTENT_KEYWORDS.address)) return "address";
    if (containsAnyKeyword(content, KNOWLEDGE_INTENT_KEYWORDS.contact)) return "contact";
    if (containsAnyKeyword(content, KNOWLEDGE_INTENT_KEYWORDS.menu)) return "menu";
    if (containsAnyKeyword(content, KNOWLEDGE_INTENT_KEYWORDS.booking_rules))
      return "booking_rules";
    if (containsAnyKeyword(content, KNOWLEDGE_INTENT_KEYWORDS.business_name))
      return "business_name";
    if (containsAnyKeyword(content, KNOWLEDGE_INTENT_KEYWORDS.faq)) return "faq";
    if (isLikelyQuestionMessage(content)) return "faq";
    return null;
  }

  function isSimpleKnowledgeEligibleMessage(text) {
    return Boolean(detectKnowledgeIntent(text));
  }

  function tryAnswerFromHours({ text, hours, timeZone, intent = null }) {
    const msg = String(text || "").toLowerCase();
    if (intent && intent !== "hours") return null;
    if (!intent && !containsAnyKeyword(msg, KNOWLEDGE_INTENT_KEYWORDS.hours)) return null;
    if (!Array.isArray(hours) || hours.length === 0) return null;

    const requestedDay = resolveRequestedDayOfWeek(text, timeZone);
    if (requestedDay !== null) {
      const row = hours.find((r) => Number(r?.day_of_week) === Number(requestedDay));
      const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
        requestedDay
      ];
      if (!row) return `${dayName} hours are not configured yet.`;
      if (row.is_closed) return `We are closed on ${dayName}.`;
      if (!row.open_time || !row.close_time) return `${dayName} hours are not configured yet.`;
      return `On ${dayName}, we are open ${row.open_time} to ${row.close_time}.`;
    }

    const lines = hours
      .slice()
      .sort((a, b) => Number(a?.day_of_week || 0) - Number(b?.day_of_week || 0))
      .map((row) => {
        const day = Number(row?.day_of_week);
        const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day] || `Day ${day}`;
        if (row?.is_closed) return `${dayName}: Closed`;
        if (!row?.open_time || !row?.close_time) return `${dayName}: Not set`;
        return `${dayName}: ${row.open_time}-${row.close_time}`;
      });

    return lines.length ? `Our opening hours are:\n${lines.join("\n")}` : null;
  }

  function tryAnswerFromProfile({ text, profile, intent = null }) {
    const msg = String(text || "").toLowerCase();
    if (
      (intent === "business_name" ||
        containsAnyKeyword(msg, KNOWLEDGE_INTENT_KEYWORDS.business_name)) &&
      profile?.business_name
    ) {
      return `Our business name is ${profile.business_name}.`;
    }
    if ((intent === "address" || containsAnyKeyword(msg, KNOWLEDGE_INTENT_KEYWORDS.address)) && profile?.address) {
      return `Our address is ${profile.address}.`;
    }
    if ((intent === "contact" || containsAnyKeyword(msg, KNOWLEDGE_INTENT_KEYWORDS.contact)) && profile?.phone) {
      return `You can reach us at ${profile.phone}.`;
    }
    return null;
  }

  function tryAnswerFromMenu({ text, menuItems, intent = null }) {
    const msg = String(text || "").toLowerCase();
    if (intent && intent !== "menu") return null;
    if (!intent && !containsAnyKeyword(msg, KNOWLEDGE_INTENT_KEYWORDS.menu)) return null;
    if (!Array.isArray(menuItems) || menuItems.length === 0) return null;

    const normalizedMsg = normalizeTextForMatch(text);
    const itemMatch = menuItems.find((item) => {
      const name = normalizeTextForMatch(item?.name);
      return name && normalizedMsg.includes(name);
    });

    if (itemMatch) {
      const status = itemMatch.available === false ? "currently unavailable" : "available";
      const price =
        itemMatch.price === null || itemMatch.price === undefined || itemMatch.price === ""
          ? null
          : Number(itemMatch.price);
      const pricePart = Number.isFinite(price) ? ` Price: ${price}.` : "";
      const desc = String(itemMatch.description || "").trim();
      const descPart = desc ? ` ${desc}` : "";
      return `${itemMatch.name} is ${status}.${pricePart}${descPart}`.trim();
    }

    const topItems = menuItems
      .filter((item) => String(item?.name || "").trim())
      .slice(0, 6)
      .map((item) => {
        const p =
          item.price === null || item.price === undefined || item.price === ""
            ? "N/A"
            : String(item.price);
        const availability = item.available === false ? "unavailable" : "available";
        return `- ${item.name} (${p}, ${availability})`;
      });

    return topItems.length ? `Here are some menu items:\n${topItems.join("\n")}` : null;
  }
  // eslint-disable-next-line sonarjs/cognitive-complexity
  function tryAnswerFromFaq({ text, faqs, intent = null }) {
    if (!Array.isArray(faqs) || faqs.length === 0) return null;
    if (intent && intent !== "faq") return null;
    if (!intent && !isLikelyQuestionMessage(text)) return null;
    const normalizedMsg = normalizeTextForMatch(text);
    if (!normalizedMsg) return null;

    const msgTokens = new Set(normalizedMsg.split(" ").filter((t) => t.length > 2));
    let best = null;
    let bestScore = 0;
    let bestOverlap = 0;
    for (const row of faqs) {
      const q = normalizeTextForMatch(row?.question);
      if (!q) continue;
      const qTokens = q.split(" ").filter((t) => t.length > 2);
      if (qTokens.length === 0) continue;
      let overlap = 0;
      for (const token of qTokens) {
        if (msgTokens.has(token)) overlap += 1;
      }
      const score = overlap / qTokens.length;
      if (score > bestScore) {
        bestScore = score;
        bestOverlap = overlap;
        best = row;
      }
    }
    if (best && bestScore >= 0.55 && bestOverlap >= 2) {
      return String(best.answer || "").trim() || null;
    }
    return null;
  }
  // eslint-disable-next-line sonarjs/cognitive-complexity
  function tryAnswerFromKnowledgeBase({ text, knowledgeBase, intent = null }) {
    if (!Array.isArray(knowledgeBase) || knowledgeBase.length === 0) return null;
    if (intent && intent !== "faq") return null;
    if (!intent && !isLikelyQuestionMessage(text)) return null;
    const normalizedMsg = normalizeTextForMatch(text);
    if (!normalizedMsg) return null;

    const msgTokens = new Set(normalizedMsg.split(" ").filter((t) => t.length > 2));
    let best = null;
    let bestScore = 0;
    let bestOverlap = 0;
    for (const row of knowledgeBase) {
      const q = normalizeTextForMatch(row?.question);
      if (!q) continue;
      const qTokens = q.split(" ").filter((t) => t.length > 2);
      if (qTokens.length === 0) continue;

      let overlap = 0;
      for (const token of qTokens) {
        if (msgTokens.has(token)) overlap += 1;
      }

      const score = overlap / qTokens.length;
      if (score > bestScore) {
        bestScore = score;
        bestOverlap = overlap;
        best = row;
      }
    }

    if (best && bestScore >= 0.6 && bestOverlap >= 2) {
      return String(best.answer || "").trim() || null;
    }
    return null;
  }

  function tryAnswerFromBookingRules({ text, bookingRules, intent = null }) {
    const msg = String(text || "").toLowerCase();
    if (intent && intent !== "booking_rules") return null;
    if (!bookingRules) return null;
    if (containsAnyKeyword(msg, KNOWLEDGE_INTENT_KEYWORDS.booking_rules) || /\bbookings?\b/i.test(msg)) {
      return bookingRules.booking_enabled === false
        ? "Bookings are currently disabled."
        : "Bookings are enabled.";
    }
    if (/\bmax party|max people|party size\b/i.test(msg)) {
      if (bookingRules.max_party_size === null || bookingRules.max_party_size === undefined) {
        return "There is no max party size configured.";
      }
      return `Our max party size is ${bookingRules.max_party_size}.`;
    }
    return null;
  }

  function findKnowledgeAnswer({ intent, text, knowledge, timeZone }) {
    const checks = [
      tryAnswerFromHours({ text, hours: knowledge.hours, timeZone, intent }),
      tryAnswerFromProfile({ text, profile: knowledge.profile, intent }),
      tryAnswerFromMenu({ text, menuItems: knowledge.menuItems, intent }),
      tryAnswerFromFaq({ text, faqs: knowledge.faqs, intent }),
      tryAnswerFromKnowledgeBase({ text, knowledgeBase: knowledge.knowledgeBase, intent }),
      tryAnswerFromBookingRules({ text, bookingRules: knowledge.bookingRules, intent }),
    ];
    return checks.find((x) => String(x || "").trim()) || null;
  }

  function buildDirectKnowledgeReply(replyText) {
    const cleanReply = String(replyText || "").trim();
    if (!cleanReply) return null;
    return {
      reply: cleanReply,
      source: "knowledge_lookup",
      extractedData: { ...EMPTY_EXTRACTION, intent: "faq" },
    };
  }

  async function tryDirectKnowledgeAnswer({ userId, userMessage, businessTimezone }) {
    const intent = detectKnowledgeIntent(userMessage);
    if (!intent) return null;
    const knowledge = await loadBusinessKnowledgeForLookup(userId);
    const timeZone = String(knowledge?.profile?.timezone || businessTimezone || "UTC");
    const reply = findKnowledgeAnswer({
      intent,
      text: userMessage,
      knowledge,
      timeZone,
    });
    return buildDirectKnowledgeReply(reply);
  }

  function buildLearnedKnowledgeContext(rows, options = {}) {
    const maxItemsRaw = Number(options?.maxItems);
    const maxItems = Number.isFinite(maxItemsRaw)
      ? Math.max(2, Math.min(16, maxItemsRaw))
      : 8;
    const maxCharsRaw = Number(options?.maxChars);
    const maxChars = Number.isFinite(maxCharsRaw)
      ? Math.max(300, Math.min(6000, maxCharsRaw))
      : 1800;

    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return "";
    const lines = ["Learned business knowledge:"];
    for (const row of list.slice(0, maxItems)) {
      const q = String(row?.question || "").trim().slice(0, 120);
      const a = String(row?.answer || "").trim().slice(0, 220);
      if (!q || !a) continue;
      lines.push(`- Q: ${q}`, `  A: ${a}`);
    }
    if (lines.length <= 1) return "";
    const context = lines.join("\n");
    if (context.length <= maxChars) return context;
    return `${context.slice(0, maxChars - 3).trim()}...`;
  }

  function scoreKnowledgeRowForMessage(row, userMessage) {
    const question = normalizeKnowledgeText(row?.question || "");
    const message = normalizeKnowledgeText(userMessage || "");
    if (!question || !message) return 0;

    const messageTokens = new Set(message.split(" ").filter((token) => token.length > 2));
    if (!messageTokens.size) return 0;

    const questionTokens = question.split(" ").filter((token) => token.length > 2);
    if (!questionTokens.length) return 0;

    let overlap = 0;
    for (const token of questionTokens) {
      if (messageTokens.has(token)) overlap += 1;
    }
    return overlap / questionTokens.length;
  }

  async function loadKnowledgeBaseForPrompt(userId, options = {}) {
    const userMessage = String(options?.userMessage || "");
    const maxItemsRaw = Number(options?.maxItems);
    const maxItems = Number.isFinite(maxItemsRaw)
      ? Math.max(2, Math.min(12, maxItemsRaw))
      : 8;
    const maxCharsRaw = Number(options?.maxChars);
    const maxChars = Number.isFinite(maxCharsRaw)
      ? Math.max(300, Math.min(6000, maxCharsRaw))
      : 1800;

    try {
      const { data, error } = await supabaseAdmin
        .from("knowledge_base")
        .select(KB_SELECT_FIELDS)
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(120);

      if (error) {
        console.error("knowledge_base query failed:", error.message);
        return "";
      }

      const rows = Array.isArray(data) ? data : [];
      const ranked = rows
        .map((row) => ({
          row,
          score: scoreKnowledgeRowForMessage(row, userMessage),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return +new Date(b.row?.updated_at || 0) - +new Date(a.row?.updated_at || 0);
        })
        .map((entry) => entry.row);

      const chosenRows = ranked.length > 0 ? ranked.slice(0, maxItems) : rows.slice(0, 3);
      return buildLearnedKnowledgeContext(chosenRows, { maxItems, maxChars });
    } catch {
      return "";
    }
  }

  function normalizeKnowledgeText(value) {
    return normalizeTextForMatch(value);
  }

  async function learnFromHumanReply({
    userId,
    conversationId,
    humanReply,
    forceLearn = false,
  }) {
    const cleanAnswer = String(humanReply || "").trim();
    if (!userId || !conversationId || !cleanAnswer) return { learned: false, reason: "missing_input" };

    const { data: conversation, error: convoErr } = await supabaseAdmin
      .from("conversations")
      .select("id,status")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (convoErr) throw new Error(convoErr.message);
    if (!conversation) return { learned: false, reason: "conversation_not_found" };

    if (!forceLearn && conversation.status !== "escalated") {
      return { learned: false, reason: "not_escalated" };
    }

    const { data: latestCustomerRows, error: latestErr } = await supabaseAdmin
      .from("messages")
      .select("customer_message,created_at")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .not("customer_message", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (latestErr) throw new Error(latestErr.message);
    const question = String(latestCustomerRows?.[0]?.customer_message || "").trim();
    if (!question) return { learned: false, reason: "no_customer_question" };

    const normalizedQuestion = normalizeKnowledgeText(question);
    const normalizedAnswer = normalizeKnowledgeText(cleanAnswer);
    if (!normalizedQuestion || !normalizedAnswer) return { learned: false, reason: "empty_normalized" };

    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from("knowledge_base")
      .select("id,question,answer")
      .eq("user_id", userId)
      .eq("source", "human_reply")
      .order("updated_at", { ascending: false })
      .limit(200);

    if (existingErr) throw new Error(existingErr.message);

    const exact = (existingRows || []).find((row) => {
      return (
        normalizeKnowledgeText(row.question) === normalizedQuestion &&
        normalizeKnowledgeText(row.answer) === normalizedAnswer
      );
    });

    if (exact) return { learned: false, reason: "duplicate_exact", knowledgeId: exact.id };

    const sameQuestion = (existingRows || []).find((row) => {
      return normalizeKnowledgeText(row.question) === normalizedQuestion;
    });

    if (sameQuestion) {
      const { error: updateErr } = await supabaseAdmin
        .from("knowledge_base")
        .update({
          answer: cleanAnswer,
          source: "human_reply",
          confidence: "high",
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sameQuestion.id)
        .eq("user_id", userId);
      if (updateErr) throw new Error(updateErr.message);
      return { learned: true, reason: "updated_existing", knowledgeId: sameQuestion.id };
    }

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("knowledge_base")
      .insert({
        user_id: userId,
        question,
        answer: cleanAnswer,
        source: "human_reply",
        confidence: "high",
        tags: [],
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (insertErr) throw new Error(insertErr.message);
    return { learned: true, reason: "inserted", knowledgeId: inserted?.id || null };
  }

  async function loadBusinessTimezone(userId) {
    const fallbackTimezone =
      process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    try {
      const { data, error } = await supabaseAdmin
        .from("business_profiles")
        .select("timezone")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        console.error("business_profiles timezone query failed:", error.message);
        return fallbackTimezone;
      }

      const timezone = String(data?.timezone || "").trim();
      return timezone || fallbackTimezone;
    } catch {
      return fallbackTimezone;
    }
  }

  function isMissingRelationError(error, relationName) {
    const text = String(error?.message || "").toLowerCase();
    return (
      (error?.code === "42P01" || text.includes(DOES_NOT_EXIST_TEXT)) &&
      text.includes(String(relationName || "").toLowerCase())
    );
  }

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
      .from("businesses")
      .select("ai_model")
      .eq("id", userId)
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
    const activeCheck = await wixPaymentService.isBusinessActive(job.user_id);
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
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async function buildAnalyticsOverview(userId) {
    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startOf7d = new Date(startOfToday);
    startOf7d.setUTCDate(startOf7d.getUTCDate() - 6);

    const { data: messageRows, error: messageErr } = await supabaseAdmin
      .from("messages")
      .select(
        "id,created_at,channel,conversation_id,customer_message,ai_reply,total_tokens,estimated_cost_usd"
      )
      .eq("user_id", userId)
      .gte("created_at", startOf7d.toISOString())
      .order("created_at", { ascending: true })
      .limit(5000);

    if (messageErr) throw new Error(messageErr.message);

    const { data: conversationRows, error: conversationErr } = await supabaseAdmin
      .from("conversations")
      .select("id,channel,intent,status,created_at,last_message_at")
      .eq("user_id", userId)
      .gte("last_message_at", startOf7d.toISOString())
      .limit(5000);

    if (conversationErr) throw new Error(conversationErr.message);

    const rows = messageRows || [];
    const conversations = conversationRows || [];
    const byChannelMap = new Map();
    let messagesToday = 0;
    let messages7d = rows.length;
    let totalTokens7d = 0;
    let estimatedCost7d = 0;
    let hasAnyCost = false;
    let responsePairs = 0;
    let responseTimeTotal = 0;

    for (const row of rows) {
      const createdAt = new Date(row.created_at);
      if (createdAt >= startOfToday) messagesToday++;
      byChannelMap.set(row.channel, (byChannelMap.get(row.channel) || 0) + 1);
      if (Number.isFinite(Number(row.total_tokens))) {
        totalTokens7d += Number(row.total_tokens);
      }
      if (row.estimated_cost_usd !== null && row.estimated_cost_usd !== undefined) {
        estimatedCost7d += Number(row.estimated_cost_usd) || 0;
        hasAnyCost = true;
      }
    }

    const convoToday = conversations.filter(
      (row) => new Date(row.created_at) >= startOfToday
    ).length;
    const bookings7d = conversations.filter((row) => row.intent === "booking").length;
    const escalated7d = conversations.filter((row) => row.status === "escalated").length;

    const groupedMessages = new Map();
    for (const row of rows) {
      const key = row.conversation_id || `row:${row.id}`;
      if (!groupedMessages.has(key)) groupedMessages.set(key, []);
      groupedMessages.get(key).push(row);
    }

    for (const convoRows of groupedMessages.values()) {
      let pendingCustomerAt = null;
      for (const row of convoRows) {
        const createdMs = new Date(row.created_at).getTime();
        if (row.customer_message) {
          pendingCustomerAt = createdMs;
        }
        if (row.ai_reply && !row.customer_message && pendingCustomerAt !== null) {
          responseTimeTotal += Math.max(0, createdMs - pendingCustomerAt);
          responsePairs++;
          pendingCustomerAt = null;
        }
      }
    }

    return {
      messages_today: messagesToday,
      messages_7d: messages7d,
      conversations_today: convoToday,
      conversations_7d: conversations.length,
      by_channel: Array.from(byChannelMap.entries()).map(([channel, count]) => ({
        channel,
        count,
      })),
      bookings_7d: bookings7d,
      escalated_7d: escalated7d,
      avg_response_time_ms:
        responsePairs > 0 ? Math.round(responseTimeTotal / responsePairs) : null,
      total_tokens_7d: totalTokens7d || null,
      estimated_cost_usd_7d: hasAnyCost
        ? Number(estimatedCost7d.toFixed(6))
        : null,
    };
  }

  async function resolveWhatsAppClientId(externalUserId) {
    // Reuse existing mappings first (best signal in multi-user setups).
    const { data: mappedRow, error: mappedErr } = await supabaseAdmin
      .from("conversation_map")
      .select("user_id")
      .eq("channel", "whatsapp")
      .eq("external_user_id", externalUserId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (mappedErr) throw new Error(mappedErr.message);
    if (mappedRow?.user_id) return mappedRow.user_id;

    const fallbackClientId = String(process.env.WHATSAPP_DEFAULT_CLIENT_ID || "").trim();
    if (!fallbackClientId) {
      throw new Error("Missing WHATSAPP_DEFAULT_CLIENT_ID for WhatsApp inbound fallback");
    }
    return fallbackClientId;
  }

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
      .from("business_profiles")
      .select("user_id,business_owner_phone")
      .not("business_owner_phone", "is", null)
      .limit(5000);

    if (error) {
      const errText = String(error.message || "").toLowerCase();
      if (
        errText.includes("business_owner_phone") ||
        errText.includes(SCHEMA_CACHE_TEXT) ||
        errText.includes(DOES_NOT_EXIST_TEXT)
      ) {
        return null;
      }
      throw new Error(error.message);
    }

    const matches = [];
    for (const row of data || []) {
      const candidate = normalizePhoneForMatch(row?.business_owner_phone);
      if (!candidate) continue;
      if (candidate === normalizedSender) {
        matches.push({
          userId: row.user_id,
          businessOwnerPhone: row.business_owner_phone,
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
    const withAiPaused = await supabaseAdmin
      .from("conversations")
      .select("id,status,state,manual_mode,ai_paused,external_user_id,external_conversation_id,last_message_at")
      .eq("user_id", userId)
      .eq("channel", "whatsapp")
      .order("last_message_at", { ascending: false })
      .limit(50);

    let rows = withAiPaused.data || [];
    if (withAiPaused.error) {
      const errText = String(withAiPaused.error.message || "").toLowerCase();
      if (
        !errText.includes("ai_paused") &&
        !errText.includes("manual_mode") &&
        !errText.includes("state") &&
        !errText.includes(SCHEMA_CACHE_TEXT) &&
        !errText.includes(DOES_NOT_EXIST_TEXT)
      ) {
        throw new Error(withAiPaused.error.message);
      }
      const fallback = await supabaseAdmin
        .from("conversations")
        .select("id,status,external_user_id,external_conversation_id,last_message_at")
        .eq("user_id", userId)
        .eq("channel", "whatsapp")
        .order("last_message_at", { ascending: false })
        .limit(50);
      if (fallback.error) throw new Error(fallback.error.message);
      rows = (fallback.data || []).map((row) => ({
        ...row,
        state: row?.status === "escalated" ? "human_mode" : "idle",
        manual_mode: row?.status === "escalated",
        ai_paused: row?.status === "escalated",
      }));
    }

    return rows.filter(
      (row) =>
        row?.ai_paused === true ||
        row?.manual_mode === true ||
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
    // Per-client config takes priority; fall back to env vars for backwards compatibility
    let token;
    let phoneNumberId;

    if (clientConfig?.accessToken && clientConfig?.phoneNumberId) {
      token = String(clientConfig.accessToken).trim();
      phoneNumberId = clientConfig.phoneNumberId;
    } else {
      const rawToken = String(process.env.WHATSAPP_TOKEN || "");
      token = rawToken
        .trim()
        .replaceAll(/^['"]|['"]$/g, "")
        .replaceAll(/^Bearer\s+/i, "")
        .trim();
      phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    }

    if (!token || !phoneNumberId) {
      throw new Error("Missing WhatsApp credentials (no per-client config and no env vars)");
    }

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
      .from("business_profiles")
      .select("business_owner_phone")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      const errText = String(error.message || "").toLowerCase();
      if (errText.includes("business_owner_phone")) return;
      throw new Error(error.message);
    }

    const ownerPhone = String(data?.business_owner_phone || "").trim();
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
        manual_mode: true,
        ai_paused: true,
        last_message_at: nowIso,
        last_message_preview: String(incomingText).slice(0, 280),
        updated_at: nowIso,
      })
      .eq("id", conversation.id)
      .eq("user_id", userId);

    if (convoErr) {
      const fallbackErr = await updateConversationManualMode({
        userId,
        conversationId: conversation.id,
        manualMode: true,
        statusOverride: nextStatus,
        stateOverride: "human_mode",
        lastMessagePreview: incomingText,
      });
      if (fallbackErr) throw new Error(fallbackErr.message || "Failed to update conversation");
    }

    return {
      handled: true,
      sentToCustomer: true,
      conversationId: conversation.id,
      customerRecipient,
    };
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

  /* ================================
    PLAN FEATURES ENDPOINT + KNOWLEDGE LIMIT CHECK
  ================================ */
  app.get("/api/knowledge/limit", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const plan = await loadUserPlan(userId);
      const planConfig = getPlanDefaults(plan);
      const maxKnowledge = planConfig.max_knowledge;

      const { count, error } = await supabaseAdmin
        .from("knowledge_base")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      const current = count || 0;
      const limitReached = maxKnowledge > 0 && current >= maxKnowledge;

      return res.json({ current, max: maxKnowledge, limitReached });
    } catch (err) {
      console.error("Knowledge limit error:", err?.message || err);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

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

  app.post("/api/demo/generate", requireSupabaseUser, async (req, res) => {
    try {
      const requestedCount = Number(req.body?.count);
      const count = Number.isFinite(requestedCount) ? requestedCount : 12;

      await setUserDemoModeFlag({
        userId: req.user.id,
        enabled: true,
      });

      const result = await generateDemoConversations({
        userId: req.user.id,
        count,
      });

      return res.json({
        ok: true,
        demoMode: true,
        count: Math.max(10, Math.min(20, Number(count) || 12)),
        conversationsInserted: result.conversationsInserted,
        messagesInserted: result.messagesInserted,
      });
    } catch (e) {
      console.error("Demo generation failed:", e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

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

  app.post("/api/knowledge/learn", requireSupabaseUser, async (req, res) => {
    try {
      const businessId = String(req.body?.business_id || "").trim();
      const question = String(req.body?.question || "").trim();
      const answer = String(req.body?.answer || "").trim();

      if (!businessId || !question || !answer) {
        return res.status(400).json({
          error: "Missing required fields: business_id, question, answer",
        });
      }
      if (!UUID_REGEX.test(businessId)) {
        return res.status(400).json({ error: "Invalid business_id" });
      }
      if (req.user.id !== businessId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const learning = await knowledgeService.learnFromOwnerReply({
        businessId,
        question,
        answer,
      });

      return res.status(200).json({
        ok: true,
        learning,
      });
    } catch (err) {
      console.error("Knowledge learn endpoint failed:", err?.message || err);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
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