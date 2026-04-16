import express from "express";
import { SERVER_ERROR_MESSAGE } from "../config/constants.js";

/* ================================
  Stripe billing routes — checkout, customer portal, webhook.

  IMPORTANT: the webhook route must receive the raw request body so the
  Stripe signature can be verified. The server mounts this router BEFORE
  the global express.json() middleware and uses express.raw() for the
  webhook path only. Other Stripe endpoints continue to accept JSON.
================================ */
export function createStripeRouter({
  requireSupabaseUser,
  stripeService,
}) {
  const router = express.Router();

  // Webhook — must use raw body for signature verification.
  router.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const signature = req.get("stripe-signature");
      if (!signature) {
        return res.status(400).json({ error: "Missing stripe-signature header" });
      }

      let event;
      try {
        event = stripeService.constructWebhookEvent({
          rawBody: req.body,
          signature,
        });
      } catch (err) {
        console.warn("⚠️ Stripe webhook signature verification failed:", err?.message || err);
        return res.status(400).json({ error: "Invalid signature" });
      }

      try {
        await stripeService.handleEvent(event);
        return res.json({ received: true });
      } catch (err) {
        console.error("❌ Stripe webhook handler failed:", err?.message || err);
        return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
      }
    }
  );

  // Create a Checkout Session for a subscription.
  router.post(
    "/api/stripe/create-checkout-session",
    express.json({ limit: "1mb" }),
    requireSupabaseUser,
    async (req, res) => {
      try {
        const priceId = String(req.body?.priceId || "").trim();
        if (!priceId) {
          return res.status(400).json({ error: "priceId is required" });
        }
        const session = await stripeService.createCheckoutSession({
          userId: req.user.id,
          email: req.user.email,
          priceId,
        });
        return res.json(session);
      } catch (err) {
        const status = Number(err?.statusCode) || 500;
        if (status >= 500) {
          console.error("Stripe checkout error:", err?.message || err);
        }
        return res
          .status(status)
          .json({ error: status >= 500 ? SERVER_ERROR_MESSAGE : String(err.message) });
      }
    }
  );

  // Create a Billing Portal session so users can manage their subscription.
  router.post(
    "/api/stripe/create-portal-session",
    express.json({ limit: "1mb" }),
    requireSupabaseUser,
    async (req, res) => {
      try {
        const session = await stripeService.createPortalSession({
          userId: req.user.id,
        });
        return res.json(session);
      } catch (err) {
        const status = Number(err?.statusCode) || 500;
        if (status >= 500) {
          console.error("Stripe portal error:", err?.message || err);
        }
        return res
          .status(status)
          .json({ error: status >= 500 ? SERVER_ERROR_MESSAGE : String(err.message) });
      }
    }
  );

  return router;
}
