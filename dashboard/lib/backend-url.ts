function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/g, "");
}

export function getBackendUrl() {
  const configured = String(process.env.NEXT_PUBLIC_BACKEND_URL || "").trim();
  if (configured) return trimTrailingSlash(configured);

  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_BACKEND_URL is required in production.");
  }

  return "http://localhost:3001";
}
