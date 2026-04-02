"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import styles from "./DashboardShell.module.css";
import { useDashboardLanguage } from "@/lib/useDashboardLanguage";

type ShellProps = Readonly<{
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}>;

type NotificationRow = {
  id: string;
  conversation_id: string | null;
  message_preview: string;
  created_at: string;
  read: boolean;
  type: "escalation";
};

const navItems = [
  { href: "/dashboard", key: "overview", icon: "◧" },
  { href: "/dashboard/inbox", key: "inbox", icon: "◫" },
  { href: "/dashboard/escalated", key: "escalated_nav", icon: "⚠" },
  { href: "/dashboard/bookings", key: "bookings", icon: "◩" },
  { href: "/dashboard/analytics", key: "analytics", icon: "◪" },
  { href: "/dashboard/reports", key: "reports", icon: "◩" },
  { href: "/dashboard/chat", key: "chat_test", icon: "◎" },
  { href: "/dashboard/business", key: "business_setup", icon: "◬" },
  { href: "/dashboard/knowledge", key: "knowledge", icon: "◨" },
  { href: "/dashboard/settings", key: "settings", icon: "⚙" },
];

export default function DashboardShell({ title, subtitle, children }: ShellProps) {
  const pathname = usePathname();
  const { language, dir, tr, saveDashboardLanguage } = useDashboardLanguage();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const alertsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!userData.user) {
        setUnreadCount(0);
        setNotifications([]);
        return;
      }

      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userData.user.id)
        .eq("read", false);

      if (cancelled) return;

      if (error) {
        const text = String(error.message || "").toLowerCase();
        if (text.includes("notifications") && (text.includes("does not exist") || text.includes("schema cache"))) {
          setUnreadCount(0);
          setNotifications([]);
          return;
        }
        console.error("Notification count failed:", error.message);
        return;
      }

      setUnreadCount(Number(count || 0));

      const latest = await supabase
        .from("notifications")
        .select("id,conversation_id,message_preview,created_at,read,type")
        .eq("user_id", userData.user.id)
        .order("created_at", { ascending: false })
        .limit(8);

      if (!cancelled && !latest.error) {
        setNotifications((latest.data || []) as NotificationRow[]);
      }
    })();

    return () => { cancelled = true; };
  }, [pathname]);

  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSidebarOpen(false);
        setAlertsOpen(false);
      }
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!alertsRef.current) return;
      if (!alertsRef.current.contains(event.target as Node)) {
        setAlertsOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const langCodeMap: Record<string, string> = { arabic: "ar", swedish: "sv", english: "en" };
  const langCode = langCodeMap[language] ?? "en";

  return (
    <div className={styles.shell} dir={dir} lang={langCode}>
      <button
        type="button"
        className={styles.mobileToggle}
        onClick={() => setSidebarOpen((v) => !v)}
      >
        {sidebarOpen ? tr("close") : tr("menu")}
      </button>

      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className={styles.sidebarBackdrop}
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.brand}>SupportPilot</div>
        <nav className={styles.nav}>
          {navItems.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
                onClick={() => setSidebarOpen(false)}
              >
                <span className={styles.navIcon} aria-hidden="true">
                  {item.icon}
                </span>
                <span>{tr(item.key)}</span>
              </Link>
            );
          })}
        </nav>
        <div className={styles.sidebarFooter}>{tr("support_workspace")}</div>
      </aside>

      <div className={styles.main}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>{title}</h1>
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>
          <div className={styles.headerRight} ref={alertsRef}>
            <div
              style={{
                display: "inline-flex",
                border: "1px solid #d8e0ec",
                borderRadius: 999,
                padding: 2,
                background: "#fff",
                marginRight: 10,
              }}
            >
              {[
                { code: "english", label: "EN" },
                { code: "swedish", label: "SV" },
                { code: "arabic", label: "AR" },
              ].map((langOption) => {
                const active = language === langOption.code;
                return (
                  <button
                    key={langOption.code}
                    type="button"
                    onClick={() =>
                      void saveDashboardLanguage(
                        langOption.code as "english" | "swedish" | "arabic"
                      )
                    }
                    style={{
                      border: "none",
                      background: active ? "#e2e8f0" : "transparent",
                      color: "#0f172a",
                      fontWeight: 700,
                      fontSize: 11,
                      borderRadius: 999,
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    {langOption.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className={styles.alertLink}
              onClick={() => setAlertsOpen((v) => !v)}
            >
              {tr("alerts")}
              {unreadCount > 0 ? <span className={styles.alertBadge}>{unreadCount}</span> : null}
            </button>
            {alertsOpen ? (
              <div
                className={styles.alertDropdown}
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  width: "min(360px, calc(100vw - 24px))",
                  maxHeight: "min(420px, calc(100vh - 120px))",
                  overflow: "auto",
                  border: "1px solid #d8e0ec",
                  borderRadius: 14,
                  background: "#ffffff",
                  boxShadow:
                    "0 18px 36px rgba(15, 23, 42, 0.14), 0 2px 8px rgba(15, 23, 42, 0.06)",
                  zIndex: 40,
                }}
              >
                <div
                  className={styles.alertDropdownHead}
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                    padding: "10px 12px",
                    borderBottom: "1px solid #edf1f7",
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.03em",
                    textTransform: "uppercase",
                    color: "#334155",
                    background: "#fbfcff",
                  }}
                >
                  {tr("recent_notifications")}
                </div>
                {notifications.length === 0 ? (
                  <div className={styles.alertEmpty} style={{ padding: "14px 12px", color: "#64748b", fontSize: 13 }}>
                    {tr("no_notifications")}
                  </div>
                ) : (
                  notifications.map((n) => (
                    <Link
                      key={n.id}
                      href={
                        n.conversation_id
                          ? `/dashboard/inbox?c=${encodeURIComponent(n.conversation_id)}`
                          : "/dashboard/inbox"
                      }
                      className={styles.alertItem}
                      onClick={() => setAlertsOpen(false)}
                      style={{
                        display: "grid",
                        gap: 4,
                        padding: "10px 12px",
                        textDecoration: "none",
                        color: "#0f172a",
                        borderBottom: "1px solid #f1f5f9",
                        background: "#fff",
                      }}
                    >
                      <div
                        className={styles.alertItemText}
                        style={{
                          fontSize: 13,
                          lineHeight: 1.35,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {n.message_preview || "Escalated conversation"}
                      </div>
                      <div className={styles.alertItemMeta} style={{ color: "#64748b", fontSize: 11 }}>
                        {new Date(n.created_at).toLocaleString()}
                      </div>
                    </Link>
                  ))
                )}
                <Link
                  href="/dashboard/inbox"
                  className={styles.alertFooter}
                  onClick={() => setAlertsOpen(false)}
                  style={{
                    display: "block",
                    textAlign: "center",
                    padding: "10px 12px",
                    textDecoration: "none",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#1d4ed8",
                    background: "#fbfcff",
                    borderTop: "1px solid #edf1f7",
                  }}
                >
                  {tr("open_inbox")}
                </Link>
              </div>
            ) : null}
          </div>
        </header>
        <main className={styles.content}>
          <div className={styles.contentInner}>{children}</div>
        </main>
      </div>
    </div>
  );
}
