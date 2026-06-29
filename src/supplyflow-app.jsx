import { useState, useEffect, useRef, useLayoutEffect } from "react";

// #12 — idempotentie-token voor pay_cart (module-scope: één cart per tab). Stabiel per
// poging; pas roteren NA een ontvangen server-antwoord, zodat een reclick na netwerk-
// verlies hetzelfde resultaat terugkrijgt i.p.v. dubbel af te rekenen.
let _cartPayToken = null;
const cartPayToken = () => (_cartPayToken ||= (globalThis.crypto?.randomUUID?.() || `cp-${Date.now()}-${Math.random().toString(36).slice(2)}`));
const rotateCartPayToken = () => { _cartPayToken = null; };
import { supabase } from "./supabase";
import { EU_COUNTRIES } from "./countries";
import OrderRequest from "./OrderRequest";
import Friends from "./Friends";
import GroupModeGlow from "./GroupModeGlow";
import { ffMyGroups, estimateMemberFee } from "./ffApi";
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
import Fox from "./Fox";

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
  qc_pending:           { label: "Quality-control pictures ready", color: "#065F46", bg: "#D1FAE5", step: 3 },
  shipped_international: { label: "Shipped to you",             color: "#0369A1", bg: "#E0F2FE", step: 4 },
  delivered:            { label: "Delivered",                   color: "#166534", bg: "#DCFCE7", step: 5 },
};

// Labels van de tracking-bolletjes — index = statusConfig[...].step.
const trackingSteps = [
  "Order placed",
  "Bought",
  "To warehouse",
  "Quality control",
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
  { key: "qc_pending", label: "Quality control", Icon: Camera, statuses: ["qc_pending"], x: 72, y: 50 },
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

// Voortgang per product — 5 stappen van 20%:
// 20 Order placed · 40 Item bought · 60 Shipped domestically · 80 Arrived in warehouse · 100 Quality-control klaar.
// 80↔100: bij 'qc_pending' is het 80% zolang de quality-control foto's er nog niet zijn, en 100% zodra ze er zijn.
const QC_FULL_STEP = statusConfig.qc_pending.step;
function productProgress(o) {
  const status = typeof o === "string" ? o : o?.status;
  const step = statusConfig[status]?.step ?? 0;
  if (status === "qc_pending") return (typeof o === "object" && o?.qc_images?.length > 0) ? 100 : 80;
  if (step > QC_FULL_STEP) return 100;   // shipped_international / delivered
  return [20, 40, 60][step] ?? 20;        // order placed / bought / shipped_local
}
// Bij 'qc_pending' is een item eerst "Arrived in warehouse" (net binnen, nog geen
// quality-control foto's) en pas "Quality-control pictures ready" zodra de foto's er zijn.
function qcArrived(o) {
  return typeof o === "object" && o?.status === "qc_pending" && !(o?.qc_images?.length > 0);
}
function statusLabel(o) {
  if (qcArrived(o)) return "Arrived in warehouse";
  const status = typeof o === "string" ? o : o?.status;
  return (statusConfig[status] || statusConfig.purchased).label;
}
const PRODUCT_COLORS = ["#FF5C00", "#6366F1", "#16A34A", "#EAB308", "#EC4899"];

// Tik op de ring → groot voortgangswiel: elk product een concentrische boog die
// zich vult richting QC (= vol). Mijlpaal-streepjes tonen waar het % op slaat.
function ProgressWheelModal({ items, onClose }) {
  const bars = items.slice(0, 8);
  const overall = Math.round(items.reduce((s, o) => s + productProgress(o), 0) / items.length);
  const milestones = [
    { pct: 20, label: "Order placed" }, { pct: 40, label: "Item bought successfully" },
    { pct: 60, label: "Shipped domestically" }, { pct: 80, label: "Arrived in warehouse" },
    { pct: 100, label: "Quality-control pictures ready" },
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
              const pct = productProgress(o);
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
                    {[20, 40, 60, 80].map((g) => (
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
function OrderGroupCard({ items, onOpenItem, groupSize }) {
  const [open, setOpen] = useState(false);
  const [wheel, setWheel] = useState(false);
  const date = items[0]?.date || "";
  const percent = Math.round(items.reduce((s, o) => s + productProgress(o), 0) / items.length);
  const whStep = statusConfig.qc_pending.step;
  const atWarehouse = items.filter(o => (statusConfig[o.status]?.step ?? 0) >= whStep).length;
  const anyProblem = items.some(o => o.problem_type);
  const subtotal = items.reduce((s, o) => s + (Number(o.price) || 0), 0);
  // Groep-order = groepstarief (zelfde staffel als de checkout); anders solo 8%/min €5.
  const isGroupOrder = !!items[0]?.ff_group_id;
  const fee = isGroupOrder && groupSize ? estimateMemberFee(groupSize, subtotal) : serviceFee(subtotal);
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
                      <div style={{ display: "inline-block", background: s.bg, color: s.color, fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20 }}>{statusLabel(o)}{o.problem_type ? " · ⚠️" : ""}</div>
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
                  <span>{isGroupOrder ? "Group fee" : "Service fee"}</span><span>€{fee.toFixed(2)}</span>
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
  const [agreed, setAgreed] = useState(false);
  const isHeld = (item) => !!flagged && flagged.has(item.source_url);
  const heldReason = (item) => reasons?.[item.source_url] || "On hold — changed at the factory";
  const heldCount = items.filter(isHeld).length;
  // Held-items doen NIET mee met betalen → totaal/fee/per-item alleen over de betaalbare items.
  const payable = items.filter((it) => !isHeld(it));
  const total = payable.reduce((s, it) => s + Number(it.price || 0) * (it.qty || 1), 0);
  const fee = payable.length ? serviceFee(total) : 0;
  const KOERS = 7.8;
  const totalQty = payable.reduce((s, it) => s + (it.qty || 1), 0);
  const domesticCny = 5 * totalQty;
  const domestic = Math.round((domesticCny / KOERS) * 100) / 100;
  const qcCny = 6 * totalQty;
  const qc = Math.round((qcCny / KOERS) * 100) / 100;
  const charge = total + domestic + qc + fee;
  const perItem = totalQty ? fee / totalQty : fee;
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
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }}
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
                <motion.span layoutId="cart-fox" style={{ fontSize: 28, flexShrink: 0 }}><Fox /></motion.span>
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
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12.5, color: "#9C9893" }}>Domestic shipping (¥5 × {totalQty})</span>
                    <span style={{ fontSize: 12.5, color: "#fff", fontWeight: 600 }}>€{domestic.toFixed(2)} <span style={{ color: "#9C9893", fontWeight: 400 }}>· ¥{domesticCny}</span></span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12.5, color: "#9C9893" }}>Quality-control (¥6 × {totalQty})</span>
                    <span style={{ fontSize: 12.5, color: "#fff", fontWeight: 600 }}>€{qc.toFixed(2)} <span style={{ color: "#9C9893", fontWeight: 400 }}>· ¥{qcCny}</span></span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12.5, color: "#9C9893" }}>Service fee (8%, min €5)</span>
                    <span style={{ fontSize: 12.5, color: "#fff", fontWeight: 600 }}>€{fee.toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: 6, marginTop: 5 }}>
                    <span style={{ fontSize: 11, color: "#9C9893" }}>that's only</span>
                    <motion.span key={perItem.toFixed(2)} initial={{ scale: 1.3, opacity: 0.3 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 18 }}
                      style={{ fontSize: 19, fontWeight: 800, color: perItemColor }}>€{perItem.toFixed(2)}</motion.span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: perItemColor }}>per item {perItem < 2 ? "🎉" : <Fox />}</span>
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
                <motion.span layoutId="cart-fox" style={{ fontSize: 34, flexShrink: 0 }}><Fox /></motion.span>
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
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12.5, color: "#9C9893" }}>Domestic shipping (¥5 × {totalQty})</span>
                  <span style={{ fontSize: 12.5, color: "#fff" }}>€{domestic.toFixed(2)} <span style={{ color: "#9C9893" }}>· ¥{domesticCny}</span></span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12.5, color: "#9C9893" }}>Quality-control (¥6 × {totalQty})</span>
                  <span style={{ fontSize: 12.5, color: "#fff" }}>€{qc.toFixed(2)} <span style={{ color: "#9C9893" }}>· ¥{qcCny}</span></span>
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
              <label style={{ display: "flex", alignItems: "flex-start", gap: 9, marginTop: 12, cursor: "pointer", fontSize: 11, color: "#8A8780", lineHeight: 1.55 }}>
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 2, accentColor: "#FF5C00", width: 16, height: 16, flexShrink: 0 }} />
                <span>I agree to the <a href="/terms" target="_blank" rel="noreferrer" style={{ color: "#A5B4FC" }}>Terms</a> and the <a href="/returns-policy" target="_blank" rel="noreferrer" style={{ color: "#A5B4FC" }}>Returns &amp; withdrawal policy</a>, and that any refunds are credited to my Flowva balance. I have a <b style={{ color: "#C9C6C1" }}>14-day right of withdrawal</b>; for a change of mind I pay the return shipping (EU return address), faulty items are on Flowva.</span>
              </label>
              <motion.button whileTap={sending || !hasAddress || !payable.length || !agreed ? undefined : { scale: 0.97 }} onClick={confirmAndPay} disabled={sending || !hasAddress || payable.length === 0 || !agreed}
                style={{ width: "100%", marginTop: 10, background: sending ? "#333" : (!hasAddress || !payable.length || !agreed) ? "#444" : "#FF5C00", color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontSize: 15, fontWeight: 700, cursor: sending || !hasAddress || !payable.length || !agreed ? "default" : "pointer", WebkitTapHighlightColor: "transparent" }}>
                {sending ? "Processing payment…" : !hasAddress ? "Add an address to continue" : payable.length === 0 ? "All items are on hold" : !agreed ? "Tick the box to continue" : heldCount > 0 ? `Order & pay €${charge.toFixed(2)} for the rest →` : `Order & pay €${charge.toFixed(2)} →`}
              </motion.button>

              <motion.button whileTap={{ scale: 0.97 }} onClick={() => setView("cart")}
                style={{ width: "100%", marginTop: 8, background: "transparent", color: "#C9C6C1", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14, padding: "13px", fontSize: 13, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                ← Back to cart
              </motion.button>
            </motion.div>
          ) : (
            <motion.div key="placed">
              <div style={{ textAlign: "center", marginBottom: 22, marginTop: 4 }}>
                <motion.span layoutId="cart-fox" style={{ fontSize: 52, display: "inline-block", marginBottom: 12 }}><Fox /></motion.span>
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
            {messages.length === 0 && <div style={{ textAlign: "center", color: "#aaa", fontSize: 13, padding: "20px 0" }}><div style={{ fontSize: 32, marginBottom: 8 }}><Fox /></div>Send your agent a message</div>}
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.sender === "customer" ? "flex-end" : "flex-start" }}>
                {m.sender === "agent" && <div style={{ fontSize: 18, marginRight: 6, alignSelf: "flex-end" }}><Fox /></div>}
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
    { icon: "🛒", title: "A small service fee", body: "We buy it, check it and handle everything for you. The fee is 8% (min €5) per order — and it drops further when you order together with Flowva Friends." },
    { icon: "🏬", title: "Your items wait in your China warehouse", body: "Bought items gather safely in your personal warehouse — 30 days free. No rush; keep adding to your haul." },
    { icon: "📸", title: "Quality-control + measurement photos", body: "We photograph and measure your actual item before it ships — so you see exactly what you're getting, no surprises on the doorstep." },
    { icon: "📦", title: "One parcel — duties included (DDP)", body: "International shipping is charged per parcel, not per item — so the more you bundle, the cheaper it gets per item. Sent duty-paid (DDP): nothing extra to pay at your door." },
    { icon: "💸", title: "You only pay the real shipping", body: "At checkout you pay an estimate with a small safety buffer. About a week after it ships, the carrier's final bill comes in and you get any difference back on your balance." },
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
          <span style={{ fontSize: 26 }}><Fox /></span>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0F0E0C" }}>How Flowva works</div>
        </div>
        <div style={{ fontSize: 13, color: "#8A8780", marginBottom: 18 }}>Factory prices, real photos, one parcel — duties included.</div>

        {steps.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 13, marginBottom: 15 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{s.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "#0F0E0C", marginBottom: 2 }}>{i + 1}. {s.title}</div>
              <div style={{ fontSize: 13, color: "#6B6862", lineHeight: 1.5 }}>{s.body}</div>
            </div>
          </div>
        ))}

        <div style={{ background: "#FFF7F2", border: "1px solid rgba(255,92,0,0.25)", borderRadius: 16, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#B8430A", marginBottom: 3 }}><Fox /> Cheaper with Flowva Friends</div>
          <div style={{ fontSize: 13, color: "#6B6862", lineHeight: 1.55 }}>Team up, combine everyone's items into one parcel and split the shipping — the cheapest way to ship, and the service fee drops too.</div>
        </div>

        <div style={{ background: "#0F0E0C", borderRadius: 16, padding: "15px 18px", marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#FF5C00", marginBottom: 4 }}>The golden rule 🪙</div>
          <div style={{ fontSize: 13.5, color: "#E8E6E0", lineHeight: 1.55 }}>Build your haul, then ship it as one box. The more you bundle, the less you pay per item — on both the fee and the shipping.</div>
        </div>

        <div style={{ fontSize: 11.5, color: "#A8A5A0", textAlign: "center", marginBottom: 16 }}>Your exact shipping is calculated live at checkout.</div>

        <motion.button whileTap={{ scale: 0.97 }} onClick={onClose}
          style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
          Got it <Fox />
        </motion.button>
      </motion.div>
    </>
  );
}

// Transparant fee-paneel achter de 💸-knop (feed-header + profiel). Engels,
// zelfde bottom-sheet als HowItWorksSheet. Solo + Flowva Friends + per-regel
// een labeltje wie het geld krijgt.
function PricingSheet({ onClose }) {
  const chip = (orange) => ({ display: "inline-block", background: orange ? "#FFF0E7" : "#F1EFED", color: orange ? "#B8430A" : "#6E6B66", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, marginRight: 6 });
  const Row = ({ icon, name, who, amount, desc, whoOrange, extra }) => (
    <div style={{ padding: "9px 0", borderTop: "1px solid #F1EFEA" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
          <span style={{ fontSize: 16 }}>{icon}</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#111" }}>{name}</span>
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: whoOrange ? "#111" : "#FF5C00", whiteSpace: "nowrap" }}>{amount}</span>
      </div>
      <div style={{ margin: "6px 0 0 25px" }}>
        <span style={chip(whoOrange)}>{who}</span>
        <span style={{ fontSize: 11.5, lineHeight: 1.5, color: "#8A8780" }}>{desc}</span>
      </div>
      {extra}
    </div>
  );
  const friendTiers = [
    ["Solo · 1 person", "8% · min €5", true],
    ["2 people", "7% · min €4.50", false],
    ["3 people", "6% · min €4.50", false],
    ["4 people", "5.5% · min €4", false],
    ["5 people", "5% · min €4", false],
    ["6 people", "4.5% · min €4", false],
    ["7+ people", "4% · min €3.50", false],
  ];
  const card = { background: "#fff", border: "1px solid #ECEAE5", borderRadius: 16, padding: "14px 16px", marginBottom: 12 };
  const sectionLabel = { fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "#A8A5A0", marginBottom: 2 };
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }} />
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#F8F7F4", borderRadius: "24px 24px 0 0", zIndex: 301, maxHeight: "92vh", overflowY: "auto", padding: "18px 16px 36px" }}>
        <div style={{ width: 36, height: 4, background: "#D8D5CF", borderRadius: 2, margin: "0 auto 16px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "0 4px" }}>
          <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>💸</div>
          <div>
            <div style={{ fontSize: 19, fontWeight: 800, color: "#111", letterSpacing: -0.3 }}>How pricing works</div>
            <div style={{ fontSize: 12.5, color: "#8A8780" }}>Fully transparent — no hidden markup</div>
          </div>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: "#46443F", margin: "12px 4px 14px" }}>
          Each line below shows exactly who gets paid. The original factory link is visible on every product, for full transparency.
        </div>

        <div style={card}>
          <div style={sectionLabel}>PER PRODUCT</div>
          <Row icon="🏭" name="Factory price" who="to the factory" amount="shown + link" desc="The real price the factory charges — visible with its original link." />
          <Row icon="📸" name="Quality-control" who="to our shipping agent" amount="¥2 · ≈€0.26" desc="Our shipping agent photographs every item before it ships — and takes extra photos if anything looks off." />
          <Row icon="📐" name="Measurement Service" who="to our shipping agent" amount="¥4 · ≈€0.51" desc="Our shipping agent measures the key dimensions of your item to confirm the size matches the listing. Small tolerances apply (about ±3 cm on garments)." />
          <Row icon="🚚" name="China domestic shipping fee" who="to the domestic carrier" amount="¥5 · ≈€0.64" desc="Transport from the factory to the consolidation warehouse in China." />
        </div>

        <div style={card}>
          <div style={sectionLabel}>PER ORDER — shared, so bigger baskets are cheaper</div>
          <Row icon="📦" name="Fulfillment" who="to our shipping agent" amount="¥9.9 · ≈€1.27"
            desc="Our shipping agent receives, packs and prepares your whole order, plus 30 days of free storage. Charged once per order."
            extra={
              <div style={{ background: "#FFF7F2", border: "1px solid #FBE2D2", borderRadius: 10, padding: "9px 11px", margin: "8px 0 0 25px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#B8430A", marginBottom: 3 }}>Two surcharges may apply:</div>
                <div style={{ fontSize: 11, lineHeight: 1.55, color: "#7A5340" }}>• Packages with more than 5 items → +¥2 (≈€0.26) per additional item.<br />• Packages over 2 kg → +¥1.5 (≈€0.19) per kg above 2 kg, with the billable weight rounded up to the next whole kilogram.</div>
              </div>
            } />
          <Row icon="✈️" name="International shipping" who="to the carrier & customs" amount="by weight"
            desc={<>China → your door, priced by weight. <b style={{ color: "#46443F" }}>Tax-inclusive.</b> A <b style={{ color: "#46443F" }}>€3 customs cost per product category</b> is also settled inside this shipping price.</>} />
          <Row icon="🧾" name="Flowva fee" who="Flowva's fee" whoOrange amount="4–8% · min €3.50–€5"
            desc={<>Our only earning, calculated <b style={{ color: "#46443F" }}>only on the factory price</b> — never on the agent or shipping costs.</>} />
        </div>

        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
            <span style={{ fontSize: 19 }}>👤</span>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: "#111" }}>Solo shopping</div>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: "#46443F" }}>
            You shop on your own. The smart move: put <b>everything in one order</b>. Fulfillment, shipping and the Flowva fee are charged once per order — so the more you add, the less each item costs. Your Flowva fee here is <b>8% of the factory price, with a €5 minimum</b> per order.
          </div>
          <div style={{ background: "#FFF7F2", border: "1px solid #FBE2D2", borderRadius: 12, padding: "11px 13px", marginTop: 11 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0", color: "#46443F" }}><span>1 item · factory price €3</span><span style={{ fontWeight: 700, color: "#111" }}>≈ €15 total</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0", color: "#46443F" }}><span>5 items in one order</span><span style={{ fontWeight: 700, color: "#FF5C00" }}>≈ €7 each</span></div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-start" }}>
            <span style={{ fontSize: 14, marginTop: 1 }}>ℹ️</span>
            <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "#8A8780" }}><b style={{ color: "#46443F" }}>Note:</b> this €3 per product category is a customs charge, introduced by a new EU rule from 1 July 2026. It's included in the shipping price. Want to lower it? Shopping with friends is recommended.</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "flex-start" }}>
            <span style={{ fontSize: 14, marginTop: 1 }}>⚠️</span>
            <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "#8A8780" }}>Paying twice means two separate orders — those fixed costs apply again. Add to one basket instead.</div>
          </div>
        </div>

        <div style={{ ...card, border: "2px solid #FF5C00" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
            <span style={{ fontSize: 19 }}>👥</span>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: "#111" }}>Flowva Friends</div>
            <div style={{ marginLeft: "auto", background: "#FF5C00", color: "#fff", fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 999, letterSpacing: 0.3 }}>CHEAPEST</div>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: "#46443F" }}>
            Shop together in one shared basket. Everything ships as <b>one parcel for the whole group</b>, so you split the international shipping and the €3-per-category customs across all friends. And international shipping is <b>cheaper per product the heavier the parcel</b> — so a bigger group helps there too.
          </div>
          <div style={{ background: "#FFF7F2", border: "1px solid #FBE2D2", borderRadius: 12, padding: "12px 13px", marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#B8430A", marginBottom: 8 }}>Your Flowva fee drops with every friend</div>
            {friendTiers.map(([label, fee, gray], i) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", color: "#46443F", borderBottom: i < friendTiers.length - 1 ? "1px solid #FBE2D2" : "none" }}>
                <span>{label}</span><span style={{ fontWeight: 700, color: gray ? "#8A8780" : (i === friendTiers.length - 1 ? "#FF5C00" : "#111") }}>{fee}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "0 4px 4px" }}>
          <span style={{ fontSize: 15, marginTop: 1 }}>🔗</span>
          <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "#8A8780" }}>On every product you'll find the original factory link — check the factory price yourself, anytime. That's our promise of transparency.</div>
        </div>

        <motion.button whileTap={{ scale: 0.97 }} onClick={onClose}
          style={{ width: "100%", marginTop: 14, background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
          Got it <Fox />
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
  const [showPricing, setShowPricing] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [orders, setOrders] = useState([]);
  const [balance, setBalance] = useState(0);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [successProduct, setSuccessProduct] = useState(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupAgreed, setTopupAgreed] = useState(false);
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
  const [groupOrders, setGroupOrders] = useState([]);   // alle orders van de actieve groep (alleen-lezen)
  const [squadWheel, setSquadWheel] = useState(null);   // squad-item waarvan de voortgangscirkel openstaat
  const [friendsJoinCode, setFriendsJoinCode] = useState(null);
  const [friendsGroupId, setFriendsGroupId] = useState(null);   // direct een lobby openen (vanaf de groeps-cart)
  const [activeGroup, setActiveGroup] = useState(() => {
    try { return JSON.parse(localStorage.getItem(lsKey("flowva_active_group")) || "null"); } catch { return null; }
  });
  const [groupToast, setGroupToast] = useState(null);   // {kind,name} als de actieve groep van status wisselt
  // Favorieten (per apparaat) + filter in de feed.
  const [favorites, setFavorites] = useState(() => { try { return JSON.parse(localStorage.getItem(lsKey("flowva_favorites")) || "[]"); } catch { return []; } });
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  // VABLE — eigen merk (borduurdesigns). Knop in de feed-header opent dit blad.
  // Vervang img:null door je echte foto-URL's (en VABLE_URL door je winkel-link).
  const [showVable, setShowVable] = useState(false);
  // Scroll-behoud: bewaar de scrollpositie van de fabriek-feed bij het inzoomen op een
  // fabriek, en herstel 'm zodra je teruggaat — i.p.v. weer bovenaan te beginnen.
  const feedScrollRef = useRef(0);
  useLayoutEffect(() => {
    if (tab === "feed" && !selectedFactory && !showFavoritesOnly && feedScrollRef.current) {
      const y = feedScrollRef.current;
      window.scrollTo(0, y);
      requestAnimationFrame(() => window.scrollTo(0, y));
      feedScrollRef.current = 0;
    }
  }, [selectedFactory, showFavoritesOnly, tab]);
  const VABLE_URL = "https://vable.store";
  const VABLE_ITEMS = [
    { name: "Crane Bird Jeans", price: "€79.99", bg: "#1f2937", img: "/vable/crane.jpg", url: "https://vable.store/products/crane-bird-jeans" },
    { name: "Koi Fish Jeans", price: "€79.99", bg: "#1f2937", img: "/vable/koi.jpg", url: "https://vable.store/products/koi-fish-jeans" },
  ];
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
      // Behoud de actieve groep ook ná plaatsing (volg-modus); alleen weg bij echt einde.
      return g && !["cancelled", "expired", "closed"].includes(g.status) ? cur : null;
    });
  };
  useEffect(() => { if (session && (tab === "profile" || !showFriends)) loadMyGroups(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, showFriends, session]);

  // Alleen-lezen: alle orders van de actieve groep (ieders status). Geen meldingen —
  // die blijven via `orders` (alleen je eigen items).
  useEffect(() => {
    if (!activeGroup) { setGroupOrders([]); return; }
    let on = true;
    supabase.rpc("ff_group_orders", { p_group_id: activeGroup.id }).then(({ data }) => {
      if (on && data?.ok) setGroupOrders(data.orders || []);
    });
    return () => { on = false; };
  }, [activeGroup?.id, tab]);

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
          // Geplaatst → blijf in de groep (volg-modus) + toast; alleen bij echt einde uit.
          if (st && st !== "gathering") setGroupToast({ kind: st, name: payload.new?.name || gname });
          if (st && ["cancelled", "expired", "closed"].includes(st)) setActiveGroup(null);
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

    const { data, error } = await supabase.rpc("pay_cart", { p_items: payable, p_idem: cartPayToken() });
    if (!error) rotateCartPayToken();   // server antwoordde → volgende poging vers token
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
      // Live order-updates: zo valt o.a. de warehouse-telling (qc_pending) meteen weg
      // zodra een order internationaal verzonden wordt — geen verouderde melding meer.
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `user_id=eq.${session.user.id}` },
        () => { fetchOrders(); })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session]);

  const fetchBalance = async () => {
    const { data } = await supabase.from("profiles").select("balance").eq("id", session.user.id).single();
    setBalance(data?.balance || 0);
  };

  const fetchOrders = async () => {
    const { data } = await supabase.from("orders").select("*").eq("user_id", session.user.id).not("status", "in", "(cancelled,forfeited)").order("created_at", { ascending: false });
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

  // Badge/teller volgt de actieve modus: groep → álle qc_pending van de groep (groupOrders),
  // solo → alleen je eigen solo-items (geen ff_group_id).
  const warehouseCount = activeGroup
    ? groupOrders.filter(o => o.status === "qc_pending").length
    : orders.filter(o => o.status === "qc_pending" && !o.ff_group_id).length;
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
    ...orders.filter(o => o.status === "qc_pending" && o.arrived_at && Math.floor((Date.now() - new Date(o.arrived_at).getTime()) / 86400000) >= 24).map(o => {
      const days = Math.floor((Date.now() - new Date(o.arrived_at).getTime()) / 86400000);
      const name = o.product_title || o.product;
      const text = days >= 30
        ? `Storage now applies to ${name} (${days} days in storage) — ship within 90 days or it's forfeited`
        : days >= 27
          ? `${name}: only ${30 - days} day${30 - days === 1 ? "" : "s"} of free storage left — ship soon`
          : `${name} has been in storage ${days} days — ship within ${30 - days} days to keep it free`;
      return { icon: "⏳", text, order: o };
    }),
    ...orders.filter(o => o.last_message_sender === "agent" && o.last_message_read === false).map(o => ({ icon: "💬", text: `Your agent replied (${o.product_title || o.product})`, order: o })),
    // "Delivered" zit bewust NIET meer in het belletje (bleef anders eeuwig staan) —
    // geleverde pakketten zie je in de Transit-tab.
  ];
  // Filter voor de reiskaart: een checkpoint kan meerdere statussen bundelen.
  const matchesFilter = (o) => orderFilter === "all" || (journeyStops.find(j => j.key === orderFilter)?.statuses || [orderFilter]).includes(o.status);
  // Modus-scheiding: solo-modus = alleen solo-orders (ff_group_id null); groep-modus = alleen die groep.
  // Zo zijn Orders/Warehouse/Transit twee duidelijk gescheiden modussen.
  // Solo/standaard-modus toont ALLE orders (ook groep-orders) zodat een geplaatste
  // groep-order altijd zichtbaar/volgbaar is; groep-modus blijft op die groep gefocust.
  const visibleOrders = orders.filter((o) => activeGroup ? o.ff_group_id === activeGroup.id : true);
  // Shop-modus geldt ALLEEN voor een 'gathering'-groep. Een geplaatste groep is "Following"
  // (volgen) — dan gedraagt de feed/cart/glow zich gewoon solo; Orders blijft wel die groep volgen.
  const activeGroupShopping = !!activeGroup && (myGroups.find((g) => g.group_id === activeGroup.id)?.status || "gathering") === "gathering";

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
      // Etalage: handmatig gekozen + bijgesneden foto's (admin) winnen; anders automatisch top-3.
      const manual = Array.isArray(f.storefront_images)
        ? f.storefront_images.filter(u => typeof u === "string" && u.startsWith("http"))
        : [];
      const previews = manual.length
        ? manual
        : fp.filter(p => p.image && p.image.startsWith("http"))
            .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0))
            .slice(0, 3)
            .map(p => p.image);
      return { ...f, count: fp.length, cover, previews };
    })
    .filter(f => f.count > 0)
    .filter(f => { const q = search.trim().toLowerCase(); return !q || (f.name || "").toLowerCase().includes(q); })
    .sort((a, b) => (Number(b.diamonds) || 0) - (Number(a.diamonds) || 0) || (a.name || "").localeCompare(b.name || ""));
  // Drill-in: producten van de geopende fabriek, met de gewone filters erop.
  const factoryProducts = selectedFactory
    ? visibleProducts.filter(p => belongsToFactory(p, selectedFactory))
    : [];

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
          {p.image?.startsWith("http") ? (
            <>
              <img src={p.image} referrerPolicy="no-referrer" alt={p.title}
                onError={(e) => { e.currentTarget.style.display = "none"; const fb = e.currentTarget.nextSibling; if (fb) fb.style.display = "flex"; }}
                style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              <span style={{ display: "none", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>📦</span>
            </>
          ) : p.image}
        </motion.div>
        <motion.div layoutId={`plus-${p.id}`} transition={{ duration: 0.34, ease: [0.32, 0.72, 0, 1] }}
          onClick={e => { e.stopPropagation(); setActionProduct(p); }}
          whileTap={{ scale: 0.82 }}
          style={{ position: "absolute", right: 10, bottom: 10, width: 36, height: 36, borderRadius: 18, background: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(255,92,0,0.4)", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
          <Plus size={19} color="#fff" strokeWidth={2.6} />
        </motion.div>
      </div>
      <div style={{ padding: "11px 13px 13px" }}>
        <div style={{ fontSize: 11.5, color: "#A8A5A0", marginBottom: 3 }}>{p.platform}</div>
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

  // Fabriek-kaart = volledige telefoon-breedte, één per rij (verticaal scrollen).
  // Etalage-collage: 1 grote + 2 kleine product-foto's → je ziet meteen wat de fabriek maakt.
  const factoryCardEl = (f) => {
    const dia = Math.max(0, Math.min(4, Number(f.diamonds) || 0));
    const stats = [
      { label: "Repurchase rate", v: f.repurchase },
      { label: "Service score", v: f.service },
      { label: "On-time delivery", v: f.ontime },
      { label: "Positive reviews", v: f.reviews },
    ].filter(s => s.v);
    const pv = (f.previews && f.previews.length) ? f.previews : (f.cover ? [f.cover] : []);
    const extra = Math.max(0, (f.count || 0) - 3);
    const imgBox = (src, big) => (
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, background: "#ECE8E0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: big ? 44 : 26, overflow: "hidden" }}>
        {src ? <img src={src} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : "🏭"}
      </div>
    );
    return (
      <motion.div key={f.id} layout layoutId={`factory-${f.id}`} className={activeGroup ? "ff-glow" : ""}
        initial={{ opacity: 0, scale: 0.96, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.16, ease: [0.32, 0.72, 0, 1] } }}
        onClick={() => { feedScrollRef.current = window.scrollY; setSelectedFactory(f); setSearch(""); setActiveCategory("All"); setActiveSub(null); window.scrollTo(0, 0); }}
        whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }}
        transition={springMorph}
        style={{ background: "#fff", borderRadius: 20, overflow: "hidden", boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 8px 22px rgba(17,17,17,0.06)", cursor: "pointer" }}>
        <div style={{ position: "relative", display: "flex", gap: 2, aspectRatio: "5 / 4", overflow: "hidden" }}>
          {imgBox(pv[0], true)}
          {pv.length >= 2 && (
            <div style={{ flex: 0.62, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              {imgBox(pv[1])}
              {pv.length >= 3 && (
                <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex" }}>
                  {imgBox(pv[2])}
                  {extra > 0 && (
                    <div style={{ position: "absolute", right: 6, bottom: 6, background: "rgba(17,17,17,0.74)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 12 }}>+{extra} more</div>
                  )}
                </div>
              )}
            </div>
          )}
          {dia >= 1 && (
            <div style={{ position: "absolute", top: 11, left: 11, background: "rgba(17,17,17,0.82)", borderRadius: 20, padding: "3px 9px", fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>
              {"💎".repeat(dia)}
            </div>
          )}
        </div>
        <div style={{ padding: "13px 15px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: "#111111", lineHeight: 1.3 }}>{f.name}</div>
            <div style={{ fontSize: 12, color: "#A8A5A0", whiteSpace: "nowrap" }}>{f.count} product{f.count === 1 ? "" : "s"} ›</div>
          </div>
          {stats.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 11 }}>
              {stats.map(s => (
                <div key={s.label} style={{ background: "#F6F4EF", borderRadius: 10, padding: "7px 10px" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#FF5C00", lineHeight: 1.1 }}>{s.v}</div>
                  <div style={{ fontSize: 10, color: "#8A8780", lineHeight: 1.25, marginTop: 2 }}>{s.label}</div>
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

      <GroupModeGlow key={activeGroup?.id || "none"} active={activeGroupShopping} dimmed={!!(selectedProduct || showRequestList || showFriends || showNotifs || showVable)} />
      {/* Header */}
      <div style={{ padding: "16px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#111111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, boxShadow: activeGroup ? "0 0 0 2px rgba(255,92,0,0.6)" : "none", transition: "box-shadow .3s", flexShrink: 0 }}><Fox /></div>
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
                    <div style={{ padding: "20px 14px", textAlign: "center", fontSize: 13, color: "#aaa" }}><Fox /> No new notifications</div>
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

      {/* Warehouse-banner verwijderd — de warehouse-melding leeft nu in het belletje + het Warehouse-nav-badge. */}

      {/* Tab-inhoud met vloeiende overgangen */}
      <AnimatePresence mode="wait" initial={false}>

      {/* FEED TAB */}
      {tab === "feed" && (
        <motion.div key="feed" {...pageTransition} style={{ padding: "10px 20px 80px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6, color: "#111111", marginBottom: 2 }}>{showFavoritesOnly ? "Favorites" : selectedFactory ? selectedFactory.name : <>Factory <span style={{ color: "#FF5C00" }}>Feed</span></>}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <motion.button whileTap={{ scale: 0.85 }} transition={springSnappy} onClick={() => setShowPricing(true)} aria-label="How pricing works"
                style={{ width: 42, height: 42, borderRadius: "50%", background: "#fff", border: "1px solid #ECEAE5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18, lineHeight: 1, WebkitTapHighlightColor: "transparent" }}>
                💸
              </motion.button>
              <motion.button whileTap={{ scale: 0.85 }} transition={springSnappy} onClick={() => window.open("/diamond-rankings.html", "_blank")} aria-label="How diamond rankings work"
                style={{ width: 42, height: 42, borderRadius: "50%", background: "#fff", border: "1px solid #ECEAE5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18, lineHeight: 1, WebkitTapHighlightColor: "transparent" }}>
                💎
              </motion.button>
              <motion.button whileTap={{ scale: 0.85 }} transition={springSnappy} onClick={() => setShowFavoritesOnly((v) => !v)} aria-label="favorites"
                style={{ width: 42, height: 42, borderRadius: "50%", background: showFavoritesOnly ? "#FF5C00" : "#fff", border: "1px solid #ECEAE5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Star size={19} color={showFavoritesOnly ? "#fff" : "#111111"} fill={showFavoritesOnly ? "#fff" : "none"} strokeWidth={2} />
              </motion.button>
              <motion.button whileTap={{ scale: 0.85 }} transition={springSnappy} onClick={() => setShowVable(true)} aria-label="VABLE — our brand"
                style={{ width: 42, height: 42, borderRadius: "50%", background: "#111111", border: "1px solid #111111", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                <img src="/vable-phoenix.svg" alt="VABLE" style={{ width: 26, height: 26, filter: "brightness(0) invert(1)" }} />
              </motion.button>
            </div>
          </div>
          <div style={{ fontSize: 13.5, color: "#8A8780", marginBottom: 16 }}>{showFavoritesOnly ? "Your starred products." : selectedFactory ? "Curated products from this factory." : "Tap a factory to explore its products."}</div>

          {/* Terug-knop bij drill-in — duidelijke pill */}
          {selectedFactory && !showFavoritesOnly && (
            // Shape-morph: deelt dezelfde layoutId als de aangetikte fabriekskaart, dus
            // Framer krimpt de grote kaart soepel ineen tot deze pill (en terug bij 'back').
            // Het label faadt met een mini-delay in zodat je tijdens het krimpen geen
            // meegeschaalde, vervormde tekst ziet.
            <motion.div
              layout
              layoutId={`factory-${selectedFactory.id}`}
              transition={springMorph}
              whileTap={{ scale: 0.96 }}
              onClick={() => { setSelectedFactory(null); setSearch(""); setActiveCategory("All"); setActiveSub(null); }}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 16, cursor: "pointer", color: "#111", fontSize: 14, fontWeight: 700, background: "#fff", border: "1px solid #E4E1DA", borderRadius: 22, padding: "9px 16px 9px 12px", boxShadow: "0 1px 2px rgba(17,17,17,0.05), 0 4px 12px rgba(17,17,17,0.05)", WebkitTapHighlightColor: "transparent", overflow: "hidden", whiteSpace: "nowrap" }}>
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.2 }} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 19, lineHeight: 1, marginTop: -2 }}>‹</span> All factories
              </motion.span>
            </motion.div>
          )}
          {/* === BODY: smooth fade+slide bij wisselen feed ↔ fabriek ↔ favorieten === */}
          <motion.div
            key={showFavoritesOnly ? "favs" : selectedFactory ? `fac-${selectedFactory.id}` : "factory-list"}
            initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.34, ease: [0.22, 0.61, 0.36, 1] }}>
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
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
                  <AnimatePresence mode="popLayout" initial={false}>
                    {factoryCards.map(factoryCardEl)}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}
          </motion.div>
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
                    groupSize={items[0]?.ff_group_id ? (myGroups.find((g) => g.group_id === items[0].ff_group_id)?.member_count || null) : null}
                    onOpenItem={(o) => { setSelectedOrder(o); setConfirmCancel(false); }} />
                ));
            })()}
            {activeGroup && groupOrders.filter((o) => o.user_id !== session.user.id).length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 11, color: "#A8A5A0", fontWeight: 600, letterSpacing: 0.4, margin: "0 2px 8px" }}>SQUAD · {activeGroup.name}</div>
                {(() => {
                  const others = groupOrders.filter((o) => o.user_id !== session.user.id);
                  const byMember = others.reduce((acc, o) => { (acc[o.user_id] = acc[o.user_id] || []).push(o); return acc; }, {});
                  return Object.values(byMember).map((memberOrders) => {
                    const m0 = memberOrders[0];
                    return (
                      <div key={m0.user_id} style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 6px" }}>
                          <div style={{ width: 22, height: 22, borderRadius: "50%", overflow: "hidden", background: "#0F0E0C", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {m0.avatar_url ? <img src={m0.avatar_url} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{(m0.member || "?").charAt(0).toUpperCase()}</span>}
                          </div>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0F0E0C" }}>{m0.member}</div>
                        </div>
                        <div style={{ background: "#fff", borderRadius: 16, padding: "4px 14px", boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)" }}>
                          {memberOrders.map((o, i, arr) => {
                            const s = statusConfig[o.status] || {};
                            return (
                              <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: i < arr.length - 1 ? "1px solid #F0EEE8" : "none" }}>
                                <div style={{ width: 38, height: 38, borderRadius: 9, background: "#F3F1ED", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  {o.variant_image ? <img src={o.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 17 }}>📦</span>}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: "#111111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.product_title}</div>
                                  <div style={{ display: "inline-block", marginTop: 3, background: s.bg || "#F3F1ED", color: s.color || "#6B6862", fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20 }}>{statusLabel(o)}</div>
                                </div>
                                <motion.div whileTap={{ scale: 0.85 }} onClick={() => setSquadWheel(o)} title="Tap for progress" style={{ flexShrink: 0, cursor: "pointer" }}>
                                  <ProgressRing percent={productProgress(o)} />
                                </motion.div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  });
                })()}
                <div style={{ fontSize: 11, color: "#A8A5A0", margin: "2px 2px 0", lineHeight: 1.4 }}>👀 Your squad's order statuses — view only. You're only notified about your own items.</div>
              </div>
            )}
            {visibleOrders.filter(matchesFilter).length === 0 && !(activeGroup && groupOrders.some((o) => o.user_id !== session.user.id)) && (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#aaa" }}>
                <div style={{ position: "relative", display: "inline-block", fontSize: 48, marginBottom: 12, lineHeight: 1 }}>
                  <Fox />
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

          {/* Door BuckyDrop gemeld defect: stuur de klant naar de warehouse om te kiezen (retour/accept). */}
          {selectedOrder.dispute_status === "bucky_flagged" && (
            <div style={{ background: "#FFF7ED", border: "1.5px solid #F59E0B", borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#B45309", marginBottom: 4 }}>⚠️ Quality-control flagged a possible defect</div>
              <div style={{ fontSize: 13, color: "#92400E", lineHeight: 1.5, marginBottom: 12 }}>Our warehouse spotted something off with your item. Review the photos and choose to return it for a full refund or accept it as-is.</div>
              <button onClick={() => { setSelectedOrder(null); setTab("warehouse"); }} style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                Review in your warehouse →
              </button>
            </div>
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
            const fmMsg = qcArrived(selectedOrder)
              ? "Arrived at our warehouse! The quality-control photos are being prepared."
              : fm?.msg;
            return fm ? (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, background: "#111111", borderRadius: 18, padding: "15px 16px", marginBottom: 16 }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}><Fox /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#FF5C00", marginBottom: 4 }}>{statusLabel(selectedOrder)}</div>
                  <div style={{ fontSize: 13, color: "#C9C6C1", lineHeight: 1.55 }}>
                    <WordReveal key={selectedOrder.status} text={fmMsg} stagger={0.025} />
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
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0F0E0C", marginBottom: 12 }}>Quality-control pictures</div>
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
          {(selectedOrder.status === "shipped_international" || selectedOrder.status === "delivered") && (selectedOrder.qc_images?.length > 0 || selectedOrder.measurement_images?.length > 0) && (
            <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: "16px", marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>Recorded condition <span style={{ fontSize: 11, fontWeight: 500, color: "#A8A5A0" }}>· kept for returns</span></div>
              <div style={{ fontSize: 12, color: "#8A8780", lineHeight: 1.5, marginBottom: 12 }}>
                These quality-control &amp; measurement photos are the documented condition of your item before it shipped — we keep them as the record if you request a return or withdrawal. For a change of mind the international shipping isn't refunded; a faulty item is on us. See our <a href="/returns-policy" target="_blank" rel="noreferrer" style={{ color: "#FF5C00" }}>Returns policy</a>.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                {[...(selectedOrder.qc_images || []), ...(selectedOrder.measurement_images || [])].map((url, i) => (
                  <div key={i} style={{ borderRadius: 10, overflow: "hidden", aspectRatio: "1", background: "#F3F1ED" }}>
                    <img src={url} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <CustomerChat order={selectedOrder} session={session} />
        </motion.div>
      )}

      {/* WAREHOUSE TAB */}
      {tab === "warehouse" && (
        <motion.div key="warehouse" {...pageTransition}>
          <WarehouseTab session={session} haulItems={haulItems} setHaulItems={setHaulItems} activeGroupId={activeGroup?.id || null} groupOrders={groupOrders} />
        </motion.div>
      )}

      {/* TRANSIT TAB */}
      {tab === "transit" && (
        <motion.div key="transit" {...pageTransition}>
          <TransitTab session={session} orders={orders} activeGroupId={activeGroup?.id || null} />
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
                {avatarUrl ? <img src={avatarUrl} alt="profile photo" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Fox />}
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
            <label style={{ display: "flex", alignItems: "flex-start", gap: 9, margin: "2px 2px 10px", cursor: "pointer", fontSize: 11, color: "#8A8780", lineHeight: 1.5 }}>
              <input type="checkbox" checked={topupAgreed} onChange={e => setTopupAgreed(e.target.checked)} style={{ marginTop: 1, accentColor: "#FF5C00", width: 16, height: 16, flexShrink: 0 }} />
              <span>I agree to the <a href="/terms" target="_blank" rel="noreferrer" style={{ color: "#FF5C00" }}>Terms</a>, and that my balance is prepayment for Flowva orders and that any refunds are credited back to my balance.</span>
            </label>
            <button onClick={handleTopup} disabled={loadingBalance || !topupAmount || !topupAgreed}
              style={{ width: "100%", background: loadingBalance || !topupAmount || !topupAgreed ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700, cursor: loadingBalance || !topupAmount || !topupAgreed ? "default" : "pointer" }}>
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
                  <div style={{ width: 38, height: 38, borderRadius: 11, background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}><Fox /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C" }}>Flowva Friends</div>
                    <div style={{ fontSize: 12, color: "#A8A5A0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeGroup ? ((myGroups.find((g) => g.group_id === activeGroup.id)?.status || "gathering") === "gathering" ? `Shopping for ${activeGroup.name}` : `Following ${activeGroup.name}`) : "Order together — select a group to activate"}</div>
                  </div>
                  <div onClick={onToggle} role="switch" aria-checked={!!activeGroup}
                    style={{ width: 48, height: 28, borderRadius: 999, background: activeGroup ? "#FF5C00" : "#E3E1DC", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background .25s" }}>
                    <motion.div animate={{ x: activeGroup ? 20 : shakeGroups ? 9 : 0 }} transition={springBouncy}
                      style={{ position: "absolute", top: 3, left: 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
                  </div>
                </div>
                {gathering.length > 0 && (
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
                            <div style={{ width: 30, height: 30, borderRadius: 9, background: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}><Fox /></div>
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
                  </>
                )}
                {(() => {
                  // Groepen waarin de bestelling al geplaatst is (niet meer 'gathering') —
                  // niet selecteerbaar om in te shoppen, wél tikbaar om te openen/volgen.
                  const placed = myGroups.filter((g) => g.status !== "gathering");
                  if (placed.length === 0) return null;
                  return (
                    <>
                      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12 }}>
                        {placed.map((g) => {
                          const live = activeGroup && activeGroup.id === g.group_id;
                          return (
                          <div key={g.group_id} onClick={() => setActiveGroup(live ? null : { id: g.group_id, name: g.name })}
                            style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", borderRadius: 12, padding: "10px 12px", background: live ? "#F1FBF4" : "#F8F7F4", border: `1.5px solid ${live ? "rgba(22,163,74,0.5)" : "#ECEAE5"}` }}>
                            <div style={{ width: 30, height: 30, borderRadius: 9, background: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}><Fox /></div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "#111111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}{g.role === "admin" ? " · admin" : ""}</div>
                              <div style={{ fontSize: 11, color: "#A8A5A0" }}>{g.member_count}/{g.max_size} friends{live ? " · following" : ""}</div>
                            </div>
                            <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${live ? "#16A34A" : "#D4D2CC"}`, flexShrink: 0, position: "relative" }}>
                              {live && <div style={{ position: "absolute", inset: 3, borderRadius: "50%", background: "#16A34A" }} />}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                      {activeGroup && placed.some((g) => g.group_id === activeGroup.id) && (
                        <button onClick={() => { setFriendsGroupId(activeGroup.id); setShowFriends(true); }}
                          style={{ background: "transparent", border: "none", color: "#16A34A", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "8px 0 0", textAlign: "left" }}>Open group &amp; see details →</button>
                      )}
                    </>
                  );
                })()}
                <button onClick={() => { setFriendsJoinCode(null); setShowFriends(true); }}
                  style={{ width: "100%", marginTop: 12, background: "#FFF0E7", border: "1px dashed rgba(255,92,0,0.4)", color: "#FF5C00", borderRadius: 12, padding: "12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Create, join or manage groups</button>
              </div>
            );
          })()}
          <PushToggle session={session} />
          <motion.div whileTap={{ scale: 0.98 }} onClick={() => setShowHowItWorks(true)}
            style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "15px 18px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}><Fox /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C" }}>How Flowva works</div>
              <div style={{ fontSize: 12, color: "#A8A5A0" }}>Prices, fees, shipping & the haul model</div>
            </div>
            <div style={{ color: "#C9C6C1", fontSize: 18 }}>→</div>
          </motion.div>
          <motion.div whileTap={{ scale: 0.98 }} onClick={() => setShowPricing(true)}
            style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "15px 18px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>💸</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C" }}>How pricing works</div>
              <div style={{ fontSize: 12, color: "#A8A5A0" }}>Every fee, and exactly who gets paid</div>
            </div>
            <div style={{ color: "#C9C6C1", fontSize: 18 }}>→</div>
          </motion.div>
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

          <div style={{ display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap", marginTop: 20 }}>
            <a href="/terms" style={{ fontSize: 11.5, color: "#A8A5A0", textDecoration: "none" }}>Terms</a>
            <span style={{ fontSize: 11.5, color: "#D4D1CA" }}>·</span>
            <a href="/privacy" style={{ fontSize: 11.5, color: "#A8A5A0", textDecoration: "none" }}>Privacy</a>
            <span style={{ fontSize: 11.5, color: "#D4D1CA" }}>·</span>
            <a href="/returns-policy" style={{ fontSize: 11.5, color: "#A8A5A0", textDecoration: "none" }}>Returns</a>
          </div>
          <div style={{ textAlign: "center", fontSize: 10.5, color: "#C9C6C1", marginTop: 8 }}>© Flowva</div>
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
            activeGroup={activeGroupShopping ? activeGroup : null} onActiveGroupGone={() => setActiveGroup(null)} />
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
              <div style={{ position: "relative", width: "100%", aspectRatio: "1080 / 1934", background: "#0b101d", overflow: "hidden" }}>
                <video src="/vable/hero.mp4" poster="/vable/hero-poster.jpg" autoPlay loop muted playsInline preload="auto"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0) 16%)" }} />
                <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", width: 38, height: 4, background: "rgba(255,255,255,0.6)", borderRadius: 2, zIndex: 3 }} />
                <button onClick={() => setShowVable(false)} aria-label="close" style={{ position: "absolute", top: 12, right: 12, background: "rgba(0,0,0,0.4)", border: "none", borderRadius: 999, width: 30, height: 30, fontSize: 14, color: "#fff", cursor: "pointer", zIndex: 3 }}>✕</button>
                <div style={{ position: "absolute", top: "24%", left: 18, right: 18, textAlign: "center", zIndex: 2 }}>
                  <img src="/vable-logo.svg" alt="VABLE" style={{ height: 64, width: "auto", maxWidth: "82%", filter: "brightness(0) invert(1)", marginBottom: 10 }} />
                  <div style={{ fontSize: 11, letterSpacing: 3, color: "rgba(255,255,255,0.8)", textShadow: "0 1px 8px rgba(0,0,0,0.55)", marginBottom: 14 }}>FIRST DROP 2026</div>
                  <div style={{ fontSize: 40, fontWeight: 800, color: "#fff", lineHeight: 1.0, letterSpacing: -1, textShadow: "0 2px 16px rgba(0,0,0,0.5)" }}>Wearable Art.</div>
                  <div style={{ fontSize: 14, color: "rgba(255,255,255,0.88)", marginTop: 12, textShadow: "0 1px 10px rgba(0,0,0,0.55)" }}>Embroidery elevated — inspired by Japan.</div>
                </div>
              </div>
              <div style={{ padding: "14px 20px 40px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 2 }}>Shop the First Drop</div>
              <div style={{ fontSize: 12, color: "#8A8780", marginBottom: 14 }}>Japanese-embroidered denim — our own brand.</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {VABLE_ITEMS.map((it, i) => (
                  <a key={i} href={it.url || VABLE_URL} target="_blank" rel="noreferrer" style={{ textDecoration: "none", borderRadius: 16, overflow: "hidden", background: "#fff", border: "1px solid #F0EEE8", display: "block" }}>
                    <div style={{ aspectRatio: "4 / 5", background: it.bg, overflow: "hidden" }}>
                      <img src={it.img} alt={it.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </div>
                    <div style={{ padding: "10px 11px 12px" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#111" }}>{it.name}</div>
                      <div style={{ fontSize: 12, color: "#6B6863", marginTop: 2 }}>{it.price}</div>
                    </div>
                  </a>
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
        {activeGroupShopping && tab === "feed" && !selectedProduct && !showFriends && !showRequestList && !showVable && (
          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0, scale: 0.96 }} whileTap={{ scale: 0.97 }} transition={springMorph}
            onClick={() => { setFriendsGroupId(activeGroup.id); setShowFriends(true); }}
            style={{ position: "fixed", bottom: 78, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 40px)", maxWidth: 390, background: "#111111", borderRadius: 16, overflow: "hidden", cursor: "pointer", zIndex: 301, boxShadow: "0 12px 40px rgba(255,92,0,0.28)", border: "1px solid rgba(255,92,0,0.4)" }}>
            <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 18 }}><Fox /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeGroup.name} · group cart</div>
                <div style={{ fontSize: 11.5, color: "#9C9893" }}>Tap to open your squad <Fox /></div>
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
        {/* Geplaatste/gevolgde groep: maak glashelder dat de groep op slot zit en je nu solo winkelt. */}
        {activeGroup && !activeGroupShopping && tab === "feed" && !selectedProduct && !showFriends && !showRequestList && requestList.length === 0 && !showVable && (
          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={springMorph}
            onClick={() => { setFriendsGroupId(activeGroup.id); setShowFriends(true); }}
            style={{ position: "fixed", bottom: 78, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 40px)", maxWidth: 390, background: "#111111", borderRadius: 16, overflow: "hidden", cursor: "pointer", zIndex: 301, boxShadow: "0 12px 40px rgba(17,17,17,0.35)", border: "1px solid rgba(52,209,123,0.35)" }}>
            <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 18 }}>📦</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeGroup.name} · order placed</div>
                <div style={{ fontSize: 11.5, color: "#9C9893" }}>Group locked — you're shopping on your own now <Fox /></div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setActiveGroup(null); }} aria-label="stop following"
                style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#9C9893", fontSize: 11, fontWeight: 700, padding: "6px 11px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>Shop solo ✓</button>
            </div>
          </motion.div>
        )}
        {requestList.length > 0 && tab === "feed" && !showRequestList && !selectedProduct && !showFriends && !activeGroupShopping && !showVable && (
          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0, scale: 0.96 }} whileTap={{ scale: 0.97 }} transition={springMorph}
            onClick={() => { setListError(null); setShowRequestList(true); }}
            style={{ position: "fixed", bottom: 78, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 40px)", maxWidth: 390, background: "#111111", borderRadius: 16, overflow: "hidden", cursor: "pointer", zIndex: 301, boxShadow: "0 12px 40px rgba(17,17,17,0.35)" }}>
            <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 18 }}>📋</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Shopping cart · {requestList.length} item{requestList.length > 1 ? "s" : ""}</div>
                <div style={{ fontSize: 11.5, color: "#9C9893" }}>Tap to open — one service fee <Fox /></div>
              </div>
              <motion.div animate={{ y: [0, -3, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,92,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ChevronUp size={16} color="#FF5C00" strokeWidth={2.5} />
              </motion.div>
            </div>
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
                <motion.span layoutId="cart-fox" style={{ fontSize: 56, display: "inline-block", marginBottom: 16 }}><Fox /></motion.span>
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
              <motion.div layoutId={`plus-${actionProduct.id}`} transition={{ duration: 0.34, ease: [0.32, 0.72, 0, 1] }}
                style={{ width: 248, background: "#FF5C00", borderRadius: 20, overflow: "hidden", pointerEvents: "all", boxShadow: "0 24px 80px rgba(17,17,17,0.3)" }}>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.22, duration: 0.18 } }} exit={{ opacity: 0, transition: { duration: 0.07 } }}>
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
        {showPricing && <PricingSheet onClose={() => setShowPricing(false)} />}
        {squadWheel && <ProgressWheelModal items={[squadWheel]} onClose={() => setSquadWheel(null)} />}
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
                  return <div style={{ textAlign: "center", padding: "24px 0", color: "#aaa", fontSize: 13 }}><Fox /> No subcategories yet — they appear as products are added.</div>;
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
