import {
  NOT_PROVIDED_LABEL,
  DEFAULT_TIMEZONE,
  OPENROUTER_CHAT_COMPLETIONS_URL,
} from "../config/constants.js";

/* ================================
  AI / OpenRouter helpers — formatting, costing, title detection,
  safety evaluation, structured-data extraction. None of these touch
  supabaseAdmin so they're plain exports rather than a factory.
================================ */

export function styleRules(tone, replyLength) {
  const toneRules = {
    casual: "Write casually and relaxed. Keep it clear and practical.",
    friendly: "Write warm and friendly, but still concise and professional.",
    default: "Write professional, polite, concise, and clear. No slang.",
  };
  const lengthRules = {
    detailed: "Give a detailed answer only when needed. Avoid repetition.",
    normal: "Give a short answer (1 short paragraph). Avoid repeating the customer.",
    default: "Be concise (1-2 short sentences when possible). Avoid repeating the customer.",
  };
  const toneRule = toneRules[tone] || toneRules.default;
  const lengthRule = lengthRules[replyLength] || lengthRules.default;

  return { toneRule, lengthRule };
}

export function parsePricingMap() {
  try {
    return JSON.parse(process.env.OPENROUTER_PRICING_MAP || "{}");
  } catch {
    return {};
  }
}

export function estimateCostUsd({ model, promptTokens, completionTokens, totalTokens }) {
  const pricingMap = parsePricingMap();
  const pricing = pricingMap?.[model];
  if (!pricing || typeof pricing !== "object") return null;

  const inputRate = Number(pricing.input_per_1k ?? pricing.prompt_per_1k);
  const outputRate = Number(pricing.output_per_1k ?? pricing.completion_per_1k);
  const totalRate = Number(pricing.total_per_1k);

  if (Number.isFinite(inputRate) || Number.isFinite(outputRate)) {
    const promptCost = Number.isFinite(inputRate)
      ? ((Number(promptTokens) || 0) / 1000) * inputRate
      : 0;
    const completionCost = Number.isFinite(outputRate)
      ? ((Number(completionTokens) || 0) / 1000) * outputRate
      : 0;
    return Number((promptCost + completionCost).toFixed(6));
  }

  if (Number.isFinite(totalRate) && Number.isFinite(Number(totalTokens))) {
    return Number((((Number(totalTokens) || 0) / 1000) * totalRate).toFixed(6));
  }

  return null;
}

export function getUsageFromOpenRouterResponse(data) {
  const usage = data?.usage || {};
  const promptTokens = Number.isFinite(Number(usage.prompt_tokens))
    ? Number(usage.prompt_tokens)
    : null;
  const completionTokens = Number.isFinite(Number(usage.completion_tokens))
    ? Number(usage.completion_tokens)
    : null;
  let totalTokens = null;
  if (Number.isFinite(Number(usage.total_tokens))) {
    totalTokens = Number(usage.total_tokens);
  } else if (promptTokens !== null || completionTokens !== null) {
    totalTokens = (promptTokens || 0) + (completionTokens || 0);
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

export function buildConversationTitle({ channel, externalUserId, firstMessage }) {
  if (externalUserId) {
    const label = channel.charAt(0).toUpperCase() + channel.slice(1);
    return `${label} • ${String(externalUserId).slice(0, 24)}`;
  }

  const words = String(firstMessage || "")
    .replaceAll(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);

  if (words.length > 0) {
    return words.join(" ");
  }

  return channel === "dashboard" ? "Dashboard chat" : `${channel} conversation`;
}

export function detectConversationTopic({ text, extractedData }) {
  const content = String(text || "").toLowerCase();
  const escalationReason = String(extractedData?.escalation_reason || "").toLowerCase();

  if (extractedData?.intent === "booking") return "booking";
  if (escalationReason === "refund" || /\b(refund|money back|chargeback)\b/i.test(content))
    return "refund";
  if (escalationReason === "allergy" || /\b(allergy|allergic|gluten|peanut|nut allergy)\b/i.test(content))
    return "allergy";
  if (escalationReason === "complaint" || /\b(complain|complaint|bad service|rude|angry)\b/i.test(content))
    return "complaint";
  if (/\b(address|location|located|where are you)\b/i.test(content)) return "address";
  if (/\b(hours|open|close|opening)\b/i.test(content)) return "hours";
  if (/\b(menu|food|dish|price|serve)\b/i.test(content)) return "menu";
  return "other";
}

export function buildRuleBasedConversationTitle({ text, extractedData }) {
  const topic = detectConversationTopic({ text, extractedData });
  if (topic === "refund") return "Refund request";
  if (topic === "complaint") return "Complaint";
  if (topic === "allergy") return "Allergy question";
  if (topic === "address") return "Address inquiry";
  if (topic === "hours") return "Opening hours";
  if (topic === "menu") return "Menu question";

  if (topic === "booking") {
    const people = String(extractedData?.people || "").trim();
    const date = String(extractedData?.date || "").trim();
    if (date) return `Booking for ${date}`;
    if (people) return `Booking for ${people} people`;
    return "Booking inquiry";
  }

  return null;
}

export function detectTopicFromTitle(title) {
  const value = String(title || "").toLowerCase();
  if (!value) return "other";
  if (value.includes("booking")) return "booking";
  if (value.includes("refund")) return "refund";
  if (value.includes("complaint")) return "complaint";
  if (value.includes("allergy")) return "allergy";
  if (value.includes("address")) return "address";
  if (value.includes("opening hours") || value.includes("hours")) return "hours";
  if (value.includes("menu")) return "menu";
  return "other";
}

export function isGenericConversationTitle(title, channel) {
  const value = String(title || "").trim().toLowerCase();
  if (!value) return true;
  if (value === "untitled conversation") return true;
  if (value === "dashboard chat") return true;
  if (value === `${String(channel || "").toLowerCase()} conversation`) return true;
  if (value.startsWith("whatsapp •")) return true;
  if (value.startsWith("instagram •")) return true;
  if (value.startsWith("dashboard •")) return true;
  return false;
}

export function shouldUpdateConversationTitle({
  existingTitle,
  proposedTitle,
  channel,
  previousTopic,
  nextTopic,
}) {
  const existing = String(existingTitle || "").trim();
  const proposed = String(proposedTitle || "").trim();
  if (!proposed) return false;
  if (!existing) return true;
  if (existing === proposed) return false;
  if (isGenericConversationTitle(existing, channel)) return true;
  if (!nextTopic || nextTopic === "other") return false;
  return previousTopic !== nextTopic;
}

export function detectConversationTags({ extractedData, text }) {
  const content = String(text || "").toLowerCase();
  const complaintKeywords = ["angry", "bad", "refund", "complain", "late"];
  const faqKeywords = ["hours", "open", "price", "menu", "address"];
  const hasComplaint = complaintKeywords.some((word) => content.includes(word));
  const hasFaq = faqKeywords.some((word) => content.includes(word));
  const hasUrgency = ["urgent", "asap"].some((word) => content.includes(word));

  let intent = "other";
  if (extractedData?.intent === "booking") {
    intent = "booking";
  } else if (hasComplaint) {
    intent = "complaint";
  } else if (hasFaq) {
    intent = "faq";
  }

  const priority = hasComplaint || hasUrgency ? "high" : "normal";
  return { intent, priority };
}

export function normalizeBusinessType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["restaurant", "barber", "clinic", "retail", "other"].includes(raw)) {
    return raw;
  }
  return "other";
}

export function buildIndustryTemplateGuidance(businessType) {
  const type = normalizeBusinessType(businessType);
  if (type === "restaurant") {
    return [
      "- Prioritize table bookings and reservation flow.",
      "- Answer menu and opening-hours questions directly when possible.",
      "- Handle address/location requests clearly.",
      "- Escalate allergy-risk cases when certainty is low.",
    ].join("\n");
  }
  if (type === "barber") {
    return [
      "- Prioritize appointment bookings and slot collection.",
      "- Focus on haircut/service questions and pricing clarity.",
      "- Answer opening-hours and location questions quickly.",
    ].join("\n");
  }
  if (type === "clinic") {
    return [
      "- Prioritize appointment scheduling and clinic logistics.",
      "- Handle location and insurance/payment policy questions.",
      "- Never provide medical advice; escalate medical-risk requests.",
    ].join("\n");
  }
  if (type === "retail") {
    return [
      "- Prioritize product availability, pricing, and store info.",
      "- Handle opening-hours and location questions directly.",
      "- Escalate refund/complaint cases when needed.",
    ].join("\n");
  }
  return [
    "- Prioritize clear, factual business Q&A.",
    "- Use booking flow when booking intent is detected.",
    "- Escalate risky topics when confidence is low.",
  ].join("\n");
}

export function evaluateResponseSafety({ text, reply, extractedData }) {
  const content = String(text || "").toLowerCase();
  const aiText = String(reply || "").toLowerCase();

  const hasComplaintLanguage =
    /(angry|upset|terrible|awful|worst|unacceptable|frustrated|complain)/i.test(content);
  const hasRefund = /\b(refund|chargeback|money back|cancel and refund)\b/i.test(content);
  const hasAllergy = /\b(allergy|allergic|gluten|peanut|nut allergy|lactose)\b/i.test(content);
  const hasMedical = /\b(medical|medicine|doctor|prescription|diagnosis|symptom)\b/i.test(content);
  const hasLegal = /\b(legal|lawyer|attorney|sue|lawsuit|liability)\b/i.test(content);
  const wantsHumanAgent =
    /\b(real person|human|staff|support|agent)\b/i.test(content) &&
    /\b(connect|talk|speak|need|want)\b/i.test(content);
  const hasBookingConflict =
    extractedData?.intent === "booking" &&
    (/\b(conflict|double[- ]?book|overlap|already booked|clash)\b/i.test(content) ||
      (/\b(change|reschedule|move)\b/i.test(content) && /\bor\b/i.test(content)));
  const aiUncertain =
    /\b(i'm not sure|i am not sure|not certain|can't confirm|cannot confirm|unclear)\b/i.test(
      aiText
    );

  let escalationReason = null;
  if (hasRefund) escalationReason = "refund";
  else if (hasAllergy) escalationReason = "allergy";
  else if (hasMedical) escalationReason = "medical";
  else if (hasLegal) escalationReason = "legal";
  else if (wantsHumanAgent) escalationReason = "uncertain";
  else if (hasComplaintLanguage) escalationReason = "complaint";
  else if (hasBookingConflict) escalationReason = "booking_conflict";
  else if (aiUncertain) escalationReason = "uncertain";

  let confidence = "high";
  if (escalationReason) confidence = "low";
  else if (extractedData?.intent === "booking" && extractedData?.status === "incomplete") {
    confidence = "medium";
  }

  const riskyReasonSet = new Set([
    "complaint",
    "refund",
    "allergy",
    "medical",
    "legal",
    "booking_conflict",
  ]);
  const isRiskyEscalation = escalationReason ? riskyReasonSet.has(escalationReason) : false;

  return {
    confidence,
    escalationReason,
    shouldEscalate: confidence === "low" || Boolean(escalationReason),
    isRiskyEscalation,
  };
}

export const EMPTY_EXTRACTION = {
  intent: "other",
  name: null,
  date: null,
  time: null,
  people: null,
  phone: null,
  status: "incomplete",
  missing: [],
};

export function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

export function extractFirstJsonArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

export function normalizeImportedMenuItems(rawItems) {
  const list = Array.isArray(rawItems) ? rawItems : [];
  const normalized = [];

  for (const row of list) {
    const name = String(row?.name || "").trim();
    if (!name) continue;

    const rawPrice = row?.price;
    const priceNum = rawPrice === null || rawPrice === undefined || rawPrice === ""
      ? null
      : Number(rawPrice);

    normalized.push({
      name,
      price: Number.isFinite(priceNum) ? priceNum : null,
      description: row?.description ? String(row.description).trim() : null,
      category: row?.category ? String(row.category).trim() : null,
    });
  }

  return normalized.slice(0, 300);
}

export function normalizeExtraction(raw) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const intent =
    safe.intent === "booking" || safe.intent === "faq" ? safe.intent : "other";

  const missing = Array.isArray(safe.missing)
    ? safe.missing
        .map((x) => String(x || "").trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];

  const normalized = {
    intent,
    name: safe.name ? String(safe.name) : null,
    date: safe.date ? String(safe.date) : null,
    time: safe.time ? String(safe.time) : null,
    people:
      safe.people === null || safe.people === undefined || safe.people === ""
        ? null
        : String(safe.people),
    phone: safe.phone ? String(safe.phone) : null,
    status:
      safe.status === "complete" && missing.length === 0
        ? "complete"
        : "incomplete",
    missing,
  };

  if (normalized.intent !== "booking") {
    return { ...EMPTY_EXTRACTION, intent: normalized.intent };
  }

  return normalized;
}

export async function extractStructuredData({
  model,
  historyMessages,
  userMessage,
  assistantReply,
  business,
  businessTimezone,
  todayIsoDate,
}) {
  const extractionSystemPrompt = `
  You extract structured fields from customer support conversations.
  Return ONLY valid JSON (no markdown, no extra text) in this shape:
  {
    "intent": "booking" | "faq" | "other",
    "name": string|null,
    "date": string|null,
    "time": string|null,
    "people": string|null,
    "phone": string|null,
    "status": "incomplete" | "complete",
    "missing": string[]
  }

  Rules:
  - Use "booking" only when the user is booking/reservation related.
  - For booking, mark status "complete" only if date, time, people, name, and phone are all present.
  - Convert relative date phrases to ISO date (YYYY-MM-DD) when possible.
    Examples: "today", "tomorrow", "tonight", "next friday".
  - If date wording is truly ambiguous and cannot be resolved, keep date null.
  - missing must list only missing booking fields from: ["date","time","people","name","phone"].
  - If not booking, return intent "faq" or "other", status "incomplete", and missing [].
  - Prefer latest conversation details.
  - Do not invent values.

  Date context:
  - Today (ISO): ${todayIsoDate}
  - Business timezone: ${businessTimezone}

  Business context:
  ${business}
    `.trim();

  const extractionResp = await fetch(
    OPENROUTER_CHAT_COMPLETIONS_URL,
    {
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
          { role: "system", content: extractionSystemPrompt },
          ...historyMessages,
          { role: "user", content: userMessage },
          { role: "assistant", content: assistantReply },
        ],
        temperature: 0,
        max_tokens: Math.max(
          120,
          Number(process.env.OPENROUTER_EXTRACTION_MAX_TOKENS || 220)
        ),
      }),
    }
  );

  if (!extractionResp.ok) {
    const errText = await extractionResp.text();
    throw new Error(`Extraction request failed: ${errText}`);
  }

  const extractionData = await extractionResp.json();
  const raw =
    extractionData?.choices?.[0]?.message?.content?.trim() ||
    JSON.stringify(EMPTY_EXTRACTION);

  try {
    return normalizeExtraction(JSON.parse(raw));
  } catch {
    const jsonSlice = extractFirstJsonObject(raw);
    if (!jsonSlice) return { ...EMPTY_EXTRACTION };
    try {
      return normalizeExtraction(JSON.parse(jsonSlice));
    } catch {
      return { ...EMPTY_EXTRACTION };
    }
  }
}
