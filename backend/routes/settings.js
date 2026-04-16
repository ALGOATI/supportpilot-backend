import express from "express";
import {
  SERVER_ERROR_MESSAGE,
  DEFAULT_TIMEZONE,
  OPENROUTER_CHAT_COMPLETIONS_URL,
  MENU_EXTRACTION_ERROR_MESSAGE,
} from "../config/constants.js";
import { getPlanDefaults } from "../config/planConfig.js";
import { getModelsForPlan } from "../config/modelRouting.js";
import {
  isSchemaCompatibilityError,
  isAiGloballyReady,
  resolveBackendPublicBaseUrl,
} from "../config/utils.js";
import {
  normalizeSetupHoursRows,
  normalizeSetupMenuItems,
} from "../services/setupService.js";

/* ================================
  Plan / setup / release-status / menu import routes — basically the
  onboarding wizard endpoints plus the launch-readiness checklist.
================================ */
export function createSettingsRouter({
  supabaseAdmin,
  requireSupabaseUser,
  loadUserPlan,
  normalizeBusinessType,
  normalizeImportedMenuItems,
  extractFirstJsonArray,
}) {
  const router = express.Router();

  router.get("/api/plan/features", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const plan = await loadUserPlan(userId);
      const planConfig = getPlanDefaults(plan);

      return res.json({
        tier: plan,
        features: planConfig.features || {},
        limits: {
          maxMessages: planConfig.max_messages,
          maxKnowledge: planConfig.max_knowledge,
          maxWhatsappNumbers: planConfig.max_whatsapp_numbers,
        },
      });
    } catch (err) {
      console.error("Plan features error:", err?.message || err);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.get("/api/setup/status", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;

      const [settingsQ, profileQ, hoursQ] = await Promise.all([
        supabaseAdmin
          .from("client_settings")
          .select("onboarding_completed")
          .eq("user_id", userId)
          .maybeSingle(),
        supabaseAdmin
          .from("business_profiles")
          .select("business_name")
          .eq("user_id", userId)
          .maybeSingle(),
        supabaseAdmin
          .from("business_hours")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
      ]);

      const hasProfile =
        Boolean(String(profileQ.data?.business_name || "").trim()) && !profileQ.error;
      const hasHours = Number(hoursQ.count || 0) >= 7 && !hoursQ.error;

      const completedFromSettings =
        !settingsQ.error && Boolean(settingsQ.data?.onboarding_completed);
      const completed = completedFromSettings || (hasProfile && hasHours);

      return res.json({
        completed,
        hasProfile,
        hasHours,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  // eslint-disable-next-line sonarjs/cognitive-complexity
  router.get("/api/release-status", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const validBusinessTypes = new Set([
        "restaurant",
        "barber",
        "clinic",
        "retail",
        "other",
      ]);

      const [
        profileQ,
        hoursQ,
        settingsQ,
        whatsappMapQ,
        whatsappConversationQ,
      ] = await Promise.all([
        supabaseAdmin
          .from("business_profiles")
          .select("business_name,address,phone,business_type")
          .eq("user_id", userId)
          .maybeSingle(),
        supabaseAdmin
          .from("business_hours")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
        supabaseAdmin
          .from("client_settings")
          .select("plan, whatsapp_connected")
          .eq("user_id", userId)
          .maybeSingle(),
        supabaseAdmin
          .from("conversation_map")
          .select("conversation_id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("channel", "whatsapp"),
        supabaseAdmin
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("channel", "whatsapp"),
      ]);

      let profile = profileQ.data || null;
      if (profileQ.error) {
        if (isSchemaCompatibilityError(profileQ.error, ["business_profiles", "business_type"])) {
          const fallbackProfile = await supabaseAdmin
            .from("business_profiles")
            .select("business_name,address,phone")
            .eq("user_id", userId)
            .maybeSingle();
          if (fallbackProfile.error) {
            if (
              !isSchemaCompatibilityError(fallbackProfile.error, [
                "business_profiles",
                "address",
                "phone",
              ])
            ) {
              throw new Error(fallbackProfile.error.message);
            }
            profile = null;
          } else {
            profile = {
              ...fallbackProfile.data,
              business_type: null,
            };
          }
        } else {
          throw new Error(profileQ.error.message);
        }
      }

      const businessName = String(profile?.business_name || "").trim();
      const address = String(profile?.address || "").trim();
      const phone = String(profile?.phone || "").trim();
      const businessType = String(profile?.business_type || "").trim().toLowerCase();

      const businessProfileCompleted = Boolean(businessName && address && phone);
      const businessTypeSelected = validBusinessTypes.has(businessType);

      let openingHoursConfigured = false;
      if (!hoursQ.error) {
        openingHoursConfigured = Number(hoursQ.count || 0) >= 7;
      } else if (
        !isSchemaCompatibilityError(hoursQ.error, ["business_hours", "day_of_week"])
      ) {
        throw new Error(hoursQ.error.message);
      }

      let plan = "starter";
      let planSelected = false;
      if (!settingsQ.error) {
        plan = settingsQ.data?.plan || "starter";
        planSelected = ["free", "starter", "pro", "business"].includes(plan);
      } else if (
        !isSchemaCompatibilityError(settingsQ.error, ["client_settings", "plan"])
      ) {
        throw new Error(settingsQ.error.message);
      }

      let hasWhatsAppMap = false;
      if (!whatsappMapQ.error) {
        hasWhatsAppMap = Number(whatsappMapQ.count || 0) > 0;
      } else if (
        !isSchemaCompatibilityError(whatsappMapQ.error, ["conversation_map", "channel"])
      ) {
        throw new Error(whatsappMapQ.error.message);
      }

      let hasWhatsAppConversation = false;
      if (!whatsappConversationQ.error) {
        hasWhatsAppConversation = Number(whatsappConversationQ.count || 0) > 0;
      } else if (
        !isSchemaCompatibilityError(whatsappConversationQ.error, ["conversations", "channel"])
      ) {
        throw new Error(whatsappConversationQ.error.message);
      }

      const hasWhatsAppClientConfig = !settingsQ.error && Boolean(settingsQ.data?.whatsapp_connected);
      const whatsappConnected =
        hasWhatsAppMap || hasWhatsAppConversation || hasWhatsAppClientConfig;

      const aiEnabled = isAiGloballyReady();
      const models = getModelsForPlan(plan);

      const checks = {
        business_profile_completed: businessProfileCompleted,
        opening_hours_configured: openingHoursConfigured,
        business_type_selected: businessTypeSelected,
        whatsapp_connected: whatsappConnected,
        ai_enabled: aiEnabled,
        plan_selected: planSelected,
      };

      const missingItems = Object.entries(checks)
        .filter(([, isComplete]) => !isComplete)
        .map(([key]) => key);

      const total = Object.keys(checks).length;
      const done = total - missingItems.length;
      const percent = total > 0 ? Math.round((done / total) * 100) : 0;
      const readyToLaunch = missingItems.length === 0;

      const backendBaseUrl = resolveBackendPublicBaseUrl(req);

      return res.json({
        ready_to_launch: readyToLaunch,
        plan,
        models,
        checks,
        missing_items: missingItems,
        completion: {
          done,
          total,
          percent,
        },
        public_urls: {
          backend_base_url: backendBaseUrl,
          whatsapp_webhook_url: `${backendBaseUrl}/webhooks/whatsapp`,
          widget_script_url: `${backendBaseUrl}/widget.js`,
        },
      });
    } catch (e) {
      console.error("Release status endpoint failed:", e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.post("/api/setup/business", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const {
        business_name,
        address,
        phone,
        timezone,
        business_type,
      } = req.body || {};

      const payload = {
        user_id: userId,
        business_name: String(business_name || "").trim() || null,
        business_type: normalizeBusinessType(business_type),
        address: String(address || "").trim() || null,
        phone: String(phone || "").trim() || null,
        timezone: String(timezone || "").trim() || DEFAULT_TIMEZONE,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabaseAdmin
        .from("business_profiles")
        .upsert(payload, { onConflict: "user_id" });

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.post("/api/setup/hours", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const hours = normalizeSetupHoursRows(req.body?.hours);
      const nowIso = new Date().toISOString();
      const rows = hours.map((row) => ({
        user_id: userId,
        day_of_week: row.day_of_week,
        is_closed: row.is_closed,
        open_time: row.open_time,
        close_time: row.close_time,
        updated_at: nowIso,
      }));

      const { error } = await supabaseAdmin
        .from("business_hours")
        .upsert(rows, { onConflict: "user_id,day_of_week" });

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.post("/api/setup/menu", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const items = normalizeSetupMenuItems(req.body?.items);
      if (!items.length) return res.json({ ok: true, inserted: 0 });

      const nowIso = new Date().toISOString();
      const rows = items.map((row) => ({
        user_id: userId,
        name: row.name,
        price: row.price,
        description: row.description,
        category: row.category,
        available: true,
        tags: [],
        updated_at: nowIso,
      }));

      const { error } = await supabaseAdmin.from("menu_items").insert(rows);
      if (error) return res.status(500).json({ error: error.message });

      return res.json({ ok: true, inserted: rows.length });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  // eslint-disable-next-line sonarjs/cognitive-complexity
  router.post("/api/setup/booking-rules", requireSupabaseUser, async (req, res) => {
    try {
      const userId = req.user.id;
      const maxPartyRaw = req.body?.max_party_size;
      const maxPartySize =
        maxPartyRaw === null || maxPartyRaw === undefined || maxPartyRaw === ""
          ? null
          : Number(maxPartyRaw);
      const bookingRequiredRaw =
        req.body?.booking_required ?? req.body?.booking_enabled ?? true;
      const advanceNoticeRaw = req.body?.advance_notice_minutes;
      const advanceNoticeMinutes =
        advanceNoticeRaw === null || advanceNoticeRaw === undefined || advanceNoticeRaw === ""
          ? null
          : Number(advanceNoticeRaw);

      const payload = {
        user_id: userId,
        booking_enabled: Boolean(bookingRequiredRaw),
        booking_required: Boolean(bookingRequiredRaw),
        require_name: true,
        require_phone: true,
        max_party_size: Number.isFinite(maxPartySize) ? maxPartySize : null,
        advance_notice_minutes: Number.isFinite(advanceNoticeMinutes)
          ? advanceNoticeMinutes
          : null,
        updated_at: new Date().toISOString(),
      };

      const bookingUpsert = await supabaseAdmin
        .from("booking_rules")
        .upsert(payload, { onConflict: "user_id" });
      if (bookingUpsert.error) {
        const errText = String(bookingUpsert.error.message || "").toLowerCase();
        if (
          errText.includes("booking_required") ||
          errText.includes("advance_notice_minutes")
        ) {
          const fallbackPayload = {
            user_id: userId,
            booking_enabled: Boolean(bookingRequiredRaw),
            require_name: true,
            require_phone: true,
            max_party_size: Number.isFinite(maxPartySize) ? maxPartySize : null,
            updated_at: new Date().toISOString(),
          };
          const fallback = await supabaseAdmin
            .from("booking_rules")
            .upsert(fallbackPayload, { onConflict: "user_id" });
          if (fallback.error) return res.status(500).json({ error: fallback.error.message });
        } else {
          return res.status(500).json({ error: bookingUpsert.error.message });
        }
      }

      const completePayload = {
        user_id: userId,
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const completion = await supabaseAdmin
        .from("client_settings")
        .upsert(completePayload, { onConflict: "user_id" });

      if (completion.error) {
        const errText = String(completion.error.message || "").toLowerCase();
        if (
          !errText.includes("onboarding_completed") &&
          !errText.includes("onboarding_completed_at")
        ) {
          return res.status(500).json({ error: completion.error.message });
        }
      }

      return res.json({ ok: true, completed: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.post("/api/setup/skip", requireSupabaseUser, async (req, res) => {
    try {
      const payload = {
        user_id: req.user.id,
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const completion = await supabaseAdmin
        .from("client_settings")
        .upsert(payload, { onConflict: "user_id" });

      if (completion.error) {
        const errText = String(completion.error.message || "").toLowerCase();
        if (
          !errText.includes("onboarding_completed") &&
          !errText.includes("onboarding_completed_at")
        ) {
          return res.status(500).json({ error: completion.error.message });
        }
      }

      return res.json({ ok: true, completed: true, skipped: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  router.post(
    "/api/menu/import-photo",
    requireSupabaseUser,
    async (req, res) => {
      try {
        const userId = String(req.body?.userId || "").trim();
        const imageDataUrl = String(req.body?.imageDataUrl || "").trim();
        if (!imageDataUrl) return res.status(400).json({ error: "Missing image data" });

        // Validate it is an image data URI and within size limits (~7.5MB base64 → ~5MB image)
        if (!imageDataUrl.startsWith("data:image/")) {
          return res.status(400).json({ error: "Invalid image format" });
        }
        if (imageDataUrl.length > 10_000_000) {
          return res.status(413).json({ error: "Image too large (max ~7.5MB)" });
        }
        if (!userId || userId !== req.user.id) {
          return res.status(403).json({ error: "Forbidden" });
        }
        if (!process.env.OPENROUTER_API_KEY) {
          return res.status(500).json({ error: "Missing OPENROUTER_API_KEY" });
        }

        const visionPrompt = `
You are extracting menu items from a restaurant menu image.

Return ONLY JSON in this format:
[
  { "name": "...", "price": number, "description": "...", "category": "..." }
]

Rules:
- Extract all items visible
- Price must be numeric
- Description optional
- Category optional
- Do not include extra text
        `.trim();

        const visionResp = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
          method: "POST",
          signal: AbortSignal.timeout(30000),
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.APP_URL,
            "X-Title": process.env.APP_TITLE,
          },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: visionPrompt },
                  { type: "image_url", image_url: { url: imageDataUrl } },
                ],
              },
            ],
            temperature: 0,
          }),
        });

        if (!visionResp.ok) {
          const errorText = await visionResp.text();
          console.error("Menu photo extraction failed:", errorText);
          return res
            .status(422)
            .json({ error: MENU_EXTRACTION_ERROR_MESSAGE });
        }

        const visionData = await visionResp.json();
        const content = String(
          visionData?.choices?.[0]?.message?.content?.trim() || ""
        );
        const jsonArray = extractFirstJsonArray(content);

        if (!jsonArray) {
          return res
            .status(422)
            .json({ error: MENU_EXTRACTION_ERROR_MESSAGE });
        }

        let parsed;
        try {
          parsed = JSON.parse(jsonArray);
        } catch {
          return res
            .status(422)
            .json({ error: MENU_EXTRACTION_ERROR_MESSAGE });
        }

        const items = normalizeImportedMenuItems(parsed);
        if (!items.length) {
          return res
            .status(422)
            .json({ error: MENU_EXTRACTION_ERROR_MESSAGE });
        }

        return res.json({ items });
      } catch (e) {
        console.error("Menu photo import failed:", e);
        return res
          .status(500)
          .json({ error: MENU_EXTRACTION_ERROR_MESSAGE });
      }
    }
  );

  router.post("/api/menu/import-confirm", requireSupabaseUser, async (req, res) => {
    try {
      const userId = String(req.body?.userId || "").trim();
      const items = normalizeImportedMenuItems(req.body?.items);

      if (!userId || userId !== req.user.id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!items.length) {
        return res.status(400).json({ error: "No valid items to import" });
      }

      const nowIso = new Date().toISOString();
      const insertRows = items.map((item) => ({
        user_id: userId,
        name: item.name,
        price: item.price,
        description: item.description,
        category: item.category,
        available: true,
        tags: [],
        updated_at: nowIso,
      }));

      const { data, error } = await supabaseAdmin
        .from("menu_items")
        .insert(insertRows)
        .select("id,name,price,description,category,available,tags");

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.json({
        ok: true,
        inserted: data || [],
      });
    } catch (e) {
      console.error("Menu import confirm failed:", e);
      return res.status(500).json({ error: SERVER_ERROR_MESSAGE });
    }
  });

  return router;
}
