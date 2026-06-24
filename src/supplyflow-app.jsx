import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { EU_COUNTRIES } from "./countries";
import OrderRequest from "./OrderRequest";
import Friends from "./Friends";
import GroupModeGlow from "./GroupModeGlow";
import { ffMyGroups } from "./ffApi";
import { WarehouseTab, TransitTab } from "./WarehouseAndHaul";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { springSnappy, springSoft, springBouncy, springMorph } from "./motion";
import { Search, SlidersHorizontal, Bell, Home, Package, Factory, User, ShoppingBag, Eye, Star, Plus, X, Plane, CreditCard, PackageCheck, Truck, Camera, ChevronUp } from "lucide-react";
import { WordReveal, SpeechBubble } from "./MotionBits";
import ReviewPage from "./ReviewPage";
import { problemTypes } from "./problemTypes";
import { toChinese, toEnglish, hasChinese } from "./translate";
import { serviceFee } from "./fees";
import PushToggle from "./PushToggle";

// Overgang tussen tabs/schermen: zacht in-/uitschuiven (Apple-stijl).
const pageTransition = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
  transition: { type: "spring", stiffness: 320, damping: 32, mass: 0.8 },
};

// Categorieën + subcategorieën worden nu dynamisch uit de producten afgeleid.

const statusConfig = {
  // requested/quote_sent bestaan niet meer in de flow (direct kopen) — blijven
  // als vangnet voor eventuele oude orders, tonen als "Order placed".
  requested:            { label: "Order placed",                color: "#0369A1", bg: "#E0F2FE", step: 0 },
  quote_sent:           { label: "Order placed",                color: "#0369A1", bg: "#E0F2FE", step: 0 },
  quote_accepted:       { label: "Order placed",                color: "#0369A1", bg: "#E0F2FE", step: 0 },
  purchased:            { label: "Order placed",                color: "#0369A1", bg: "#E0F2FE", step: 0 },
  bought:               { label: "Item bought successfully",    color: "#065F46", bg: "#D1FAE5", step: 1 },
  shipped_local:        { label: "On its way to our warehouse", color: "#0369A1", bg: "#E0F2FE", step: 2 },
  qc_pending:           { label: "QC photos ready",             color: "#065F46", bg: "#D1FAE5", step: 3 },
  shipped_international: { label: "Shipped to you",             color: "#0369A1", bg: "#E0F2FE", step: 4 },
  delivered:            { label: "Delivered",                   color: "#166534", bg: "#DCFCE7", step: 5 },
};

// Labels van de tracking-bolletjes — index = statusConfig[...].step.
const trackingSteps = [
  "Order placed",
  "Bought",
  "To warehouse",
  "QC photos",
  "Shipped to you",
  "Delivered",
];

const foxMessages = {
  requested:            { msg: "We've placed your order — the agent is purchasing it for you right now.", icon: "🛒" },
  quote_sent:           { msg: "We've placed your order — the agent is purchasing it for you right now.", icon: "🛒" },
  quote_accepted:       { msg: "We've placed your order — the agent is purchasing it for you right now.", icon: "🛒" },
  purchased:            { msg: "We've placed your order — the agent is purchasing it for you right now.", icon: "🛒" },
  bought:               { msg: "Bought! 🎉 Your item is paid for and getting ready to head to our warehouse.", icon: "✅" },
  shipped_local:        { msg: "Your item is on its way to our warehouse in China.", icon: "🚚" },
  qc_pending:           { msg: "Arrived & inspected! View the photos and add it to a parcel to ship.", icon: "🏭" },
  shipped_international: { msg: "Your parcel is on its international journey — hang tight!", icon: "✈️" },
  delivered:            { msg: "Delivered — enjoy! 🎉", icon: "🎉" },
};

const extraServices = [
  {
    category: "Product inspection",
    icon: "🔍",
    items: [
      { id: "detailed_photo", label: "Detailed photos", desc: "Extra close-up photos of the product", price: 2.00 },
      { id: "detailed_inspection", label: "Detailed inspection", desc: "Full quality check", price: 5.50 },
      { id: "reinspection", label: "Re-inspection", desc: "Inspect again after a report", price: 6.00 },
      { id: "power_inspection", label: "Power-on inspection", desc: "For electronics & devices", price: 12.00 },
    ],
  },
  {
    category: "Packaging service",
    icon: "📦",
    items: [
      { id: "bubble_wrap", label: "Bubble wrap", desc: "Extra protection around the product", price: 5.00 },
      { id: "dust_bag", label: "Dust bag", desc: "Fabric protective bag", price: 4.00 },
      { id: "kraft_mailer", label: "Kraft bubble mailer", desc: "Sturdy cardboard envelope", price: 3.00 },
      { id: "plastic_seal", label: "Plastic sealing", desc: "Airtight wrapping", price: 10.00 },
      { id: "custom_epe", label: "Custom EPE packaging", desc: "Made-to-measure foam packaging", price: 23.00 },
    ],
  },
  {
    category: "Extra services",
    icon: "✨",
    items: [
      { id: "video", label: "Product video", desc: "Short video of the product", price: 20.00 },
      { id: "model_photo", label: "Model photos", desc: "Product photographed on a model", price: 30.00 },
      { id: "label_removal", label: "Label removal", desc: "Remove original labels", price: 3.00 },
      { id: "ironing", label: "Ironing service", desc: "Iron the clothing wrinkle-free", price: 20.00 },
      { id: "thread_trim", label: "Thread trimming", desc: "Trim loose threads", price: 5.00 },
      { id: "split_order", label: "Split order", desc: "Split the order into parts", price: 2.00 },
    ],
  },
];

// Reiskaart: de route van fabriek (China) naar jouw huis, met checkpoints.
// Tik op een checkpoint om je orders op die fase te filteren.
const journeyStops = [
  { key: "purchased", label: "Order placed", Icon: ShoppingBag, statuses: ["requested", "quote_sent", "quote_accepted", "purchased"], x: 11, y: 18 },
  { key: "bought", label: "Bought", Icon: PackageCheck, statuses: ["bought"], x: 36, y: 10 },
  { key: "shipped_local", label: "To warehouse", Icon: Truck, statuses: ["shipped_local"], x: 86, y: 26 },
  { key: "qc_pending", label: "QC photos", Icon: Camera, statuses: ["qc_pending"], x: 72, y: 50 },
  { key: "shipped_international", label: "Shipped to you", Icon: Plane, statuses: ["shipped_international"], x: 46, y: 56 },
  { key: "delivered", label: "Delivered", Icon: Home, statuses: ["delivered"], x: 13, y: 84, home: true },
];

// Ronde voortgangsring (% van de reis afgelegd) rechts op de groepskaart.
function ProgressRing({ percent }) {
  const r = 15, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, percent));
  const off = c * (1 - pct / 100);
  const color = pct >= 100 ? "#16A34A" : "#FF5C00";
  return (
    <div style={{ position: "relative", width: 38, height: 38, flexShrink: 0 }}>
      <svg width="38" height="38" viewBox="0 0 38 38">
        <circle cx="19" cy="19" r={r} fill="none" stroke="#F0EEE8" strokeWidth="3.5" />
        <motion.circle cx="19" cy="19" r={r} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: off }} transition={{ duration: 0.7, ease: "easeOut" }}
          transform="rotate(-90 19 19)" />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, fontWeight: 800, color }}>{Math.round(pct)}%</div>
    </div>
  );
}

// Voortgang per product: 100% = QC-foto's klaar (qc_pending). Elke stap richting
// QC telt voor 25% (Order placed = 25%). Verder dan QC blijft 100%.
const QC_FULL_STEP = statusConfig.qc_pending.step;
function productProgress(status) {
  const step = statusConfig[status]?.step ?? 0;
  return Math.min(100, Math.round(((step + 1) / (QC_FULL_STEP + 1)) * 100));
}
const PRODUCT_COLORS = ["#FF5C00", "#6366F1", "#16A34A", "#EAB308", "#EC4899"];

// Tik op de ring → groot voortgangswiel: elk product een concentrische boog die
// zich vult richting QC (= vol). Mijlpaal-streepjes tonen waar het % op slaat.
function ProgressWheelModal({ items, onClose }) {
  const bars = items.slice(0, 8);
  const overall = Math.round(items.reduce((s, o) => s + productProgress(o.status), 0) / items.length);
  const milestones = [
    { pct: 25, label: "Order placed" }, { pct: 50, label: "Item bought successfully" },
    { pct: 75, label: "Shipped domestically" }, { pct: 100, label: "QC pictures are ready" },
  ];
  return createPortal(
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 360, background: "rgba(17,17,17,0.55)", backdropFilter: "blur(8px)" }} />
      <motion.div initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.92, y: 10 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        style={{ position: "fixed", inset: 0, zIndex: 361, display: "flex", alignItems: "center", justifyContent: "center", padding: 18, pointerEvents: "none" }}>
        <div onClick={(e) => e.stopPropagation()} style={{ pointerEvents: "auto", background: "#fff", borderRadius: 26, padding: "20px 20px 18px", width: "100%", maxWidth: 360, boxShadow: "0 24px 70px rgba(0,0,0,0.32)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#111" }}>Order progress</div>
            <motion.button whileTap={{ scale: 0.9 }} onClick={onClose} style={{ background: "#F3F1ED", border: "none", borderRadius: 999, width: 30, height: 30, fontSize: 15, color: "#777", cursor: "pointer", lineHeight: 1 }}>✕</motion.button>
          </div>
          <div style={{ height: 14 }} />
          {/* Eén staaf per item — eigen kleur, met foto + titel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {bars.map((o, i) => {
              const pct = productProgress(o.status);
              const color = PRODUCT_COLORS[i % PRODUCT_COLORS.length];
              return (
                <div key={o.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 7, background: "#fff", border: "1px solid #F0EEE8", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {o.variant_image ? <img src={o.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: 14 }}>📦</span>}
                    </div>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: "#222", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.product_title || o.product}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color, flexShrink: 0 }}>{pct}%</span>
                  </div>
                  <div style={{ position: "relative", height: 12, background: "#F1EFE9", borderRadius: 6, overflow: "hidden" }}>
                    {[25, 50, 75].map((g) => (
                      <div key={g} style={{ position: "absolute", left: `${g}%`, top: 0, bottom: 0, width: 1, background: "#fff" }} />
                    ))}
                    <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, delay: 0.06 * i, ease: "easeOut" }}
                      style={{ position: "absolute", left: 0, top: 0, bottom: 0, background: color, borderRadius: 6 }} />
                  </div>
                </div>
              );
            })}
            {items.length > bars.length && <div style={{ fontSize: 11, color: "#A8A5A0", textAlign: "center", marginTop: 2 }}>+{items.length - bars.length} more</div>}
          </div>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #F1EFE9", display: "flex", flexDirection: "column", gap: 5 }}>
            {milestones.map((m) => (
              <div key={`leg-${m.pct}`} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11 }}>
                <span style={{ width: 32, textAlign: "right", fontWeight: 800, color: "#A8A5A0", flexShrink: 0 }}>{m.pct}%</span>
                <span style={{ color: "#6B6862" }}>{m.label}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, textAlign: "center", fontSize: 11.5, color: "#9A968F" }}>Overall <b style={{ color: "#111" }}>{overall}%</b></div>
        </div>
      </motion.div>
    </>,
    document.body
  );
}

// Eén bestelling (= alle items uit dezelfde aankoop). Klap open → morpht omlaag,
// toont elk item met z'n eigen status. Statussen mogen per item verschillen.
function OrderGroupCard({ items, onOpenItem }) {
  const [open, setOpen] = useState(false);
  const [wheel, setWheel] = useState(false);
  const date = items[0]?.date || "";
  const percent = Math.round(items.reduce((s, o) => s + productProgress(o.status), 0) / items.length);
  const whStep = statusConfig.qc_pending.step;
  const atWarehouse = items.filter(o => (statusConfig[o.status]?.step ?? 0) >= whStep).length;
  const anyProblem = items.some(o => o.problem_type);
  const subtotal = items.reduce((s, o) => s + (Number(o.price) || 0), 0);
  const fee = serviceFee(subtotal);
  const total = subtotal + fee;
  return (
    <motion.div layout style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, marginBottom: 10, overflow: "hidden" }}>
      <motion.div whileTap={{ scale: 0.99 }} onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", cursor: "pointer" }}>
        <div style={{ display: "flex", flexShrink: 0 }}>
          {items.slice(0, 3).map((o, i) => (
            <div key={o.id} style={{ width: 40, height: 40, borderRadius: 9, background: "#fff", boxShadow: "0 0 0 1px #F0EEE8", overflow: "hidden", marginLeft: i ? -14 : 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {o.variant_image ? <img src={o.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: 18 }}>📦</span>}
            </div>
          ))}
          {items.length > 3 && <div style={{ width: 40, height: 40, borderRadius: 9, background: "#F3F1ED", marginLeft: -14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#888" }}>+{items.length - 3}</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "#A8A5A0" }}>{date} · {items.length} item{items.length > 1 ? "s" : ""}</div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {items[0].product_title || items[0].product}{items.length > 1 ? ` +${items.length - 1} more` : ""}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#111" }}>€{total.toFixed(2)}</span>
            <span style={{ fontSize: 10, color: "#A8A5A0" }}>incl. fees</span>
          </div>
          <div style={{ fontSize: 11, color: anyProblem ? "#B45309" : "#8A8780", marginTop: 1 }}>
            {anyProblem ? "⚠️ Action needed" : `${atWarehouse}/${items.length} at warehouse`}
          </div>
        </div>
        <motion.div whileTap={{ scale: 0.85 }} onClick={(e) => { e.stopPropagation(); setWheel(true); }} title="Tap for progress breakdown" style={{ flexShrink: 0, cursor: "pointer" }}>
          <ProgressRing percent={percent} />
        </motion.div>
        <motion.div animate={{ rotate: open ? 0 : 180 }} transition={springSnappy} style={{ flexShrink: 0, display: "flex" }}>
          <ChevronUp size={18} color="#C9C6C1" strokeWidth={2.4} />
        </motion.div>
      </motion.div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 30 }} style={{ overflow: "hidden" }}>
            <div style={{ padding: "2px 12px 12px" }}>
              {items.map(o => {
                const s = statusConfig[o.status] || statusConfig.purchased;
                return (
                  <motion.div key={o.id} whileTap={{ scale: 0.98 }} onClick={() => onOpenItem(o)}
                    style={{ display: "flex", alignItems: "center", gap: 10, background: "#F8F7F4", borderRadius: 12, padding: "9px 11px", marginBottom: 6, cursor: "pointer" }}>
                    <div style={{ width: 38, height: 38, borderRadius: 8, background: "#fff", border: "1px solid #F0EEE8", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {o.variant_image ? <img src={o.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: 17 }}>📦</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.product_title || o.product}</div>
                      <div style={{ fontSize: 11, color: "#A8A5A0", marginBottom: 3 }}>{o.qty} pcs{o.kleur ? ` · ${o.kleur}` : ""} · €{(Number(o.price) || 0).toFixed(2)}</div>
                      <div style={{ display: "inline-block", background: s.bg, color: s.color, fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20 }}>{s.label}{o.problem_type ? " · ⚠️" : ""}</div>
                    </div>
                    <div style={{ color: "#ccc", fontSize: 16, flexShrink: 0 }}>→</div>
                  </motion.div>
                );
              })}
              <div style={{ marginTop: 4, padding: "10px 12px", background: "#FAF9F6", borderRadius: 12, border: "1px solid #EFEDE7" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6B6862", marginBottom: 5 }}>
                  <span>Items ({items.length})</span><span>€{subtotal.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6B6862", marginBottom: 7 }}>
                  <span>Service fee</span><span>€{fee.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, fontWeight: 800, color: "#111", borderTop: "1px solid #EAE7E0", paddingTop: 7 }}>
                  <span>Total paid</span><span>€{total.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {wheel && <ProgressWheelModal items={items} onClose={() => setWheel(false)} />}
      </AnimatePresence>
    </motion.div>
  );
}

function TreasureMap({ activeFilter, onSelect, orders }) {
  const countFor = (statuses) => orders.filter(o => statuses.includes(o.status)).length;
  return (
    <div style={{ margin: "10px 20px 0", background: "#fff", borderRadius: 18, boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)", padding: "14px 16px 8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 2 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111111" }}>Your orders' journey</div>
          <div style={{ fontSize: 10.5, color: "#A8A5A0" }}>Tap a checkpoint to filter</div>
        </div>
        <motion.button whileTap={{ scale: 0.92 }} onClick={() => onSelect("all")}
          style={{ position: "relative", background: activeFilter === "all" ? "#111111" : "#F3F1ED", color: activeFilter === "all" ? "#fff" : "#555", border: "none", borderRadius: 14, padding: "7px 13px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
          All orders
          {orders.length > 0 && (
            <span style={{ position: "absolute", top: -6, right: -6, minWidth: 15, height: 15, padding: "0 2px", borderRadius: 8, background: "#FF5C00", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #fff", boxSizing: "content-box" }}>{orders.length}</span>
          )}
        </motion.button>
      </div>
      <div style={{ position: "relative", height: 210 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <motion.path
            d="M11,18 C19,12 28,10 36,10 C45,10 53,12 62,16 C72,20 84,19 86,26 C88,34 80,44 72,50 C64,56 54,58 46,56 C38,54 27,50 20,52 C14,54 13,70 13,84"
            fill="none" stroke="#FF5C00" strokeWidth="2" strokeDasharray="0.5 3.5" strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} transition={{ duration: 0.9, delay: 0.2 }} />
        </svg>
        {journeyStops.map((s, i) => {
          const active = activeFilter === s.key;
          const count = countFor(s.statuses);
          const size = s.home ? 42 : 32;
          const dark = s.home || s.key === "requested";
          return (
            <motion.div key={s.key}
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ ...springBouncy, delay: 0.15 + i * 0.1 }}
              onClick={() => onSelect(active ? "all" : s.key)}
              style={{ position: "absolute", left: s.x + "%", top: s.y + "%", x: "-50%", y: "-50%", textAlign: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent", zIndex: 1 }}>
              <div style={{ position: "relative", width: size, height: size, margin: "0 auto" }}>
                {active && (
                  <motion.div animate={{ scale: [0.9, 1.45], opacity: [0.45, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                    style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid #FF5C00" }} />
                )}
                <div style={{ width: size, height: size, borderRadius: "50%", boxSizing: "border-box",
                  background: active ? "#FFF0E7" : dark ? "#111111" : "#F3F1ED",
                  border: active ? "2px solid #FF5C00" : "none",
                  display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <s.Icon size={s.home ? 17 : 14} strokeWidth={2.1} color={active ? "#FF5C00" : dark ? "#fff" : "#111111"} />
                </div>
                {count > 0 && (
                  <div style={{ position: "absolute", top: -5, right: -7, minWidth: 15, height: 15, padding: "0 2px", borderRadius: 8, background: "#FF5C00", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #fff", boxSizing: "content-box" }}>{count}</div>
                )}
              </div>
              <div style={{ fontSize: 9, fontWeight: active ? 700 : 500, color: active ? "#FF5C00" : "#8A8780", width: 66, lineHeight: 1.15, margin: "4px auto 0" }}>{s.label}</div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function PreviewGallery({ images }) {
  const [current, setCurrent] = useState(0);
  return (
    <div>
      <div style={{ borderRadius: 16, overflow: "hidden", aspectRatio: "1", background: "#fff", marginBottom: 12 }}
        onTouchStart={e => { e.currentTarget._startX = e.touches[0].clientX; }}
        onTouchEnd={e => { const diff = e.currentTarget._startX - e.changedTouches[0].clientX; if (diff > 40 && current < images.length - 1) setCurrent(c => c+1); if (diff < -40 && current > 0) setCurrent(c => c-1); }}>
        <img src={images[current]} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
        {images.map((_, i) => (<div key={i} onClick={() => setCurrent(i)} style={{ width: i === current ? 20 : 8, height: 8, borderRadius: 4, background: i === current ? "#0F0E0C" : "#E8E6E0", cursor: "pointer", transition: "all 0.2s" }} />))}
      </div>
    </div>
  );
}

function QuoteAcceptance({ order, session, balance, allOrders = [], onAccepted }) {
  const [accepting, setAccepting] = useState(false);
  const [payError, setPayError] = useState(null);

  // Aanvraaggroep: items die samen in één keer zijn aangevraagd worden ook
  // samen betaald — één service fee over het totaal (zie supabase/service-fee.sql).
  const group = order.request_group_id
    ? allOrders.filter(o => o.request_group_id === order.request_group_id && ["requested", "quote_sent"].includes(o.status))
    : [order];
  const quoted = group.filter(o => o.status === "quote_sent");
  const waiting = group.filter(o => o.status === "requested");
  const isGroup = group.length > 1;
  const sum = quoted.reduce((t, o) => t + (o.quoted_total || 0), 0);
  const fee = serviceFee(sum);
  const total = sum + fee;
  const allQuotesIn = waiting.length === 0;
  const canAfford = balance >= total;
  const canPay = canAfford && allQuotesIn && !accepting;

  const acceptQuote = async () => {
    if (!canPay) return;
    setAccepting(true);
    setPayError(null);
    // De betaling gebeurt atomair in de database (zie supabase/service-fee.sql):
    // balance checken + aftrekken + transacties (order + service_fee) loggen
    // + orderstatus(sen) bijwerken.
    const { data, error } = isGroup
      ? await supabase.rpc("pay_quote_group", { p_group_id: order.request_group_id })
      : await supabase.rpc("pay_quote", { p_order_id: order.id });
    setAccepting(false);
    if (error) { setPayError(error.message); return; }
    if (data && data.ok === false) { setPayError(data.error); return; }
    onAccepted({ ...order, status: "quote_accepted" });
  };

  return (
    <div style={{ background: "#fff", border: "1.5px solid #6366F1", borderRadius: 14, padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C", marginBottom: 12 }}>
        📋 {isGroup ? `Quote for your request (${quoted.length}${waiting.length ? ` of ${group.length}` : ""} items)` : "Quote from your agent"}
      </div>

      {isGroup ? (
        quoted.map((o) => (
          <div key={o.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, gap: 12 }}>
            <span style={{ fontSize: 13, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.product_title || o.product} · {o.qty} pcs</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", flexShrink: 0 }}>€{o.quoted_total?.toFixed(2)}</span>
          </div>
        ))
      ) : (
        [
          { label: "Product price", value: `¥${order.quoted_price} (≈ €${(order.quoted_price * 0.13).toFixed(2)})` },
          { label: "Local shipping China", value: `¥${order.quoted_local_shipping} (≈ €${(order.quoted_local_shipping * 0.13).toFixed(2)})` },
        ].map((row, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: "#666" }}>{row.label}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C" }}>{row.value}</span>
          </div>
        ))
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, paddingTop: 8, borderTop: "1px solid #E8E6E0" }}>
        <span style={{ fontSize: 13, color: "#666" }}>Flowva service (8%, min €5)</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C" }}>€{fee.toFixed(2)}</span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid #E8E6E0", borderBottom: "1px solid #E8E6E0", marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C" }}>Total to pay</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#6366F1" }}>€{total.toFixed(2)}</span>
      </div>

      {isGroup && !allQuotesIn && (
        <div style={{ background: "#FEF3C7", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#B45309" }}>
          ⏳ {waiting.length} item{waiting.length > 1 ? "s" : ""} still awaiting a quote. You pay everything together (with one service fee) once all quotes are in.
        </div>
      )}

      {order.quote_note && (
        <div style={{ background: "#F8F7F4", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 13, color: "#555", fontStyle: "italic" }}>
          💬 "{order.quote_note}"
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: "#888" }}>Your balance</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: canAfford ? "#10B981" : "#EF4444" }}>€{parseFloat(balance).toFixed(2)}</span>
      </div>

      {!canAfford && (
        <div style={{ background: "#FEF3C7", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#B45309" }}>
          You're €{(total - balance).toFixed(2)} short. Top up your balance via Profile.
        </div>
      )}

      {payError && (
        <div style={{ background: "#FEE2E2", color: "#DC2626", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 12 }}>
          Payment failed: {payError}
        </div>
      )}

      <motion.button whileTap={!canPay ? undefined : { scale: 0.97 }} onClick={acceptQuote} disabled={!canPay}
        style={{ width: "100%", background: !canPay ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700, cursor: !canPay ? "default" : "pointer", WebkitTapHighlightColor: "transparent" }}>
        {accepting ? "Processing..." : !allQuotesIn ? "Waiting for all quotes..." : !canAfford ? "Insufficient balance" : `✓ Accept & pay €${total.toFixed(2)}`}
      </motion.button>
    </div>
  );
}

// Aanvraaglijst: alles in één keer versturen = één service fee over de bundel.
// De sheet deelt z'n layoutId met het zwevende balkje en morpht ervandaan open.
function RequestListSheet({ items, onRemove, onSetQty, onClose, onSend, sending, error, session, onEditAddress, onTopUp, onFinish, flagged, reasons }) {
  const [view, setView] = useState("cart");
  const isHeld = (item) => !!flagged && flagged.has(item.source_url);
  const heldReason = (item) => reasons?.[item.source_url] || "On hold — changed at the factory";
  const heldCount = items.filter(isHeld).length;
  // Held-items doen NIET mee met betalen → totaal/fee/per-item alleen over de betaalbare items.
  const payable = items.filter((it) => !isHeld(it));
  const total = payable.reduce((s, it) => s + Number(it.price || 0) * (it.qty || 1), 0);
  const fee = payable.length ? serviceFee(total) : 0;
  const charge = total + fee;
  const perItem = payable.length ? fee / payable.length : fee;
  const perItemColor = perItem >= 4 ? "#C9C6C1" : perItem >= 2 ? "#FF5C00" : "#16A34A";
  const m = session?.user?.user_metadata || {};
  const addrName = `${m.voornaam || ""} ${m.achternaam || ""}`.trim();
  const cityLine = [m.postcode, m.stad].filter(Boolean).join(" ");
  const hasAddress = !!(m.adres && m.stad);
  const lowBalance = /balance|saldo/i.test(error || "");

  // Bevestig & betaal → bij succes morpht de sheet naar de "placed"-weergave.
  const confirmAndPay = async () => {
    const ok = await onSend();
    if (ok) setView("placed");
  };

  const itemThumb = (item) => (
    <div style={{ width: 46, height: 46, borderRadius: 10, background: "#fff", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {item.variant_image ? <img src={item.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: 20 }}>📦</span>}
    </div>
  );

  const errorBlock = error ? (
    <div style={{ background: "#FEE2E2", color: "#DC2626", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginTop: 10 }}>
      {error}
      {lowBalance && onTopUp && (
        <button onClick={onTopUp} style={{ display: "block", width: "100%", marginTop: 8, background: "#DC2626", color: "#fff", border: "none", borderRadius: 8, padding: "8px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
          Top up your balance →
        </button>
      )}
    </div>
  ) : null;

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={view === "placed" ? () => onFinish?.(false) : onClose}
        style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }} />
      <motion.div layoutId="request-list-morph" transition={springMorph}
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#111111", borderRadius: "24px 24px 0 0", zIndex: 301, maxHeight: "88vh", overflowY: "auto" }}>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.18 } }} exit={{ opacity: 0, transition: { duration: 0.08 } }}
          style={{ padding: "20px 20px 40px" }}>
          <div onClick={view === "checkout" ? () => setView("cart") : view === "placed" ? () => onFinish?.(false) : onClose} style={{ padding: "0 0 12px", cursor: "pointer" }}>
            <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, margin: "0 auto" }} />
          </div>

          {view === "cart" ? (
            <motion.div key="cart">
              <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 14 }}>🛒 Shopping cart ({items.length})</div>

              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 16 }}>
                <motion.span layoutId="cart-fox" style={{ fontSize: 28, flexShrink: 0 }}>🦊</motion.span>
                <SpeechBubble bg="#1E1D1A" color="#C9C6C1">
                  <span style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                    Smart move! Your whole cart shares <b style={{ color: "#FF5C00" }}>one service fee</b> (8%, min €5), so the more you add, the less it costs <b style={{ color: "#FF5C00" }}>per item</b>. From €62.50 it's just a flat 8% — the lowest it gets. Order things separately and each one carries its own fee.
                  </span>
                </SpeechBubble>
              </div>

              {items.map((item, i) => {
                const held = isHeld(item);
                return (
                <motion.div layoutId={`citem-${i}`} key={i} style={{ display: "flex", alignItems: "center", gap: 12, background: "#1A1917", borderRadius: 14, padding: "10px 12px", marginBottom: 8, opacity: held ? 0.6 : 1 }}>
                  {itemThumb(item)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: held ? "line-through" : "none" }}>{item.product_title}</div>
                    {held ? (
                      <div style={{ fontSize: 11, color: "#F59E0B", fontWeight: 600 }}>⏸ {heldReason(item)}</div>
                    ) : (
                      <div style={{ fontSize: 11.5, color: "#9C9893" }}>{item.kleur ? `${item.kleur} · ` : ""}€{Number(item.price).toFixed(2)}</div>
                    )}
                  </div>
                  {held ? (
                    <button onClick={() => onRemove(i)}
                      style={{ flexShrink: 0, background: "rgba(245,158,11,0.15)", color: "#F59E0B", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 9, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>Remove</button>
                  ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <motion.button whileTap={{ scale: 0.85 }} onClick={() => ((item.qty || 1) > 1 ? onSetQty(i, item.qty - 1) : onRemove(i))}
                      style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "#C9C6C1", fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", lineHeight: 1 }}>−</motion.button>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", minWidth: 14, textAlign: "center" }}>{item.qty || 1}</span>
                    <motion.button whileTap={{ scale: 0.85 }} onClick={() => onSetQty(i, (item.qty || 1) + 1)}
                      style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "#C9C6C1", fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", lineHeight: 1 }}>+</motion.button>
                  </div>
                  )}
                </motion.div>
                );
              })}

              {payable.length > 0 && (
                <motion.div layout style={{ background: "#1E1D1A", borderRadius: 14, padding: "12px 14px", marginTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12.5, color: "#9C9893" }}>Items</span>
                    <span style={{ fontSize: 12.5, color: "#fff", fontWeight: 600 }}>€{total.toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12.5, color: "#9C9893" }}>Service fee (8%, min €5)</span>
                    <span style={{ fontSize: 12.5, color: "#fff", fontWeight: 600 }}>€{fee.toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: 6, marginTop: 5 }}>
                    <span style={{ fontSize: 11, color: "#9C9893" }}>that's only</span>
                    <motion.span key={perItem.toFixed(2)} initial={{ scale: 1.3, opacity: 0.3 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 18 }}
                      style={{ fontSize: 19, fontWeight: 800, color: perItemColor }}>€{perItem.toFixed(2)}</motion.span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: perItemColor }}>per item {perItem < 2 ? "🎉" : "🦊"}</span>
                  </div>
                </motion.div>
              )}

              {errorBlock}

              {heldCount > 0 && (
                <div style={{ background: "rgba(245,158,11,0.12)", color: "#F59E0B", borderRadius: 10, padding: "10px 13px", fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
                  ⏸ {heldCount === 1 ? "1 item is" : `${heldCount} items are`} on hold and won't be charged{payable.length ? " — you can still check out the rest" : ""}. Keep {heldCount === 1 ? "it" : "them"} and check back soon, or remove {heldCount === 1 ? "it" : "them"}. You haven't been charged.
                </div>
              )}
              <motion.button whileTap={payable.length ? { scale: 0.97 } : undefined} onClick={() => payable.length && setView("checkout")} disabled={payable.length === 0}
                style={{ width: "100%", marginTop: 12, background: payable.length ? "#FF5C00" : "#333", color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontSize: 15, fontWeight: 700, cursor: payable.length ? "pointer" : "default", WebkitTapHighlightColor: "transparent" }}>
                {payable.length === 0 ? "All items are on hold" : heldCount > 0 ? `Check out the ${payable.length} available item${payable.length > 1 ? "s" : ""} →` : "Go to checkout →"}
              </motion.button>

              <motion.button whileTap={{ scale: 0.97 }} onClick={onClose}
                style={{ width: "100%", marginTop: 8, background: "transparent", color: "#C9C6C1", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14, padding: "13px", fontSize: 13, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                ← Continue shopping &amp; reduce your fee per item
              </motion.button>
            </motion.div>
          ) : view === "checkout" ? (
            <motion.div key="checkout">
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <motion.span layoutId="cart-fox" style={{ fontSize: 34, flexShrink: 0 }}>🦊</motion.span>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>Checkout</div>
                  <div style={{ fontSize: 12, color: "#9C9893" }}>Just confirm and we'll start sourcing.</div>
                </div>
              </div>

              <motion.div style={{ background: "#1E1D1A", borderRadius: 14, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#9C9893", letterSpacing: 0.3 }}>📦 SHIPPING TO</span>
                  {onEditAddress && <button onClick={onEditAddress} style={{ background: "none", border: "none", color: "#FF5C00", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Edit</button>}
                </div>
                {hasAddress ? (
                  <div style={{ fontSize: 12.5, color: "#C9C6C1", lineHeight: 1.55 }}>
                    {addrName && <div style={{ color: "#fff", fontWeight: 600 }}>{addrName}</div>}
                    <div>{m.adres}</div>
                    <div>{cityLine}{m.land ? `, ${m.land}` : ""}</div>
                    {m.telefoon && <div style={{ color: "#9C9893" }}>{m.telefoon}</div>}
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: "#F59E0B" }}>⚠️ No shipping address yet — tap Edit to add one.</div>
                )}
              </motion.div>

              {items.map((item, i) => {
                const held = isHeld(item);
                return (
                <motion.div layoutId={`citem-${i}`} key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "#1A1917", borderRadius: 12, padding: "8px 10px", marginBottom: 6, opacity: held ? 0.6 : 1 }}>
                  {itemThumb(item)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: held ? "line-through" : "none" }}>{item.product_title}</div>
                    <div style={{ fontSize: 11, color: held ? "#F59E0B" : "#9C9893" }}>{held ? `⏸ ${heldReason(item)}` : `${item.qty || 1} pcs${item.kleur ? ` · ${item.kleur}` : ""}`}</div>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: held ? "#F59E0B" : "#fff", flexShrink: 0 }}>{held ? "—" : `€${(Number(item.price) * (item.qty || 1)).toFixed(2)}`}</div>
                </motion.div>
                );
              })}

              <motion.div style={{ background: "#1E1D1A", borderRadius: "14px 14px 0 0", padding: "12px 14px", marginTop: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12.5, color: "#9C9893" }}>Items</span>
                  <span style={{ fontSize: 12.5, color: "#fff" }}>€{total.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12.5, color: "#9C9893" }}>Service fee (8%, min €5)</span>
                  <span style={{ fontSize: 12.5, color: "#fff" }}>€{fee.toFixed(2)}</span>
                </div>
              </motion.div>
              <motion.div style={{ background: "#1E1D1A", borderRadius: "0 0 14px 14px", padding: "12px 14px", marginBottom: 12, borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>Total now</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: "#FF5C00" }}>€{charge.toFixed(2)}</span>
              </motion.div>

              <motion.div style={{ background: "rgba(99,102,241,0.12)", borderRadius: 12, padding: "10px 13px", marginBottom: 12, fontSize: 11.5, color: "#A5B4FC", lineHeight: 1.5 }}>
                🚢 International shipping is billed <b>later, by weight</b>, once your items reach the warehouse — so you only pay for what you actually ship.
              </motion.div>

              {errorBlock}

              {heldCount > 0 && (
                <div style={{ background: "rgba(245,158,11,0.12)", color: "#F59E0B", borderRadius: 10, padding: "10px 13px", fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
                  ⏸ {heldCount === 1 ? "1 item is" : `${heldCount} items are`} on hold and won't be charged — we'll only check out your {payable.length} available item{payable.length > 1 ? "s" : ""}. The held {heldCount === 1 ? "one stays" : "ones stay"} in your cart for when {heldCount === 1 ? "it's" : "they're"} back.
                </div>
              )}
              <motion.button whileTap={sending || !hasAddress || !payable.length ? undefined : { scale: 0.97 }} onClick={confirmAndPay} disabled={sending || !hasAddress || payable.length === 0}
                style={{ width: "100%", marginTop: 4, background: sending ? "#333" : (!hasAddress || !payable.length) ? "#444" : "#FF5C00", color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontSize: 15, fontWeight: 700, cursor: sending || !hasAddress || !payable.length ? "default" : "pointer", WebkitTapHighlightColor: "transparent" }}>
                {sending ? "Processing payment…" : !hasAddress ? "Add an address to continue" : payable.length === 0 ? "All items are on hold" : heldCount > 0 ? `Pay €${charge.toFixed(2)} for the rest →` : `Confirm & pay €${charge.toFixed(2)} →`}
              </motion.button>

              <motion.button whileTap={{ scale: 0.97 }} onClick={() => setView("cart")}
                style={{ width: "100%", marginTop: 8, background: "transparent", color: "#C9C6C1", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14, padding: "13px", fontSize: 13, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                ← Back to cart
              </motion.button>
            </motion.div>
          ) : (
            <motion.div key="placed">
              <div style={{ textAlign: "center", marginBottom: 22, marginTop: 4 }}>
                <motion.span layoutId="cart-fox" style={{ fontSize: 52, display: "inline-block", marginBottom: 12 }}>🦊</motion.span>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#FF5C00", marginBottom: 6 }}>Order placed! 🎉</div>
                <div style={{ fontSize: 13, color: "#888" }}>We're getting it from the factory:</div>
              </div>
              {heldCount > 0 && (
                <div style={{ background: "rgba(245,158,11,0.12)", color: "#F59E0B", borderRadius: 10, padding: "10px 13px", fontSize: 12, marginBottom: 16, lineHeight: 1.5, textAlign: "center" }}>
                  ⏸ {heldCount === 1 ? "1 item is" : `${heldCount} items are`} still on hold — saved in your cart for when {heldCount === 1 ? "it's" : "they're"} available again.
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
                {[
                  { icon: "🛒", text: "Buying your item from the supplier", lid: "ck-ship" },
                  { icon: "📸", text: "Taking quality-control photos", lid: "ck-items" },
                  { icon: "🏭", text: "Storing it safely in the warehouse", lid: "ck-total" },
                  { icon: "✈️", text: "Shipping it to your door", lid: "ck-boat" },
                ].map((s) => (
                  <motion.div key={s.lid} style={{ display: "flex", alignItems: "center", gap: 12, background: "#1A1917", borderRadius: 10, padding: "12px 14px" }}>
                    <span style={{ fontSize: 18 }}>{s.icon}</span>
                    <span style={{ fontSize: 13, color: "#CCC" }}>{s.text}</span>
                  </motion.div>
                ))}
              </div>
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => onFinish?.(true)}
                style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontSize: 15, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                Track it in Orders →
              </motion.button>
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => onFinish?.(false)}
                style={{ width: "100%", marginTop: 8, background: "transparent", color: "#888", border: "none", borderRadius: 14, padding: "13px", fontSize: 13, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                Back to feed
              </motion.button>
            </motion.div>
          )}
        </motion.div>
      </motion.div>
    </>
  );
}

function CustomerChat({ order, session }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [displayTx, setDisplayTx] = useState({});
  const bottomRef = useRef(null);

  // Vangnet: Chinese berichten zonder opgeslagen vertaling alsnog vertalen
  // bij weergave, en het resultaat bewaren voor de volgende keer.
  useEffect(() => {
    messages.forEach(async (m) => {
      if (m.sender === "agent" && !m.message_translated && hasChinese(m.message) && !displayTx[m.id]) {
        const t = await toEnglish(m.message);
        if (t) {
          setDisplayTx(prev => ({ ...prev, [m.id]: t }));
          supabase.from("order_messages").update({ message_translated: t }).eq("id", m.id).then(() => {});
        }
      }
    });
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    fetchMessages();
    const channel = supabase.channel(`chat-customer-${order.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "order_messages", filter: `order_id=eq.${order.id}` },
        (payload) => setMessages(prev => [...prev, payload.new]))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [open, order.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const fetchMessages = async () => {
    const { data } = await supabase.from("order_messages").select("*").eq("order_id", order.id).order("created_at");
    setMessages(data || []);
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    const msg = input.trim(); setInput("");
    // Vertaal naar het Chinees zodat de agent het direct kan lezen.
    const translated = await toChinese(msg);
    let { error } = await supabase.from("order_messages").insert({ order_id: order.id, sender: "customer", message: msg, message_translated: translated });
    // Vangnet: kolom bestaat nog niet (SQL niet gedraaid) → zonder vertaling versturen.
    if (error && /message_translated/i.test(error.message)) {
      await supabase.from("order_messages").insert({ order_id: order.id, sender: "customer", message: msg });
    }
    // Update order met laatste bericht info
    await supabase.from("orders").update({
      last_message_sender: "customer",
      last_message_read: false,
    }).eq("id", order.id);
  };

  return (
    <div style={{ marginTop: 16 }}>
      <motion.button whileTap={{ scale: 0.98 }} transition={springSnappy} onClick={() => setOpen(!open)} style={{ width: "100%", background: open ? "#0F0E0C" : "#F8F7F4", color: open ? "#FF5C00" : "#0F0E0C", border: "1px solid #E8E6E0", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
        💬 {open ? "Close chat" : "Chat with agent"}
      </motion.button>
      <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
          style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, overflow: "hidden", marginTop: 8 }}>
          <div style={{ background: "#0F0E0C", padding: "12px 16px" }}>
            <div style={{ color: "#FF5C00", fontSize: 13, fontWeight: 700 }}>Chat with your agent</div>
            <div style={{ color: "#888", fontSize: 11, marginTop: 2 }}>Replies within 24 hours</div>
          </div>
          <div style={{ height: 240, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {messages.length === 0 && <div style={{ textAlign: "center", color: "#aaa", fontSize: 13, padding: "20px 0" }}><div style={{ fontSize: 32, marginBottom: 8 }}>🦊</div>Send your agent a message</div>}
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.sender === "customer" ? "flex-end" : "flex-start" }}>
                {m.sender === "agent" && <div style={{ fontSize: 18, marginRight: 6, alignSelf: "flex-end" }}>🦊</div>}
                <div style={{ background: m.sender === "customer" ? "#0F0E0C" : "#F8F7F4", color: m.sender === "customer" ? "#FF5C00" : "#333", padding: "8px 12px", borderRadius: m.sender === "customer" ? "12px 12px 2px 12px" : "12px 12px 12px 2px", fontSize: 13, maxWidth: "75%", lineHeight: 1.4 }}>
                  <div>{m.message}</div>
                  {m.sender === "agent" && (m.message_translated || displayTx[m.id]) && (
                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #E8E6E0", fontSize: 12.5, color: "#666" }}>
                      {m.message_translated || displayTx[m.id]}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div style={{ padding: "10px 12px", borderTop: "1px solid #E8E6E0", display: "flex", gap: 8 }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMessage()} placeholder="Type a message..." style={{ flex: 1, border: "1px solid #E8E6E0", borderRadius: 8, padding: "8px 12px", fontSize: 13, background: "#F8F7F4" }} />
            <button onClick={sendMessage} style={{ background: "#FF5C00", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>→</button>
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

function TransactionHistory({ session }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!show) return;
    supabase.from("transactions").select("*").eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(20)
      .then(({ data }) => { setTransactions(data || []); setLoading(false); });
  }, [show]);

  const typeLabels = {
    top_up: { label: "Top-up", color: "#10B981" },
    order: { label: "Order", color: "#EF4444" },
    shipping: { label: "Shipping", color: "#EF4444" },
    refund: { label: "Refund", color: "#10B981" },
    return_refund: { label: "Return refund", color: "#10B981" },
    buffer_return: { label: "Buffer refund", color: "#10B981" },
    service_fee: { label: "Service fee", color: "#EF4444" },
    extra_service: { label: "Extra service", color: "#EF4444" },
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "16px 20px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: show ? 12 : 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C" }}>Transaction history</div>
        <motion.button whileTap={{ scale: 0.9 }} transition={springSnappy} onClick={() => setShow(!show)} style={{ background: "none", border: "none", fontSize: 12, color: "#6366F1", cursor: "pointer", fontWeight: 600, WebkitTapHighlightColor: "transparent" }}>{show ? "Hide" : "Show"}</motion.button>
      </div>
      <AnimatePresence initial={false}>
        {show && (
          <motion.div key="txbody" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ height: { duration: 0.3, ease: [0.4, 0, 0.2, 1] }, opacity: { duration: 0.2 } }} style={{ overflow: "hidden" }}>
            {loading ? <div style={{ textAlign: "center", padding: 20, color: "#aaa", fontSize: 13 }}>Loading...</div> :
            transactions.length === 0 ? <div style={{ textAlign: "center", padding: 20, color: "#aaa", fontSize: 13 }}>No transactions yet</div> :
            transactions.map((t, i) => {
              const info = typeLabels[t.type] || { label: t.type, color: "#888" };
              return (
                <motion.div key={i} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ ...springSoft, delay: i * 0.04 }}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < transactions.length-1 ? "1px solid #F0EEE8" : "none" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C" }}>{info.label}</div>
                    <div style={{ fontSize: 11, color: "#aaa" }}>{new Date(t.created_at).toLocaleDateString("en-GB")}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: t.amount > 0 ? "#10B981" : "#EF4444" }}>
                    {t.amount > 0 ? "+" : ""}€{Math.abs(t.amount).toFixed(2)}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EditProfileSheet({ session, onClose }) {
  const meta = session?.user?.user_metadata || {};
  const [form, setForm] = useState({
    voornaam: meta.voornaam || "",
    achternaam: meta.achternaam || "",
    telefoon: meta.telefoon || "",
    adres: meta.adres || "",
    postcode: meta.postcode || "",
    stad: meta.stad || "",
    land: meta.land || "Netherlands",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const inputStyle = { width: "100%", border: "1px solid #E8E6E0", borderRadius: 10, padding: "11px 13px", fontSize: 13, background: "#F8F7F4", boxSizing: "border-box", outline: "none" };
  const labelStyle = { fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4, display: "block" };

  const save = async () => {
    setSaving(true); setError(null);
    const { error } = await supabase.auth.updateUser({ data: form });
    setSaving(false);
    if (error) { setError(error.message); return; }
    onClose();
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }} />
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#fff", borderRadius: "24px 24px 0 0", zIndex: 301, maxHeight: "88vh", overflowY: "auto", padding: "20px 20px 40px" }}>
        <div style={{ width: 36, height: 4, background: "#E8E6E0", borderRadius: 2, margin: "0 auto 16px" }} />
        <div style={{ fontSize: 18, fontWeight: 700, color: "#0F0E0C", marginBottom: 16 }}>Edit details</div>
        {error && <div style={{ background: "#FEE2E2", color: "#DC2626", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div><label style={labelStyle}>First name</label><input style={inputStyle} value={form.voornaam} onChange={e => set("voornaam", e.target.value)} /></div>
          <div><label style={labelStyle}>Last name</label><input style={inputStyle} value={form.achternaam} onChange={e => set("achternaam", e.target.value)} /></div>
        </div>
        <div style={{ marginBottom: 10 }}><label style={labelStyle}>Phone</label><input style={inputStyle} value={form.telefoon} onChange={e => set("telefoon", e.target.value)} /></div>
        <div style={{ marginBottom: 10 }}><label style={labelStyle}>Address (street + no.)</label><input style={inputStyle} value={form.adres} onChange={e => set("adres", e.target.value)} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginBottom: 10 }}>
          <div><label style={labelStyle}>Postal code</label><input style={inputStyle} value={form.postcode} onChange={e => set("postcode", e.target.value)} /></div>
          <div><label style={labelStyle}>City</label><input style={inputStyle} value={form.stad} onChange={e => set("stad", e.target.value)} /></div>
        </div>
        <div style={{ marginBottom: 18 }}><label style={labelStyle}>Country</label>
          <select style={inputStyle} value={form.land} onChange={e => set("land", e.target.value)}>
            {form.land && !EU_COUNTRIES.includes(form.land) && <option value={form.land}>{form.land}</option>}
            {EU_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <motion.button whileTap={saving ? undefined : { scale: 0.97 }} onClick={save} disabled={saving}
          style={{ width: "100%", background: saving ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, cursor: saving ? "default" : "pointer", WebkitTapHighlightColor: "transparent" }}>
          {saving ? "Saving..." : "Save"}
        </motion.button>
      </motion.div>
    </>
  );
}

// Altijd bereikbare uitleg-pagina (Profile + automatisch bij de eerste keer).
// Zet de verwachting vooraf: fabrieksprijs + fee + verzending, en waarom bundelen loont.
function HowItWorksSheet({ onClose }) {
  const steps = [
    { icon: "🏭", title: "Shop straight from the factory", body: "You see the real 1688 & Taobao factory prices — no inflated retail markup. What it costs in China is what you pay." },
    { icon: "🛒", title: "A small service fee", body: "We buy it, check it and handle everything for you. The fee is 8% (min €5) per order — so ordering a few items at once keeps the fee tiny per item." },
    { icon: "🏬", title: "Your items wait in your China warehouse", body: "Bought items gather safely in your personal warehouse. No rush — keep adding to your haul." },
    { icon: "📸", title: "QC photos before it ships", body: "We photograph your actual item so you see exactly what you're getting — no surprises on the doorstep." },
    { icon: "📦", title: "Ship it all in one parcel", body: "International shipping is charged per parcel, not per item. So the more you bundle, the cheaper it gets per item:" },
  ];
  const ship = [
    { n: "1 t-shirt", per: "€9.30" },
    { n: "5 t-shirts", per: "€2.66" },
    { n: "A full haul (25+)", per: "~€1.30" },
  ];
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }} />
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#fff", borderRadius: "24px 24px 0 0", zIndex: 301, maxHeight: "92vh", overflowY: "auto", padding: "20px 20px 40px" }}>
        <div style={{ width: 36, height: 4, background: "#E8E6E0", borderRadius: 2, margin: "0 auto 16px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
          <span style={{ fontSize: 26 }}>🦊</span>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0F0E0C" }}>How Flowva works</div>
        </div>
        <div style={{ fontSize: 13, color: "#8A8780", marginBottom: 18 }}>Factory prices, real photos, one smart parcel.</div>

        {steps.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 13, marginBottom: 15 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{s.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "#0F0E0C", marginBottom: 2 }}>{i + 1}. {s.title}</div>
              <div style={{ fontSize: 13, color: "#6B6862", lineHeight: 1.5 }}>{s.body}</div>
            </div>
          </div>
        ))}

        <div style={{ background: "#F8F7F4", borderRadius: 14, padding: "10px 14px", marginBottom: 16 }}>
          {ship.map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: i < ship.length - 1 ? "1px solid #ECEAE5" : "none" }}>
              <span style={{ fontSize: 13, color: "#6B6862" }}>{r.n} in one parcel</span>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: i === ship.length - 1 ? "#16A34A" : "#0F0E0C" }}>{r.per} <span style={{ fontWeight: 500, color: "#A8A5A0", fontSize: 11 }}>/ item</span></span>
            </div>
          ))}
        </div>

        <div style={{ background: "#0F0E0C", borderRadius: 16, padding: "15px 18px", marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#FF5C00", marginBottom: 4 }}>The golden rule 🪙</div>
          <div style={{ fontSize: 13.5, color: "#E8E6E0", lineHeight: 1.55 }}>Build your haul, then ship it as one box. The more you bundle, the less you pay per item — on both the fee and the shipping.</div>
        </div>

        <motion.button whileTap={{ scale: 0.97 }} onClick={onClose}
          style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
          Got it 🦊
        </motion.button>
      </motion.div>
    </>
  );
}

export default function SupplyFlow({ session }) {
  const [tab, setTab] = useState("feed");
  const [products, setProducts] = useState([]);
  const [factories, setFactories] = useState([]);
  const [selectedFactory, setSelectedFactory] = useState(null);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productsError, setProductsError] = useState(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [activeSub, setActiveSub] = useState(null);
  const [showClothesPicker, setShowClothesPicker] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderFilter, setOrderFilter] = useState("all");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [previewProduct, setPreviewProduct] = useState(null);
  const [reviewProduct, setReviewProduct] = useState(null);
  const [actionProduct, setActionProduct] = useState(null);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [orders, setOrders] = useState([]);
  const [balance, setBalance] = useState(0);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [successProduct, setSuccessProduct] = useState(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [topupAmount, setTopupAmount] = useState("");
  // Apparaat-lokale state PER GEBRUIKER opslaan, zodat een ander account op hetzelfde
  // toestel nooit de mand/favorieten/haul van de vorige ziet — ook zonder uitloggen.
  const uid = session?.user?.id || "anon";
  const lsKey = (base) => `${base}_${uid}`;

  const [haulItems, setHaulItems] = useState(() => {
    try {
      const saved = localStorage.getItem(lsKey("supplyflow_haul"));
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem(lsKey("supplyflow_haul"), JSON.stringify(haulItems));
  }, [haulItems]);

  // Aanvraaglijst: items verzamelen en in één keer aanvragen (= één service fee).
  const [requestList, setRequestList] = useState(() => {
    try {
      const saved = localStorage.getItem(lsKey("supplyflow_request_list"));
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [showRequestList, setShowRequestList] = useState(false);
  const [sendingList, setSendingList] = useState(false);
  const [listError, setListError] = useState(null);
  // Source_urls van cart-items die "on hold" staan wegens een leverancier-wijziging,
  // plus per-url de reden (uitverkocht / variant weg / prijs omhoog) voor de badges.
  const [flaggedUrls, setFlaggedUrls] = useState([]);
  const [flaggedReasons, setFlaggedReasons] = useState({});
  // Flowva Friends: groep-sheet + actieve groep om "voor te shoppen".
  const [showFriends, setShowFriends] = useState(false);
  const [friendsJoinCode, setFriendsJoinCode] = useState(null);
  const [friendsGroupId, setFriendsGroupId] = useState(null);   // direct een lobby openen (vanaf de groeps-cart)
  const [activeGroup, setActiveGroup] = useState(() => {
    try { return JSON.parse(localStorage.getItem(lsKey("flowva_active_group")) || "null"); } catch { return null; }
  });
  const [groupToast, setGroupToast] = useState(null);   // {kind,name} als de actieve groep van status wisselt
  // Favorieten (per apparaat) + filter in de feed.
  const [favorites, setFavorites] = useState(() => { try { return JSON.parse(localStorage.getItem(lsKey("flowva_favorites")) || "[]"); } catch { return []; } });
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [supportHidden, setSupportHidden] = useState(() => { try { return localStorage.getItem("flowva_support_hidden") === "1"; } catch { return false; } });
  // VABLE — eigen merk (borduurdesigns). Knop in de feed-header opent dit blad.
  // Vervang img:null door je echte foto-URL's (en VABLE_URL door je winkel-link).
  const [showVable, setShowVable] = useState(false);
  const VABLE_URL = "https://vable.store";
  const VABLE_ITEMS = [
    { name: "Phoenix Cargo", price: "€69", bg: "#26303A", img: null },
    { name: "Ember Wide-leg", price: "€74", bg: "#1A1A1A", img: null },
    { name: "Rise Straight", price: "€69", bg: "#5A5142", img: null },
    { name: "Olive Flight", price: "€72", bg: "#3A4A3A", img: null },
  ];
  // Schattig koi-visje (zoals jouw borduurstijl) — staart + rugvin wiebelen vloeiend.
  const vableFish = (color, light) => (
    <svg viewBox="0 0 112 56" width="56" style={{ overflow: "visible" }}>
      <g style={{ transformBox: "fill-box", transformOrigin: "100% 50%", animation: "vTail 0.8s ease-in-out infinite" }}>
        <path d="M44 28 C 30 13, 17 11, 13 15 C 21 21, 24 25, 22 28 C 24 31, 21 35, 13 41 C 17 45, 30 43, 44 28 Z" fill={color} />
      </g>
      <ellipse cx="66" cy="28" rx="32" ry="19" fill={color} />
      <path d="M98 28 C 98 17, 84 12, 74 14 C 78 22, 78 34, 74 42 C 84 44, 98 39, 98 28 Z" fill="#FBF2E6" />
      <g style={{ transformBox: "fill-box", transformOrigin: "50% 100%", animation: "vFin 1.5s ease-in-out infinite" }}>
        <path d="M56 10 C 64 1, 74 3, 76 11 C 70 10, 62 10, 58 13 Z" fill={color} opacity="0.9" />
      </g>
      <circle cx="88" cy="26" r="3.6" fill="#16161a" />
      <circle cx="89.3" cy="24.8" r="1.1" fill="#fff" />
      {!light && <circle cx="58" cy="24" r="4.5" fill="#D9622B" opacity="0.5" />}
    </svg>
  );
  useEffect(() => { try { localStorage.setItem(lsKey("flowva_favorites"), JSON.stringify(favorites)); } catch { /* ignore */ } }, [favorites]);
  const favKey = (p) => (p && (p.source_url || p.id)) || "";
  const isFavorite = (p) => favorites.includes(favKey(p));
  const toggleFavorite = (p) => { const k = favKey(p); if (!k) return; setFavorites((f) => f.includes(k) ? f.filter((x) => x !== k) : [...f, k]); };
  const [infoToast, setInfoToast] = useState("");
  useEffect(() => { if (!infoToast) return; const t = setTimeout(() => setInfoToast(""), 3500); return () => clearTimeout(t); }, [infoToast]);
  // Open de productpagina vanuit een groeps-item/share-kaart (sluit de Friends-sheet).
  const openProductByUrl = async (item) => {
    const url = item?.source_url;
    if (!url) { setInfoToast("This item can't be opened."); return; }
    let prod = products.find((p) => p.source_url === url);
    if (!prod) { const { data } = await supabase.from("products").select("*").eq("source_url", url).not("hidden", "is", true).limit(1); prod = data?.[0] || null; }
    if (prod?.hidden) prod = null;
    if (!prod) { setInfoToast("This item is no longer available."); return; }
    setShowFriends(false); setFriendsGroupId(null);
    setSelectedProduct(prod);
  };
  const [myGroups, setMyGroups] = useState([]);         // groepen waar ik in zit (voor de profiel-switch)
  const [selectedGroupId, setSelectedGroupId] = useState(() => activeGroup?.id || null);  // gekozen (pending) groep
  const [shakeGroups, setShakeGroups] = useState(false);                                   // rode shake bij geen selectie
  const loadMyGroups = async () => {
    const r = await ffMyGroups();
    if (!r.ok) return;
    const groups = r.groups || [];
    setMyGroups(groups);
    // Een opgeslagen actieve groep die niet meer 'gathering' is (of weg) → groep-modus uit.
    setActiveGroup((cur) => {
      if (!cur) return cur;
      const g = groups.find((x) => x.group_id === cur.id);
      return g && g.status === "gathering" ? cur : null;
    });
  };
  useEffect(() => { if (session && (tab === "profile" || !showFriends)) loadMyGroups(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, showFriends, session]);

  useEffect(() => {
    localStorage.setItem(lsKey("supplyflow_request_list"), JSON.stringify(requestList));
  }, [requestList]);

  // Flowva Friends: actieve groep onthouden + een ?join=CODE-link openen.
  useEffect(() => {
    try { localStorage.setItem(lsKey("flowva_active_group"), JSON.stringify(activeGroup)); } catch { /* ignore */ }
  }, [activeGroup]);

  // App-niveau: volg de actieve groep ook met de Friends-sheet dicht, zodat je merkt
  // dat de order geplaatst is (of de groep verviel) — ook als je aan het shoppen bent.
  useEffect(() => {
    const gid = activeGroup?.id;
    const gname = activeGroup?.name;
    if (!gid) return;
    const channel = supabase.channel(`ff-active-${gid}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "flowva_groups", filter: `id=eq.${gid}` },
        (payload) => {
          const st = payload.new?.status;
          if (st && st !== "gathering") { setActiveGroup(null); setGroupToast({ kind: st, name: payload.new?.name || gname }); }
        })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [activeGroup?.id, activeGroup?.name]);
  useEffect(() => {
    if (!groupToast) return;
    const t = setTimeout(() => setGroupToast(null), 8000);
    return () => clearTimeout(t);
  }, [groupToast]);
  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get("join");
      if (code) {
        setFriendsJoinCode(code.toUpperCase());
        setShowFriends(true);
        window.history.replaceState({}, "", window.location.pathname);
      }
    } catch { /* ignore */ }
  }, []);

  // Bij openen van de winkelwagen: lees de price_alert-vlag voor de cart-items, zodat
  // een door iemand anders getriggerde prijswijziging hier proactief "on hold" toont.
  useEffect(() => {
    if (!showRequestList) return;
    const urls = [...new Set(requestList.map((it) => it.source_url).filter(Boolean))];
    if (!urls.length) return;
    supabase.from("products").select("source_url, alert_reason").in("source_url", urls).eq("price_alert", true)
      .then(({ data }) => {
        if (data?.length) {
          setFlaggedUrls((prev) => [...new Set([...prev, ...data.map((d) => d.source_url)])]);
          setFlaggedReasons((prev) => {
            const next = { ...prev };
            data.forEach((d) => { if (d.alert_reason) next[d.source_url] = d.alert_reason; });
            return next;
          });
        }
      });
  }, [showRequestList]);

  // Toon "How Flowva works" één keer automatisch bij de allereerste keer.
  useEffect(() => {
    try {
      if (!localStorage.getItem(lsKey("flowva_seen_howitworks"))) {
        const t = setTimeout(() => setShowHowItWorks(true), 900);
        return () => clearTimeout(t);
      }
    } catch { /* localStorage kan geblokkeerd zijn */ }
  }, []);
  const closeHowItWorks = () => {
    try { localStorage.setItem(lsKey("flowva_seen_howitworks"), "1"); } catch { /* ignore */ }
    setShowHowItWorks(false);
  };

  // Instant checkout: reken de hele mand in één keer af (server-side pay_cart).
  // Geeft true terug bij succes → de sheet morpht dan naar de "placed"-weergave.
  const submitRequestList = async () => {
    if (!requestList.length || sendingList) return false;
    setSendingList(true);
    setListError(null);

    // Live BuckyDrop-check vóór afschrijven. Bekende holds (de klant zag ze al) slaan we
    // over en we rekenen de rest af; NIEUW ontdekte holds tonen we eerst (review) en pas
    // bij de volgende tik betalen we de beschikbare items.
    const previouslyHeld = new Set(flaggedUrls);
    let heldSet = new Set(flaggedUrls);
    try {
      const { data: chk } = await supabase.functions.invoke("check-cart-prices", {
        body: { items: requestList.map((it) => ({ source_url: it.source_url, kleur: it.kleur })) },
      });
      if (chk?.anyChanged) {
        const changed = (chk.items || []).filter((x) => x.changed);
        const urls = changed.map((x) => x.source_url);
        heldSet = new Set([...flaggedUrls, ...urls]);
        setFlaggedUrls([...heldSet]);
        setFlaggedReasons((prev) => {
          const next = { ...prev };
          changed.forEach((x) => { if (x.reason) next[x.source_url] = x.reason; });
          return next;
        });
        // Nieuw ontdekte holds → eerst tonen, nog niet betalen.
        if (urls.some((u) => !previouslyHeld.has(u))) { setSendingList(false); return false; }
      }
    } catch { /* check onbereikbaar → fail-open; pay_cart + post-pay refund vangen het af */ }

    // Reken alleen de NIET-held items af; held items blijven in de cart voor later.
    const payable = requestList.filter((it) => !it.source_url || !heldSet.has(it.source_url));
    if (!payable.length) {
      setListError("All items are on hold right now — check back soon. You haven't been charged.");
      setSendingList(false);
      return false;
    }

    const { data, error } = await supabase.rpc("pay_cart", { p_items: payable });
    setSendingList(false);
    if (error) { setListError(error.message); return false; }
    if (!data?.ok) {
      setListError(
        data?.error === "Insufficient balance"
          ? "Insufficient balance — top up to complete your order."
          : data?.error || "Something went wrong. Please try again."
      );
      return false;
    }
    // Betaalde items verlaten de cart; held items blijven bewaard.
    setRequestList((list) => list.filter((it) => it.source_url && heldSet.has(it.source_url)));
    fetchOrders();
    fetchBalance();
    return true;
  };

  useEffect(() => {
    async function fetchProducts() {
      setLoadingProducts(true); setProductsError(null);
      const { data, error } = await supabase.from("products").select("*").order("id");
      if (error) { setProductsError(error.message); } else { setProducts((data ?? []).filter(p => !p.hidden)); }
      setLoadingProducts(false);
    }
    fetchProducts();
  }, []);

  useEffect(() => {
    async function fetchFactories() {
      const { data } = await supabase.from("factories").select("*");
      setFactories(data ?? []);
    }
    fetchFactories();
  }, []);

  useEffect(() => {
    if (!session) return;
    fetchBalance(); fetchOrders();
    const channel = supabase.channel("balance-updates")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${session.user.id}` },
        (payload) => { setBalance(payload.new.balance || 0); })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session]);

  const fetchBalance = async () => {
    const { data } = await supabase.from("profiles").select("balance").eq("id", session.user.id).single();
    setBalance(data?.balance || 0);
  };

  const fetchOrders = async () => {
    const { data } = await supabase.from("orders").select("*").eq("user_id", session.user.id).neq("status", "cancelled").order("created_at", { ascending: false });
    setOrders(data || []);
  };

  // Ververs orders bij het openen van Orders/Transit — de status kan net
  // gewijzigd zijn (bijv. naar "In transit" na een pakket-betaling).
  useEffect(() => {
    if (session && (tab === "orders" || tab === "transit")) fetchOrders();
  }, [tab]);

  // Reactie van de klant op een gemeld probleem (zie problemTypes.js).
  const acknowledgeProblem = async () => {
    await supabase.from("order_messages").insert({ order_id: selectedOrder.id, sender: "customer", message: "✓ I agree — please continue with my request." });
    await supabase.from("orders").update({ problem_type: null, last_message_sender: "customer", last_message_read: false }).eq("id", selectedOrder.id);
    setSelectedOrder({ ...selectedOrder, problem_type: null });
    fetchOrders();
  };

  const cancelRequest = async () => {
    // Server-side via RPC: de orderstatus is afgeschermd, alleen cancel_unpaid_request mag annuleren.
    const { data, error } = await supabase.rpc("cancel_unpaid_request", { p_order_id: selectedOrder.id });
    if (error || (data && data.ok === false)) {
      alert("Cancelling failed: " + (error?.message || data?.error || "unknown error"));
      return;
    }
    await supabase.from("order_messages").insert({ order_id: selectedOrder.id, sender: "customer", message: "✕ I've cancelled my request." });
    setConfirmCancel(false);
    setSelectedOrder(null);
    fetchOrders();
  };

  // Annuleren ná betaling: refund gebeurt veilig in de database
  // (zie supabase/refund-order.sql) en alleen als de agent een probleem meldde.
  const cancelPaidOrder = async () => {
    const { data, error } = await supabase.rpc("cancel_paid_order", { p_order_id: selectedOrder.id });
    if (error || (data && data.ok === false)) {
      alert("Cancelling failed: " + (error?.message || data?.error || "unknown error"));
      return;
    }
    await supabase.from("order_messages").insert({ order_id: selectedOrder.id, sender: "customer", message: "✕ I've cancelled my order — the amount was refunded to my balance." });
    setConfirmCancel(false);
    setSelectedOrder(null);
    fetchOrders();
    fetchBalance();
  };

  const handleTopup = async () => {
    if (!topupAmount || parseFloat(topupAmount) < 5) { alert("Minimum top-up is €5"); return; }
    setLoadingBalance(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { amount: Math.round(parseFloat(topupAmount) * 100), userId: session.user.id, email: session.user.email },
      });
      if (error) throw error;
      window.location.href = data.url;
    } catch (err) { alert("Something went wrong: " + err.message); }
    setLoadingBalance(false);
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setAvatarUploading(true);
    const ext = file.name.split(".").pop();
    const name = `avatars/${session.user.id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(name, file);
    if (error) { alert("Upload failed: " + error.message); setAvatarUploading(false); return; }
    const { data } = supabase.storage.from("product-images").getPublicUrl(name);
    await supabase.auth.updateUser({ data: { avatar_url: data.publicUrl } });
    setAvatarUploading(false);
  };

  const warehouseCount = orders.filter(o => o.status === "qc_pending").length;
  const qcOrder = orders.find(o => o.status === "qc_pending");
  const avatarUrl = session?.user?.user_metadata?.avatar_url || null;

  // Cart-items die "on hold" staan wegens een prijswijziging (gededupliceerd op source_url).
  const flaggedInCart = [...new Map(
    requestList.filter((it) => it.source_url && flaggedUrls.includes(it.source_url)).map((it) => [it.source_url, it])
  ).values()];
  // Meldingen afgeleid uit je orders: probleem, offerte klaar, agent reageerde, pakket bezorgd.
  const notifications = [
    ...flaggedInCart.map((it) => ({ icon: "⏸️", text: `On hold: ${it.product_title} — ${flaggedReasons[it.source_url] || "changed at the factory"}`, cart: true })),
    ...orders.filter(o => o.problem_type).map(o => ({ icon: "⚠️", text: `Action needed: issue with ${o.product_title || o.product}`, order: o })),
    ...orders.filter(o => o.status === "quote_sent").map(o => ({ icon: "📋", text: `Quote received for ${o.product_title || o.product}`, order: o })),
    ...orders.filter(o => o.last_message_sender === "agent" && o.last_message_read === false).map(o => ({ icon: "💬", text: `Your agent replied (${o.product_title || o.product})`, order: o })),
    ...orders.filter(o => o.status === "delivered").map(o => ({ icon: "🎉", text: `${o.product_title || o.product} was delivered!`, order: o })),
  ];
  // Filter voor de reiskaart: een checkpoint kan meerdere statussen bundelen.
  const matchesFilter = (o) => orderFilter === "all" || (journeyStops.find(j => j.key === orderFilter)?.statuses || [orderFilter]).includes(o.status);
  // Modus-scheiding: solo-modus = alleen solo-orders (ff_group_id null); groep-modus = alleen die groep.
  // Zo zijn Orders/Warehouse/Transit twee duidelijk gescheiden modussen.
  const visibleOrders = orders.filter((o) => activeGroup ? o.ff_group_id === activeGroup.id : !o.ff_group_id);

  // Alleen categorie-chips tonen waar echt producten in zitten — lege
  // categorieën blijven verborgen tot de admin er iets aan toevoegt.
  const presentCats = new Set(products.map(p => p.category).filter(Boolean));
  const visibleCategories = ["All", ...[...presentCats].sort()];
  // Subcategorieën leiden we per categorie af uit de producten zelf — zo werkt
  // het voor élke (zelf toegevoegde) categorie, niet alleen Clothes.
  const subsForCategory = (cat) => [...new Set(products.filter(p => p.category === cat).map(p => p.subcategory).filter(Boolean))];
  const visibleProducts = products.filter(p => {
    const matchCat =
      activeCategory === "All" ? true :
      (p.category === activeCategory && (!activeSub || p.subcategory === activeSub));
    const q = search.trim().toLowerCase();
    const matchSearch = !q || (p.title || "").toLowerCase().includes(q);
    const matchFav = !showFavoritesOnly || isFavorite(p);
    return matchCat && matchSearch && matchFav;
  });

  // ── Fabriek-first feed ──────────────────────────────────────────────────
  // Hoort een product bij deze fabriek? Echte koppeling (factory_id), met
  // fallback op de leverancier-naam voor nog-niet-gekoppelde producten.
  const belongsToFactory = (p, f) => p.factory_id === f.id || (p.factory_id == null && (p.supplier || "") === f.name);
  // Fabriek-kaarten: alleen fabrieken met zichtbare producten, gesorteerd op
  // diamanten (4 = hoogste). De zoekbalk filtert hier op fabrieksnaam.
  const factoryCards = factories
    .map(f => {
      const fp = products.filter(p => belongsToFactory(p, f));
      // Kaart-plaatje: een geüploade fabrieksfoto wint, anders pakt de kaart
      // automatisch de foto van het eerste product van die fabriek.
      const cover = (f.logo && f.logo.startsWith("http"))
        ? f.logo
        : (fp.find(p => p.image && p.image.startsWith("http"))?.image || null);
      return { ...f, count: fp.length, cover };
    })
    .filter(f => f.count > 0)
    .filter(f => { const q = search.trim().toLowerCase(); return !q || (f.name || "").toLowerCase().includes(q); })
    .sort((a, b) => (Number(b.diamonds) || 0) - (Number(a.diamonds) || 0) || (a.name || "").localeCompare(b.name || ""));
  // Drill-in: producten van de geopende fabriek, met de gewone filters erop.
  const factoryProducts = selectedFactory
    ? visibleProducts.filter(p => belongsToFactory(p, selectedFactory))
    : [];
  // Categorie-chips binnen een fabriek = alleen de categorieën die díe fabriek heeft.
  const chipCategories = selectedFactory
    ? ["All", ...[...new Set(products.filter(p => belongsToFactory(p, selectedFactory)).map(p => p.category).filter(Boolean))].sort()]
    : visibleCategories;

  // Herbruikbare productkaart (zelfde stijl als voorheen) — voor drill-in + favorieten.
  const productCardEl = (p) => (
    <motion.div key={p.id} layout layoutId={`card-${p.id}`} className={activeGroup ? "ff-glow" : ""}
      initial={{ opacity: 0, scale: 0.92, y: 14 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.16, ease: [0.32, 0.72, 0, 1] } }}
      onClick={() => { if (!session) { alert("Log in to order!"); return; } setSelectedProduct(p); }}
      whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}
      transition={springMorph}
      style={{ background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)", cursor: "pointer" }}>
      <div style={{ position: "relative" }}>
        <motion.div layoutId={`pimg-${p.id}`} transition={springMorph} style={{ background: "#fff", height: 160, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48, overflow: "hidden" }}>
          {p.image?.startsWith("http") ? <img src={p.image} referrerPolicy="no-referrer" alt={p.title} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : p.image}
        </motion.div>
        <motion.div layoutId={`plus-${p.id}`} transition={springMorph}
          onClick={e => { e.stopPropagation(); setActionProduct(p); }}
          whileTap={{ scale: 0.82 }}
          style={{ position: "absolute", right: 10, bottom: 10, width: 36, height: 36, borderRadius: 18, background: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(255,92,0,0.4)", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
          <Plus size={19} color="#fff" strokeWidth={2.6} />
        </motion.div>
      </div>
      <div style={{ padding: "11px 13px 13px" }}>
        <div style={{ fontSize: 11.5, color: "#A8A5A0", marginBottom: 3 }}>{p.platform} · {p.category}</div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "#111111", marginBottom: 7, lineHeight: 1.35 }}>{p.title}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111111" }}>€{Number(p.price).toFixed(2)}</div>
            <div style={{ fontSize: 9.5, color: "#A8A5A0", marginTop: 1, lineHeight: 1.2 }}>factory price · +fees &amp; shipping</div>
          </div>
          {Number(p.rating) > 0
            ? <div style={{ fontSize: 11.5, fontWeight: 600, color: "#111111" }}>★ {Number(p.rating).toFixed(1)}</div>
            : <div style={{ fontSize: 11, color: "#A8A5A0" }}>MOQ {p.moq}</div>}
        </div>
      </div>
    </motion.div>
  );

  // Fabriek-kaart voor de top van de feed (zelfde grid-stijl als producten).
  const factoryCardEl = (f) => {
    const dia = Math.max(0, Math.min(4, Number(f.diamonds) || 0));
    const stats = [
      { label: "Repurchase rate", v: f.repurchase },
      { label: "Service score", v: f.service },
      { label: "On-time delivery", v: f.ontime },
      { label: "Positive reviews", v: f.reviews },
    ].filter(s => s.v);
    return (
      <motion.div key={f.id} layout layoutId={`factory-${f.id}`} className={activeGroup ? "ff-glow" : ""}
        initial={{ opacity: 0, scale: 0.92, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.16, ease: [0.32, 0.72, 0, 1] } }}
        onClick={() => { setSelectedFactory(f); setSearch(""); setActiveCategory("All"); setActiveSub(null); }}
        whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}
        transition={springMorph}
        style={{ background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)", cursor: "pointer" }}>
        <div style={{ position: "relative", height: 132, background: "#F3F1EC", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 46, overflow: "hidden" }}>
          {f.cover
            ? <img src={f.cover} referrerPolicy="no-referrer" alt={f.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : "🏭"}
          {dia >= 1 && (
            <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(17,17,17,0.82)", borderRadius: 20, padding: "3px 8px", fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>
              {"💎".repeat(dia)}
            </div>
          )}
        </div>
        <div style={{ padding: "11px 13px 13px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111111", marginBottom: 3, lineHeight: 1.3 }}>{f.name}</div>
          <div style={{ fontSize: 11, color: "#A8A5A0", marginBottom: stats.length ? 8 : 0 }}>{f.count} product{f.count === 1 ? "" : "s"} ›</div>
          {stats.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
              {stats.map(s => (
                <div key={s.label} style={{ background: "#F6F4EF", borderRadius: 8, padding: "5px 7px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: "#FF5C00", lineHeight: 1.1 }}>{s.v}</div>
                  <div style={{ fontSize: 9, color: "#8A8780", lineHeight: 1.2, marginTop: 1 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <div style={{ fontFamily: "'Inter', 'Helvetica Neue', sans-serif", background: "#F8F7F4", minHeight: "100vh", maxWidth: 430, margin: "0 auto", width: "100%", position: "relative" }}>

      <GroupModeGlow key={activeGroup?.id || "none"} active={!!activeGroup} dimmed={!!(selectedProduct || showRequestList || showFriends || showNotifs || showVable)} />
      {/* Header */}
      <div style={{ padding: "16px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#111111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, boxShadow: activeGroup ? "0 0 0 2px rgba(255,92,0,0.6)" : "none", transition: "box-shadow .3s", flexShrink: 0 }}>🦊</div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2.5, color: "#111111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>FLOWVA{activeGroup && <span style={{ color: "#FF5C00" }}> FRIENDS</span>}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ background: "#EFEDE8", borderRadius: 20, padding: "7px 13px", display: "flex", gap: 6, alignItems: "baseline" }}>
            <span style={{ fontSize: 11, color: "#8A8780" }}>Balance</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#111111" }}>€{parseFloat(balance).toFixed(2)}</span>
          </div>
          <div style={{ position: "relative" }}>
            <motion.div whileTap={{ scale: 0.88 }} transition={springSnappy} onClick={() => setShowNotifs(!showNotifs)}
              style={{ width: 38, height: 38, borderRadius: "50%", background: showNotifs ? "#111111" : "#fff", border: "1px solid #ECEAE5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
              <Bell size={17} color={showNotifs ? "#fff" : "#111111"} strokeWidth={2} />
            </motion.div>
            {(notifications.length > 0 || warehouseCount > 0) && !showNotifs && (
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springBouncy}
                style={{ position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, padding: "0 3px", borderRadius: 9, background: "#FF5C00", border: "2px solid #F8F7F4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", boxSizing: "content-box" }}>
                {notifications.length + warehouseCount}
              </motion.div>
            )}
            <AnimatePresence>
              {showNotifs && (
                <motion.div initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.96 }}
                  transition={springSnappy}
                  style={{ position: "absolute", top: 46, right: 0, width: 280, background: "#fff", borderRadius: 16, boxShadow: "0 12px 40px rgba(17,17,17,0.18)", zIndex: 150, overflow: "hidden", transformOrigin: "top right", border: "1px solid #ECEAE5" }}>
                  <div style={{ padding: "12px 14px 10px", fontSize: 13, fontWeight: 700, color: "#111111", borderBottom: "1px solid #F0EEE8" }}>Notifications</div>
                  {notifications.length === 0 && warehouseCount === 0 && (
                    <div style={{ padding: "20px 14px", textAlign: "center", fontSize: 13, color: "#aaa" }}>🦊 No new notifications</div>
                  )}
                  {warehouseCount > 0 && (
                    <div onClick={() => { setShowNotifs(false); setTab("warehouse"); }}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: "1px solid #F0EEE8", cursor: "pointer" }}>
                      <span style={{ fontSize: 17 }}>🏭</span>
                      <span style={{ fontSize: 12.5, color: "#333", lineHeight: 1.4, flex: 1 }}>{warehouseCount} product{warehouseCount > 1 ? "s" : ""} in your warehouse</span>
                      <span style={{ color: "#ccc", fontSize: 14 }}>→</span>
                    </div>
                  )}
                  {notifications.map((n, i) => (
                    <div key={i} onClick={() => { setShowNotifs(false); if (n.cart) { setShowRequestList(true); } else { setTab("orders"); setSelectedOrder(n.order); } }}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: i < notifications.length - 1 ? "1px solid #F0EEE8" : "none", cursor: "pointer" }}>
                      <span style={{ fontSize: 17 }}>{n.icon}</span>
                      <span style={{ fontSize: 12.5, color: "#333", lineHeight: 1.4, flex: 1 }}>{n.text}</span>
                      <span style={{ color: "#ccc", fontSize: 14 }}>→</span>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Warehouse banner */}
      {warehouseCount > 0 && tab === "feed" && (
        <motion.div whileTap={{ scale: 0.98 }} onClick={() => setTab("warehouse")}
          style={{ background: "#111111", margin: "6px 20px 0", borderRadius: 18, padding: "13px 16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Factory size={18} color="#FF5C00" strokeWidth={2} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", marginBottom: 1 }}>Products in warehouse</div>
            <div style={{ fontSize: 12, color: "#9C9893" }}>{warehouseCount} product{warehouseCount > 1 ? "s" : ""} waiting for shipment</div>
          </div>
          <div style={{ color: "#FF5C00", fontSize: 16 }}>→</div>
        </motion.div>
      )}

      {/* Tab-inhoud met vloeiende overgangen */}
      <AnimatePresence mode="wait" initial={false}>

      {/* FEED TAB */}
      {tab === "feed" && (
        <motion.div key="feed" {...pageTransition} style={{ padding: "10px 20px 80px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6, color: "#111111", marginBottom: 2 }}>{showFavoritesOnly ? "Favorites" : selectedFactory ? selectedFactory.name : <>Factory <span style={{ color: "#FF5C00" }}>Feed</span></>}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <motion.button whileTap={{ scale: 0.85 }} transition={springSnappy} onClick={() => window.open("/diamond-rankings.html", "_blank")} aria-label="How diamond rankings work"
                style={{ width: 42, height: 42, borderRadius: "50%", background: "#fff", border: "1px solid #ECEAE5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18, lineHeight: 1, WebkitTapHighlightColor: "transparent" }}>
                💎
              </motion.button>
              <motion.button whileTap={{ scale: 0.85 }} transition={springSnappy} onClick={() => setShowFavoritesOnly((v) => !v)} aria-label="favorites"
                style={{ width: 42, height: 42, borderRadius: "50%", background: showFavoritesOnly ? "#FF5C00" : "#fff", border: "1px solid #ECEAE5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Star size={19} color={showFavoritesOnly ? "#fff" : "#111111"} fill={showFavoritesOnly ? "#fff" : "none"} strokeWidth={2} />
              </motion.button>
              <motion.button whileTap={{ scale: 0.85 }} transition={springSnappy} onClick={() => setShowVable(true)} aria-label="VABLE — our label"
                style={{ width: 42, height: 42, borderRadius: "50%", background: "#111111", border: "1px solid #111111", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                <img src="/vable-phoenix.svg" alt="VABLE" style={{ width: 26, height: 26, filter: "brightness(0) invert(1)" }} />
              </motion.button>
            </div>
          </div>
          <div style={{ fontSize: 13.5, color: "#8A8780", marginBottom: 16 }}>{showFavoritesOnly ? "Your starred products." : selectedFactory ? "Curated products from this factory." : "Tap a factory to explore its products."}</div>

          {/* Terug-knop + fabriek-header bij drill-in */}
          {selectedFactory && !showFavoritesOnly && (
            <>
              <motion.div whileTap={{ scale: 0.96 }} onClick={() => { setSelectedFactory(null); setSearch(""); setActiveCategory("All"); setActiveSub(null); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 12, cursor: "pointer", color: "#8A8780", fontSize: 13, fontWeight: 600, WebkitTapHighlightColor: "transparent" }}>
                <span style={{ fontSize: 17, lineHeight: 1, marginTop: -1 }}>‹</span> All factories
              </motion.div>
              {(() => {
                const dia = Math.max(0, Math.min(4, Number(selectedFactory.diamonds) || 0));
                const stats = [
                  { label: "Repurchase rate", v: selectedFactory.repurchase },
                  { label: "Service score", v: selectedFactory.service },
                  { label: "On-time delivery", v: selectedFactory.ontime },
                  { label: "Positive reviews", v: selectedFactory.reviews },
                ].filter(s => s.v);
                return (
                  <motion.div layoutId={`factory-${selectedFactory.id}`} transition={springMorph}
                    style={{ background: "#fff", borderRadius: 16, padding: 14, marginBottom: 16, boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: stats.length ? 12 : 0 }}>
                      <div style={{ width: 52, height: 52, borderRadius: 13, background: "#F3F1EC", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, overflow: "hidden", flexShrink: 0 }}>
                        {(selectedFactory.cover || (selectedFactory.logo && selectedFactory.logo.startsWith("http"))) ? <img src={selectedFactory.cover || selectedFactory.logo} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "🏭"}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: "#A8A5A0", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>Factory{dia >= 1 && <span style={{ letterSpacing: 1 }}>{"💎".repeat(dia)}</span>}</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>{selectedFactory.name}</div>
                      </div>
                    </div>
                    {stats.length > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {stats.map(s => (
                          <div key={s.label} style={{ background: "#F8F7F4", borderRadius: 10, padding: "8px 10px", border: "1px solid #EFEDE7" }}>
                            <div style={{ fontSize: 15, fontWeight: 800, color: "#FF5C00" }}>{s.v}</div>
                            <div style={{ fontSize: 10.5, color: "#8A8780" }}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                );
              })()}
            </>
          )}
          <div className={activeGroup ? "ff-glow" : ""} style={{ background: "#F0EEE8", borderRadius: 15, padding: "12px 14px", display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
            <Search size={17} color="#8A8780" strokeWidth={2} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={selectedFactory || showFavoritesOnly ? "Search products by name..." : "Search factories by name..."}
              style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 14, color: "#111111", fontFamily: "inherit" }} />
            {search ? (
              <X size={15} color="#8A8780" onClick={() => setSearch("")} style={{ cursor: "pointer" }} />
            ) : (selectedFactory || showFavoritesOnly) ? (
              <SlidersHorizontal size={15} color="#8A8780" onClick={() => setShowClothesPicker(true)} style={{ cursor: "pointer" }} />
            ) : null}
          </div>
          {(selectedFactory || showFavoritesOnly || factories.length === 0) && (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 18, paddingBottom: 4 }}>
            {chipCategories.map((c) => {
              const active = activeCategory === c;
              const hasSubs = c !== "All" && subsForCategory(c).length > 0;
              const label = c === activeCategory && activeSub ? `${c} · ${activeSub}` : c;
              return (
                <motion.div key={c} layout whileTap={{ scale: 0.92 }} transition={springSnappy}
                  className={activeGroup ? "ff-cat-on" : ""}
                  onClick={() => {
                    setActiveCategory(c); setActiveSub(null);
                    if (hasSubs) setShowClothesPicker(true);
                  }}
                  style={{ position: "relative", display: "flex", alignItems: "center", gap: 5, padding: "8px 15px", borderRadius: 20, background: active ? "transparent" : "#fff", color: active ? "#fff" : "#555", fontSize: 13, fontWeight: active ? 600 : 500, border: "1px solid " + (active ? "transparent" : "#ECEAE5"), whiteSpace: "nowrap", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                  {/* Glijdend pilletje achter de actieve chip — zelfde patroon als de bottom-nav */}
                  {active && (
                    <motion.div layoutId="catPill" transition={springSnappy}
                      style={{ position: "absolute", inset: 0, background: "#111111", borderRadius: 20, zIndex: 0 }} />
                  )}
                  <span style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 5 }}>
                    {label}{hasSubs && <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>}
                  </span>
                </motion.div>
              );
            })}
          </div>
          )}
          {/* === BODY: favorieten · fabriek-drill-in · fabriek-kaarten === */}
          {showFavoritesOnly ? (
            <>
              {!loadingProducts && !productsError && visibleProducts.length === 0 && (
                <div style={{ textAlign: "center", padding: 40, color: "#999", lineHeight: 1.5 }}>No favorites yet — tap the ☆ on any product to save it here.</div>
              )}
              {visibleProducts.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <AnimatePresence mode="popLayout" initial={false}>
                    {visibleProducts.map(productCardEl)}
                  </AnimatePresence>
                </div>
              )}
            </>
          ) : selectedFactory ? (
            <>
              {factoryProducts.length === 0 && (
                <div style={{ textAlign: "center", padding: 40, color: "#999" }}>No products in this view.</div>
              )}
              {factoryProducts.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <AnimatePresence mode="popLayout" initial={false}>
                    {factoryProducts.map(productCardEl)}
                  </AnimatePresence>
                </div>
              )}
            </>
          ) : factories.length === 0 ? (
            <>
              {/* Terugval: nog geen fabrieken (SQL nog niet gedraaid) → klassieke feed */}
              {loadingProducts && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>Loading products...</div>}
              {productsError && <div style={{ textAlign: "center", padding: 40, color: "#B45309" }}>Couldn't load products: {productsError}</div>}
              {!loadingProducts && !productsError && products.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>No products found</div>}
              {!loadingProducts && !productsError && products.length > 0 && visibleProducts.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>No results found</div>}
              {!loadingProducts && !productsError && visibleProducts.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <AnimatePresence mode="popLayout" initial={false}>
                    {visibleProducts.map(productCardEl)}
                  </AnimatePresence>
                </div>
              )}
            </>
          ) : (
            <>
              {loadingProducts && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>Loading factories...</div>}
              {productsError && <div style={{ textAlign: "center", padding: 40, color: "#B45309" }}>Couldn't load: {productsError}</div>}
              {!loadingProducts && !productsError && factoryCards.length === 0 && (
                <div style={{ textAlign: "center", padding: 40, color: "#999", lineHeight: 1.5 }}>{search ? "No factories match your search." : "No factories yet — check back soon."}</div>
              )}
              {!loadingProducts && !productsError && factoryCards.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <AnimatePresence mode="popLayout" initial={false}>
                    {factoryCards.map(factoryCardEl)}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}
        </motion.div>
      )}

      {/* ORDERS TAB */}
      {tab === "orders" && !selectedOrder && (
        <motion.div key="orders-list" {...pageTransition} style={{ paddingBottom: 80, width: "100%" }}>
          <TreasureMap activeFilter={orderFilter} onSelect={setOrderFilter} orders={visibleOrders} />
          <div style={{ padding: "16px 20px" }}>
            {(() => {
              // Groepeer orders per aankoop (request_group_id); losse orders = eigen groep.
              const grouped = visibleOrders.reduce((acc, o) => {
                const k = o.request_group_id || o.id;
                (acc[k] = acc[k] || []).push(o);
                return acc;
              }, {});
              return Object.values(grouped)
                .filter(items => items.some(matchesFilter))         // groep tonen als één item bij het filter past
                .sort((a, b) => (a[0].id < b[0].id ? 1 : -1))       // nieuwste bovenaan
                .map(items => (
                  <OrderGroupCard key={items[0].request_group_id || items[0].id} items={items}
                    onOpenItem={(o) => { setSelectedOrder(o); setConfirmCancel(false); }} />
                ));
            })()}
            {visibleOrders.filter(matchesFilter).length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#aaa" }}>
                <div style={{ position: "relative", display: "inline-block", fontSize: 48, marginBottom: 12, lineHeight: 1 }}>
                  🦊
                  <motion.div
                    initial={{ opacity: 0, y: 0 }}
                    animate={{ opacity: [0, 1, 1, 0], y: [0, 4, 14, 22] }}
                    transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 1.2, ease: "easeIn", times: [0, 0.25, 0.75, 1] }}
                    style={{ position: "absolute", left: 7, top: 26, fontSize: 13 }}>
                    💧
                  </motion.div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#0F0E0C", marginBottom: 6 }}>No orders yet</div>
                <div style={{ fontSize: 13 }}>Order something in the feed!</div>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ORDER DETAIL */}
      {tab === "orders" && selectedOrder && (
        <motion.div key="orders-detail" initial={{ opacity: 0, x: 44 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 44 }} transition={pageTransition.transition} style={{ padding: "16px 20px", paddingBottom: 80 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => setSelectedOrder(null)}
              style={{ width: 36, height: 36, borderRadius: "50%", background: "#fff", border: "1px solid #ECEAE5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 16, color: "#111111", WebkitTapHighlightColor: "transparent" }}>←</motion.button>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111111" }}>Track order</div>
          </div>
          <div style={{ background: "#fff", borderRadius: 16, padding: "13px 16px", marginBottom: 12, boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111111", marginBottom: 2 }}>{selectedOrder.product_title || selectedOrder.product}</div>
            <div style={{ fontSize: 12, color: "#A8A5A0" }}>{selectedOrder.id} · {selectedOrder.qty} pcs{selectedOrder.kleur ? ` · ${selectedOrder.kleur}` : ""}</div>
          </div>
          {(() => {
            const step = statusConfig[selectedOrder.status]?.step ?? 0;
            return (
              <div style={{ background: "#fff", borderRadius: 18, padding: "16px 18px", marginBottom: 16, boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#111111" }}>Status</span>
                  <span style={{ fontSize: 12, color: "#A8A5A0" }}>Step {step + 1} of {trackingSteps.length}</span>
                </div>
                {trackingSteps.map((label, i) => {
                  const done = i < step;
                  const current = i === step;
                  const last = i === trackingSteps.length - 1;
                  return (
                    <div key={i} style={{ display: "flex", gap: 13 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 22, flexShrink: 0 }}>
                        {current ? (
                          <div style={{ position: "relative", width: 22, height: 22 }}>
                            <motion.div animate={{ scale: [0.9, 1.6], opacity: [0.45, 0] }} transition={{ duration: 1.7, repeat: Infinity, ease: "easeOut" }}
                              style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid #FF5C00", willChange: "transform, opacity" }} />
                            <div style={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid #111111", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>
                              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#111111" }} />
                            </div>
                          </div>
                        ) : (
                          <div style={{ width: 22, height: 22, borderRadius: "50%", background: done ? "#111111" : "#EDEBE6", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                            {done ? "✓" : ""}
                          </div>
                        )}
                        {!last && <div style={{ width: 2, flex: 1, minHeight: 16, background: done ? "#111111" : "#EDEBE6", margin: "3px 0", borderRadius: 1 }} />}
                      </div>
                      <div style={{ paddingBottom: last ? 2 : 18, paddingTop: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13.5, fontWeight: current ? 700 : done ? 600 : 500, color: done || current ? "#111111" : "#B7B4AE" }}>{label}</span>
                        {current && (
                          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springBouncy}
                            style={{ background: "#FF5C00", color: "#fff", fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, padding: "3px 8px", borderRadius: 7 }}>IN PROGRESS</motion.span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {/* Probleem gemeld door agent */}
          {selectedOrder.problem_type && problemTypes[selectedOrder.problem_type] && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={springSoft}
              style={{ background: "#FFF7ED", border: "1.5px solid #F59E0B", borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#B45309", marginBottom: 6 }}>
                {problemTypes[selectedOrder.problem_type].icon} {problemTypes[selectedOrder.problem_type].label}
              </div>
              <div style={{ fontSize: 13, color: "#92400E", lineHeight: 1.5, marginBottom: 12 }}>
                {problemTypes[selectedOrder.problem_type].msg}
              </div>
              {["requested", "quote_sent", "quote_accepted"].includes(selectedOrder.status) && (
                <div style={{ display: "flex", gap: 8 }}>
                  <motion.button whileTap={{ scale: 0.96 }} onClick={acknowledgeProblem}
                    style={{ flex: 1, background: "#FF5C00", color: "#fff", border: "none", borderRadius: 10, padding: "11px 8px", fontSize: 13, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                    ✓ Agreed, continue
                  </motion.button>
                  {selectedOrder.status === "quote_accepted" ? (
                    <motion.button whileTap={{ scale: 0.96 }} onClick={() => confirmCancel ? cancelPaidOrder() : setConfirmCancel(true)}
                      style={{ flex: 1, background: confirmCancel ? "#DC2626" : "#FEE2E2", color: confirmCancel ? "#fff" : "#DC2626", border: "none", borderRadius: 10, padding: "11px 8px", fontSize: 13, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                      {confirmCancel ? "Sure? Yes, refund" : "✕ Cancel & refund"}
                    </motion.button>
                  ) : (
                    <motion.button whileTap={{ scale: 0.96 }} onClick={() => confirmCancel ? cancelRequest() : setConfirmCancel(true)}
                      style={{ flex: 1, background: confirmCancel ? "#DC2626" : "#FEE2E2", color: confirmCancel ? "#fff" : "#DC2626", border: "none", borderRadius: 10, padding: "11px 8px", fontSize: 13, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                      {confirmCancel ? "Sure? Yes, cancel" : "✕ Cancel request"}
                    </motion.button>
                  )}
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 11, color: "#B45309" }}>Or send your choice via the chat below 💬</div>
            </motion.div>
          )}

          {/* Eigen klant-melding: in behandeling, of afgewezen met standaardbericht */}
          {selectedOrder.dispute_status === "pending" && (
            <div style={{ background: "#FFF7ED", border: "1.5px solid #F59E0B", borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#B45309", marginBottom: 4 }}>⏳ Your report is under review</div>
              <div style={{ fontSize: 13, color: "#92400E", lineHeight: 1.5 }}>We're checking your report and proof — you'll hear from us soon.</div>
            </div>
          )}
          {selectedOrder.dispute_status === "rejected" && selectedOrder.dispute_response && (
            <div style={{ background: "#F8F7F4", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C", marginBottom: 6 }}>Return request declined</div>
              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.55 }}>{selectedOrder.dispute_response}</div>
            </div>
          )}
          {(() => {
            const fm = foxMessages[selectedOrder.status];
            return fm ? (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, background: "#111111", borderRadius: 18, padding: "15px 16px", marginBottom: 16 }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>🦊</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#FF5C00", marginBottom: 4 }}>{statusConfig[selectedOrder.status]?.label}</div>
                  <div style={{ fontSize: 13, color: "#C9C6C1", lineHeight: 1.55 }}>
                    <WordReveal key={selectedOrder.status} text={fm.msg} stagger={0.025} />
                  </div>
                </div>
              </div>
            ) : null;
          })()}
          {selectedOrder.status === "quote_sent" && (
            <QuoteAcceptance order={selectedOrder} session={session} balance={balance} allOrders={orders} onAccepted={(updated) => { setSelectedOrder(updated); fetchOrders(); fetchBalance(); }} />
          )}

          {selectedOrder.status === "qc_pending" && selectedOrder.qc_images?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0F0E0C", marginBottom: 12 }}>QC photos</div>
              {(() => {
                // Foto van de gekochte variant; oudere orders hebben die niet
                // opgeslagen — val dan terug op de productfoto uit de feed.
                const feedProduct = products.find(p => p.title === (selectedOrder.product_title || selectedOrder.product));
                const orderImage = selectedOrder.variant_image || (feedProduct?.image?.startsWith("http") ? feedProduct.image : null);
                return orderImage ? (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springSoft}
                    style={{ marginBottom: 10, borderRadius: 12, overflow: "hidden", position: "relative", background: "#fff" }}>
                    <img src={orderImage} referrerPolicy="no-referrer" alt="your order" style={{ width: "100%", aspectRatio: "1", objectFit: "contain", display: "block" }} />
                    <div style={{ position: "absolute", top: 8, left: 8, background: "#0F0E0C", color: "#FF5C00", fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 20 }}>
                      Your order{selectedOrder.kleur ? ` · ${selectedOrder.kleur}` : ""}
                    </div>
                  </motion.div>
                ) : null;
              })()}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {selectedOrder.qc_images.map((url, i) => (
                  <div key={i} style={{ borderRadius: 12, overflow: "hidden", aspectRatio: "1", position: "relative" }}>
                    <img src={url} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    {i === 3 && <div style={{ position: "absolute", bottom: 6, left: 6, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, padding: "2px 6px", borderRadius: 6 }}>⚖️ Weight</div>}
                  </div>
                ))}
              </div>
              {selectedOrder.weight_grams && (
                <div style={{ marginTop: 10, background: "#F0FDF4", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#065F46", fontWeight: 600 }}>
                  ⚖️ Weight: {selectedOrder.weight_grams}g · shipping is charged per parcel — bundle to save
                </div>
              )}
              <button onClick={() => setTab("warehouse")} style={{ width: "100%", marginTop: 10, background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                🏭 Add to parcel →
              </button>
            </div>
          )}
          {selectedOrder.status === "shipped_international" && selectedOrder.tracking_number && (
            <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: "16px", marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "#aaa", marginBottom: 4 }}>DHL Express</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>{selectedOrder.tracking_number}</div>
              <a href={`https://www.dhl.com/nl-nl/home/tracking.html?tracking-id=${selectedOrder.tracking_number}`} target="_blank" rel="noreferrer"
                style={{ fontSize: 13, color: "#6366F1", fontWeight: 600, textDecoration: "none" }}>Track your parcel →</a>
            </div>
          )}
          <CustomerChat order={selectedOrder} session={session} />
        </motion.div>
      )}

      {/* WAREHOUSE TAB */}
      {tab === "warehouse" && (
        <motion.div key="warehouse" {...pageTransition}>
          <WarehouseTab session={session} haulItems={haulItems} setHaulItems={setHaulItems} activeGroupId={activeGroup?.id || null} />
        </motion.div>
      )}

      {/* TRANSIT TAB */}
      {tab === "transit" && (
        <motion.div key="transit" {...pageTransition}>
          <TransitTab session={session} orders={visibleOrders} />
        </motion.div>
      )}

      {/* PROFILE TAB */}
      {tab === "profile" && (
        <motion.div key="profile" {...pageTransition} style={{ padding: "16px 20px", paddingBottom: 80 }}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6, color: "#111111", marginBottom: 14 }}>Profile</div>
          <div style={{ background: "#fff", borderRadius: 18, padding: "14px 16px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)" }}>
            <label style={{ position: "relative", cursor: "pointer", flexShrink: 0 }}>
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springBouncy}
                style={{ width: 52, height: 52, borderRadius: "50%", overflow: "hidden", background: "#111111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                {avatarUrl ? <img src={avatarUrl} alt="profile photo" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "🦊"}
              </motion.div>
              <div style={{ position: "absolute", bottom: -2, right: -2, width: 19, height: 19, borderRadius: "50%", background: "#FF5C00", border: "2px solid #fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Plus size={11} color="#fff" strokeWidth={3} />
              </div>
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleAvatarUpload} disabled={avatarUploading} />
            </label>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#111111" }}>
                <WordReveal key={(session?.user?.id || "u") + avatarUploading} text={avatarUploading ? "Uploading..." : `Hi ${session?.user?.user_metadata?.voornaam || "there"}! 👋`} delay={0.15} />
              </div>
              <div style={{ fontSize: 12.5, color: "#A8A5A0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session?.user?.email}</div>
            </div>
            <motion.div whileTap={{ scale: 0.88 }} onClick={() => setShowEditProfile(true)}
              style={{ width: 36, height: 36, borderRadius: "50%", background: "#F3F1ED", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>✏️</motion.div>
          </div>
          <div style={{ background: "#111111", borderRadius: 18, padding: "18px 20px", marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#9C9893", fontWeight: 600, marginBottom: 8 }}>Available balance</div>
            <div style={{ fontSize: 34, fontWeight: 800, color: "#fff", letterSpacing: -0.5, marginBottom: 4 }}>€{parseFloat(balance).toFixed(2)}</div>
            <div style={{ fontSize: 12, color: "#9C9893" }}>For orders and shipping</div>
          </div>
          <div style={{ background: "#fff", borderRadius: 18, padding: "16px 18px", marginBottom: 12, boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#111111", marginBottom: 12 }}>Top up balance</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {[10, 25, 50, 100].map(amt => {
                const sel = topupAmount === amt.toString();
                return (
                  <motion.button key={amt} onClick={() => setTopupAmount(amt.toString())}
                    whileTap={{ scale: 0.9 }} transition={springSnappy}
                    style={{ position: "relative", flex: 1, padding: "9px 4px", background: sel ? "transparent" : "#F3F1ED", color: sel ? "#fff" : "#555", border: "none", borderRadius: 11, fontSize: 13, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent", overflow: "hidden" }}>
                    {sel && (
                      <motion.div layoutId="topupHighlight" transition={springSnappy}
                        style={{ position: "absolute", inset: 0, background: "#111111", borderRadius: 11, zIndex: 0 }} />
                    )}
                    <span style={{ position: "relative", zIndex: 1 }}>€{amt}</span>
                  </motion.button>
                );
              })}
            </div>
            <input type="number" placeholder="Or type an amount..." value={topupAmount} onChange={e => setTopupAmount(e.target.value)}
              style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 10, padding: "10px 14px", fontSize: 14, background: "#F8F7F4", boxSizing: "border-box", marginBottom: 10 }} />
            <button onClick={handleTopup} disabled={loadingBalance || !topupAmount}
              style={{ width: "100%", background: loadingBalance || !topupAmount ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700, cursor: loadingBalance || !topupAmount ? "default" : "pointer" }}>
              {loadingBalance ? "Loading..." : `+ Add €${topupAmount || "0"} via iDEAL`}
            </button>
          </div>
          {/* Flowva Friends — activatie-switch: selecteer een groep → de switch zet 'm live */}
          {(() => {
            const gathering = myGroups.filter((g) => g.status === "gathering");
            const shake = () => { setShakeGroups(true); setTimeout(() => setShakeGroups(false), 650); };
            const onToggle = () => {
              if (activeGroup) { setActiveGroup(null); return; }                       // uit
              const g = gathering.find((x) => x.group_id === selectedGroupId);
              if (!g) { shake(); return; }                                              // niets geselecteerd → rode shake
              setActiveGroup({ id: g.group_id, name: g.name });                         // aan
            };
            return (
              <div style={{ background: "#fff", border: `1px solid ${activeGroup ? "rgba(255,92,0,0.5)" : "#E8E6E0"}`, borderRadius: 16, padding: "15px 18px", marginBottom: 12, boxShadow: activeGroup ? "0 0 0 3px rgba(255,92,0,0.08)" : "none", transition: "border-color .25s, box-shadow .25s" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 11, background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🦊</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C" }}>Flowva Friends</div>
                    <div style={{ fontSize: 12, color: "#A8A5A0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeGroup ? `Shopping for ${activeGroup.name}` : "Order together — select a group to activate"}</div>
                  </div>
                  <div onClick={onToggle} role="switch" aria-checked={!!activeGroup}
                    style={{ width: 48, height: 28, borderRadius: 999, background: activeGroup ? "#FF5C00" : "#E3E1DC", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .25s" }}>
                    <motion.div animate={{ x: activeGroup ? 20 : shakeGroups ? 9 : 0 }} transition={springBouncy}
                      style={{ position: "absolute", top: 3, left: 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
                  </div>
                </div>
                {gathering.length > 0 ? (
                  <>
                    <div style={{ fontSize: 11, color: "#A8A5A0", fontWeight: 600, letterSpacing: 0.4, margin: "14px 2px 8px" }}>YOUR GROUPS</div>
                    <motion.div animate={shakeGroups ? { x: [0, -7, 7, -5, 5, 0] } : { x: 0 }} transition={{ duration: 0.45 }}
                      style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      {gathering.map((g) => {
                        const live = activeGroup && activeGroup.id === g.group_id;
                        const sel = !activeGroup && selectedGroupId === g.group_id;
                        return (
                          <div key={g.group_id}
                            onClick={() => { if (activeGroup) setActiveGroup({ id: g.group_id, name: g.name }); else setSelectedGroupId(g.group_id); }}
                            style={{ display: "flex", alignItems: "center", gap: 10, boxSizing: "border-box", width: "100%", cursor: "pointer", borderRadius: 12, padding: "10px 12px", transition: "border-color .2s, background .2s",
                              background: shakeGroups ? "#FDF1F1" : live ? "#F1FBF4" : sel ? "#FFF7F2" : "#F8F7F4",
                              border: `1.5px solid ${shakeGroups ? "#E24B4A" : live ? "rgba(22,163,74,0.5)" : sel ? "rgba(255,92,0,0.6)" : "#ECEAE5"}` }}>
                            <div style={{ width: 30, height: 30, borderRadius: 9, background: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>🦊</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "#111111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}{g.role === "admin" ? " · admin" : ""}</div>
                              <div style={{ fontSize: 11, color: "#A8A5A0" }}>{g.member_count}/{g.max_size} friends{live ? " · live" : ""}</div>
                            </div>
                            <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${live ? "#16A34A" : sel ? "#FF5C00" : "#D4D2CC"}`, flexShrink: 0, position: "relative", transition: "border-color .2s" }}>
                              {(live || sel) && <div style={{ position: "absolute", inset: 3, borderRadius: "50%", background: live ? "#16A34A" : "#FF5C00" }} />}
                            </div>
                          </div>
                        );
                      })}
                    </motion.div>
                    <button onClick={() => { setFriendsJoinCode(null); setShowFriends(true); }}
                      style={{ background: "transparent", border: "none", color: "#A8A5A0", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "8px 0 0", textAlign: "left" }}>+ Create, join or manage groups</button>
                  </>
                ) : (
                  <button onClick={() => { setFriendsJoinCode(null); setShowFriends(true); }}
                    style={{ width: "100%", marginTop: 12, background: "#FFF0E7", border: "1px dashed rgba(255,92,0,0.4)", color: "#FF5C00", borderRadius: 12, padding: "12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{myGroups.length > 0 ? "View or manage your groups →" : "Join or create a group first →"}</button>
                )}
              </div>
            );
          })()}
          <PushToggle session={session} />
          <motion.div whileTap={{ scale: 0.98 }} onClick={() => setShowHowItWorks(true)}
            style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "15px 18px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🦊</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C" }}>How Flowva works</div>
              <div style={{ fontSize: 12, color: "#A8A5A0" }}>Prices, fees, shipping & the haul model</div>
            </div>
            <div style={{ color: "#C9C6C1", fontSize: 18 }}>→</div>
          </motion.div>
          <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "15px 18px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>💬</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C" }}>Flowva support</div>
              <div style={{ fontSize: 12, color: "#A8A5A0" }}>{supportHidden ? "Hidden — tap to unhide the chat" : "Hide the support chat button"}</div>
            </div>
            <div role="switch" aria-checked={!supportHidden}
              onClick={() => { setSupportHidden((v) => { const next = !v; try { localStorage.setItem("flowva_support_hidden", next ? "1" : "0"); } catch { /* ignore */ } window.dispatchEvent(new Event("flowva-support-toggle")); return next; }); }}
              style={{ width: 48, height: 28, borderRadius: 999, background: !supportHidden ? "#FF5C00" : "#E3E1DC", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .25s" }}>
              <motion.div animate={{ x: !supportHidden ? 20 : 0 }} transition={springBouncy}
                style={{ position: "absolute", top: 3, left: 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
            </div>
          </div>
          <a href="/returns" style={{ textDecoration: "none", background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "15px 18px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: "#F3F1ED", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>↩️</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C" }}>Returns &amp; withdrawal</div>
              <div style={{ fontSize: 12, color: "#A8A5A0" }}>Cancel an order or read the policy</div>
            </div>
            <div style={{ color: "#C9C6C1", fontSize: 18 }}>→</div>
          </a>
          <TransactionHistory session={session} />
          <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "16px 20px", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C" }}>📦 Shipping address</div>
              <motion.button whileTap={{ scale: 0.9 }} transition={springSnappy} onClick={() => setShowEditProfile(true)}
                style={{ background: "none", border: "none", fontSize: 12, color: "#6366F1", cursor: "pointer", fontWeight: 600, WebkitTapHighlightColor: "transparent" }}>✏️ Edit</motion.button>
            </div>
            {[
              { label: "Name", value: `${session?.user?.user_metadata?.voornaam || ""} ${session?.user?.user_metadata?.achternaam || ""}` },
              { label: "Address", value: session?.user?.user_metadata?.adres || "-" },
              { label: "Postal code", value: session?.user?.user_metadata?.postcode || "-" },
              { label: "City", value: session?.user?.user_metadata?.stad || "-" },
              { label: "Country", value: session?.user?.user_metadata?.land || "-" },
              { label: "Phone", value: session?.user?.user_metadata?.telefoon || "-" },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", paddingBottom: 8, marginBottom: 8, borderBottom: "1px solid #F0EEE8" }}>
                <span style={{ fontSize: 13, color: "#888" }}>{item.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C" }}>{item.value}</span>
              </div>
            ))}
          </div>
          <button onClick={() => {
            // Wis de APPARAAT-lokale winkelstate bij uitloggen, zodat een volgend account
            // op dit toestel NIET de mand/favorieten/haul van de vorige gebruiker ziet.
            try {
              ["supplyflow_request_list", "supplyflow_haul", "flowva_favorites", "flowva_active_group", "flowva_seen_howitworks"]
                .forEach((k) => { localStorage.removeItem(lsKey(k)); localStorage.removeItem(k); });
            } catch { /* ignore */ }
            supabase.auth.signOut();
          }} style={{ width: "100%", background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Log out</button>
        </motion.div>
      )}

      </AnimatePresence>

      {/* Order Request Modal */}
      <AnimatePresence>
        {selectedProduct && (
          <OrderRequest product={selectedProduct} session={session}
            onClose={() => setSelectedProduct(null)}
            onSuccess={() => { setSuccessProduct(selectedProduct); setSelectedProduct(null); fetchOrders(); }}
            listCount={requestList.length}
            onAddToList={(item) => { setRequestList(list => [...list, item]); setSelectedProduct(null); }}
            isFavorite={isFavorite(selectedProduct)} onToggleFavorite={() => toggleFavorite(selectedProduct)}
            activeGroup={activeGroup} onActiveGroupGone={() => setActiveGroup(null)} />
        )}
      </AnimatePresence>

      {/* Zwevende aanvraaglijst-balk: morpht open naar de zwarte lijst-sheet
          (zelfde layoutId — het balkje IS de dichtgevouwen lijst) */}
      <AnimatePresence>
        {showFriends && (
          <Friends session={session} initialJoinCode={friendsJoinCode} initialGroupId={friendsGroupId}
            activeGroupId={activeGroup?.id}
            onShopForGroup={(g) => setActiveGroup(g)} onOpenProduct={openProductByUrl}
            onClose={() => { setShowFriends(false); setFriendsJoinCode(null); setFriendsGroupId(null); }} />
        )}
        {showVable && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowVable(false)}
              style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }}
              style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#fff", borderRadius: "24px 24px 0 0", zIndex: 301, maxHeight: "88vh", overflowY: "auto", padding: 0 }}>
              <style>{`@keyframes vKoiA{0%{transform:translate(-70px,0)}50%{transform:translate(170px,-7px)}100%{transform:translate(390px,0)}}@keyframes vKoiB{0%{transform:translate(390px,0) scaleX(-1)}50%{transform:translate(170px,7px) scaleX(-1)}100%{transform:translate(-80px,0) scaleX(-1)}}@keyframes vTail{0%,100%{transform:rotate(-15deg)}50%{transform:rotate(15deg)}}@keyframes vFin{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}@keyframes vRip{from{transform:translateX(0)}to{transform:translateX(-44px)}}`}</style>
              <div style={{ position: "relative", height: 152, background: "linear-gradient(155deg,#1d2740,#121a2c 55%,#0b101d)", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", width: 38, height: 4, background: "rgba(255,255,255,0.25)", borderRadius: 2, zIndex: 2 }} />
                <svg viewBox="0 0 440 60" preserveAspectRatio="none" style={{ position: "absolute", left: 0, bottom: 0, width: "120%", height: 70, opacity: 0.22, animation: "vRip 9s linear infinite" }}>
                  <path d="M0 30 Q 55 22 110 30 T 220 30 T 330 30 T 440 30" stroke="#7d9bd6" fill="none" strokeWidth="1" />
                  <path d="M0 46 Q 55 38 110 46 T 220 46 T 330 46 T 440 46" stroke="#7d9bd6" fill="none" strokeWidth="1" />
                </svg>
                <div style={{ position: "absolute", top: 80, left: 0, animation: "vKoiA 13s linear infinite" }}>{vableFish("#F08A3E", false)}</div>
                <div style={{ position: "absolute", top: 110, left: 0, animation: "vKoiB 17s linear infinite" }}>{vableFish("#EFE7DA", true)}</div>
                <div style={{ position: "absolute", right: 14, bottom: 4 }}>
                  <svg viewBox="0 0 70 110" width="44"><line x1="30" y1="66" x2="27" y2="100" stroke="#cfd4dc" strokeWidth="1.6" /><line x1="37" y1="66" x2="41" y2="100" stroke="#cfd4dc" strokeWidth="1.6" /><ellipse cx="34" cy="56" rx="18" ry="10" fill="#EDEFF2" /><path d="M18 56 L 3 62 L 16 53 Z" fill="#2b2f38" /><path d="M44 52 C 57 43, 49 24, 38 15" stroke="#EDEFF2" strokeWidth="4.6" fill="none" strokeLinecap="round" /><circle cx="37" cy="14" r="4" fill="#EDEFF2" /><circle cx="37" cy="10.5" r="2.2" fill="#cc2b2b" /><path d="M33 14 L 22 15.5 L 33 17.5 Z" fill="#c9a566" /></svg>
                </div>
                <img src="/vable-logo.svg" alt="VABLE" style={{ position: "absolute", left: 18, bottom: 15, width: 138, height: "auto", filter: "brightness(0) invert(1)", zIndex: 2 }} />
                <button onClick={() => setShowVable(false)} style={{ position: "absolute", top: 12, right: 12, background: "rgba(255,255,255,0.16)", border: "none", borderRadius: 999, width: 30, height: 30, fontSize: 14, color: "#fff", cursor: "pointer", zIndex: 2 }}>✕</button>
              </div>
              <div style={{ padding: "14px 20px 40px" }}>
              <div style={{ fontSize: 12.5, color: "#8A8780", marginBottom: 16 }}>Japanese-embroidered denim — our own label.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
                {VABLE_ITEMS.map((it, i) => (
                  <div key={i} style={{ borderRadius: 14, overflow: "hidden", background: "#fff", border: "1px solid #F0EEE8" }}>
                    <div style={{ height: 150, background: it.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {it.img ? <img src={it.img} alt={it.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <img src="/vable-phoenix.svg" alt="" style={{ width: 42, height: 42, opacity: 0.2, filter: "brightness(0) invert(1)" }} />}
                    </div>
                    <div style={{ padding: "8px 10px 10px" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>{it.name}</div>
                      <div style={{ fontSize: 11, color: "#A8A5A0" }}>{it.price}</div>
                    </div>
                  </div>
                ))}
              </div>
              <a href={VABLE_URL} target="_blank" rel="noreferrer"
                style={{ display: "block", marginTop: 16, background: "#111", color: "#fff", borderRadius: 24, padding: "13px", textAlign: "center", fontSize: 13.5, fontWeight: 700, textDecoration: "none" }}>Shop the collection ↗</a>
              <div style={{ textAlign: "center", fontSize: 10.5, color: "#B6B2AB", marginTop: 7 }}>opens vable.store</div>
              </div>
            </motion.div>
          </>
        )}
        {groupToast && (
          <div onClick={() => { setGroupToast(null); setShowFriends(true); }}
            style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 350, width: "calc(100% - 24px)", maxWidth: 406, boxSizing: "border-box", background: "#0F0E0C", border: `1px solid ${groupToast.kind === "placed" ? "rgba(52,209,123,0.35)" : "rgba(226,75,74,0.35)"}`, borderRadius: 14, padding: "12px 14px", boxShadow: "0 12px 40px rgba(0,0,0,0.45)", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>{groupToast.kind === "placed" ? "🎉" : "↩️"}</span>
            <div style={{ flex: 1, fontSize: 12.5, color: "#fff", lineHeight: 1.4 }}>
              {groupToast.kind === "placed"
                ? <>Your group <b>{groupToast.name || "order"}</b> is placed — everyone's in! Tap to view.</>
                : <>Your group <b>{groupToast.name || ""}</b> closed. Tap for details.</>}
            </div>
            <button onClick={(e) => { e.stopPropagation(); setGroupToast(null); }} aria-label="dismiss" style={{ background: "transparent", border: "none", color: "#9C9893", fontSize: 14, cursor: "pointer" }}>✕</button>
          </div>
        )}
        {infoToast && (
          <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", zIndex: 350, background: "#0F0E0C", color: "#fff", borderRadius: 999, padding: "10px 18px", fontSize: 13, fontWeight: 600, boxShadow: "0 8px 30px rgba(0,0,0,0.4)", maxWidth: "90%", textAlign: "center" }}>{infoToast}</div>
        )}
        {activeGroup && tab === "feed" && !selectedProduct && !showFriends && !showRequestList && (
          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0, scale: 0.96 }} whileTap={{ scale: 0.97 }} transition={springMorph}
            onClick={() => { setFriendsGroupId(activeGroup.id); setShowFriends(true); }}
            style={{ position: "fixed", bottom: 78, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 40px)", maxWidth: 390, background: "#111111", borderRadius: 16, overflow: "hidden", cursor: "pointer", zIndex: 301, boxShadow: "0 12px 40px rgba(255,92,0,0.28)", border: "1px solid rgba(255,92,0,0.4)" }}>
            <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 18 }}>🦊</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeGroup.name} · group cart</div>
                <div style={{ fontSize: 11.5, color: "#9C9893" }}>Tap to open your squad 🦊</div>
              </div>
              <motion.div animate={{ y: [0, -3, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,92,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ChevronUp size={16} color="#FF5C00" strokeWidth={2.5} />
              </motion.div>
              <button onClick={(e) => { e.stopPropagation(); setActiveGroup(null); }} aria-label="exit group mode"
                style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#9C9893", width: 26, height: 26, borderRadius: "50%", fontSize: 12, cursor: "pointer", flexShrink: 0 }}>✕</button>
            </div>
          </motion.div>
        )}
        {requestList.length > 0 && tab === "feed" && !showRequestList && !selectedProduct && !showFriends && !activeGroup && (
          <motion.div layoutId="request-list-morph" transition={springMorph}
            onClick={() => { setListError(null); setShowRequestList(true); }}
            style={{ position: "fixed", bottom: 78, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 40px)", maxWidth: 390, background: "#111111", borderRadius: 16, overflow: "hidden", cursor: "pointer", zIndex: 301, boxShadow: "0 12px 40px rgba(17,17,17,0.35)" }}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.1, duration: 0.16 } }} exit={{ opacity: 0, transition: { duration: 0.08 } }}
              style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 18 }}>📋</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Shopping cart · {requestList.length} item{requestList.length > 1 ? "s" : ""}</div>
                <div style={{ fontSize: 11.5, color: "#9C9893" }}>Tap to open — one service fee 🦊</div>
              </div>
              <motion.div animate={{ y: [0, -3, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,92,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ChevronUp size={16} color="#FF5C00" strokeWidth={2.5} />
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Aanvraaglijst-sheet */}
      <AnimatePresence>
        {showRequestList && (
          <RequestListSheet
            items={requestList}
            onRemove={(i) => setRequestList(list => list.filter((_, idx) => idx !== i))}
            onSetQty={(i, q) => setRequestList(list => list.map((it, idx) => idx === i ? { ...it, qty: Math.max(1, q) } : it))}
            onClose={() => setShowRequestList(false)}
            onSend={submitRequestList}
            sending={sendingList}
            error={listError}
            session={session}
            onEditAddress={() => { setShowRequestList(false); setTab("profile"); setShowEditProfile(true); }}
            onTopUp={() => { setShowRequestList(false); setTab("profile"); }}
            onFinish={(goOrders) => { setShowRequestList(false); if (goOrders) { setTab("orders"); setSelectedOrder(null); } }}
            flagged={new Set(flaggedUrls)}
            reasons={flaggedReasons}
          />
        )}
      </AnimatePresence>

      {/* Product Preview Modal */}
      <AnimatePresence>
        {previewProduct && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPreviewProduct(null)}
              style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }} />
            <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
              style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderRadius: "24px 24px 0 0", zIndex: 201, maxHeight: "85vh", overflowY: "auto", padding: "20px 20px 40px" }}>
              <div style={{ width: 36, height: 4, background: "#E8E6E0", borderRadius: 2, margin: "0 auto 16px" }} />
              <button onClick={() => setPreviewProduct(null)} style={{ background: "none", border: "none", fontSize: 14, color: "#666", cursor: "pointer", padding: 0, marginBottom: 12 }}>← Back</button>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>{previewProduct.title}</div>
              <div style={{ fontSize: 12, color: "#aaa", marginBottom: 16 }}>Product preview</div>
              <PreviewGallery images={previewProduct.preview_images} />
              <button onClick={() => { setPreviewProduct(null); setSelectedProduct(previewProduct); }}
                style={{ width: "100%", marginTop: 20, background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                View product →
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Order Success Modal */}
      <AnimatePresence>
        {orderSuccess || successProduct ? (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSuccessProduct(null)}
              style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }} />
            <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#0F0E0C", borderRadius: "24px 24px 0 0", zIndex: 201, padding: "32px 24px 48px" }}>
              <div style={{ width: 36, height: 4, background: "#333", borderRadius: 2, margin: "0 auto 24px" }} />
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <motion.span layoutId="cart-fox" style={{ fontSize: 56, display: "inline-block", marginBottom: 16 }}>🦊</motion.span>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#FF5C00", marginBottom: 8 }}>Order placed! 🎉</div>
                <div style={{ fontSize: 14, color: "#888", lineHeight: 1.6 }}>
                  We're getting it from the factory:
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
                {[
                  { icon: "🛒", text: "Buying your item from the supplier", lid: "ck-ship" },
                  { icon: "📸", text: "Taking quality-control photos", lid: "ck-items" },
                  { icon: "🏭", text: "Storing it safely in the warehouse", lid: "ck-total" },
                  { icon: "✈️", text: "Shipping it to your door", lid: "ck-boat" },
                ].map((item) => (
                  <motion.div key={item.lid} style={{ display: "flex", alignItems: "center", gap: 12, background: "#1A1917", borderRadius: 10, padding: "10px 14px" }}>
                    <span style={{ fontSize: 18 }}>{item.icon}</span>
                    <span style={{ fontSize: 13, color: "#CCC" }}>{item.text}</span>
                  </motion.div>
                ))}
              </div>
              <motion.button whileTap={{ scale: 0.97 }}
                onClick={() => { setSuccessProduct(null); setOrderSuccess(false); setTab("orders"); setSelectedOrder(null); }}
                style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                Track it in Orders →
              </motion.button>
              <motion.button onClick={() => { setSuccessProduct(null); setOrderSuccess(false); }}
                style={{ width: "100%", background: "transparent", color: "#888", border: "none", padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 6 }}>
                Back to feed
              </motion.button>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      {/* Plus-paneel: morpht open vanuit het plusje op de productkaart */}
      <AnimatePresence>
        {actionProduct && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setActionProduct(null)}
              style={{ position: "fixed", inset: 0, zIndex: 240, background: "rgba(17,17,17,0.4)", backdropFilter: "blur(5px)" }} />
            <div style={{ position: "fixed", inset: 0, zIndex: 241, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <motion.div layoutId={`plus-${actionProduct.id}`} transition={springMorph}
                style={{ width: 248, background: "#FF5C00", borderRadius: 20, overflow: "hidden", pointerEvents: "all", boxShadow: "0 24px 80px rgba(17,17,17,0.3)" }}>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.1, duration: 0.16 } }} exit={{ opacity: 0, transition: { duration: 0.08 } }}>
                  <div style={{ padding: "13px 16px 11px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "#fff", lineHeight: 1.35 }}>{actionProduct.title}</div>
                    <div onClick={() => setActionProduct(null)} style={{ cursor: "pointer", flexShrink: 0, padding: 2 }}>
                      <X size={15} color="rgba(255,255,255,0.75)" />
                    </div>
                  </div>
                  <div style={{ background: "#fff", borderRadius: "14px 14px 0 0" }}>
                  {[
                    { Icon: ShoppingBag, label: "View product", sub: "Choose options & add to cart", accent: true, show: true,
                      go: () => { const p = actionProduct; setActionProduct(null); setSelectedProduct(p); } },
                    { Icon: Eye, label: "Product preview", sub: "View extra photos", accent: false, show: actionProduct.preview_images?.length > 0,
                      go: () => { const p = actionProduct; setActionProduct(null); setPreviewProduct(p); } },
                    { Icon: Star, label: "Reviews", sub: "Ratings & photos", accent: false, show: true,
                      go: () => { const p = actionProduct; setActionProduct(null); setReviewProduct(p); } },
                  ].filter(o => o.show).map((o, oi) => (
                    <motion.div key={o.label} whileTap={{ scale: 0.97 }} onClick={o.go}
                      style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 16px", borderTop: oi > 0 ? "1px solid #F0EEE8" : "none", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                      <div style={{ width: 32, height: 32, borderRadius: 11, background: o.accent ? "#FFF0E7" : "#F3F1ED", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <o.Icon size={15} color={o.accent ? "#FF5C00" : "#111111"} strokeWidth={2.2} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#111111" }}>{o.label}</div>
                        <div style={{ fontSize: 11, color: "#A8A5A0" }}>{o.sub}</div>
                      </div>
                      <div style={{ color: "#D5D2CC", fontSize: 13 }}>→</div>
                    </motion.div>
                  ))}
                  </div>
                </motion.div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* Profiel bewerken */}
      <AnimatePresence>
        {showEditProfile && (
          <EditProfileSheet session={session} onClose={() => setShowEditProfile(false)} />
        )}
      </AnimatePresence>

      {/* Uitleg: hoe Flowva werkt */}
      <AnimatePresence>
        {showHowItWorks && <HowItWorksSheet onClose={closeHowItWorks} />}
      </AnimatePresence>

      {/* Review-pagina */}
      <AnimatePresence>
        {reviewProduct && (
          <ReviewPage product={reviewProduct} session={session} onClose={() => setReviewProduct(null)} />
        )}
      </AnimatePresence>

      {/* Clothes categorie-kiezer */}
      <AnimatePresence>
        {showClothesPicker && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowClothesPicker(false)}
              style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#fff", borderRadius: "24px 24px 0 0", zIndex: 201, maxHeight: "80vh", overflowY: "auto", padding: "20px 20px 40px" }}>
              <div style={{ width: 36, height: 4, background: "#E8E6E0", borderRadius: 2, margin: "0 auto 16px" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#0F0E0C" }}>Choose a category</div>
                {activeSub && (
                  <button onClick={() => { setActiveSub(null); setShowClothesPicker(false); }}
                    style={{ background: "none", border: "none", fontSize: 13, color: "#6366F1", fontWeight: 600, cursor: "pointer" }}>Clear filter</button>
                )}
              </div>
              {/* Alleen subcategorieën met producten — lege blijven verborgen */}
              {(() => {
                const pickerCat = activeCategory !== "All" ? activeCategory : (visibleCategories.slice(1).find((c) => subsForCategory(c).length > 0) || visibleCategories[1] || null);
                const subs = pickerCat ? subsForCategory(pickerCat) : [];
                if (subs.length === 0) {
                  return <div style={{ textAlign: "center", padding: "24px 0", color: "#aaa", fontSize: 13 }}>🦊 No subcategories yet — they appear as products are added.</div>;
                }
                return (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {subs.map((it) => {
                      const sel = activeSub === it;
                      return (
                        <motion.button key={it} whileTap={{ scale: 0.9 }} transition={springSnappy}
                          onClick={() => { setActiveSub(it); setActiveCategory(pickerCat); setShowClothesPicker(false); }}
                          style={{ padding: "8px 14px", borderRadius: 20, border: "1px solid " + (sel ? "#0F0E0C" : "#E8E6E0"), background: sel ? "#0F0E0C" : "#fff", color: sel ? "#FF5C00" : "#555", fontSize: 13, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                          {it}
                        </motion.button>
                      );
                    })}
                  </div>
                );
              })()}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Bottom nav */}
      <div style={{ position: "fixed", zIndex: 100, bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "#fff", borderTop: "1px solid #ECEAE5", display: "flex", padding: "9px 0 15px" }}>
        {[
          { id: "feed", Icon: Home, label: "Feed" },
          { id: "orders", Icon: Package, label: "Orders" },
          { id: "warehouse", Icon: Factory, label: "Warehouse" },
          { id: "transit", Icon: Plane, label: "Transit" },
          { id: "profile", Icon: User, label: "Profile" },
        ].map(t => {
          const active = tab === t.id;
          return (
            <motion.button key={t.id} onClick={() => { setTab(t.id); setSelectedOrder(null); }}
              whileTap={{ scale: 0.85 }} transition={springSnappy}
              style={{ position: "relative", flex: 1, background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
              {active && (
                <motion.div layoutId="navPill" transition={springSnappy}
                  style={{ position: "absolute", top: -3, bottom: -3, left: 14, right: 14, background: "rgba(255,92,0,0.1)", borderRadius: 14, zIndex: 0 }} />
              )}
              <motion.span animate={{ scale: active ? 1.12 : 1, y: active ? -1 : 0 }} transition={springSnappy}
                style={{ position: "relative", zIndex: 1, display: "flex" }}>
                <t.Icon size={21} color={active ? "#111111" : "#A8A5A0"} strokeWidth={active ? 2.3 : 1.8} />
                {t.id === "warehouse" && warehouseCount > 0 && (
                  <div style={{ position: "absolute", top: -5, right: -8, background: "#FF5C00", borderRadius: 9, minWidth: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", border: "2px solid #fff", padding: "0 2px", boxSizing: "content-box" }}>{warehouseCount}</div>
                )}
              </motion.span>
              <span style={{ position: "relative", zIndex: 1, fontSize: 10, fontWeight: active ? 700 : 500, color: active ? "#111111" : "#A8A5A0" }}>{t.label}</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
