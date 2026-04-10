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
  | "business_info"
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

export default function BusinessSetupPage() {
  const router = useRouter();
  const BACKEND_URL = useMemo(() => getBackendUrl(), []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [niche, setNiche] = useState("generic");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("Europe/Stockholm");

  const [hours, setHours] = useState<HourRow[]>(defaultHours());
  const [menuItems, setMenuItems] = useState<MenuItemRow[]>([]);
  const [faqs, setFaqs] = useState<FaqRow[]>([]);
  const [deletedMenuIds, setDeletedMenuIds] = useState<string[]>([]);
  const [deletedFaqIds, setDeletedFaqIds] = useState<string[]>([]);
  const [importingPhoto, setImportingPhoto] = useState(false);
  const [savingImported, setSavingImported] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importItems, setImportItems] = useState<ImportedMenuItem[]>([]);

  const [bookingEnabled, setBookingEnabled] = useState(true);
  const [requireName, setRequireName] = useState(true);
  const [requirePhone, setRequirePhone] = useState(true);
  const [maxPartySize, setMaxPartySize] = useState("");

  const [businessInfo, setBusinessInfo] = useState("");
  const [savingBusinessInfo, setSavingBusinessInfo] = useState(false);
  const [businessInfoStatus, setBusinessInfoStatus] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>("profile");

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

      const [profileRes, hoursRes, menuRes, faqRes, rulesRes, clientSettingsRes] = await Promise.all([
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
        supabase
          .from("client_settings")
          .select("business")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      if (profileRes.error) console.error(profileRes.error);
      if (hoursRes.error) console.error(hoursRes.error);
      if (menuRes.error) console.error(menuRes.error);
      if (faqRes.error) console.error(faqRes.error);
      if (rulesRes.error) console.error(rulesRes.error);
      if (clientSettingsRes.error) console.error(clientSettingsRes.error);

      if (clientSettingsRes.data) {
        setBusinessInfo(clientSettingsRes.data.business ?? "");
      }

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

  const hasMenuItems = useMemo(() => {
    return menuItems.some((item) => String(item.name || "").trim());
  }, [menuItems]);

  async function importMenuFromPhoto(file: File) {
    if (!userId || !file) return;
    setImportError(null);

    const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
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
        body: JSON.stringify({
          userId,
          imageDataUrl,
        }),
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        const errorText = data?.error || "Could not extract menu. Try another photo.";
        throw new Error(errorText);
      }

      const items: Record<string, unknown>[] = Array.isArray(data?.items) ? data.items : [];
      const nextItems: ImportedMenuItem[] = items.map((item: Record<string, unknown>) => {
        const value = item && typeof item === "object" ? item : {};
        const safe = value as Record<string, unknown>;
        return {
          name: String(safe.name || ""),
          price:
            safe.price === null || safe.price === undefined || safe.price === ""
              ? ""
              : String(safe.price),
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
        body: JSON.stringify({
          userId,
          items: payloadItems,
        }),
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error(data?.error || "Failed to save imported items");
      }

      const inserted: Record<string, unknown>[] = Array.isArray(data?.inserted) ? data.inserted : [];
      const insertedRows: MenuItemRow[] = inserted.map((row: Record<string, unknown>) => {
        const value = row && typeof row === "object" ? row : {};
        const safe = value as Record<string, unknown>;
        return {
          id: String(safe.id || ""),
          name: String(safe.name || ""),
          price:
            safe.price === null || safe.price === undefined || safe.price === ""
              ? ""
              : String(safe.price),
          description: String(safe.description || ""),
          category: String(safe.category || ""),
          available: Boolean(safe.available ?? true),
          tags: Array.isArray(safe.tags)
            ? safe.tags.map((tag) => String(tag)).join(", ")
            : "",
        };
      });

      if (insertedRows.length) {
        setMenuItems((prev) => [...insertedRows, ...prev]);
      }
      setImportItems([]);
      setStatus(`Imported ${insertedRows.length || payloadItems.length} item(s).`);
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Failed to save imported items";
      setImportError(message);
    } finally {
      setSavingImported(false);
    }
  }

  async function saveBusinessInfo() {
    if (!userId) return;
    setSavingBusinessInfo(true);
    setBusinessInfoStatus(null);
    try {
      const { error } = await supabase
        .from("client_settings")
        .upsert(
          {
            user_id: userId,
            business: businessInfo,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
      if (error) throw error;
      setBusinessInfoStatus("Saved business info.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setBusinessInfoStatus(`Save failed: ${message}`);
    } finally {
      setSavingBusinessInfo(false);
    }
  }

  async function saveAll() {
    if (!userId) return;

    setSaving(true);
    setStatus(null);

    try {
      const now = new Date().toISOString();

      const profilePayload = {
        user_id: userId,
        business_name: businessName || null,
        niche: niche || "generic",
        phone: phone || null,
        address: address || null,
        timezone: timezone || "Europe/Stockholm",
        updated_at: now,
      };

      const profileUpsert = await supabase
        .from("business_profiles")
        .upsert(profilePayload, { onConflict: "user_id" });
      if (profileUpsert.error) throw profileUpsert.error;

      const hoursPayload = hours.map((row) => ({
        user_id: userId,
        day_of_week: row.day_of_week,
        is_closed: row.is_closed,
        open_time: row.is_closed ? null : row.open_time || null,
        close_time: row.is_closed ? null : row.close_time || null,
        updated_at: now,
      }));

      const hoursUpsert = await supabase
        .from("business_hours")
        .upsert(hoursPayload, { onConflict: "user_id,day_of_week" });
      if (hoursUpsert.error) throw hoursUpsert.error;

      const normalizedMenu = menuItems
        .map((item) => ({ ...item, name: String(item.name || "").trim() }))
        .filter((item) => item.name);

      if (deletedMenuIds.length) {
        const deleteMenuRes = await supabase
          .from("menu_items")
          .delete()
          .eq("user_id", userId)
          .in("id", deletedMenuIds);
        if (deleteMenuRes.error) throw deleteMenuRes.error;
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
          tags: item.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
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
          tags: item.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          updated_at: now,
        }));

      if (menuUpdates.length) {
        const menuUpdateRes = await supabase
          .from("menu_items")
          .upsert(menuUpdates, { onConflict: "id" });
        if (menuUpdateRes.error) throw menuUpdateRes.error;
      }

      if (menuInserts.length) {
        const menuInsertRes = await supabase.from("menu_items").insert(menuInserts);
        if (menuInsertRes.error) throw menuInsertRes.error;
      }

      const normalizedFaqs = faqs
        .map((row) => ({
          ...row,
          question: String(row.question || "").trim(),
          answer: String(row.answer || "").trim(),
        }))
        .filter((row) => row.question && row.answer);

      if (deletedFaqIds.length) {
        const deleteFaqRes = await supabase
          .from("faqs")
          .delete()
          .eq("user_id", userId)
          .in("id", deletedFaqIds);
        if (deleteFaqRes.error) throw deleteFaqRes.error;
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
        const faqUpdateRes = await supabase.from("faqs").upsert(faqUpdates, {
          onConflict: "id",
        });
        if (faqUpdateRes.error) throw faqUpdateRes.error;
      }

      if (faqInserts.length) {
        const faqInsertRes = await supabase.from("faqs").insert(faqInserts);
        if (faqInsertRes.error) throw faqInsertRes.error;
      }

      const bookingPayload = {
        user_id: userId,
        booking_enabled: bookingEnabled,
        require_name: requireName,
        require_phone: requirePhone,
        max_party_size: maxPartySize.trim() ? Number(maxPartySize) : null,
        updated_at: now,
      };

      const bookingUpsert = await supabase
        .from("booking_rules")
        .upsert(bookingPayload, { onConflict: "user_id" });
      if (bookingUpsert.error) throw bookingUpsert.error;

      setDeletedMenuIds([]);
      setDeletedFaqIds([]);
      setStatus("Saved business setup.");
      router.refresh();
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Unknown error";
      setStatus(`Save failed: ${message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <DashboardShell title="Business Setup" subtitle="Structured business knowledge">
        <div style={{ maxWidth: 1100 }}>
        <p>Loading...</p>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title="Business Setup" subtitle="Structured business knowledge">
      <div style={{ maxWidth: 1100, color: "#111827" }}>
      <p style={{ marginTop: 8, color: "#4b5563" }}>
        Structured data is used by AI before legacy business text.
      </p>

      <div
        role="tablist"
        style={{
          marginTop: 16,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          borderBottom: "1px solid rgba(0,0,0,0.1)",
          paddingBottom: 0,
        }}
      >
        {(
          [
            { key: "profile", label: "Profile" },
            { key: "hours", label: "Hours" },
            { key: "menu", label: "Menu" },
            { key: "faqs", label: "FAQs" },
            { key: "booking", label: "Booking Rules" },
            { key: "business_info", label: "Business Info" },
            { key: "knowledge", label: "Knowledge Base" },
          ] as Array<{ key: TabKey; label: string }>
        ).map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.key)}
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
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
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
              <span>Niche</span>
              <input
                style={fieldStyle}
                placeholder="Type niche (example: cafe, salon)"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
              />
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
        </section>
        )}

        {activeTab === "hours" && (
        <section
          style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 14, background: "white" }}
        >
          <h2 style={{ marginTop: 0 }}>Hours</h2>
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
        </section>
        )}

        {activeTab === "menu" && (
        <section
          style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 14, background: "white" }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ marginTop: 0 }}>Menu</h2>
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
                    <input
                      style={fieldStyle}
                      placeholder="Name"
                      value={row.name}
                      onChange={(e) => {
                        const next = [...importItems];
                        next[idx] = { ...next[idx], name: e.target.value };
                        setImportItems(next);
                      }}
                    />
                    <input
                      style={fieldStyle}
                      placeholder="Price"
                      value={row.price}
                      onChange={(e) => {
                        const next = [...importItems];
                        next[idx] = { ...next[idx], price: e.target.value };
                        setImportItems(next);
                      }}
                    />
                    <input
                      style={fieldStyle}
                      placeholder="Description"
                      value={row.description}
                      onChange={(e) => {
                        const next = [...importItems];
                        next[idx] = { ...next[idx], description: e.target.value };
                        setImportItems(next);
                      }}
                    />
                    <input
                      style={fieldStyle}
                      placeholder="Category"
                      value={row.category}
                      onChange={(e) => {
                        const next = [...importItems];
                        next[idx] = { ...next[idx], category: e.target.value };
                        setImportItems(next);
                      }}
                    />
                    <button
                      onClick={() => {
                        const next = importItems.filter((_, rowIdx) => rowIdx !== idx);
                        setImportItems(next);
                      }}
                    >
                      Remove
                    </button>
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
                <input
                  style={fieldStyle}
                  placeholder="Name"
                  value={item.name}
                  onChange={(e) => {
                    const next = [...menuItems];
                    next[idx] = { ...next[idx], name: e.target.value };
                    setMenuItems(next);
                  }}
                />
                <input
                  style={fieldStyle}
                  placeholder="Price"
                  value={item.price}
                  onChange={(e) => {
                    const next = [...menuItems];
                    next[idx] = { ...next[idx], price: e.target.value };
                    setMenuItems(next);
                  }}
                />
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={item.available}
                    onChange={(e) => {
                      const next = [...menuItems];
                      next[idx] = { ...next[idx], available: e.target.checked };
                      setMenuItems(next);
                    }}
                  />
                  Available
                </label>
                <input
                  style={fieldStyle}
                  placeholder="Category"
                  value={item.category}
                  onChange={(e) => {
                    const next = [...menuItems];
                    next[idx] = { ...next[idx], category: e.target.value };
                    setMenuItems(next);
                  }}
                />
                <input
                  style={fieldStyle}
                  placeholder="Tags (comma separated)"
                  value={item.tags}
                  onChange={(e) => {
                    const next = [...menuItems];
                    next[idx] = { ...next[idx], tags: e.target.value };
                    setMenuItems(next);
                  }}
                />
                <button
                  onClick={() => {
                    const target = menuItems[idx];
                    if (target?.id) {
                      setDeletedMenuIds((prev) => [...prev, target.id as string]);
                    }
                    const next = menuItems.filter((_, rowIdx) => rowIdx !== idx);
                    setMenuItems(next);
                  }}
                >
                  Remove
                </button>
                <textarea
                  style={{ ...areaStyle, gridColumn: "1 / span 3" }}
                  placeholder="Description"
                  rows={2}
                  value={item.description}
                  onChange={(e) => {
                    const next = [...menuItems];
                    next[idx] = { ...next[idx], description: e.target.value };
                    setMenuItems(next);
                  }}
                />
              </div>
            ))}
            {!hasMenuItems && <p style={{ color: "#6b7280" }}>No menu items yet.</p>}
          </div>
        </section>
        )}

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
                  onChange={(e) => {
                    const next = [...faqs];
                    next[idx] = { ...next[idx], question: e.target.value };
                    setFaqs(next);
                  }}
                />
                <textarea
                  style={{ ...areaStyle, width: "100%", marginTop: 8 }}
                  placeholder="Answer"
                  rows={3}
                  value={row.answer}
                  onChange={(e) => {
                    const next = [...faqs];
                    next[idx] = { ...next[idx], answer: e.target.value };
                    setFaqs(next);
                  }}
                />
                <button
                  onClick={() => {
                    const target = faqs[idx];
                    if (target?.id) {
                      setDeletedFaqIds((prev) => [...prev, target.id as string]);
                    }
                    const next = faqs.filter((_, rowIdx) => rowIdx !== idx);
                    setFaqs(next);
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            {faqs.length === 0 && <p style={{ color: "#6b7280" }}>No FAQs yet.</p>}
          </div>
        </section>
        )}

        {activeTab === "booking" && (
        <section
          style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 14, background: "white" }}
        >
          <h2 style={{ marginTop: 0 }}>Booking Rules</h2>
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={bookingEnabled}
                onChange={(e) => setBookingEnabled(e.target.checked)}
              />
              Booking enabled
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={requireName}
                onChange={(e) => setRequireName(e.target.checked)}
              />
              Require customer name
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={requirePhone}
                onChange={(e) => setRequirePhone(e.target.checked)}
              />
              Require customer phone
            </label>
            <label style={{ display: "grid", gap: 6, maxWidth: 260 }}>
              <span>Max party size (optional)</span>
              <input
                type="number"
                style={fieldStyle}
                value={maxPartySize}
                onChange={(e) => setMaxPartySize(e.target.value)}
              />
            </label>
          </div>
        </section>
        )}

        {activeTab === "business_info" && (
          <section
            style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 14, background: "white" }}
          >
            <h2 style={{ marginTop: 0 }}>Business Info</h2>
            <p style={{ marginTop: 0, color: "#6b7280", fontSize: 13 }}>
              Free-text business information. The AI is only allowed to use what you put here. Structured data above is used first.
            </p>
            <textarea
              value={businessInfo}
              onChange={(e) => setBusinessInfo(e.target.value)}
              rows={12}
              style={{ ...areaStyle, minHeight: 220 }}
              placeholder="Paste business info: hours, address, services, booking rules, policies, FAQs…"
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
              <button
                onClick={saveBusinessInfo}
                disabled={savingBusinessInfo}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.15)",
                  background: savingBusinessInfo ? "#e5e7eb" : "white",
                  cursor: savingBusinessInfo ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                {savingBusinessInfo ? "Saving..." : "Save business info"}
              </button>
              {businessInfoStatus && (
                <span style={{ fontWeight: 600 }}>{businessInfoStatus}</span>
              )}
            </div>
          </section>
        )}

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
      </div>

      {activeTab !== "business_info" && activeTab !== "knowledge" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
          <button
            onClick={saveAll}
            disabled={saving}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.15)",
              background: saving ? "#e5e7eb" : "white",
              cursor: saving ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {saving ? "Saving..." : "Save all"}
          </button>
          {status && <span style={{ fontWeight: 600 }}>{status}</span>}
        </div>
      )}
      </div>
    </DashboardShell>
  );
}
