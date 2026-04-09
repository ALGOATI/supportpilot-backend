import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from the backend/ folder (parent of this file's directory).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, "..", ".env");
const dotenvResult = dotenv.config({ path: envPath });

/* ================================
  REQUIRED ENV VARS
  Fail fast on startup so Render shows a clear "service failed to start"
  instead of every request mysteriously returning 500 later.
================================ */
const REQUIRED_ENV_VARS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missingEnvVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
if (missingEnvVars.length > 0) {
  console.error(
    `❌ Missing required environment variables: ${missingEnvVars.join(", ")}`
  );
  console.error("   Set them in Render (or backend/.env locally) and restart.");
  process.exit(1);
}

console.log("[DEBUG] dotenv envPath:", envPath);
console.log("[DEBUG] dotenv loaded:", !dotenvResult.error);
console.log("[DEBUG] process.cwd():", process.cwd());
console.log("[INFO] WIX_WEBHOOK_SECRET configured:", !!process.env.WIX_WEBHOOK_SECRET);
