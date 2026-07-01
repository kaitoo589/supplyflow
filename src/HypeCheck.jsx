import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { castVote, getVoteStats } from "./votes";
import { garmentType } from "./garment";

const OPTIONS = [
  { key: "no", emoji: "👎", label: "Not for me" },
  { key: "nice", emoji: "🤍", label: "It's nice" },
  { key: "yes", emoji: "🔥", label: "I'd buy this" },
  { key: "notify", emoji: "🔔", label: "Notify me" },
];

// Hype check: de stem-sheet voor een "Coming soon"-demo-product. Niet koopbaar — je laat
// alleen weten hoe tof je 't vindt. Uitslag (percentage + aantal stemmen) staat er altijd.
export default function HypeCheckSheet({ product, session, onClose, onRequireAuth, initialStats, initialMyVote, onVoted }) {
  const hasSession = !!session;
  const [stats, setStats] = useState(initialStats || null);
  const [myVote, setMyVote] = useState(initialMyVote || null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getVoteStats([product.id]).then((m) =>
      setStats(m[product.id] || { product_id: product.id, total: 0, yes: 0, nice: 0, no: 0, notify: 0, accounts: 0, guests: 0 })
    );
  }, [product.id]);

  const photos = [...new Set([...(product.gallery || []), product.image].filter((u) => typeof u === "string" && u.startsWith("http")))];
  const photo = photos[0] || null;
  const optSummary = (product.sizes || [])
    .filter((v) => v && v.name)
    .map((v) => `${(v.options || v.values || []).length || "?"} ${String(v.name).toLowerCase()}`)
    .join(" · ");

  const vote = async (key) => {
    if (busy) return;
    // Gast + "notify" → we hebben een account nodig om 'm te kunnen pingen zodra 't live gaat.
    if (!hasSession && key === "notify") { onRequireAuth?.(); return; }
    setBusy(true);
    const prev = myVote;
    setMyVote(key); // optimistisch
    const { data, error } = await castVote(product.id, key, hasSession);
    if (error || !data?.ok) { setMyVote(prev); setBusy(false); return; }
    const m = await getVoteStats([product.id]);
    if (m[product.id]) setStats(m[product.id]);
    setBusy(false);
    onVoted?.(product.id, m[product.id], key);
  };

  const s = stats || { total: 0, yes: 0, nice: 0, no: 0, notify: 0 };
  const pref = s.no + s.nice + s.yes;
  const pctYes = pref > 0 ? Math.round((100 * s.yes) / pref) : 0;
  const pctNice = pref > 0 ? Math.round((100 * s.nice) / pref) : 0;
  const pctNo = pref > 0 ? Math.max(0, 100 - pctYes - pctNice) : 0;

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }} />
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }}
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#0F0E0C", borderRadius: "24px 24px 0 0", zIndex: 301, maxHeight: "92vh", overflowY: "auto", padding: "16px 18px 32px" }}>
        <div onClick={onClose} style={{ padding: "0 0 12px", cursor: "pointer" }}>
          <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, margin: "0 auto" }} />
        </div>

        {photo && (
          <div style={{ position: "relative", height: 190, background: "#1a1a1a", borderRadius: 16, overflow: "hidden", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img src={photo} referrerPolicy="no-referrer" alt={product.title} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            <span style={{ position: "absolute", top: 10, right: 10, background: "#F5C518", color: "#4a3800", fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 9 }}>Coming soon</span>
          </div>
        )}

        <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", lineHeight: 1.3 }}>{product.title}</div>
        <div style={{ fontSize: 11.5, color: "#9C9893", marginTop: 3, marginBottom: 12 }}>
          {[optSummary, product.price != null ? `€${Number(product.price).toFixed(2)} factory price` : null, garmentType(product.title)].filter(Boolean).join(" · ")}
        </div>

        <div style={{ fontSize: 12.5, color: "#C9C6C1", lineHeight: 1.55, background: "#1A1917", borderRadius: 12, padding: "11px 13px", marginBottom: 14 }}>
          Should we add this? Fresh from the factory, not live yet. Cast your vote — enough love and it drops for real.
        </div>

        <div style={{ fontSize: 12.5, color: "#fff", fontWeight: 700, marginBottom: 9 }}>Hype check — would you buy this?</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {OPTIONS.map((o) => {
            const sel = myVote === o.key;
            const accent = o.key === "yes";
            return (
              <motion.button key={o.key} whileTap={busy ? undefined : { scale: 0.95 }} disabled={busy} onClick={() => vote(o.key)}
                style={{ background: sel ? "#2a1c0f" : "#1A1917", border: `1px solid ${sel ? "#FF5C00" : "#2c2b29"}`, borderRadius: 12, padding: "12px 8px", textAlign: "center", color: sel || accent ? "#FF8A3D" : "#C9C6C1", fontSize: 12.5, fontWeight: 700, cursor: busy ? "default" : "pointer", WebkitTapHighlightColor: "transparent" }}>
                {o.emoji} {o.label}{sel ? " ✓" : ""}
              </motion.button>
            );
          })}
        </div>

        {s.total === 0 ? (
          <div style={{ fontSize: 11.5, color: "#9C9893", textAlign: "center" }}>Be the first to vote 🔥</div>
        ) : (
          <>
            <div style={{ height: 9, borderRadius: 6, overflow: "hidden", display: "flex", marginBottom: 7, background: "#1A1917" }}>
              <div style={{ width: `${pctYes}%`, background: "#FF5C00" }} />
              <div style={{ width: `${pctNice}%`, background: "#5a5852" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9C9893" }}>
              <span><span style={{ color: "#FF8A3D", fontWeight: 700 }}>🔥 {pctYes}% would buy</span> · 🤍 {pctNice}% · 👎 {pctNo}%</span>
              <span>{s.total} vote{s.total === 1 ? "" : "s"}</span>
            </div>
            {s.notify > 0 && (
              <div style={{ fontSize: 11, color: "#9C9893", marginTop: 6 }}>🔔 {s.notify} {s.notify === 1 ? "person wants" : "people want"} a heads-up when it drops</div>
            )}
          </>
        )}
      </motion.div>
    </>
  );
}
