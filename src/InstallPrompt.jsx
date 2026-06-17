import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

// Vriendelijke hint om Flowva op het beginscherm te zetten (PWA).
// - Android/Chrome: vangt het 'beforeinstallprompt'-event → echte installeer-knop.
// - iOS/Safari: geen automatisch event → toont uitleg (Deel → Zet op beginscherm).
// Verbergt zich als de app al geïnstalleerd draait of als hij is weggeklikt.

const DISMISS_KEY = "flowva_install_dismissed";

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}
function isiOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}
// Alleen Safari op iOS kan "Zet op beginscherm". Google-app/Chrome/Firefox/DDG niet.
function isSafari() {
  const ua = window.navigator.userAgent;
  return (
    /safari/i.test(ua) &&
    !/(crios|fxios|edgios|duckduckgo|gsa|fban|fbav|instagram|line|micromessenger|samsungbrowser)/i.test(ua)
  );
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [show, setShow] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return;

    // Het install-signaal is mogelijk al vroeg gevangen (in index.html, vóór React).
    if (window.__deferredInstallPrompt) {
      setDeferred(window.__deferredInstallPrompt);
      setShow(true);
    }
    const onInstallable = () => {
      setDeferred(window.__deferredInstallPrompt);
      setShow(true);
    };
    window.addEventListener("flowva-installable", onInstallable);

    // Fallback: directe listener, voor het geval het pas later afgaat.
    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS: alleen in échte Safari tonen — alleen daar kun je "Zet op beginscherm".
    // In de Google-app, Chrome-iOS, DuckDuckGo enz. verschijnt het balkje dus niet.
    let t;
    if (isiOS() && isSafari()) t = setTimeout(() => { setIosHint(true); setShow(true); }, 2500);

    return () => {
      window.removeEventListener("flowva-installable", onInstallable);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      clearTimeout(t);
    };
  }, []);

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setShow(false);
    localStorage.setItem(DISMISS_KEY, "1");
  };
  const dismiss = () => {
    setShow(false);
    localStorage.setItem(DISMISS_KEY, "1");
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 90, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          style={{
            position: "fixed", bottom: 84, left: 0, right: 0, margin: "0 auto",
            width: "calc(100% - 32px)", maxWidth: 398, background: "#0F0E0C",
            borderRadius: 16, padding: "12px 14px", display: "flex", alignItems: "center",
            gap: 12, zIndex: 190, boxShadow: "0 12px 40px rgba(17,17,17,0.35)",
          }}
        >
          <div style={{ width: 40, height: 40, borderRadius: 11, background: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>🦊</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Zet Flowva op je beginscherm</div>
            <div style={{ fontSize: 11.5, color: "#9C9893", lineHeight: 1.35 }}>
              {iosHint
                ? "Tik op ‘Deel’ ⬆️ onderin → ‘Zet op beginscherm’"
                : "Open als app"}
            </div>
          </div>
          {!iosHint && deferred && (
            <motion.button whileTap={{ scale: 0.95 }} onClick={install}
              style={{ background: "#FF5C00", color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0, WebkitTapHighlightColor: "transparent" }}>
              Installeer
            </motion.button>
          )}
          <motion.button whileTap={{ scale: 0.9 }} onClick={dismiss} aria-label="Sluiten"
            style={{ background: "rgba(255,255,255,0.08)", color: "#9C9893", border: "none", borderRadius: 10, width: 32, height: 32, fontSize: 14, cursor: "pointer", flexShrink: 0, WebkitTapHighlightColor: "transparent" }}>
            ✕
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
