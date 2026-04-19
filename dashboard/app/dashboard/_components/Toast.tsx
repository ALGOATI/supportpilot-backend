"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type ToastVariant = "success" | "error" | "info";
type ToastItem = { id: number; message: string; variant: ToastVariant };

type ToastContextValue = {
  notify: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let toastIdCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timersRef.current[id];
    }
  }, []);

  const notify = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      toastIdCounter += 1;
      const id = toastIdCounter;
      setToasts((prev) => [...prev, { id, message, variant }]);
      timersRef.current[id] = setTimeout(() => dismiss(id), 3500);
    },
    [dismiss]
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          display: "grid",
          gap: 10,
          zIndex: 1000,
          pointerEvents: "none",
          maxWidth: "calc(100vw - 40px)",
        }}
      >
        {toasts.map((t) => {
          const palette =
            t.variant === "error"
              ? { bg: "#fef2f2", border: "#fecaca", text: "#991b1b", icon: "!" }
              : t.variant === "info"
              ? { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af", icon: "i" }
              : { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534", icon: "✓" };
          return (
            <div
              key={t.id}
              role="status"
              onClick={() => dismiss(t.id)}
              style={{
                pointerEvents: "auto",
                minWidth: 240,
                maxWidth: 360,
                padding: "10px 14px",
                borderRadius: 12,
                background: palette.bg,
                border: `1px solid ${palette.border}`,
                color: palette.text,
                fontWeight: 600,
                fontSize: 13,
                boxShadow: "0 10px 24px rgba(15,23,42,0.12)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: "pointer",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.7)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                  fontSize: 13,
                  flexShrink: 0,
                }}
              >
                {palette.icon}
              </span>
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return { notify: () => {} };
  }
  return ctx;
}
