import crypto from "node:crypto";
import { SCHEMA_CACHE_TEXT, DOES_NOT_EXIST_TEXT } from "./constants.js";
import { getModelForTask, hasAnyModelConfigured } from "./modelRouting.js";

/* ================================
  Misc helpers used across routes and services. Pure functions plus a
  couple of env-aware helpers — kept here so server.js stays focused on
  wiring.
================================ */

export function pickModel(plan) {
  return getModelForTask(plan, "main_reply");
}

export function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let trimmed = raw;
  while (trimmed.endsWith("/")) {
    trimmed = trimmed.slice(0, -1);
  }
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return "";
  return trimmed;
}

export function resolveBackendPublicBaseUrl(req = null) {
  const configured = normalizeBaseUrl(process.env.BACKEND_PUBLIC_URL);
  if (configured) return configured;

  const host = String(req?.get?.("x-forwarded-host") || req?.get?.("host") || "").trim();
  const forwardedProto = String(req?.get?.("x-forwarded-proto") || "").trim().toLowerCase();
  const reqProto = String(req?.protocol || "").trim().toLowerCase();
  const proto = forwardedProto || reqProto || "http";

  if (host && (proto === "http" || proto === "https")) {
    return `${proto}://${host}`;
  }

  const port = process.env.PORT || 3001;
  return `http://localhost:${port}`;
}

export function isSchemaCompatibilityError(error, hints = []) {
  const text = String(error?.message || "").toLowerCase();
  if (!text) return false;
  if (text.includes(SCHEMA_CACHE_TEXT) || text.includes(DOES_NOT_EXIST_TEXT)) return true;
  return hints.some((hint) => text.includes(String(hint || "").toLowerCase()));
}

export function isAiGloballyReady() {
  const apiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  const hasModel = hasAnyModelConfigured();
  return Boolean(apiKey) && hasModel;
}

export function sanitizeExternalIdentifier(value, fallbackPrefix = "id") {
  const raw = String(value || "")
    .trim()
    .replaceAll(/[^a-zA-Z0-9:_-]/g, "")
    .slice(0, 120);
  if (raw) return raw;
  return `${fallbackPrefix}:${crypto.randomUUID()}`;
}
