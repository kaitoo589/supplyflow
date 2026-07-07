// Herbruikbare animatie-componenten (Apple-stijl) — gedeeld door klant-app en warehouse.
import { motion } from "framer-motion";
import { springSoft } from "./motion";

// Onthult tekst woord-voor-woord met een zachte spring + lichte blur.
// Geef een veranderende `key` mee (bv. de tekst zelf) om opnieuw te animeren.
export function WordReveal({ text, style, delay = 0, stagger = 0.05 }) {
  const words = String(text ?? "").split(" ");
  return (
    <motion.span
      style={{ display: "inline-block", ...style }}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
    >
      {words.map((w, i) => (
        <motion.span
          key={i}
          style={{ display: "inline-block", whiteSpace: "pre" }}
          variants={{
            hidden: { opacity: 0, y: 8 },
            show: { opacity: 1, y: 0, transition: springSoft },
          }}
        >
          {w + (i < words.length - 1 ? " " : "")}
        </motion.span>
      ))}
    </motion.span>
  );
}

// 🌱 "Boom-groei" voor bottom-sheets (mand + pakket): de kaart opent compact (greep +
// titel) en de inhoud groeit daarna in ÉÉN doorlopende hoogte-beweging omhoog open.
// Timing-venster gedeeld door grower + reveals.
export const GROW_START = 0.1;   // s ná mount: groei begint (overlapt de staart van de entree)
export const GROW_DUR = 0.55;    // s: duur van de volledige groei

// De groeier: wikkelt ALLE inhoud onder de titel en klapt 'm in één vloeiende curve
// van 0 → auto open (sterke ease-out = organisch). Sluiten = omgekeerde groei (exit).
export function CartGrower({ skip = false, children }) {
  return (
    <motion.div
      initial={skip ? false : { height: 0 }}
      animate={{ height: "auto" }}
      exit={{ height: 0, transition: { duration: 0.28, ease: "easeIn" } }}
      transition={{ delay: GROW_START, duration: GROW_DUR, ease: [0.16, 1, 0.3, 1] }}
      style={{ overflow: "hidden" }}
    >
      {children}
    </motion.div>
  );
}

// Reveal per regel, getimed op POSITIE in het groeivenster (i van n): de regel bloeit
// op — zachte fade + 8px rise, géén blur — wanneer de groeiende rand z'n plek passeert.
// i/n normaliseert: een volle lijst is even snel klaar als een kleine. `skip` = geen animatie.
export function FoldReveal({ i = 0, n = 1, skip = false, children }) {
  const d = GROW_START + 0.02 + (i / Math.max(n - 1, 1)) * GROW_DUR * 0.65;
  return (
    <motion.div
      initial={skip ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: d, duration: 0.28, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

// Stripboek-achtige spraakwolk met een puntje (tail) dat naar links wijst (richting de mascotte).
export function SpeechBubble({ children, bg = "#0F0E0C", color = "#fff", style }) {
  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <div style={{ background: bg, color, borderRadius: 16, padding: "12px 16px", boxShadow: "0 6px 20px rgba(0,0,0,0.12)", ...style }}>
        {children}
      </div>
      <div
        aria-hidden
        style={{
          position: "absolute", left: -8, bottom: 14,
          width: 0, height: 0,
          borderTop: "8px solid transparent",
          borderBottom: "8px solid transparent",
          borderRight: `9px solid ${bg}`,
        }}
      />
    </div>
  );
}
