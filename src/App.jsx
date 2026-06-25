import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import SupplyFlowApp from "./supplyflow-app";
import Auth, { ResetPassword } from "./Auth";
import AgentPanel from "./AgentPanel";
import SupportWidget from "./SupportWidget";
import InstallPrompt from "./InstallPrompt";
import WithdrawalPage from "./WithdrawalPage";
import ReturnsPage from "./ReturnsPage";

// De admin draait volledig in het gamified command center (ai-ops-hud).
// Lokaal → poort 5181; op de live site → het gedeployde admin-dashboard.
// VITE_HUD_URL overschrijft beide (zet die als je later admin.flowva.app koppelt).
function AdminGate() {
  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const hudUrl =
    import.meta.env.VITE_HUD_URL ||
    (isLocal ? "http://localhost:5181" : "https://flowva-admin.vercel.app");
  return (
    <div style={{ fontFamily: "'Cascadia Mono', 'JetBrains Mono', Consolas, monospace", background: "#070b07", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#0b100b", border: "1px solid #2c4a2c", borderRadius: 8, padding: "28px 30px", maxWidth: 420, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>🦊</div>
        <div style={{ color: "#ffb84d", fontSize: 15, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>◆ FLOWVA ADMIN</div>
        <div style={{ color: "#6b9a6b", fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
          Your admin now runs entirely in the command center — missions, products and treasury in one dashboard. Log in there with this same admin account.
        </div>
        <a href={hudUrl} style={{ display: "block", background: "#ffb84d", color: "#2a1a00", borderRadius: 4, padding: "12px", fontSize: 14, fontWeight: 700, textDecoration: "none", marginBottom: 10 }}>
          ▸ OPEN COMMAND CENTER
        </a>
        <button onClick={() => supabase.auth.signOut()} style={{ width: "100%", background: "transparent", border: "1px dashed #2c4a2c", borderRadius: 4, color: "#5a7d5a", fontFamily: "inherit", fontSize: 12, padding: "10px", cursor: "pointer" }}>
          Log out
        </button>
      </div>
    </div>
  );
}

function PaymentSuccess({ session }) {
  const [balance, setBalance] = useState(null);
  const [added, setAdded] = useState(null);

  useEffect(() => {
    const fetchBalance = async () => {
      const { data } = await supabase.from("profiles").select("balance").eq("id", session.user.id).single();
      setBalance(data?.balance || 0);
    };

    // Haal het bedrag op uit de transactiegeschiedenis
    const fetchLastTransaction = async () => {
      const { data } = await supabase
        .from("transactions")
        .select("amount")
        .eq("user_id", session.user.id)
        .eq("type", "top_up")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      setAdded(data?.amount || null);
    };

    fetchBalance();
    fetchLastTransaction();
  }, []);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#F8F7F4", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#0F0E0C", borderRadius: 24, padding: "40px 32px", maxWidth: 380, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🦊</div>
        <div style={{ color: "#FF5C00", fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Payment successful!</div>
        <div style={{ color: "#888", fontSize: 14, marginBottom: 28 }}>Your balance has been topped up and is ready to use.</div>
        
        {balance !== null && added !== null && (
          <div style={{ background: "#1E1D1A", borderRadius: 14, padding: "16px 20px", marginBottom: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ color: "#888", fontSize: 13 }}>Old balance</span>
              <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>€{(parseFloat(balance) - parseFloat(added)).toFixed(2)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ color: "#888", fontSize: 13 }}>Added</span>
              <span style={{ color: "#FF5C00", fontSize: 13, fontWeight: 600 }}>+€{parseFloat(added).toFixed(2)}</span>
            </div>
            <div style={{ borderTop: "1px solid #333", paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>New balance</span>
              <span style={{ color: "#FF5C00", fontSize: 14, fontWeight: 700 }}>€{parseFloat(balance).toFixed(2)}</span>
            </div>
          </div>
        )}

        <button
          onClick={() => window.location.href = "/"}
          style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
          Back to Flowva →
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  // Zichtbaarheid van de support-chat is een GLOBALE instelling (app_settings),
  // bestuurd vanuit de admin (OPS-tab). Standaard verborgen tot de admin 'm aanzet.
  const [supportBotVisible, setSupportBotVisible] = useState(false);

  useEffect(() => {
    let mounted = true;
    // Begrens elke netwerk-call zodat een trage/koude PWA-start nooit op het
    // laadscherm blijft hangen (bug: app startte soms niet → sluiten + heropenen).
    const withTimeout = (p, ms) =>
      Promise.race([Promise.resolve(p), new Promise((r) => setTimeout(() => r(null), ms))]);

    const resolveSession = async (session) => {
      if (!mounted) return;
      setSession(session);
      if (session) {
        const res = await withTimeout(
          supabase.from("profiles").select("role").eq("id", session.user.id).single(),
          4000
        ).catch(() => null);
        if (mounted) setRole(res?.data?.role || "customer");
        // Globale support-chat zichtbaarheid (admin bestuurt dit via app_settings).
        const cfg = await withTimeout(
          supabase.from("app_settings").select("support_bot_visible").eq("id", 1).single(),
          4000
        ).catch(() => null);
        if (mounted) setSupportBotVisible(cfg?.data?.support_bot_visible === true);
      } else if (mounted) {
        setRole(null);
        setSupportBotVisible(false);
      }
      if (mounted) setLoading(false);
    };

    withTimeout(supabase.auth.getSession(), 5000)
      .then((res) => resolveSession(res?.data?.session ?? null))
      .catch(() => { if (mounted) setLoading(false); });

    // Absoluut vangnet: nooit langer dan 6s op "Loading..." blijven staan.
    const safety = setTimeout(() => { if (mounted) setLoading(false); }, 6000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      resolveSession(session);
    });

    return () => { mounted = false; clearTimeout(safety); subscription.unsubscribe(); };
  }, []);

  // Publieke pagina's — geen login/auth nodig (EU-herroepingsknop + retourbeleid).
  if (window.location.pathname === "/withdraw") return <WithdrawalPage />;
  if (window.location.pathname === "/returns") return <ReturnsPage />;

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8F7F4" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🦊</div>
          <div style={{ fontSize: 14, color: "#888" }}>Loading...</div>
        </div>
      </div>
    );
  }

  // Wachtwoord-reset pagina (via maillink)
  if (window.location.pathname === "/reset-password") {
    return <ResetPassword session={session} />;
  }

  // Payment success pagina
  if (window.location.pathname === "/payment-success") {
    if (!session) return <Auth />;
    return <PaymentSuccess session={session} />;
  }

  if (!session) return (<><Auth /><InstallPrompt /></>);
  if (role === "agent") return <AgentPanel />;
  if (role === "admin") return <AdminGate />;
  return (
    <>
      <SupplyFlowApp session={session} />
      {supportBotVisible && <SupportWidget session={session} />}
      <InstallPrompt />
    </>
  );
}