import crypto from "node:crypto";
import { getPlanDefaults, getTierFromWixPlanId } from "../../config/planConfig.js";

function normalizeSecret(value) {
  return String(value || "")
    .replaceAll(/[\u200B-\u200D\uFEFF]/g, "")
    .replaceAll(/[\r\n\t]/g, "")
    .trim();
}

function safeSecretFromHeader(headerValue) {
  const raw = String(headerValue || "").trim();
  if (!raw) return "";
  if (raw.toLowerCase().startsWith("bearer ")) {
    return normalizeSecret(raw.slice(7));
  }
  return normalizeSecret(raw);
}

function timingSafeSecretMatch(incoming, expected) {
  const a = normalizeSecret(incoming);
  const b = normalizeSecret(expected);
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function parseDateOrNull(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function getFromPaths(payload, paths = []) {
  for (const path of paths) {
    const segments = path.split(".");
    let cursor = payload;
    let found = true;
    for (const segment of segments) {
      if (!cursor || typeof cursor !== "object" || !(segment in cursor)) {
        found = false;
        break;
      }
      cursor = cursor[segment];
    }
    if (found && cursor !== undefined && cursor !== null) return cursor;
  }
  return null;
}

function resolvePlanFromPayload(payload) {
  const planNameRaw = String(
    getFromPaths(payload, [
      "planName",
      "wixPlanName",
      "plan.name",
      "lineItems.0.planName",
      "data.plan.name",
      "data.planName",
      "subscription.plan.name",
    ]) || ""
  ).toLowerCase();

  const planIdRaw = String(
    getFromPaths(payload, [
      "wixPlanId",
      "planId",
      "plan.id",
      "lineItems.0.planId",
      "data.plan.id",
      "subscription.plan.id",
    ]) || ""
  );

  if (!planIdRaw && !planNameRaw) return null;

  // Resolve by Wix plan UUID (covers all 4 tiers)
  if (planIdRaw) {
    const tier = getTierFromWixPlanId(planIdRaw);
    if (tier) return tier;
  }

  // Fallback: match by plan name
  if (planNameRaw.includes("trial")) return "trial";
  if (planNameRaw.includes("pro")) return "pro";
  if (planNameRaw.includes("business") || planNameRaw.includes("enterprise")) {
    return "business";
  }
  return "starter";
}

function isCancellationEvent(payload) {
  const eventType = String(
    getFromPaths(payload, ["eventType", "event_type", "type", "eventName"]) || ""
  ).toLowerCase();
  const status = String(
    getFromPaths(payload, [
      "status",
      "subscriptionStatus",
      "data.status",
      "subscription.status",
    ]) || ""
  ).toLowerCase();

  const cancellationHint =
    /cancel|cancellation|expired|expire|terminated|ended/.test(eventType) ||
    /cancel|expired|terminate|ended/.test(status);
  return cancellationHint;
}

function getNormalizedEmail(payload) {
  const emailRaw = String(
    getFromPaths(payload, [
      "email",
      "customerEmail",
      "customer.email",
      "buyer.email",
      "data.customer.email",
      "data.email",
      "subscription.customer.email",
    ]) || ""
  )
    .trim()
    .toLowerCase();
  return emailRaw || null;
}

function getOrderId(payload) {
  return String(
    getFromPaths(payload, [
      "wixOrderId",
      "orderId",
      "order.id",
      "data.order.id",
      "subscription.orderId",
    ]) || ""
  ).trim() || null;
}

function getPlanDates(payload) {
  const startedAt = parseDateOrNull(
    getFromPaths(payload, [
      "planStartedAt",
      "startedAt",
      "order.createdAt",
      "data.startedAt",
      "subscription.startDate",
    ])
  );
  const expiresAt = parseDateOrNull(
    getFromPaths(payload, [
      "planExpiresAt",
      "expiresAt",
      "expirationDate",
      "data.expiresAt",
      "subscription.endDate",
    ])
  );
  return { startedAt, expiresAt };
}


export function createWixWebhookService({
  supabaseAdmin,
  usageService,
  webhookSecret = process.env.WIX_WEBHOOK_SECRET,
}) {
  function verifySecret(secretHeaderValue) {
    return timingSafeSecretMatch(
      safeSecretFromHeader(secretHeaderValue),
      normalizeSecret(webhookSecret)
    );
  }

  async function findBusinessByEmail(email) {
    const { data, error } = await supabaseAdmin
      .from("businesses")
      .select("id,email,plan")
      .eq("email", email)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data || null;
  }

  async function syncLegacyPlan({ businessId, plan }) {
    const { error } = await supabaseAdmin
      .from("client_settings")
      .upsert(
        {
          user_id: businessId,
          plan,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    if (error) throw new Error(error.message);
  }

  async function processEvent(payload = {}) {
    const email = getNormalizedEmail(payload);
    if (!email) {
      const err = new Error("Missing customer email in Wix payload");
      err.statusCode = 400;
      throw err;
    }

    const business = await findBusinessByEmail(email);
    if (!business?.id) {
      const err = new Error("Business not found for email");
      err.statusCode = 404;
      throw err;
    }

    const orderId = getOrderId(payload);
    const { startedAt, expiresAt } = getPlanDates(payload);
    const cancellation = isCancellationEvent(payload);
    const resolvedPlan = resolvePlanFromPayload(payload);
    if (!cancellation && !resolvedPlan) {
      return {
        ignored: true,
        businessId: business.id,
        email,
        plan: business.plan || "starter",
        cancellation: false,
        orderId,
        planStartedAt: null,
        planExpiresAt: null,
      };
    }

    const nextPlan = cancellation ? "starter" : resolvedPlan;
    const tierDefaults = getPlanDefaults(nextPlan);
    const nowIso = new Date().toISOString();

    const updatePayload = cancellation
      ? {
          plan: "starter",
          max_messages: tierDefaults.max_messages,
          ai_model: tierDefaults.ai_model,
          plan_started_at: null,
          plan_expires_at: expiresAt || nowIso,
          wix_order_id: orderId,
        }
      : {
          plan: nextPlan,
          max_messages: tierDefaults.max_messages,
          ai_model: tierDefaults.ai_model,
          plan_started_at: startedAt || nowIso,
          plan_expires_at: expiresAt,
          wix_order_id: orderId,
        };

    const update = await supabaseAdmin
      .from("businesses")
      .update(updatePayload)
      .eq("id", business.id)
      .select("id,email,plan,plan_started_at,plan_expires_at,wix_order_id")
      .maybeSingle();

    if (update.error) throw new Error(update.error.message);
    await syncLegacyPlan({ businessId: business.id, plan: updatePayload.plan });
    await usageService.ensureUsageRowForCurrentMonth(business.id);

    return {
      businessId: business.id,
      email,
      plan: updatePayload.plan,
      cancellation,
      orderId: updatePayload.wix_order_id || null,
      planStartedAt: updatePayload.plan_started_at || null,
      planExpiresAt: updatePayload.plan_expires_at || null,
    };
  }

  return {
    verifySecret,
    processEvent,
  };
}
