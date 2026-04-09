import { SERVER_ERROR_MESSAGE } from "../config/constants.js";

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Factory: returns auth middleware bound to a Supabase admin client.
 * The middlewares need supabaseAdmin to verify clientIds + JWTs.
 */
export function createAuthMiddleware({ supabaseAdmin }) {
  // Verifies that a clientId supplied to public widget endpoints is a valid UUID
  // that actually exists in client_settings. Rejects random/guessed UUIDs.
  async function verifyWidgetClient(req, res, next) {
    const clientId = String(
      req.body?.clientId || req.query?.clientId || ""
    ).trim();

    if (!clientId || !UUID_REGEX.test(clientId)) {
      return res.status(400).json({ error: "Invalid clientId" });
    }

    const { data, error } = await supabaseAdmin
      .from("client_settings")
      .select("user_id")
      .eq("user_id", clientId)
      .maybeSingle();

    if (error) {
      console.error("verifyWidgetClient DB error:", error.message);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }

    if (!data) {
      return res.status(401).json({ error: "Invalid clientId" });
    }

    next();
  }

  async function requireSupabaseUser(req, res, next) {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Missing Authorization Bearer token" });
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    req.user = data.user;
    next();
  }

  return { verifyWidgetClient, requireSupabaseUser };
}
