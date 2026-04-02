"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { DashboardLanguage, isRtlLanguage, t } from "@/lib/i18n";

export function useDashboardLanguage() {
  const [language, setLanguage] = useState<DashboardLanguage>("english");

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { data, error } = await supabase
        .from("client_settings")
        .select("dashboard_language")
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (error) return;

      const raw = String((data as { dashboard_language?: string } | null)?.dashboard_language || "")
        .trim()
        .toLowerCase();
      if (raw === "english" || raw === "swedish" || raw === "arabic") {
        setLanguage(raw);
      }
    })();
  }, []);

  const dir = useMemo(() => (isRtlLanguage(language) ? "rtl" : "ltr"), [language]);
  const tr = useMemo(() => (key: string) => t(language, key), [language]);

  async function saveDashboardLanguage(nextLanguage: DashboardLanguage) {
    setLanguage(nextLanguage);

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    await supabase.from("client_settings").upsert(
      {
        user_id: userData.user.id,
        dashboard_language: nextLanguage,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  }

  return {
    language,
    setLanguage,
    saveDashboardLanguage,
    dir,
    tr,
  };
}
