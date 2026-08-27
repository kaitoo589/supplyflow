import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "./supabase";
import SupplyFlowApp from "./supplyflow-app";
import Auth, { ResetPassword } from "./Auth";
import AgentPanel from "./AgentPanel";
import SupportWidget from "./SupportWidget";
import InstallPrompt from "./InstallPrompt";
import WithdrawalPage from "./WithdrawalPage";
import ReturnsPage from "./ReturnsPage";
import LegalPage from "./LegalPage";
import privacySrc from "./legal/privacy-policy.md?raw";
import termsSrc from "./legal/terms-and-conditions.md?raw";
import returnsPolicySrc from "./legal/returns-right-of-withdrawal.md?raw";
import Fox from "./Fox";
import { track } from "./track";
import { takeReturn } from "./topup";
import { useTr } from "./i18n";

// 🌍 DOWNTIME (23-08): true = iedereen ziet de onderhoudspagina ("we bouwen wereldwijde
// verzending"), behalve de eigen accounts (profiles.is_intern) en admins/agents.
// Weer op false zetten zodra de wereldwijd-ombouw af is.
const DOWNTIME = false;

// De admin draait volledig in het gamified command center (ai-ops-hud).
// Lokaal → poort 5181; op de live site → het gedeployde admin-dashboard.
// VITE_HUD_URL overschrijft beide (zet die als je later admin.flowva.app koppelt).

// 🌍 Onderhoudspagina tijdens de wereldwijd-ombouw (23-08). Flowva-stijl: rustig,
// eerlijk, met de vos — en een TikTok-verwijzing zodat mensen weten waar het
// "we zijn terug"-bericht verschijnt. Het Team-linkje onderaan opent het gewone
// inlogscherm (eigen accounts komen daarna automatisch binnen).
function DowntimePage({ ingelogd, onTeam }) {
  const tr = useTr();
  // Meten wie er langskwam terwijl we op zwart stonden (Kaito 23-08): eigen actie
  // "downtime" in de trechter, zodat de admin een teller heeft.
  useEffect(() => { track("downtime"); }, []);
  return (
    <div style={{ minHeight: "100vh", background: "#F8F7F4", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "-apple-system, 'SF Pro Display', 'Segoe UI', sans-serif" }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <div style={{ width: 84, height: 84, borderRadius: 24, background: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 46, margin: "0 auto 22px", boxShadow: "0 12px 34px rgba(255,92,0,0.35)" }}><Fox /></div>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, color: "#FF5C00", marginBottom: 10 }}>FLOWVA</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#111111", margin: "0 0 12px", lineHeight: 1.25 }}>
          {tr("downtime.title", "We're going worldwide 🌍")}
        </h1>
        <p style={{ fontSize: 15, color: "#5A5853", lineHeight: 1.6, margin: "0 0 8px" }}>
          {tr("downtime.body", "Flowva is offline for a little while — we're rebuilding the app so we can ship worldwide.")}
        </p>
        <p style={{ fontSize: 15, color: "#5A5853", lineHeight: 1.6, margin: "0 0 22px" }}>
          {tr("downtime.body2", "We're working as fast as we can. Check back soon!")}
        </p>
        <a href="https://www.tiktok.com/@flowva.app" target="_blank" rel="noreferrer"
          style={{ display: "inline-block", background: "#111111", color: "#fff", borderRadius: 12, padding: "13px 22px", fontSize: 14, fontWeight: 700, textDecoration: "none" }}>
          {tr("downtime.tiktok", "Follow @flowva.app on TikTok — we'll post the moment we're back")}
        </a>
        <div style={{ marginTop: 34 }}>
          {ingelogd
            ? <button onClick={() => supabase.auth.signOut()} style={{ background: "none", border: "none", color: "#B7B3AD", fontSize: 11.5, cursor: "pointer" }}>{tr("downtime.logout", "Log out")}</button>
            : <button onClick={onTeam} style={{ background: "none", border: "none", color: "#D9D6D0", fontSize: 11, cursor: "pointer" }}>Team</button>}
        </div>
      </div>
    </div>
  );
}

function AdminGate() {
  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const hudUrl =
    import.meta.env.VITE_HUD_URL ||
    (isLocal ? "http://localhost:5181" : "https://flowva-admin.vercel.app");
  return (
    <div style={{ fontFamily: "'Cascadia Mono', 'JetBrains Mono', Consolas, monospace", background: "#070b07", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#0b100b", border: "1px solid #2c4a2c", borderRadius: 8, padding: "28px 30px", maxWidth: 420, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}><Fox /></div>
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
  // Trechter: opwaarderen afgerond — de klant landt hier alleen na een geslaagde
  // Stripe-betaling. Eén keer melden per bezoek aan deze pagina.
  useEffect(() => { track("topup_done"); }, []);
  // Kwam de klant hier vanuit een betaling die net te weinig saldo had? Dan
  // brengt "terug" hem naar dat scherm terug i.p.v. naar de feed, zodat hij
  // alleen nog op Order & pay hoeft te drukken. Eenmalig uitlezen (takeReturn
  // wist de marker), dus in state — niet per render.
  const [backTo] = useState(() => takeReturn());

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
        <div style={{ fontSize: 64, marginBottom: 16 }}><Fox /></div>
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
          onClick={() => window.location.href = backTo || "/"}
          style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
          {backTo ? "Back to your order →" : "Back to Flowva →"}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [isIntern, setIsIntern] = useState(false);
  const [teamLogin, setTeamLogin] = useState(false);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  // Boot-moment: het vos-logo staat even groot in beeld en zoomt dan weg zodra de app
  // klaar is — de app "start" i.p.v. dat er een website laadt. Min. ~0,4s zichtbaar.
  const [bootSplash, setBootSplash] = useState(true);
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => setBootSplash(false), 400);
    return () => clearTimeout(t);
  }, [loading]);
  // Zichtbaarheid van de support-chat is een GLOBALE instelling (app_settings),
  // bestuurd vanuit de admin (OPS-tab). Standaard verborgen tot de admin 'm aanzet.
  const [supportBotVisible, setSupportBotVisible] = useState(false);
  // Staan de fabrieken (Feed-tab) aan? Óók een globale app_settings-vlag, maar deze
  // geldt net zo goed voor GASTEN — zij browsen mee en moeten dezelfde etalage-vorm
  // zien. Standaard aan: bij een trage/mislukte lees-call blijft de app zoals hij is.
  const [factoriesVisible, setFactoriesVisible] = useState(true);

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
          supabase.from("profiles").select("role, is_intern").eq("id", session.user.id).single(),
          4000
        ).catch(() => null);
        if (mounted) { setRole(res?.data?.role || "customer"); setIsIntern(res?.data?.is_intern === true); }
      } else if (mounted) {
        setRole(null);
        setIsIntern(false);
      }
      // Globale zichtbaarheidsvlaggen (admin bestuurt deze via app_settings). Ook
      // ZONDER sessie ophalen: gasten browsen mee en moeten dezelfde etalage zien.
      const cfg = await withTimeout(
        supabase.from("app_settings").select("support_bot_visible, factories_visible, paused_countries, trustpilot_score, trustpilot_count").eq("id", 1).single(),
        4000
      ).catch(() => null);
      if (mounted) {
        // Ook GASTEN zien de support-knop (mens-support, sinds 2026-08-13): het paneel
        // legt hen uit dat chatten een gratis account vraagt. Contact vindbaar = vertrouwen.
        setSupportBotVisible(cfg?.data?.support_bot_visible === true);
        // Alleen expliciet false verbergt de fabrieken — een mislukte call laat alles staan.
        if (cfg?.data) setFactoriesVisible(cfg.data.factories_visible !== false);
        // 🌍 pauzeknop per land: gepauzeerde landen verdwijnen uit het adresformulier
        if (cfg?.data && Array.isArray(cfg.data.paused_countries)) window.__flowvaPausedCountries = cfg.data.paused_countries;
        // ★ Trustpilot-embleem (handmatig bijgehouden in de HUD). 0/0 is een GELDIGE,
        // eerlijke stand (Kaito 25-08): grijze sterren + streepje + "0 reviews".
        // Alleen LEEG (null) verbergt het embleem helemaal.
        if (cfg?.data?.trustpilot_score != null && cfg?.data?.trustpilot_count != null) {
          window.__flowvaTrustpilot = { score: Number(cfg.data.trustpilot_score), count: Number(cfg.data.trustpilot_count) };
        }
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
  if (window.location.pathname === "/privacy") return <LegalPage source={privacySrc} />;
  if (window.location.pathname === "/terms") return <LegalPage source={termsSrc} />;
  if (window.location.pathname === "/returns-policy") return <LegalPage source={returnsPolicySrc} />;

  // De splash-overlay: groot vos-logo veert binnen; bij het wegzoomen (exit) is de app
  // eronder al zichtbaar → voelt als een echte app-start.
  const bootOverlay = (
    <AnimatePresence>
      {bootSplash && (
        <motion.div key="boot" exit={{ opacity: 0 }} transition={{ duration: 0.28, ease: "easeOut" }}
          style={{ position: "fixed", inset: 0, zIndex: 9990, background: "#F8F7F4", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <motion.div initial={{ scale: 0.55, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.3, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 22 }}
            style={{ fontSize: 72, lineHeight: 1 }}>
            <Fox still />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ delay: 0.12, duration: 0.3 }}
            style={{ marginTop: 14, color: "#FF5C00", fontSize: 13, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", fontFamily: "'Inter', sans-serif" }}>
            Flowva
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (loading) {
    return bootOverlay;
  }

  // Wachtwoord-reset pagina (via maillink)
  if (window.location.pathname === "/reset-password") {
    return <ResetPassword session={session} />;
  }

  // Payment success pagina
  if (window.location.pathname === "/payment-success") {
    if (loading) return bootOverlay;
    if (!session) return <Auth />;
    return <PaymentSuccess session={session} />;
  }

  // Browse-first: gasten (geen sessie) mogen de etalage in; acties die identiteit/geld raken
  // vragen in-app om een account (zie SupplyFlow → requireAuth). Alleen ingelogde admins/agents
  // krijgen hun eigen paneel.
  if (session && role === "agent") return <AgentPanel />;
  if (session && role === "admin") return <AdminGate />;
  // 🌍 Onderhoudsscherm: gasten en gewone klanten zien de downtime-pagina; de eigen
  // accounts (is_intern) gaan er dwars doorheen en zien de app zoals altijd.
  if (DOWNTIME && !(session && isIntern)) {
    if (loading) return bootOverlay;
    if (teamLogin && !session) return <Auth />;
    return <DowntimePage ingelogd={!!session} onTeam={() => setTeamLogin(true)} />;
  }
  return (
    <>
      <SupplyFlowApp session={session} factoriesVisible={factoriesVisible} />
      {supportBotVisible && <SupportWidget session={session} />}
      <InstallPrompt />
      {bootOverlay}
    </>
  );
}