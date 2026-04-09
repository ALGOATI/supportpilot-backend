import {
  NOT_PROVIDED_LABEL,
  DEFAULT_TIMEZONE,
  KB_SELECT_FIELDS,
} from "../config/constants.js";
import {
  normalizeBusinessType,
  EMPTY_EXTRACTION,
} from "./aiService.js";

/* ================================
  Knowledge answering: structured business knowledge loaders + direct
  question answering against hours/profile/menu/faqs/knowledge_base/
  booking_rules, plus learnFromHumanReply for the escalation pipeline.
================================ */
export function createKnowledgeAnsweringService({ supabaseAdmin }) {
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

  return {
    hasStructuredBusinessData,
    buildStructuredBusinessContext,
    loadStructuredBusinessKnowledge,
    loadBusinessKnowledgeForLookup,
    getWeekdayInTimezone,
    resolveRequestedDayOfWeek,
    normalizeTextForMatch,
    containsAnyKeyword,
    isLikelyQuestionMessage,
    detectKnowledgeIntent,
    isSimpleKnowledgeEligibleMessage,
    tryAnswerFromHours,
    tryAnswerFromProfile,
    tryAnswerFromMenu,
    tryAnswerFromFaq,
    tryAnswerFromKnowledgeBase,
    tryAnswerFromBookingRules,
    findKnowledgeAnswer,
    buildDirectKnowledgeReply,
    tryDirectKnowledgeAnswer,
    buildLearnedKnowledgeContext,
    scoreKnowledgeRowForMessage,
    loadKnowledgeBaseForPrompt,
    normalizeKnowledgeText,
    learnFromHumanReply,
    loadBusinessTimezone,
  };
}
