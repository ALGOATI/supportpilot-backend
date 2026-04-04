"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { DashboardLanguage, t } from "@/lib/i18n";

function maskEmail(email: string): string {
  const atIdx = email.indexOf("@");
  if (atIdx <= 0) return email;
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx);
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}***${domain}`;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState<DashboardLanguage>("swedish");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [sentToEmail, setSentToEmail] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tr = (key: string) => t(language, key);
  const langLabels: Record<DashboardLanguage, string> = { english: "EN", swedish: "SV", arabic: "AR" };
  const isRtl = language === "arabic";

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  function startCooldown() {
    setResendCooldown(60);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function sendMagicLink() {
    if (!email.trim()) return;
    setLoading(true);
    setError(null);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);
    if (otpError) {
      setError(otpError.message);
      return;
    }

    setSentToEmail(email.trim());
    setEmailSent(true);
    startCooldown();
  }

  async function resendMagicLink() {
    if (resendCooldown > 0 || loading) return;
    setLoading(true);
    setError(null);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: sentToEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);
    if (otpError) {
      setError(otpError.message);
      return;
    }

    startCooldown();
  }

  const resendLabel =
    resendCooldown > 0
      ? tr("login_resend_cooldown").replace("{seconds}", String(resendCooldown))
      : tr("login_resend_link");

  const langSwitcher = (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16, gap: 6 }}>
      {(["english", "swedish", "arabic"] as DashboardLanguage[]).map((lang) => (
        <button
          key={lang}
          onClick={() => setLanguage(lang)}
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            border: "1px solid #d1d5db",
            background: language === lang ? "#e2e8f0" : "transparent",
            fontWeight: 700,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          {langLabels[lang]}
        </button>
      ))}
    </div>
  );

  // --- "Check your email" screen ---
  if (emailSent) {
    return (
      <div style={{ maxWidth: 400, margin: "80px auto" }} dir={isRtl ? "rtl" : "ltr"}>
        {langSwitcher}
        <h1 style={{ marginBottom: 8 }}>{tr("login_check_email_title")}</h1>
        <p style={{ marginBottom: 4, color: "#374151" }}>
          {tr("login_check_email_description")}{" "}
          <strong>{maskEmail(sentToEmail)}</strong>
        </p>
        <p style={{ marginBottom: 20, color: "#6b7280", fontSize: 14 }}>
          {tr("login_check_email_hint")}
        </p>

        {error && (
          <p style={{ color: "#dc2626", marginBottom: 12, fontSize: 14 }}>{error}</p>
        )}

        <p style={{ marginBottom: 8, fontSize: 14, color: "#374151" }}>
          {tr("login_didnt_receive")}
        </p>
        <button
          onClick={resendMagicLink}
          disabled={resendCooldown > 0 || loading}
          style={{
            display: "block",
            marginBottom: 16,
            padding: "8px 0",
            background: "none",
            border: "none",
            color: resendCooldown > 0 ? "#9ca3af" : "#2563eb",
            cursor: resendCooldown > 0 ? "default" : "pointer",
            fontSize: 14,
            textDecoration: resendCooldown > 0 ? "none" : "underline",
          }}
        >
          {resendLabel}
        </button>

        <button
          onClick={() => { setEmailSent(false); setError(null); }}
          style={{
            background: "none",
            border: "none",
            color: "#6b7280",
            cursor: "pointer",
            fontSize: 14,
            padding: 0,
          }}
        >
          {isRtl ? "→" : "←"} {tr("login_back")}
        </button>
      </div>
    );
  }

  // --- Main login form ---
  return (
    <div style={{ maxWidth: 400, margin: "80px auto" }} dir={isRtl ? "rtl" : "ltr"}>
      {langSwitcher}
      <h1 style={{ marginBottom: 20 }}>{tr("login_title")}</h1>

      {error && (
        <p style={{ color: "#dc2626", marginBottom: 12, fontSize: 14 }}>{error}</p>
      )}

      <p style={{ marginBottom: 12, fontSize: 14, color: "#374151" }}>
        {tr("login_magic_link_description")}
      </p>
      <input
        type="email"
        placeholder={tr("email_placeholder")}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && sendMagicLink()}
        style={{ width: "100%", marginBottom: 10 }}
      />
      <button
        onClick={sendMagicLink}
        disabled={loading}
        style={{ width: "100%" }}
      >
        {loading ? tr("sending") : tr("login_magic_link_button")}
      </button>
    </div>
  );
}
