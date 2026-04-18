"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import LandingPage from "./_components/LandingPage";

export default function RootPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "landing">("loading");

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) {
        router.replace("/dashboard");
      } else {
        setStatus("landing");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (status === "loading") {
    return <div style={{ minHeight: "100vh", background: "#FAFAF8" }} />;
  }

  return <LandingPage />;
}
