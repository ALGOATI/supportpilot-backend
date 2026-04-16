// Idempotent script to create test accounts for each plan tier.
// Usage: node backend/scripts/create-test-accounts.js
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from backend/.env (script lives in backend/scripts/)
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_ACCOUNTS = [
  {
    email: "test-starter@supportpilot.test",
    password: "TestStarter2026!",
    name: "Test Starter Business",
    plan: "starter",
    ai_model: "gpt-4o-mini",

    max_knowledge: 30,
    max_whatsapp_numbers: 1,
  },
  {
    email: "test-pro@supportpilot.test",
    password: "TestPro2026!",
    name: "Test Pro Business",
    plan: "pro",
    ai_model: "gpt-4o",

    max_knowledge: 75,
    max_whatsapp_numbers: 3,
  },
  {
    email: "test-business@supportpilot.test",
    password: "TestBusiness2026!",
    name: "Test Business Enterprise",
    plan: "business",
    ai_model: "gpt-4o",

    max_knowledge: -1,
    max_whatsapp_numbers: 5,
  },
];

async function findUserByEmail(email) {
  // listUsers paginates; check first 1000 (sufficient for test usage)
  let page = 1;
  const perPage = 200;
  while (page <= 5) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data?.users?.find((u) => u.email === email);
    if (found) return found;
    if (!data?.users || data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

async function ensureUser(account) {
  const existing = await findUserByEmail(account.email);
  if (existing) {
    console.log(`  User exists: ${existing.id}`);
    // Update password to known value (idempotent)
    const { error: updErr } = await supabase.auth.admin.updateUserById(existing.id, {
      password: account.password,
      email_confirm: true,
    });
    if (updErr) console.warn(`  Password update warning: ${updErr.message}`);
    return existing.id;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { full_name: account.name, source: "test_account" },
  });
  if (error) throw new Error(`Create user failed: ${error.message}`);
  console.log(`  User created: ${data.user.id}`);
  return data.user.id;
}

async function ensureBusinessRow(userId, account) {
  const nowIso = new Date().toISOString();
  const businessRecord = {
    user_id: userId,
    email: account.email,
    name: account.name,
    plan: account.plan,
    ai_model: account.ai_model,
    max_knowledge: account.max_knowledge,
    max_whatsapp_numbers: account.max_whatsapp_numbers,
    messages_used: 0,
    plan_active: true,
    plan_started_at: nowIso,
    updated_at: nowIso,
  };

  const { error } = await supabase
    .from("client_settings")
    .upsert(businessRecord, { onConflict: "user_id" });

  if (error) throw new Error(`client_settings upsert failed: ${error.message}`);
  console.log(`  client_settings business fields upserted (plan=${account.plan})`);
}

async function ensureClientSettings(userId, account) {
  const { error } = await supabase.from("client_settings").upsert(
    {
      user_id: userId,
      business: `${account.name} - Test account for ${account.plan} tier`,
      plan: account.plan,
      tone: account.plan === "starter" ? "professional" : "friendly",
      reply_length: "concise",
      dashboard_language: "english",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) throw new Error(`client_settings upsert failed: ${error.message}`);
  console.log(`  client_settings upserted (plan=${account.plan})`);
}

async function main() {
  console.log("Creating/updating test accounts...\n");

  for (const account of TEST_ACCOUNTS) {
    console.log(`--- ${account.plan.toUpperCase()} ---`);
    console.log(`Email: ${account.email}`);
    try {
      const userId = await ensureUser(account);
      await ensureBusinessRow(userId, account);
      await ensureClientSettings(userId, account);
      console.log(`  ${account.plan} account ready\n`);
    } catch (err) {
      console.error(`  FAILED: ${err.message}\n`);
    }
  }

  console.log("=================================");
  console.log("TEST ACCOUNT CREDENTIALS");
  console.log("=================================\n");
  for (const a of TEST_ACCOUNTS) {
    console.log(`${a.plan.toUpperCase()}:`);
    console.log(`  Email:    ${a.email}`);
    console.log(`  Password: ${a.password}\n`);
  }
  console.log("=================================");
  console.log("Login at /login?dev=1 to access the developer password form.");
  console.log("These accounts use password auth (magic links won't work for .test emails).");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
