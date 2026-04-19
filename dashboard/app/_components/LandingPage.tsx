"use client";

import { useState, type CSSProperties, type MouseEvent } from "react";
import Link from "next/link";

const COLORS = {
  bg: "#F8FAFC",
  bgAlt: "#EEF2F7",
  surface: "#FFFFFF",
  dark: "#0F172A",
  text: "#334155",
  muted: "#64748B",
  subtle: "#94A3B8",
  accent: "#2563EB",
  accentAlt: "#4F46E5",
  accentLight: "#EFF6FF",
  accentSoft: "#E0E7FF",
  accentDark: "#1E40AF",
  border: "#E2E8F0",
  borderSoft: "#EEF2F7",
};

const GRADIENT = "linear-gradient(135deg, #2563EB 0%, #4F46E5 100%)";
const PAGE_GRADIENT = "linear-gradient(145deg, #F8FAFC 0%, #EEF2F7 50%, #E8EDF5 100%)";

const OUTFIT = "var(--font-outfit), 'Outfit', sans-serif";
const DM = "var(--font-dm-sans), 'DM Sans', sans-serif";

const linkStyle: CSSProperties = {
  color: COLORS.muted,
  textDecoration: "none",
  fontSize: 14,
  fontFamily: DM,
  fontWeight: 500,
  cursor: "pointer",
};

function smoothScrollTo(id: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    const el = document.getElementById(id);
    if (el) {
      e.preventDefault();
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
}

const LogoMark = ({ size = 36 }: { size?: number }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src="/supportpilot-logo.svg"
    alt="SupportPilot"
    width={size}
    height={size}
    style={{ display: "block", borderRadius: 10 }}
  />
);

const NavBar = () => (
  <nav
    className="lp-nav"
    style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      background: "rgba(248,250,252,0.85)",
      backdropFilter: "blur(16px)",
      WebkitBackdropFilter: "blur(16px)",
      borderBottom: `1px solid ${COLORS.border}`,
    }}
  >
    <div
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        padding: "0 24px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        height: 64,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <LogoMark size={32} />
        <span
          style={{
            fontFamily: OUTFIT,
            fontWeight: 700,
            fontSize: 18,
            color: COLORS.dark,
            letterSpacing: "-0.02em",
          }}
        >
          SupportPilot
        </span>
      </div>
      <div className="lp-nav-right" style={{ display: "flex", alignItems: "center", gap: 32 }}>
        <a href="#how" onClick={smoothScrollTo("how")} className="lp-nav-link" style={linkStyle}>
          How it works
        </a>
        <a
          href="#pricing"
          onClick={smoothScrollTo("pricing")}
          className="lp-nav-link"
          style={linkStyle}
        >
          Pricing
        </a>
        <a href="#faq" onClick={smoothScrollTo("faq")} className="lp-nav-link" style={linkStyle}>
          FAQ
        </a>
        <Link
          href="/signup"
          style={{
            background: GRADIENT,
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "10px 22px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: DM,
            textDecoration: "none",
            display: "inline-block",
            boxShadow: "0 4px 14px rgba(37,99,235,0.25)",
          }}
        >
          Get started free
        </Link>
      </div>
    </div>
  </nav>
);

const Hero = () => (
  <section
    style={{
      paddingTop: 160,
      paddingBottom: 100,
      textAlign: "center",
      background: PAGE_GRADIENT,
      position: "relative",
      overflow: "hidden",
    }}
  >
    <div
      style={{
        position: "absolute",
        top: -150,
        right: -150,
        width: 560,
        height: 560,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(37,99,235,0.10) 0%, transparent 70%)",
        pointerEvents: "none",
      }}
    />
    <div
      style={{
        position: "absolute",
        bottom: -120,
        left: -120,
        width: 460,
        height: 460,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)",
        pointerEvents: "none",
      }}
    />
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 24px", position: "relative" }}>
      <div
        style={{
          display: "inline-block",
          background: COLORS.accentLight,
          color: COLORS.accentDark,
          fontSize: 13,
          fontWeight: 600,
          padding: "6px 16px",
          borderRadius: 100,
          marginBottom: 24,
          fontFamily: DM,
          border: `1px solid ${COLORS.accentSoft}`,
        }}
      >
        AI-powered customer support for small businesses
      </div>
      <h1
        className="lp-hero-title"
        style={{
          fontFamily: OUTFIT,
          fontSize: 56,
          fontWeight: 800,
          color: COLORS.dark,
          lineHeight: 1.1,
          letterSpacing: "-0.03em",
          margin: "0 0 20px",
        }}
      >
        Your business knowledge,{" "}
        <span
          style={{
            background: GRADIENT,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          answering 24/7
        </span>
      </h1>
      <p
        style={{
          fontFamily: DM,
          fontSize: 19,
          color: COLORS.muted,
          lineHeight: 1.65,
          maxWidth: 540,
          margin: "0 auto 36px",
        }}
      >
        Add your business info, FAQs, and policies — SupportPilot turns them into an AI assistant
        that answers your customers instantly. And it keeps getting smarter from every conversation
        you handle.
      </p>
      <div
        className="lp-hero-ctas"
        style={{ display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap" }}
      >
        <Link
          href="/signup"
          style={{
            background: GRADIENT,
            color: "#fff",
            border: "none",
            borderRadius: 12,
            padding: "16px 36px",
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: DM,
            textDecoration: "none",
            display: "inline-block",
            boxShadow: "0 10px 30px rgba(37,99,235,0.3)",
            letterSpacing: "-0.01em",
          }}
        >
          Start for free
        </Link>
        <a
          href="#how"
          onClick={smoothScrollTo("how")}
          style={{
            background: COLORS.surface,
            color: COLORS.dark,
            border: `1.5px solid ${COLORS.border}`,
            borderRadius: 12,
            padding: "16px 36px",
            fontSize: 16,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: DM,
            textDecoration: "none",
            display: "inline-block",
          }}
        >
          See how it works ↓
        </a>
      </div>
      <p style={{ fontFamily: DM, fontSize: 13, color: COLORS.subtle, marginTop: 16 }}>
        Free plan included · No credit card required · Set up in 5 minutes
      </p>
    </div>

    <div style={{ maxWidth: 900, margin: "60px auto 0", padding: "0 24px", position: "relative" }}>
      <div
        style={{
          background: COLORS.surface,
          borderRadius: 20,
          border: `1px solid ${COLORS.border}`,
          padding: 24,
          boxShadow: "0 1px 3px rgba(15,23,42,0.04), 0 20px 50px rgba(15,23,42,0.08)",
        }}
      >
        <div
          className="lp-demo-inner"
          style={{
            background: COLORS.bg,
            borderRadius: 14,
            padding: 20,
            display: "flex",
            gap: 16,
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                background: COLORS.surface,
                borderRadius: 12,
                padding: 16,
                border: `1px solid ${COLORS.border}`,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "#E0E7FF",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#4338CA",
                  }}
                >
                  K
                </div>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: COLORS.text,
                    fontFamily: DM,
                  }}
                >
                  Customer
                </span>
                <span style={{ fontSize: 11, color: COLORS.subtle, fontFamily: DM }}>2 min ago</span>
              </div>
              <p
                style={{
                  fontSize: 14,
                  color: COLORS.text,
                  margin: 0,
                  fontFamily: DM,
                  lineHeight: 1.5,
                  textAlign: "left",
                }}
              >
                Hi! Do you deliver to Gothenburg? And what&apos;s the shipping time?
              </p>
            </div>
            <div
              style={{
                background: COLORS.accentLight,
                borderRadius: 12,
                padding: 16,
                border: `1px solid ${COLORS.accentSoft}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: GRADIENT,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#fff",
                  }}
                >
                  AI
                </div>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: COLORS.accentDark,
                    fontFamily: DM,
                  }}
                >
                  SupportPilot
                </span>
                <span style={{ fontSize: 11, color: COLORS.accent, fontFamily: DM }}>Instant</span>
              </div>
              <p
                style={{
                  fontSize: 14,
                  color: COLORS.accentDark,
                  margin: 0,
                  fontFamily: DM,
                  lineHeight: 1.5,
                  textAlign: "left",
                }}
              >
                Yes, we deliver to Gothenburg! Standard shipping takes 2-3 business days and costs
                49 kr. Orders over 499 kr ship free. Would you like help placing an order?
              </p>
            </div>
          </div>
          <div
            className="lp-demo-side"
            style={{
              width: 220,
              background: COLORS.surface,
              borderRadius: 12,
              border: `1px solid ${COLORS.border}`,
              padding: 16,
              flexShrink: 0,
            }}
          >
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: COLORS.muted,
                margin: "0 0 12px",
                fontFamily: DM,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                textAlign: "left",
              }}
            >
              Knowledge matched
            </p>
            <div
              style={{
                background: COLORS.accentLight,
                borderRadius: 8,
                padding: 10,
                marginBottom: 8,
                border: `1px solid ${COLORS.accentSoft}`,
              }}
            >
              <p
                style={{
                  fontSize: 12,
                  color: COLORS.accentDark,
                  margin: 0,
                  fontFamily: DM,
                  lineHeight: 1.4,
                  textAlign: "left",
                }}
              >
                ✓ Shipping to Gothenburg: 2-3 days, 49 kr
              </p>
            </div>
            <div
              style={{
                background: COLORS.accentLight,
                borderRadius: 8,
                padding: 10,
                border: `1px solid ${COLORS.accentSoft}`,
              }}
            >
              <p
                style={{
                  fontSize: 12,
                  color: COLORS.accentDark,
                  margin: 0,
                  fontFamily: DM,
                  lineHeight: 1.4,
                  textAlign: "left",
                }}
              >
                ✓ Free shipping over 499 kr
              </p>
            </div>
            <p
              style={{
                fontSize: 11,
                color: COLORS.subtle,
                margin: "12px 0 0",
                fontFamily: DM,
                lineHeight: 1.4,
                textAlign: "left",
              }}
            >
              Answered from your knowledge base in 0.8s
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
);

const steps = [
  {
    num: "01",
    title: "Add your business knowledge",
    desc: "Upload your FAQs, opening hours, shipping info, return policies — whatever your customers usually ask about. This is the foundation the AI works from.",
    visual: "📋",
  },
  {
    num: "02",
    title: "Drop the widget on your site",
    desc: "Copy one line of code and paste it on your website. Works with any platform — WordPress, Wix, Squarespace, Shopify, or custom sites.",
    visual: "< />",
  },
  {
    num: "03",
    title: "AI gets smarter over time",
    desc: "When a question comes in that the AI can't answer, it escalates to you. Your reply gets saved as new knowledge automatically — so next time, the AI handles it.",
    visual: "🧠",
  },
];

const HowItWorks = () => (
  <section id="how" style={{ padding: "100px 24px", background: COLORS.surface }}>
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 64 }}>
        <p
          style={{
            fontFamily: DM,
            fontSize: 13,
            fontWeight: 700,
            color: COLORS.accent,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 12,
          }}
        >
          How it works
        </p>
        <h2
          style={{
            fontFamily: OUTFIT,
            fontSize: 40,
            fontWeight: 800,
            color: COLORS.dark,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Set up in minutes, not days
        </h2>
      </div>
      <div className="lp-steps" style={{ display: "flex", gap: 24 }}>
        {steps.map((s, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              background: COLORS.bg,
              borderRadius: 18,
              padding: 32,
              position: "relative",
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <span
              style={{
                fontFamily: OUTFIT,
                fontSize: 48,
                fontWeight: 800,
                color: "rgba(37,99,235,0.12)",
                position: "absolute",
                top: 20,
                right: 24,
              }}
            >
              {s.num}
            </span>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: COLORS.accentLight,
                border: `1px solid ${COLORS.accentSoft}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                marginBottom: 20,
              }}
            >
              {s.visual}
            </div>
            <h3
              style={{
                fontFamily: OUTFIT,
                fontSize: 20,
                fontWeight: 700,
                color: COLORS.dark,
                margin: "0 0 10px",
                letterSpacing: "-0.01em",
              }}
            >
              {s.title}
            </h3>
            <p
              style={{
                fontFamily: DM,
                fontSize: 15,
                color: COLORS.muted,
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              {s.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const features = [
  {
    title: "Knowledge base",
    desc: "Add your FAQs, policies, opening hours, and product info. The AI uses this as its foundation to answer customer questions accurately.",
    tag: "Core",
  },
  {
    title: "AI learning pipeline",
    desc: "When you manually answer an escalated question, the system saves it as new knowledge. The AI handles similar questions automatically next time.",
    tag: "Smart",
  },
  {
    title: "Multilingual support",
    desc: "Built-in support for English, Swedish, and Arabic with full right-to-left layout. Your customers write in their language.",
    tag: "i18n",
  },
  {
    title: "Smart escalation",
    desc: "When the AI isn't confident, it collects the question and notifies you. No bad answers, no frustrated customers.",
    tag: "Safety",
  },
  {
    title: "Analytics dashboard",
    desc: "See what customers ask most, where the AI succeeds, and where it needs help. Make data-driven improvements.",
    tag: "Insights",
  },
  {
    title: "Custom branding",
    desc: "Match the chat widget to your brand colors and style. Your customers see your brand, not ours.",
    tag: "Design",
  },
];

const Features = () => (
  <section style={{ padding: "100px 24px", background: COLORS.bg }}>
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 64 }}>
        <p
          style={{
            fontFamily: DM,
            fontSize: 13,
            fontWeight: 700,
            color: COLORS.accent,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 12,
          }}
        >
          Features
        </p>
        <h2
          style={{
            fontFamily: OUTFIT,
            fontSize: 40,
            fontWeight: 800,
            color: COLORS.dark,
            letterSpacing: "-0.02em",
            margin: "0 0 12px",
          }}
        >
          Everything you need, nothing you don&apos;t
        </h2>
        <p style={{ fontFamily: DM, fontSize: 17, color: COLORS.muted, margin: 0 }}>
          Built for small business owners who want results, not complexity.
        </p>
      </div>
      <div
        className="lp-features-grid"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}
      >
        {features.map((f, i) => (
          <div
            key={i}
            style={{
              background: COLORS.surface,
              borderRadius: 16,
              padding: 28,
              border: `1px solid ${COLORS.border}`,
              transition: "border-color 0.2s",
            }}
          >
            <span
              style={{
                display: "inline-block",
                background: COLORS.accentLight,
                color: COLORS.accentDark,
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 10px",
                borderRadius: 6,
                marginBottom: 14,
                fontFamily: DM,
                border: `1px solid ${COLORS.accentSoft}`,
              }}
            >
              {f.tag}
            </span>
            <h3
              style={{
                fontFamily: OUTFIT,
                fontSize: 18,
                fontWeight: 700,
                color: COLORS.dark,
                margin: "0 0 8px",
              }}
            >
              {f.title}
            </h3>
            <p
              style={{
                fontFamily: DM,
                fontSize: 14,
                color: COLORS.muted,
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              {f.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const tiers = [
  {
    name: "Free",
    price: "0",
    period: "forever",
    desc: "Try it out, no commitment",
    features: [
      "100 conversations/month",
      "1 widget",
      "Basic customization",
      "EN / SV / AR support",
      "SupportPilot branding",
    ],
    cta: "Start free",
    highlight: false,
  },
  {
    name: "Starter",
    price: "299",
    period: "/month",
    desc: "For growing businesses",
    features: [
      "1,000 conversations/month",
      "3 widgets",
      "Remove branding",
      "AI learning pipeline",
      "Basic analytics",
      "Email notifications",
    ],
    cta: "Get started",
    highlight: true,
  },
  {
    name: "Pro",
    price: "599",
    period: "/month",
    desc: "For busy businesses",
    features: [
      "5,000 conversations/month",
      "Unlimited widgets",
      "Everything in Starter",
      "Advanced analytics",
      "Priority support",
      "Custom branding",
    ],
    cta: "Go Pro",
    highlight: false,
  },
];

const Pricing = () => (
  <section id="pricing" style={{ padding: "100px 24px", background: COLORS.surface }}>
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 64 }}>
        <p
          style={{
            fontFamily: DM,
            fontSize: 13,
            fontWeight: 700,
            color: COLORS.accent,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 12,
          }}
        >
          Pricing
        </p>
        <h2
          style={{
            fontFamily: OUTFIT,
            fontSize: 40,
            fontWeight: 800,
            color: COLORS.dark,
            letterSpacing: "-0.02em",
            margin: "0 0 12px",
          }}
        >
          Simple pricing, no surprises
        </h2>
        <p style={{ fontFamily: DM, fontSize: 17, color: COLORS.muted, margin: 0 }}>
          Less than a coffee per day to never answer the same question twice.
        </p>
      </div>
      <div
        className="lp-pricing-grid"
        style={{ display: "flex", gap: 20, justifyContent: "center", alignItems: "stretch" }}
      >
        {tiers.map((t, i) => (
          <div
            key={i}
            className="lp-pricing-card"
            style={{
              flex: 1,
              maxWidth: 300,
              background: t.highlight ? GRADIENT : COLORS.surface,
              borderRadius: 20,
              padding: 36,
              position: "relative",
              border: t.highlight ? "none" : `1px solid ${COLORS.border}`,
              boxShadow: t.highlight ? "0 20px 50px rgba(37,99,235,0.25)" : "none",
            }}
          >
            {t.highlight && (
              <div
                style={{
                  position: "absolute",
                  top: -12,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "#fff",
                  color: COLORS.accent,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "5px 16px",
                  borderRadius: 100,
                  fontFamily: DM,
                  boxShadow: "0 4px 12px rgba(15,23,42,0.12)",
                }}
              >
                Most popular
              </div>
            )}
            <p
              style={{
                fontFamily: DM,
                fontSize: 14,
                fontWeight: 700,
                color: t.highlight ? "rgba(255,255,255,0.8)" : COLORS.muted,
                margin: "0 0 4px",
              }}
            >
              {t.name}
            </p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
              <span
                style={{
                  fontFamily: OUTFIT,
                  fontSize: 44,
                  fontWeight: 800,
                  color: t.highlight ? "#fff" : COLORS.dark,
                  letterSpacing: "-0.03em",
                }}
              >
                {t.price}
              </span>
              <span
                style={{
                  fontFamily: DM,
                  fontSize: 16,
                  fontWeight: 500,
                  color: t.highlight ? "rgba(255,255,255,0.7)" : COLORS.muted,
                }}
              >
                {t.price === "0" ? "" : " kr"}
                {t.period}
              </span>
            </div>
            <p
              style={{
                fontFamily: DM,
                fontSize: 14,
                color: t.highlight ? "rgba(255,255,255,0.7)" : COLORS.muted,
                margin: "0 0 24px",
              }}
            >
              {t.desc}
            </p>
            <Link
              href="/signup"
              style={{
                display: "block",
                width: "100%",
                padding: "14px 0",
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: DM,
                marginBottom: 24,
                transition: "transform 0.15s",
                background: t.highlight ? "#fff" : GRADIENT,
                color: t.highlight ? COLORS.accent : "#fff",
                border: "none",
                textAlign: "center",
                textDecoration: "none",
                boxSizing: "border-box",
                boxShadow: t.highlight ? "none" : "0 6px 16px rgba(37,99,235,0.22)",
              }}
            >
              {t.cta}
            </Link>
            <div>
              {t.features.map((f, j) => (
                <div
                  key={j}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 0",
                    fontSize: 14,
                    fontFamily: DM,
                    color: t.highlight ? "rgba(255,255,255,0.9)" : COLORS.text,
                  }}
                >
                  <span
                    style={{
                      color: t.highlight ? "#fff" : COLORS.accent,
                      fontSize: 15,
                      flexShrink: 0,
                      fontWeight: 700,
                    }}
                  >
                    ✓
                  </span>
                  {f}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const faqs = [
  {
    q: "How long does setup take?",
    a: "About 5 minutes. You add one line of code to your website, and the AI is ready to start learning from your conversations immediately.",
  },
  {
    q: "What if the AI gives a wrong answer?",
    a: "SupportPilot is designed to be cautious. If it's not confident about an answer, it escalates to you instead of guessing. You answer, and it learns the correct response for next time.",
  },
  {
    q: "Do I need to write a knowledge base?",
    a: "You'll need to add some basic info about your business — things like opening hours, shipping policies, and common Q&As. But you don't need to cover everything upfront. When a customer asks something the AI can't answer, it escalates to you. Your reply then gets saved as new knowledge automatically, so the base grows over time without extra work.",
  },
  {
    q: "What languages are supported?",
    a: "English, Swedish, and Arabic (with full right-to-left support) are built in. The AI can understand and respond in any language your customers write in.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. No contracts, no commitment. Cancel from your dashboard at any time. You can also downgrade to the free plan and keep using SupportPilot with limited conversations.",
  },
  {
    q: "What counts as a conversation?",
    a: "A conversation is one customer interaction, regardless of how many messages are exchanged. If a customer asks 5 questions in one chat session, that's 1 conversation.",
  },
];

const FAQ = () => {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section id="faq" style={{ padding: "100px 24px", background: COLORS.bg }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <h2
            style={{
              fontFamily: OUTFIT,
              fontSize: 40,
              fontWeight: 800,
              color: COLORS.dark,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            Questions &amp; answers
          </h2>
        </div>
        {faqs.map((f, i) => (
          <div
            key={i}
            style={{ borderBottom: `1px solid ${COLORS.border}`, cursor: "pointer" }}
            onClick={() => setOpen(open === i ? null : i)}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "20px 0",
              }}
            >
              <h3
                style={{
                  fontFamily: DM,
                  fontSize: 16,
                  fontWeight: 600,
                  color: COLORS.dark,
                  margin: 0,
                }}
              >
                {f.q}
              </h3>
              <span
                style={{
                  fontSize: 22,
                  color: COLORS.accent,
                  fontWeight: 400,
                  transform: open === i ? "rotate(45deg)" : "none",
                  transition: "transform 0.2s",
                  flexShrink: 0,
                  marginLeft: 16,
                }}
              >
                +
              </span>
            </div>
            {open === i && (
              <p
                style={{
                  fontFamily: DM,
                  fontSize: 15,
                  color: COLORS.muted,
                  lineHeight: 1.65,
                  margin: "0 0 20px",
                  paddingRight: 40,
                }}
              >
                {f.a}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

const FinalCTA = () => (
  <section
    style={{
      padding: "100px 24px",
      background: GRADIENT,
      textAlign: "center",
      position: "relative",
      overflow: "hidden",
    }}
  >
    <div
      style={{
        position: "absolute",
        top: -200,
        right: -200,
        width: 500,
        height: 500,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 70%)",
        pointerEvents: "none",
      }}
    />
    <div
      style={{
        position: "absolute",
        bottom: -200,
        left: -200,
        width: 500,
        height: 500,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%)",
        pointerEvents: "none",
      }}
    />
    <div style={{ maxWidth: 600, margin: "0 auto", position: "relative" }}>
      <h2
        style={{
          fontFamily: OUTFIT,
          fontSize: 40,
          fontWeight: 800,
          color: "#fff",
          letterSpacing: "-0.02em",
          margin: "0 0 16px",
        }}
      >
        Ready to stop repeating yourself?
      </h2>
      <p
        style={{
          fontFamily: DM,
          fontSize: 17,
          color: "rgba(255,255,255,0.85)",
          lineHeight: 1.6,
          margin: "0 0 36px",
        }}
      >
        Start with the free plan. No credit card needed. Set up in 5 minutes and let AI handle the
        questions you&apos;re tired of answering.
      </p>
      <Link
        href="/signup"
        style={{
          background: "#fff",
          color: COLORS.accent,
          border: "none",
          borderRadius: 12,
          padding: "16px 40px",
          fontSize: 17,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: DM,
          textDecoration: "none",
          display: "inline-block",
          boxShadow: "0 10px 30px rgba(15,23,42,0.2)",
        }}
      >
        Get started for free
      </Link>
    </div>
  </section>
);

const Footer = () => (
  <footer
    style={{
      padding: "40px 24px",
      background: COLORS.dark,
      borderTop: "1px solid rgba(255,255,255,0.08)",
    }}
  >
    <div
      className="lp-footer-inner"
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <LogoMark size={28} />
        <span
          style={{
            fontFamily: OUTFIT,
            fontWeight: 600,
            fontSize: 14,
            color: "rgba(255,255,255,0.6)",
          }}
        >
          SupportPilot
        </span>
      </div>
      <p
        style={{
          fontFamily: DM,
          fontSize: 13,
          color: "rgba(255,255,255,0.4)",
          margin: 0,
        }}
      >
        © 2026 SupportPilot. All rights reserved.
      </p>
    </div>
  </footer>
);

const RESPONSIVE_CSS = `
  html { scroll-behavior: smooth; }
  @media (max-width: 768px) {
    .lp-nav-link { display: none !important; }
    .lp-nav-right { gap: 12px !important; }
    .lp-hero-title { font-size: 40px !important; }
    .lp-demo-inner { flex-direction: column !important; }
    .lp-demo-side { width: 100% !important; }
    .lp-steps { flex-direction: column !important; }
    .lp-features-grid { grid-template-columns: 1fr !important; }
    .lp-pricing-grid { flex-direction: column !important; align-items: center !important; }
    .lp-pricing-card { width: 100% !important; max-width: 360px !important; }
    .lp-footer-inner { flex-direction: column !important; text-align: center; }
  }
`;

export default function LandingPage() {
  return (
    <div style={{ background: COLORS.bg, minHeight: "100vh" }}>
      <style dangerouslySetInnerHTML={{ __html: RESPONSIVE_CSS }} />
      <NavBar />
      <Hero />
      <HowItWorks />
      <Features />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
}
