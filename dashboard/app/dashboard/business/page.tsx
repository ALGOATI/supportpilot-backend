"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import DashboardShell from "../_components/DashboardShell";
import KnowledgeBaseSection from "../_components/KnowledgeBaseSection";
import { getBackendUrl } from "@/lib/backend-url";

type TabKey =
  | "profile"
  | "hours"
  | "menu"
  | "faqs"
  | "booking"
  | "knowledge";

type HourRow = {
  id?: string;
  day_of_week: number;
  is_closed: boolean;
  open_time: string;
  close_time: string;
};

type MenuItemRow = {
  id?: string;
  name: string;
  price: string;
  description: string;
  category: string;
  available: boolean;
  tags: string;
};

type FaqRow = {
  id?: string;
  question: string;
  answer: string;
};

type ImportedMenuItem = {
  name: string;
  price: string;
  description: string;
  category: string;
};

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "2px solid #d1d5db",
  background: "#ffffff",
  color: "#111827",
  fontSize: 14,
};

const areaStyle: React.CSSProperties = {
  ...fieldStyle,
  minHeight: 92,
  resize: "vertical",
};

const saveBtnStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid rgba(0,0,0,0.15)",
  background: "white",
  cursor: "pointer",
  fontWeight: 700,
};

function defaultHours(): HourRow[] {
  return DAY_NAMES.map((_, day) => ({
    day_of_week: day,
    is_closed: false,
    open_time: "09:00",
    close_time: "17:00",
  }));
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function getMenuTabLabel(businessType: string): string {
  switch (businessType) {
    case "restaurant":
      return "Menu";
    case "barber":
    case "clinic":
      return "Services";
    case "retail":
      return "Products";
    default:
      return "Services";
  }
}

const VALID_TABS: TabKey[] = ["profile", "hours", "menu", "faqs", "booking", "knowledge"];
const TAB_STORAGE_KEY = "sp_business_tab";

export default function BusinessSetupPage() {
  const router = useRouter();
  const BACKEND_URL = useMemo(() => getBackendUrl(), []);

  // Resolve initial tab from URL > localStorage > default
  const initialTab = useMemo(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlTab = params.get("tab") as TabKey | null;
      if (urlTab && VALID_TABS.includes(urlTab)) return urlTab;
      const stored = localStorage.getItem(TAB_STORAGE_KEY) as TabKey | null;
      if (stored && VALID_TABS.includes(stored)) return stored;
    }
    return "profile" as TabKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Profile state
  const [businessName, setBusinessName] = useState("");
  const [niche, setNiche] = useState("generic");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("Europe/Stockholm");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);

  // Hours state
  const [hours, setHours] = useState<HourRow[]>(defaultHours());
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursStatus, setHoursStatus] = useState<string | null>(null);

  // Menu state
  const [menuItems, setMenuItems] = useState<MenuItemRow[]>([]);
  const [deletedMenuIds, setDeletedMenuIds] = useState<string[]>([]);
  const [importingPhoto, setImportingPhoto] = useState(false);
  const [savingImported, setSavingImported] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importItems, setImportItems] = useState<ImportedMenuItem[]>([]);
  const [menuSaving, setMenuSaving] = useState(false);
  const [menuStatus, setMenuStatus] = useState<string | null>(null);

  // FAQs state
  const [faqs, setFaqs] = useState<FaqRow[]>([]);
  const [deletedFaqIds, setDeletedFaqIds] = useState<string[]>([]);
  const [faqsSaving, setFaqsSaving] = useState(false);
  const [faqsStatus, setFaqsStatus] = useState<string | null>(null);

  // Booking state
  const [bookingEnabled, setBookingEnabled] = useState(true);
  const [requireName, setRequireName] = useState(true);
  const [requirePhone, setRequirePhone] = useState(true);
  const [maxPartySize, setMaxPartySize] = useState("");
  const [bookingSaving, setBookingSaving] = useState(false);
  const [bookingStatus, setBookingStatus] = useState<string | null>(null);

  function switchTab(tab: TabKey) {
    setActiveTab(tab);
    localStorage.setItem(TAB_STORAGE_KEY, tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url.toString());
  }

  const hasMenuItems = useMemo(() => {
    return menuItems.some((item) => String(item.name || "").trim());
  }, [menuItems]);

  // Derive business type from niche for conditional UI
  const businessType = niche;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;
      const user = userData.user;

      if (!user) {
        router.push("/login");
        return;
      }

      setUserId(user.id);

      const [profileRes, hoursRes, menuRes, faqRes, rulesRes] = await Promise.all([
        supabase
          .from("business_profiles")
          .select("business_name,niche,phone,address,timezone")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("business_hours")
          .select("id,day_of_week,is_closed,open_time,close_time")
          .eq("user_id", user.id),
        supabase
          .from("menu_items")
          .select("id,name,price,description,category,available,tags")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false }),
        supabase
          .from("faqs")
          .select("id,question,answer")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false }),
        supabase
          .from("booking_rules")
          .select("booking_enabled,require_name,require_phone,max_party_size")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      if (profileRes.error) console.error(profileRes.error);
      if (hoursRes.error) console.error(hoursRes.error);
      if (menuRes.error) console.error(menuRes.error);
      if (faqRes.error) console.error(faqRes.error);
      if (rulesRes.error) console.error(rulesRes.error);

      if (profileRes.data) {
        setBusinessName(profileRes.data.business_name ?? "");
        setNiche(profileRes.data.niche ?? "generic");
        setPhone(profileRes.data.phone ?? "");
        setAddress(profileRes.data.address ?? "");
        setTimezone(profileRes.data.timezone ?? "Europe/Stockholm");
      }

      const loadedHours = Array.isArray(hoursRes.data) ? hoursRes.data : [];
      const hoursByDay = new Map<number, HourRow>();
      for (const row of loadedHours) {
        hoursByDay.set(Number(row.day_of_week), {
          id: row.id,
          day_of_week: Number(row.day_of_week),
          is_closed: Boolean(row.is_closed),
          open_time: row.open_time ?? "",
          close_time: row.close_time ?? "",
        });
      }

      setHours(
        DAY_NAMES.map(
          (_, day) =>
            hoursByDay.get(day) || {
              day_of_week: day,
              is_closed: false,
              open_time: "09:00",
              close_time: "17:00",
            }
        )
      );

      setMenuItems(
        (menuRes.data || []).map((row) => ({
          id: row.id,
          name: row.name ?? "",
          price: row.price === null || row.price === undefined ? "" : String(row.price),
          description: row.description ?? "",
          category: row.category ?? "",
          available: row.available ?? true,
          tags: Array.isArray(row.tags) ? row.tags.join(", ") : "",
        }))
      );

      setFaqs(
        (faqRes.data || []).map((row) => ({
          id: row.id,
          question: row.question ?? "",
          answer: row.answer ?? "",
        }))
      );

      if (rulesRes.data) {
        setBookingEnabled(rulesRes.data.booking_enabled ?? true);
        setRequireName(rulesRes.data.require_name ?? true);
        setRequirePhone(rulesRes.data.require_phone ?? true);
        setMaxPartySize(
          rulesRes.data.max_party_size === null || rulesRes.data.max_party_size === undefined
            ? ""
            : String(rulesRes.data.max_party_size)
        );
      }

      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [router]);

  // --- Per-tab save functions ---

  async function saveProfile() {
    if (!userId) return;
    setProfileSaving(true);
    setProfileStatus(null);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("business_profiles")
        .upsert({
          user_id: userId,
          business_name: businessName || null,
          niche: niche || "generic",
          phone: phone || null,
          address: address || null,
          timezone: timezone || "Europe/Stockholm",
          updated_at: now,
        }, { onConflict: "user_id" });
      if (error) throw error;
      setProfileStatus("Profile saved.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setProfileStatus(`Save failed: ${message}`);
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveHours() {
    if (!userId) return;
    setHoursSaving(true);
    setHoursStatus(null);
    try {
      const now = new Date().toISOString();
      const hoursPayload = hours.map((row) => ({
        user_id: userId,
        day_of_week: row.day_of_week,
        is_closed: row.is_closed,
        open_time: row.is_closed ? null : row.open_time || null,
        close_time: row.is_closed ? null : row.close_time || null,
        updated_at: now,
      }));
      const { error } = await supabase
        .from("business_hours")
        .upsert(hoursPayload, { onConflict: "user_id,day_of_week" });
      if (error) throw error;
      setHoursStatus("Hours saved.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setHoursStatus(`Save failed: ${message}`);
    } finally {
      setHoursSaving(false);
    }
  }

  async function saveMenu() {
    if (!userId) return;
    setMenuSaving(true);
    setMenuStatus(null);
    try {
      const now = new Date().toISOString();
      const normalizedMenu = menuItems
        .map((item) => ({ ...item, name: String(item.name || "").trim() }))
        .filter((item) => item.name);

      if (deletedMenuIds.length) {
        const deleteRes = await supabase
          .from("menu_items")
          .delete()
          .eq("user_id", userId)
          .in("id", deletedMenuIds);
        if (deleteRes.error) throw deleteRes.error;
      }

      const menuUpdates = normalizedMenu
        .filter((item) => item.id)
        .map((item) => ({
          id: item.id,
          user_id: userId,
          name: item.name,
          price: item.price.trim() ? Number(item.price) : null,
          description: item.description || null,
          category: item.category || null,
          available: item.available,
          tags: item.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          updated_at: now,
        }));

      const menuInserts = normalizedMenu
        .filter((item) => !item.id)
        .map((item) => ({
          user_id: userId,
          name: item.name,
          price: item.price.trim() ? Number(item.price) : null,
          description: item.description || null,
          category: item.category || null,
          available: item.available,
          tags: item.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          updated_at: now,
        }));

      if (menuUpdates.length) {
        const res = await supabase.from("menu_items").upsert(menuUpdates, { onConflict: "id" });
        if (res.error) throw res.error;
      }
      if (menuInserts.length) {
        const res = await supabase.from("menu_items").insert(menuInserts);
        if (res.error) throw res.error;
      }

      setDeletedMenuIds([]);
      setMenuStatus(`${getMenuTabLabel(businessType)} saved.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setMenuStatus(`Save failed: ${message}`);
    } finally {
      setMenuSaving(false);
    }
  }

  async function saveFaqs() {
    if (!userId) return;
    setFaqsSaving(true);
    setFaqsStatus(null);
    try {
      const now = new Date().toISOString();
      const normalizedFaqs = faqs
        .map((row) => ({
          ...row,
          question: String(row.question || "").trim(),
          answer: String(row.answer || "").trim(),
        }))
        .filter((row) => row.question && row.answer);

      if (deletedFaqIds.length) {
        const res = await supabase
          .from("faqs")
          .delete()
          .eq("user_id", userId)
          .in("id", deletedFaqIds);
        if (res.error) throw res.error;
      }

      const faqUpdates = normalizedFaqs
        .filter((row) => row.id)
        .map((row) => ({
          id: row.id,
          user_id: userId,
          question: row.question,
          answer: row.answer,
          updated_at: now,
        }));

      const faqInserts = normalizedFaqs
        .filter((row) => !row.id)
        .map((row) => ({
          user_id: userId,
          question: row.question,
          answer: row.answer,
          updated_at: now,
        }));

      if (faqUpdates.length) {
        const res = await supabase.from("faqs").upsert(faqUpdates, { onConflict: "id" });
        if (res.error) throw res.error;
      }
      if (faqInserts.length) {
        const res = await supabase.from("faqs").insert(faqInserts);
        if (res.error) throw res.error;
      }

      setDeletedFaqIds([]);
      setFaqsStatus("FAQs saved.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setFaqsStatus(`Save failed: ${message}`);
    } finally {
      setFaqsSaving(false);
    }
  }

  async function saveBookingRules() {
    if (!userId) return;
    setBookingSaving(true);
    setBookingStatus(null);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("booking_rules")
        .upsert({
          user_id: userId,
          booking_enabled: bookingEnabled,
          require_name: requireName,
          require_phone: requirePhone,
          max_party_size: maxPartySize.trim() ? Number(maxPartySize) : null,
          updated_at: now,
        }, { onConflict: "user_id" });
      if (error) throw error;
      setBookingStatus("Booking rules saved.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setBookingStatus(`Save failed: ${message}`);
    } finally {
      setBookingSaving(false);
    }
  }

  // --- Menu photo import ---

  async function importMenuFromPhoto(file: File) {
    if (!userId || !file) return;
    setImportError(null);

    const MAX_FILE_SIZE = 2 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      setImportError("Image must be under 2MB. Please compress it first.");
      return;
    }

    setImportingPhoto(true);

    try {
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) throw new Error(sessionErr.message);
      const token = sessionData.session?.access_token;
      if (!token) {
        router.push("/login");
        return;
      }
      const imageDataUrl = await fileToDataUrl(file);

      const resp = await fetch(`${BACKEND_URL}/api/menu/import-photo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId, imageDataUrl }),
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error(data?.error || "Could not extract menu. Try another photo.");
      }

      const items: Record<string, unknown>[] = Array.isArray(data?.items) ? data.items : [];
      const nextItems: ImportedMenuItem[] = items.map((item: Record<string, unknown>) => {
        const safe = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        return {
          name: String(safe.name || ""),
          price: safe.price === null || safe.price === undefined || safe.price === "" ? "" : String(safe.price),
          description: String(safe.description || ""),
          category: String(safe.category || ""),
        };
      });
      setImportItems(nextItems);
    } catch (err: unknown) {
      console.error(err);
      setImportError("Could not extract menu. Try another photo.");
      setImportItems([]);
    } finally {
      setImportingPhoto(false);
    }
  }

  async function saveImportedItems() {
    if (!userId || importItems.length === 0) return;
    setImportError(null);
    setSavingImported(true);

    try {
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) throw new Error(sessionErr.message);
      const token = sessionData.session?.access_token;
      if (!token) {
        router.push("/login");
        return;
      }

      const payloadItems = importItems
        .map((item) => ({
          name: String(item.name || "").trim(),
          price: item.price.trim() ? Number(item.price) : null,
          description: String(item.description || "").trim() || null,
          category: String(item.category || "").trim() || null,
        }))
        .filter((item) => item.name);

      if (!payloadItems.length) {
        setImportError("No valid items to save.");
        return;
      }

      const resp = await fetch(`${BACKEND_URL}/api/menu/import-confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId, items: payloadItems }),
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error(data?.error || "Failed to save imported items");
      }

      const inserted: Record<string, unknown>[] = Array.isArray(data?.inserted) ? data.inserted : [];
      const insertedRows: MenuItemRow[] = inserted.map((row: Record<string, unknown>) => {
        const safe = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
        return {
          id: String(safe.id || ""),
          name: String(safe.name || ""),
          price: safe.price === null || safe.price === undefined || safe.price === "" ? "" : String(safe.price),
          description: String(safe.description || ""),
          category: String(safe.category || ""),
          available: Boolean(safe.available ?? true),
          tags: Array.isArray(safe.tags) ? safe.tags.map((tag) => String(tag)).join(", ") : "",
        };
      });

      if (insertedRows.length) {
        setMenuItems((prev) => [...insertedRows, ...prev]);
      }
      setImportItems([]);
      setMenuStatus(`Imported ${insertedRows.length || payloadItems.length} item(s).`);
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Failed to save imported items";
      setImportError(message);
    } finally {
      setSavingImported(false);
    }
  }

  if (loading) {
    return (
      <DashboardShell title="Business Setup" subtitle="Manage your business configuration">
        <div style={{ maxWidth: 1100 }}>
          <p>Loading...</p>
        </div>
      </DashboardShell>
    );
  }

  const menuTabLabel = getMenuTabLabel(businessType);

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "profile", label: "Profile" },
    { key: "hours", label: "Hours" },
    { key: "menu", label: menuTabLabel },
    { key: "booking", label: "Booking Rules" },
    { key: "knowledge", label: "Knowledge Base" },
    { key: "faqs", label: "FAQs" },
  ];

  return (
    <DashboardShell title="Business Setup" subtitle="Manage your business configuration">
      <div style={{ maxWidth: 1100, color: "#111827" }}>

      <div
        role="tablist"
        style={{
          marginTop: 16,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          borderBottom: "1px solid rgba(0,0,0,0.1)",
          paddingBottom: 0,
          overflowX: "auto",
        }}
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={active}
              onClick={() => switchTab(tab.key)}
              style={{
                padding: "8px 14px",
                borderRadius: "10px 10px 0 0",
                border: "1px solid rgba(0,0,0,0.1)",
                borderBottom: active ? "1px solid white" : "1px solid transparent",
                marginBottom: -1,
                background: active ? "white" : "#f8fafc",
                color: active ? "#0f172a" : "#475569",
                fontWeight: 700,
                cursor: "pointer",
                fontSize: 13,
                whiteSpace: "nowrap",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
        {/* ─── Profile Tab ─── */}
        {activeTab === "profile" && (
          <section
            style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 14, background: "white" }}
          >
            <h2 style={{ marginTop: 0 }}>Profile</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Business name</span>
                <input
                  style={fieldStyle}
                  placeholder="Type business name"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Business type</span>
                <select
                  style={fieldStyle}
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                >
                  <option value="restaurant">Restaurant</option>
                  <option value="barber">Barber</option>
                  <option value="clinic">Clinic</option>
                  <option value="retail">Retail</option>
                  <option value="other">Other</option>
                  <option value="generic">Generic</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Phone</span>
                <input
                  style={fieldStyle}
                  placeholder="Type phone number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Timezone</span>
                <input
                  style={fieldStyle}
                  placeholder="Type timezone (example: Europe/Stockholm)"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                />
              </label>
            </div>
            <label style={{ display: "grid", gap: 6, marginTop: 10 }}>
              <span>Address</span>
              <input
                style={fieldStyle}
                placeholder="Type business address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
              <button onClick={saveProfile} disabled={profileSaving} style={{ ...saveBtnStyle, background: profileSaving ? "#e5e7eb" : "white" }}>
                {profileSaving ? "Saving..." : "Save profile"}
              </button>
              {profileStatus && <span style={{ fontWeight: 600 }}>{profileStatus}</span>}
            </div>
          </section>
        )}

        {/* ─── Hours Tab ─── */}
        {activeTab === "hours" && (
          <section
            style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 14, background: "white" }}
          >
            <h2 style={{ marginTop: 0 }}>Opening Hours</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {hours.map((row, idx) => (
                <div
                  key={row.day_of_week}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "140px 120px 1fr 1fr",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <strong>{DAY_NAMES[row.day_of_week]}</strong>
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                    style={fieldStyle}
                    value={row.open_time}
                    disabled={row.is_closed}
                    onChange={(e) => {
                      const next = [...hours];
                      next[idx] = { ...next[idx], open_time: e.target.value };
                      setHours(next);
                    }}
                  />
                  <input
                    type="time"
                    style={fieldStyle}
                    value={row.close_time}
                    disabled={row.is_closed}
                    onChange={(e) => {
                      const next = [...hours];
                      next[idx] = { ...next[idx], close_time: e.target.value };
                      setHours(next);
                    }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
              <button onClick={saveHours} disabled={hoursSaving} style={{ ...saveBtnStyle, background: hoursSaving ? "#e5e7eb" : "white" }}>
                {hoursSaving ? "Saving..." : "Save hours"}
              </button>
              {hoursStatus && <span style={{ fontWeight: 600 }}>{hoursStatus}</span>}
            </div>
          </section>
        )}

        {/* ─── Menu / Services / Products Tab ─── */}
        {activeTab === "menu" && (
          <section
            style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 14, background: "white" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <h2 style={{ marginTop: 0 }}>{menuTabLabel}</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <label
                  style={{
                    ...fieldStyle,
                    cursor: importingPhoto ? "not-allowed" : "pointer",
                    width: "auto",
                    fontWeight: 700,
                    background: importingPhoto ? "#f3f4f6" : "white",
                  }}
                >
                  {importingPhoto ? "Importing..." : "Import from photo"}
                  <input
                    type="file"
                    accept="image/*"
                    disabled={importingPhoto}
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void importMenuFromPhoto(file);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>

                <button
                  onClick={() =>
                    setMenuItems((prev) => [
                      { name: "", price: "", description: "", category: "", available: true, tags: "" },
                      ...prev,
                    ])
                  }
                >
                  Add item
                </button>
              </div>
            </div>

            {importError ? (
              <p style={{ marginTop: 8, color: "#b91c1c", fontWeight: 700 }}>{importError}</p>
            ) : null}

            {importItems.length > 0 ? (
              <div
                style={{
                  marginTop: 12,
                  border: "1px solid #bfdbfe",
                  background: "#eff6ff",
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 8 }}>
                  Imported preview (edit before saving)
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {importItems.map((row, idx) => (
                    <div
                      key={`import-row-${idx}`}
                      style={{
                        border: "1px solid rgba(0,0,0,0.1)",
                        borderRadius: 8,
                        padding: 8,
                        background: "white",
                        display: "grid",
                        gridTemplateColumns: "2fr 1fr 2fr 1fr auto",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <input style={fieldStyle} placeholder="Name" value={row.name} onChange={(e) => { const next = [...importItems]; next[idx] = { ...next[idx], name: e.target.value }; setImportItems(next); }} />
                      <input style={fieldStyle} placeholder="Price" value={row.price} onChange={(e) => { const next = [...importItems]; next[idx] = { ...next[idx], price: e.target.value }; setImportItems(next); }} />
                      <input style={fieldStyle} placeholder="Description" value={row.description} onChange={(e) => { const next = [...importItems]; next[idx] = { ...next[idx], description: e.target.value }; setImportItems(next); }} />
                      <input style={fieldStyle} placeholder="Category" value={row.category} onChange={(e) => { const next = [...importItems]; next[idx] = { ...next[idx], category: e.target.value }; setImportItems(next); }} />
                      <button onClick={() => setImportItems(importItems.filter((_, rowIdx) => rowIdx !== idx))}>Remove</button>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10 }}>
                  <button onClick={saveImportedItems} disabled={savingImported}>
                    {savingImported ? "Saving..." : "Save items"}
                  </button>
                </div>
              </div>
            ) : null}

            <div style={{ display: "grid", gap: 8 }}>
              {menuItems.map((item, idx) => (
                <div
                  key={item.id || `new-menu-${idx}`}
                  style={{
                    border: "1px solid rgba(0,0,0,0.1)",
                    borderRadius: 10,
                    padding: 10,
                    display: "grid",
                    gridTemplateColumns: "2fr 1fr 1fr",
                    gap: 8,
                  }}
                >
                  <input style={fieldStyle} placeholder="Name" value={item.name} onChange={(e) => { const next = [...menuItems]; next[idx] = { ...next[idx], name: e.target.value }; setMenuItems(next); }} />
                  <input style={fieldStyle} placeholder="Price" value={item.price} onChange={(e) => { const next = [...menuItems]; next[idx] = { ...next[idx], price: e.target.value }; setMenuItems(next); }} />
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="checkbox" checked={item.available} onChange={(e) => { const next = [...menuItems]; next[idx] = { ...next[idx], available: e.target.checked }; setMenuItems(next); }} />
                    Available
                  </label>
                  <input style={fieldStyle} placeholder="Category" value={item.category} onChange={(e) => { const next = [...menuItems]; next[idx] = { ...next[idx], category: e.target.value }; setMenuItems(next); }} />
                  <input style={fieldStyle} placeholder="Tags (comma separated)" value={item.tags} onChange={(e) => { const next = [...menuItems]; next[idx] = { ...next[idx], tags: e.target.value }; setMenuItems(next); }} />
                  <button onClick={() => { const target = menuItems[idx]; if (target?.id) setDeletedMenuIds((prev) => [...prev, target.id as string]); setMenuItems(menuItems.filter((_, rowIdx) => rowIdx !== idx)); }}>Remove</button>
                  <textarea
                    style={{ ...areaStyle, gridColumn: "1 / span 3" }}
                    placeholder="Description"
                    rows={2}
                    value={item.description}
                    onChange={(e) => { const next = [...menuItems]; next[idx] = { ...next[idx], description: e.target.value }; setMenuItems(next); }}
                  />
                </div>
              ))}
              {!hasMenuItems && <p style={{ color: "#6b7280" }}>No items yet.</p>}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
              <button onClick={saveMenu} disabled={menuSaving} style={{ ...saveBtnStyle, background: menuSaving ? "#e5e7eb" : "white" }}>
                {menuSaving ? "Saving..." : `Save ${menuTabLabel.toLowerCase()}`}
              </button>
              {menuStatus && <span style={{ fontWeight: 600 }}>{menuStatus}</span>}
            </div>
          </section>
        )}

        {/* ─── Booking Rules Tab ─── */}
        {activeTab === "booking" && (
          <section
            style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 14, background: "white" }}
          >
            <h2 style={{ marginTop: 0 }}>Booking Rules</h2>
            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={bookingEnabled} onChange={(e) => setBookingEnabled(e.target.checked)} />
                Booking enabled
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={requireName} onChange={(e) => setRequireName(e.target.checked)} />
                Require customer name
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={requirePhone} onChange={(e) => setRequirePhone(e.target.checked)} />
                Require customer phone
              </label>
              {businessType === "restaurant" && (
                <label style={{ display: "grid", gap: 6, maxWidth: 260 }}>
                  <span>Max party size (optional)</span>
                  <input type="number" style={fieldStyle} value={maxPartySize} onChange={(e) => setMaxPartySize(e.target.value)} />
                </label>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
              <button onClick={saveBookingRules} disabled={bookingSaving} style={{ ...saveBtnStyle, background: bookingSaving ? "#e5e7eb" : "white" }}>
                {bookingSaving ? "Saving..." : "Save booking rules"}
              </button>
              {bookingStatus && <span style={{ fontWeight: 600 }}>{bookingStatus}</span>}
            </div>
          </section>
        )}

        {/* ─── Knowledge Base Tab ─── */}
        {activeTab === "knowledge" && (
          <section
            style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 14, background: "white" }}
          >
            <h2 style={{ marginTop: 0 }}>Knowledge Base</h2>
            <p style={{ marginTop: 0, color: "#6b7280", fontSize: 13 }}>
              Manual Q&amp;A entries plus answers learned from human replies.
            </p>
            <KnowledgeBaseSection />
          </section>
        )}

        {/* ─── FAQs Tab ─── */}
        {activeTab === "faqs" && (
          <section
            style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 14, background: "white" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ marginTop: 0 }}>FAQs</h2>
              <button onClick={() => setFaqs((prev) => [{ question: "", answer: "" }, ...prev])}>
                Add FAQ
              </button>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {faqs.map((row, idx) => (
                <div
                  key={row.id || `new-faq-${idx}`}
                  style={{ border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, padding: 10 }}
                >
                  <input
                    style={fieldStyle}
                    placeholder="Question"
                    value={row.question}
                    onChange={(e) => { const next = [...faqs]; next[idx] = { ...next[idx], question: e.target.value }; setFaqs(next); }}
                  />
                  <textarea
                    style={{ ...areaStyle, width: "100%", marginTop: 8 }}
                    placeholder="Answer"
                    rows={3}
                    value={row.answer}
                    onChange={(e) => { const next = [...faqs]; next[idx] = { ...next[idx], answer: e.target.value }; setFaqs(next); }}
                  />
                  <button
                    onClick={() => {
                      const target = faqs[idx];
                      if (target?.id) setDeletedFaqIds((prev) => [...prev, target.id as string]);
                      setFaqs(faqs.filter((_, rowIdx) => rowIdx !== idx));
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {faqs.length === 0 && <p style={{ color: "#6b7280" }}>No FAQs yet.</p>}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
              <button onClick={saveFaqs} disabled={faqsSaving} style={{ ...saveBtnStyle, background: faqsSaving ? "#e5e7eb" : "white" }}>
                {faqsSaving ? "Saving..." : "Save FAQs"}
              </button>
              {faqsStatus && <span style={{ fontWeight: 600 }}>{faqsStatus}</span>}
            </div>
          </section>
        )}
      </div>
      </div>
    </DashboardShell>
  );
}
