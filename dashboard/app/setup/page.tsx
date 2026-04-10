"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getBackendUrl } from "@/lib/backend-url";

type HourRow = {
  day_of_week: number;
  is_closed: boolean;
  open_time: string;
  close_time: string;
};

const dayRows: Array<{ label: string; day_of_week: number }> = [
  { label: "Monday", day_of_week: 1 },
  { label: "Tuesday", day_of_week: 2 },
  { label: "Wednesday", day_of_week: 3 },
  { label: "Thursday", day_of_week: 4 },
  { label: "Friday", day_of_week: 5 },
  { label: "Saturday", day_of_week: 6 },
  { label: "Sunday", day_of_week: 0 },
];

function defaultHours(): HourRow[] {
  return dayRows.map((d) => ({
    day_of_week: d.day_of_week,
    is_closed: false,
    open_time: "09:00",
    close_time: "17:00",
  }));
}

const cardStyle: React.CSSProperties = {
  border: "1px solid #d7deea",
  borderRadius: 14,
  padding: 18,
  background: "#ffffff",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 14,
  background: "#fff",
  color: "#0f172a",
};

export default function SetupPage() {
  const router = useRouter();
  const backendUrl = useMemo(() => getBackendUrl(), []);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("other");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState("Europe/Stockholm");

  const [hours, setHours] = useState<HourRow[]>(defaultHours());

  // WhatsApp state
  const [waPhoneNumberId, setWaPhoneNumberId] = useState("");
  const [waWabaId, setWaWabaId] = useState("");
  const [waAccessToken, setWaAccessToken] = useState("");
  const [waConnected, setWaConnected] = useState(false);
  const [waStatus, setWaStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!userData.user) {
        router.push("/login");
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;
      const token = sessionData.session?.access_token;
      if (!token) {
        router.push("/login");
        return;
      }

      try {
        const setupResp = await fetch(`${backendUrl}/api/setup/status`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (cancelled) return;
        if (setupResp.ok) {
          const setupJson = await setupResp.json();
          if (setupJson?.completed) {
            router.push("/dashboard");
            return;
          }
        }
      } catch {
        // keep user on setup if status endpoint fails
      }

      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [backendUrl, router]);

  async function getTokenOrRedirect() {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      router.push("/login");
      return null;
    }
    return token;
  }

  async function skipSetupForNow() {
    setError(null);
    setSubmitting(true);
    try {
      const token = await getTokenOrRedirect();
      if (!token) return;

      const resp = await fetch(`${backendUrl}/api/setup/skip`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!resp.ok) {
        const json = await resp.json().catch(() => null);
        throw new Error(json?.error || "Failed to skip setup");
      }

      router.push("/dashboard");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to skip setup";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function saveBusinessStep() {
    const token = await getTokenOrRedirect();
    if (!token) return;

    const resp = await fetch(`${backendUrl}/api/setup/business`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        business_name: businessName,
        business_type: businessType,
        address,
        phone,
        timezone,
      }),
    });

    if (!resp.ok) {
      const json = await resp.json().catch(() => null);
      throw new Error(json?.error || "Failed to save business info");
    }
  }

  async function saveHoursStep() {
    const token = await getTokenOrRedirect();
    if (!token) return;

    const resp = await fetch(`${backendUrl}/api/setup/hours`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ hours }),
    });

    if (!resp.ok) {
      const json = await resp.json().catch(() => null);
      throw new Error(json?.error || "Failed to save opening hours");
    }
  }

  async function connectWhatsApp() {
    const token = await getTokenOrRedirect();
    if (!token) return;

    if (!waPhoneNumberId.trim() || !waWabaId.trim() || !waAccessToken.trim()) {
      throw new Error("All three WhatsApp fields are required");
    }

    const resp = await fetch(`${backendUrl}/api/integrations/whatsapp/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        phone_number_id: waPhoneNumberId.trim(),
        waba_id: waWabaId.trim(),
        access_token: waAccessToken.trim(),
      }),
    });

    const json = await resp.json();
    if (resp.ok && json.ok) {
      setWaConnected(true);
      setWaAccessToken("");
      setWaStatus("Connected successfully");
    } else {
      throw new Error(json.error || "WhatsApp connection failed");
    }
  }

  async function onNext() {
    setError(null);
    setSubmitting(true);
    try {
      if (step === 1) {
        await saveBusinessStep();
        setStep(2);
      } else if (step === 2) {
        await saveHoursStep();
        setStep(3);
      } else {
        // Step 3: WhatsApp — connect if fields filled, then finish
        if (waPhoneNumberId.trim() && waWabaId.trim() && waAccessToken.trim()) {
          await connectWhatsApp();
        }
        // Mark setup complete via skip endpoint (it marks onboarding_completed)
        const token = await getTokenOrRedirect();
        if (!token) return;
        await fetch(`${backendUrl}/api/setup/skip`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#0f172a" }}>
        Loading setup...
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f8fbff 0%, #eef3f8 100%)",
        padding: "32px 16px",
      }}
    >
      <div style={{ maxWidth: 860, margin: "0 auto", display: "grid", gap: 14 }}>
        <div style={{ ...cardStyle, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, color: "#0f172a" }}>Setup wizard</h1>
            <p style={{ margin: "6px 0 0", color: "#475569" }}>
              Step {step} of 3
            </p>
          </div>
          <button
            type="button"
            onClick={() => void skipSetupForNow()}
            disabled={submitting}
            style={{
              border: "1px solid #cbd5e1",
              background: submitting ? "#f1f5f9" : "#fff",
              color: "#0f172a",
              borderRadius: 10,
              padding: "9px 12px",
              fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Please wait..." : "Skip for now"}
          </button>
        </div>

        {step === 1 ? (
          <section style={cardStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 14 }}>Step 1: Business profile</h2>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Business name</span>
                <input style={inputStyle} value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Business type</span>
                <select
                  style={inputStyle}
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                >
                  <option value="restaurant">Restaurant</option>
                  <option value="barber">Barber</option>
                  <option value="clinic">Clinic</option>
                  <option value="retail">Retail</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Address</span>
                <input style={inputStyle} value={address} onChange={(e) => setAddress(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Phone</span>
                <input style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Timezone</span>
                <input style={inputStyle} value={timezone} onChange={(e) => setTimezone(e.target.value)} />
              </label>
            </div>
            <p style={{ marginTop: 10, color: "#475569", fontSize: 13 }}>
              We use the business type to optimize AI behavior from day one.
            </p>
          </section>
        ) : null}

        {step === 2 ? (
          <section style={cardStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 14 }}>Step 2: Opening hours</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {hours.map((row, idx) => (
                <div
                  key={row.day_of_week}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "130px 120px 1fr 1fr",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <strong>{dayRows[idx].label}</strong>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={row.is_closed}
                      onChange={(e) => {
                        const next = [...hours];
                        next[idx] = { ...next[idx], is_closed: e.target.checked };
                        setHours(next);
                      }}
                    />
                    Closed
                  </label>
                  <input
                    type="time"
                    style={inputStyle}
                    disabled={row.is_closed}
                    value={row.open_time}
                    onChange={(e) => {
                      const next = [...hours];
                      next[idx] = { ...next[idx], open_time: e.target.value };
                      setHours(next);
                    }}
                  />
                  <input
                    type="time"
                    style={inputStyle}
                    disabled={row.is_closed}
                    value={row.close_time}
                    onChange={(e) => {
                      const next = [...hours];
                      next[idx] = { ...next[idx], close_time: e.target.value };
                      setHours(next);
                    }}
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section style={cardStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 14 }}>Step 3: Connect WhatsApp</h2>
            <p style={{ marginTop: 0, color: "#475569", fontSize: 13 }}>
              Connect your WhatsApp Business account so customers can reach you. You can also set this up later from the Integrations page.
            </p>

            {waConnected ? (
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 10,
                  background: "#dcfce7",
                  border: "1px solid #bbf7d0",
                  color: "#166534",
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                WhatsApp connected successfully
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>Phone Number ID</span>
                  <input
                    type="text"
                    value={waPhoneNumberId}
                    onChange={(e) => setWaPhoneNumberId(e.target.value)}
                    placeholder="e.g. 123456789012345"
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>WhatsApp Business Account ID</span>
                  <input
                    type="text"
                    value={waWabaId}
                    onChange={(e) => setWaWabaId(e.target.value)}
                    placeholder="e.g. 109876543210"
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>Permanent Access Token</span>
                  <input
                    type="password"
                    value={waAccessToken}
                    onChange={(e) => setWaAccessToken(e.target.value)}
                    placeholder="Paste your token here"
                    style={inputStyle}
                  />
                </label>
              </div>
            )}

            {waStatus && (
              <div style={{ marginTop: 8, fontWeight: 700, fontSize: 13, color: "#166534" }}>
                {waStatus}
              </div>
            )}
          </section>
        ) : null}

        <div style={{ ...cardStyle, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            disabled={submitting || step === 1}
            onClick={() => setStep((prev) => Math.max(1, prev - 1))}
            style={{
              border: "1px solid #cbd5e1",
              background: step === 1 ? "#f8fafc" : "#fff",
              color: "#0f172a",
              borderRadius: 10,
              padding: "10px 14px",
              fontWeight: 700,
              cursor: step === 1 ? "not-allowed" : "pointer",
            }}
          >
            Back
          </button>

          <button
            type="button"
            disabled={submitting}
            onClick={() => void onNext()}
            style={{
              border: "1px solid #1d4ed8",
              background: "#1d4ed8",
              color: "white",
              borderRadius: 10,
              padding: "10px 14px",
              fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Saving..." : step === 3 ? "Finish setup" : "Save and continue"}
          </button>
        </div>

        {error ? (
          <div
            style={{
              ...cardStyle,
              borderColor: "#fecaca",
              background: "#fff7f7",
              color: "#b91c1c",
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
