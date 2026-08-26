// 🦊 Flowva Friends-demo (Kaito 26-08): volledige vos-tour die in 6 stops uitlegt hoe
// groeps-shoppen werkt. Herbruikbaar vanaf drie plekken: de "Pay less"-kaart op het
// verzendscherm, de Friends-kaart in Profiel, en het join-/uitnodigingsscherm.
// Zelfde choreografie als de How-it-works-tour: vos + wolk bovenaan, per stop een
// GROOT emoji dat na de tik in de gelande rij krimpt; tik = verder, Skip = klaar.
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Fox from "./Fox";
import { WordReveal } from "./MotionBits";
import { tr } from "./i18n";

export default function FriendsTour({ onClose, zIndex = 460 }) {
  const stops = [
    { icon: "🧡", text: tr("ftour.s1", "Flowva Friends: shop together, ship together — and everyone pays less.") },
    { icon: "🛍️", text: tr("ftour.s2", "Everyone shops for themselves and pays only for their own items — nobody touches anyone else's money.") },
    { icon: "🏬", text: tr("ftour.s3", "All items arrive side by side in our warehouse in China, with 60 days of free storage while the group fills up.") },
    { icon: "📸", text: tr("ftour.s4", "Every item gets quality-control & measurement photos. Hit “Ready” once yours look good.") },
    { icon: "📦", text: tr("ftour.s5", "When everyone is Ready, everything ships in ONE box to your group's host — you pick up your items there. So: join people who live nearby!") },
    { icon: "💸", text: tr("ftour.s6", "You split the shipping by weight, and everyone's fee drops — together it's usually 40–50% cheaper per person.") },
  ];
  const [step, setStep] = useState(0);
  const done = step >= stops.length;
  const advance = () => { if (!done) setStep((s) => s + 1); };

  const bubbleText = done ? tr("ftour.done", "That's Flowva Friends — cheaper for everyone, and cozier too. 🧡") : stops[step].text;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={advance}
      style={{ position: "fixed", inset: 0, zIndex, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(9px)", WebkitBackdropFilter: "blur(9px)", display: "flex", flexDirection: "column", alignItems: "center", overflowY: "auto", overscrollBehavior: "contain", padding: "0 22px 40px", cursor: done ? "default" : "pointer" }}>
      {/* Skip rechtsboven — de tour is vrijwillig, nooit een gevangenis. */}
      {!done && (
        <button onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{ position: "fixed", top: 14, right: 16, background: "rgba(255,255,255,0.14)", border: "none", color: "#fff", fontSize: 12.5, fontWeight: 700, padding: "8px 15px", borderRadius: 999, cursor: "pointer", zIndex: 2 }}>
          {tr("ftour.skip", "Skip")}
        </button>
      )}

      {/* Vos + wolk: vast bovenaan, tekst woord-voor-woord. */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 64, maxWidth: 400, width: "100%" }} onClick={(e) => { e.stopPropagation(); advance(); }}>
        <motion.span layout style={{ fontSize: 34, flexShrink: 0, marginTop: 2 }}><Fox /></motion.span>
        <motion.div layout style={{ background: "#fff", borderRadius: "4px 18px 18px 18px", padding: "13px 15px", minHeight: 46, flex: 1, boxShadow: "0 10px 40px rgba(0,0,0,0.35)" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: "#0F0E0C", lineHeight: 1.5 }}>
            <WordReveal key={bubbleText} text={bubbleText} delay={0.15} stagger={0.05} />
          </div>
        </motion.div>
      </div>

      {/* De actieve stop: GROOT emoji dat binnenvalt en even schudt; gelande stops
          krimpen in de rij eronder — je ziet de route groeien. */}
      <div style={{ marginTop: 26, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, width: "100%", maxWidth: 400 }}>
        {!done && (
          <motion.div key={`big-${step}`} initial={{ scale: 0.3, opacity: 0, rotate: -8 }}
            animate={{ scale: 1, opacity: 1, rotate: [8, -6, 4, 0] }}
            transition={{ type: "spring", stiffness: 260, damping: 14 }}
            style={{ fontSize: 74, lineHeight: 1, filter: "drop-shadow(0 8px 24px rgba(0,0,0,0.35))" }}>
            {stops[step].icon}
          </motion.div>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          {stops.slice(0, done ? stops.length : step).map((s, i) => (
            <motion.div key={i} initial={{ scale: 1.6, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}
              style={{ width: 42, height: 42, borderRadius: 14, background: "rgba(255,255,255,0.14)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
              {s.icon}
            </motion.div>
          ))}
        </div>
        {!done && (
          <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.65)", fontWeight: 600 }}>
            {tr("ftour.tapHint", "Tap to continue")} · {step + 1}/{stops.length}
          </div>
        )}
        <AnimatePresence>
          {done && (
            <motion.button initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 24, delay: 0.35 }}
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              style={{ marginTop: 6, background: "#FF5C00", color: "#fff", border: "none", borderRadius: 14, padding: "14px 34px", fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 32px rgba(255,92,0,0.45)" }}>
              {tr("sheets.gotIt", "Got it")} <Fox />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
