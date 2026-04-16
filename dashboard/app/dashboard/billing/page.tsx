"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getBackendUrl } from "@/lib/backend-url";
import { DashboardLanguage, t, isRtlLanguage } from "@/lib/i18n";
import { useDashboardLanguage } from "@/lib/useDashboardLanguage";

type PlanId = "free" | "starter" | "pro";

type PlanCard = {
  id: PlanId;
  priceLabel: string;
  envKey: string;
  priceId: string | undefined;
};

const PLANS: PlanCard[] = [
  { id: "free", priceLabel: "0 SEK", envKey: "", priceId: undefined },
  {
    id: "starter",
    priceLabel: "299 SEK / mo",
    envKey: "NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID",
    priceId: process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID,
  },
  {
    id: "pro",
    priceLabel: "599 SEK / mo",
    envKey: "NEXT_PUBLIC_STRIPE_PRO_PRICE_ID",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID,
  },
];

export default function BillingPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32 }}>Loading…</div>}>
      <BillingPageInner />
    </Suspense>
  );
}

function BillingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { language } = useDashboardLanguage();
  const lang = (language || "english") as DashboardLanguage;
  const tr = (key: string) => t(lang, key);
  const isRtl = isRtlLanguage(lang);

  const [currentPlan, setCurrentPlan] = useState<PlanId | "business" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [hasCustomer, setHasCustomer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flash = useMemo(() => {
    const s = searchParams.get("status");
    if (s === "success") return { kind: "success", text: tr("billing_checkout_success") };
    if (s === "cancelled") return { kind: "info", text: tr("billing_checkout_cancelled") };
    return null;
  }, [searchParams, lang]);

  const loadState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        router.replace("/login");
        return;
      }

      const { data, error: fetchError } = await supabase
        .from("client_settings")
        .select("plan, subscription_status, stripe_customer_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (fetchError) throw fetchError;

      setCurrentPlan((data?.plan as PlanId | "business") || "free");
      setStatus(data?.subscription_status || "active");
      setHasCustomer(Boolean(data?.stripe_customer_id));
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message || "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  async function authHeaders(): Promise<Record<string, string>> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function startCheckout(priceId: string | undefined, planId: PlanId) {
    if (!priceId) {
      setError(`Missing Stripe price ID for ${planId}. Configure the env var.`);
      return;
    }
    setActionLoading(planId);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${getBackendUrl()}/api/stripe/create-checkout-session`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "Checkout failed");
      if (payload.url) {
        window.location.href = payload.url;
        return;
      }
      throw new Error("Checkout session missing URL");
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message || "Checkout failed");
      setActionLoading(null);
    }
  }

  async function openPortal() {
    setActionLoading("portal");
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${getBackendUrl()}/api/stripe/create-portal-session`, {
        method: "POST",
        headers,
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "Portal failed");
      if (payload.url) {
        window.location.href = payload.url;
        return;
      }
      throw new Error("Portal session missing URL");
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message || "Portal failed");
      setActionLoading(null);
    }
  }

  return (
    <div dir={isRtl ? "rtl" : "ltr"} style={{ padding: 32, maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>{tr("billing_title")}</h1>
      <p style={{ color: "#64748b", marginTop: 8 }}>{tr("billing_subtitle")}</p>

      {flash && (
        <div
          style={{
            marginTop: 20,
            padding: "12px 16px",
            borderRadius: 10,
            background: flash.kind === "success" ? "#ecfdf5" : "#eff6ff",
            border: flash.kind === "success" ? "1px solid #a7f3d0" : "1px solid #bfdbfe",
            color: flash.kind === "success" ? "#065f46" : "#1e40af",
            fontWeight: 600,
          }}
        >
          {flash.text}
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 20,
            padding: "12px 16px",
            borderRadius: 10,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#dc2626",
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          marginTop: 24,
          padding: 20,
          borderRadius: 14,
          background: "white",
          border: "1px solid #e2e8f0",
        }}
      >
        <div style={{ fontSize: 13, color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>
          {tr("billing_current_plan")}
        </div>
        <div style={{ marginTop: 6, fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
          {loading ? "…" : (currentPlan || "free").toUpperCase()}
          {status && status !== "active" ? (
            <span style={{ marginLeft: 8, fontSize: 13, color: "#b45309" }}>
              ({status})
            </span>
          ) : null}
        </div>
        {hasCustomer && (
          <button
            type="button"
            onClick={openPortal}
            disabled={actionLoading === "portal"}
            style={{
              marginTop: 12,
              padding: "10px 16px",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              background: "white",
              color: "#0f172a",
              fontWeight: 600,
              cursor: actionLoading === "portal" ? "not-allowed" : "pointer",
            }}
          >
            {actionLoading === "portal" ? tr("sending") : tr("billing_manage")}
          </button>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
          marginTop: 24,
        }}
      >
        {PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.id;
          return (
            <div
              key={plan.id}
              style={{
                padding: 20,
                borderRadius: 14,
                background: "white",
                border: isCurrent ? "2px solid #2563eb" : "1px solid #e2e8f0",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700 }}>{tr(`plan_${plan.id}_name`)}</div>
              <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{plan.priceLabel}</div>
              <p style={{ color: "#64748b", marginTop: 10, fontSize: 14, lineHeight: 1.5 }}>
                {tr(`plan_${plan.id}_desc`)}
              </p>

              <div style={{ marginTop: 16 }}>
                {plan.id === "free" ? (
                  <button
                    type="button"
                    disabled
                    style={{
                      width: "100%",
                      padding: "10px 16px",
                      borderRadius: 10,
                      border: "1px solid #e2e8f0",
                      background: "#f8fafc",
                      color: "#94a3b8",
                      fontWeight: 600,
                    }}
                  >
                    {isCurrent ? tr("billing_current") : tr("billing_included")}
                  </button>
                ) : isCurrent ? (
                  <button
                    type="button"
                    onClick={openPortal}
                    disabled={actionLoading === "portal"}
                    style={{
                      width: "100%",
                      padding: "10px 16px",
                      borderRadius: 10,
                      border: "1px solid #2563eb",
                      background: "#eff6ff",
                      color: "#1e40af",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {tr("billing_manage")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => startCheckout(plan.priceId, plan.id)}
                    disabled={actionLoading === plan.id}
                    style={{
                      width: "100%",
                      padding: "10px 16px",
                      borderRadius: 10,
                      border: "none",
                      background: "linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)",
                      color: "white",
                      fontWeight: 700,
                      cursor: actionLoading === plan.id ? "not-allowed" : "pointer",
                    }}
                  >
                    {actionLoading === plan.id ? tr("sending") : tr("billing_upgrade")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
