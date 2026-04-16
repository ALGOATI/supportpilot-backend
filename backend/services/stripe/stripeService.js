import Stripe from "stripe";

// ============================================================
// Stripe subscription service.
// Replaces the previous Wix payment/webhook services.
//
// Handles:
//   - Checkout session creation (starter/pro subscriptions)
//   - Billing portal session creation
//   - Webhook event dispatch (checkout, subscription, invoice)
// ============================================================

const SUPPORTED_PLANS = new Set(["free", "starter", "pro"]);

function resolvePlanFromPriceId(priceId, priceIdToPlan) {
  if (!priceId) return null;
  return priceIdToPlan.get(priceId) || null;
}

export function createStripeService({
  supabaseAdmin,
  secretKey = process.env.STRIPE_SECRET_KEY,
  webhookSecret = process.env.STRIPE_WEBHOOK_SECRET,
  starterPriceId = process.env.STRIPE_STARTER_PRICE_ID,
  proPriceId = process.env.STRIPE_PRO_PRICE_ID,
  dashboardUrl = process.env.DASHBOARD_URL || process.env.APP_URL,
}) {
  if (!secretKey) {
    console.warn("⚠️ STRIPE_SECRET_KEY not configured — Stripe endpoints will fail");
  }

  const stripe = secretKey ? new Stripe(secretKey) : null;

  const priceIdToPlan = new Map();
  if (starterPriceId) priceIdToPlan.set(starterPriceId, "starter");
  if (proPriceId) priceIdToPlan.set(proPriceId, "pro");

  const allowedPriceIds = new Set(priceIdToPlan.keys());

  function requireStripe() {
    if (!stripe) {
      const err = new Error("Stripe is not configured");
      err.statusCode = 500;
      throw err;
    }
    return stripe;
  }

  function buildRedirectUrl(suffix) {
    const base = (dashboardUrl || "").replace(/\/+$/, "");
    return `${base}${suffix}`;
  }

  async function loadClientSettings(userId) {
    const { data, error } = await supabaseAdmin
      .from("client_settings")
      .select("user_id, stripe_customer_id, stripe_subscription_id, plan")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data || null;
  }

  async function resolveEmail(userId, emailHint) {
    if (emailHint) return emailHint;
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error) {
      console.warn("Failed to fetch auth user for email lookup:", error.message);
      return undefined;
    }
    return data?.user?.email || undefined;
  }

  async function ensureCustomer({ userId, email }) {
    const existing = await loadClientSettings(userId);
    if (existing?.stripe_customer_id) return existing.stripe_customer_id;

    const client = requireStripe();
    const resolvedEmail = await resolveEmail(userId, email);
    const customer = await client.customers.create({
      email: resolvedEmail,
      metadata: { supabase_user_id: userId },
    });

    await supabaseAdmin
      .from("client_settings")
      .upsert(
        {
          user_id: userId,
          stripe_customer_id: customer.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    return customer.id;
  }

  async function createCheckoutSession({ userId, email, priceId }) {
    if (!priceId || !allowedPriceIds.has(priceId)) {
      const err = new Error("Unknown or unsupported priceId");
      err.statusCode = 400;
      throw err;
    }
    const client = requireStripe();
    const customerId = await ensureCustomer({ userId, email });

    const session = await client.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: buildRedirectUrl("/dashboard/billing?status=success"),
      cancel_url: buildRedirectUrl("/dashboard/billing?status=cancelled"),
      client_reference_id: userId,
      subscription_data: {
        metadata: { supabase_user_id: userId },
      },
      metadata: { supabase_user_id: userId },
      allow_promotion_codes: true,
    });

    return { id: session.id, url: session.url };
  }

  async function createPortalSession({ userId }) {
    const client = requireStripe();
    const settings = await loadClientSettings(userId);
    if (!settings?.stripe_customer_id) {
      const err = new Error("No Stripe customer on file for this user");
      err.statusCode = 400;
      throw err;
    }
    const session = await client.billingPortal.sessions.create({
      customer: settings.stripe_customer_id,
      return_url: buildRedirectUrl("/dashboard/billing"),
    });
    return { url: session.url };
  }

  function constructWebhookEvent({ rawBody, signature }) {
    const client = requireStripe();
    if (!webhookSecret) {
      const err = new Error("STRIPE_WEBHOOK_SECRET is not configured");
      err.statusCode = 500;
      throw err;
    }
    return client.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }

  async function resolveUserIdFromCustomer(customerId) {
    if (!customerId) return null;
    const { data } = await supabaseAdmin
      .from("client_settings")
      .select("user_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    return data?.user_id || null;
  }

  async function updateByUserId(userId, fields) {
    if (!userId) return;
    await supabaseAdmin
      .from("client_settings")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  }

  async function handleCheckoutCompleted(session) {
    const userId =
      session.client_reference_id ||
      session.metadata?.supabase_user_id ||
      (await resolveUserIdFromCustomer(session.customer));
    if (!userId) {
      console.warn("Stripe checkout.session.completed: no user_id resolved", session.id);
      return;
    }

    let plan = null;
    let subscriptionId = session.subscription || null;
    if (subscriptionId && stripe) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId = subscription.items?.data?.[0]?.price?.id;
      plan = resolvePlanFromPriceId(priceId, priceIdToPlan);
    }

    await updateByUserId(userId, {
      stripe_customer_id: session.customer || null,
      stripe_subscription_id: subscriptionId,
      subscription_status: "active",
      ...(plan ? { plan } : {}),
    });
  }

  async function handleSubscriptionUpdated(subscription) {
    const userId =
      subscription.metadata?.supabase_user_id ||
      (await resolveUserIdFromCustomer(subscription.customer));
    if (!userId) {
      console.warn("Stripe subscription.updated: no user_id resolved", subscription.id);
      return;
    }

    const priceId = subscription.items?.data?.[0]?.price?.id;
    const plan = resolvePlanFromPriceId(priceId, priceIdToPlan);

    await updateByUserId(userId, {
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      ...(plan ? { plan } : {}),
    });
  }

  async function handleSubscriptionDeleted(subscription) {
    const userId =
      subscription.metadata?.supabase_user_id ||
      (await resolveUserIdFromCustomer(subscription.customer));
    if (!userId) return;

    await updateByUserId(userId, {
      plan: "free",
      stripe_subscription_id: null,
      subscription_status: "canceled",
    });
  }

  async function handleInvoicePaymentFailed(invoice) {
    const userId =
      invoice.metadata?.supabase_user_id ||
      (await resolveUserIdFromCustomer(invoice.customer));
    if (!userId) return;

    await updateByUserId(userId, {
      subscription_status: "past_due",
    });
    console.warn(
      `⚠️ invoice.payment_failed for user ${userId} (invoice ${invoice.id})`
    );
  }

  async function handleEvent(event) {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        return;
      case "customer.subscription.updated":
      case "customer.subscription.created":
        await handleSubscriptionUpdated(event.data.object);
        return;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        return;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object);
        return;
      default:
        // Ignore unhandled event types.
        return;
    }
  }

  return {
    SUPPORTED_PLANS,
    createCheckoutSession,
    createPortalSession,
    constructWebhookEvent,
    handleEvent,
  };
}
