const VALID_PLANS = new Set(["starter", "pro", "enterprise"]);
const VALID_TASKS = new Set(["main_reply", "safety_check", "extraction"]);

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return fallback;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function normalizePlan(plan) {
  const raw = String(plan || "").trim().toLowerCase();
  if (raw === "pro") return "pro";
  if (raw === "enterprise" || raw === "business") return "enterprise";
  if (raw === "starter" || raw === "standard" || raw === "basic") return "starter";
  return "starter";
}

function getMainReplyModel(plan) {
  const normalizedPlan = normalizePlan(plan);
  if (normalizedPlan === "enterprise") {
    return firstNonEmpty(
      process.env.OPENROUTER_MODEL_ENTERPRISE,
      process.env.OPENROUTER_MODEL_BEST,
      process.env.OPENROUTER_MODEL_BUSINESS,
      process.env.OPENROUTER_MODEL_PRO,
      process.env.OPENROUTER_MODEL
    );
  }
  if (normalizedPlan === "pro") {
    return firstNonEmpty(
      process.env.OPENROUTER_MODEL_PRO,
      process.env.OPENROUTER_MODEL_BETTER,
      process.env.OPENROUTER_MODEL
    );
  }
  return firstNonEmpty(
    process.env.OPENROUTER_MODEL_STARTER,
    process.env.OPENROUTER_MODEL_CHEAP,
    process.env.OPENROUTER_MODEL_FREE,
    process.env.OPENROUTER_MODEL
  );
}

export function getModelsForPlan(plan) {
  const normalizedPlan = normalizePlan(plan);
  const mainReply = getMainReplyModel(normalizedPlan);

  if (normalizedPlan === "enterprise") {
    return {
      main_reply: mainReply,
      safety_check: firstNonEmpty(
        process.env.OPENROUTER_MODEL_ENTERPRISE_SAFETY,
        process.env.OPENROUTER_MODEL_SAFETY,
        process.env.OPENROUTER_MODEL_ENTERPRISE,
        mainReply
      ),
      extraction: firstNonEmpty(
        process.env.OPENROUTER_MODEL_ENTERPRISE_EXTRACTION,
        process.env.OPENROUTER_MODEL_EXTRACTION,
        process.env.OPENROUTER_MODEL_ENTERPRISE,
        mainReply
      ),
    };
  }

  if (normalizedPlan === "pro") {
    return {
      main_reply: mainReply,
      safety_check: firstNonEmpty(
        process.env.OPENROUTER_MODEL_PRO_SAFETY,
        process.env.OPENROUTER_MODEL_SAFETY,
        process.env.OPENROUTER_MODEL_PRO,
        mainReply
      ),
      extraction: firstNonEmpty(
        process.env.OPENROUTER_MODEL_PRO_EXTRACTION,
        process.env.OPENROUTER_MODEL_EXTRACTION,
        process.env.OPENROUTER_MODEL_PRO,
        mainReply
      ),
    };
  }

  return {
    main_reply: mainReply,
    safety_check: firstNonEmpty(
      process.env.OPENROUTER_MODEL_STARTER_SAFETY,
      process.env.OPENROUTER_MODEL_SAFETY,
      process.env.OPENROUTER_MODEL_STARTER,
      mainReply
    ),
    extraction: firstNonEmpty(
      process.env.OPENROUTER_MODEL_STARTER_EXTRACTION,
      process.env.OPENROUTER_MODEL_EXTRACTION,
      process.env.OPENROUTER_MODEL_STARTER,
      mainReply
    ),
  };
}

export function getModelForTask(plan, task = "main_reply") {
  const normalizedTask = String(task || "main_reply").trim().toLowerCase();
  if (!VALID_TASKS.has(normalizedTask)) {
    return getModelsForPlan(plan).main_reply;
  }
  const models = getModelsForPlan(plan);
  return models[normalizedTask] || models.main_reply;
}

export function hasAnyModelConfigured() {
  return VALID_PLANS.size > 0 && Array.from(VALID_PLANS).some((plan) => {
    return Boolean(getModelForTask(plan, "main_reply"));
  });
}

export function getPlanLimits(plan) {
  const normalizedPlan = normalizePlan(plan);
  const models = getModelsForPlan(normalizedPlan);

  if (normalizedPlan === "enterprise") {
    return {
      plan: normalizedPlan,
      maxConversationsPerMonth: null,
      allowedChannels: null,
      maxMessageChars: Math.max(
        500,
        Number(process.env.MESSAGE_CHAR_LIMIT_ENTERPRISE || 1200)
      ),
      aiModel: models.main_reply,
      models,
    };
  }

  if (normalizedPlan === "pro") {
    return {
      plan: normalizedPlan,
      maxConversationsPerMonth: 3000,
      allowedChannels: 2,
      maxMessageChars: 500,
      aiModel: models.main_reply,
      models,
    };
  }

  return {
    plan: "starter",
    maxConversationsPerMonth: 1000,
    allowedChannels: 1,
    maxMessageChars: 300,
    aiModel: models.main_reply,
    models,
  };
}

export function getReplyTokenCapForPlan(plan) {
  const normalizedPlan = normalizePlan(plan);
  if (normalizedPlan === "enterprise") {
    return parsePositiveInt(process.env.OPENROUTER_MAX_TOKENS_ENTERPRISE, 360);
  }
  if (normalizedPlan === "pro") {
    return parsePositiveInt(process.env.OPENROUTER_MAX_TOKENS_PRO, 220);
  }
  return parsePositiveInt(process.env.OPENROUTER_MAX_TOKENS_STARTER, 120);
}
