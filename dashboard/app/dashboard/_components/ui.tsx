"use client";
import React from "react";

export const primaryBtnStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid #1d4ed8",
  background: "#2563eb",
  color: "#ffffff",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 13,
  letterSpacing: 0.1,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  transition: "background 120ms ease, border-color 120ms ease",
};

export const secondaryBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #d1d9e6",
  background: "#ffffff",
  color: "#1e293b",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 13,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  transition: "background 120ms ease, border-color 120ms ease",
};

export const dangerBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #fecaca",
  background: "#ffffff",
  color: "#b91c1c",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 13,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

export const ghostBtnStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid transparent",
  background: "transparent",
  color: "#475569",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div
      style={{
        display: "grid",
        justifyItems: "center",
        gap: 8,
        padding: "32px 16px",
        border: "1px dashed #d1d9e6",
        borderRadius: 12,
        background: "#fbfcff",
        textAlign: "center",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: "#eef4ff",
          color: "#1d4ed8",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          fontWeight: 800,
        }}
      >
        {icon || "✦"}
      </div>
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>{title}</div>
      <div style={{ color: "#64748b", fontSize: 13, maxWidth: 380, lineHeight: 1.45 }}>
        {description}
      </div>
      {actionLabel && onAction ? (
        <button onClick={onAction} style={{ ...primaryBtnStyle, marginTop: 6 }}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
