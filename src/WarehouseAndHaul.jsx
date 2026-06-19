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

function OrderDetailModal({ order, inHaul, onAdd, onRemove, onDispute, onClose }) {
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
        <div style={{ width: 36, height: 4, background: "#E8E6E0", borderRadius: 2, margin: "0 auto 20px" }} />
        <div style={{ width: "100%", aspectRatio: "16/9", borderRadius: 16, overflow: "hidden", background: "#fff", border: "1px solid #F0EEE8", marginBottom: 16 }}>
          {order.variant_image ? <img src={order.variant_image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            : order.qc_images?.[0] ? <img src={order.qc_images[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 48 }}>📦</div>}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>{order.product_title || order.product}</div>
        <div style={{ fontSize: 13, color: "#aaa", marginBottom: 16 }}>{order.qty} pcs · {order.weight_grams ? `${order.weight_grams}g` : "weight unknown"}</div>
        {order.qc_images?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#888", marginBottom: 8, letterSpacing: 1 }}>QC PHOTOS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {order.qc_images.map((url, i) => (
                <div key={i} style={{ borderRadius: 10, overflow: "hidden", aspectRatio: "1", position: "relative" }}>
                  <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  {i === 3 && <div style={{ position: "absolute", bottom: 6, left: 6, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, padding: "2px 6px", borderRadius: 6 }}>⚖️ Weight</div>}
                </div>
              ))}
            </div>
          </div>
        )}
        {order.weight_grams && (
          <div style={{ background: "#F0FDF4", border: "1px solid #10B981", borderRadius: 12, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#065F46", fontWeight: 600 }}>
            Adds {order.weight_grams}g to your parcel — shipping is charged per parcel, so bundling items keeps it cheap.
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          {inHaul ? (
            <button onClick={() => { onRemove(order.id); onClose(); }}
              style={{ flex: 1, background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              Remove from box
            </button>
          ) : (
            <button onClick={() => { onAdd(order); onClose(); }}
              style={{ flex: 1, background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              + Add to box
            </button>
          )}
          <button onClick={() => { onDispute(order); onClose(); }}
            style={{ background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 12, padding: "12px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            ⚠️
          </button>
        </div>
      </motion.div>
    </>
  );
}

function OrderCard({ order, onDragStart, onDragEnd, inHaul, onOpenDetail }) {
  return (
    <motion.div
      drag
      dragSnapToOrigin
      onDragStart={() => onDragStart(order)}
      onDragEnd={(e, info) => onDragEnd(order, info)}
      whileDrag={{ scale: 1.06, zIndex: 50, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", cursor: "grabbing" }}
      whileHover={{ y: -2 }}
      style={{
        background: inHaul ? "#F0FDF4" : "#fff",
        border: `1.5px solid ${inHaul ? "#10B981" : "#E8E6E0"}`,
        borderRadius: 14, padding: "10px 12px", marginBottom: 10,
        cursor: "grab", userSelect: "none", position: "relative",
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
          <div style={{ fontSize: 11, color: "#aaa" }}>{order.qty} pcs · {order.weight_grams ? `${order.weight_grams}g` : "no weight"}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          {inHaul && <div style={{ background: "#10B981", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20 }}>✓ In box</div>}
          <button onClick={(e) => { e.stopPropagation(); onOpenDetail(order); }}
            style={{ background: "#F8F7F4", border: "1px solid #E8E6E0", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600, color: "#555", cursor: "pointer" }}>
            Details
          </button>
        </div>
      </div>
      <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 11, color: "#bbb" }}>{inHaul ? "✓ Added" : "↕ Drag to the box"}</div>
        <button onClick={(e) => { e.stopPropagation(); onOpenDetail(order); }}
          style={{ background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
          Report a problem
        </button>
      </div>
    </motion.div>
  );
}

function ConfirmHaul({ session, haulItems, balance, onBack, onSuccess }) {
  const [confirming, setConfirming] = useState(false);
  const totalWeight = haulItems.reduce((s, o) => s + (o.weight_grams || 0), 0);
  const goodsValue = haulItems.reduce((s, o) => s + (Number(o.price) || 0), 0);
  const estimate = shippingEstimate(totalWeight / 1000);
  const shipBuffered = r2(estimate * BUFFER_MULTIPLIER);
  const vat = r2((goodsValue + estimate) * IMPORT_VAT);
  const toPay = r2(shipBuffered + vat);
  const canAfford = balance >= toPay;

  const confirmHaul = async () => {
    if (!canAfford) return;
    setConfirming(true);
    // 1. Maak het pakket aan
    const { data: haul, error } = await supabase.from("hauls").insert({
      user_id: session.user.id, status: "confirmed",
      estimate_eur: estimate, paid_eur: toPay, items: haulItems.map(o => o.id),
    }).select().single();
    if (error) { alert("Something went wrong: " + error.message); setConfirming(false); return; }
    // 2. Betaal veilig via de database (zie supabase/pay-shipping.sql):
    //    bedrag wordt server-side berekend en van je balance afgeschreven.
    const { data: pay, error: payError } = await supabase.rpc("pay_shipping", {
      p_order_ids: haulItems.map(o => o.id),
    });
    if (payError || (pay && pay.ok === false)) {
      // Betaling mislukt → pakket weer verwijderen
      await supabase.from("hauls").delete().eq("id", haul.id);
      alert("Payment failed: " + (payError?.message || pay?.error || "unknown error"));
      setConfirming(false);
      return;
    }
    for (const order of haulItems) {
      await supabase.from("haul_items").insert({ haul_id: haul.id, order_id: order.id });
    }
    // Pakket is betaald → orders gaan naar "In transit", zodat de status
    // in Orders en op de journey map meteen klopt.
    await supabase.from("orders").update({ status: "shipped_international" }).in("id", haulItems.map(o => o.id));
    setConfirming(false);
    onSuccess();
  };

  return (
    <div style={{ padding: "16px 20px", paddingBottom: 80 }}>
      <button onClick={onBack} style={{ background: "none", border: "none", fontSize: 14, color: "#666", cursor: "pointer", padding: 0, marginBottom: 16 }}>← Back</button>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>Confirm shipping</div>
      <div style={{ fontSize: 13, color: "#aaa", marginBottom: 20 }}>Review your parcel before paying</div>
      <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 12 }}>Products ({haulItems.length})</div>
        {haulItems.map((o, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < haulItems.length - 1 ? "1px solid #F0EEE8" : "none" }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#fff", border: "1px solid #F0EEE8", overflow: "hidden", flexShrink: 0 }}>
              {o.variant_image ? <img src={o.variant_image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                : o.qc_images?.[0] ? <img src={o.qc_images[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 16 }}>📦</div>}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C" }}>{o.product_title || o.product}</div>
              <div style={{ fontSize: 11, color: "#aaa" }}>{o.weight_grams}g</div>
            </div>
          </div>
        ))}
      </div>
      <motion.div layoutId="confirmHaul" transition={springMorph} style={{ background: "#0F0E0C", borderRadius: 14, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#FF5C00", marginBottom: 12 }}>Cost overview</div>
        {[
          { label: "Total weight", value: `${totalWeight}g` },
          { label: "Shipping estimate", value: `€${estimate.toFixed(2)}` },
          { label: "Safety buffer (×1.3)", value: `+€${(shipBuffered - estimate).toFixed(2)}` },
          { label: "Import VAT (21%)", value: `€${vat.toFixed(2)}` },
        ].map((row, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: "#888" }}>{row.label}</span>
            <span style={{ fontSize: 13, color: "#fff" }}>{row.value}</span>
          </div>
        ))}
        <div style={{ borderTop: "1px solid #333", paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>Pay now</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#FF5C00" }}>€{toPay.toFixed(2)}</span>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: "#555", lineHeight: 1.5 }}>✅ All duties prepaid (DDP) — nothing to pay on delivery. After we ship, the shipping-buffer difference comes back to your balance.</div>
      </motion.div>
      <div style={{ background: canAfford ? "#F0FDF4" : "#FEF3C7", border: `1px solid ${canAfford ? "#10B981" : "#F59E0B"}`, borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, color: canAfford ? "#065F46" : "#92400E" }}>Your balance</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: canAfford ? "#10B981" : "#B45309" }}>€{balance.toFixed(2)}</span>
        </div>
        {!canAfford && <div style={{ fontSize: 12, color: "#B45309", marginTop: 6 }}>You're €{(toPay - balance).toFixed(2)} short.</div>}
      </div>
      <button onClick={confirmHaul} disabled={!canAfford || confirming}
        style={{ width: "100%", background: !canAfford || confirming ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: 700, cursor: !canAfford || confirming ? "default" : "pointer" }}>
        {confirming ? "Processing..." : !canAfford ? "Insufficient balance" : `Confirm & pay €${toPay.toFixed(2)}`}
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
              Once your parcel ships and the exact costs are known, you'll automatically get the difference back in your balance.
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
    await supabase.from("orders").update({ dispute_status: "pending", dispute_description: description, dispute_images: images }).eq("id", order.id);
    setSaving(false);
    onSuccess();
  };

  return (
    <div style={{ padding: "16px 20px", paddingBottom: 80 }}>
      <button onClick={onBack} style={{ background: "none", border: "none", fontSize: 14, color: "#666", cursor: "pointer", padding: 0, marginBottom: 16 }}>← Back</button>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>Report a problem</div>
      <div style={{ fontSize: 13, color: "#aaa", marginBottom: 20 }}>Describe what is wrong with your product</div>
      <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 8 }}>{order.product_title || order.product}</div>
        <textarea placeholder="Describe the problem..." value={description} onChange={e => setDescription(e.target.value)}
          style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, background: "#F8F7F4", minHeight: 100, resize: "vertical", boxSizing: "border-box" }} />
      </div>
      <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 8 }}>Photos as proof</div>
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
    </div>
  );
}

export function WarehouseTab({ session, haulItems = [], setHaulItems }) {
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

  useEffect(() => { fetchWarehouseOrders(); fetchBalance(); }, []);

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
    setWarehouseOrders(data || []);
    setLoading(false);
  };

  const totalWeight = haulItems.reduce((s, o) => s + (o.weight_grams || 0), 0);

  const addToHaul = (order) => {
    if (typeof setHaulItems !== "function") return;
    if (lockedIds.includes(order.id)) return;
    if (!haulItems.some(h => h.id === order.id)) setHaulItems(prev => [...prev, order]);
  };

  const removeFromHaul = (orderId) => {
    if (typeof setHaulItems !== "function") return;
    setHaulItems(prev => prev.filter(h => h.id !== orderId));
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
      }
    }
  };

  if (disputeOrder) return <DisputeForm order={disputeOrder} session={session} onBack={() => setDisputeOrder(null)} onSuccess={() => { setDisputeOrder(null); fetchWarehouseOrders(); }} />;
  if (screen === "confirm") return <ConfirmHaul session={session} haulItems={haulItems} balance={balance} onBack={() => setScreen("warehouse")} onSuccess={() => setScreen("success")} />;
  if (screen === "success") return <HaulSuccess haulItems={haulItems} onDone={() => { setScreen("warehouse"); setHaulItems([]); fetchWarehouseOrders(); fetchBalance(); }} />;

  return (
    <div style={{ padding: "16px 20px", paddingBottom: 100 }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#0F0E0C", marginBottom: 2 }}>My warehouse</div>
      <div style={{ fontSize: 13, color: "#aaa", marginBottom: 16 }}>Products ready for international shipping</div>

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

        {haulItems.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            style={{ textAlign: "center", marginTop: 10, fontSize: 12, color: "#8B6914", fontWeight: 600 }}>
            {haulItems.length} item{haulItems.length !== 1 ? "s" : ""} · {totalWeight}g · ~€{r2(shippingEstimate(totalWeight / 1000) * BUFFER_MULTIPLIER).toFixed(2)} ship + VAT at checkout
          </motion.div>
        )}
      </div>

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
        return <OrderCard key={order.id} order={order} onDragStart={onDragStart} onDragEnd={onDragEnd} inHaul={inHaul} onOpenDetail={setDetailOrder} />;
      })}

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
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// "In transit": de pakketten van de klant — betaald en (straks) verzonden.
// Later koppelen we hier live 17TRACK-statusupdates aan (via API key).
export function TransitTab({ session, orders = [] }) {
  const [hauls, setHauls] = useState([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div style={{ padding: "10px 20px 100px" }}>
      <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6, color: "#111111", marginBottom: 2 }}>In transit</div>
      <div style={{ fontSize: 13.5, color: "#8A8780", marginBottom: 16 }}>Your parcels on their way to you</div>

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>Loading...</div>}

      {!loading && hauls.length === 0 && (
        <div style={{ textAlign: "center", padding: "50px 0", color: "#aaa" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#F3F1ED", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <Plane size={26} color="#A8A5A0" strokeWidth={1.8} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#111111", marginBottom: 6 }}>No parcels yet</div>
          <div style={{ fontSize: 13 }}>Confirm a parcel in your warehouse and it will appear here.</div>
        </div>
      )}

      {hauls.map((haul, hi) => {
        const items = (haul.items || []).map(orderById).filter(Boolean);
        const itemCount = items.length || (haul.items || []).length;
        const totalWeight = items.reduce((s, o) => s + (o.weight_grams || 0), 0);
        const shipped = haul.status === "shipped";
        return (
          <motion.div key={haul.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springSoft, delay: hi * 0.06 }}
            style={{ background: "#fff", borderRadius: 18, padding: "15px 16px", marginBottom: 12, boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111111" }}>Parcel · {itemCount} item{itemCount !== 1 ? "s" : ""}</div>
                <div style={{ fontSize: 11.5, color: "#A8A5A0" }}>{haul.created_at ? new Date(haul.created_at).toLocaleDateString("en-GB") : ""}{totalWeight ? ` · ${totalWeight}g` : ""}</div>
              </div>
              <div style={{ background: shipped ? "#111111" : "#FFF0E7", color: shipped ? "#fff" : "#FF5C00", fontSize: 11, fontWeight: 700, padding: "5px 11px", borderRadius: 16, whiteSpace: "nowrap" }}>
                {shipped ? "✈ Shipped" : "Preparing shipment"}
              </div>
            </div>

            {items.length > 0 && (
              <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 10 }}>
                {items.map((o) => (
                  <div key={o.id} style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 10, background: "#fff", border: "1px solid #F0EEE8", overflow: "hidden" }}>
                    {o.variant_image ? <img src={o.variant_image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      : o.qc_images?.[0] ? <img src={o.qc_images[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 18 }}>📦</div>}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: haul.tracking_number || !shipped ? 10 : 0 }}>
              <span style={{ fontSize: 12, color: "#8A8780" }}>Paid (shipping + VAT)</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#111111" }}>€{Number(haul.paid_eur || 0).toFixed(2)}</span>
            </div>

            {haul.tracking_number ? (
              <div style={{ background: "#F8F7F4", borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: "#A8A5A0", marginBottom: 2 }}>Tracking number</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#111111", marginBottom: 4 }}>{haul.tracking_number}</div>
                <a href={`https://www.dhl.com/nl-en/home/tracking.html?tracking-id=${haul.tracking_number}`} target="_blank" rel="noreferrer"
                  style={{ fontSize: 12, color: "#FF5C00", fontWeight: 600, textDecoration: "none" }}>Track your parcel →</a>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F8F7F4", borderRadius: 12, padding: "10px 12px" }}>
                <MapPin size={14} color="#A8A5A0" />
                <span style={{ fontSize: 12, color: "#8A8780" }}>Live tracking updates coming soon</span>
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
