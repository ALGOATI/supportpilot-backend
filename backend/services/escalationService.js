import { SCHEMA_CACHE_TEXT, DOES_NOT_EXIST_TEXT } from "../config/constants.js";

export function createEscalationService({ supabaseAdmin }) {
  async function findUserByEmail(email) {
    const { data: authUser, error } = await supabaseAdmin
      .rpc("get_auth_user_by_email", { lookup_email: email })
      .maybeSingle();

    if (error) throw new Error(error.message);

    return authUser || null;
  }

  function buildEscalationNotificationPreview({
    channel,
    externalUserId,
    messageText,
  }) {
    const safeChannel = String(channel || "unknown").trim() || "unknown";
    const safeCustomer = String(externalUserId || "Customer").trim() || "Customer";
    const safeMessage = String(messageText || "").trim().slice(0, 220) || "Escalated conversation";
    return `${safeChannel} • ${safeCustomer} • ${safeMessage}`;
  }

  async function sendEscalationEmailNotification({
    userId,
    channel,
    externalUserId,
    messagePreview,
  }) {
    try {
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (authErr) {
        console.error("Escalation email user lookup failed:", authErr.message);
        return;
      }

      const toEmail = String(authData?.user?.email || "").trim();
      if (!toEmail) return;

      const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
      const resendFrom = String(process.env.RESEND_FROM_EMAIL || "").trim();
      if (!resendApiKey || !resendFrom) {
        console.log(
          "[NOTIFY] Escalation email skipped (missing RESEND_API_KEY/RESEND_FROM_EMAIL)",
          { toEmail, channel, externalUserId }
        );
        return;
      }

      const subject = `SupportPilot escalation: ${String(channel || "conversation")}`;
      const html = `
        <div>
          <h2>Escalated conversation</h2>
          <p><strong>Channel:</strong> ${String(channel || "unknown")}</p>
          <p><strong>Customer:</strong> ${String(externalUserId || "Unknown")}</p>
          <p><strong>Preview:</strong> ${String(messagePreview || "")}</p>
        </div>
      `.trim();

      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: resendFrom,
          to: [toEmail],
          subject,
          html,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error("Escalation email send failed:", errText);
      }
    } catch (err) {
      console.error("Escalation email notification failed:", err?.message || err);
    }
  }

  async function createEscalationNotification({
    userId,
    conversationId,
    channel,
    externalUserId,
    customerMessage,
  }) {
    const preview = buildEscalationNotificationPreview({
      channel,
      externalUserId,
      messageText: customerMessage,
    });

    const { error } = await supabaseAdmin.from("notifications").insert({
      user_id: userId,
      type: "escalation",
      conversation_id: conversationId,
      message_preview: preview,
      read: false,
    });

    if (error) {
      const txt = String(error.message || "").toLowerCase();
      if (txt.includes("notifications") && (txt.includes(DOES_NOT_EXIST_TEXT) || txt.includes(SCHEMA_CACHE_TEXT))) {
        console.warn("[NOTIFY] notifications table missing; skipping DB notification");
      } else {
        throw new Error(error.message);
      }
    }

    await sendEscalationEmailNotification({
      userId,
      channel,
      externalUserId,
      messagePreview: preview,
    });
  }

  return {
    findUserByEmail,
    buildEscalationNotificationPreview,
    sendEscalationEmailNotification,
    createEscalationNotification,
  };
}
