import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Full-screen foto-lightbox: pinch- of dubbel-tik-zoom + pan, swipe tussen foto's, veeg
// omlaag om te sluiten. Via een portal naar document.body zodat de fixed-overlay nooit
// binnen een getransformeerde sheet-ouder wordt geplaatst (anders vult 'ie niet het scherm).
export default function PhotoZoom({ photos, index = 0, onClose }) {
  const list = (photos || []).filter((u) => typeof u === "string" && u);
  const [idx, setIdx] = useState(clamp(index, 0, Math.max(0, list.length - 1)));
  const [scale, setScale] = useState(1);
  const [t, setT] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const g = useRef({ lastTap: 0 });

  const resetZoom = () => { setScale(1); setT({ x: 0, y: 0 }); };
  const go = (d) => { setIdx((i) => clamp(i + d, 0, list.length - 1)); resetZoom(); };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length]);

  const dist2 = (tt) => Math.hypot(tt[0].clientX - tt[1].clientX, tt[0].clientY - tt[1].clientY);

  const onStart = (e) => {
    const tt = e.touches;
    if (tt.length === 2) {
      g.current.pinch = { d0: dist2(tt), s0: scale };
      g.current.one = null;
    } else if (tt.length === 1) {
      g.current.one = { x: tt[0].clientX, y: tt[0].clientY, tx0: t.x, ty0: t.y, moved: false, dx: 0, dy: 0, zoomed: scale > 1 };
    }
  };
  const onMove = (e) => {
    const tt = e.touches;
    const gc = g.current;
    if (gc.pinch && tt.length === 2) {
      e.preventDefault();
      setScale(clamp(gc.pinch.s0 * (dist2(tt) / gc.pinch.d0), 1, 4));
      setDragging(true);
    } else if (gc.one && tt.length === 1) {
      const dx = tt[0].clientX - gc.one.x, dy = tt[0].clientY - gc.one.y;
      gc.one.dx = dx; gc.one.dy = dy;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) gc.one.moved = true;
      if (gc.one.zoomed) {
        e.preventDefault();
        setDragging(true);
        setT({ x: gc.one.tx0 + dx, y: gc.one.ty0 + dy });
      }
    }
  };
  const onEnd = () => {
    const gc = g.current;
    setDragging(false);
    if (gc.pinch) { if (scale < 1.08) resetZoom(); gc.pinch = null; return; }
    if (gc.one) {
      if (!gc.one.moved) {
        const now = Date.now();
        if (now - gc.lastTap < 300) { // dubbel-tik → in/uit zoomen
          if (scale > 1) resetZoom(); else setScale(2.4);
          gc.lastTap = 0;
        } else {
          gc.lastTap = now;
        }
      } else if (!gc.one.zoomed) {
        if (Math.abs(gc.one.dx) > 55 && Math.abs(gc.one.dx) > Math.abs(gc.one.dy)) go(gc.one.dx < 0 ? 1 : -1);
        else if (gc.one.dy > 90 && Math.abs(gc.one.dy) > Math.abs(gc.one.dx)) onClose?.();
      }
      gc.one = null;
    }
  };

  if (!list.length) return null;

  return createPortal(
    <div onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
      style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,0.94)", touchAction: "none", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <img src={list[idx]} referrerPolicy="no-referrer" alt="" draggable={false}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", transform: `translate(${t.x}px, ${t.y}px) scale(${scale})`, transition: dragging ? "none" : "transform .18s ease", willChange: "transform", userSelect: "none" }} />
      <button onClick={onClose} aria-label="Close"
        style={{ position: "fixed", top: 14, right: 14, zIndex: 9501, width: 40, height: 40, borderRadius: 20, border: "none", background: "rgba(255,255,255,0.16)", color: "#fff", fontSize: 19, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
      <div style={{ position: "fixed", top: 20, left: 16, color: "rgba(255,255,255,0.7)", fontSize: 12, zIndex: 9501 }}>
        {list.length > 1 ? `${idx + 1} / ${list.length} · ` : ""}pinch or double-tap to zoom
      </div>
      {list.length > 1 && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 7, zIndex: 9501 }}>
          {list.map((_, i) => (
            <div key={i} onClick={() => { if (i !== idx) { setIdx(i); resetZoom(); } }}
              style={{ width: 8, height: 8, borderRadius: "50%", background: i === idx ? "#fff" : "rgba(255,255,255,0.4)", cursor: "pointer" }} />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
