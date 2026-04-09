import cors from "cors";

/* ================================
  CORS
  Set ALLOWED_ORIGINS in Render to allow dashboard access:
  Example: ALLOWED_ORIGINS=https://your-dashboard.vercel.app,https://your-custom-domain.com
  In production, requests from unlisted origins will be blocked.
  Webhook endpoints (WhatsApp, Wix) don't send an Origin header, so they're unaffected.
================================ */

// Factory so env vars are read at call time (after dotenv has loaded), not at
// import time. Subsequent dynamic reads of NODE_ENV happen inside the request
// callback, matching the original behavior.
export function createCorsMiddleware() {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
    : [];

  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, webhooks)
      if (!origin) return callback(null, true);

      if (allowedOrigins.length === 0) {
        // No origins configured — reject in production, allow in development.
        // IMPORTANT: never pass an Error to the callback, or `cors` will call
        // next(err) and (without an error handler) Express returns 500 even
        // for OPTIONS preflight. Return `false` instead — the browser then
        // blocks the response cleanly with a normal CORS error.
        if (process.env.NODE_ENV === "production") {
          console.warn(`⚠️ CORS: Blocked request from ${origin} — ALLOWED_ORIGINS not configured`);
          return callback(null, false);
        }
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn(`⚠️ CORS: Blocked request from ${origin}`);
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  });
}
