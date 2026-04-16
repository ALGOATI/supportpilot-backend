import Link from "next/link";

// Public landing page — no auth required.
// Replace the content below with your prepared landing page component.
// Routing contract: `/` is public, `/dashboard/*` requires a Supabase session.
export default function LandingPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        background: "linear-gradient(145deg, #f8fafc 0%, #eef2f7 50%, #e8edf5 100%)",
      }}
    >
      <div style={{ maxWidth: 640, textAlign: "center" }}>
        <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>
          SupportPilot
        </h1>
        <p style={{ marginTop: 16, fontSize: 18, color: "#475569", lineHeight: 1.6 }}>
          AI customer support that handles messages, bookings, and escalations for
          small teams. Drop your landing page component into{" "}
          <code>dashboard/app/page.tsx</code>.
        </p>

        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 28 }}>
          <Link
            href="/signup"
            style={{
              padding: "12px 20px",
              borderRadius: 12,
              background: "linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)",
              color: "white",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Get started
          </Link>
          <Link
            href="/login"
            style={{
              padding: "12px 20px",
              borderRadius: 12,
              border: "1px solid #e2e8f0",
              background: "white",
              color: "#0f172a",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Log in
          </Link>
        </div>
      </div>
    </main>
  );
}
