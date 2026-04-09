import { SERVER_ERROR_MESSAGE } from "../config/constants.js";

/* ================================
  GLOBAL ERROR HANDLER
  Must be registered after all routes. Catches any thrown error or
  next(err) call and returns JSON instead of Express's default HTML 500.
================================ */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  console.error("Unhandled error:", err?.stack || err?.message || err);
  if (res.headersSent) return;
  res.status(500).json({ error: SERVER_ERROR_MESSAGE });
}
