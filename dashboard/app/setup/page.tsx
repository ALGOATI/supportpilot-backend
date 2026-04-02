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

type MenuRow = {
  name: string;
  price: string;
  description: string;
  category: string;
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
  const [menuItems, setMenuItems] = useState<MenuRow[]>([]);

  const [bookingRequired, setBookingRequired] = useState(true);
  const [maxPartySize, setMaxPartySize] = useState("");
  const [advanceNoticeMinutes, setAdvanceNoticeMinutes] = useState("");

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

  async function saveMenuStep() {
    const token = await getTokenOrRedirect();
    if (!token) return;

    const resp = await fetch(`${backendUrl}/api/setup/menu`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ items: menuItems }),
    });

    if (!resp.ok) {
      const json = await resp.json().catch(() => null);
      throw new Error(json?.error || "Failed to save menu items");
    }
  }

  async function saveBookingRulesAndComplete() {
    const token = await getTokenOrRedirect();
    if (!token) return;

    const resp = await fetch(`${backendUrl}/api/setup/booking-rules`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        booking_required: bookingRequired,
        max_party_size: maxPartySize.trim() ? Number(maxPartySize) : null,
        advance_notice_minutes: advanceNoticeMinutes.trim()
          ? Number(advanceNoticeMinutes)
          : null,
      }),
    });

    if (!resp.ok) {
      const json = await resp.json().catch(() => null);
      throw new Error(json?.error || "Failed to save booking rules");
    }
  }

  async function onNext() {
    setError(null);
    setSubmitting(true);
    try {
      if (step === 1) {
        setStep(2);
      } else if (step === 2) {
        await saveBusinessStep();
        setStep(3);
      } else if (step === 3) {
        await saveHoursStep();
        setStep(4);
      } else if (step === 4) {
        await saveMenuStep();
        setStep(5);
      } else {
        await saveBookingRulesAndComplete();
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  function addMenuRow() {
    setMenuItems((prev) => [...prev, { name: "", price: "", description: "", category: "" }]);
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
              Step {step} of 5
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
            <h2 style={{ marginTop: 0, marginBottom: 14 }}>Step 1: Business info</h2>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Business name</span>
                <input style={inputStyle} value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
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
          </section>
        ) : null}

        {step === 2 ? (
          <section style={cardStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 14 }}>Step 2: Select business type</h2>
            <p style={{ marginTop: 0, color: "#475569" }}>
              We use this template to optimize AI behavior from day one.
            </p>
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
          </section>
        ) : null}

        {step === 3 ? (
          <section style={cardStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 14 }}>Step 3: Opening hours</h2>
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

        {step === 4 ? (
          <section style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <h2 style={{ margin: 0 }}>Step 4: Menu (optional)</h2>
              <button
                type="button"
                onClick={addMenuRow}
                style={{
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  color: "#0f172a",
                  borderRadius: 10,
                  padding: "8px 12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Add item
              </button>
            </div>

            {menuItems.length === 0 ? (
              <p style={{ color: "#64748b" }}>No items added yet. You can continue and add later.</p>
            ) : (
              <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                {menuItems.map((row, idx) => (
                  <div
                    key={`menu-row-${idx}`}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      padding: 10,
                      display: "grid",
                      gridTemplateColumns: "2fr 1fr 2fr 1fr auto",
                      gap: 8,
                    }}
                  >
                    <input
                      style={inputStyle}
                      placeholder="Name"
                      value={row.name}
                      onChange={(e) => {
                        const next = [...menuItems];
                        next[idx] = { ...next[idx], name: e.target.value };
                        setMenuItems(next);
                      }}
                    />
                    <input
                      style={inputStyle}
                      placeholder="Price"
                      value={row.price}
                      onChange={(e) => {
                        const next = [...menuItems];
                        next[idx] = { ...next[idx], price: e.target.value };
                        setMenuItems(next);
                      }}
                    />
                    <input
                      style={inputStyle}
                      placeholder="Description"
                      value={row.description}
                      onChange={(e) => {
                        const next = [...menuItems];
                        next[idx] = { ...next[idx], description: e.target.value };
                        setMenuItems(next);
                      }}
                    />
                    <input
                      style={inputStyle}
                      placeholder="Category"
                      value={row.category}
                      onChange={(e) => {
                        const next = [...menuItems];
                        next[idx] = { ...next[idx], category: e.target.value };
                        setMenuItems(next);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setMenuItems((prev) => prev.filter((_, i) => i !== idx))}
                      style={{
                        border: "1px solid #fecaca",
                        color: "#b91c1c",
                        background: "#fff5f5",
                        borderRadius: 10,
                        padding: "8px 10px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {step === 5 ? (
          <section style={cardStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 14 }}>Step 5: Booking rules (optional)</h2>
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={bookingRequired}
                  onChange={(e) => setBookingRequired(e.target.checked)}
                />
                Booking required
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Max party size</span>
                <input
                  style={inputStyle}
                  placeholder="Optional"
                  value={maxPartySize}
                  onChange={(e) => setMaxPartySize(e.target.value)}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Advance notice (minutes)</span>
                <input
                  style={inputStyle}
                  placeholder="Optional"
                  value={advanceNoticeMinutes}
                  onChange={(e) => setAdvanceNoticeMinutes(e.target.value)}
                />
              </label>
            </div>
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
            {submitting ? "Saving..." : step === 5 ? "Finish setup" : "Save and continue"}
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
