import express from "express";
import { SERVER_ERROR_MESSAGE } from "../config/constants.js";
import { UUID_REGEX } from "../middleware/auth.js";
import { getPlanDefaults } from "../config/planConfig.js";

/* ================================
  Knowledge base routes — limit checks and owner-supplied learnings.
================================ */
export function createKnowledgeRouter({
  supabaseAdmin,
  requireSupabaseUser,
  loadUserPlan,
  knowledgeService,
}) {
  const router = express.Router();

  router.get("/api/knowledge/limit", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const plan = await loadUserPlan(userId);
      const planConfig = getPlanDefaults(plan);
      const maxKnowledge = planConfig.max_knowledge;

      const { count, error } = await supabaseAdmin
        .from("knowledge_base")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      const current = count || 0;
      const limitReached = maxKnowledge > 0 && current >= maxKnowledge;

      return res.json({ current, max: maxKnowledge, limitReached });
    } catch (err) {
      console.error("Knowledge limit error:", err?.message || err);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.post("/api/knowledge/learn", requireSupabaseUser, async (req, res) => {
    try {
      const businessId = String(req.body?.business_id || "").trim();
      const question = String(req.body?.question || "").trim();
      const answer = String(req.body?.answer || "").trim();

      if (!businessId || !question || !answer) {
        return res.status(400).json({
          error: "Missing required fields: business_id, question, answer",
        });
      }
      if (!UUID_REGEX.test(businessId)) {
        return res.status(400).json({ error: "Invalid business_id" });
      }
      if (req.user.id !== businessId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const learning = await knowledgeService.learnFromOwnerReply({
        businessId,
        question,
        answer,
      });

      return res.status(200).json({
        ok: true,
        learning,
      });
    } catch (err) {
      console.error("Knowledge learn endpoint failed:", err?.message || err);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  return router;
}
