// WarehouseAndHaul.jsx
import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { motion, AnimatePresence } from "framer-motion";
import { springBouncy, springMorph, springSoft } from "./motion";
import { WordReveal, SpeechBubble } from "./MotionBits";
import { Plane, MapPin } from "lucide-react";

// Verzendmodel China → NL: een first-weight-blok (eerste 0,5 kg) + tarief per extra kg,
// dan een veiligheidsbuffer (verschil komt terug) en 21% invoer-BTW (DDP — wij schieten
// voor, klant betaalt niets op de stoep). Houd dit GELIJK aan supabase/pay-shipping.sql.
const SHIP_FIRST_KG = 0.5;       // first-weight blok
const SHIP_FIRST_EUR = 9.0;      // kost van dat eerste blok
const SHIP_PER_KG = 8.5;         // per extra kg daarboven
const BUFFER_MULTIPLIER = 1.3;   // schatting kan ~30% afwijken → buffer, rest terug
const IMPORT_VAT = 0.21;         // NL invoer-BTW op (goederen + verzending)
const r2 = (x) => Math.round(x * 100) / 100;
function shippingEstimate(weightKg) {
  return SHIP_FIRST_EUR + Math.max(0, weightKg - SHIP_FIRST_KG) * SHIP_PER_KG;
}

function Confetti({ active }) {
  const pieces = Array.from({ length: 60 }, (_, i) => i);
  const colors = ["#FF5C00", "#0F0E0C", "#6366F1", "#F59E0B", "#10B981", "#EF4444"];
  if (!active) return null;
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 999 }}>
      {pieces.map(i => (
        <motion.div key={i}
          initial={{ y: -20, x: `${Math.random() * 100}vw`, opacity: 1, rotate: 0, scale: 1 }}
          animate={{ y: "110vh", rotate: Math.random() * 720 - 360, opacity: [1, 1, 0], scale: [1, 1, 0.5] }}
          transition={{ duration: 2 + Math.random() * 2, delay: Math.random() * 0.8, ease: "easeIn" }}
          style={{
            position: "absolute", top: 0,
            width: Math.random() > 0.5 ? 10 : 6,
            height: Math.random() > 0.5 ? 10 : 14,
            borderRadius: Math.random() > 0.5 ? "50%" : 2,
            background: colors[Math.floor(Math.random() * colors.length)],
          }}
        />
      ))}
    </div>
  );
}

// Doos met open/dicht animatie
function OpenBox({ itemCount, onClick, isDropTarget }) {
  return (
    <motion.div
      onClick={onClick}
      style={{ cursor: itemCount > 0 ? "pointer" : "default", position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "center" }}
    >
      <div style={{ position: "relative", width: 120, height: 110, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* Doos body altijd zichtbaar */}
        <div style={{ position: "relative" }}>
          {/* Gesloten doos bodem — morpht naar de doos in het inhoud-venster */}
          <motion.div layoutId="haulbox" transition={springMorph}
            style={{ fontSize: 86, lineHeight: 1, filter: isDropTarget ? "drop-shadow(0 0 14px #FF5C00)" : "drop-shadow(0 4px 10px rgba(0,0,0,0.15))", transition: "filter 0.2s" }}>
            📦
          </motion.div>
          {/* Open deksel animatie als isDropTarget */}
          <AnimatePresence>
            {isDropTarget && (
              <motion.div
                initial={{ rotateX: 0, opacity: 0, y: 0 }}
                animate={{ rotateX: -45, opacity: 1, y: -18 }}
                exit={{ rotateX: 0, opacity: 0, y: 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 18 }}
                style={{
                  position: "absolute",
                  top: -10,
                  left: "50%",
                  transform: "translateX(-50%)",
                  fontSize: 36,
                  transformOrigin: "bottom center",
                  filter: "drop-shadow(0 -4px 8px rgba(255,92,0,0.6))",
                }}
              >
                🟫
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Item count badge */}
        {itemCount > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            style={{
              position: "absolute", top: 0, right: 0,
              background: "#0F0E0C", color: "#FF5C00",
              borderRadius: "50%", width: 26, height: 26,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700,
            }}
          >
            {itemCount}
          </motion.div>
        )}

        {/* Pijl hint als leeg */}
        {itemCount === 0 && !isDropTarget && (
          <motion.div
            animate={{ y: [0, 5, 0] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
            style={{ position: "absolute", bottom: -8, fontSize: 16, opacity: 0.5 }}
          >↓</motion.div>
        )}

        {/* Drop hint */}
        {isDropTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{ position: "absolute", bottom: -8, fontSize: 12, color: "#FF5C00", fontWeight: 700 }}
          >
            Drop it!
          </motion.div>
        )}
      </div>

      {itemCount > 0 && !isDropTarget && (
        <div style={{ fontSize: 10, color: "#8B6914", fontWeight: 600, marginTop: 4 }}>Tap to view</div>
      )}
    </motion.div>
  );
}

// Simpele weegschaal
function Scale({ weightKg }) {
  const tilt = Math.min(weightKg * 4, 18);
  const displayWeight = weightKg === 0 ? "0 g" : weightKg >= 1
    ? `${weightKg.toFixed(2)} kg`
    : `${Math.round(weightKg * 1000)} g`;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width="90" height="80" viewBox="0 0 90 80">
        <rect x="30" y="70" width="30" height="6" rx="3" fill="#8B6914" />
        <rect x="41" y="40" width="8" height="32" fill="#8B6914" />
        <motion.g
          animate={{ rotate: tilt }}
          transition={{ type: "spring", stiffness: 120, damping: 15 }}
          style={{ originX: "45px", originY: "38px" }}
        >
          <rect x="10" y="36" width="70" height="4" rx="2" fill="#5C3D0A" />
          <line x1="14" y1="38" x2="14" y2="52" stroke="#8B6914" strokeWidth="1.5" />
          <ellipse cx="14" cy="54" rx="12" ry="4" fill="#D4A843" stroke="#8B6914" strokeWidth="1" />
          <line x1="76" y1="38" x2="76" y2="52" stroke="#8B6914" strokeWidth="1.5" />
          <ellipse cx="76" cy="54" rx="12" ry="4" fill="#D4A843" stroke="#8B6914" strokeWidth="1" />
        </motion.g>
        <circle cx="45" cy="38" r="4" fill="#5C3D0A" />
      </svg>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#5C3D0A", background: "#FEF3C7", padding: "2px 10px", borderRadius: 20, border: "1px solid #D4A843" }}>
        {displayWeight}
      </div>
    </div>
  );
}

function WarehouseFox({ haulItems, isDropTarget }) {
  const msg = isDropTarget
    ? "Drop it in the box! 📦"
    : haulItems.length > 0
    ? `Nice! ${haulItems.length} item${haulItems.length > 1 ? "s" : ""} in the box. Drag more or confirm your parcel!`
    : "Drag your items to the shipping box to add products for international shipping!";
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1, rotate: [0, -8, 8, 0] }}
        transition={{
          scale: { type: "spring", stiffness: 420, damping: 15 },
          rotate: { duration: 1.8, repeat: Infinity, repeatDelay: 1.6, ease: "easeInOut", delay: 0.5 },
        }}
        style={{ fontSize: 40, lineHeight: 1, flexShrink: 0, transformOrigin: "bottom center", willChange: "transform" }}>🦊</motion.div>
      <SpeechBubble bg="#0F0E0C" color="#ddd" style={{ borderRadius: 14 }}>
        <div style={{ fontSize: 12, color: "#ddd", lineHeight: 1.5 }}>
          <WordReveal key={msg} text={msg} stagger={0.035} />
        </div>
      </SpeechBubble>
    </div>
  );
}

function BoxContentsModal({ items, onRemove, onClose }) {
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, backdropFilter: "blur(4px)" }} />
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#fff", borderRadius: "20px 20px 0 0", zIndex: 101, padding: "20px 20px 40px", maxHeight: "70vh", overflowY: "auto" }}>
        <div style={{ width: 36, height: 4, background: "#E8E6E0", borderRadius: 2, margin: "0 auto 16px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <motion.div layoutId="haulbox" transition={springMorph} style={{ fontSize: 30, lineHeight: 1 }}>📦</motion.div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0F0E0C" }}>What's in your box</div>
        </div>
        <div style={{ fontSize: 12, color: "#aaa", marginBottom: 16 }}>{items.length} item{items.length !== 1 ? "s" : ""} added</div>
        {items.map((order, i) => (
          <div key={order.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < items.length - 1 ? "1px solid #F0EEE8" : "none" }}>
            <div style={{ width: 44, height: 44, borderRadius: 8, background: "#fff", border: "1px solid #F0EEE8", overflow: "hidden", flexShrink: 0 }}>
              {order.variant_image ? <img src={order.variant_image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                : order.qc_images?.[0] ? <img src={order.qc_images[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 20 }}>📦</div>}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C" }}>{order.product_title || order.product}</div>
              <div style={{ fontSize: 11, color: "#aaa" }}>{order.weight_grams ? `${order.weight_grams}g` : "?"} · {order.qty} pcs</div>
            </div>
            <button onClick={() => onRemove(order.id)}
              style={{ background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              Remove
            </button>
          </div>
        ))}
      </motion.div>
    </>
  );
}

function OrderDetailModal({ order, inHaul, onAdd, onRemove, onDispute, onClose, onResolved }) {
  const [lightbox, setLightbox] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmReturn, setConfirmReturn] = useState(false);
  // QC + measurement komen via één gezamenlijke BuckyDrop-fotolijst → samen in één blok tonen.
  const qcmPhotos = [...(order.qc_images || []), ...(order.measurement_images || [])];
  const acceptDefect = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("accept_qc_result", { p_order_id: order.id });
    setBusy(false);
    if (error || data?.ok === false) { alert("Could not accept: " + (error?.message || data?.error || "error")); return; }
    onResolved?.();
  };
  const returnDefect = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("request_item_return", { p_order_id: order.id, p_reason: "Returned after quality-control flagged a defect" });
    setBusy(false);
    if (error || data?.ok === false) { alert("Could not request return: " + (error?.message || data?.error || "error")); return; }
    onResolved?.();
  };
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, backdropFilter: "blur(6px)" }} />
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 40 }}
        transition={{ type: "spring", stiffness: 280, damping: 24 }}
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderRadius: "24px 24px 0 0", zIndex: 101, padding: "24px 20px 48px", maxHeight: "85vh", overflowY: "auto" }}
      >
        <div style={{ position: "relative", display: "flex", alignItems: "center", minHeight: 22, marginBottom: 16 }}>
          <button onClick={onClose} style={{ background: "#F3F1ED", border: "none", borderRadius: 999, padding: "6px 13px", fontSize: 12.5, fontWeight: 700, color: "#0F0E0C", cursor: "pointer" }}>← Back</button>
          <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", width: 36, height: 4, background: "#E8E6E0", borderRadius: 2 }} />
        </div>
        <div style={{ width: "100%", aspectRatio: "16/9", borderRadius: 16, overflow: "hidden", background: "#fff", border: "1px solid #F0EEE8", marginBottom: 16 }}>
          {order.variant_image ? <img src={order.variant_image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            : order.qc_images?.[0] ? <img src={order.qc_images[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 48 }}>📦</div>}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>{order.product_title || order.product}</div>
        <div style={{ fontSize: 13, color: "#aaa", marginBottom: 16 }}>{order.qty} pcs · {order.weight_grams ? `${order.weight_grams}g` : "weight unknown"}</div>
        {/* De defect-flag staat als aparte sectie ONDER quality-control + measurement (zie hieronder). */}
        {/* QC + measurement samen — één gezamenlijke BuckyDrop-fotolijst (niet te scheiden) */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#888", marginBottom: 8, letterSpacing: 1 }}>QUALITY-CONTROL &amp; MEASUREMENT PICTURES</div>
          {qcmPhotos.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {qcmPhotos.map((url, i) => (
                <motion.div key={i} whileTap={{ scale: 0.97 }} onClick={() => setLightbox(url)} style={{ borderRadius: 10, overflow: "hidden", aspectRatio: "1", cursor: "pointer" }}>
                  <img src={url} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </motion.div>
              ))}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <motion.div key={i}
                  animate={i === 0 ? undefined : { opacity: [0.55, 1, 0.55] }}
                  transition={i === 0 ? undefined : { duration: 1.6, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 }}
                  style={{ background: "#F8F7F4", borderRadius: 10, aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 10, fontSize: 11.5, color: "#9C9893", lineHeight: 1.35 }}>
                  {i === 0 ? "⏳ Awaiting pictures" : ""}
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Measurement-sectie uit: BuckyDrop geeft geen aparte maatfoto's via de API (één picList);
            alle inspectiefoto's staan hierboven bij Quality-control. */}
        {false && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#888", marginBottom: 8, letterSpacing: 1 }}>MEASUREMENT CHECK</div>
          {order.measurement_images?.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {order.measurement_images.map((url, i) => (
                <motion.div key={i} whileTap={{ scale: 0.97 }} onClick={() => setLightbox(url)} style={{ borderRadius: 10, overflow: "hidden", aspectRatio: "1", cursor: "pointer" }}>
                  <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </motion.div>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[0, 1, 2].map((i) => (
                <motion.div key={i}
                  animate={i === 0 ? undefined : { opacity: [0.55, 1, 0.55] }}
                  transition={i === 0 ? undefined : { duration: 1.6, repeat: Infinity, ease: "easeInOut", delay: i * 0.2 }}
                  style={{ background: "#F8F7F4", borderRadius: 12, padding: "16px 14px", textAlign: "center", fontSize: 13, color: "#9C9893" }}>
                  {i === 0 ? "⏳ Awaiting measurement photos" : " "}
                </motion.div>
              ))}
            </div>
          )}
        </div>
        )}
        {/* Measurement zit nu samen met QC in één blok hierboven (gezamenlijke API). */}
        {order.dispute_status === "bucky_flagged" && (
          <div style={{ background: "#FFF7ED", border: "1.5px solid #F59E0B", borderRadius: 14, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#B45309", marginBottom: 4 }}>⚠️ Quality-control flagged a possible defect</div>
            <div style={{ fontSize: 13, color: "#92400E", lineHeight: 1.5 }}>Our warehouse spotted something off with your item. Review the agent's details below, then choose to <b>return it for a full refund</b> or <b>accept it as-is</b>.</div>
            {order.agent_defect_images?.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#B45309", marginBottom: 8, letterSpacing: 1 }}>ADDITIONAL PICTURES PROVIDED BY THE AGENT</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {order.agent_defect_images.map((url, i) => (
                    <motion.div key={i} whileTap={{ scale: 0.97 }} onClick={() => setLightbox(url)} style={{ borderRadius: 10, overflow: "hidden", aspectRatio: "1", cursor: "pointer" }}>
                      <img src={url} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
            {order.agent_notitie && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#B45309", marginBottom: 8, letterSpacing: 1 }}>AGENT MESSAGE</div>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🦊</div>
                  <div style={{ fontSize: 13, color: "#92400E", lineHeight: 1.55 }}>{order.agent_notitie}</div>
                </div>
              </div>
            )}
          </div>
        )}
        {order.weight_grams && (
          <div style={{ background: "#F0FDF4", border: "1px solid #10B981", borderRadius: 12, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#065F46", fontWeight: 600 }}>
            Adds {order.weight_grams}g to your parcel — shipping is charged per parcel, so bundling items keeps it cheap.
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          {order.return_status ? (
            <div style={{ flex: 1, textAlign: "center", color: "#B45309", fontSize: 13, fontWeight: 600, padding: "12px", background: "#FFF7ED", borderRadius: 12 }}>
              ↩ Return in progress
            </div>
          ) : inHaul ? (
            <button onClick={() => { onRemove(order.id); onClose(); }}
              style={{ flex: 1, background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              Remove from box
            </button>
          ) : order.dispute_status === "bucky_flagged" ? (
            <>
              <button onClick={acceptDefect} disabled={busy}
                style={{ flex: 1, background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
                ✓ Accept as-is
              </button>
              <button onClick={() => confirmReturn ? returnDefect() : setConfirmReturn(true)} disabled={busy}
                style={{ flex: 1, background: confirmReturn ? "#DC2626" : "#FEE2E2", color: confirmReturn ? "#fff" : "#DC2626", border: "none", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
                {confirmReturn ? "Sure? Return & refund" : "↩ Return for refund"}
              </button>
            </>
          ) : order.dispute_status === "pending" ? (
            <div style={{ flex: 1, textAlign: "center", color: "#B45309", fontSize: 13, fontWeight: 600, padding: "12px", background: "#FFF7ED", borderRadius: 12 }}>
              ⏳ Under review — can't ship until resolved
            </div>
          ) : !(order.qc_images?.length > 0) ? null : (
            <button onClick={() => { onAdd(order); onClose(); }}
              style={{ flex: 1, background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              + Add to box
            </button>
          )}
        </div>
      </motion.div>
      <AnimatePresence>
        {lightbox && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <motion.img initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }} transition={springSoft}
              src={lightbox} referrerPolicy="no-referrer" alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 12 }} />
            <button onClick={(e) => { e.stopPropagation(); setLightbox(null); }} aria-label="Close"
              style={{ position: "fixed", top: 16, right: 16, width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 18, cursor: "pointer" }}>✕</button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function OrderCard({ order, onDragStart, onDragEnd, inHaul, onOpenDetail, onReport }) {
  // Pas sleepbaar zodra de quality-control foto's er zijn (= klaar om te verzenden).
  const hasQc = order.qc_images?.length > 0;
  const warehouseDays = order.arrived_at ? Math.floor((Date.now() - new Date(order.arrived_at).getTime()) / 86400000) : null;
  // Een door BuckyDrop gemeld defect of een lopende retour blokkeert verzenden tot de klant kiest.
  const flagged = order.dispute_status === "bucky_flagged";
  const returning = !!order.return_status;
  const canDrag = hasQc && !flagged && !returning;
  return (
    <motion.div
      drag={canDrag}
      dragSnapToOrigin
      onDragStart={() => canDrag && onDragStart(order)}
      onDragEnd={(e, info) => canDrag && onDragEnd(order, info)}
      whileDrag={canDrag ? { scale: 1.06, zIndex: 50, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", cursor: "grabbing" } : {}}
      whileHover={{ y: -2 }}
      style={{
        background: inHaul ? "#F0FDF4" : "#fff",
        border: `1.5px solid ${inHaul ? "#10B981" : "#E8E6E0"}`,
        borderRadius: 14, padding: "10px 12px", marginBottom: 10,
        cursor: canDrag ? "grab" : "default", userSelect: "none", position: "relative",
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ width: 48, height: 48, borderRadius: 10, background: "#fff", border: "1px solid #F0EEE8", overflow: "hidden", flexShrink: 0 }}>
          {order.variant_image ? <img src={order.variant_image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} draggable={false} />
            : order.qc_images?.[0] ? <img src={order.qc_images[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} draggable={false} />
            : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 22 }}>📦</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {order.product_title || order.product}
          </div>
          <div style={{ fontSize: 11, color: "#aaa" }}>{order.qty} pcs · {order.weight_grams ? `${order.weight_grams}g` : "no weight"}{warehouseDays != null && <span style={{ color: warehouseDays >= 30 ? "#DC2626" : warehouseDays >= 24 ? "#B45309" : "#9C9893", fontWeight: warehouseDays >= 24 ? 700 : 400 }}> · 📦 {warehouseDays}d in warehouse</span>}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          {canDrag && <div style={{ background: inHaul ? "#10B981" : "#F3F1ED", color: inHaul ? "#fff" : "#9C9893", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap" }}>{inHaul ? "✓ In box" : "Not in box"}</div>}
          <button onClick={(e) => { e.stopPropagation(); onOpenDetail(order); }}
            style={{ background: "#F8F7F4", border: "1px solid #E8E6E0", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600, color: "#555", cursor: "pointer" }}>
            📸 Quality-control
          </button>
        </div>
      </div>
      <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0, marginRight: 8, fontSize: 11, lineHeight: 1.3, color: flagged ? "#B45309" : "#bbb", fontWeight: flagged ? 700 : 400 }}>{returning ? "↩ Return in progress" : flagged ? "⚠️ Defect found — your choice" : order.dispute_status === "pending" ? "⏳ On hold for review" : !hasQc ? "⏳ Awaiting quality-control pictures and measurement pictures" : inHaul ? "✓ Added" : (<><span style={{ color: "#10B981", fontWeight: 700 }}>✓ All quality-control and measurement photos are ready</span><br />↕ Drag to the box</>)}</div>
        {returning ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: "#B45309" }}>↩ Returning</span>
        ) : flagged ? (
          <button onClick={(e) => { e.stopPropagation(); onOpenDetail(order); }}
            style={{ background: "#FEF3C7", color: "#B45309", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            Return or accept →
          </button>
        ) : order.dispute_status === "pending" ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: "#B45309" }}>⏳ Report under review</span>
        ) : order.dispute_status === "rejected" ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: "#9C9893" }}>Return declined</span>
        ) : (
          <button onClick={(e) => { e.stopPropagation(); onReport(order); }}
            style={{ background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            Report a problem
          </button>
        )}
      </div>
    </motion.div>
  );
}

// Items die >30 dagen in het magazijn lagen lopen niet via de directe verzendbetaling,
// maar via een handmatige quote (verzending + opslag) die de admin opstelt.
function StorageQuoteFlow({ haulItems, balance, orderIds, onBack, onSuccess }) {
  const [quote, setQuote] = useState(undefined); // undefined = laden, null = geen, obj = quote
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const sameSet = (a, b) => a && b && a.length === b.length && [...a].map(String).sort().join("|") === [...b].map(String).sort().join("|");
  const load = async () => {
    const { data } = await supabase.from("storage_quotes").select("*").order("created_at", { ascending: false }).limit(20);
    setQuote((data || []).find(r => sameSet(r.order_ids, orderIds)) || null);
  };
  useEffect(() => { load(); }, []);
  const request = async () => {
    setBusy(true);
    const { data } = await supabase.rpc("request_storage_quote", { p_order_ids: orderIds });
    setBusy(false);
    if (data?.ok) load(); else alert(data?.error || "Something went wrong");
  };
  const pay = async () => {
    setBusy(true);
    const { data } = await supabase.rpc("pay_storage_quote", { p_quote_id: quote.id });
    setBusy(false);
    if (data?.ok) onSuccess(); else { alert(data?.error || "Payment failed"); load(); }
  };
  const activeSent = quote && quote.status === "sent" && quote.valid_date === today;
  const total = Number(quote?.total_eur || 0);
  const row = (label, value, strong) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: strong ? "#fff" : "#C9C6C1", fontWeight: strong ? 700 : 400, borderTop: strong ? "1px solid #333" : "none", marginTop: strong ? 4 : 0 }}>
      <span>{label}</span><span style={{ color: strong ? "#FF5C00" : "#fff", fontWeight: strong ? 700 : 600 }}>{value}</span>
    </div>
  );
  return (
    <div style={{ padding: "16px 20px", paddingBottom: 80 }}>
      <button onClick={onBack} style={{ background: "none", border: "none", fontSize: 14, color: "#666", cursor: "pointer", padding: 0, marginBottom: 16 }}>← Back</button>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>Shipping &amp; storage</div>
      <div style={{ fontSize: 13, color: "#aaa", marginBottom: 20 }}>These items have been in storage for over 30 days</div>
      <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
        {haulItems.map((o, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < haulItems.length - 1 ? "1px solid #F0EEE8" : "none" }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#fff", border: "1px solid #F0EEE8", overflow: "hidden", flexShrink: 0 }}>
              {o.variant_image ? <img src={o.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                : o.qc_images?.[0] ? <img src={o.qc_images[0]} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 16 }}>📦</div>}
            </div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C" }}>{o.product_title || o.product}</div></div>
          </div>
        ))}
      </div>

      {quote === undefined ? (
        <div style={{ background: "#0F0E0C", borderRadius: 14, padding: 22, marginBottom: 16, textAlign: "center" }}>
          <div style={{ fontSize: 12.5, color: "#C9C6C1" }}>Checking your quote…</div>
        </div>
      ) : activeSent ? (
        <div style={{ background: "#0F0E0C", borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#FF5C00" }}>Your quote</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#0F0E0C", background: "#FF5C00", padding: "3px 9px", borderRadius: 999 }}>VALID TODAY</div>
          </div>
          {row("International shipping", `€${Number(quote.shipping_eur).toFixed(2)}`)}
          {row(`Storage${quote.storage_days ? ` (${quote.storage_days} days)` : ""}`, `€${Number(quote.storage_eur).toFixed(2)}`)}
          {row("Total", `€${total.toFixed(2)}`, true)}
          <motion.button whileTap={{ scale: 0.98 }} onClick={pay} disabled={busy || balance < total}
            style={{ width: "100%", marginTop: 14, background: busy || balance < total ? "#3a352f" : "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "13px", fontSize: 14, fontWeight: 700, cursor: busy || balance < total ? "default" : "pointer" }}>
            {busy ? "Processing…" : balance < total ? `Top up — short €${(total - balance).toFixed(2)}` : `Pay €${total.toFixed(2)} & ship`}
          </motion.button>
        </div>
      ) : (
        <div style={{ background: "#0F0E0C", borderRadius: 14, padding: 18, marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: "#C9C6C1", lineHeight: 1.55, marginBottom: 14 }}>
            {quote?.status === "requested"
              ? "Quote requested — you'll receive it today. Tap refresh to check."
              : quote?.status === "sent"
                ? "Your previous quote expired. Request a fresh one — we'll send it today."
                : "Storage costs now apply to these items. Request a shipping quote and we'll send you the total (shipping + storage) today."}
          </div>
          <motion.button whileTap={{ scale: 0.98 }} onClick={request} disabled={busy}
            style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "13px", fontSize: 14, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>
            {busy ? "…" : quote?.status === "requested" ? "Refresh" : "Request shipping quote"}
          </motion.button>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "#A8A5A0", lineHeight: 1.5 }}>Free storage lasts 30 days. After that, storage is added to your shipping quote. If it isn't paid by day 90, the item is forfeited (see how pricing works).</div>
    </div>
  );
}

function ConfirmHaul(props) {
  const overdue = props.haulItems.some(o => o.arrived_at && (Date.now() - new Date(o.arrived_at).getTime()) > 30 * 86400000);
  if (overdue) return <StorageQuoteFlow {...props} orderIds={props.haulItems.map(o => o.id)} />;
  return <NormalShippingConfirm {...props} />;
}

function NormalShippingConfirm({ session, haulItems, balance, onBack, onSuccess }) {
  const [confirming, setConfirming] = useState(false);
  const [quoting, setQuoting] = useState(true);
  const [chosen, setChosen] = useState(null);     // route waarop we de schatting baseren
  const [error, setError] = useState(null);
  const orderIds = haulItems.map(o => o.id);
  const totalWeight = haulItems.reduce((s, o) => s + (o.weight_grams || 0), 0);

  const LIVE_BUFFER = 1.25;             // houd gelijk aan pay_shipping_buffered (SQL)
  const FULFIL_EUR = r2(9.9 / 7.8);     // fulfilment ¥9,9 per pakket

  // Live tarief ophalen bij openen. GEEN schatting-fallback meer: lukt de quote niet,
  // dan tonen we een nette melding (de echte prijs komt later sowieso via de admin-refund).
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const { data, error: e } = await supabase.functions.invoke("haul-shipping", {
          body: { action: "quote", orderIds },
        });
        if (!on) return;
        if (!e && data?.ok && !data.isSandbox && Array.isArray(data.channels) && data.channels.length) {
          // BuckyDrop kiest de route zelf (dashboard-prioriteit); wij baseren de schatting
          // op de DDP-route die het meest waarschijnlijk gebruikt wordt (DHL Duty-Free).
          // ALLEEN DDP/duty-paid — anders klopt de "duties included"-belofte niet. Geen non-DDP fallback.
          const ddp = data.channels.filter(c => c.taxInclusive);
          if (ddp.length) setChosen(ddp.find(c => /dhl/i.test(c.name)) || ddp[0]);
          else setError("No duty-paid shipping option is available right now. Please try again in a little while.");
        } else if (!e && data?.needWeight) {
          setError("We're still weighing your parcel — shipping will be available shortly.");
        } else {
          setError("Shipping isn't available right now. Please try again in a little while.");
        }
      } catch { if (on) setError("Shipping isn't available right now. Please try again in a little while."); }
      finally { if (on) setQuoting(false); }
    })();
    return () => { on = false; };
  }, []);

  const estFreight = chosen ? chosen.priceEur : 0;
  const buffered = r2(estFreight * LIVE_BUFFER);
  const vat = chosen ? (chosen.taxInclusive ? 0 : r2(estFreight * IMPORT_VAT)) : 0;
  const toPay = r2(buffered + vat + FULFIL_EUR);
  const canAfford = balance >= toPay;

  // Afrekenen: de edge function her-quote't + rekent server-side de buffered schatting af.
  const payLive = async () => {
    if (!chosen || !canAfford) return;
    setConfirming(true);
    const { data, error: e } = await supabase.functions.invoke("haul-shipping", {
      body: { action: "pay", orderIds, serviceCode: chosen.serviceCode },
    });
    setConfirming(false);
    if (e || !data?.ok) { alert("Payment failed: " + (e?.message || data?.error || "unknown error")); return; }
    onSuccess();
  };

  return (
    <div style={{ padding: "16px 20px", paddingBottom: 80 }}>
      <button onClick={onBack} style={{ background: "none", border: "none", fontSize: 14, color: "#666", cursor: "pointer", padding: 0, marginBottom: 16 }}>← Back</button>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>Confirm shipping</div>
      <div style={{ fontSize: 13, color: "#aaa", marginBottom: 20 }}>Review your parcel before paying</div>
      <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 12 }}>Products ({haulItems.length}) · {totalWeight}g</div>
        {haulItems.map((o, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < haulItems.length - 1 ? "1px solid #F0EEE8" : "none" }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#fff", border: "1px solid #F0EEE8", overflow: "hidden", flexShrink: 0 }}>
              {o.variant_image ? <img src={o.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                : o.qc_images?.[0] ? <img src={o.qc_images[0]} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 16 }}>📦</div>}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C" }}>{o.product_title || o.product}</div>
              <div style={{ fontSize: 11, color: "#aaa" }}>{o.weight_grams}g</div>
            </div>
          </div>
        ))}
      </div>

      {quoting ? (
        <motion.div layoutId="confirmHaul" transition={springMorph} style={{ background: "#0F0E0C", borderRadius: 14, padding: 22, marginBottom: 16, textAlign: "center" }}>
          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} style={{ width: 22, height: 22, border: "2.5px solid #333", borderTopColor: "#FF5C00", borderRadius: "50%", margin: "0 auto 10px" }} />
          <div style={{ fontSize: 12.5, color: "#C9C6C1" }}>Calculating shipping to your address…</div>
        </motion.div>
      ) : error ? (
        <div style={{ background: "#FEF3C7", border: "1px solid #F59E0B", borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>Shipping unavailable</div>
          <div style={{ fontSize: 12.5, color: "#92400E", lineHeight: 1.5 }}>{error}</div>
        </div>
      ) : (
        <motion.div layoutId="confirmHaul" transition={springMorph} style={{ background: "#0F0E0C", borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#FF5C00", marginBottom: 4 }}>Cost overview <span style={{ color: "#666", fontWeight: 500 }}>· estimate</span></div>
          <div style={{ fontSize: 11, color: "#888", marginBottom: 12 }}>Estimated now — any difference comes back after the carrier's final bill.</div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: "#888" }}>International shipping <span style={{ color: "#666" }}>· duties included</span></span>
            <span style={{ fontSize: 13, color: "#fff" }}>€{buffered.toFixed(2)}</span>
          </div>
          {vat > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: "#888" }}>Import VAT (21%)</span>
              <span style={{ fontSize: 13, color: "#fff" }}>€{vat.toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: "#888" }}>Fulfillment (¥9.9)</span>
            <span style={{ fontSize: 13, color: "#fff" }}>€{FULFIL_EUR.toFixed(2)}</span>
          </div>
          <div style={{ borderTop: "1px solid #333", paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>Pay now <span style={{ fontWeight: 500, color: "#9C9893", fontSize: 12 }}>· estimate</span></span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#FF5C00" }}>€{toPay.toFixed(2)}</span>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: "#555", lineHeight: 1.5 }}>✅ Duties prepaid (DDP) — nothing to pay on delivery. This is an estimate with a small buffer; about a week after shipping, the carrier's final bill comes in and you get any difference back as a shipping refund.</div>
        </motion.div>
      )}

      <div style={{ background: canAfford ? "#F0FDF4" : "#FEF3C7", border: `1px solid ${canAfford ? "#10B981" : "#F59E0B"}`, borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, color: canAfford ? "#065F46" : "#92400E" }}>Your balance</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: canAfford ? "#10B981" : "#B45309" }}>€{balance.toFixed(2)}</span>
        </div>
        {!canAfford && <div style={{ fontSize: 12, color: "#B45309", marginTop: 6 }}>You're €{(toPay - balance).toFixed(2)} short.</div>}
      </div>
      <button onClick={payLive} disabled={quoting || !!error || !chosen || !canAfford || confirming}
        style={{ width: "100%", background: quoting || error || !chosen || !canAfford || confirming ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: 700, cursor: quoting || error || !chosen || !canAfford || confirming ? "default" : "pointer" }}>
        {confirming ? "Processing..." : quoting ? "Calculating…" : error ? "Unavailable" : !canAfford ? "Insufficient balance" : `Confirm & pay €${toPay.toFixed(2)}`}
      </button>
    </div>
  );
}

function HaulSuccess({ haulItems, onDone }) {
  const [showConfetti, setShowConfetti] = useState(true);
  useEffect(() => { const t = setTimeout(() => setShowConfetti(false), 4000); return () => clearTimeout(t); }, []);
  return (
    <>
      <Confetti active={showConfetti} />
      <div style={{ padding: "40px 20px", textAlign: "center", paddingBottom: 80 }}>
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 15 }}>
          <div style={{ fontSize: 72, marginBottom: 16 }}>📦</div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#0F0E0C", marginBottom: 8 }}>Parcel confirmed!</div>
          <div style={{ fontSize: 14, color: "#666", lineHeight: 1.6, marginBottom: 24 }}>
            Your parcel of <strong>{haulItems.length} item{haulItems.length !== 1 ? "s" : ""}</strong> has been confirmed.
          </div>
          <div style={{ background: "#F0FDF4", border: "1px solid #10B981", borderRadius: 14, padding: "14px 16px", marginBottom: 24, textAlign: "left" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#065F46", marginBottom: 6 }}>💸 Money back</div>
            <div style={{ fontSize: 13, color: "#065F46", lineHeight: 1.5 }}>
              You paid an estimated shipping cost with a small buffer. About a week after your parcel ships, the carrier's final bill comes in — and you get any difference back in your balance as a shipping refund.
            </div>
          </div>
          <button onClick={onDone} style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Back to warehouse →
          </button>
        </motion.div>
      </div>
    </>
  );
}

function DisputeForm({ order, session, onBack, onSuccess }) {
  const [description, setDescription] = useState("");
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  // Officiële foto's = quality-control + measurement samen (één set bewijs).
  const officialPhotos = [...(order.qc_images || []), ...(order.measurement_images || [])];

  const uploadImages = async (files) => {
    setUploading(true);
    const urls = [];
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop();
      const fileName = `dispute-${order.id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(fileName, file);
      if (!error) {
        const { data } = supabase.storage.from("product-images").getPublicUrl(fileName);
        urls.push(data.publicUrl);
      }
    }
    setImages(prev => [...prev, ...urls]);
    setUploading(false);
  };

  const submitDispute = async () => {
    if (!description.trim()) { alert("Describe the problem"); return; }
    setSaving(true);
    // Server-side via RPC: dispute_status is afgeschermd, alleen submit_dispute mag het zetten.
    // Eventuele eigen (geannoteerde) klant-foto's gaan mee als p_images.
    const { data, error } = await supabase.rpc("submit_dispute", { p_order_id: order.id, p_description: description, p_images: images });
    setSaving(false);
    if (error || (data && data.ok === false)) { alert("Could not submit: " + (error?.message || data?.error || "unknown error")); return; }
    onSuccess();
  };

  return (
    <div style={{ padding: "16px 20px", paddingBottom: 80 }}>
      <button onClick={onBack} style={{ background: "none", border: "none", fontSize: 14, color: "#666", cursor: "pointer", padding: 0, marginBottom: 16 }}>← Back</button>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>Report a problem</div>
      <div style={{ fontSize: 13, color: "#aaa", marginBottom: 20 }}>Tell us why — we review it against the warehouse's quality-control photos.</div>
      <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 4 }}>Quality-control &amp; measurement pictures</div>
        <div style={{ fontSize: 11.5, color: "#aaa", marginBottom: 10, lineHeight: 1.5 }}>The official photos our warehouse took during inspection. Tap any photo to enlarge.</div>
        {officialPhotos.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {officialPhotos.map((url, i) => (
              <motion.img key={i} whileTap={{ scale: 0.95 }} onClick={() => setLightbox(url)} src={url} referrerPolicy="no-referrer" alt="" style={{ width: "100%", aspectRatio: "1", borderRadius: 8, objectFit: "cover", cursor: "pointer" }} />
            ))}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <motion.div key={i}
                animate={i === 0 ? undefined : { opacity: [0.55, 1, 0.55] }}
                transition={i === 0 ? undefined : { duration: 1.6, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 }}
                style={{ background: "#F8F7F4", borderRadius: 8, aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 8, fontSize: 11, color: "#9C9893", lineHeight: 1.3 }}>
                {i === 0 ? "⏳ Awaiting" : ""}
              </motion.div>
            ))}
          </div>
        )}
      </div>
      {order.agent_notitie && (
        <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 8 }}>Agent message</div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#FFF1E8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🦊</div>
            <div style={{ fontSize: 13, color: "#444", lineHeight: 1.55 }}>{order.agent_notitie}</div>
          </div>
        </div>
      )}
      <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 8 }}>{order.product_title || order.product}</div>
        <textarea placeholder="Describe the problem..." value={description} onChange={e => setDescription(e.target.value)}
          style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, background: "#F8F7F4", minHeight: 100, resize: "vertical", boxSizing: "border-box" }} />
      </div>
      <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 6 }}>Add photos (optional)</div>
        <div style={{ fontSize: 11.5, color: "#aaa", marginBottom: 10, lineHeight: 1.5 }}>Optional: mark or circle on the warehouse's photos what's wrong with the product, then upload them here.</div>
        {images.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {images.map((url, i) => <img key={i} src={url} alt="" style={{ width: 72, height: 72, borderRadius: 8, objectFit: "cover" }} />)}
          </div>
        )}
        <label style={{ display: "block", border: "1.5px dashed #E8E6E0", borderRadius: 10, padding: 14, textAlign: "center", cursor: "pointer", background: "#F8F7F4" }}>
          <div style={{ fontSize: 12, color: "#aaa" }}>{uploading ? "Uploading..." : "📷 Add photos"}</div>
          <input type="file" accept="image/*" multiple onChange={e => uploadImages(e.target.files)} style={{ display: "none" }} disabled={uploading} />
        </label>
      </div>
      <div style={{ background: "#FEF3C7", borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: "#92400E" }}>
        ⚠️ If your dispute is approved, you get the product price + local shipping refunded.
      </div>
      <button onClick={submitDispute} disabled={saving || !description.trim()}
        style={{ width: "100%", background: saving || !description.trim() ? "#E8E6E0" : "#0F0E0C", color: saving || !description.trim() ? "#aaa" : "#FF5C00", border: "none", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: 700, cursor: saving || !description.trim() ? "default" : "pointer" }}>
        {saving ? "Sending..." : "Report a problem →"}
      </button>
      <AnimatePresence>
        {lightbox && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <motion.img initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }} transition={springSoft}
              src={lightbox} referrerPolicy="no-referrer" alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 12 }} />
            <button onClick={(e) => { e.stopPropagation(); setLightbox(null); }} aria-label="Close"
              style={{ position: "fixed", top: 16, right: 16, width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 18, cursor: "pointer" }}>✕</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function WarehouseTab({ session, haulItems: allHaulItems = [], setHaulItems, activeGroupId = null, groupOrders = [] }) {
  // Modus-scheiding van de doos: alleen items van de ACTIEVE modus tellen mee (solo = ff_group_id
  // null, groep = die groep). De volledige lijst blijft in localStorage, dus je solo-doos en
  // groeps-doos blijven los bewaard — je voegt nooit per ongeluk iets toe aan de verkeerde doos.
  const inMode = (it) => activeGroupId ? it.ff_group_id === activeGroupId : !it.ff_group_id;
  const haulItems = (allHaulItems || []).filter(inMode);
  const [warehouseOrders, setWarehouseOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [showBoxContents, setShowBoxContents] = useState(false);
  const [disputeOrder, setDisputeOrder] = useState(null);
  const [detailOrder, setDetailOrder] = useState(null);
  const [screen, setScreen] = useState("warehouse");
  const dropZoneRef = useRef(null);
  const [draggingOrder, setDraggingOrder] = useState(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [lockedIds, setLockedIds] = useState([]);
  const [incomingCount, setIncomingCount] = useState(0);
  const [squadOrders, setSquadOrders] = useState([]);
  const [squadAdminId, setSquadAdminId] = useState(null);
  const [squadHostId, setSquadHostId] = useState(null);
  const [shipState, setShipState] = useState(null);

  // Gedeelde groep-status: ff_group_orders geeft per groep-item box_staged_at + return_status terug.
  const fetchSquadOrders = async () => {
    if (!activeGroupId) { setSquadOrders([]); setSquadAdminId(null); setSquadHostId(null); return; }
    const { data } = await supabase.rpc("ff_group_orders", { p_group_id: activeGroupId });
    setSquadOrders(data?.orders || []);
    setSquadAdminId(data?.admin_id || null);
    setSquadHostId(data?.host_id || null);
  };
  // Verzend-settlement-status: bevroren quote + per-lid aandeel + wie al betaalde.
  const fetchShipState = async () => {
    if (!activeGroupId) { setShipState(null); return; }
    const { data } = await supabase.rpc("ff_group_shipping_state", { p_group_id: activeGroupId });
    setShipState(data?.shipment || null);
  };
  // Markeer je EIGEN groep-item als in/uit de gedeelde doos zodat je vrienden + de gate het zien.
  const stageGroup = async (orderId, staged) => {
    if (!activeGroupId) return;
    await supabase.rpc("ff_stage_box", { p_order_ids: [orderId], p_staged: staged });
    fetchSquadOrders();
  };

  useEffect(() => {
    fetchWarehouseOrders(); fetchBalance(); fetchSquadOrders(); fetchShipState();
    if (!activeGroupId) return;
    const t = setInterval(() => { fetchSquadOrders(); fetchShipState(); }, 8000); // lichte poll → squad-staging + betaal-status live
    return () => clearInterval(t);
  }, [activeGroupId]);

  // Reconcile bij laden: lokale doos-items die nog NIET server-side gestaged zijn alsnog stagen.
  // Vangt items die al vóór deze feature in je doos zaten (anders blijven ze bij je squad "Not in box").
  // Alleen toevoegen, nooit unstagen → multi-device-veilig.
  useEffect(() => {
    if (!activeGroupId) return;
    const myGroupBox = (allHaulItems || []).filter((it) => it.ff_group_id === activeGroupId);
    if (!myGroupBox.length) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("ff_group_orders", { p_group_id: activeGroupId });
      if (cancelled) return;
      const staged = new Set((data?.orders || []).filter((o) => o.box_staged_at).map((o) => o.id));
      const toStage = myGroupBox.filter((it) => !staged.has(it.id)).map((it) => it.id);
      if (toStage.length) {
        await supabase.rpc("ff_stage_box", { p_order_ids: toStage, p_staged: true });
        fetchSquadOrders();
      }
    })();
    return () => { cancelled = true; };
  }, [activeGroupId]);

  // Haal items die al in een betaald pakket zitten uit de doos
  // (bijv. achtergebleven via localStorage).
  useEffect(() => {
    if (!lockedIds.length || typeof setHaulItems !== "function") return;
    setHaulItems(prev => prev.filter(h => !lockedIds.includes(h.id)));
  }, [lockedIds]);

  const fetchBalance = async () => {
    const { data } = await supabase.from("profiles").select("balance").eq("id", session.user.id).single();
    setBalance(data?.balance || 0);
  };

  const fetchWarehouseOrders = async () => {
    const { data } = await supabase.from("orders").select("*").eq("user_id", session.user.id).eq("status", "qc_pending").order("arrived_at", { ascending: false });
    // Producten die al in een betaald pakket zitten mogen niet nógmaals
    // toegevoegd worden (voorkomt dubbel betalen van verzending).
    const { data: hauls } = await supabase.from("hauls").select("items, status")
      .eq("user_id", session.user.id).in("status", ["confirmed", "shipped"]);
    setLockedIds((hauls || []).flatMap(h => h.items || []));
    // Modus-scheiding: solo-modus toont alleen solo-orders (ff_group_id null),
    // groep-modus alleen die groep — twee duidelijk gescheiden modussen.
    setWarehouseOrders((data || []).filter((o) => activeGroupId ? o.ff_group_id === activeGroupId : !o.ff_group_id));
    // Items die nog ONDERWEG zijn (besteld, nog niet in het magazijn) — voor de bundel-waarschuwing.
    let incQ = supabase.from("orders").select("id", { count: "exact", head: true })
      .eq("user_id", session.user.id).in("status", ["purchased", "bought", "shipped_local"]);
    incQ = activeGroupId ? incQ.eq("ff_group_id", activeGroupId) : incQ.is("ff_group_id", null);
    const { count: inc } = await incQ;
    setIncomingCount(inc || 0);
    setLoading(false);
  };

  const totalWeight = haulItems.reduce((s, o) => s + (o.weight_grams || 0), 0);
  // Groep-gate: élk groep-item moet in de doos zitten vóór verzending. Een geaccepteerde return telt NIET mee (groep hoeft niet te wachten).
  const groupPending = (squadOrders || []).filter(o => o.status === "qc_pending" && !o.return_status);
  const waitingCount = groupPending.filter(o => !o.box_staged_at).length;
  const groupReady = !activeGroupId || waitingCount === 0;
  const isHost = !activeGroupId || session.user.id === squadHostId; // alleen de host mag verzenden
  const canShip = groupReady && isHost;
  const hostName = (squadOrders.find((o) => o.user_id === squadHostId) || {}).member;

  const addToHaul = (order) => {
    if (typeof setHaulItems !== "function") return;
    if (order.dispute_status === "pending" || order.dispute_status === "bucky_flagged" || order.return_status) return; // in behandeling / defect / retour → nog niet verzendbaar
    if (lockedIds.includes(order.id)) return;
    if (!haulItems.some(h => h.id === order.id)) { setHaulItems(prev => [...prev, order]); stageGroup(order.id, true); }
  };

  const removeFromHaul = (orderId) => {
    if (typeof setHaulItems !== "function") return;
    setHaulItems(prev => prev.filter(h => h.id !== orderId));
    stageGroup(orderId, false);
  };

  const onDragStart = (order) => setDraggingOrder(order);

  const onDragEnd = (order, info) => {
    setDraggingOrder(null);
    setIsDropTarget(false);
    if (dropZoneRef.current && typeof setHaulItems === "function") {
      const rect = dropZoneRef.current.getBoundingClientRect();
      const { point } = info;
      const inZone = point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
      if (inZone && !lockedIds.includes(order.id) && !haulItems.some(h => h.id === order.id)) {
        setHaulItems(prev => [...prev, order]);
        stageGroup(order.id, true);
      }
    }
  };

  if (disputeOrder) return <DisputeForm order={disputeOrder} session={session} onBack={() => setDisputeOrder(null)} onSuccess={() => { setDisputeOrder(null); fetchWarehouseOrders(); }} />;
  if (screen === "confirm") return <ConfirmHaul session={session} haulItems={haulItems} balance={balance} onBack={() => setScreen("warehouse")} onSuccess={() => setScreen("success")} />;
  if (screen === "success") return <HaulSuccess haulItems={haulItems} onDone={() => { setScreen("warehouse"); setHaulItems((prev) => (prev || []).filter((it) => !inMode(it))); fetchWarehouseOrders(); fetchBalance(); }} />;

  return (
    <div style={{ padding: "16px 20px", paddingBottom: 100 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#0F0E0C", marginBottom: 2 }}>My warehouse</div>
      <div style={{ fontSize: 13, color: "#aaa", marginBottom: 12 }}>Products ready for international shipping</div>
      {activeGroupId && (isHost || session.user.id === squadAdminId) && (
        <div style={{ display: "flex", gap: 6, marginTop: -4, marginBottom: 12, flexWrap: "wrap" }}>
          {isHost && <span style={{ background: "#0F0E0C", color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20 }}>📦 You're the host — you confirm &amp; ship</span>}
          {!isHost && session.user.id === squadAdminId && <span style={{ background: "#FEF3C7", color: "#92400E", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20 }}>You're the admin</span>}
        </div>
      )}
      <div style={{ background: "#FFF7ED", border: "1px solid #FCD9B6", borderRadius: 12, padding: "10px 13px", marginBottom: 16, fontSize: 12, color: "#92400E", lineHeight: 1.5 }}>
        💡 Shipping is charged <b>per parcel</b>, not per item. Send everything together in one box — the more you bundle, the less you pay per item.
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #FCD9B6" }}>
          👯 <b>Shopping with friends?</b> With <b>Flowva Friends</b> you can team up, combine everyone's items into one parcel, and split the shipping — the cheapest way to ship together.
        </div>
      </div>

      {incomingCount > 0 && (
        <div style={{ background: "#EEF2FF", border: "1px solid #C7D2FE", borderRadius: 12, padding: "10px 13px", marginBottom: 16, fontSize: 12, color: "#3730A3", lineHeight: 1.5 }}>
          🚚 You have <b>{incomingCount} more item{incomingCount > 1 ? "s" : ""}</b> still on the way. Shipping separately costs more — your items wait safely in the warehouse, so it's cheaper to <b>wait and send everything in one parcel</b>.
        </div>
      )}

      {/* Drop zone */}
      <div
        ref={dropZoneRef}
        onMouseEnter={() => draggingOrder && setIsDropTarget(true)}
        onMouseLeave={() => setIsDropTarget(false)}
        style={{
          background: isDropTarget ? "#FEF08A" : "#FEF3C7",
          border: `2px ${isDropTarget ? "solid #FF5C00" : "dashed #D4A843"}`,
          borderRadius: 20, padding: 16, marginBottom: 20, transition: "all 0.2s",
        }}
      >
        <div style={{ marginBottom: 14 }}>
          <WarehouseFox haulItems={haulItems} isDropTarget={isDropTarget} />
        </div>

        {/* Doos op weegschaal */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <OpenBox
            itemCount={haulItems.length}
            isDropTarget={isDropTarget}
            onClick={() => haulItems.length > 0 && setShowBoxContents(true)}
          />
          <div style={{ marginTop: -10 }}>
            <Scale weightKg={totalWeight / 1000} />
          </div>
        </div>

        {haulItems.length > 0 && (() => {
          const ship = r2(shippingEstimate(totalWeight / 1000) * BUFFER_MULTIPLIER);
          const perItem = r2(ship / haulItems.length);
          const weighed = totalWeight > 0;
          return (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: "center", marginTop: 10 }}>
              <div style={{ fontSize: 12, color: "#8B6914", fontWeight: 600 }}>
                {haulItems.length} item{haulItems.length !== 1 ? "s" : ""}{weighed ? ` · ${totalWeight}g · ~€${ship.toFixed(2)} ship + VAT at checkout` : " · shipping calculated once weighed"}
              </div>
              <div style={{ fontSize: 11.5, color: "#5C3D0A", fontWeight: 700, marginTop: 3 }}>
                {weighed ? `≈ €${perItem.toFixed(2)} per item — add more to lower this 📦` : "Shipping is per parcel — add more to lower the cost per item 📦"}
              </div>
            </motion.div>
          );
        })()}
      </div>

      {activeGroupId ? (
        <GroupShippingPanel
          session={session} groupId={activeGroupId} shipment={shipState}
          waitingCount={waitingCount} isHost={isHost} hostName={hostName}
          haulCount={haulItems.length}
          onRefresh={() => { fetchShipState(); fetchSquadOrders(); fetchWarehouseOrders(); fetchBalance(); }}
        />
      ) : (
        <AnimatePresence>
          {haulItems.length > 0 && (
            <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
              layoutId="confirmHaul" transition={springMorph}
              onClick={() => setScreen("confirm")}
              style={{ width: "100%", background: "#0F0E0C", color: "#FF5C00", border: "none", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 20 }}>
              Confirm parcel & ship →
            </motion.button>
          )}
        </AnimatePresence>
      )}

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>Loading...</div>}
      {!loading && warehouseOrders.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🏭</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#0F0E0C", marginBottom: 6 }}>Warehouse is empty</div>
          <div style={{ fontSize: 13, color: "#aaa" }}>Orders appear here once they arrive.</div>
        </div>
      )}

      {warehouseOrders.map(order => {
        const inHaul = haulItems.some(h => h.id === order.id);
        const hasDispute = order.dispute_status === "pending";
        const inPaidHaul = lockedIds.includes(order.id);
        if (inPaidHaul) {
          return (
            <div key={order.id} style={{ background: "#F8F7F4", border: "1.5px solid #E8E6E0", borderRadius: 14, padding: 12, marginBottom: 10, opacity: 0.8 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ width: 44, height: 44, borderRadius: 8, background: "#fff", border: "1px solid #F0EEE8", overflow: "hidden", flexShrink: 0 }}>
                  {order.qc_images?.[0] ? <img src={order.qc_images[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 20 }}>📦</div>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C" }}>{order.product_title || order.product}</div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>{order.weight_grams ? `${order.weight_grams}g` : `${order.qty} pcs`}</div>
                </div>
                <div style={{ background: "#DCFCE7", color: "#166534", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>
                  📦 In parcel
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "#888" }}>Shipping paid — waiting for your agent to ship the parcel.</div>
            </div>
          );
        }
        if (hasDispute) {
          return (
            <div key={order.id} style={{ background: "#fff", border: "1.5px solid #EF4444", borderRadius: 14, padding: 12, marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                <div style={{ width: 44, height: 44, borderRadius: 8, background: "#fff", border: "1px solid #F0EEE8", overflow: "hidden", flexShrink: 0 }}>
                  {order.qc_images?.[0] ? <img src={order.qc_images[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 20 }}>📦</div>}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C" }}>{order.product_title || order.product}</div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>{order.qty} pcs</div>
                </div>
              </div>
              <div style={{ background: "#FEF3C7", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#B45309" }}>
                ⚠️ Dispute filed — awaiting review
              </div>
            </div>
          );
        }
        return <OrderCard key={order.id} order={order} onDragStart={onDragStart} onDragEnd={onDragEnd} inHaul={inHaul} onOpenDetail={setDetailOrder} onReport={setDisputeOrder} />;
      })}

      {/* SQUAD — items van groepsgenoten (alleen-lezen, net als op de Orders-pagina) */}
      {activeGroupId && (squadOrders || []).filter(o => o.user_id !== session.user.id && o.status === "qc_pending").length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 11, color: "#A8A5A0", fontWeight: 600, letterSpacing: 0.4, margin: "0 2px 8px" }}>SQUAD · FRIENDS' ITEMS</div>
          {(() => {
            const others = (squadOrders || []).filter(o => o.user_id !== session.user.id && o.status === "qc_pending");
            const byMember = others.reduce((acc, o) => { (acc[o.user_id] = acc[o.user_id] || []).push(o); return acc; }, {});
            return Object.values(byMember).map((memberOrders) => {
              const m0 = memberOrders[0];
              return (
                <div key={m0.user_id} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 6px" }}>
                    <div style={{ width: 22, height: 22, borderRadius: "50%", overflow: "hidden", background: "#0F0E0C", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {m0.avatar_url ? <img src={m0.avatar_url} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{(m0.member || "?").charAt(0).toUpperCase()}</span>}
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0F0E0C" }}>{m0.member}</div>
                    {m0.user_id === squadHostId && <span style={{ background: "#0F0E0C", color: "#fff", fontSize: 9.5, fontWeight: 700, padding: "1.5px 7px", borderRadius: 20, whiteSpace: "nowrap" }}>📦 Host</span>}
                    {m0.user_id === squadAdminId && <span style={{ background: "#FEF3C7", color: "#92400E", fontSize: 9.5, fontWeight: 700, padding: "1.5px 7px", borderRadius: 20, whiteSpace: "nowrap" }}>Admin</span>}
                  </div>
                  <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: "4px 12px" }}>
                    {memberOrders.map((o, i, arr) => (
                      <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < arr.length - 1 ? "1px solid #F0EEE8" : "none" }}>
                        <div style={{ width: 36, height: 36, borderRadius: 8, background: "#F3F1ED", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {o.variant_image ? <img src={o.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 16 }}>📦</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.product_title}</div>
                          <div style={{ fontSize: 11, color: (o.qc_images?.length > 0) ? "#10B981" : "#9C9893", fontWeight: 600, marginTop: 2 }}>{(o.qc_images?.length > 0) ? "✓ Ready to ship" : "⏳ Awaiting pictures"}</div>
                        </div>
                        {o.return_status ? (
                          <div style={{ background: "#FEF3C7", color: "#92400E", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap" }}>↩ Return</div>
                        ) : (
                          <div style={{ background: o.box_staged_at ? "#10B981" : "#F3F1ED", color: o.box_staged_at ? "#fff" : "#9C9893", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap" }}>{o.box_staged_at ? "✓ In box" : "Not in box"}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            });
          })()}
          <div style={{ fontSize: 11, color: "#A8A5A0", margin: "2px 2px 0", lineHeight: 1.4 }}>👀 Your squad's items — view only. Each member adds their own to the shared parcel.</div>
        </div>
      )}

      <AnimatePresence>
        {showBoxContents && <BoxContentsModal items={haulItems} onRemove={removeFromHaul} onClose={() => setShowBoxContents(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {detailOrder && (
          <OrderDetailModal
            order={detailOrder}
            inHaul={haulItems.some(h => h.id === detailOrder.id)}
            onAdd={addToHaul}
            onRemove={removeFromHaul}
            onDispute={(o) => setDisputeOrder(o)}
            onClose={() => setDetailOrder(null)}
            onResolved={() => { setDetailOrder(null); fetchWarehouseOrders(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Groep-verzending (gewicht-gesplitst, directe betaling). Vervangt de solo "Confirm
//    parcel & ship" in groep-modus: host bevriest één gecombineerde quote → elk lid betaalt
//    z'n gewichtsaandeel → laatste betaling verzendt administratief naar het host-adres. ──
function GroupShippingPanel({ session, groupId, shipment, waitingCount, isHost, hostName, haulCount, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [channels, setChannels] = useState(null); // null = dicht, array = kanaal-keuze
  const [msg, setMsg] = useState("");
  const myId = session.user.id;

  const wrap = { background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: 16, marginBottom: 20 };
  const darkBtn = (disabled) => ({ width: "100%", background: disabled ? "#E8E6E0" : "#0F0E0C", color: disabled ? "#A8A5A0" : "#FF5C00", border: "none", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer" });
  const eur = (x) => `€${Number(x || 0).toFixed(2)}`;

  const getQuote = async () => {
    setBusy(true); setMsg("");
    const { data, error } = await supabase.functions.invoke("haul-shipping-group", { body: { action: "quote", groupId } });
    setBusy(false);
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "Could not get a shipping quote"); return; }
    if (!data.channels?.length) { setMsg(data.isSandbox ? "Sandbox: no live channels yet" : "No shipping options available right now"); return; }
    setChannels(data.channels);
  };
  const lock = async (serviceCode) => {
    setBusy(true); setMsg("");
    const { data, error } = await supabase.functions.invoke("haul-shipping-group", { body: { action: "lock", groupId, serviceCode } });
    setBusy(false);
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "Could not lock the quote"); return; }
    setChannels(null); onRefresh();
  };
  const pay = async () => {
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("ff_pay_group_shipping", { p_group_id: groupId });
    setBusy(false);
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "Payment failed"); return; }
    onRefresh();
  };
  const drop = async () => {
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("ff_drop_unpaid_and_requote", { p_group_id: groupId });
    setBusy(false);
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "Could not re-open shipping"); return; }
    onRefresh();
  };
  const err = msg ? <div style={{ fontSize: 11, color: "#B91C1C", textAlign: "center", marginTop: 8 }}>{msg}</div> : null;

  // ── Nog geen vergrendelde quote ──
  if (!shipment) {
    if (haulCount === 0 && waitingCount === 0) return null;
    if (waitingCount > 0) {
      return <div style={{ ...wrap, textAlign: "center", color: "#92400E", background: "#FFF7ED", borderColor: "#FCD9B6", fontSize: 13 }}>
        ⏳ Waiting for your squad — {waitingCount} item{waitingCount === 1 ? "" : "s"} not in the box yet.
      </div>;
    }
    if (!isHost) {
      return <div style={{ ...wrap, textAlign: "center", fontSize: 13, color: "#6b6b6b" }}>
        ✓ Everyone's in the box. The host{hostName ? ` (${hostName})` : ""} locks the shipping quote, then you each pay your share.
      </div>;
    }
    if (channels === null) {
      return <div style={{ marginBottom: 20 }}>
        <button disabled={busy} onClick={getQuote} style={darkBtn(busy)}>{busy ? "Getting quote…" : "Lock shipping quote & open split →"}</button>
        {err}
      </div>;
    }
    return <div style={wrap}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Choose the shipping option</div>
      <div style={{ fontSize: 11, color: "#9C9893", marginBottom: 10 }}>One combined parcel to {hostName || "the host"}. The cost is split across everyone by weight.</div>
      {channels.map((c) => (
        <button key={c.serviceCode} disabled={busy} onClick={() => lock(c.serviceCode)}
          style={{ width: "100%", textAlign: "left", background: "#F8F7F4", border: "1px solid #E8E6E0", borderRadius: 12, padding: "10px 12px", marginBottom: 8, cursor: busy ? "wait" : "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span><span style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</span>{c.maxDays ? <span style={{ fontSize: 11, color: "#9C9893" }}> · {c.minDays}-{c.maxDays} days</span> : null}</span>
          <span style={{ fontWeight: 700, fontSize: 13 }}>~{eur(c.priceEur)}</span>
        </button>
      ))}
      <button onClick={() => { setChannels(null); setMsg(""); }} style={{ width: "100%", background: "none", border: "none", color: "#9C9893", fontSize: 12, padding: 6, cursor: "pointer" }}>Cancel</button>
      {err}
    </div>;
  }

  // ── Quote vergrendeld → iedereen betaalt z'n aandeel ──
  if (shipment.status === "quoted") {
    const members = shipment.members || [];
    const me = members.find((m) => m.user_id === myId);
    const unpaid = members.filter((m) => !m.paid).length;
    const deadlinePassed = shipment.pay_deadline && new Date(shipment.pay_deadline).getTime() < Date.now();
    return <div style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Shipping · split by weight</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#FF5C00" }}>{shipment.members_paid}/{shipment.members_total} paid</span>
      </div>
      <div style={{ fontSize: 11, color: "#9C9893", marginBottom: 10 }}>One parcel to {hostName || "the host"}{shipment.service_name ? ` · ${shipment.service_name}` : ""}</div>
      {members.map((m) => (
        <div key={m.user_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #F0EEE8", fontSize: 12.5 }}>
          <span style={{ fontWeight: 600, color: "#111" }}>{m.user_id === myId ? "You" : m.member}<span style={{ color: "#9C9893", fontWeight: 400 }}> · {(Number(m.weight_g) / 1000).toFixed(2)} kg</span></span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 700 }}>{eur(m.share_total)}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: m.paid ? "#10B981" : "#9C9893" }}>{m.paid ? "✓ Paid" : "Pending"}</span>
          </span>
        </div>
      ))}
      {me && !me.paid && (
        <button disabled={busy} onClick={pay} style={{ ...darkBtn(busy), marginTop: 12 }}>{busy ? "Paying…" : `Pay my share · ${eur(me.share_total)} →`}</button>
      )}
      {me && me.paid && (
        <div style={{ marginTop: 12, textAlign: "center", fontSize: 12.5, fontWeight: 700, color: "#10B981" }}>✓ You paid {eur(me.share_total)} — waiting for the rest of your squad.</div>
      )}
      {isHost && deadlinePassed && unpaid > 0 && (
        <button disabled={busy} onClick={drop} style={{ width: "100%", marginTop: 8, background: "#FFF7ED", color: "#92400E", border: "1px solid #FCD9B6", borderRadius: 12, padding: "11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Ship without {unpaid} unpaid member{unpaid === 1 ? "" : "s"} →</button>
      )}
      {err}
    </div>;
  }

  // ── Alles betaald → consolideren / verzonden ──
  return <div style={{ ...wrap, textAlign: "center", background: "#ECFDF5", borderColor: "#A7F3D0" }}>
    <div style={{ fontSize: 13, fontWeight: 700, color: "#065F46" }}>✓ All paid — your parcel is on its way</div>
    <div style={{ fontSize: 11.5, color: "#047857", marginTop: 4 }}>Everyone's items are being combined into one parcel and shipped to {hostName || "the host"}. You'll get tracking once it leaves the warehouse.</div>
  </div>;
}

// "In transit": de pakketten van de klant — betaald en verzonden, met live tracking.
// De cron-functie track-haul vult trace_status/trace_nodes/carrier; wij tonen ze hier.
const TRACE_LABEL = { 1: "In transit", 2: "Out for delivery", 3: "Delivered", 4: "Delivery issue", 5: "Held at customs", 6: "Returning", 7: "Returned", 8: "Return pending", 9: "Awaiting tracking" };
export function TransitTab({ session, orders = [], activeGroupId = null }) {
  const [hauls, setHauls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hideDelivered, setHideDelivered] = useState(() => { try { return localStorage.getItem("flowva_hide_delivered") === "1"; } catch { return false; } });

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("hauls").select("*")
        .eq("user_id", session.user.id)
        .in("status", ["confirmed", "shipped"])
        .order("created_at", { ascending: false });
      setHauls(data || []);
      setLoading(false);
    })();
  }, [session]);

  const orderById = (id) => orders.find(o => o.id === id);

  // Modus-scheiding: een parcel hoort bij de groep van z'n items (orders dragen ff_group_id).
  // Groep-modus toont alleen díe groep; solo-modus alleen solo-parcels (geen ff_group_id).
  const haulGroupId = (h) => {
    for (const id of (h.items || [])) { const o = orderById(id); if (o) return o.ff_group_id || null; }
    return null;
  };
  const modeHauls = hauls.filter(h => activeGroupId ? haulGroupId(h) === activeGroupId : !haulGroupId(h));

  // Geleverde pakketten (trace_status 3) blijven standaard staan; de knop verbergt ze.
  const deliveredCount = modeHauls.filter(h => h.trace_status === 3).length;
  const shownHauls = hideDelivered ? modeHauls.filter(h => h.trace_status !== 3) : modeHauls;

  // Orders die wél besteld zijn maar nog geen verzonden parcel → "Preparing shipment",
  // zodat Transit niet leeg/onzichtbaar lijkt. Mode-gescheiden + niet als ze al in een haul zitten.
  const haulItemIds = new Set(hauls.flatMap(h => h.items || []));
  const PREP_STATUSES = ["requested", "quote_sent", "quote_accepted", "purchased", "bought", "shipped_local", "qc_pending"];
  const preparing = orders.filter(o =>
    PREP_STATUSES.includes(o.status) && !haulItemIds.has(o.id) &&
    (activeGroupId ? o.ff_group_id === activeGroupId : !o.ff_group_id)
  );
  const prepWeight = preparing.reduce((s, o) => s + (o.weight_grams || 0), 0);

  const toggleHideDelivered = () => setHideDelivered((v) => {
    const nv = !v;
    try { localStorage.setItem("flowva_hide_delivered", nv ? "1" : "0"); } catch {}
    return nv;
  });

  return (
    <div style={{ padding: "10px 20px 100px" }}>
      <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6, color: "#111111", marginBottom: 2 }}>In transit</div>
      <div style={{ fontSize: 13.5, color: "#8A8780", marginBottom: 16 }}>Your parcels on their way to you</div>

      {deliveredCount > 0 && (
        <button onClick={toggleHideDelivered}
          style={{ background: "none", border: "1px solid #ECEAE5", borderRadius: 14, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "#8A8780", cursor: "pointer", marginBottom: 14, WebkitTapHighlightColor: "transparent" }}>
          {hideDelivered ? `Show delivered parcels (${deliveredCount})` : "Hide delivered parcels"}
        </button>
      )}

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>Loading...</div>}

      {!loading && modeHauls.length === 0 && preparing.length === 0 && (
        <div style={{ textAlign: "center", padding: "50px 0", color: "#aaa" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#F3F1ED", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <Plane size={26} color="#A8A5A0" strokeWidth={1.8} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#111111", marginBottom: 6 }}>No parcels yet</div>
          <div style={{ fontSize: 13 }}>Confirm a parcel in your warehouse and it will appear here.</div>
        </div>
      )}

      {!loading && preparing.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 18, padding: "15px 16px", marginBottom: 12, boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111111" }}>Preparing shipment · {preparing.length} item{preparing.length !== 1 ? "s" : ""}</div>
              <div style={{ fontSize: 11.5, color: "#A8A5A0" }}>{prepWeight ? `${prepWeight}g` : "weight pending"}</div>
            </div>
            <div style={{ background: "#F0EEE8", color: "#8A8780", fontSize: 11, fontWeight: 700, padding: "5px 11px", borderRadius: 16, whiteSpace: "nowrap" }}>Not shipped yet</div>
          </div>
          {preparing.map((o, i) => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: i < preparing.length - 1 ? "1px solid #F4F2EE" : "none" }}>
              <div style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 9, background: "#fff", border: "1px solid #F0EEE8", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {o.variant_image ? <img src={o.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  : o.qc_images?.[0] ? <img src={o.qc_images[0]} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <span style={{ fontSize: 17 }}>📦</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#111111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.product_title || o.product}</div>
                <div style={{ fontSize: 11, color: "#A8A5A0" }}>{o.qty || 1} pcs{o.kleur ? ` · ${o.kleur}` : ""}</div>
              </div>
              <div style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: o.weight_grams ? "#111111" : "#C2BEB6" }}>{o.weight_grams ? `${o.weight_grams} g` : "—"}</div>
            </div>
          ))}
          <div style={{ marginTop: 10, fontSize: 11, color: "#8A8780", lineHeight: 1.45 }}>📦 Not shipped yet — these appear here with live tracking once your parcel ships.</div>
        </div>
      )}

      {shownHauls.map((haul, hi) => {
        const items = (haul.items || []).map(orderById).filter(Boolean);
        const itemCount = items.length || (haul.items || []).length;
        const totalWeight = items.reduce((s, o) => s + (o.weight_grams || 0), 0);
        const ts = haul.trace_status;
        const statusLabel = ts ? (TRACE_LABEL[ts] || "In transit") : (haul.package_code ? "Awaiting tracking" : "Preparing shipment");
        const delivered = ts === 3;
        const nodes = Array.isArray(haul.trace_nodes) ? haul.trace_nodes : [];
        return (
          <motion.div key={haul.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springSoft, delay: hi * 0.06 }}
            style={{ background: "#fff", borderRadius: 18, padding: "15px 16px", marginBottom: 12, boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111111" }}>Parcel · {itemCount} item{itemCount !== 1 ? "s" : ""}</div>
                <div style={{ fontSize: 11.5, color: "#A8A5A0" }}>{haul.created_at ? new Date(haul.created_at).toLocaleDateString("en-GB") : ""}{totalWeight ? ` · ${totalWeight}g` : ""}</div>
              </div>
              <div style={{ background: delivered ? "#111111" : ts ? "#FFF0E7" : "#F0EEE8", color: delivered ? "#fff" : ts ? "#FF5C00" : "#8A8780", fontSize: 11, fontWeight: 700, padding: "5px 11px", borderRadius: 16, whiteSpace: "nowrap" }}>
                {delivered ? "✓ " : ts ? "✈ " : ""}{statusLabel}
              </div>
            </div>

            {items.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {items.map((o, i) => (
                  <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: i < items.length - 1 ? "1px solid #F4F2EE" : "none" }}>
                    <div style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 9, background: "#fff", border: "1px solid #F0EEE8", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {o.variant_image ? <img src={o.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                        : o.qc_images?.[0] ? <img src={o.qc_images[0]} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <span style={{ fontSize: 17 }}>📦</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#111111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.product_title || o.product}</div>
                      <div style={{ fontSize: 11, color: "#A8A5A0" }}>{o.qty || 1} pcs{o.kleur ? ` · ${o.kleur}` : ""}</div>
                    </div>
                    <div style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: o.weight_grams ? "#111111" : "#C2BEB6" }}>{o.weight_grams ? `${o.weight_grams} g` : "—"}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: haul.settled_at && Number(haul.refund_eur) > 0 ? 8 : 10 }}>
              <span style={{ fontSize: 12, color: "#8A8780" }}>Paid <span style={{ color: "#A8A5A0" }}>· estimated</span></span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#111111" }}>€{Number(haul.paid_eur || 0).toFixed(2)}</span>
            </div>

            {haul.settled_at && Number(haul.refund_eur) > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "8px 11px" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#065F46" }}>💸 Refund · shipping costs</span>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: "#10B981" }}>+€{Number(haul.refund_eur).toFixed(2)}</span>
              </div>
            )}

            {haul.settle_proof_url && (
              <a href={haul.settle_proof_url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, textDecoration: "none" }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, overflow: "hidden", border: "1px solid #E8E4DC", flexShrink: 0 }}>
                  <img src={haul.settle_proof_url} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <span style={{ fontSize: 11.5, color: "#FF5C00", fontWeight: 600 }}>📄 Carrier's final bill — your real shipping cost ↗</span>
              </a>
            )}

            {(haul.tracking_no || nodes.length > 0) ? (
              <div style={{ background: "#F8F7F4", borderRadius: 12, padding: "12px 13px" }}>
                {haul.tracking_no && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: nodes.length ? 12 : 0 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 10.5, color: "#A8A5A0", marginBottom: 1 }}>{haul.carrier_name || "Carrier"} · tracking</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#111111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{haul.tracking_no}</div>
                    </div>
                    {haul.carrier_link && (
                      <a href={haul.carrier_link} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#FF5C00", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap", marginLeft: 10 }}>Open ↗</a>
                    )}
                  </div>
                )}
                {nodes.slice(0, 6).map((n, i) => {
                  const last = i === Math.min(nodes.length, 6) - 1;
                  return (
                    <div key={i} style={{ display: "flex", gap: 10, paddingBottom: last ? 0 : 12 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <div style={{ width: 9, height: 9, borderRadius: "50%", background: i === 0 ? "#FF5C00" : "#D6D2CA", marginTop: 3, flexShrink: 0 }} />
                        {!last && <div style={{ width: 2, flex: 1, background: "#E8E4DC", marginTop: 2 }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? "#111111" : "#5F5C56", lineHeight: 1.35 }}>{n.desc || n.place || "Update"}</div>
                        <div style={{ fontSize: 10.5, color: "#A8A5A0", marginTop: 1 }}>{[n.place, n.time].filter(Boolean).join(" · ")}</div>
                      </div>
                    </div>
                  );
                })}
                {haul.tracking_updated_at && (
                  <div style={{ fontSize: 9.5, color: "#C2BEB6", marginTop: 8, textAlign: "right" }}>Updated {new Date(haul.tracking_updated_at).toLocaleString("en-GB")}</div>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F8F7F4", borderRadius: 12, padding: "10px 12px" }}>
                <MapPin size={14} color="#A8A5A0" />
                <span style={{ fontSize: 12, color: "#8A8780" }}>{haul.package_code ? "Tracking will appear here soon" : "Live tracking starts once your parcel ships"}</span>
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
