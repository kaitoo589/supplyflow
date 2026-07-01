// Kleine "delight"-bouwstenen (Apple-stijl micro-momenten), gedeeld door de hele app.
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import Fox from "./Fox";

// Telt een getal soepel op naar z'n doelwaarde (ease-out). Telt bij een wijziging
// verder vanaf de vorige waarde — voor saldo's, badges en tellers.
export function CountUp({ to = 0, decimals = 0, duration = 0.6, prefix = "", suffix = "", style }) {
  const target = Number(to) || 0;
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) { setVal(target); return; }
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / (duration * 1000));
      const e = 1 - Math.pow(1 - p, 3);
      setVal(from + (target - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return <span style={style}>{prefix}{val.toFixed(decimals)}{suffix}</span>;
}

// Pakketjes-confetti: mini-📦's, vosjes en vonkjes die opspatten en neerdwarrelen.
// Vuurt één keer bij mount en ruimt zichzelf op. Via portal zodat transforms van
// sheets 'm niet kunnen opsluiten.
export function ConfettiBurst({ count = 16, emojis = ["📦", "🦊", "🧡", "✨"], duration = 1.6 }) {
  const pieces = useRef(Array.from({ length: count }, (_, i) => ({
    id: i,
    e: emojis[i % emojis.length],
    x: (Math.random() - 0.5) * 280,
    up: -(120 + Math.random() * 190),
    rot: (Math.random() - 0.5) * 300,
    s: 0.8 + Math.random() * 0.9,
    d: Math.random() * 0.22,
  })).sort(() => Math.random() - 0.5)).current;
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGone(true), duration * 1000 + 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (gone) return null;
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 9700, pointerEvents: "none", overflow: "hidden" }}>
      {pieces.map((p) => (
        <motion.span key={p.id}
          initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: p.s }}
          animate={{ x: p.x, y: [0, p.up, p.up + 340], opacity: [0, 1, 1, 0], rotate: p.rot }}
          transition={{ duration, delay: p.d, ease: "easeOut" }}
          style={{ position: "absolute", left: "50%", top: "40%", fontSize: 20, lineHeight: 1 }}>
          {p.e === "🦊" ? <Fox still /> : p.e}
        </motion.span>
      ))}
    </div>,
    document.body,
  );
}

// Vliegende mini-afbeelding: van een bron-rect naar een doelpunt (bv. productfoto →
// mand-balk), krimpend tot een rond thumbnail'tje. Zelfde familie als FlyingFire.
export function FlyingImage({ flight, onDone }) {
  return createPortal(
    <motion.img src={flight.src} referrerPolicy="no-referrer" alt="" draggable={false}
      initial={{ x: 0, y: 0, width: flight.fw, height: flight.fh, opacity: 1, borderRadius: 16 }}
      animate={{ x: flight.tx - flight.fx, y: flight.ty - flight.fy, width: 42, height: 42, opacity: [1, 1, 0.85], borderRadius: 21 }}
      transition={{ duration: 0.65, ease: [0.32, 0.72, 0, 1] }}
      onAnimationComplete={onDone}
      style={{ position: "fixed", left: flight.fx, top: flight.fy, zIndex: 9600, objectFit: "cover", background: "#fff", pointerEvents: "none", boxShadow: "0 10px 30px rgba(0,0,0,0.28)" }}
    />,
    document.body,
  );
}
