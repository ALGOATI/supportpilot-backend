import express from "express";
import {
  SERVER_ERROR_MESSAGE,
  SCHEMA_CACHE_TEXT,
  DOES_NOT_EXIST_TEXT,
} from "../config/constants.js";
import { getPlanDefaults } from "../config/planConfig.js";
import { getModelForTask } from "../config/modelRouting.js";

/* ================================
  Analytics & usage routes — overview, daily/monthly aggregates, and the
  dashboard "today at a glance" payload.
================================ */
export function createAnalyticsRouter({
  supabaseAdmin,
  requireSupabaseUser,
  buildAnalyticsOverview,
  monthlyStatsService,
  loadUserPlan,
  loadBusinessMaxMessages,
  getMonthStartIso,
  countMonthlyAiConversations,
}) {
  const router = express.Router();

  router.get("/api/analytics/overview", requireSupabaseUser, async (req, res) => {
    try {
      const overview = await buildAnalyticsOverview(req.user.id);
      return res.json(overview);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.get("/api/analytics/monthly-stats", requireSupabaseUser, async (req, res) => {
    try {
      const stats = await monthlyStatsService.getMonthlyStatsWithComparison({
        businessId: req.user.id,
      });
      return res.json(stats);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.get("/api/analytics/today-stats", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const now = new Date();
      const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

      const [messagesResult, escalatedResult] = await Promise.all([
        supabaseAdmin
          .from("messages")
          .select("ai_reply,conversation_id")
          .eq("user_id", userId)
          .gte("created_at", todayStart.toISOString()),
        supabaseAdmin
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "escalated")
          .gte("created_at", todayStart.toISOString()),
      ]);

      const rows = messagesResult.data || [];
      const totalInbound = rows.length;
      const aiMessages = rows.filter(r => r.ai_reply).length;
      const aiConversationIds = new Set(rows.filter(r => r.ai_reply).map(r => r.conversation_id));
      const escalated = escalatedResult.count || 0;

      return res.json({
        total_inbound: totalInbound,
        ai_messages_sent: aiMessages,
        ai_conversations_handled: aiConversationIds.size,
        human_escalations: escalated,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.get("/api/analytics/daily-volume", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const now = new Date();
      const start30d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));

      const { data: rows, error } = await supabaseAdmin
        .from("messages")
        .select("created_at,ai_reply")
        .eq("user_id", userId)
        .gte("created_at", start30d.toISOString())
        .order("created_at", { ascending: true })
        .limit(10000);

      if (error) throw new Error(error.message);

      const dayMap = new Map();
      for (let d = 0; d < 30; d++) {
        const dt = new Date(start30d);
        dt.setUTCDate(dt.getUTCDate() + d);
        const key = dt.toISOString().slice(0, 10);
        dayMap.set(key, { date: key, total: 0, ai: 0, human: 0 });
      }

      for (const row of rows || []) {
        const key = new Date(row.created_at).toISOString().slice(0, 10);
        const entry = dayMap.get(key);
        if (!entry) continue;
        entry.total++;
        if (row.ai_reply) entry.ai++;
        else entry.human++;
      }

      return res.json({ days: Array.from(dayMap.values()) });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.get("/api/analytics/top-questions", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      const { data: rows, error } = await supabaseAdmin
        .from("messages")
        .select("customer_message")
        .eq("user_id", userId)
        .gte("created_at", monthStart.toISOString())
        .not("customer_message", "is", null)
        .neq("customer_message", "")
        .order("created_at", { ascending: false })
        .limit(5000);

      if (error) throw new Error(error.message);

      // Group by normalized first message (simple keyword grouping)
      const freq = new Map();
      for (const row of rows || []) {
        const msg = String(row.customer_message || "").trim().toLowerCase().slice(0, 120);
        if (!msg) continue;
        freq.set(msg, (freq.get(msg) || 0) + 1);
      }

      const sorted = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([question, count]) => ({ question, count }));

      return res.json({ questions: sorted });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.get("/api/analytics/escalation-reasons", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      const { data: rows, error } = await supabaseAdmin
        .from("conversations")
        .select("escalation_reason")
        .eq("user_id", userId)
        .eq("status", "escalated")
        .gte("created_at", monthStart.toISOString())
        .limit(5000);

      if (error) {
        const text = String(error.message || "").toLowerCase();
        if (text.includes("escalation_reason") || text.includes(SCHEMA_CACHE_TEXT)) {
          return res.json({ reasons: [], total: 0 });
        }
        throw new Error(error.message);
      }

      const freq = new Map();
      for (const row of rows || []) {
        const reason = String(row.escalation_reason || "Other").trim();
        freq.set(reason, (freq.get(reason) || 0) + 1);
      }

      const sorted = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => ({ reason, count }));

      return res.json({ reasons: sorted, total: (rows || []).length });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  // eslint-disable-next-line sonarjs/cognitive-complexity
  router.get("/api/analytics/monthly-report", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;

      // Gate: monthly reports require Pro or Business
      const plan = await loadUserPlan(userId);
      const planConfig = getPlanDefaults(plan);
      if (!planConfig.features?.monthly_reports) {
        return res.status(403).json({
          error: "Monthly reports are available on Pro and Business plans.",
          upgrade_required: true,
        });
      }

      const monthParam = String(req.query.month || "").trim();
      const monthKey = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : monthlyStatsService.getMonthKey();

      const report = await monthlyStatsService.getMonthlyReport({
        businessId: userId,
        monthKey,
      });

      // Fetch top questions for this month
      const [year, month] = monthKey.split("-").map(Number);
      const monthStart = new Date(Date.UTC(year, month - 1, 1));
      const monthEnd = new Date(Date.UTC(year, month, 1));

      const [questionsResult, escalationsResult] = await Promise.all([
        supabaseAdmin
          .from("messages")
          .select("customer_message")
          .eq("user_id", userId)
          .gte("created_at", monthStart.toISOString())
          .lt("created_at", monthEnd.toISOString())
          .not("customer_message", "is", null)
          .neq("customer_message", "")
          .limit(5000),
        supabaseAdmin
          .from("conversations")
          .select("escalation_reason")
          .eq("user_id", userId)
          .eq("status", "escalated")
          .gte("created_at", monthStart.toISOString())
          .lt("created_at", monthEnd.toISOString())
          .limit(5000),
      ]);

      // Top questions
      const qFreq = new Map();
      for (const row of questionsResult.data || []) {
        const msg = String(row.customer_message || "").trim().toLowerCase().slice(0, 120);
        if (!msg) continue;
        qFreq.set(msg, (qFreq.get(msg) || 0) + 1);
      }
      const topQuestions = Array.from(qFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([question, count]) => ({ question, count }));

      // Escalation reasons
      const eFreq = new Map();
      for (const row of escalationsResult.data || []) {
        const reason = String(row.escalation_reason || "Other").trim();
        eFreq.set(reason, (eFreq.get(reason) || 0) + 1);
      }
      const escalationReasons = Array.from(eFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => ({ reason, count }));

      // Generate recommendations
      const recommendations = [];
      if (topQuestions.length > 0 && topQuestions[0].count >= 5) {
        recommendations.push({
          type: "faq",
          message: `"${topQuestions[0].question}" was asked ${topQuestions[0].count} times — consider adding it to your FAQ`,
        });
      }
      const escalationRate = report.ai_conversations_handled > 0
        ? Math.round((report.human_escalations / report.ai_conversations_handled) * 100)
        : 0;
      if (escalationRate > 20) {
        recommendations.push({
          type: "escalation_rate",
          message: `Your escalation rate is ${escalationRate}% — review escalated conversations and add common answers to your knowledge base`,
        });
      }
      const unknownEscalations = eFreq.get("Other") || 0;
      if (unknownEscalations > 10) {
        recommendations.push({
          type: "unknown_questions",
          message: `${unknownEscalations} escalations were for unclassified reasons — review and add answers to your knowledge base`,
        });
      }

      // Find busiest day of week
      const dayVolumes = await supabaseAdmin
        .from("messages")
        .select("created_at")
        .eq("user_id", userId)
        .gte("created_at", monthStart.toISOString())
        .lt("created_at", monthEnd.toISOString())
        .limit(10000);

      const dayCounts = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
      for (const row of dayVolumes.data || []) {
        const day = new Date(row.created_at).getUTCDay();
        dayCounts[day]++;
      }
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const busiestDayIdx = dayCounts.indexOf(Math.max(...dayCounts));
      if (dayCounts[busiestDayIdx] > 0) {
        recommendations.push({
          type: "busiest_day",
          message: `Your busiest day is ${dayNames[busiestDayIdx]} — consider adjusting staffing or AI availability`,
        });
      }

      return res.json({
        ...report,
        top_questions: topQuestions,
        escalation_reasons: escalationReasons,
        escalation_rate: escalationRate,
        recommendations,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.get("/api/analytics/usage-summary", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const now = new Date();
      const userPlan = await loadUserPlan(userId);
      const maxMessages = await loadBusinessMaxMessages(userId);
      const monthStartIso = getMonthStartIso(now);
      const conversationsUsed = await countMonthlyAiConversations(userId, monthStartIso);
      const limit = (maxMessages !== null && maxMessages > 0) ? maxMessages : null;
      const percentUsed = limit ? Math.round((conversationsUsed / limit) * 100) : null;

      // Days until reset (first day of next month)
      const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const daysUntilReset = Math.ceil((nextMonth.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      return res.json({
        plan: userPlan,
        conversations_used: conversationsUsed,
        limit,
        percent_used: percentUsed,
        days_until_reset: daysUntilReset,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.get("/api/usage", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const now = new Date();
      const userPlan = await loadUserPlan(userId);
      const maxMessages = await loadBusinessMaxMessages(userId);
      const monthStartIso = getMonthStartIso(now);
      const conversationsUsed = await countMonthlyAiConversations(userId, monthStartIso);
      const limit = (maxMessages !== null && maxMessages > 0) ? maxMessages : null;
      const percentUsed = limit ? Math.round((conversationsUsed / limit) * 100) : null;
      const mainReplyModel = getModelForTask(userPlan, "main_reply");

      return res.json({
        plan: userPlan,
        model_main_reply: mainReplyModel,
        conversations_used: conversationsUsed,
        limit,
        percent_used: percentUsed,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  // eslint-disable-next-line sonarjs/cognitive-complexity
  router.get("/api/dashboard/analytics", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const now = new Date();
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

      const [{ data: aiRows, error: aiErr }, { count: escalationsCount, error: escalationsErr }, { count: humanRepliesCount, error: humanRepliesErr }, { data: bookingMessageRows, error: bookingMessagesErr }, { data: bookingConfirmedRows, error: bookingConfirmedErr }] =
        await Promise.all([
          supabaseAdmin
            .from("messages")
            .select("conversation_id,ai_reply")
            .eq("user_id", userId)
            .gte("created_at", startOfToday.toISOString())
            .not("ai_reply", "is", null)
            .neq("ai_reply", "")
            .limit(5000),
          supabaseAdmin
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("escalated", true)
            .gte("created_at", startOfToday.toISOString()),
          supabaseAdmin
            .from("messages")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .not("human_reply", "is", null)
            .neq("human_reply", "")
            .gte("created_at", startOfToday.toISOString()),
          supabaseAdmin
            .from("messages")
            .select("conversation_id")
            .eq("user_id", userId)
            .gte("created_at", startOfToday.toISOString())
            .filter("extracted_data->>intent", "eq", "booking")
            .filter("extracted_data->>status", "eq", "complete")
            .limit(5000),
          supabaseAdmin
            .from("conversations")
            .select("id")
            .eq("user_id", userId)
            .eq("state", "booking_confirmed")
            .gte("last_message_at", startOfToday.toISOString())
            .limit(5000),
        ]);

      if (aiErr) throw new Error(aiErr.message);
      if (escalationsErr) throw new Error(escalationsErr.message);
      if (humanRepliesErr) throw new Error(humanRepliesErr.message);
      if (bookingMessagesErr) throw new Error(bookingMessagesErr.message);

      let bookingConfirmedConversations = bookingConfirmedRows || [];
      if (bookingConfirmedErr) {
        const text = String(bookingConfirmedErr.message || "").toLowerCase();
        if (text.includes("state") || text.includes(SCHEMA_CACHE_TEXT) || text.includes(DOES_NOT_EXIST_TEXT)) {
          bookingConfirmedConversations = [];
        } else {
          throw new Error(bookingConfirmedErr.message);
        }
      }

      const aiConversationsToday = new Set(
        (aiRows || []).map((row) => String(row?.conversation_id || "").trim()).filter(Boolean)
      ).size;

      const bookingsSet = new Set(
        (bookingMessageRows || [])
          .map((row) => String(row?.conversation_id || "").trim())
          .filter(Boolean)
      );
      for (const row of bookingConfirmedConversations || []) {
        const id = String(row?.id || "").trim();
        if (id) bookingsSet.add(id);
      }

      let activeConversations = 0;
      const activeWithState = await supabaseAdmin
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("last_message_at", thirtyMinutesAgo.toISOString())
        .neq("state", "resolved");

      if (activeWithState.error) {
        const text = String(activeWithState.error.message || "").toLowerCase();
        if (text.includes("state") || text.includes(SCHEMA_CACHE_TEXT) || text.includes(DOES_NOT_EXIST_TEXT)) {
          const fallback = await supabaseAdmin
            .from("conversations")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .gte("last_message_at", thirtyMinutesAgo.toISOString())
            .neq("status", "resolved");
          if (fallback.error) throw new Error(fallback.error.message);
          activeConversations = Number(fallback.count || 0);
        } else {
          throw new Error(activeWithState.error.message);
        }
      } else {
        activeConversations = Number(activeWithState.count || 0);
      }

      const userPlan = await loadUserPlan(userId);
      const maxMessages = await loadBusinessMaxMessages(userId);
      const monthStartIso = getMonthStartIso(now);
      const usedConversationsThisMonth = await countMonthlyAiConversations(userId, monthStartIso);
      const planLimit = (maxMessages !== null && maxMessages > 0) ? maxMessages : null;
      const usagePercent = planLimit ? Math.round((usedConversationsThisMonth / planLimit) * 100) : null;
      let usageWarningLevel = null;
      if (planLimit) {
        if (usagePercent >= 100) usageWarningLevel = 100;
        else if (usagePercent >= 95) usageWarningLevel = 95;
        else if (usagePercent >= 80) usageWarningLevel = 80;
      }

      return res.json({
        aiConversationsToday,
        bookingsToday: bookingsSet.size,
        escalationsToday: Number(escalationsCount || 0),
        humanRepliesToday: Number(humanRepliesCount || 0),
        activeConversations,
        plan: userPlan,
        usedConversationsThisMonth,
        monthlyConversationLimit: planLimit,
        usagePercent,
        usageWarningLevel,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  return router;
}
