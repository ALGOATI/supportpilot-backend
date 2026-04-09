import express from "express";
import { SERVER_ERROR_MESSAGE } from "../config/constants.js";

/* ================================
  Developer / testing routes — manual WhatsApp simulation and a tiny
  echo webhook used for hand-testing Meta wiring.
================================ */
export function createDevtoolsRouter({ findUserByEmail, messaging }) {
  const router = express.Router();

  router.post("/dev/simulate/whatsapp", async (req, res) => {
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

  router.post("/webhook-test", async (req, res) => {
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

  return router;
}
