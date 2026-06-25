import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { springSnappy } from "./motion";
import { pushStatus, enablePush, disablePush } from "./push";

// Kaartje in het Profiel om push-meldingen aan/uit te zetten.
// Houdt rekening met iOS (werkt alleen als de app op het beginscherm staat).
export default function PushToggle({ session }) {
  const [status, setStatus] = useState(null); // 'on'|'off'|'denied'|'needs-install'|'unsupported'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = () => pushStatus().then(setStatus).catch(() => setStatus("unsupported"));
  useEffect(() => { refresh(); }, []);

  if (status === null || status === "unsupported") return null;

  const turnOn = async () => {
    setBusy(true); setError(null);
    try { await enablePush(session); await refresh(); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };
  const turnOff = async () => {
    setBusy(true); setError(null);
    try { await disablePush(); await refresh(); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "16px 20px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: status === "on" ? "#FFF0E7" : "#F3F1ED", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, flexShrink: 0 }}>🔔</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C" }}>Notifications about your orders</div>
          <div style={{ fontSize: 12, color: "#8A8780", lineHeight: 1.4 }}>
            {status === "on" && "On — you'll get notified the moment something changes."}
            {status === "off" && "Get a ping for quality-control photos, shipping and delivery."}
            {status === "needs-install" && "Add Flowva to your home screen first (in Safari: Share → Add to Home Screen), then you can turn on notifications."}
            {status === "denied" && "Notifications are blocked. Enable them in your browser settings for flowva.app."}
          </div>
        </div>
        {status === "off" && (
          <motion.button whileTap={{ scale: 0.95 }} transition={springSnappy} onClick={turnOn} disabled={busy}
            style={{ background: busy ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer", flexShrink: 0, WebkitTapHighlightColor: "transparent" }}>
            {busy ? "..." : "Turn on"}
          </motion.button>
        )}
        {status === "on" && (
          <motion.button whileTap={{ scale: 0.95 }} transition={springSnappy} onClick={turnOff} disabled={busy}
            style={{ background: "#F3F1ED", color: "#8A8780", border: "none", borderRadius: 10, padding: "9px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0, WebkitTapHighlightColor: "transparent" }}>
            Turn off
          </motion.button>
        )}
      </div>
      {error && <div style={{ marginTop: 10, background: "#FEE2E2", color: "#DC2626", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>{error}</div>}
    </div>
  );
}
