import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronUp, ChevronDown, X } from "lucide-react";

// Install-balk: verschijnt alleen in Chrome (Android) of Safari (iOS), niet als
// de app al geïnstalleerd is. Wegklikken = 1 dag snooze (komt morgen terug).
// Subtiel ↑-pijltje morpht de balk omhoog naar een paneel met uitleg.

const SNOOZE_KEY = "flowva_install_snooze";   // datum (YYYY-MM-DD) van laatste wegklik
const INSTALLED_KEY = "flowva_installed";     // gezet zodra de app standalone draait

// >>> Uitlegtekst in het opengeklapte paneel — pas deze regel aan om te wisselen <<<
const EXPLAIN_TEXT =
  "Volg je bestelling van de fabriek tot je deur — en krijg een seintje bij elke stap. Geen app store nodig: Flowva komt als icoon op je beginscherm en opent fullscreen, net als een echte app.";

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}
function isiOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}
function isSafari() {
  const ua = window.navigator.userAgent;
  return (
    /safari/i.test(ua) &&
    !/(crios|fxios|edgios|duckduckgo|gsa|fban|fbav|instagram|line|micromessenger|samsungbrowser)/i.test(ua)
  );
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [show, setShow] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Draait de app als geïnstalleerde app? Onthoud dat en toon nooit.
    if (isStandalone()) { localStorage.setItem(INSTALLED_KEY, "1"); return; }
    // Eerder al gedetecteerd als geïnstalleerd → nooit tonen.
    if (localStorage.getItem(INSTALLED_KEY)) return;
    // Vandaag weggeklikt → vandaag niet, morgen weer.
    if (localStorage.getItem(SNOOZE_KEY) === today()) return;

    let cancelled = false;
    const cleanups = [];

    const maybeShow = () => {
      if (cancelled) return;
      // Android/Chromium: het install-signaal is mogelijk al vroeg gevangen.
      if (window.__deferredInstallPrompt) { setDeferred(window.__deferredInstallPrompt); setShow(true); }
      const onInstallable = () => { setDeferred(window.__deferredInstallPrompt); setShow(true); };
      window.addEventListener("flowva-installable", onInstallable);
      const onPrompt = (e) => { e.preventDefault(); setDeferred(e); setShow(true); };
      window.addEventListener("beforeinstallprompt", onPrompt);
      cleanups.push(() => {
        window.removeEventListener("flowva-installable", onInstallable);
        window.removeEventListener("beforeinstallprompt", onPrompt);
      });
      // iOS: alleen in échte Safari (alleen daar kun je "Zet op beginscherm").
      if (isiOS() && isSafari()) {
        const t = setTimeout(() => { setIosHint(true); setShow(true); }, 2500);
        cleanups.push(() => clearTimeout(t));
      }
    };

    // Android Chrome kan ook actief detecteren of de PWA al geïnstalleerd is.
    if (navigator.getInstalledRelatedApps) {
      navigator
        .getInstalledRelatedApps()
        .then((apps) => {
          if (apps && apps.length > 0) localStorage.setItem(INSTALLED_KEY, "1");
          else maybeShow();
        })
        .catch(maybeShow);
    } else {
      maybeShow();
    }

    return () => { cancelled = true; cleanups.forEach((fn) => fn()); };
  }, []);

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice?.outcome === "accepted") localStorage.setItem(INSTALLED_KEY, "1");
    setDeferred(null);
    setShow(false);
  };
  // Wegklikken = 1 dag snooze.
  const dismiss = () => {
    setShow(false);
    localStorage.setItem(SNOOZE_KEY, today());
  };

  const fox = (
    <div style={{ width: 40, height: 40, borderRadius: 11, background: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>🦊</div>
  );
  const installCta =
    iosHint ? (
      <div style={{ background: "#1A1917", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, color: "#C9C6C1", lineHeight: 1.5 }}>
        Tik onderin op <b style={{ color: "#fff" }}>Deel</b> ⬆️ → <b style={{ color: "#fff" }}>Zet op beginscherm</b> → Voeg toe.
      </div>
    ) : deferred ? (
      <motion.button whileTap={{ scale: 0.97 }} onClick={install}
        style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "13px", fontSize: 14, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
        📲 Installeer Flowva
      </motion.button>
    ) : null;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="installbar"
          layout
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 90, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          style={{ position: "fixed", bottom: 84, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 32px)", maxWidth: 398, background: "#0F0E0C", borderRadius: 18, zIndex: 190, boxShadow: "0 12px 40px rgba(17,17,17,0.35)", overflow: "hidden" }}
        >
          {!expanded ? (
            <motion.div layout="position" style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
              {fox}
              <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setExpanded(true)}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Zet Flowva op je beginscherm</div>
                <div style={{ fontSize: 11.5, color: "#9C9893" }}>Open als app — bekijk waarom</div>
              </div>
              <motion.button whileTap={{ scale: 0.85 }} onClick={() => setExpanded(true)} aria-label="Meer info"
                animate={{ y: [0, -2.5, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,92,0,0.15)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, WebkitTapHighlightColor: "transparent" }}>
                <ChevronUp size={17} color="#FF5C00" strokeWidth={2.6} />
              </motion.button>
              <motion.button whileTap={{ scale: 0.9 }} onClick={dismiss} aria-label="Sluiten"
                style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,255,255,0.08)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, WebkitTapHighlightColor: "transparent" }}>
                <X size={14} color="#9C9893" />
              </motion.button>
            </motion.div>
          ) : (
            <motion.div layout="position" style={{ padding: "8px 16px 16px" }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 2 }}>
                <motion.button whileTap={{ scale: 0.85 }} onClick={() => setExpanded(false)} aria-label="Inklappen"
                  style={{ background: "none", border: "none", padding: 6, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                  <ChevronDown size={20} color="#5A5853" strokeWidth={2.4} />
                </motion.button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                {fox}
                <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>Waarom Flowva als app?</div>
              </div>
              <div style={{ fontSize: 12.5, color: "#C9C6C1", lineHeight: 1.55, marginBottom: 12 }}>{EXPLAIN_TEXT}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 14 }}>
                {[
                  ["🔔", "Melding bij QC-foto's, verzending en bezorging"],
                  ["⚡", "Sneller en fullscreen — net een echte app"],
                  ["🦊", "Eigen icoon op je beginscherm"],
                ].map(([icon, text]) => (
                  <div key={text} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 15, width: 20, textAlign: "center", flexShrink: 0 }}>{icon}</span>
                    <span style={{ fontSize: 12.5, color: "#C9C6C1" }}>{text}</span>
                  </div>
                ))}
              </div>
              {installCta}
              <button onClick={dismiss}
                style={{ width: "100%", marginTop: 8, background: "transparent", color: "#5A5853", border: "none", padding: "8px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Misschien later
              </button>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
