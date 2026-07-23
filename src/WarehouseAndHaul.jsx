// WarehouseAndHaul.jsx
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase } from "./supabase";
import { motion, AnimatePresence } from "framer-motion";
import { springBouncy, springMorph, springSoft } from "./motion";
import { WordReveal, SpeechBubble, CartGrower, FoldReveal } from "./MotionBits";
import { Plane, MapPin, ChevronUp, ChevronDown } from "lucide-react";
import Fox from "./Fox";
import { garmentType } from "./garment";
import { tr } from "./i18n";

// Verzendmodel China → NL: een first-weight-blok (eerste 0,5 kg) + tarief per extra kg,
// dan een veiligheidsbuffer (verschil komt terug) en 21% invoer-BTW (DDP — wij schieten
// voor, klant betaalt niets op de stoep). Houd dit GELIJK aan supabase/pay-shipping.sql.
const SHIP_FIRST_KG = 0.5;       // first-weight blok
const SHIP_FIRST_EUR = 9.0;      // kost van dat eerste blok
const SHIP_PER_KG = 8.5;         // per extra kg daarboven
const BUFFER_MULTIPLIER = 1.3;   // schatting kan ~30% afwijken → buffer, rest terug
const IMPORT_VAT = 0.21;         // NL invoer-BTW op (goederen + verzending)
const r2 = (x) => Math.round(x * 100) / 100;
// Korte, herkenbare carrier-naam uit de volledige BuckyDrop-kanaalnaam (bv. "YunExpress
// clothing Registered Air Mail" → "YunExpress", "Europe DHL Duty-Prepaid Line" → "DHL").
function carrierLabel(name) {
  if (!name) return "";
  if (/yun\s*express/i.test(name)) return "YunExpress";
  if (/dhl/i.test(name)) return "DHL";
  if (/\bems\b/i.test(name)) return "EMS";
  if (/\beub\b/i.test(name)) return "EUB";
  if (/\bups\b/i.test(name)) return "UPS";
  return name;
}

function shippingEstimate(weightKg) {
  // r2 over de basis — IDENTIEK aan server shippingEstimateEur (rondt af vóór de ×1,25-buffer),
  // zodat het getoonde bedrag exact gelijk is aan wat de server afschrijft (geen 1-cent-drift).
  return r2(SHIP_FIRST_EUR + Math.max(0, weightKg - SHIP_FIRST_KG) * SHIP_PER_KG);
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
        </div>

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

function WarehouseFox({ haulItems, isDropTarget, activeGroupId, waitingCount = 0, incomingCount = 0 }) {
  const n = (x, s) => `${x} item${x === 1 ? "" : "s"}${s || ""}`;
  let msg;
  if (isDropTarget) {
    msg = "Drop it in the box! 📦";
  } else if (activeGroupId && waitingCount > 0) {
    // Flowva Friends: ALLES moet erin voordat er verzonden kan worden (één gecombineerd pakket).
    msg = `${n(waitingCount)} still to go before your squad can ship — everyone's items travel in one parcel. 📦`;
  } else if (!activeGroupId && incomingCount > 0) {
    // Solo: aanrader om te wachten (goedkoper + service fee per internationale verzending).
    msg = `${n(incomingCount, " still on the way")}. Worth the wait — sending everything in one parcel is much cheaper, and the service fee applies to each international shipment. 📦`;
  } else if (haulItems.length > 0) {
    msg = `Nice! ${n(haulItems.length)} in the box.${activeGroupId ? "" : " Drag more or confirm your parcel!"}`;
  } else {
    msg = "Drag your items to the shipping box to add products for international shipping!";
  }
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1, rotate: [0, -8, 8, 0] }}
        transition={{
          scale: { type: "spring", stiffness: 420, damping: 15 },
          rotate: { duration: 1.8, repeat: Infinity, repeatDelay: 1.6, ease: "easeInOut", delay: 0.5 },
        }}
        style={{ fontSize: 40, lineHeight: 1, flexShrink: 0, transformOrigin: "bottom center", willChange: "transform" }}><Fox /></motion.div>
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
                  <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}><Fox /></div>
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

function OrderCard({ order, onDragStart, onDragMove, onDragEnd, inHaul, onOpenDetail, onReport }) {
  // Pas sleepbaar zodra de quality-control foto's er zijn (= klaar om te verzenden).
  const hasQc = order.qc_images?.length > 0;
  const warehouseDays = order.arrived_at ? Math.floor((Date.now() - new Date(order.arrived_at).getTime()) / 86400000) : null;
  // Opslag-teller: 30 dagen gratis, daarna lopen kosten (x/90) tot verbeurd op dag 90.
  const overStorage = warehouseDays != null && warehouseDays > 30;
  const storageColor = warehouseDays == null ? "#9C9893" : overStorage ? "#DC2626" : warehouseDays >= 24 ? "#B45309" : "#10B981";
  const storageLabel = warehouseDays == null ? "" : overStorage ? `${warehouseDays}/90 · storage fee` : `${warehouseDays}/30 free storage`;
  // Een door BuckyDrop gemeld defect of een lopende retour blokkeert verzenden tot de klant kiest.
  const flagged = order.dispute_status === "bucky_flagged";
  const returning = !!order.return_status;
  const canDrag = hasQc && !flagged && !returning;
  return (
    <motion.div
      drag={canDrag}
      dragSnapToOrigin
      onDragStart={() => canDrag && onDragStart(order)}
      onDrag={(e, info) => canDrag && onDragMove && onDragMove(info, e)}
      onDragEnd={(e, info) => canDrag && onDragEnd(order, info, e)}
      whileDrag={canDrag ? { scale: 1.06, zIndex: 50, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", cursor: "grabbing" } : {}}
      whileHover={canDrag ? { y: -2 } : {}}
      style={{
        background: inHaul ? "#F0FDF4" : "#fff",
        // Klaar-om-te-slepen = zachtgroene rand; in de doos = vol groen; nog niet klaar = grijs.
        border: `1.5px solid ${inHaul ? "#10B981" : canDrag ? "#86EFAC" : "#E8E6E0"}`,
        borderRadius: 14, padding: "10px 12px", marginBottom: 10,
        // Wacht nog op quality-control → gedempt, zodat klaar-items er duidelijk uitspringen.
        opacity: (!hasQc && !flagged && !returning) ? 0.6 : 1,
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
          <div style={{ fontSize: 11, color: "#aaa" }}>{order.qty} pcs · {order.weight_grams ? `${order.weight_grams}g` : "no weight"}{warehouseDays != null && <span style={{ color: storageColor, fontWeight: warehouseDays >= 24 ? 700 : 400 }}> · 📦 {storageLabel}</span>}</div>
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
  // "Refresh" leest ALLEEN de bestaande quote opnieuw uit — NIET opnieuw aanvragen.
  // (request_storage_quote maakte telkens een nieuwe 'requested' aan en liet de zojuist
  // verstuurde quote verlopen → herhaald refreshen wiste de admin-quote steeds.)
  const refresh = async () => { setBusy(true); await load(); setBusy(false); };
  const pay = async () => {
    setBusy(true);
    const { data } = await supabase.rpc("pay_storage_quote", { p_quote_id: quote.id });
    setBusy(false);
    if (data?.ok) onSuccess(); else { alert(data?.error || "Payment failed"); load(); }
  };
  const activeSent = quote && quote.status === "sent" && quote.valid_date === today;
  const total = Number(quote?.total_eur || 0);
  const custCats = [...new Set(haulItems.map(o => garmentType(o.product_title || o.product)))]; // alleen weergave; €3 zit al in de DDP-prijs
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
          {custCats.length > 0 && row(`↳ incl. EU customs · €3 × ${custCats.length} ${custCats.length === 1 ? "category" : "categories"}`, `€${(custCats.length * 3).toFixed(2)}`)}
          {Number(quote.service_fee_eur) > 0 && row("Service fee (8% · min €5)", `€${Number(quote.service_fee_eur).toFixed(2)}`)}
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
          <motion.button whileTap={{ scale: 0.98 }} onClick={quote?.status === "requested" ? refresh : request} disabled={busy}
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
  // Opslag-quote-omweg VERVALLEN (user 2026-07-22): items >30 dagen gaan gewoon door de
  // normale verzendflow — de opslagkosten staan als vaste regel in het kostenoverzicht
  // (€2/stuk bij 31-60 dagen, €4/stuk bij 61-90; dag 90+ is al verbeurd en kan niet mee).
  // StorageQuoteFlow blijft ongebruikt op disk (zelfde conventie als QuoteAcceptance).
  return <NormalShippingConfirm {...props} />;
}

function NormalShippingConfirm({ session, haulItems, balance, onBack, onSuccess }) {
  const [confirming, setConfirming] = useState(false);
  const [quoting, setQuoting] = useState(true);
  const [chosen, setChosen] = useState(null);     // route waarop we de schatting baseren
  const [error, setError] = useState(null);
  const [addrOk, setAddrOk] = useState(false);    // "mijn adres klopt"-bevestiging vóór betalen
  const orderIds = haulItems.map(o => o.id);
  const totalWeight = haulItems.reduce((s, o) => s + (o.weight_grams || 0), 0);
  // Douane-categorieën in dit pakket (HS6-benadering). ALLEEN voor weergave — de €3 zit al
  // in de DDP-prijs van BuckyDrop, we tellen 'm niet bovenop het totaal.
  const custCats = [...new Set(haulItems.map(o => garmentType(o.product_title || o.product)))];

  const LIVE_BUFFER = 1.25;             // houd gelijk aan pay_shipping_buffered (SQL)
  const FULFIL_EUR = r2(9.9 / 7.8);     // fulfilment ¥9,9 per pakket

  // Live tarief ophalen bij openen. Is er een live DDP-route → daarop baseren we de schatting.
  // Geeft BuckyDrop (nog) geen live vrachttarief (permissie op channel-carriage-list nog niet
  // aan / sandbox / geen route) → TERUGVAL op de gewicht-schatting, zodat verzenden altijd kan.
  // De ECHTE afrekening + prijs komen server-side; dit is puur voor de weergave.
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const { data, error: e } = await supabase.functions.invoke("haul-shipping", {
          body: { action: "quote", orderIds },
        });
        if (!on) return;
        if (!e && data?.needWeight) {
          setError("We're still weighing your parcel — shipping will be available shortly.");
        } else if (e || !data?.ok) {
          setError("Shipping isn't available right now. Please try again in a little while.");
        } else {
          const channels = Array.isArray(data.channels) ? data.channels : [];
          const ddp = channels.filter(c => c.taxInclusive);
          if (!data.isSandbox && ddp.length) {
            // BuckyDrop kiest de route zelf (dashboard-prioriteit); wij baseren de schatting op de
            // DDP-route die 't meest waarschijnlijk gebruikt wordt. Vera (2026-07-02): hoofdlijn =
            // YunExpress clothing Registered Air Mail, reserve = Europe DHL Duty-Free. Alleen DDP.
            setChosen(ddp.find(c => /yun\s*express|yunexpress/i.test(c.name)) || ddp.find(c => /dhl/i.test(c.name)) || ddp[0]);
          } else if (!data.isSandbox && channels.length) {
            // Wél live routes, maar geen enkele DDP → we kunnen de "duties included"-belofte niet live waarmaken.
            setError("No duty-paid shipping option is available right now. Please try again in a little while.");
          } else {
            // Geen live tarief → gewicht-schatting (DDP, duties inbegrepen). Server rekent 't echte bedrag.
            setChosen({ serviceCode: "ESTIMATE", name: "Estimated shipping", priceEur: shippingEstimate(totalWeight / 1000), taxInclusive: true });
          }
        }
      } catch { if (on) setError("Shipping isn't available right now. Please try again in a little while."); }
      finally { if (on) setQuoting(false); }
    })();
    return () => { on = false; };
  }, []);

  const estFreight = chosen ? chosen.priceEur : 0;
  // Carrier-naam alleen bij een ECHTE live route tonen; bij de gewicht-schatting (ESTIMATE) niet.
  const carrier = chosen && chosen.serviceCode !== "ESTIMATE" ? carrierLabel(chosen.name) : null;
  const buffered = r2(estFreight * LIVE_BUFFER);
  const vat = chosen ? (chosen.taxInclusive ? 0 : r2(estFreight * IMPORT_VAT)) : 0;
  // Fulfilment-toeslagen — moet 1:1 kloppen met pay_shipping_buffered (server-side): >5 stuks -> +¥2/extra
  // stuk; >2 kg -> +¥1,5/kg boven 2 (facturabel gewicht naar boven afgerond op hele kg). ¥->€ via /7,8.
  const pieces = haulItems.reduce((s, o) => s + (Number(o.qty) || 1), 0);
  const billableKg = Math.ceil(totalWeight / 1000);
  const extraItems = Math.max(0, pieces - 5);
  const extraKg = Math.max(0, billableKg - 2);
  const surcharge = r2((extraItems * 2 + extraKg * 1.5) / 7.8);
  // Service fee (Flowva-marge) — verhuisd van checkout naar hier. 8% van de bundel-productwaarde, min €5.
  // Houd 1:1 gelijk aan pay_shipping_buffered (server): greatest(round(0.08 * sum(price), 2), 5).
  const productValue = haulItems.reduce((s, o) => s + (Number(o.price) || 0), 0);
  const svcFee = Math.max(5, r2(productValue * 0.08));
  // Extended storage (user 2026-07-22): NL-KALENDERDAG (aankomstdag = dag 1, +1 per
  // middernacht). Dag 31-60 = €2/stuk, 61-90 = €4/stuk (dag 91 = verbeurd, zit nooit in
  // het pakket). Dekt de BuckyDrop-verlenging (¥3/stuk per 30 dagen) + marge. Houd 1:1
  // gelijk aan pay_shipping_buffered (server rekent zelf via storage_day()).
  const storageDaysOf = (o) => {
    if (!o.arrived_at) return 0;
    const a = new Date(o.arrived_at); const n = new Date();
    return Math.floor((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000) + 1;
  };
  const storageFee = r2(haulItems.reduce((s, o) => {
    const d = storageDaysOf(o);
    return s + (d >= 61 ? 4 : d >= 31 ? 2 : 0) * (Number(o.qty) || 1);
  }, 0));
  const storageItems = haulItems.filter((o) => storageDaysOf(o) >= 31).length;
  // Valuta-conversie (EUR→CNY via Alipay, 3%) over ALLES wat naar yuan wordt omgezet: product +
  // binnenlandverzending (¥5/stuk) + qc (¥6/stuk) + fulfilment + internationale verzending (echte
  // schatting) + toeslag. NIET over de BTW (blijft euro's) of de service fee (marge). Houd 1:1 gelijk
  // aan pay_shipping_buffered (server).
  const domesticEur = r2(pieces * 5 / 7.8);
  const qcEur = r2(pieces * 6 / 7.8);
  const currencyFee = r2((productValue + domesticEur + qcEur + FULFIL_EUR + buffered + surcharge) * 0.03);
  const toPay = r2(buffered + vat + FULFIL_EUR + surcharge + svcFee + storageFee + currencyFee);
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
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 13, color: "#888" }}>International shipping{carrier ? <span style={{ color: "#fff", fontWeight: 600 }}> · {carrier}</span> : null} <span style={{ color: "#666" }}>· duties included</span></span>
            <span style={{ fontSize: 13, color: "#fff" }}>€{buffered.toFixed(2)}</span>
          </div>
          {/* Buffer zichtbaar (user 2026-07-22): de ×1,25 zit in het bedrag hierboven. */}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, paddingLeft: 12 }}>
            <span style={{ fontSize: 11.5, color: "#666" }}>↳ {tr("cost.bufferNote", "incl. +25% buffer · refunded if the real bill is lower")}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: "#888" }}>Currency conversion <span style={{ color: "#666" }}>· {tr("cost.currencyNote", "3% · on goods + shipping + fulfillment converted to ¥")}</span></span>
            <span style={{ fontSize: 13, color: "#fff" }}>€{currencyFee.toFixed(2)}</span>
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
          {surcharge > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: "#888" }}>Handling surcharge <span style={{ color: "#666" }}>· {[extraItems > 0 ? `¥2 × ${extraItems} extra item${extraItems > 1 ? "s" : ""}` : null, extraKg > 0 ? `¥1.5 × ${extraKg}kg over 2kg` : null].filter(Boolean).join(" · ")}</span></span>
              <span style={{ fontSize: 13, color: "#fff" }}>€{surcharge.toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: "#888" }}>Service fee <span style={{ color: "#666" }}>· 8% · min €5</span></span>
            <span style={{ fontSize: 13, color: "#fff" }}>€{svcFee.toFixed(2)}</span>
          </div>
          {storageFee > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: "#888" }}>Extended storage <span style={{ color: "#666" }}>· {storageItems} item{storageItems > 1 ? "s" : ""} over 30 days · €2 (31-60d) / €4 (61-90d)</span></span>
              <span style={{ fontSize: 13, color: "#fff" }}>€{storageFee.toFixed(2)}</span>
            </div>
          )}
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
      {chosen && !error && !quoting && (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={addrOk} onChange={e => setAddrOk(e.target.checked)} style={{ marginTop: 1, width: 16, height: 16, accentColor: "#FF5C00", flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: "#555", lineHeight: 1.5 }}>I confirm my delivery address is correct. A parcel sent to a wrong address can't be recovered.</span>
        </label>
      )}
      <button onClick={payLive} disabled={quoting || !!error || !chosen || !canAfford || confirming || !addrOk}
        style={{ width: "100%", background: quoting || error || !chosen || !canAfford || confirming || !addrOk ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: 700, cursor: quoting || error || !chosen || !canAfford || confirming || !addrOk ? "default" : "pointer" }}>
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
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#FFF1E8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}><Fox /></div>
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
  // Groep-gate (WATERDICHT): élk levend groep-item (behalve retours) moet klaar-in-de-doos zijn
  // vóór verzending. Dat omvat óók items die nog ONDERWEG zijn (nog niet aangekomen) — anders
  // vertrekt het pakket zonder die bestelling. De server (haul-shipping-group) dwingt dit óók af.
  const COMING_STATUSES = ["quote_accepted", "purchased", "bought", "shipped_local"];
  const groupAlive = (squadOrders || []).filter(o => !o.return_status && o.status !== "cancelled" && o.status !== "refunded");
  const groupComing = groupAlive.filter(o => COMING_STATUSES.includes(o.status)).length;                  // nog onderweg
  const groupUnstaged = groupAlive.filter(o => o.status === "qc_pending" && !o.box_staged_at).length;     // aangekomen, niet in doos
  const waitingCount = groupComing + groupUnstaged;
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

  // Viewport-coördinaten uit het pointer-event (robuust bij scroll); pointer-events
  // hebben clientX/Y voor zowel muis als touch. Val terug op info.point.
  const evXY = (info, e) => ({
    x: (e && typeof e.clientX === "number" ? e.clientX : e?.changedTouches?.[0]?.clientX) ?? info.point.x,
    y: (e && typeof e.clientY === "number" ? e.clientY : e?.changedTouches?.[0]?.clientY) ?? info.point.y,
  });
  // Royale trefzone: de hele doos + een ruime marge eromheen telt als "erin gesleept",
  // zodat een net-niet-precieze drop tóch landt.
  const pointInZone = (x, y, margin = 90) => {
    if (!dropZoneRef.current) return false;
    const r = dropZoneRef.current.getBoundingClientRect();
    return x >= r.left - margin && x <= r.right + margin && y >= r.top - margin && y <= r.bottom + margin;
  };

  // Live highlight terwijl je sleept (werkt ook op mobiel, waar mouseenter niet vuurt).
  const onDragMove = (info, e) => {
    const { x, y } = evXY(info, e);
    setIsDropTarget(pointInZone(x, y));
  };

  const onDragEnd = (order, info, e) => {
    setDraggingOrder(null);
    setIsDropTarget(false);
    if (dropZoneRef.current && typeof setHaulItems === "function") {
      const { x, y } = evXY(info, e);
      if (pointInZone(x, y) && !lockedIds.includes(order.id) && !haulItems.some(h => h.id === order.id)) {
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

      {/* Opslag-uitleg: 30 dagen gratis, daarna kosten, en wat er bij overschrijding gebeurt. */}
      <div style={{ background: "#F8F7F4", border: "1px solid #EAE7E0", borderRadius: 12, padding: "10px 13px", marginBottom: 16, fontSize: 12, color: "#6B6863", lineHeight: 1.5 }}>
        🗓️ <b style={{ color: "#0F0E0C" }}>Storage is free for 30 days.</b> After your items arrive they're stored safely at no cost for 30 days. After that a small extended-storage fee is added when you ship: €2 per item (31-60 days in storage) or €4 per item (61-90 days). If an item is still in the warehouse after day 90, it's forfeited. Each item below shows its storage day count (e.g. <b>5/30 free storage</b>).
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
          <WarehouseFox haulItems={haulItems} isDropTarget={isDropTarget} activeGroupId={activeGroupId} waitingCount={waitingCount} incomingCount={incomingCount} />
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
        return <OrderCard key={order.id} order={order} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} inHaul={inHaul} onOpenDetail={setDetailOrder} onReport={setDisputeOrder} />;
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
  const [pick, setPick] = useState(null); // null = dicht; object = auto-gekozen route ter bevestiging
  const [msg, setMsg] = useState("");
  const [payPage, setPayPage] = useState(false); // volledige betaalpagina (per-lid cost overview)
  const [openInfo, setOpenInfo] = useState(() => new Set()); // klikbare "?"-uitleg (buffer / 3% currency)
  const [addrOk, setAddrOk] = useState(false);
  const [balance, setBalance] = useState(0);
  const myId = session.user.id;
  useEffect(() => {
    let on = true;
    supabase.from("profiles").select("balance").eq("id", myId).single().then(({ data }) => { if (on) setBalance(Number(data?.balance) || 0); });
    return () => { on = false; };
  }, [myId, shipment?.members_paid, payPage]);

  const wrap = { background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: 16, marginBottom: 20 };
  const darkBtn = (disabled) => ({ width: "100%", background: disabled ? "#E8E6E0" : "#0F0E0C", color: disabled ? "#A8A5A0" : "#FF5C00", border: "none", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer" });
  const eur = (x) => `€${Number(x || 0).toFixed(2)}`;

  const getQuote = async () => {
    setBusy(true); setMsg("");
    const { data, error } = await supabase.functions.invoke("haul-shipping-group", { body: { action: "quote", groupId } });
    setBusy(false);
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "Could not get a shipping quote"); return; }
    if (!data.channels?.length) { setMsg(data.isSandbox ? "Sandbox: no live channels yet" : "No shipping options available right now"); return; }
    // AUTO-KEUZE, identiek aan solo (user 2026-07-21: geen keuzelijst meer): YunExpress
    // (Vera's hoofdlijn) → DHL (reserve) → goedkoopste DDP. BuckyDrop bepaalt bij het echte
    // verzenden tóch zelf de route (dashboard-prioriteit); dit is waar de schatting op rust.
    const ddp = data.channels.filter((c) => c.taxInclusive);
    const chosen = ddp.find((c) => /yun\s*express|yunexpress/i.test(c.name)) || ddp.find((c) => /dhl/i.test(c.name)) || ddp[0];
    if (!chosen) { setMsg("No duty-paid shipping option is available right now. Please try again in a little while."); return; }
    setPick(chosen);
  };
  const lock = async (serviceCode) => {
    setBusy(true); setMsg("");
    const { data, error } = await supabase.functions.invoke("haul-shipping-group", { body: { action: "lock", groupId, serviceCode } });
    setBusy(false);
    if (error || !data?.ok) { setMsg(data?.error || error?.message || "Could not lock the quote"); return; }
    setPick(null); onRefresh();
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
        ⏳ Waiting for your squad — {waitingCount} item{waitingCount === 1 ? "" : "s"} still on the way or not confirmed Ready yet. Everything ships in one parcel.
      </div>;
    }
    if (!isHost) {
      return <div style={{ ...wrap, textAlign: "center", fontSize: 13, color: "#6b6b6b" }}>
        ✓ Everyone hit Ready — the box is complete. The host{hostName ? ` (${hostName})` : ""} locks the shipping quote, then you each pay your share.
      </div>;
    }
    if (pick === null) {
      return <div style={{ marginBottom: 20 }}>
        <button disabled={busy} onClick={getQuote} style={darkBtn(busy)}>{busy ? "Getting quote…" : "Arrange shipping →"}</button>
        {err}
      </div>;
    }
    // LOCK-KAART (user 2026-07-22): host bevestigt alleen de route — GEEN totaalprijs meer
    // (die is misleidend: het is nog vóór buffer + fees, en de echte bedragen komen per lid
    // in de split). Drie icoon-regels maken glashelder wat het indrukken doet.
    return <div style={wrap}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>{tr("group.lock.title", "Lock in shipping")}</div>
      <div style={{ fontSize: 11.5, color: "#9C9893", lineHeight: 1.5, marginBottom: 11 }}>{tr("group.lock.subtitle", "One combined parcel to {host}. Confirm to open the payment split — then everyone pays their own share.", { host: hostName || tr("group.lock.hostFallback", "the host") })}</div>
      <div style={{ background: "#F8F7F4", border: "1px solid #E8E6E0", borderRadius: 12, padding: "11px 13px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15 }}>✈️</span>
        <span style={{ minWidth: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>{pick.name}</span>
          <span style={{ fontSize: 11, color: "#9C9893" }}>{pick.maxDays ? ` · ${pick.minDays}-${pick.maxDays} ${tr("group.lock.days", "days")}` : ""} · {tr("group.lock.duties", "duties included")}</span>
        </span>
      </div>
      {[
        ["🔒", tr("group.lock.point1", "The box locks — no more adding, removing or Ready changes after this")],
        ["⚖️", tr("group.lock.point2", "Everyone pays their own share, split by weight — within 72 hours")],
        ["💶", tr("group.lock.point3", "Prices show on the next screen · you pay an estimate, any overpayment comes back as a refund")],
      ].map(([icon, text], i) => (
        <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", marginBottom: i < 2 ? 7 : 12 }}>
          <span style={{ fontSize: 13, flexShrink: 0, lineHeight: 1.4 }}>{icon}</span>
          <span style={{ fontSize: 11.5, color: "#5F5C56", lineHeight: 1.45 }}>{text}</span>
        </div>
      ))}
      <button disabled={busy} onClick={() => lock(pick.serviceCode)} style={darkBtn(busy)}>{busy ? tr("group.lock.locking", "Locking in…") : tr("group.lock.cta", "Confirm & open the split →")}</button>
      <button onClick={() => { setPick(null); setMsg(""); }} style={{ width: "100%", background: "none", border: "none", color: "#9C9893", fontSize: 12, padding: 6, cursor: "pointer", marginTop: 4 }}>{tr("group.lock.cancel", "Cancel")}</button>
      {err}
    </div>;
  }

  // ── Quote vergrendeld → iedereen betaalt z'n aandeel ──
  if (shipment.status === "quoted") {
    const members = shipment.members || [];
    const me = members.find((m) => m.user_id === myId);
    const unpaid = members.filter((m) => !m.paid).length;
    const deadlinePassed = shipment.pay_deadline && new Date(shipment.pay_deadline).getTime() < Date.now();
    const myTotal = Number(me?.share_total) || 0;
    const canAfford = balance >= myTotal;

    // ── BETAALPAGINA (user 2026-07-22): volledige cost overview PER LID, onder elkaar
    //    (keuze B). Eigen kaart bovenaan met de betaalknop; andere leden info + status. ──
    if (payPage) {
      const line = (label, sub, val) => (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: "#888" }}>{label}{sub ? <span style={{ color: "#666" }}> · {sub}</span> : null}</span>
          <span style={{ fontSize: 13, color: "#fff" }}>{eur(val)}</span>
        </div>
      );
      const nMembers = members.length;
      // Service-fee-% per groepsgrootte (identiek aan de server-staffel ff_member_fee); solo = 8%.
      const feePct = nMembers >= 7 ? "4" : nMembers === 6 ? "4.5" : nMembers === 5 ? "5" : nMembers === 4 ? "5.5" : nMembers === 3 ? "6" : nMembers === 2 ? "7" : "8";
      // Groeps-minimum voor de service fee (staffel ff_member_fee): 2-3 = €4,50, 4-6 = €4,00, 7+ = €3,50. Solo = €5.
      const feeMin = nMembers >= 7 ? "3.50" : nMembers >= 4 ? "4.00" : "4.50";
      const strike = { color: "#666", textDecoration: "line-through", marginRight: 6 };
      // Klikbaar "?" (user 2026-07-22): morpht een lap uitleg open/dicht onder de regel.
      const toggleInfo = (key) => setOpenInfo((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
      const infoQ = (key) => (
        <button onClick={() => toggleInfo(key)} aria-label="info"
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 15, height: 15, borderRadius: "50%", border: "1px solid #555", background: openInfo.has(key) ? "#555" : "transparent", color: "#9C9893", fontSize: 10, fontWeight: 700, cursor: "pointer", marginLeft: 5, padding: 0, lineHeight: 1, verticalAlign: "middle" }}>?</button>
      );
      const infoText = (key, text) => (
        <AnimatePresence initial={false}>
          {openInfo.has(key) && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} style={{ overflow: "hidden" }}>
              <div style={{ fontSize: 11, color: "#8A8780", lineHeight: 1.5, background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px", margin: "0 0 8px" }}>{text}</div>
            </motion.div>
          )}
        </AnimatePresence>
      );
      // Al-betaald-regel (bij checkout betaald): alleen grijs bedrag. De losse groene "paid"
      // per regel is weg (user 2026-07-22) — de kop "ALREADY PAID AT CHECKOUT" zegt het al, en
      // het verdronk de échte status (verzending betaald ja/nee), die nu de kaart kleurt.
      const paidLine = (label, val) => (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
          <span style={{ fontSize: 12.5, color: "#6E6B66" }}>{label}</span>
          <span style={{ fontSize: 12.5, color: "#6E6B66" }}>{eur(val)}</span>
        </div>
      );
      const memberCard = (m) => {
        const own = m.user_id === myId;
        return (
          <div key={m.user_id} style={{ background: "#0F0E0C", borderRadius: 14, padding: 16, marginBottom: 12, border: m.paid ? "1.5px solid #10B981" : own ? "1.5px solid #FF5C00" : "1px solid #262421" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "#fff" }}>{own ? tr("group.pay.you", "You") : m.member}<span style={{ fontSize: 11.5, fontWeight: 500, color: "#9C9893" }}> · {(Number(m.weight_g) / 1000).toFixed(2)} kg</span></span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: m.paid ? "#10B981" : "#9C9893" }}>{m.paid ? tr("group.pay.paid", "✓ Paid") : tr("group.pay.pending", "Pending")}</span>
            </div>
            {/* AL BETAALD BIJ CHECKOUT — voor ELK lid zichtbaar (user 2026-07-22): group-buy
                = gedeelde mand, dus je ziet wat je vrienden kochten. Product/domestic/qc + groen "paid". */}
            {m.goods_eur != null && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: "#10B981", marginBottom: 6 }}>✓ {tr("group.pay.alreadyPaid", "ALREADY PAID AT CHECKOUT")}</div>
                {paidLine(tr("group.pay.goods", "Product"), m.goods_eur)}
                {paidLine(tr("group.pay.domestic", "Domestic shipping · ¥5"), m.domestic_eur)}
                {paidLine(tr("group.pay.qc", "Quality-control · ¥6"), m.qc_eur)}
                <div style={{ borderTop: "1px solid #262421", marginTop: 10 }} />
              </div>
            )}
            {/* International shipping LOS + buffer LOS met klikbaar "?" (user 2026-07-22). */}
            {(() => {
              const shipRaw = Math.round((Number(m.ship_eur) / 1.25) * 100) / 100;
              const shipBuffer = Math.round((Number(m.ship_eur) - shipRaw) * 100) / 100;
              return (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, color: "#888" }}>{tr("group.pay.shipping", "International shipping")} <span style={{ color: "#666" }}>· {carrierLabel(shipment.service_name)} · {tr("group.lock.duties", "duties included")}</span></span>
                    <span style={{ fontSize: 13, color: "#fff" }}>{eur(shipRaw)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: "#888" }}>{tr("group.pay.buffer", "Shipping buffer (+25%)")}{infoQ(m.user_id + "-buffer")}</span>
                    <span style={{ fontSize: 13, color: "#fff" }}>{eur(shipBuffer)}</span>
                  </div>
                  {infoText(m.user_id + "-buffer", tr("group.pay.bufferInfo", "The exact shipping bill only comes in about a week after the parcel leaves. We charge an estimate with a 25% buffer so the parcel can always go — once the real bill arrives, the difference is refunded to your balance."))}
                </>
              );
            })()}
            {Number(m.vat_eur) > 0 && line(tr("group.pay.vat", "Import VAT (21%)"), null, m.vat_eur)}
            {/* Currency conversion · 3% + klikbaar "?" met de basis-uitleg. */}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 13, color: "#888" }}>{tr("group.pay.currency", "Currency conversion")} <span style={{ color: "#666" }}>· 3%</span>{infoQ(m.user_id + "-cur")}</span>
              <span style={{ fontSize: 13, color: "#fff" }}>{eur(m.currency_eur)}</span>
            </div>
            {infoText(m.user_id + "-cur", tr("group.pay.currencyInfo", "The 3% Alipay conversion is charged on everything that gets converted to Chinese yuan: the product, China domestic shipping (¥5/item), quality-control (¥6/item), fulfillment and the international shipping. It is not charged on VAT, the service fee or storage."))}
            {/* Fulfillment: gedeeld door het aantal leden — solo-prijs doorgestreept ernaast. */}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: "#888" }}>{tr("pricing.fulfillment.name", "Fulfillment")} <span style={{ color: "#666" }}>· ¥9.9 ÷ {nMembers}</span></span>
              <span style={{ fontSize: 13, color: "#fff" }}><span style={strike}>{eur(m.fulfil_full)}</span>{eur(m.fulfil_eur)}</span>
            </div>
            {/* Service fee: groeps-% + solo (8% / €5) doorgestreept — het "samen is goedkoper"-effect. */}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: "#888" }}>{tr("cart.lineServiceFee", "Service fee")} <span style={{ color: "#666" }}>· <span style={{ textDecoration: "line-through" }}>8%</span> {feePct}% · <span style={{ textDecoration: "line-through" }}>min €5</span> min €{feeMin}</span></span>
              <span style={{ fontSize: 13, color: "#fff" }}><span style={strike}>{eur(m.fee_full)}</span>{eur(m.fee_eur)}</span>
            </div>
            {Number(m.storage_eur) > 0 && line(tr("cart.lineStorageFee", "Extended storage"), null, m.storage_eur)}
            {/* Voet kleurt mee met de verzend-status (user 2026-07-22): betaald = groen "✓ Paid"
                + groen bedrag; nog niet = wit label + oranje bedrag. Zo zie je per kaart in één
                oogopslag wie z'n deel al heeft afgerekend, los van de checkout-betaling erboven. */}
            <div style={{ borderTop: "1px solid #333", paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: m.paid ? "#10B981" : "#fff" }}>
                {m.paid
                  ? tr("group.pay.paid", "✓ Paid")
                  : <>{own ? tr("group.pay.yourShare", "Your share") : tr("group.pay.theirShare", "Their share")} <span style={{ fontWeight: 500, color: "#9C9893", fontSize: 12 }}>· {tr("group.pay.estimate", "estimate")}</span></>}
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: m.paid ? "#10B981" : "#FF5C00" }}>{eur(m.share_total)}</span>
            </div>
          </div>
        );
      };
      // Full-screen ECHTE pagina via portal naar body (user 2026-07-22): binnen de sheet
      // werkte position:fixed niet (framer-motion transform) → Back viel weg. Zelfde opzet
      // als de solo Confirm-pagina.
      return createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "#F4F2EE", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
          <div style={{ maxWidth: 460, margin: "0 auto", padding: "16px 20px 90px" }}>
            <button onClick={() => setPayPage(false)} style={{ background: "none", border: "none", fontSize: 14, color: "#666", cursor: "pointer", padding: 0, marginBottom: 16 }}>← {tr("group.pay.back", "Back")}</button>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>{tr("group.pay.title2", "Confirm shipping")}</div>
            <div style={{ fontSize: 13, color: "#aaa", marginBottom: 18 }}>{tr("group.pay.subtitle2", "One parcel to {host}, split by weight — pay your own share below.", { host: hostName || tr("group.lock.hostFallback", "the host") })}</div>
            {members.map(memberCard)}
            {me && !me.paid && (
              <>
                <div style={{ background: canAfford ? "#F0FDF4" : "#FEF3C7", border: `1px solid ${canAfford ? "#10B981" : "#F59E0B"}`, borderRadius: 12, padding: "12px 16px", margin: "4px 0 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, color: canAfford ? "#065F46" : "#92400E" }}>{tr("group.pay.balance", "Your balance")}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: canAfford ? "#10B981" : "#B45309" }}>{eur(balance)}</span>
                  </div>
                  {!canAfford && <div style={{ fontSize: 12, color: "#B45309", marginTop: 6 }}>{tr("group.pay.short", "You're {amount} short.", { amount: eur(myTotal - balance) })}</div>}
                </div>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={addrOk} onChange={(e) => setAddrOk(e.target.checked)} style={{ marginTop: 1, width: 16, height: 16, accentColor: "#FF5C00", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "#555", lineHeight: 1.5 }}>{tr("group.pay.addr", "I confirm the parcel ships to the host's address. A parcel sent to a wrong address can't be recovered.")}</span>
                </label>
                <button disabled={busy || !canAfford || !addrOk} onClick={pay}
                  style={{ width: "100%", background: (busy || !canAfford || !addrOk) ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "15px", fontSize: 14.5, fontWeight: 700, cursor: (busy || !canAfford || !addrOk) ? "default" : "pointer" }}>
                  {busy ? tr("group.pay.paying", "Paying…") : tr("group.pay.cta", "Confirm & pay {amount}", { amount: eur(myTotal) })}
                </button>
              </>
            )}
            {me && me.paid && (
              <div style={{ textAlign: "center", fontSize: 13, fontWeight: 700, color: "#10B981", padding: "8px 0" }}>{tr("group.pay.done", "✓ You paid {amount} — waiting for the rest of your squad.", { amount: eur(myTotal) })}</div>
            )}
            {msg && <div style={{ fontSize: 12, color: "#B91C1C", textAlign: "center", marginTop: 10 }}>{msg}</div>}
          </div>
        </div>,
        document.body
      );
    }

    // ── Compacte kaart in de sheet: melding "admin heeft gelockt" + oranje Confirm & ship. ──
    return <div style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C" }}>{tr("group.quoted.title", "Shipping is locked")}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#FF5C00" }}>{shipment.members_paid}/{shipment.members_total} {tr("group.quoted.paid", "paid")}</span>
      </div>
      <div style={{ fontSize: 12, color: "#5F5C56", lineHeight: 1.5, marginBottom: 12 }}>
        {me && me.paid
          ? tr("group.pay.done", "✓ You paid {amount} — waiting for the rest of your squad.", { amount: eur(myTotal) })
          : tr("group.quoted.body", "Your admin locked the group cart. You can now confirm & ship your part of the parcel on the next page.")}
      </div>
      {me && !me.paid && (
        <button onClick={() => setPayPage(true)} style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "15px", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>{tr("parcel.sheet.confirm", "Confirm & ship")} →</button>
      )}
      {me && me.paid && (
        <button onClick={() => setPayPage(true)} style={{ width: "100%", background: "#F1EFE9", color: "#6B6862", border: "none", borderRadius: 12, padding: "12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{tr("group.quoted.viewSplit", "View the split")}</button>
      )}
      {isHost && deadlinePassed && unpaid > 0 && (
        <button disabled={busy} onClick={drop} style={{ width: "100%", marginTop: 8, background: "#FFF7ED", color: "#92400E", border: "1px solid #FCD9B6", borderRadius: 12, padding: "11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{tr("group.quoted.dropUnpaid", "Ship without {count} unpaid member{s} →", { count: unpaid, s: unpaid === 1 ? "" : "s" })}</button>
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
// ────────────────────────────────────────────────────────────────────────────
// 📦 ParcelSection — het automatische pakket op de samengevoegde Orders-pagina.
// Optie B: alles wat in het magazijn aankomt zit VANZELF in je pakket; apart
// houden kan per item (heldOut, beheerd door de parent). Onderaan een pakket-
// balk (zelfde donkere pil als de mand-balk) → sheet met items + schatting →
// de bestaande verzendflow (ConfirmHaul incl. opslag-quote-route + HaulSuccess).
// GROEP-modus: de sheet toont het HELE groepspakket (ieders aangekomen items, met
// naam + Ready-status; tik = inspectiesheet met foto's via onInspectItem). Items
// gaan automatisch "in de doos" bij aankomst, maar elk lid bevestigt z'n eigen
// items met Ready ná foto-inspectie (ff_stage_box → box_staged_at) — de server-
// gate laat pas verzenden als ALLES Ready is. Geen stille auto-staging meer.
// ────────────────────────────────────────────────────────────────────────────
export function ParcelSection({ session, activeGroupId = null, parcelItems = [], heldOutItems = [], pendingRefunds = [], defectItems = [], forfeitedItems = [], comingItems = [], refreshSignal = 0, onToggleHold, onInspectItem, onShipped }) {
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState(null);      // null | "confirm" | "success"
  const [balance, setBalance] = useState(0);
  const [squadOrders, setSquadOrders] = useState([]);
  const [squadHostId, setSquadHostId] = useState(null);
  const [shipState, setShipState] = useState(null);
  // 📦-vlucht: bij het openen springt het doosje naast "Your orders' journey in China"
  // (de reiskaart, [data-journey-box]) in een BOOG omlaag naar linksboven in de sheet —
  // ghost-patroon zoals de 💸/💎-boogvlucht (geen layoutId: die vecht met de hoogte-groei).
  // Het balk-doosje fadet gewoon mee weg met de balk. Bij sluiten komt het bron-doosje terug.
  const [boxFlight, setBoxFlight] = useState(null);
  const titleBoxRef = useRef(null);
  const sheetRef = useRef(null);
  const contentRef = useRef(null);
  const didReveal = useRef(false);   // boom-groei alleen bij het openen, niet bij elke re-render

  const journeyBox = () => document.querySelector("[data-journey-box]");
  const openParcel = () => {
    didReveal.current = false;
    const src = journeyBox();
    const r = src?.getBoundingClientRect();
    if (r && r.width > 0) {
      src.style.opacity = "0";   // de bron "vertrekt" — ghost neemt het over
      setBoxFlight({ pending: true, sx: r.left + r.width / 2, sy: r.top + r.height / 2 });
    }
    setOpen(true);
  };
  const closeSheet = () => {
    setOpen(false); setBoxFlight(null);
    const src = journeyBox(); if (src) src.style.opacity = "1";   // doosje keert terug op de reiskaart
  };
  useEffect(() => () => { const src = journeyBox(); if (src) src.style.opacity = "1"; }, []);   // vangnet bij unmount
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { didReveal.current = true; }, 120);
    return () => clearTimeout(t);
  }, [open]);
  // Meet het EINDpunt van de vlucht: de titel schuift tijdens de groei nog omhoog (de kaart
  // is onder verankerd), dus corrigeer met de volledige groei-hoogte (gecapt op maxHeight).
  useEffect(() => {
    if (!open || !boxFlight?.pending) return;
    const t = setTimeout(() => {
      const card = sheetRef.current, icon = titleBoxRef.current;
      if (!card || !icon) { setBoxFlight(null); return; }
      const cr = card.getBoundingClientRect();
      const ir = icon.getBoundingClientRect();
      const growH = contentRef.current ? contentRef.current.offsetHeight : 0;
      const finalH = Math.min(cr.height + growH, window.innerHeight * 0.74);
      const dy = Math.max(0, finalH - cr.height);
      setBoxFlight((f) => f ? { sx: f.sx, sy: f.sy, tx: ir.left + ir.width / 2, ty: ir.top + ir.height / 2 - dy, pending: false } : null);
    }, 60);
    return () => clearTimeout(t);
  }, [open, boxFlight]);

  const fetchBalance = async () => {
    const { data } = await supabase.from("profiles").select("balance").eq("id", session.user.id).single();
    setBalance(data?.balance || 0);
  };
  const fetchSquad = async () => {
    if (!activeGroupId) { setSquadOrders([]); setSquadHostId(null); setShipState(null); return; }
    const { data } = await supabase.rpc("ff_group_orders", { p_group_id: activeGroupId });
    setSquadOrders(data?.orders || []);
    setSquadHostId(data?.host_id || null);
    const { data: s } = await supabase.rpc("ff_group_shipping_state", { p_group_id: activeGroupId });
    setShipState(s?.shipment || null);
  };
  useEffect(() => {
    fetchBalance(); fetchSquad();
    if (!activeGroupId) return;
    const t = setInterval(fetchSquad, 8000);   // lichte poll → staging + betaal-status live
    return () => clearInterval(t);
  }, [activeGroupId]);

  // Sync-fix (user 2026-07-21): als de klant elders "Ready" drukt (bv. onderaan de
  // Quality-control-foto's), bumpt de parent refreshSignal → haal de groep-status
  // meteen opnieuw op i.p.v. tot de 8s-poll te wachten.
  useEffect(() => {
    if (activeGroupId && refreshSignal) fetchSquad();
  }, [refreshSignal]);

  // Eigen groep-item Ready/Unready zetten vanuit het pakket zelf (user 2026-07-21).
  // ff_stage_box staat alleen je EIGEN items toe; daarna direct de groep-status verversen.
  const stageOwn = async (orderId, staged) => {
    if (!activeGroupId) return;
    await supabase.rpc("ff_stage_box", { p_order_ids: [orderId], p_staged: staged });
    fetchSquad();
  };

  // GEEN stille auto-staging meer: box_staged_at wordt gezet door de expliciete
  // Ready-bevestiging van het lid zelf (na foto-inspectie), via de parent
  // (markParcelReady/toggleParcelHold in de app) — niet hier.

  // Groeps-gate — zelfde regels als voorheen (de server dwingt dit óók af):
  // wachten = nog onderweg + aangekomen-maar-nog-niet-Ready (incl. apart gehouden).
  const COMING = ["quote_accepted", "purchased", "bought", "shipped_local"];
  // Verzend-lock van de groep (user 2026-07-22, keuze B): zodra de quote gelockt is, kan
  // niemand nog Ready/Unready wijzigen (server dwingt dit al af; dit toont het duidelijk).
  const groupShipLocked = ["quoted", "consolidating", "shipped"].includes(shipState?.status);
  const alive = (squadOrders || []).filter((o) => !o.return_status && o.status !== "cancelled" && o.status !== "refunded");
  const waitingCount = alive.filter((o) => COMING.includes(o.status)).length + alive.filter((o) => o.status === "qc_pending" && !o.box_staged_at).length;
  // Groep-items met een probleem (defect gemeld of lopend refund-verzoek) — die blokkeren
  // het pakket tot de eigenaar ze afhandelt (user 2026-07-21).
  const actionItems = alive.filter((o) => o.dispute_status === "bucky_flagged" || o.dispute_status === "pending");
  const isHost = !activeGroupId || session.user.id === squadHostId;
  const hostName = ((squadOrders || []).find((o) => o.user_id === squadHostId) || {}).member;

  // GROEP: het pakket toont ieders aangekomen items (behalve wat jij zelf apart houdt —
  // dat staat in de eigen "held out"-sectie). Solo: gewoon je eigen pakket-items.
  const heldIds = new Set(heldOutItems.map((o) => o.id));
  const groupArrived = activeGroupId ? alive.filter((o) => o.status === "qc_pending" && !heldIds.has(o.id)) : [];
  // GROEP-weergave (user 2026-07-20): ÁLLE items van álle leden, gegroepeerd per lid,
  // met het 3-status-systeem: Order placed → Unready (aangekomen) → Ready (bevestigd).
  // Eigen sectie bovenaan. Inspecteren/bevestigen gebeurt in de orderlijst, niet hier.
  const memberSections = (() => {
    if (!activeGroupId) return [];
    const byUser = new Map();
    for (const o of alive) {
      if (heldIds.has(o.id)) continue;
      if (!byUser.has(o.user_id)) byUser.set(o.user_id, { userId: o.user_id, name: o.member, items: [] });
      byUser.get(o.user_id).items.push(o);
    }
    const list = [...byUser.values()];
    list.sort((a, b) => (a.userId === session.user.id ? -1 : b.userId === session.user.id ? 1 : 0));
    return list;
  })();

  const totalWeight = parcelItems.reduce((s, o) => s + (o.weight_grams || 0), 0);
  const est = totalWeight > 0 ? shippingEstimate(totalWeight / 1000) : null;
  const count = activeGroupId ? groupArrived.length : parcelItems.length;

  const thumb = (o) => (
    <div style={{ width: 40, height: 40, borderRadius: 9, background: "#fff", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {(o.qc_images?.[0] || o.variant_image) ? <img src={o.qc_images?.[0] || o.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 17 }}>📦</span>}
    </div>
  );

  // Balk ook tonen als er ALLEEN geblokkeerde/onderweg-items zijn (defect zonder keuze,
  // lopende refund, order placed) — anders verdwijnt het hele pakket-overzicht precies op
  // het moment dat de klant wil zien wáárom er niks te verzenden valt (bug 2026-07-22:
  // refund-aanvraag op het laatste vrije item → balk weg).
  const show = count > 0 || heldOutItems.length > 0 || pendingRefunds.length > 0 || defectItems.length > 0 || comingItems.length > 0 || (activeGroupId && (waitingCount > 0 || !!shipState));
  if (!show) return null;

  return (
    <>
      {/* Pakket-balk — boven de nav, zelfde plek/stijl als de mand-balk op de feed */}
      <AnimatePresence>
        {!open && !screen && (
          <motion.div key="parcel-bar" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}
            whileTap={{ scaleX: 1.03, scaleY: 0.93 }} transition={springMorph}
            onClick={openParcel}
            style={{ position: "fixed", bottom: 86, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 40px)", maxWidth: 390, background: "#111111", borderRadius: 999, overflow: "hidden", cursor: "pointer", zIndex: 301, boxShadow: "0 12px 40px rgba(17,17,17,0.35)" }}>
            <div style={{ padding: "11px 18px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 18 }}>📦</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {activeGroupId
                    ? `${tr("parcel.bar.titleGroup", "Group parcel")} · ${waitingCount > 0 ? tr("parcel.bar.waiting", "waiting for {count} item{s}", { count: waitingCount, s: waitingCount > 1 ? "s" : "" }) : tr("parcel.bar.ready", "ready to ship")}`
                    : tr("parcel.bar.title", "Your parcel · {count} item{s}", { count, s: count === 1 ? "" : "s" })}
                </div>
                <div style={{ fontSize: 11.5, color: "#9C9893" }}>
                  {/* Bedrag uit de balk (user 2026-07-22): prijs pas ná Confirm & ship. */}
                  {tr("parcel.bar.subtitle", "Tap to review & ship")} <Fox />
                </div>
              </div>
              <motion.div animate={{ y: [0, -3, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,92,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <ChevronUp size={16} color="#FF5C00" strokeWidth={2.5} />
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pakket-sheet — donkere kaart, inklap-pijltje rechtsboven (zoals de mand) */}
      <AnimatePresence>
        {open && !screen && (
          <>
            <motion.div key="parcel-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeSheet}
              style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }} />
            {/* Zelfde choreografie als de mand: compacte kaart fadet op de balk-plek in,
                daarna boom-groei (CartGrower) met regel-reveals; sluiten = omgekeerde groei. */}
            <motion.div key="parcel-sheet" ref={sheetRef} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6, transition: { duration: 0.14, delay: 0.2, ease: "easeIn" } }}
              transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8, opacity: { duration: 0.16, ease: "easeOut" } }}
              style={{ position: "fixed", bottom: 86, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 24px)", maxWidth: 404, boxSizing: "border-box", background: "#111111", borderRadius: 28, zIndex: 301, maxHeight: "74vh", overflowY: "auto", overscrollBehavior: "contain", boxShadow: "0 30px 80px rgba(0,0,0,0.5)", padding: "16px 18px 22px" }}>
              <div style={{ position: "sticky", top: 2, zIndex: 6, height: 0, display: "flex", justifyContent: "flex-end" }}>
                <motion.button whileTap={{ scale: 0.88 }} onClick={closeSheet} aria-label={tr("parcel.sheet.collapse", "Collapse parcel")}
                  style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,92,0,0.15)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                  <ChevronDown size={16} color="#FF5C00" strokeWidth={2.5} />
                </motion.button>
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#fff", margin: "4px 0 4px" }}>
                {/* het doos-emoji wacht verborgen tot de vlucht vanaf de balk erin landt */}
                <motion.span ref={titleBoxRef} initial={false}
                  animate={boxFlight && boxFlight !== "landed" ? { opacity: 0, scale: 0.3 } : { opacity: 1, scale: 1 }}
                  transition={springBouncy} style={{ display: "inline-block" }}>📦</motion.span>{" "}
                {(() => {
                  const title = activeGroupId
                    ? tr("parcel.sheet.titleGroup", "Group parcel ({count})", { count })
                    : tr("parcel.sheet.title", "Your parcel ({count})", { count });
                  return didReveal.current ? title : <WordReveal text={title} delay={0.12} stagger={0.05} />;
                })()}
              </div>
              <CartGrower skip={didReveal.current}>
              <div ref={contentRef}>
              <FoldReveal i={0} n={count + 5} skip={didReveal.current}>
              <div style={{ fontSize: 11.5, color: "#9C9893", lineHeight: 1.5, marginBottom: 12 }}>
                {activeGroupId
                  ? tr("parcel.sheet.autoNoteGroup2", "Everyone's items land here when they arrive. Inspect & confirm your own items from the orders list — the parcel ships once every item is Ready.")
                  : tr("parcel.sheet.autoNote", "Items land here automatically when they arrive in the warehouse. One parcel = one shipping cost + one service fee.")}
              </div>
              </FoldReveal>

              {/* ⚠️ Action needed (user 2026-07-21): één of meer groep-items hebben een defect
                  of een lopend refund-verzoek — het pakket kan pas weg als dat is opgelost. */}
              {activeGroupId && actionItems.length > 0 && (
                <FoldReveal i={1} n={count + 5} skip={didReveal.current}>
                <div style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 12, padding: "10px 12px", marginBottom: 12 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#FBBF24", marginBottom: 2 }}>⚠️ {tr("parcel.sheet.groupActionTitle", "Action needed")}</div>
                  <div style={{ fontSize: 11.5, color: "#D9B87A", lineHeight: 1.5 }}>
                    {tr("parcel.sheet.groupActionBody", "{count} item{s} in this group needs attention (a defect or a refund request) — the parcel can't ship until it's resolved from the orders list.", { count: actionItems.length, s: actionItems.length > 1 ? "s" : "" })}
                  </div>
                </div>
                </FoldReveal>
              )}

              {activeGroupId && waitingCount > 0 && (
                <FoldReveal i={1} n={count + 5} skip={didReveal.current}>
                <div style={{ background: "rgba(99,102,241,0.14)", borderRadius: 12, padding: "9px 12px", marginBottom: 12, fontSize: 12, color: "#A5B4FC", lineHeight: 1.5 }}>
                  {tr("parcel.sheet.groupWaitingReady", "The group parcel ships once every item has arrived and everyone hit Ready — {count} to go.", { count: waitingCount })}
                </div>
                </FoldReveal>
              )}

              {count === 0 && (
                <FoldReveal i={1} n={count + 5} skip={didReveal.current}>
                <div style={{ fontSize: 12.5, color: "#9C9893", padding: "10px 2px 4px" }}>{tr("parcel.sheet.empty", "No items in your parcel yet — they appear here when they arrive in the warehouse.")}</div>
                </FoldReveal>
              )}
              {/* GROEP (user 2026-07-20): álle items van álle leden, per lid gegroepeerd.
                  Rijen zijn NIET klikbaar — inspecteren/Ready gebeurt in de orderlijst.
                  3 statussen: Order placed (onderweg) → Unready (aangekomen) → Ready (bevestigd).
                  Eigen Ready-items houden de ✕ (apart houden). */}
              {activeGroupId && memberSections.map((sec, secIdx) => {
                const own = sec.userId === session.user.id;
                return (
                  <FoldReveal key={sec.userId} i={1 + secIdx} n={count + 5} skip={didReveal.current}>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: "#8A8780", margin: "6px 2px 6px", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 7 }}>
                      {own ? tr("parcel.row.you", "You") : (sec.name || tr("inspect.friendFallback", "Friend"))}
                      {/* Host-badge (user 2026-07-22): het pakket gaat naar dit lid. */}
                      {sec.userId === squadHostId && (
                        <span style={{ background: "rgba(255,92,0,0.16)", color: "#FF8A3D", fontSize: 9.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20, textTransform: "none" }}>🏠 {tr("orders.squad.host", "Host")}</span>
                      )}
                    </div>
                    {sec.items.map((o) => {
                      const arrived = o.status === "qc_pending";
                      const ready = arrived && !!o.box_staged_at;
                      // Iets mis met dit item? (user 2026-07-21) — defect gemeld door QC, of een
                      // lopend refund-verzoek van de eigenaar. Blokkeert het groepspakket tot het
                      // is opgelost; de eigenaar handelt het af via de orderlijst / QC-foto's.
                      const flagged = o.dispute_status === "bucky_flagged";
                      const reviewing = o.dispute_status === "pending";
                      const needsAction = flagged || reviewing;
                      const locked = !!o.group_shipping_paid;
                      // EIGEN aangekomen item zonder probleem: status-badge (Ready/Unready) +
                      // aparte knop eronder (user 2026-07-22). Een al-betaald item is vast Ready
                      // (geen knop). Andermans items + probleem-/onderweg-items = alleen een badge.
                      // Bij een gelockte verzending kan niemand meer togglen → toon een grijze
                      // "your admin locked the group"-regel i.p.v. de knop (user 2026-07-22).
                      const showToggle = own && arrived && !needsAction && !locked && !groupShipLocked;
                      const lockedNote = own && arrived && !needsAction && groupShipLocked;
                      return (
                        <div key={o.id} style={{ marginBottom: 7 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 11, background: "#1A1917", borderRadius: (showToggle || lockedNote) ? "13px 13px 0 0" : 13, padding: "9px 11px", border: needsAction ? "1px solid rgba(245,158,11,0.4)" : "1px solid transparent" }}>
                            {thumb(o)}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.product_title || o.product}</div>
                              <div style={{ fontSize: 11, color: "#9C9893" }}>
                                {tr("orders.item.pcs", "{qty} pcs", { qty: o.qty || 1 })}{o.weight_grams ? ` · ${o.weight_grams} g` : ""}
                              </div>
                            </div>
                            {/* Status-badge (niet klikbaar) — prioriteit: probleem > forfeited > Ready/Unready > onderweg. */}
                            {needsAction ? (
                              <span style={{ flexShrink: 0, background: "rgba(245,158,11,0.16)", color: "#FBBF24", fontSize: 10, fontWeight: 700, padding: "4px 9px", borderRadius: 999, textAlign: "right", lineHeight: 1.3, maxWidth: 120 }}>
                                ⚠️ {flagged ? tr("parcel.row.defectAction", "Defect — action needed") : tr("parcel.row.underReview", "Under review")}
                              </span>
                            ) : o.status === "forfeited" ? (
                              <span style={{ flexShrink: 0, background: "rgba(107,114,128,0.22)", color: "#B8B5B0", fontSize: 10.5, fontWeight: 700, padding: "4px 9px", borderRadius: 999 }}>{tr("parcel.chip.forfeited", "Item forfeited")}</span>
                            ) : ready ? (
                              <span style={{ flexShrink: 0, background: "rgba(16,185,129,0.16)", color: "#34D399", fontSize: 10.5, fontWeight: 700, padding: "4px 9px", borderRadius: 999 }}>✓ {tr("parcel.row.ready", "Ready")}</span>
                            ) : arrived ? (
                              <span style={{ flexShrink: 0, background: "rgba(245,158,11,0.16)", color: "#FBBF24", fontSize: 10.5, fontWeight: 700, padding: "4px 9px", borderRadius: 999 }}>⏳ {tr("parcel.chip.unready", "Unready")}</span>
                            ) : (
                              <span style={{ flexShrink: 0, background: "rgba(56,189,248,0.14)", color: "#7DD3FC", fontSize: 10.5, fontWeight: 700, padding: "4px 9px", borderRadius: 999 }}>{tr("orders.checkpoint.orderPlaced", "Order placed")}</span>
                            )}
                          </div>
                          {/* Actie-knop ONDER de rij (user 2026-07-22): "Tap Ready" als 'ie op Unready
                              staat, "Tap Unready" als 'ie op Ready staat. Alleen je eigen items. */}
                          {showToggle && (
                            <motion.button whileTap={{ scale: 0.985 }} onClick={() => stageOwn(o.id, !ready)}
                              style={{ display: "block", width: "100%", background: ready ? "rgba(255,255,255,0.06)" : "#FF5C00", color: ready ? "#C9C6C1" : "#fff", border: "none", borderRadius: "0 0 13px 13px", padding: "9px", fontSize: 12, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                              {ready ? <>↩ {tr("parcel.row.tapUnready", "Tap to set Unready")}</> : <>✓ {tr("parcel.row.tapReadyLong", "Tap to set Ready")}</>}
                            </motion.button>
                          )}
                          {lockedNote && (
                            <div style={{ padding: "8px 9px", background: "rgba(255,255,255,0.03)", borderRadius: "0 0 13px 13px", textAlign: "center", fontSize: 11, color: "#8A8780" }}>🔒 {tr("group.locked.note", "Your admin locked the group")}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  </FoldReveal>
                );
              })}
              {!activeGroupId && parcelItems.map((o, rowIdx) => (
                <FoldReveal key={o.id} i={1 + rowIdx} n={count + 5} skip={didReveal.current}>
                <div style={{ display: "flex", alignItems: "center", gap: 11, background: "#1A1917", borderRadius: 13, padding: "9px 11px", marginBottom: 7 }}>
                  {thumb(o)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.product_title || o.product}</div>
                    <div style={{ fontSize: 11, color: "#9C9893" }}>{o.weight_grams ? `${o.weight_grams} g` : `${o.qty || 1} pcs`}</div>
                  </div>
                  {onToggleHold && (
                    <motion.button whileTap={{ scale: 0.85 }} onClick={() => onToggleHold(o.id)} aria-label={tr("parcel.chip.holdOut", "Hold out of parcel")}
                      style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "#C9C6C1", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>✕</motion.button>
                  )}
                </div>
                </FoldReveal>
              ))}
              {/* Lopende refund-verzoeken (user 2026-07-22): item blijft ZICHTBAAR in het
                  pakket met embleem — en blokkeert Confirm & ship tot jij hebt beslist. */}
              {!activeGroupId && pendingRefunds.map((o) => (
                <div key={"pr-" + o.id} style={{ display: "flex", alignItems: "center", gap: 11, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 13, padding: "9px 11px", marginBottom: 7, opacity: 0.9 }}>
                  {thumb(o)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.product_title || o.product}</div>
                    <div style={{ fontSize: 11, color: "#FBBF24" }}>{tr("parcel.sheet.notInParcel", "It's currently not in your parcel")}</div>
                  </div>
                  <span style={{ flexShrink: 0, background: "rgba(245,158,11,0.16)", color: "#FBBF24", fontSize: 10, fontWeight: 700, padding: "4px 9px", borderRadius: 999, textAlign: "right", lineHeight: 1.3 }}>
                    {tr("parcel.chip.refundRequested", "Refund requested")}<br />{tr("parcel.chip.awaitingResponse", "awaiting response")}
                  </span>
                </div>
              ))}
              {/* Defect gedetecteerd (user 2026-07-22): net als bij Friends zichtbaar mét
                  status — maar het item zit NIET in het pakket (solo heeft geen lock), dus
                  dat zeggen we er expliciet bij. Accepteert de klant → schuift het vanzelf
                  het pakket in; kiest 'ie retour → refund en het gaat nooit mee. */}
              {!activeGroupId && defectItems.map((o) => (
                <div key={"df-" + o.id} style={{ display: "flex", alignItems: "center", gap: 11, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 13, padding: "9px 11px", marginBottom: 7, opacity: 0.9 }}>
                  {thumb(o)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.product_title || o.product}</div>
                    <div style={{ fontSize: 11, color: "#FBBF24" }}>{tr("parcel.sheet.notInParcel", "It's currently not in your parcel")}</div>
                  </div>
                  <span style={{ flexShrink: 0, background: "rgba(245,158,11,0.16)", color: "#FBBF24", fontSize: 10, fontWeight: 700, padding: "4px 9px", borderRadius: 999, textAlign: "right", lineHeight: 1.3 }}>
                    ⚠ {tr("parcel.chip.actionNeeded", "Action needed")}<br />{tr("parcel.chip.chooseKeepReturn", "choose keep or return")}
                  </span>
                </div>
              ))}
              {/* Bundel-waarschuwing (user 2026-07-22): nu verzenden terwijl er nog items
                  onderweg zijn = straks een TWEEDE pakket met opnieuw verzendkosten +
                  fulfilment + service fee. Knop blijft werken — bewuste keuze. */}
              {!activeGroupId && comingItems.length > 0 && count > 0 && (
                <div style={{ background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 12, padding: "10px 12px", margin: "4px 0 10px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#FBBF24", marginBottom: 2 }}>⚠️ {tr("parcel.sheet.bundleWarnTitle", "{count} item{s} still on the way", { count: comingItems.length, s: comingItems.length > 1 ? "s" : "" })}</div>
                  <div style={{ fontSize: 11.5, color: "#D9B87A", lineHeight: 1.5 }}>
                    {tr("parcel.sheet.bundleWarnBody", "If you ship now, those items will form a second parcel later — with its own shipping cost, fulfillment fee and service fee on top. One bigger parcel is cheaper per item: you pay all of those just once.")}
                  </div>
                </div>
              )}
              {/* Onderweg naar het magazijn (user 2026-07-22): SOLO toont "Order placed"-items
                  grijs, zodat de klant het hele pakket ziet vormen. Tellen NIET mee in Confirm
                  & ship — ze schuiven vanzelf door zodra ze aankomen. */}
              {!activeGroupId && comingItems.length > 0 && (
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: "#6E6B66", margin: "10px 2px 6px" }}>{tr("parcel.sheet.comingHeader", "ON THE WAY — joins your parcel when it arrives")}</div>
              )}
              {!activeGroupId && comingItems.map((o) => (
                <div key={"cm-" + o.id} style={{ display: "flex", alignItems: "center", gap: 11, background: "#1A1917", borderRadius: 13, padding: "9px 11px", marginBottom: 7, opacity: 0.6 }}>
                  {thumb(o)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#C9C6C1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.product_title || o.product}</div>
                    <div style={{ fontSize: 11, color: "#8A8780" }}>{o.qty || 1} pcs</div>
                  </div>
                  <span style={{ flexShrink: 0, background: "rgba(56,189,248,0.14)", color: "#7DD3FC", fontSize: 10.5, fontWeight: 700, padding: "4px 9px", borderRadius: 999 }}>{tr("orders.checkpoint.orderPlaced", "Order placed")}</span>
                </div>
              ))}
              {/* Verbeurde items (user 2026-07-22): grijs zichtbaar, tellen nergens mee —
                  Confirm & ship blijft gewoon werken voor de rest van het pakket. */}
              {!activeGroupId && forfeitedItems.map((o) => (
                <div key={"ff-" + o.id} style={{ display: "flex", alignItems: "center", gap: 11, background: "#1A1917", borderRadius: 13, padding: "9px 11px", marginBottom: 7, opacity: 0.55 }}>
                  {thumb(o)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#C9C6C1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: "line-through" }}>{o.product_title || o.product}</div>
                    <div style={{ fontSize: 11, color: "#8A8780" }}>{o.weight_grams ? `${o.weight_grams} g` : `${o.qty || 1} pcs`}</div>
                  </div>
                  <span style={{ flexShrink: 0, background: "rgba(107,114,128,0.22)", color: "#B8B5B0", fontSize: 10.5, fontWeight: 700, padding: "4px 9px", borderRadius: 999 }}>
                    {tr("parcel.chip.forfeited", "Item forfeited")}
                  </span>
                </div>
              ))}

              {heldOutItems.length > 0 && (
                <FoldReveal i={1 + count} n={count + 5} skip={didReveal.current}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: "#6E6B66", margin: "10px 2px 6px" }}>{tr("parcel.sheet.heldOut", "HELD OUT — not shipping")}</div>
                  {heldOutItems.map((o) => (
                    <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 11, background: "rgba(255,255,255,0.04)", borderRadius: 13, padding: "9px 11px", marginBottom: 7, opacity: 0.75 }}>
                      {thumb(o)}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#C9C6C1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.product_title || o.product}</div>
                        <div style={{ fontSize: 11, color: "#8A8780" }}>{o.weight_grams ? `${o.weight_grams} g` : `${o.qty || 1} pcs`}</div>
                      </div>
                      {onToggleHold && (
                        <motion.button whileTap={{ scale: 0.92 }} onClick={() => onToggleHold(o.id)}
                          style={{ flexShrink: 0, background: "rgba(255,92,0,0.15)", color: "#FF5C00", border: "none", borderRadius: 999, padding: "6px 11px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{tr("parcel.chip.addBack", "＋ Add back")}</motion.button>
                      )}
                    </div>
                  ))}
                </FoldReveal>
              )}

              {/* Gewicht-/prijsblok VERWIJDERD (user 2026-07-22): de prijs komt pas ná
                  "Confirm & ship", op het offerte-scherm. */}

              <FoldReveal i={3 + count} n={count + 5} skip={didReveal.current}>
              {activeGroupId ? (
                <div style={{ marginTop: 12 }}>
                  <GroupShippingPanel session={session} groupId={activeGroupId} shipment={shipState}
                    waitingCount={waitingCount} isHost={isHost} hostName={hostName} haulCount={count}
                    onRefresh={() => { fetchSquad(); onShipped?.(); }} />
                </div>
              ) : (() => {
                // Verzenden pas als ÁLLE warehouse-items opgelost zijn (user 2026-07-22).
                // Volgorde van de blokkades: (1) lopend refund-verzoek → "Awaiting refund
                // request response"; (2) daarna/anders een defect zonder klant-keuze →
                // "Action needed". Pas als beide weg zijn: "Confirm & ship".
                const refundHold = pendingRefunds.length > 0;
                const defectHold = defectItems.length > 0;
                const enabled = count > 0 && !refundHold && !defectHold;
                return (
                  <motion.button whileTap={enabled ? { scale: 0.97 } : undefined} disabled={!enabled}
                    onClick={() => { if (enabled) { closeSheet(); setScreen("confirm"); } }}
                    style={{ width: "100%", marginTop: 12, background: enabled ? "#FF5C00" : "#333", color: enabled ? "#fff" : "#777", border: "none", borderRadius: 14, padding: "15px", fontSize: 14.5, fontWeight: 700, cursor: enabled ? "pointer" : "default", WebkitTapHighlightColor: "transparent" }}>
                    {refundHold ? `⏳ ${tr("parcel.sheet.awaitingRefund", "Awaiting refund request response")}`
                      : defectHold ? `⚠️ ${tr("parcel.sheet.actionNeeded", "Action needed — choose keep or return")}`
                      : <>{tr("parcel.sheet.confirm", "Confirm & ship")} →</>}
                  </motion.button>
                );
              })()}
              </FoldReveal>
              <FoldReveal i={4 + count} n={count + 5} skip={didReveal.current}>
              <motion.button whileTap={{ scale: 0.97 }} onClick={closeSheet}
                style={{ width: "100%", marginTop: 8, background: "transparent", color: "#C9C6C1", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14, padding: "12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                {tr("parcel.sheet.keepCollecting", "← Keep collecting items")}
              </motion.button>
              </FoldReveal>
              </div>
              </CartGrower>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* 📦-ghost: springt in een BOOG (eerst iets omhoog/opzij, dan omlaag) van de
          reiskaart naar linksboven in de sheet; bij landing popt het echte titel-emoji
          in en verdwijnt de ghost. Boog getekend door de user: uitwijken → duiken. */}
      {typeof boxFlight === "object" && boxFlight && !boxFlight.pending && createPortal(
        <motion.span
          initial={{ x: boxFlight.sx - 11, y: boxFlight.sy - 11, scale: 0.9, opacity: 0 }}
          animate={{
            x: [boxFlight.sx - 11, boxFlight.sx + 44, boxFlight.tx - 11],
            y: [boxFlight.sy - 11, boxFlight.sy - 36, boxFlight.ty - 11],
            scale: 1, opacity: 1,
          }}
          transition={{ duration: 0.6, ease: "easeInOut", times: [0, 0.3, 1], opacity: { duration: 0.12, ease: "linear" } }}
          onAnimationComplete={() => setBoxFlight("landed")}
          style={{ position: "fixed", top: 0, left: 0, fontSize: 22, zIndex: 402, pointerEvents: "none", lineHeight: 1 }}>📦</motion.span>,
        document.body)}

      {/* Verzendflow — de bestaande ConfirmHaul (incl. opslag-quote-route) + succes, als overlay */}
      {screen === "confirm" && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 320, background: "#F8F7F4", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
          <ConfirmHaul session={session} haulItems={parcelItems} balance={balance}
            onBack={() => { setScreen(null); setOpen(true); fetchBalance(); }}
            onSuccess={() => setScreen("success")} />
        </div>, document.body)}
      {screen === "success" && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 320, background: "#F8F7F4", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
          <HaulSuccess haulItems={parcelItems} onDone={() => { setScreen(null); setOpen(false); onShipped?.(); }} />
        </div>, document.body)}
    </>
  );
}

export function TransitTab({ session, orders = [], activeGroupId = null }) {
  const [hauls, setHauls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hideDelivered, setHideDelivered] = useState(() => { try { return localStorage.getItem("flowva_hide_delivered") === "1"; } catch { return false; } });
  const [receipt, setReceipt] = useState(null); // pakket waarvan de volledige bon getoond wordt

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
  // Parcels genummerd op volgorde van aanmaak (Parcel 1 = oudste) — zelfde nummering als de Orders-tab.
  const parcelNo = {};
  [...hauls].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach((h, i) => { parcelNo[h.id] = i + 1; });

  // Geleverde pakketten (trace_status 3) blijven standaard staan; de knop verbergt ze.
  const deliveredCount = modeHauls.filter(h => h.trace_status === 3).length;
  const shownHauls = hideDelivered ? modeHauls.filter(h => h.trace_status !== 3) : modeHauls;
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

      {!loading && modeHauls.length === 0 && (
        <div style={{ textAlign: "center", padding: "50px 0", color: "#aaa" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#F3F1ED", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <Plane size={26} color="#A8A5A0" strokeWidth={1.8} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#111111", marginBottom: 6 }}>No parcels yet</div>
          <div style={{ fontSize: 13 }}>Confirm a parcel in your warehouse and it will appear here.</div>
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
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111111" }}>Parcel {parcelNo[haul.id]} · {itemCount} item{itemCount !== 1 ? "s" : ""}</div>
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
              {/* Betaalmoment (user 2026-07-22): datum + tijd van de verzendbetaling. */}
              <span style={{ fontSize: 12, color: "#8A8780" }}>
                {haul.created_at
                  ? tr("transit.paidOn", "Paid {date} at {time}", { date: new Date(haul.created_at).toLocaleDateString("en-GB"), time: new Date(haul.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) })
                  : tr("transit.paid", "Paid")} <span style={{ color: "#A8A5A0" }}>· {tr("transit.estimated", "estimated")}</span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#111111" }}>€{Number(haul.paid_eur || 0).toFixed(2)}</span>
            </div>

            {/* See receipt (user 2026-07-23): volledige bon van dit pakket — product +
                domestic ¥5 + quality-control ¥6 (bij checkout betaald) + verzending. */}
            <button onClick={() => setReceipt(haul)}
              style={{ width: "100%", marginBottom: 10, background: "#F8F7F4", border: "1px solid #ECEAE5", borderRadius: 10, padding: "9px", fontSize: 12.5, fontWeight: 700, color: "#6B6862", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
              🧾 {tr("group.pay.seeReceipt", "See receipt")} ›
            </button>

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

      {/* 🧾 Volledige bon van één pakket (See receipt). Product/¥5/¥6 = bij checkout
          betaald (uit de items); verzending = wat bij verzenden is afgeschreven (haul). */}
      {receipt && (() => {
        const h = receipt;
        const rItems = (h.items || []).map(orderById).filter(Boolean);
        const goods = rItems.reduce((s, o) => s + (Number(o.price) || 0) * (o.qty || 1), 0);
        const pieces = rItems.reduce((s, o) => s + (o.qty || 1), 0);
        const domestic = pieces * 5 / 7.8;
        const qc = pieces * 6 / 7.8;
        const shipPaid = Number(h.paid_eur || 0);
        const shipInt = Number(h.shipping_eur || 0);
        const vat = Number(h.vat_eur || 0);
        const fees = Math.max(0, shipPaid - shipInt - vat); // fulfilment + service fee + currency
        const grand = goods + domestic + qc + shipPaid;
        const rEur = (x) => `€${Number(x || 0).toFixed(2)}`;
        const rline = (label, val, dim) => (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, color: dim ? "#8A8780" : "#3A3733" }}>
            <span>{label}</span><span style={{ fontWeight: 600 }}>{rEur(val)}</span>
          </div>
        );
        return (
          <div onClick={() => setReceipt(null)} style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: "#fff", borderRadius: "20px 20px 0 0", padding: "18px 22px 34px", maxHeight: "88vh", overflowY: "auto" }}>
              <div style={{ width: 36, height: 4, background: "#E8E6E0", borderRadius: 2, margin: "0 auto 14px" }} />
              <div style={{ fontSize: 16, fontWeight: 800, color: "#0F0E0C" }}>🧾 Parcel {parcelNo[h.id]}</div>
              <div style={{ fontSize: 12, color: "#8A8780", marginBottom: 14 }}>{tr("group.pay.receiptSub", "Full cost of this parcel")}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#10B981", letterSpacing: 0.4, margin: "6px 0 2px" }}>✓ {tr("group.pay.alreadyPaid", "ALREADY PAID AT CHECKOUT")}</div>
              {rline(tr("group.pay.goods", "Product"), goods, true)}
              {rline(tr("group.pay.domestic", "Domestic shipping · ¥5"), domestic, true)}
              {rline(tr("group.pay.qc", "Quality-control · ¥6"), qc, true)}
              <div style={{ fontSize: 11, fontWeight: 700, color: "#B45309", letterSpacing: 0.4, margin: "12px 0 2px" }}>✈ {tr("group.pay.shipSection", "SHIPPING")} · {tr("transit.estimated", "estimated")}</div>
              {rline(tr("group.pay.shipping", "International shipping"), shipInt)}
              {vat > 0 && rline(tr("group.pay.vat", "Import VAT (21%)"), vat)}
              {fees > 0 && rline(tr("transit.fees", "Fulfillment, service fee & currency"), fees)}
              <div style={{ borderTop: "2px solid #0F0E0C", marginTop: 10, paddingTop: 10, display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 800, color: "#0F0E0C" }}>
                <span>{tr("group.pay.receiptTotal", "Total for this parcel")}</span><span>{rEur(grand)}</span>
              </div>
              <div style={{ fontSize: 10.5, color: "#A8A5A0", marginTop: 8, lineHeight: 1.5 }}>{tr("transit.receiptNote", "Shipping is an estimate with a buffer — if the real bill is lower you get the difference back as a refund.")}</div>
              <button onClick={() => setReceipt(null)} style={{ width: "100%", marginTop: 16, background: "#0F0E0C", color: "#fff", border: "none", borderRadius: 12, padding: "13px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>{tr("common.close", "Close")}</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
