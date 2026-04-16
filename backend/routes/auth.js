import express from "express";
import { publicRateLimit } from "../middleware/rateLimiter.js";

/* ================================
  Auth-adjacent routes — currently just the email existence probe used
  by the dashboard signup flow.
================================ */
export function createAuthRouter({ supabaseAdmin }) {
  const router = express.Router();

  router.post("/api/auth/check-email", publicRateLimit, async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      // Check Supabase Auth users (the canonical source of email addresses).
      let page = 1;
      const perPage = 200;
      while (page <= 25) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage,
        });
        if (error) break;
        const found = data?.users?.some((u) => (u.email || "").toLowerCase() === email);
        if (found) return res.json({ exists: true });
        if (!data?.users || data.users.length < perPage) break;
        page += 1;
      }

      return res.json({ exists: false });
    } catch (err) {
      console.error("Check email error:", err?.message || err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  return router;
}
