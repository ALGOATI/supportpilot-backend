import crypto from "node:crypto";
import ical from "ical-generator";

// ─── CALENDAR SERVICE ─────────────────────────────────────────────────────────
// Phase 1: ICS calendar feed (all plans)
// Phase 2: Google Calendar API sync (Pro/Business only)
// ──────────────────────────────────────────────────────────────────────────────

export function createCalendarService({ supabaseAdmin }) {

  // ── ICS Feed ──────────────────────────────────────────────────────────────

  async function getOrCreateFeedToken(businessId) {
    const { data } = await supabaseAdmin
      .from("businesses")
      .select("calendar_feed_token")
      .eq("id", businessId)
      .single();

    if (data?.calendar_feed_token) return data.calendar_feed_token;

    const token = crypto.randomBytes(32).toString("hex");
    await supabaseAdmin
      .from("businesses")
      .update({ calendar_feed_token: token })
      .eq("id", businessId);

    return token;
  }

  async function generateIcsFeed(businessId, token) {
    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select("id, name, calendar_feed_token")
      .eq("id", businessId)
      .eq("calendar_feed_token", token)
      .single();

    if (!business) return null;

    const { data: bookings } = await supabaseAdmin
      .from("bookings")
      .select("id, customer_name, customer_phone, booking_date, booking_time, people, status, created_at")
      .eq("user_id", businessId)
      .in("status", ["confirmed", "completed"])
      .order("booking_date", { ascending: true });

    const calendarName = business.name
      ? `${business.name} – SupportPilot Bookings`
      : "SupportPilot Bookings";

    const calendar = ical({ name: calendarName });

    for (const booking of bookings || []) {
      const start = parseBookingDateTime(booking.booking_date, booking.booking_time);
      if (!start) continue;

      const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour default

      const descriptionParts = [];
      if (booking.people) descriptionParts.push(`Party size: ${booking.people}`);
      if (booking.customer_phone) descriptionParts.push(`Phone: ${booking.customer_phone}`);
      descriptionParts.push(`Status: ${booking.status}`);
      descriptionParts.push("Booked via WhatsApp AI (SupportPilot)");

      calendar.createEvent({
        start,
        end,
        summary: `Booking: ${booking.customer_name || "Customer"}`,
        description: descriptionParts.join("\n"),
        uid: `booking-${booking.id}@supportpilot`,
      });
    }

    return calendar.toString();
  }

  function parseBookingDateTime(dateStr, timeStr) {
    if (!dateStr) return null;
    try {
      // booking_date is "YYYY-MM-DD", booking_time is "HH:MM" or "HH:MM:SS"
      const timePart = timeStr || "12:00";
      const normalized = timePart.length === 5 ? `${timePart}:00` : timePart;
      return new Date(`${dateStr}T${normalized}`);
    } catch {
      return null;
    }
  }

  // ── Google Calendar API ───────────────────────────────────────────────────

  let _google = null;

  async function getGoogleLib() {
    if (_google) return _google;
    try {
      const { google } = await import("googleapis");
      _google = google;
      return _google;
    } catch {
      return null;
    }
  }

  function hasGoogleConfig() {
    return Boolean(
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REDIRECT_URI
    );
  }

  async function createOAuth2Client() {
    const google = await getGoogleLib();
    if (!google || !hasGoogleConfig()) return null;

    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
  }

  function getGoogleAuthUrl(oauth2Client, businessId) {
    return oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/calendar.events"],
      state: businessId,
    });
  }

  async function handleGoogleCallback(code, businessId) {
    const oauth2Client = await createOAuth2Client();
    if (!oauth2Client) throw new Error("Google OAuth not configured");

    const { tokens } = await oauth2Client.getToken(code);

    await supabaseAdmin
      .from("businesses")
      .update({
        google_calendar_tokens: tokens,
        google_calendar_id: "primary",
      })
      .eq("id", businessId);

    return tokens;
  }

  async function disconnectGoogleCalendar(businessId) {
    await supabaseAdmin
      .from("businesses")
      .update({
        google_calendar_tokens: null,
        google_calendar_id: "primary",
      })
      .eq("id", businessId);
  }

  async function getAuthedCalendarClient(business) {
    if (!business.google_calendar_tokens) return null;

    const oauth2Client = await createOAuth2Client();
    if (!oauth2Client) return null;

    oauth2Client.setCredentials(business.google_calendar_tokens);

    // Auto-refresh expired tokens and persist
    oauth2Client.on("tokens", async (newTokens) => {
      try {
        const merged = { ...business.google_calendar_tokens, ...newTokens };
        await supabaseAdmin
          .from("businesses")
          .update({ google_calendar_tokens: merged })
          .eq("id", business.id);
      } catch (err) {
        console.error("Failed to persist refreshed Google tokens:", err?.message);
      }
    });

    const google = await getGoogleLib();
    if (!google) return null;

    return google.calendar({ version: "v3", auth: oauth2Client });
  }

  async function createGoogleCalendarEvent(business, booking) {
    if (!business.google_calendar_tokens) return null;

    const calendarClient = await getAuthedCalendarClient(business);
    if (!calendarClient) return null;

    const start = parseBookingDateTime(booking.booking_date, booking.booking_time);
    if (!start) return null;

    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const timeZone = business.timezone || "Europe/Stockholm";

    const descriptionParts = [];
    if (booking.people) descriptionParts.push(`Party size: ${booking.people}`);
    if (booking.customer_phone) descriptionParts.push(`Phone: ${booking.customer_phone}`);
    descriptionParts.push("Booked via SupportPilot AI");

    const event = {
      summary: `Booking: ${booking.customer_name || "Customer"}`,
      description: descriptionParts.join("\n"),
      start: { dateTime: start.toISOString(), timeZone },
      end: { dateTime: end.toISOString(), timeZone },
    };

    try {
      const result = await calendarClient.events.insert({
        calendarId: business.google_calendar_id || "primary",
        resource: event,
      });

      // Store google_event_id on the booking for future update/cancel
      await supabaseAdmin
        .from("bookings")
        .update({ google_event_id: result.data.id })
        .eq("id", booking.id);

      return result.data;
    } catch (err) {
      console.error("Google Calendar create event error:", err?.message);
      return null;
    }
  }

  async function cancelGoogleCalendarEvent(business, booking) {
    if (!business.google_calendar_tokens || !booking.google_event_id) return;

    const calendarClient = await getAuthedCalendarClient(business);
    if (!calendarClient) return;

    try {
      await calendarClient.events.delete({
        calendarId: business.google_calendar_id || "primary",
        eventId: booking.google_event_id,
      });
    } catch (err) {
      console.error("Google Calendar delete event error:", err?.message);
    }
  }

  // ── High-level sync (called from conversation engine) ─────────────────────

  async function syncBookingToCalendar({ userId, bookingId, status }) {
    try {
      const { data: business } = await supabaseAdmin
        .from("businesses")
        .select("id, name, timezone, google_calendar_tokens, google_calendar_id")
        .eq("id", userId)
        .single();

      if (!business) return;

      const { data: booking } = await supabaseAdmin
        .from("bookings")
        .select("id, customer_name, customer_phone, booking_date, booking_time, people, status, google_event_id")
        .eq("id", bookingId)
        .single();

      if (!booking) return;

      if (status === "confirmed") {
        const event = await createGoogleCalendarEvent(business, booking);
        if (event) {
          console.log(`Calendar: booking ${bookingId} synced to Google Calendar`);
        } else {
          console.log(`Calendar: booking ${bookingId} saved (available via ICS feed)`);
        }
      } else if (status === "cancelled") {
        await cancelGoogleCalendarEvent(business, booking);
        console.log(`Calendar: booking ${bookingId} cancelled in Google Calendar`);
      }
    } catch (err) {
      // Calendar sync is non-blocking — booking is already saved
      console.error("Calendar sync error:", err?.message || err);
    }
  }

  return {
    // ICS feed
    getOrCreateFeedToken,
    generateIcsFeed,
    // Google OAuth
    hasGoogleConfig,
    createOAuth2Client,
    getGoogleAuthUrl,
    handleGoogleCallback,
    disconnectGoogleCalendar,
    // Sync (used by conversation engine)
    syncBookingToCalendar,
  };
}
