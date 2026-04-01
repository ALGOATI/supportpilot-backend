import { WIX_PLAN_IDS, getPlanDefaults } from "../../config/planConfig.js";

// ============================================================
// Wix Payment Webhook Service — Onboarding & Plan Management
// ============================================================
// Endpoint: POST /webhooks/wix/payment
// Flow:     Wix purchase → create/find user → upsert business
//           → send magic link → client lands on dashboard
//
// Column mapping (businesses table):
//   id    = user_id  (PK references auth.users)
//   email = owner_email
//   name  = owner_name
//   plan  = plan_tier
// ============================================================

// ─── PLAN CONFIGURATION ─────────────────────────────────────
// Pricing (SEK kr/month):
//   Trial:     999 kr   (hidden — send direct purchase link)
//   Starter:   2,499 kr
//   Pro:       4,999 kr
//   Business:  11,999 kr
// ─────────────────────────────────────────────────────────────

// ─── Payload helpers (flexible Wix payload parsing) ─────────

function getFromPaths(payload, paths) {
  for (const p of paths) {
    const segments = p.split(".");
    let cursor = payload;
    let ok = true;
    for (const seg of segments) {
      if (!cursor || typeof cursor !== "object" || !(seg in cursor)) {
        ok = false;
        break;
      }
      cursor = cursor[seg];
    }
    if (ok && cursor !== undefined && cursor !== null) return cursor;
  }
  return null;
}

function extractEmail(payload) {
  const raw = String(
    getFromPaths(payload, [
      "email",
      "buyer.email",
      "customer.email",
      "customerEmail",
      "data.buyer.email",
      "data.customer.email",
      "data.email",
    ]) || ""
  )
    .trim()
    .toLowerCase();
  return raw || null;
}

function extractName(payload) {
  return (
    String(
      getFromPaths(payload, [
        "name",
        "buyer.name",
        "buyer.fullName",
        "customer.name",
        "customerName",
        "data.buyer.name",
        "data.customer.name",
      ]) || ""
    ).trim() || null
  );
}

function extractPlanId(payload) {
  return (
    String(
      getFromPaths(payload, [
        "planId",
        "wixPlanId",
        "plan.id",
        "data.plan.id",
        "lineItems.0.planId",
        "subscription.plan.id",
      ]) || ""
    ).trim() || null
  );
}

function extractOrderId(payload) {
  return (
    String(
      getFromPaths(payload, [
        "orderId",
        "wixOrderId",
        "order.id",
        "data.order.id",
        "subscription.orderId",
      ]) || ""
    ).trim() || null
  );
}

// ─── Factory ────────────────────────────────────────────────

export function createWixPaymentService({ supabaseAdmin, dashboardUrl }) {
  const redirectTo = dashboardUrl
    ? `${dashboardUrl.replace(/\/+$/, "")}/dashboard`
    : null;

  // ── Main webhook handler ────────────────────────────────

  async function handlePaymentWebhook(payload = {}) {
    // 1. Extract & validate required fields
    const email = extractEmail(payload);
    if (!email) {
      const err = new Error("Missing buyer email in webhook payload");
      err.statusCode = 400;
      throw err;
    }

    const planId = extractPlanId(payload);
    if (!planId) {
      const err = new Error("Missing plan ID in webhook payload");
      err.statusCode = 400;
      throw err;
    }

    const tier = WIX_PLAN_IDS[planId];
    if (!tier) {
      const err = new Error(`Unknown Wix plan ID: ${planId}`);
      err.statusCode = 400;
      throw err;
    }
    const planConfig = { tier, ...getPlanDefaults(tier) };

    const buyerName = extractName(payload);
    const orderId = extractOrderId(payload);
    const nowIso = new Date().toISOString();

    console.log(
      `📦 Wix payment received: ${email} → ${planConfig.tier} (planId: ${planId})`
    );

    // 2. Trial guard — one-time only
    if (planConfig.tier === "trial") {
      const { data: existing } = await supabaseAdmin
        .from("businesses")
        .select("id, has_used_trial")
        .eq("email", email)
        .maybeSingle();

      if (existing?.has_used_trial) {
        console.log(`🚫 Trial rejected for ${email} — already used`);
        const err = new Error(
          "This account has already used its one-time trial"
        );
        err.statusCode = 409;
        throw err;
      }
    }

    // 3. Create or find Supabase Auth user
    let userId;

    const { data: createData } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: buyerName ? { full_name: buyerName } : undefined,
      });

    if (createData?.user) {
      userId = createData.user.id;
      console.log(`✅ New auth user created: ${email} (${userId})`);
    } else {
      // User already exists — look up their ID
      const { data: biz } = await supabaseAdmin
        .from("businesses")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (biz?.id) {
        userId = biz.id;
      } else {
        // Fallback: direct auth lookup by email (scales beyond 200 users)
        const { data: authHit, error: rpcErr } = await supabaseAdmin
          .rpc("get_auth_user_by_email", { lookup_email: email })
          .maybeSingle();
        if (rpcErr) {
          throw new Error(`Auth user lookup failed: ${rpcErr.message}`);
        }
        if (!authHit) {
          throw new Error(`Could not find or create user for ${email}`);
        }
        userId = authHit.id;
      }
      console.log(`🔍 Existing user found: ${email} (${userId})`);
    }

    // 4. Build business record
    const trialExpiresAt =
      planConfig.tier === "trial"
        ? new Date(
            Date.now() + planConfig.trial_days * 24 * 60 * 60 * 1000
          ).toISOString()
        : null;

    const businessRecord = {
      id: userId,
      email,
      name: buyerName || email.split("@")[0],
      plan: planConfig.tier,
      ai_model: planConfig.ai_model,
      max_messages: planConfig.max_messages,
      max_knowledge: planConfig.max_knowledge,
      max_whatsapp_numbers: planConfig.max_whatsapp_numbers,
      messages_used: 0,
      plan_active: true,
      trial_expires_at: trialExpiresAt,
      wix_order_id: orderId,
      wix_plan_id: planId,
      plan_started_at: nowIso,
    };

    // Set has_used_trial only for trial purchases (preserve existing value otherwise)
    if (planConfig.tier === "trial") {
      businessRecord.has_used_trial = true;
    }

    // 5. Upsert business record
    const { error: upsertError } = await supabaseAdmin
      .from("businesses")
      .upsert(businessRecord, { onConflict: "id" })
      .select("id")
      .maybeSingle();

    if (upsertError) {
      console.error(
        `❌ Business upsert failed for ${email}:`,
        upsertError.message
      );
      throw new Error(`Failed to save business record: ${upsertError.message}`);
    }

    console.log(`💾 Business saved: ${email} → ${planConfig.tier}`);

    // 6. Send Magic Link (non-blocking — don't fail the webhook)
    let magicLinkSent = false;
    let actionLink = null;

    try {
      const { data: linkData, error: linkError } =
        await supabaseAdmin.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: redirectTo ? { redirectTo } : undefined,
        });

      if (linkError) {
        console.warn(
          `⚠️ Magic link generation failed for ${email}:`,
          linkError.message
        );
      } else {
        actionLink = linkData?.properties?.action_link || null;
        magicLinkSent = true;
        console.log(`📧 Magic link generated for ${email}`);
      }
    } catch (linkErr) {
      console.warn(
        `⚠️ Magic link failed entirely for ${email}:`,
        linkErr?.message || linkErr
      );
    }

    // 7. Sync legacy client_settings (backward compatibility)
    try {
      await supabaseAdmin
        .from("client_settings")
        .upsert(
          { user_id: userId, plan: planConfig.tier, updated_at: nowIso },
          { onConflict: "user_id" }
        );
    } catch (syncErr) {
      console.warn(
        `⚠️ Legacy client_settings sync failed:`,
        syncErr?.message || syncErr
      );
    }

    return {
      ok: true,
      userId,
      email,
      plan: planConfig.tier,
      orderId,
      magicLinkSent,
      actionLink,
      trialExpiresAt,
    };
  }

  // ── Trial expiry checker ──────────────────────────────────

  /**
   * Deactivate all trial businesses past their expiry date.
   * Safe to call frequently (e.g. on every webhook or via cron).
   */
  async function checkExpiredTrials() {
    const { data, error } = await supabaseAdmin
      .from("businesses")
      .update({
        plan_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("plan", "trial")
      .eq("plan_active", true)
      .lt("trial_expires_at", new Date().toISOString())
      .select("id, email, trial_expires_at");

    if (error) {
      console.error("❌ checkExpiredTrials failed:", error.message);
      return [];
    }

    if (data?.length) {
      console.log(
        `⏰ Expired ${data.length} trial(s):`,
        data.map((b) => b.email).join(", ")
      );
    }

    return data || [];
  }

  // ── Business activity check ───────────────────────────────

  /**
   * Check if a business is active and allowed to use the service.
   * Returns { active: boolean, reason: string | null }
   */
  async function isBusinessActive(businessId) {
    const { data: biz, error } = await supabaseAdmin
      .from("businesses")
      .select("id, plan, plan_active, trial_expires_at, max_messages")
      .eq("id", businessId)
      .maybeSingle();

    if (error) {
      return { active: false, reason: `Database error: ${error.message}` };
    }
    if (!biz) {
      return { active: false, reason: "Business not found" };
    }
    if (!biz.plan_active) {
      return { active: false, reason: "Plan is inactive" };
    }

    // Trial expiry — auto-deactivate on check
    if (
      biz.plan === "trial" &&
      biz.trial_expires_at &&
      new Date(biz.trial_expires_at) < new Date()
    ) {
      await supabaseAdmin
        .from("businesses")
        .update({ plan_active: false })
        .eq("id", businessId);
      return { active: false, reason: "Trial has expired" };
    }

    // Message limit (skip for unlimited: max_messages = -1 or null)
    if (biz.max_messages && biz.max_messages > 0) {
      const monthKey = new Date().toISOString().slice(0, 7); // "YYYY-MM"
      const { data: usage } = await supabaseAdmin
        .from("usage")
        .select("ai_replies_used")
        .eq("business_id", businessId)
        .eq("month", monthKey)
        .maybeSingle();

      if (usage && usage.ai_replies_used >= biz.max_messages) {
        return { active: false, reason: "Monthly message limit reached" };
      }
    }

    return { active: true, reason: null };
  }

  return {
    handlePaymentWebhook,
    checkExpiredTrials,
    isBusinessActive,
  };
}
