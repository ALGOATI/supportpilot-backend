import express from "express";
import crypto from "node:crypto";
import { SERVER_ERROR_MESSAGE } from "../config/constants.js";
import { getPlanDefaults } from "../config/planConfig.js";

/* ================================
  Third-party integration routes — Google Calendar, ICS feed, multi-client
  WhatsApp connect/disconnect, Meta WhatsApp webhooks, and Wix order/payment
  webhooks.
================================ */
export function createIntegrationsRouter({
  supabaseAdmin,
  requireSupabaseUser,
  loadUserPlan,
  calendarService,
  findClientByPhoneNumberId,
  messaging,
  wixWebhookService,
  wixPaymentService,
}) {
  const router = express.Router();

  // --- Calendar integration endpoints ---

  // ICS feed (public, token-authenticated — no Supabase user required)
  router.get("/api/calendar/feed/:businessId/:token", async (req, res) => {
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
  router.get("/api/calendar/feed-url", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const feedToken = await calendarService.getOrCreateFeedToken(userId);
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
      const feedUrl = `${baseUrl}/api/calendar/feed/${userId}/${feedToken}`;
      return res.json({ feed_url: feedUrl });
    } catch (e) {
      console.error("Calendar feed URL error:", e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  // Google Calendar OAuth — start connection (Pro/Business only)
  router.get("/api/calendar/google/connect", requireSupabaseUser, async (req, res) => {
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
  router.get("/api/calendar/google/callback", async (req, res) => {
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
  router.post("/api/calendar/google/disconnect", requireSupabaseUser, async (req, res) => {
    try {
      await calendarService.disconnectGoogleCalendar(req.user.id);
      return res.json({ ok: true });
    } catch (e) {
      console.error("Google Calendar disconnect error:", e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  // Google Calendar — connection status
  router.get("/api/calendar/google/status", requireSupabaseUser, async (req, res) => {
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

  router.post("/api/integrations/whatsapp/connect", requireSupabaseUser, async (req, res) => {
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

  router.get("/api/integrations/whatsapp/status", requireSupabaseUser, async (req, res) => {
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

  router.post("/api/integrations/whatsapp/disconnect", requireSupabaseUser, async (req, res) => {
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

  // Meta webhook verification endpoint.
  router.get("/webhooks/whatsapp", (req, res) => {
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
  router.post("/webhooks/whatsapp", async (req, res) => {
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

  router.post("/api/webhooks/wix", async (req, res) => {
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
  router.post("/webhooks/wix/payment", async (req, res) => {
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

  return router;
}
