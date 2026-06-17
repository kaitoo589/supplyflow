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
