"use client";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { getBackendUrl } from "@/lib/backend-url";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");

    if (!code) {
      router.replace("/login");
      return;
    }

    supabase.auth.exchangeCodeForSession(code).then(async ({ error }) => {
      if (error) {
        router.replace("/login");
        return;
      }

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (token) {
          const backendUrl = getBackendUrl();
          const setupResp = await fetch(`${backendUrl}/api/setup/status`, {
            cache: "no-store",
            headers: { Authorization: `Bearer ${token}` },
          });
          if (setupResp.ok) {
            const setupJson = await setupResp.json();
            router.replace(setupJson?.completed ? "/dashboard" : "/setup");
            return;
          }
        }
      } catch {
        // fall through to dashboard
      }

      router.replace("/dashboard");
    });
  }, [router]);

  return (
    <div style={{ maxWidth: 400, margin: "80px auto", textAlign: "center", color: "#6b7280" }}>
      <p>Signing you in…</p>
    </div>
  );
}
