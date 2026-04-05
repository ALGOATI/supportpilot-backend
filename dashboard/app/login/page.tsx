"use client";

import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { DashboardLanguage, t, isRtlLanguage } from "@/lib/i18n";

function maskEmail(e: string) {
  const at = e.indexOf("@");
  if (at <= 0) return e;
  const local = e.slice(0, at);
  const domain = e.slice(at);
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}***${domain}`;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState<DashboardLanguage>("english");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tr = (key: string) => t(language, key);
  const isRtl = isRtlLanguage(language);
  const langLabels: Record<DashboardLanguage, string> = {
    english: "EN",
    swedish: "SV",
    arabic: "AR",
  };

  function startCooldown() {
    setCooldown(60);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  async function sendMagicLink() {
    if (!email.trim()) return;
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }

    setSentTo(email.trim());
    setEmailSent(true);
    startCooldown();
  }

  async function resendMagicLink() {
    if (cooldown > 0 || loading) return;
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email: sentTo,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      startCooldown();
    }
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const cooldownText =
    cooldown > 0
      ? tr("login_resend_cooldown").replace("{seconds}", String(cooldown))
      : tr("login_resend_link");

  // ── Check your email screen ──
  if (emailSent) {
    return (
      <div style={styles.page} dir={isRtl ? "rtl" : "ltr"}>
        <div style={styles.ambientOrb1} />
        <div style={styles.ambientOrb2} />

        <div style={styles.card}>
          <LanguageSwitcher
            language={language}
            setLanguage={setLanguage}
            labels={langLabels}
          />

          <div style={styles.iconCircle}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M22 4L12 13L2 4" />
            </svg>
          </div>

          <h1 style={styles.heading}>{tr("login_check_email_title")}</h1>

          <p style={styles.subtext}>
            {tr("login_check_email_description")}{" "}
            <strong style={{ color: "#0f172a" }}>{maskEmail(sentTo)}</strong>
          </p>

          <p style={styles.hint}>{tr("login_check_email_hint")}</p>

          {error && <p style={styles.error}>{error}</p>}

          <p style={{ ...styles.hint, marginTop: 24 }}>
            {tr("login_didnt_receive")}
          </p>

          <button
            onClick={resendMagicLink}
            disabled={cooldown > 0 || loading}
            style={{
              ...styles.resendBtn,
              color: cooldown > 0 ? "#94a3b8" : "#2563eb",
              cursor: cooldown > 0 ? "default" : "pointer",
            }}
          >
            {cooldownText}
          </button>

          <button
            onClick={() => {
              setEmailSent(false);
              setError(null);
            }}
            style={styles.backBtn}
          >
            {isRtl ? "\u2192" : "\u2190"} {tr("login_back")}
          </button>
        </div>

        <p style={styles.footer}>SupportPilot</p>
      </div>
    );
  }

  // ── Login screen ──
  return (
    <div style={styles.page} dir={isRtl ? "rtl" : "ltr"}>
      <div style={styles.ambientOrb1} />
      <div style={styles.ambientOrb2} />

      <div style={styles.card}>
        <LanguageSwitcher
          language={language}
          setLanguage={setLanguage}
          labels={langLabels}
        />

        <div style={styles.logoRow}>
          <div style={styles.logoMark}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          </div>
          <span style={styles.logoText}>SupportPilot</span>
        </div>

        <h1 style={styles.heading}>{tr("login_title")}</h1>
        <p style={styles.subtext}>{tr("login_magic_link_description")}</p>

        {error && <p style={styles.error}>{error}</p>}

        <div style={{ marginTop: 24, display: "grid", gap: 12 }}>
          <input
            type="email"
            placeholder={tr("email_placeholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMagicLink()}
            style={styles.input}
          />

          <button
            onClick={sendMagicLink}
            disabled={loading || !email.trim()}
            style={{
              ...styles.primaryBtn,
              opacity: loading || !email.trim() ? 0.6 : 1,
              cursor: loading || !email.trim() ? "not-allowed" : "pointer",
            }}
          >
            {loading ? tr("sending") : tr("login_magic_link_button")}
          </button>
        </div>
      </div>

      <p style={styles.footer}>SupportPilot</p>
    </div>
  );
}

// ── Language Switcher ──
function LanguageSwitcher({
  language,
  setLanguage,
  labels,
}: {
  language: DashboardLanguage;
  setLanguage: (l: DashboardLanguage) => void;
  labels: Record<DashboardLanguage, string>;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20, gap: 6 }}>
      {(["english", "swedish", "arabic"] as DashboardLanguage[]).map((lang) => (
        <button
          key={lang}
          onClick={() => setLanguage(lang)}
          style={{
            padding: "5px 12px",
            borderRadius: 999,
            border: language === lang ? "1.5px solid #2563eb" : "1.5px solid #e2e8f0",
            background: language === lang ? "#eff6ff" : "transparent",
            color: language === lang ? "#2563eb" : "#64748b",
            fontWeight: 600,
            fontSize: 12,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          {labels[lang]}
        </button>
      ))}
    </div>
  );
}

// ── Styles ──
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(145deg, #f8fafc 0%, #eef2f7 50%, #e8edf5 100%)",
    position: "relative",
    overflow: "hidden",
    padding: "20px",
  },
  ambientOrb1: {
    position: "absolute",
    width: 500,
    height: 500,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(37,99,235,0.06) 0%, transparent 70%)",
    top: -100,
    right: -100,
    pointerEvents: "none",
  },
  ambientOrb2: {
    position: "absolute",
    width: 400,
    height: 400,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(99,102,241,0.05) 0%, transparent 70%)",
    bottom: -80,
    left: -80,
    pointerEvents: "none",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    background: "white",
    borderRadius: 20,
    padding: "36px 32px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 8px 30px rgba(0,0,0,0.06)",
    border: "1px solid rgba(0,0,0,0.06)",
    position: "relative",
    zIndex: 1,
  },
  logoRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 28,
  },
  logoMark: {
    width: 40,
    height: 40,
    borderRadius: 12,
    background: "linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  logoText: {
    fontSize: 20,
    fontWeight: 800,
    color: "#0f172a",
    letterSpacing: "-0.02em",
  },
  heading: {
    margin: "0 0 8px",
    fontSize: 24,
    fontWeight: 800,
    color: "#0f172a",
    letterSpacing: "-0.01em",
  },
  subtext: {
    margin: 0,
    fontSize: 15,
    color: "#64748b",
    lineHeight: 1.5,
  },
  hint: {
    margin: "12px 0 0",
    fontSize: 14,
    color: "#94a3b8",
    lineHeight: 1.5,
  },
  error: {
    marginTop: 16,
    padding: "10px 14px",
    borderRadius: 10,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#dc2626",
    fontSize: 14,
    fontWeight: 600,
  },
  input: {
    width: "100%",
    padding: "14px 16px",
    borderRadius: 12,
    border: "1.5px solid #e2e8f0",
    background: "#f8fafc",
    color: "#0f172a",
    fontSize: 15,
    outline: "none",
    transition: "border-color 0.2s, box-shadow 0.2s",
    boxSizing: "border-box",
  },
  primaryBtn: {
    width: "100%",
    padding: "14px 16px",
    borderRadius: 12,
    border: "none",
    background: "linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)",
    color: "white",
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    transition: "opacity 0.15s, transform 0.1s",
    boxSizing: "border-box",
  },
  resendBtn: {
    display: "block",
    margin: "8px 0 0",
    padding: 0,
    background: "none",
    border: "none",
    fontSize: 14,
    textDecoration: "underline",
    textUnderlineOffset: 2,
  },
  backBtn: {
    display: "block",
    marginTop: 20,
    padding: 0,
    background: "none",
    border: "none",
    color: "#64748b",
    cursor: "pointer",
    fontSize: 14,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 16,
    background: "#eff6ff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  footer: {
    marginTop: 32,
    fontSize: 13,
    color: "#94a3b8",
    fontWeight: 600,
    letterSpacing: "0.02em",
    zIndex: 1,
  },
};
