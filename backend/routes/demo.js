import express from "express";
import { SERVER_ERROR_MESSAGE } from "../config/constants.js";

/* ================================
  Demo data routes — generates seeded conversations for the dashboard
  preview/demo mode.
================================ */
export function createDemoRouter({
  requireSupabaseUser,
  setUserDemoModeFlag,
  generateDemoConversations,
}) {
  const router = express.Router();

  router.post("/api/demo/generate", requireSupabaseUser, async (req, res) => {
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

  return router;
}
