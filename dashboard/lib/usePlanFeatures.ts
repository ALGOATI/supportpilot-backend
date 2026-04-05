"use client";

import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { getBackendUrl } from "./backend-url";

export interface PlanFeatures {
  tier: string;
  features: Record<string, boolean>;
  limits: {
    maxMessages: number;
    maxKnowledge: number;
    maxWhatsappNumbers: number;
  };
  loading: boolean;
}

const DEFAULT_STATE: PlanFeatures = {
  tier: "starter",
  features: {},
  limits: { maxMessages: 1000, maxKnowledge: 30, maxWhatsappNumbers: 1 },
  loading: true,
};

export function usePlanFeatures(): PlanFeatures {
  const [data, setData] = useState<PlanFeatures>(DEFAULT_STATE);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) {
        if (!cancelled) setData((prev) => ({ ...prev, loading: false }));
        return;
      }

      try {
        const res = await fetch(`${getBackendUrl()}/api/plan/features`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && !cancelled) {
          const json = await res.json();
          setData({ ...json, loading: false });
        } else if (!cancelled) {
          setData((prev) => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) setData((prev) => ({ ...prev, loading: false }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}
