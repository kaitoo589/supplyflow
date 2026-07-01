import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { castVote, getVoteStats } from "./votes";
import { garmentType } from "./garment";
import PhotoZoom from "./PhotoZoom";
import Fox from "./Fox";
import { WordReveal, SpeechBubble } from "./MotionBits";
import { springSnappy, springSoft, springBouncy } from "./motion";

const OPTIONS = [
  { key: "no", emoji: "👎", label: "Not for me" },
  { key: "nice", emoji: "🤍", label: "It's nice" },
  { key: "yes", emoji: "🔥", label: "I'd buy this" },
  { key: "notify", emoji: "🔔", label: "Notify me" },
];

// 🔥-stem: het vuurtje vliegt (draaiend, met een boogje in schaal) van de knop naar het
// vuurtje bij de uitslag en "ontsteekt" daar de balk. Via een portal met viewport-coördinaten,
// zodat transforms/scroll van de sheet de vlucht niet kunnen verstoren.
function FlyingFire({ flight, onDone }) {
  return createPortal(
    <motion.span
      initial={{ x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }}
      animate={{ x: flight.tx - flight.fx, y: flight.ty - flight.fy, rotate: [0, -28, 16, 0], scale: [1, 1.4, 0.9], opacity: [1, 1, 0.85] }}
      transition={{ x: { duration: 0.55, ease: [0.32, 0.72, 0, 1] }, y: { duration: 0.55, ease: [0.32, 0.72, 0, 1] }, rotate: { duration: 0.55 }, scale: { duration: 0.55, times: [0, 0.55, 1] }, opacity: { duration: 0.55, times: [0, 0.85, 1] } }}
      onAnimationComplete={onDone}
      style={{ position: "fixed", left: flight.fx, top: flight.fy, zIndex: 9600, fontSize: 15, lineHeight: 1, pointerEvents: "none", display: "inline-block" }}>
      🔥
    </motion.span>,
    document.body,
  );
}

// Hype check: de stem-sheet voor een "Coming soon"-demo-product. Niet koopbaar — je laat
// alleen weten hoe tof je 't vindt. Uitslag (percentage + aantal stemmen) staat er altijd.
export default function HypeCheckSheet({ product, session, onClose, onRequireAuth, initialStats, initialMyVote, onVoted }) {
  const hasSession = !!session;
  const [stats, setStats] = useState(initialStats || null);
  const [myVote, setMyVote] = useState(initialMyVote || null);
  const [busy, setBusy] = useState(false);
  const [zoomIdx, setZoomIdx] = useState(null);
  const [galIdx, setGalIdx] = useState(0);
  // Gast tikt 🔔 → geen kaal inlogscherm, maar een moment: de bel morpht (draaiend) naar het
  // midden, de vos verschijnt met een woord-voor-woord spraakwolk, en de bel landt precies op
  // het belletje aan het eind van de zin. Daarna pas de (optionele) registreer-knop.
  const [notifyPrompt, setNotifyPrompt] = useState(false);
  const [bellLanded, setBellLanded] = useState(false);
  const [showCta, setShowCta] = useState(false);
  useEffect(() => {
    if (!notifyPrompt) { setBellLanded(false); setShowCta(false); return; }
    const t1 = setTimeout(() => setBellLanded(true), 1650);   // ná de WordReveal → bel landt op de zin
    const t2 = setTimeout(() => setShowCta(true), 2100);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [notifyPrompt]);
  // Per-knop micro-momenten: 🔥 vliegt naar de uitslag-balk (+ glans-sweep bij landing),
  // 🤍 flipt even naar 🧡, 👎 krijgt een sportieve vos-reactie.
  const fireEmojiRef = useRef(null);
  const statFireRef = useRef(null);
  const [fireFlight, setFireFlight] = useState(null);   // {fx,fy,tx,ty}
  const [barShine, setBarShine] = useState(0);          // teller → glans-sweep + vuur-pop bij de uitslag
  const [heartOrange, setHeartOrange] = useState(false);
  const [foxNope, setFoxNope] = useState(0);
  useEffect(() => {
    if (!heartOrange) return;
    const t = setTimeout(() => setHeartOrange(false), 950);
    return () => clearTimeout(t);
  }, [heartOrange]);
  useEffect(() => {
    if (!foxNope) return;
    const t = setTimeout(() => setFoxNope(0), 1900);
    return () => clearTimeout(t);
  }, [foxNope]);

  useEffect(() => {
    getVoteStats([product.id]).then((m) =>
      setStats(m[product.id] || { product_id: product.id, total: 0, yes: 0, nice: 0, no: 0, notify: 0, accounts: 0, guests: 0 })
    );
  }, [product.id]);

  // Live uitslag: peil elke 4s de stemmen zodat je andermans stemmen vrijwel direct ziet
  // binnenkomen — met een "+N"-floatje per nieuwe reactie (gebundeld, dus geen spam bij
  // een golf). Je eigen stem update sowieso meteen.
  const dragControls = useDragControls();
  const [floats, setFloats] = useState([]);
  const statsRef = useRef(null);
  useEffect(() => { statsRef.current = stats; }, [stats]);
  useEffect(() => {
    const iv = setInterval(async () => {
      const m = await getVoteStats([product.id]);
      const next = m[product.id];
      if (!next) return;
      const prev = statsRef.current;
      if (prev && prev.total != null) {
        const diffs = [
          { emoji: "🔥", n: next.yes - prev.yes },
          { emoji: "🤍", n: next.nice - prev.nice },
          { emoji: "👎", n: next.no - prev.no },
          { emoji: "🔔", n: next.notify - prev.notify },
        ].filter((d) => d.n > 0);
        if (diffs.length) {
          const base = Date.now();
          const items = diffs.map((d, i) => ({ id: base + i, off: 6 + i * 34 + Math.random() * 12, ...d }));
          setFloats((f) => [...f, ...items]);
          const ids = items.map((x) => x.id);
          setTimeout(() => setFloats((f) => f.filter((x) => !ids.includes(x.id))), 1500);
        }
      }
      setStats(next);
    }, 4000);
    return () => clearInterval(iv);
  }, [product.id]);

  const photos = [...new Set([...(product.gallery || []), product.image].filter((u) => typeof u === "string" && u.startsWith("http")))];
  const photo = photos[0] || null;
  const optSummary = (product.sizes || [])
    .filter((v) => v && v.name)
    .map((v) => `${(v.options || v.values || []).length || "?"} ${String(v.name).toLowerCase()}`)
    .join(" · ");

  const vote = async (key) => {
    if (busy) return;
    // 🔔 → altijd het bel-vos-moment. Gast: uitleg dat een account nodig is (stemmen kan
    // dan nog niet). Ingelogd: "you're on the list" — de stem registreert op de achtergrond.
    if (key === "notify") {
      setNotifyPrompt(hasSession ? "user" : "guest");
      if (!hasSession) return;
    }
    // Micro-momenten meteen bij de tik (voelt instant, los van de server-roundtrip).
    if (key === "yes") {
      const f = fireEmojiRef.current?.getBoundingClientRect();
      const t = statFireRef.current?.getBoundingClientRect();
      if (f && t) setFireFlight({ fx: f.left, fy: f.top, tx: t.left, ty: t.top });
    } else if (key === "nice") {
      setHeartOrange(true);
    } else if (key === "no") {
      setFoxNope((n) => n + 1);
    }
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
        drag="y" dragControls={dragControls} dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.55 }}
        onDragEnd={(e, info) => { if (info.offset.y > 110 || info.velocity.y > 650) onClose(); }}
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#0F0E0C", borderRadius: "24px 24px 0 0", zIndex: 301, maxHeight: "92vh", overflowY: "auto", padding: "16px 18px 32px" }}>
        <div onClick={onClose} onPointerDown={(e) => dragControls.start(e)} style={{ padding: "0 0 12px", cursor: "grab", touchAction: "none" }}>
          <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, margin: "0 auto" }} />
        </div>

        {photos.length > 0 && (
          <div style={{ position: "relative", marginBottom: 12 }}>
            <div onScroll={(e) => { const w = e.currentTarget.clientWidth || 1; setGalIdx(Math.round(e.currentTarget.scrollLeft / w)); }}
              style={{ display: "flex", overflowX: "auto", scrollSnapType: "x mandatory", borderRadius: 16, background: "#1a1a1a", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
              {photos.map((url, i) => (
                <div key={url} onClick={() => setZoomIdx(i)} style={{ flex: "0 0 100%", scrollSnapAlign: "center", height: 220, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-in" }}>
                  <img src={url} referrerPolicy="no-referrer" alt={product.title} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                </div>
              ))}
            </div>
            <span style={{ position: "absolute", top: 10, right: 10, background: "#F5C518", color: "#4a3800", fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 9, pointerEvents: "none" }}>Coming soon</span>
            {photos.length > 1 && (
              <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6, pointerEvents: "none" }}>
                {photos.map((_, i) => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i === galIdx ? "#fff" : "rgba(255,255,255,0.45)" }} />)}
              </div>
            )}
            <div style={{ position: "absolute", bottom: 8, right: 10, background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 10, padding: "2px 7px", borderRadius: 7, pointerEvents: "none" }}>tap to zoom</div>
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
            const isBell = o.key === "notify";
            return (
              <motion.button key={o.key} disabled={busy} onClick={() => vote(o.key)}
                whileHover={{ y: -2 }} whileTap={busy ? undefined : { scale: 0.88 }}
                animate={sel ? { scale: [1, 1.07, 1] } : { scale: 1 }}
                transition={springSnappy}
                style={{ background: sel ? "#2a1c0f" : "#1A1917", border: `1px solid ${sel ? "#FF5C00" : "#2c2b29"}`, borderRadius: 12, padding: "12px 8px", textAlign: "center", color: sel || accent ? "#FF8A3D" : "#C9C6C1", fontSize: 12.5, fontWeight: 700, cursor: busy ? "default" : "pointer", WebkitTapHighlightColor: "transparent" }}>
                {isBell && notifyPrompt
                  ? <span style={{ opacity: 0, display: "inline-block" }}>{o.emoji}</span>
                  : o.key === "nice"
                  ? <motion.span animate={sel ? { rotate: [0, -14, 10, 0] } : { rotate: 0 }} transition={{ duration: 0.45 }} style={{ display: "inline-block" }}>
                      {/* kaart-flip: 🤍 → 🧡 en (na ~1s) weer terug */}
                      <motion.span animate={{ rotateY: heartOrange ? 180 : 0 }} transition={springSnappy} style={{ display: "inline-block", transformStyle: "preserve-3d", position: "relative" }}>
                        <span style={{ display: "inline-block", backfaceVisibility: "hidden" }}>🤍</span>
                        <span aria-hidden style={{ position: "absolute", inset: 0, display: "inline-block", transform: "rotateY(180deg)", backfaceVisibility: "hidden" }}>🧡</span>
                      </motion.span>
                    </motion.span>
                  : <motion.span ref={o.key === "yes" ? fireEmojiRef : undefined} layoutId={isBell ? "hype-bell" : undefined}
                      animate={sel ? { rotate: [0, -18, 14, -6, 0], scale: [1, 1.35, 1] } : { rotate: 0, scale: 1 }}
                      transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
                      style={{ display: "inline-block", opacity: o.key === "yes" && fireFlight ? 0 : 1 }}>{o.emoji}</motion.span>}
                {" "}{o.label}{sel ? " ✓" : ""}
              </motion.button>
            );
          })}
        </div>

        {s.total === 0 ? (
          <div style={{ fontSize: 11.5, color: "#9C9893", textAlign: "center" }}>Be the first to vote <span ref={statFireRef} style={{ display: "inline-block" }}>🔥</span></div>
        ) : (
          <div style={{ position: "relative" }}>
            {floats.map((f) => (
              <motion.span key={f.id} initial={{ opacity: 0, y: 8, scale: 0.8 }} animate={{ opacity: [0, 1, 1, 0], y: -30, scale: 1 }}
                transition={{ duration: 1.35, ease: "easeOut" }}
                style={{ position: "absolute", right: f.off, top: -10, fontSize: 12, fontWeight: 800, color: "#FF8A3D", pointerEvents: "none", zIndex: 2 }}>
                +{f.n} {f.emoji}
              </motion.span>
            ))}
            <div style={{ height: 9, borderRadius: 6, overflow: "hidden", display: "flex", marginBottom: 7, background: "#1A1917" }}>
              <motion.div animate={{ width: `${pctYes}%` }} transition={springSoft} style={{ background: "#FF5C00", position: "relative", overflow: "hidden" }}>
                {barShine > 0 && (
                  <motion.div key={barShine} initial={{ x: "-130%" }} animate={{ x: "340%" }} transition={{ duration: 0.55, ease: "easeOut" }}
                    style={{ position: "absolute", top: 0, bottom: 0, width: "45%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)" }} />
                )}
              </motion.div>
              <motion.div animate={{ width: `${pctNice}%` }} transition={springSoft} style={{ background: "#5a5852" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9C9893" }}>
              <span>
                <motion.span key={`${pctYes}-${s.total}-${barShine}`} initial={{ scale: 1.25, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} transition={springSnappy}
                  style={{ display: "inline-block", color: "#FF8A3D", fontWeight: 700 }}><span ref={statFireRef} style={{ display: "inline-block" }}>🔥</span> {pctYes}% would buy</motion.span> · 🤍 {pctNice}% · 👎 {pctNo}%
              </span>
              <span>{s.total} vote{s.total === 1 ? "" : "s"}</span>
            </div>
            {s.notify > 0 && (
              <div style={{ fontSize: 11, color: "#9C9893", marginTop: 6 }}>🔔 {s.notify} {s.notify === 1 ? "person wants" : "people want"} a heads-up when it drops</div>
            )}
          </div>
        )}
      </motion.div>

      {/* 🔔-moment voor gasten: de bel vliegt draaiend uit de knop naar het midden (shared
          layoutId), de vos verschijnt met een woord-voor-woord wolk, en de bel landt exact op
          het belletje aan het eind van de zin. Backdrop-tik = terug (bel morpht netjes terug). */}
      <AnimatePresence>
        {notifyPrompt && (
          <>
            <motion.div key="np-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setNotifyPrompt(false)}
              style={{ position: "fixed", inset: 0, zIndex: 320, background: "rgba(0,0,0,0.78)", backdropFilter: "blur(10px)" }} />
            <motion.div key="np-fg" initial={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ position: "fixed", inset: 0, zIndex: 321, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 26px", pointerEvents: "none" }}>
              <div style={{ height: 92, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {!bellLanded && (
                  <motion.span layoutId="hype-bell"
                    animate={{ rotate: [0, -28, 20, -10, 0] }}
                    transition={{ layout: { type: "spring", stiffness: 260, damping: 24 }, rotate: { duration: 0.8, ease: [0.32, 0.72, 0, 1] } }}
                    style={{ display: "inline-block", fontSize: 56, filter: "drop-shadow(0 10px 28px rgba(245,197,24,0.4))" }}>🔔</motion.span>
                )}
              </div>
              <motion.div initial={{ opacity: 0, y: 22, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.42, ...springBouncy }}
                style={{ display: "flex", gap: 10, alignItems: "flex-end", width: "100%", maxWidth: 340, pointerEvents: "auto" }}>
                <span style={{ fontSize: 34, flexShrink: 0, lineHeight: 1 }}><Fox /></span>
                <SpeechBubble bg="#1E1D1A" color="#fff">
                  <span style={{ fontSize: 13.5, lineHeight: 1.6, fontWeight: 600 }}>
                    <WordReveal text={notifyPrompt === "user" ? "You're on the list — we'll ping you when it drops" : "Register or log in if you want to get notified"} delay={0.75} stagger={0.07} />{" "}
                    {bellLanded
                      ? <motion.span layoutId="hype-bell"
                          animate={{ rotate: [0, -22, 16, -8, 0] }}
                          transition={{ layout: { type: "spring", stiffness: 300, damping: 24 }, rotate: { delay: 0.4, duration: 0.55, ease: [0.32, 0.72, 0, 1] } }}
                          style={{ display: "inline-block" }}>🔔</motion.span>
                      : <span style={{ opacity: 0, display: "inline-block" }}>🔔</span>}
                  </span>
                </SpeechBubble>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 14 }} animate={showCta ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }} transition={springSoft}
                style={{ marginTop: 24, width: "100%", maxWidth: 320, pointerEvents: showCta ? "auto" : "none" }}>
                {notifyPrompt === "guest" ? (
                  <>
                    <motion.button whileTap={{ scale: 0.97 }} onClick={() => onRequireAuth?.()}
                      style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 13, padding: "14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                      Create a free account · Log in →
                    </motion.button>
                    <motion.button whileTap={{ scale: 0.97 }} onClick={() => setNotifyPrompt(false)}
                      style={{ width: "100%", marginTop: 8, background: "transparent", color: "#C9C6C1", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 13, padding: "12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      Maybe later
                    </motion.button>
                  </>
                ) : (
                  <motion.button whileTap={{ scale: 0.97 }} onClick={() => setNotifyPrompt(false)}
                    style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 13, padding: "14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                    Got it ✓
                  </motion.button>
                )}
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* 🔥 onderweg van knop → uitslag; bij landing volgt de glans-sweep + vuur-pop. */}
      {fireFlight && <FlyingFire flight={fireFlight} onDone={() => { setFireFlight(null); setBarShine((k) => k + 1); }} />}

      {/* 👎 → sportieve vos-reactie (toast onderaan, verdwijnt vanzelf). */}
      {createPortal(
        <AnimatePresence>
          {foxNope > 0 && (
            <motion.div key={foxNope} initial={{ opacity: 0, y: 16, scale: 0.7 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.85 }} transition={springBouncy}
              style={{ position: "fixed", bottom: 20, left: 0, right: 0, margin: "0 auto", width: "fit-content", zIndex: 9600, display: "flex", gap: 8, alignItems: "flex-end", pointerEvents: "none" }}>
              <span style={{ fontSize: 27, lineHeight: 1 }}><Fox /></span>
              <SpeechBubble bg="#1E1D1A" color="#fff" style={{ padding: "9px 13px" }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>Fair enough! 👊</span>
              </SpeechBubble>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {zoomIdx != null && <PhotoZoom photos={photos} index={zoomIdx} onClose={() => setZoomIdx(null)} />}
    </>
  );
}
