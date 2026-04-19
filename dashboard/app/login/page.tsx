"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getBackendUrl } from "@/lib/backend-url";
import { DashboardLanguage, t, isRtlLanguage } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [language, setLanguage] = useState<DashboardLanguage>("english");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tr = (key: string) => t(language, key);
  const isRtl = isRtlLanguage(language);
  const langLabels: Record<DashboardLanguage, string> = {
    english: "EN",
    swedish: "SV",
    arabic: "AR",
  };

  async function handleLogin(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        router.push("/dashboard");
        return;
      }

      const res = await fetch(`${getBackendUrl()}/api/setup/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const status = await res.json();
        router.push(status?.completed ? "/dashboard" : "/setup");
      } else {
        router.push("/dashboard");
      }
    } catch {
      router.push("/dashboard");
    }
  }

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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/supportpilot-logo.svg" alt="SupportPilot" width={40} height={40} style={styles.logoMark} />
          <span style={styles.logoText}>SupportPilot</span>
        </div>

        <h1 style={styles.heading}>{tr("login_title")}</h1>
        <p style={styles.subtext}>{tr("login_password_description")}</p>

        {error && <p style={styles.error}>{error}</p>}

        <form onSubmit={handleLogin} style={{ marginTop: 24, display: "grid", gap: 12 }}>
          <input
            type="email"
            placeholder={tr("email_placeholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            style={styles.input}
            required
          />
          <input
            type="password"
            placeholder={tr("password_placeholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            style={styles.input}
            required
          />

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            style={{
              ...styles.primaryBtn,
              opacity: loading || !email.trim() || !password ? 0.6 : 1,
              cursor: loading || !email.trim() || !password ? "not-allowed" : "pointer",
            }}
          >
            {loading ? tr("sending") : tr("login_submit")}
          </button>
        </form>

        <p style={{ ...styles.hint, marginTop: 20, textAlign: "center" }}>
          {tr("login_no_account")}{" "}
          <Link href="/signup" style={styles.link}>
            {tr("login_signup_link")}
          </Link>
        </p>
      </div>

      <p style={styles.footer}>SupportPilot</p>
    </div>
  );
}

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
          type="button"
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
  logoRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 28 },
  logoMark: {
    width: 40,
    height: 40,
    borderRadius: 12,
    display: "block",
    flexShrink: 0,
  },
  logoText: { fontSize: 20, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" },
  heading: { margin: "0 0 8px", fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.01em" },
  subtext: { margin: 0, fontSize: 15, color: "#64748b", lineHeight: 1.5 },
  hint: { margin: 0, fontSize: 14, color: "#94a3b8", lineHeight: 1.5 },
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
  link: {
    color: "#2563eb",
    fontWeight: 600,
    textDecoration: "underline",
    textUnderlineOffset: 2,
  },
  footer: { marginTop: 32, fontSize: 13, color: "#94a3b8", fontWeight: 600, letterSpacing: "0.02em", zIndex: 1 },
};
