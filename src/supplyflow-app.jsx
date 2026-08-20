import { useState, useEffect, useRef, useLayoutEffect, useMemo } from "react";

// #12 — idempotentie-token voor pay_cart (module-scope: één cart per tab). Stabiel per
// poging; pas roteren NA een ontvangen server-antwoord, zodat een reclick na netwerk-
// verlies hetzelfde resultaat terugkrijgt i.p.v. dubbel af te rekenen.
let _cartPayToken = null;
const cartPayToken = () => (_cartPayToken ||= (globalThis.crypto?.randomUUID?.() || `cp-${Date.now()}-${Math.random().toString(36).slice(2)}`));
const rotateCartPayToken = () => { _cartPayToken = null; };
import { supabase, invokeAsUser, functionErrorMessage } from "./supabase";
import { EU_COUNTRIES, normalizeCountry, EU_PROVINCES, isValidPostcode, POSTCODE_EXAMPLE } from "./countries";
import OrderRequest from "./OrderRequest";
import Friends from "./Friends";
import GroupModeGlow from "./GroupModeGlow";
import { ffMyGroups } from "./ffApi";
import { garmentType } from "./garment";
import { TransitTab, ParcelSection } from "./WarehouseAndHaul";
import { motion, AnimatePresence, useDragControls, useMotionValue, useTransform, useSpring } from "framer-motion";
import { createPortal } from "react-dom";
import { springSnappy, springSoft, springBouncy, springMorph } from "./motion";
import { Search, SlidersHorizontal, Bell, Home, Package, Factory, User, Users, ShoppingBag, Eye, Star, Plus, X, Plane, CreditCard, PackageCheck, Truck, Camera, ChevronUp, ChevronDown } from "lucide-react";
import { WordReveal, SpeechBubble, CartGrower, FoldReveal } from "./MotionBits";
import ReviewPage from "./ReviewPage";
import { problemTypes } from "./problemTypes";
import { toChinese, toEnglish, hasChinese } from "./translate";
import { serviceFee } from "./fees";
import { exactTopUp, startTopUp, TOPUP_MIN } from "./topup";
import PushToggle from "./PushToggle";
import Fox from "./Fox";
import Auth from "./Auth";
import HypeCheckSheet from "./HypeCheck";
import { getVoteStats, getMyVotes } from "./votes";
import { CountUp, ConfettiBurst, FlyingImage, useBodyScrollLock } from "./DelightBits";
import { tr, useTr, useLang, useLangVersion, LANGS, hasChosenLang } from "./i18n";
import { track } from "./track";

// —— PREVIEW / LAUNCH-GATE —————————————————————————————————————————————
// Tot de officiële launch (Stripe live) kan er nog niet betaald worden. Zolang
// PRELAUNCH=true wordt de iDEAL-opwaardeerknop vervangen door een launch-datum-
// melding, zodat bezoekers wél kunnen browsen/hun mand vullen maar niet tegen een
// dode betaalflow lopen. Zet PRELAUNCH op false zodra betalingen live zijn.
const PRELAUNCH = false;
const LAUNCH_DATE_LABEL = "soon";

// Overgang tussen tabs/schermen: zacht in-/uitschuiven (Apple-stijl).
const pageTransition = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
  transition: { type: "spring", stiffness: 320, damping: 32, mass: 0.8 },
};

// Categorieën + subcategorieën worden nu dynamisch uit de producten afgeleid.

// Labels als key + Engels bewaren (NIET tr() op module-scope aanroepen — dat zou bij
// import in het Engels "bevriezen" voor first-timers die mid-sessie een taal kiezen).
// Vertalen gebeurt op leestijd via statusLabel().
const statusConfig = {
  // requested/quote_sent bestaan niet meer in de flow (direct kopen) — blijven
  // als vangnet voor eventuele oude orders, tonen als "Order placed".
  // BuckyDrop meldt alléén "Stock-in Success" (aankomst magazijn) — tussenstatussen
  // (bought/shipped_local) komen nooit vanzelf binnen. Klant ziet dus 2 statussen:
  // "Order placed" (alles vóór aankomst) en "In warehouse". De DB-statussen blijven
  // bestaan als vangnet; ze tonen allemaal als "Order placed".
  requested:            { labelKey: "orders.checkpoint.orderPlaced", label: "Order placed",                color: "#0369A1", bg: "#E0F2FE", step: 0 },
  quote_sent:           { labelKey: "orders.checkpoint.orderPlaced", label: "Order placed",                color: "#0369A1", bg: "#E0F2FE", step: 0 },
  quote_accepted:       { labelKey: "orders.checkpoint.orderPlaced", label: "Order placed",                color: "#0369A1", bg: "#E0F2FE", step: 0 },
  purchased:            { labelKey: "orders.checkpoint.orderPlaced", label: "Order placed",                color: "#0369A1", bg: "#E0F2FE", step: 0 },
  bought:               { labelKey: "orders.checkpoint.orderPlaced", label: "Order placed",                color: "#0369A1", bg: "#E0F2FE", step: 1 },
  shipped_local:        { labelKey: "orders.checkpoint.orderPlaced", label: "Order placed",                color: "#0369A1", bg: "#E0F2FE", step: 2 },
  qc_pending:           { labelKey: "orders.status.qcPending", label: "In warehouse",          color: "#065F46", bg: "#D1FAE5", step: 3 },
  shipped_international: { labelKey: "orders.status.inTransit", label: "In transit",                 color: "#0369A1", bg: "#E0F2FE", step: 4 },
  delivered:            { labelKey: "orders.status.delivered", label: "Delivered",                   color: "#15803D", bg: "#DCFCE7", step: 5 },
  // Dag 91+ zonder verzending (user 2026-07-22): verbeurd — grijs, blijft zichtbaar in de
  // orderlijst én het pakket (telt daar niet mee); detail via het Flowva support-bericht.
  forfeited:            { labelKey: "orders.status.forfeited", label: "Item forfeited",              color: "#6B7280", bg: "#F3F4F6", step: 3 },
};

// Opslag-dag (user 2026-07-22): KALENDERDAGEN op de klok van de klant (NL) — de dag van
// aankomst in het magazijn is dag 1, en elke middernacht telt er één bij. Dus dag 30 is
// nog een volle gratis dag; ná middernacht wordt het dag 31 (= fee), dag 91 = verbeurd.
export const storageDayOf = (ts) => {
  if (!ts) return null;
  const a = new Date(ts); const n = new Date();
  return Math.floor((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000) + 1;
};

// Labels van de tracking-bolletjes — index = statusConfig[...].step.
// De order-reis stopt bij het magazijn (arrived & quality-control). De internationale
// verzending + levering wordt op PAKKET-niveau in de In transit-tab gevolgd (hauls/trace_status),
// niet als order-status — dus 'Shipped to you'/'Delivered' horen hier bewust NIET.
const trackingSteps = [
  { key: "orders.checkpoint.orderPlaced", en: "Order placed" },
  { key: "orders.status.qcPending", en: "In warehouse" },
];

// msg als key + Engels (zie statusConfig); vertaald op leestijd bij het tonen.
const foxMessages = {
  requested:            { msgKey: "orders.fox.requested", msg: "We've placed your order — the agent is purchasing it for you right now.", icon: "🛒" },
  quote_sent:           { msgKey: "orders.fox.requested", msg: "We've placed your order — the agent is purchasing it for you right now.", icon: "🛒" },
  quote_accepted:       { msgKey: "orders.fox.requested", msg: "We've placed your order — the agent is purchasing it for you right now.", icon: "🛒" },
  purchased:            { msgKey: "orders.fox.requested", msg: "We've placed your order — the agent is purchasing it for you right now.", icon: "🛒" },
  bought:               { msgKey: "orders.fox.requested", msg: "We've placed your order — the agent is purchasing it for you right now.", icon: "🛒" },
  shipped_local:        { msgKey: "orders.fox.requested", msg: "We've placed your order — the agent is purchasing it for you right now.", icon: "🛒" },
  qc_pending:           { msgKey: "orders.fox.qcPending", msg: "Arrived & inspected! View the photos — it's in your parcel, ready to ship whenever you are.", icon: "🏭" },
  shipped_international: { msgKey: "orders.fox.shippedInternational", msg: "Your item shipped in a parcel — follow its journey in the In transit tab.", icon: "✈️" },
  delivered:            { msgKey: "orders.fox.delivered", msg: "Delivered — your parcel arrived! 🎉 See the full timeline in In transit.", icon: "🎉" },
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

// Reis-in-China: de 4 fasen die je order in China doorloopt (bestelling → magazijn).
// Tik op een checkpoint om je orders op die fase te filteren. De internationale
// verzending + levering zit bewust NIET hier — dat is de In transit-tab.
const journeyStops = [
  { key: "purchased", labelKey: "orders.checkpoint.orderPlaced", label: "Order placed", Icon: ShoppingBag, statuses: ["requested", "quote_sent", "quote_accepted", "purchased", "bought", "shipped_local"] },
  { key: "qc_pending", labelKey: "orders.status.qcPending", label: "In warehouse", Icon: Factory, statuses: ["qc_pending"] },
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

// Voortgang per product — 2 fasen (BuckyDrop meldt alleen de aankomst in het magazijn):
// 50 = Order placed (besteld, onderweg naar het magazijn) · 100 = In warehouse.
const QC_FULL_STEP = statusConfig.qc_pending.step;
function productProgress(o) {
  const status = typeof o === "string" ? o : o?.status;
  const step = statusConfig[status]?.step ?? 0;
  return step >= QC_FULL_STEP ? 100 : 50;   // in warehouse (of verder) · anders onderweg
}
function statusLabel(o) {
  const status = typeof o === "string" ? o : o?.status;
  const cfg = statusConfig[status] || statusConfig.purchased;
  return tr(cfg.labelKey, cfg.label);
}
const PRODUCT_COLORS = ["#FF5C00", "#6366F1", "#16A34A", "#EAB308", "#EC4899"];

// Tik op de ring → groot voortgangswiel: elk product een concentrische boog die
// zich vult richting QC (= vol). Mijlpaal-streepjes tonen waar het % op slaat.
function ProgressWheelModal({ items, onClose, onOpenItem, refundedItems = [] }) {
  const scrollable = items.length > 8;
  const bars = items;
  const listRef = useRef(null);
  const [maxH, setMaxH] = useState(null);
  const [seen, setSeen] = useState(8); // hoeveel items hun balkje al lieten zien (high-water)
  const overall = Math.round(items.reduce((s, o) => s + productProgress(o), 0) / items.length);
  // Hoogte = precies 8 volledige items (incl. balkje), zodat het 8ste nooit half afgekapt is.
  // offsetTop/offsetHeight = layout-maat → niet vervormd door de scale-animatie van de modal.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!scrollable || !el || el.children.length <= 8) { setMaxH(null); return; }
    const h = (el.children[7].offsetTop - el.children[0].offsetTop) + el.children[7].offsetHeight + 2;
    setMaxH(h);
  }, [scrollable, items.length]);
  // Bij scrollen: tel hoeveel balkjes al zichtbaar wáren. Bovenste items die wegscrollen
  // blijven meetellen (we nemen het maximum), dus +X telt alleen nog wat je écht nog niet zag.
  const onListScroll = () => {
    const el = listRef.current; if (!el) return;
    const vb = el.getBoundingClientRect().bottom;
    let revealed = 0;
    for (const k of el.children) { if (k.getBoundingClientRect().bottom <= vb + 4) revealed++; }
    setSeen((s) => Math.max(s, revealed));
  };
  const milestones = [
    { pct: 50, label: tr("orders.checkpoint.orderPlaced", "Order placed") },
    { pct: 100, label: tr("orders.status.qcPending", "In warehouse") },
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
            <div style={{ fontSize: 15, fontWeight: 800, color: "#111" }}>{tr("orders.progress.title", "Order progress")}</div>
            <motion.button whileTap={{ scale: 0.9 }} onClick={onClose} style={{ background: "#F3F1ED", border: "none", borderRadius: 999, width: 30, height: 30, fontSize: 15, color: "#777", cursor: "pointer", lineHeight: 1 }}>✕</motion.button>
          </div>
          <div style={{ height: 14 }} />
          {/* Eén staaf per item — eigen kleur, met foto + titel */}
          <div ref={listRef} onScroll={onListScroll} style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: scrollable ? (maxH ? `min(${maxH}px, 72vh)` : "min(444px, 72vh)") : "none", overflowY: scrollable ? "auto" : "visible", WebkitOverflowScrolling: "touch", paddingRight: scrollable ? 6 : 0 }}>
            {bars.map((o, i) => {
              const pct = productProgress(o);
              const color = PRODUCT_COLORS[i % PRODUCT_COLORS.length];
              return (
                <div key={o.id} onClick={onOpenItem ? () => { onClose(); onOpenItem(o); } : undefined} style={{ cursor: onOpenItem ? "pointer" : "default" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 7, background: "#fff", border: "1px solid #F0EEE8", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {o.variant_image ? <img src={o.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 14 }}>📦</span>}
                    </div>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: "#222", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.product_title || o.product}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 800, color, flexShrink: 0 }}>{pct}%</span>
                  </div>
                  <div style={{ position: "relative", height: 12, background: "#F1EFE9", borderRadius: 6, overflow: "hidden" }}>
                    {[50].map((g) => (
                      <div key={g} style={{ position: "absolute", left: `${g}%`, top: 0, bottom: 0, width: 1, background: "#fff" }} />
                    ))}
                    <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, delay: 0.06 * i, ease: "easeOut" }}
                      style={{ position: "absolute", left: 0, top: 0, bottom: 0, background: color, borderRadius: 6 }} />
                  </div>
                </div>
              );
            })}
            {/* Gerefunde items van deze aankoop (user 2026-07-22): grijs, geen balk, REFUNDED-label. */}
            {refundedItems.map((o) => (
              <div key={"ref-" + o.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, opacity: 0.75 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 7, background: "#fff", border: "1px solid #F0EEE8", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {o.variant_image ? <img src={o.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(60%)" }} /> : <span style={{ fontSize: 14 }}>📦</span>}
                  </div>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: "#8A8780", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.product_title || o.product}</span>
                  <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, color: "#15803D", background: "#DCFCE7", padding: "2px 7px", borderRadius: 6, flexShrink: 0 }}>{tr("orders.detail.badge.refunded", "REFUNDED")}</span>
                </div>
                <div style={{ position: "relative", height: 12, background: "#F1EFE9", borderRadius: 6 }} />
              </div>
            ))}
          </div>
          {scrollable && items.length - seen > 0 && (
            <div style={{ marginTop: 8, textAlign: "center", fontSize: 11.5, fontWeight: 600, color: "#A8A5A0" }}>
              {tr("orders.progress.scrollMore", "+{count} more · scroll to reveal ↓", { count: items.length - seen })}
            </div>
          )}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #F1EFE9", display: "flex", flexDirection: "column", gap: 5 }}>
            {milestones.map((m) => (
              <div key={`leg-${m.pct}`} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11 }}>
                <span style={{ width: 32, textAlign: "right", fontWeight: 800, color: "#A8A5A0", flexShrink: 0 }}>{m.pct}%</span>
                <span style={{ color: "#6B6862" }}>{m.label}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, textAlign: "center", fontSize: 11.5, color: "#9A968F" }}>{tr("orders.progress.overall", "Overall {percent}%", { percent: overall })}</div>
        </div>
      </motion.div>
    </>,
    document.body
  );
}

// 🔍 Flowva Friends — item-inspectiesheet: elk squad-/pakket-item is te openen door
// de HELE squad (product, status, gewicht, quality-control- & meetfoto's — foto's
// tikken = fullscreen). Voor je EIGEN aangekomen item staat hier de Ready-knop:
// "in de doos" gebeurt automatisch bij aankomst, maar iedereen bevestigt met Ready
// dat de foto's zijn geïnspecteerd — pas dan kan het groepspakket verzenden
// (box_staged_at via ff_stage_box; de server-gate telt alleen Ready-items).
// Bewust GEEN prijzen van andermans items (zelfde regel als de squad-kaart).
function ItemInspectSheet({ item, isOwn, onReady, onHoldOut, onClose }) {
  const [zoom, setZoom] = useState(null);      // url → fullscreen foto-viewer
  const [busy, setBusy] = useState(false);
  // Eigen exit-beheer (NIET via AnimatePresence: exit-animaties door een portal heen
  // maken de unmount onbetrouwbaar → onzichtbare backdrop bleef clicks blokkeren).
  // Vaste timeout i.p.v. onAnimationComplete: die callback bleek ook niet betrouwbaar
  // te vuren — de unmount moet gegarandeerd zijn (backdrop staat al op pointerEvents:none).
  const [leaving, setLeaving] = useState(false);
  const closeTimer = useRef(null);
  const close = () => { if (leaving) return; setLeaving(true); closeTimer.current = setTimeout(onClose, 380); };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const s = statusConfig[item.status] || statusConfig.purchased;
  const qc = Array.isArray(item.qc_images) ? item.qc_images : [];
  const meas = Array.isArray(item.measurement_images) ? item.measurement_images : [];
  const arrived = item.status === "qc_pending";
  const blocked = item.dispute_status === "pending" || item.dispute_status === "bucky_flagged" || !!item.return_status || !!item.problem_type;
  const ready = !!item.box_staged_at;
  const paid = !!item.group_shipping_paid;
  const doReady = async () => { if (busy) return; setBusy(true); await onReady?.(item); setBusy(false); };
  return createPortal(
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: leaving ? 0 : 1 }} onClick={() => (zoom ? setZoom(null) : close())}
        style={{ position: "fixed", inset: 0, background: "rgba(15,14,12,0.55)", zIndex: 420, backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)", pointerEvents: leaving ? "none" : "auto" }} />
      <motion.div initial={{ y: "104%" }} animate={{ y: leaving ? "104%" : 0 }} transition={springMorph}
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 430, background: "#FAF9F6", borderRadius: "24px 24px 0 0", zIndex: 421, maxHeight: "86vh", overflowY: "auto", overscrollBehavior: "contain", padding: "14px 18px calc(20px + env(safe-area-inset-bottom))" }}>
        <div style={{ width: 38, height: 4.5, borderRadius: 999, background: "#E3E1DB", margin: "0 auto 14px" }} />
        {/* Kop: van wie + product */}
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14 }}>
          <div style={{ width: 52, height: 52, borderRadius: 12, background: "#fff", border: "1px solid #EDEBE5", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {item.variant_image ? <img src={item.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22 }}>📦</span>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#A8A5A0" }}>
              {isOwn ? tr("inspect.yourItem", "Your item") : tr("inspect.memberItem", "{name}'s item", { name: item.member || tr("inspect.friendFallback", "Friend") })}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C", lineHeight: 1.3 }}>{item.product_title || item.product}</div>
            <div style={{ fontSize: 11.5, color: "#8A8780", marginTop: 1 }}>{tr("orders.item.pcs", "{qty} pcs", { qty: item.qty || 1 })}{item.kleur ? ` · ${item.kleur}` : ""}</div>
          </div>
        </div>
        {/* Status + gewicht */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
          <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 20 }}>{statusLabel(item)}</span>
          {item.weight_grams ? <span style={{ background: "#F1EFE9", color: "#6B6862", fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 20 }}>⚖️ {item.weight_grams} g</span> : null}
          {arrived && (ready
            ? <span style={{ background: "#DCFCE7", color: "#166534", fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 20 }}>📦 {tr("parcel.row.ready", "Ready")}</span>
            : <span style={{ background: "#FEF3C7", color: "#92400E", fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 20 }}>⏳ {tr("parcel.chip.unready", "Unready")}</span>)}
        </div>
        {/* Foto's — quality-control + maten; tik = fullscreen */}
        {qc.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0F0E0C", marginBottom: 8 }}>{tr("orders.detail.qcPics.title", "Quality-control pictures")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
              {qc.map((url, i) => (
                <motion.div key={i} whileTap={{ scale: 0.96 }} onClick={() => setZoom(url)} style={{ borderRadius: 12, overflow: "hidden", aspectRatio: "1", background: "#F3F1ED", cursor: "zoom-in" }}>
                  <img src={url} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </motion.div>
              ))}
            </div>
          </div>
        )}
        {meas.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0F0E0C", marginBottom: 8 }}>{tr("inspect.measureTitle", "Measurement photos")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {meas.map((url, i) => (
                <motion.div key={i} whileTap={{ scale: 0.96 }} onClick={() => setZoom(url)} style={{ borderRadius: 10, overflow: "hidden", aspectRatio: "1", background: "#F3F1ED", cursor: "zoom-in" }}>
                  <img src={url} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </motion.div>
              ))}
            </div>
          </div>
        )}
        {qc.length === 0 && meas.length === 0 && (
          <div style={{ background: "#fff", border: "1px solid #EDEBE5", borderRadius: 12, padding: "13px 15px", fontSize: 12.5, color: "#8A8780", lineHeight: 1.5, marginBottom: 14 }}>
            {tr("inspect.noPhotos", "No photos yet — they'll appear right after the warehouse check.")}
          </div>
        )}
        {/* Actie: eigen item → Ready bevestigen; andermans item → status van hun bevestiging */}
        {/* Ready = FINAL (user 2026-07-20): de "Hold out of the parcel"-link ná Ready is weg. */}
        {arrived && isOwn && !paid && !blocked && (ready ? (
          <div style={{ background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 14, padding: "12px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#065F46" }}>{tr("inspect.readyDone", "✓ Ready — ships with the group parcel")}</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12, color: "#8A8780", lineHeight: 1.5, marginBottom: 9 }}>{tr("inspect.confirmHint", "Check the photos — is everything right? Hit Ready so your squad can ship.")}</div>
            <motion.button whileTap={{ scale: 0.97 }} disabled={busy} onClick={doReady}
              style={{ width: "100%", background: busy ? "#E8E6E0" : "#FF5C00", color: busy ? "#A8A5A0" : "#fff", border: "none", borderRadius: 14, padding: "14px", fontSize: 14, fontWeight: 700, cursor: busy ? "wait" : "pointer", WebkitTapHighlightColor: "transparent" }}>
              {busy ? tr("inspect.readyBusy", "Confirming…") : tr("inspect.readyBtn", "✓ Looks good — Ready to ship")}
            </motion.button>
          </div>
        ))}
        {arrived && isOwn && paid && (
          <div style={{ background: "#DCFCE7", borderRadius: 14, padding: "12px 14px", textAlign: "center", fontSize: 12.5, fontWeight: 700, color: "#166534" }}>📦 {tr("parcel.chip.shipped", "In parcel — shipping paid")}</div>
        )}
        {arrived && !isOwn && (
          <div style={{ background: ready ? "#ECFDF5" : "#FFF7ED", border: `1px solid ${ready ? "#A7F3D0" : "#FCD9B6"}`, borderRadius: 14, padding: "12px 14px", textAlign: "center", fontSize: 12.5, fontWeight: 600, color: ready ? "#065F46" : "#92400E" }}>
            {ready
              ? tr("inspect.otherReady", "✓ {name} confirmed this item — ready to ship", { name: item.member || tr("inspect.friendFallback", "Friend") })
              : tr("inspect.otherNotReady", "⏳ {name} hasn't hit Ready on this item yet", { name: item.member || tr("inspect.friendFallback", "Friend") })}
          </div>
        )}
      </motion.div>
      {/* Fullscreen foto-viewer */}
      <AnimatePresence>
        {zoom && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setZoom(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 430, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}>
            <img src={zoom} referrerPolicy="no-referrer" alt="" style={{ maxWidth: "96vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 8 }} />
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body
  );
}

// ⚠️ Defect-keuze (bucky_flagged) — de klant kiest hier direct in het Track order-scherm:
// retour voor volledige refund of accepteren-zoals-het-is. Dit zat vroeger alleen in de
// warehouse-modal, maar die tab is opgegaan in Orders en de modal is onbereikbaar geworden —
// de klant kon dus nérgens meer kiezen. Zelfde RPC's als toen: accept_qc_result /
// request_item_return (veilige fabriek-retour + refund, server-side).
function DefectChoice({ order, onResolved }) {
  const [busy, setBusy] = useState(false);
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [err, setErr] = useState("");
  // Variant A (user 2026-07-21): Return = DIRECTE volledige refund (defect_return_refund).
  // 'done' houdt de bevestiging in beeld nadat de server al is bijgewerkt.
  const [done, setDone] = useState(null); // null | 'accepted' | 'refunded'
  const acceptDefect = async () => {
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("accept_qc_result", { p_order_id: order.id });
    setBusy(false);
    if (error || data?.ok === false) { setErr(error?.message || data?.error || "Could not accept"); return; }
    setDone("accepted");
    onResolved?.({});
  };
  const returnDefect = async () => {
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("defect_return_refund", { p_order_id: order.id });
    setBusy(false);
    if (error || data?.ok === false) { setErr(error?.message || data?.error || "Could not process the return"); return; }
    setDone("refunded");
    onResolved?.({});
  };
  if (done === "accepted") {
    return (
      <div style={{ textAlign: "center", color: "#065F46", fontSize: 13, fontWeight: 700, padding: "12px", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 12 }}>
        {tr("defect.acceptedDone", "✓ Got it — your item ships as-is")}
      </div>
    );
  }
  if (done === "refunded") {
    return (
      <div style={{ textAlign: "center", color: "#065F46", fontSize: 13, fontWeight: 700, padding: "12px", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 12 }}>
        {tr("defect.refundedDone", "✓ Fully refunded — sorry about the factory fault")}
      </div>
    );
  }
  if (order.return_status) {
    return (
      <div style={{ textAlign: "center", color: "#B45309", fontSize: 13, fontWeight: 600, padding: "12px", background: "#fff", borderRadius: 12 }}>
        {tr("defect.returnInProgress", "↩ Return in progress")}
      </div>
    );
  }
  return (
    <>
      {order.problem_type && (
        <div style={{ display: "inline-block", background: "#fff", color: "#B45309", fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 20, marginBottom: 10 }}>
          {tr("defect.reason", "Reported issue: {reason}", { reason: order.problem_type })}
        </div>
      )}
      {order.agent_defect_images?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#B45309", marginBottom: 8, letterSpacing: 1 }}>{tr("defect.agentPics", "ADDITIONAL PICTURES PROVIDED BY THE AGENT")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {order.agent_defect_images.map((url, i) => (
              <div key={i} style={{ borderRadius: 10, overflow: "hidden", aspectRatio: "1" }}>
                <img src={url} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            ))}
          </div>
        </div>
      )}
      {order.agent_notitie && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#B45309", marginBottom: 8, letterSpacing: 1 }}>{tr("defect.agentMsg", "AGENT MESSAGE")}</div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}><Fox /></div>
            <div style={{ fontSize: 13, color: "#92400E", lineHeight: 1.55 }}>{order.agent_notitie}</div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={acceptDefect} disabled={busy}
          style={{ flex: 1, background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "12px", fontSize: 13.5, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {tr("defect.accept", "✓ Accept as-is")}
        </button>
        <button onClick={() => (confirmReturn ? returnDefect() : setConfirmReturn(true))} disabled={busy}
          style={{ flex: 1, background: confirmReturn ? "#DC2626" : "#FEE2E2", color: confirmReturn ? "#fff" : "#DC2626", border: "none", borderRadius: 12, padding: "12px", fontSize: 13.5, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {confirmReturn ? tr("defect.returnConfirm", "Sure? Return & refund") : tr("defect.return", "↩ Return for refund")}
        </button>
      </div>
      {err && <div style={{ marginTop: 8, fontSize: 12, color: "#B91C1C", textAlign: "center" }}>{err}</div>}
    </>
  );
}

// Klant meldt zelf een probleem met een geïnspecteerd item vanaf de QC-pagina (solo én groep).
// Knop → tekstveld + optionele eigen bewijs-foto's → submit_dispute (dispute_status='pending'
// + omschrijving + dispute_images). Zodra 'pending', verbergt de QC-pagina deze knop en toont
// ze het "onder review"-blok; admin ziet melding + foto's in AgentPanel/Problems en keurt goed/af.
function RefundRequest({ order, onSubmitted, locked = false }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const uploadImages = async (files) => {
    setUploading(true); setErr("");
    const urls = [];
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop();
      // Random-suffix tegen naam-botsing bij meerdere foto's in dezelfde milliseconde.
      const fileName = `dispute-${order.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(fileName, file);
      if (!error) {
        const { data } = supabase.storage.from("product-images").getPublicUrl(fileName);
        urls.push(data.publicUrl);
      }
    }
    setImages((prev) => [...prev, ...urls]);
    setUploading(false);
  };
  const submit = async () => {
    const desc = text.trim();
    if (!desc) { setErr(tr("refund.empty", "Please describe the problem first")); return; }
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("submit_dispute", { p_order_id: order.id, p_description: desc, p_images: images });
    setBusy(false);
    if (error || data?.ok === false) { setErr(error?.message || data?.error || tr("refund.failed", "Could not send — please try again")); return; }
    onSubmitted?.({ dispute_status: "pending", dispute_description: desc, dispute_images: images });
  };
  // Gelockte groep-verzending (user 2026-07-22): refund kan de bevroren split verstoren →
  // knop doorgestreept + "your admin locked the group".
  if (locked) {
    return (
      <div style={{ width: "100%", marginTop: 10, background: "#F1EFE9", borderRadius: 12, padding: "12px", textAlign: "center" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#B8B5B0", textDecoration: "line-through" }}>{tr("refund.button", "Request a refund")}</span>
        <div style={{ fontSize: 11.5, color: "#8A8780", marginTop: 4 }}>🔒 {tr("group.locked.note", "Your admin locked the group")}</div>
      </div>
    );
  }
  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        style={{ width: "100%", marginTop: 10, background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
        {tr("refund.button", "Request a refund")}
      </button>
    );
  }
  return (
    <div style={{ marginTop: 12, background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 14 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#0F0E0C", marginBottom: 8 }}>{tr("refund.title", "What's wrong with your item?")}</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} autoFocus
        placeholder={tr("refund.placeholder", "Describe the problem so we can review it…")}
        style={{ width: "100%", boxSizing: "border-box", resize: "vertical", border: "1px solid #E2E0DA", borderRadius: 10, padding: "10px 12px", fontSize: 13.5, fontFamily: "inherit", color: "#0F0E0C", outline: "none" }} />
      {/* Eigen bewijs-foto's (optioneel) — versterkt de beoordeling in admin. */}
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
        onChange={(e) => { if (e.target.files?.length) uploadImages(e.target.files); e.target.value = ""; }} />
      {images.length > 0 && (
        <div style={{ display: "flex", gap: 7, marginTop: 10, flexWrap: "wrap" }}>
          {images.map((url, i) => (
            <div key={i} style={{ position: "relative", width: 62, height: 62, borderRadius: 10, overflow: "hidden", background: "#F3F1ED" }}>
              <img src={url} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))} aria-label={tr("refund.removePhoto", "Remove photo")}
                style={{ position: "absolute", top: 3, right: 3, width: 18, height: 18, borderRadius: "50%", background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", fontSize: 10, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>
          ))}
        </div>
      )}
      <button onClick={() => fileRef.current?.click()} disabled={uploading || busy}
        style={{ width: "100%", marginTop: 10, background: "#F8F7F4", color: "#6B6862", border: "1.5px dashed #D8D5CE", borderRadius: 10, padding: "10px", fontSize: 12.5, fontWeight: 700, cursor: uploading ? "wait" : "pointer" }}>
        {uploading ? tr("refund.uploading", "Uploading…") : `📷 ${tr("refund.addPhotos", "Add photos (optional)")}`}
      </button>
      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <button onClick={() => { setOpen(false); setErr(""); }} disabled={busy}
          style={{ flex: 1, background: "#F3F1ED", color: "#6B6862", border: "none", borderRadius: 10, padding: "11px", fontSize: 13.5, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {tr("refund.cancel", "Cancel")}
        </button>
        <button onClick={submit} disabled={busy || uploading}
          style={{ flex: 1, background: "#DC2626", color: "#fff", border: "none", borderRadius: 10, padding: "11px", fontSize: 13.5, fontWeight: 700, cursor: (busy || uploading) ? "default" : "pointer", opacity: (busy || uploading) ? 0.6 : 1 }}>
          {busy ? tr("refund.sending", "Sending…") : tr("refund.send", "Send request")}
        </button>
      </div>
      {err && <div style={{ marginTop: 8, fontSize: 12, color: "#B91C1C", textAlign: "center" }}>{err}</div>}
    </div>
  );
}

// Eén bestelling (= alle items uit dezelfde aankoop). Klap open → morpht omlaag,
// toont elk item met z'n eigen status. Statussen mogen per item verschillen.
function OrderGroupCard({ items, onOpenItem, groupSize, onDismiss, parcel, activeFilter, onClearFilter, squad, parcelStateFor, onToggleParcel, refundedItems = [] }) {
  const [open, setOpen] = useState(false);
  const [wheel, setWheel] = useState(false);
  // Datum altijd dd/mm/jjjj (uit created_at; valt terug op het tekst-date-veld).
  const date = (() => { const c = items[0]?.created_at; if (c) { try { return new Date(c).toLocaleDateString("en-GB"); } catch {} } return items[0]?.date || ""; })();
  const percent = Math.round(items.reduce((s, o) => s + productProgress(o), 0) / items.length);
  const whStep = statusConfig.qc_pending.step;
  const atWarehouse = items.filter(o => (statusConfig[o.status]?.step ?? 0) >= whStep).length;
  // Hele groep voorbij het magazijn (shipped/delivered) = "In transit" → geen progress-cirkel meer.
  const allInTransit = items.length > 0 && items.every(o => (statusConfig[o.status]?.step ?? 0) > whStep);
  // Hele groep geleverd = pakket aangekomen → groen "Parcel arrived" + ✕ om het blokje te verwijderen.
  const allDelivered = items.length > 0 && items.every(o => o.status === "delivered");
  const anyProblem = items.some(o => o.problem_type);
  // Actief checkpoint-filter → in de uitklap alleen de items met die status + een "All orders"-resetknop.
  const filterStatuses = (activeFilter && activeFilter !== "all") ? (journeyStops.find((j) => j.key === activeFilter)?.statuses || [activeFilter]) : null;
  const shownItems = filterStatuses ? items.filter((o) => filterStatuses.includes(o.status)) : items;
  const subtotal = items.reduce((s, o) => s + (Number(o.price) || 0), 0);
  // Service fee (solo én groep) valt nu bij VERZENDEN (per pakket) — de kaart toont alleen de itemwaarde.
  const isGroupOrder = !!items[0]?.ff_group_id;
  const total = subtotal;
  return (
    <motion.div layout exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }} style={{ position: "relative", background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, marginBottom: 10, overflow: "hidden" }}>
      {/* Wegklikbaar (user 2026-07-22): behalve afgeleverde kaarten ook de "Parcel · In
          transit"-infokaart — die leeft door in de Transit-tab, dus hier mag 'ie weg. */}
      {(allDelivered || allInTransit) && onDismiss && (
        <motion.button whileTap={{ scale: 0.82 }} onClick={(e) => { e.stopPropagation(); onDismiss(items.map(o => o.id)); }} title={tr("orders.card.removeTitle", "Remove from orders")}
          style={{ position: "absolute", top: 8, right: 9, zIndex: 3, width: 23, height: 23, borderRadius: 999, background: "#F1EFE9", border: "none", display: "flex", alignItems: "center", justifyContent: "center", color: "#9A968F", cursor: "pointer", padding: 0, WebkitTapHighlightColor: "transparent" }}>
          <X size={13} strokeWidth={2.7} />
        </motion.button>
      )}
      <motion.div whileTap={allInTransit ? undefined : { scale: 0.99 }} onClick={() => { if (!allInTransit) setOpen(o => !o); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: (allDelivered || allInTransit) ? "13px 38px 13px 15px" : "13px 15px", cursor: allInTransit ? "default" : "pointer" }}>
        <div style={{ display: "flex", flexShrink: 0 }}>
          {items.slice(0, 3).map((o, i) => (
            <div key={o.id} style={{ width: 40, height: 40, borderRadius: 9, background: "#fff", boxShadow: "0 0 0 1px #F0EEE8", overflow: "hidden", marginLeft: i ? -14 : 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {o.variant_image ? <img src={o.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 18 }}>📦</span>}
            </div>
          ))}
          {items.length > 3 && <div style={{ width: 40, height: 40, borderRadius: 9, background: "#F3F1ED", marginLeft: -14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#888" }}>+{items.length - 3}</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "#A8A5A0" }}>{(() => { const d = (allInTransit && parcel?.date && !squad) ? parcel.date : date; return d ? `${d} · ` : ""; })()}{tr("orders.card.itemCount", "{count} item{s}", { count: items.length, s: items.length > 1 ? "s" : "" })}</div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {(allInTransit && !squad) ? (parcel?.label || tr("orders.card.parcelFallback", "Parcel")) : `${items[0].product_title || items[0].product}${items.length > 1 ? ` ${tr("orders.card.plusMore", "+{count} more", { count: items.length - 1 })}` : ""}`}
          </div>
          {/* Prijs-regel (€ + fee at shipping) VERWIJDERD van de kaart (user 2026-07-20):
              de prijs staat al op de uitgeklapte itemregel + in de pakket-sheet. */}
          {/* Statusregel: alleen nog écht informatieve staten. "N/N at warehouse" is
              weggehaald (redundant met de 100%-ring + "In warehouse"-chip). Alerts blijven. */}
          {(() => {
            const line = squad
              ? (allDelivered ? tr("orders.status.delivered", "Delivered") : allInTransit ? tr("orders.status.inTransit", "In transit") : "")
              : (anyProblem ? tr("orders.card.actionNeeded", "⚠️ Action needed") : allDelivered ? tr("orders.card.deliveredToYou", "Delivered to you") : allInTransit ? tr("orders.card.shippedTrackInTransit", "Shipped — track in In transit") : "");
            return line ? (
              <div style={{ fontSize: 11, color: (!squad && anyProblem) ? "#B45309" : allDelivered ? "#15803D" : "#8A8780", marginTop: 1, fontWeight: allDelivered ? 700 : 400 }}>{line}</div>
            ) : null;
          })()}
        </div>
        {allDelivered ? (
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 5, background: "#DCFCE7", color: "#15803D", borderRadius: 999, padding: "6px 11px 6px 9px", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>
            <PackageCheck size={13} strokeWidth={2.4} /> {tr("orders.card.parcelArrived", "Parcel arrived")}
          </div>
        ) : allInTransit ? (
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 5, background: "#E0F2FE", color: "#0369A1", borderRadius: 999, padding: "6px 11px 6px 9px", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>
            <Plane size={13} strokeWidth={2.3} /> {tr("orders.status.inTransit", "In transit")}
          </div>
        ) : (
          <motion.div whileTap={{ scale: 0.85 }} onClick={(e) => { e.stopPropagation(); setWheel(true); }} title="Tap for progress breakdown" style={{ flexShrink: 0, cursor: "pointer" }}>
            <ProgressRing percent={percent} />
          </motion.div>
        )}
        {!allInTransit && (
          <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <motion.div animate={{ rotate: open ? 0 : 180 }} transition={springSnappy} style={{ display: "flex" }}>
              <ChevronUp size={18} color="#C9C6C1" strokeWidth={2.4} />
            </motion.div>
            <span style={{ fontSize: 9.5, fontWeight: 700, color: "#A8A5A0", lineHeight: 1, whiteSpace: "nowrap" }}>{tr("orders.card.itemCount", "{count} item{s}", { count: shownItems.length, s: shownItems.length > 1 ? "s" : "" })}</span>
          </div>
        )}
      </motion.div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 260, damping: 30 }} style={{ overflow: "hidden" }}>
            <div style={{ padding: "2px 12px 12px" }}>
              {shownItems.map(o => {
                const s = statusConfig[o.status] || statusConfig.purchased;
                return (
                  <motion.div key={o.id} whileTap={onOpenItem ? { scale: 0.98 } : undefined} onClick={onOpenItem ? () => onOpenItem(o) : undefined}
                    style={{ display: "flex", alignItems: "center", gap: 10, background: "#F8F7F4", borderRadius: 12, padding: "9px 11px", marginBottom: 6, cursor: onOpenItem ? "pointer" : "default" }}>
                    <div style={{ width: 38, height: 38, borderRadius: 8, background: "#fff", border: "1px solid #F0EEE8", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {o.variant_image ? <img src={o.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 17 }}>📦</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.product_title || o.product}</div>
                      <div style={{ fontSize: 11, color: "#A8A5A0", marginBottom: 3 }}>{tr("orders.item.pcs", "{qty} pcs", { qty: o.qty })}{o.kleur ? ` · ${o.kleur}` : ""}{squad ? "" : ` · €${(Number(o.price) || 0).toFixed(2)}`}</div>
                      <div style={{ display: "inline-block", background: s.bg, color: s.color, fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20 }}>{statusLabel(o)}{o.problem_type === "out_of_stock" ? <> · {tr("orders.item.outOfStock", "out of stock")} · <span style={{ color: "#15803D" }}>{tr("orders.item.refunded", "refunded")}</span></> : o.problem_type ? " · ⚠️" : ""}</div>
                      {/* Opslag-teller (user 2026-07-22): NL-kalenderdagen, aankomstdag = dag 1.
                          Groen t/m dag 23, amber 24-30, rood vanaf dag 31 met fee-melding
                          (€2/stuk 31-60 · €4/stuk 61-90 · dag 91 = verbeurd, aparte chip). */}
                      {o.status === "qc_pending" && o.arrived_at && (() => {
                        const d = storageDayOf(o.arrived_at);
                        const over = d > 30;
                        return (
                          <div style={{ display: "inline-block", background: over ? "#FEE2E2" : d >= 24 ? "#FEF3C7" : "#D1FAE5", color: over ? "#DC2626" : d >= 24 ? "#B45309" : "#065F46", fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20, marginLeft: 5 }}>
                            🗓️ {over ? tr("orders.item.storageFee", "{days}/90 · storage fee", { days: d }) : tr("orders.item.storageFree", "{days}/30 free storage", { days: d })}
                          </div>
                        );
                      })()}
                      {/* 📦 Pakket-chipje: aangekomen items zitten automatisch in je pakket;
                          tikken = apart houden / terugzetten. "locked" = verzending al betaald. */}
                      {parcelStateFor && (() => {
                        const ps = parcelStateFor(o);
                        if (!ps) return null;
                        if (ps === "locked") return (
                          <div style={{ display: "inline-block", background: "#DCFCE7", color: "#166534", fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20, marginLeft: 5 }}>📦 {tr("parcel.chip.shipped", "In parcel — shipping paid")}</div>
                        );
                        // SOLO: puur info — item zit altijd in het pakket (geen hold-out).
                        if (ps === "in_solo") return (
                          <div style={{ display: "inline-block", background: "#FFF0E7", color: "#B8430A", fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20, marginLeft: 5 }}>
                            📦 {tr("parcel.chip.in", "In your parcel")}
                          </div>
                        );
                        if (ps === "in") return (
                          <div onClick={(e) => { e.stopPropagation(); onToggleParcel && onToggleParcel(o.id); }}
                            style={{ display: "inline-block", background: "#FFF0E7", color: "#B8430A", fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20, marginLeft: 5, cursor: "pointer" }}>
                            📦 {tr("parcel.chip.in", "In your parcel")} <span style={{ opacity: 0.6 }}>· {tr("parcel.chip.holdOutShort", "hold out")}</span>
                          </div>
                        );
                        // Groep: bevestigd na foto-inspectie → groen en FINAL (user 2026-07-20:
                        // geen hold-out meer vanaf Ready); nog inspecteren → amber, tik opent het item.
                        if (ps === "ready") return (
                          <div style={{ display: "inline-block", background: "#DCFCE7", color: "#166534", fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20, marginLeft: 5 }}>
                            📦 {tr("parcel.chip.ready", "Ready")}
                          </div>
                        );
                        if (ps === "confirm") return (
                          <div onClick={(e) => { e.stopPropagation(); onOpenItem && onOpenItem(o); }}
                            style={{ display: "inline-block", background: "#FEF3C7", color: "#92400E", fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20, marginLeft: 5, cursor: "pointer" }}>
                            ⏳ {tr("parcel.chip.unreadyConfirm", "Unready — inspect & confirm")}
                          </div>
                        );
                        return (
                          <div onClick={(e) => { e.stopPropagation(); onToggleParcel && onToggleParcel(o.id); }}
                            style={{ display: "inline-block", background: "#F1EFE9", color: "#6B6862", fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20, marginLeft: 5, cursor: "pointer" }}>
                            ＋ {tr("parcel.chip.addBackLong", "Add back to parcel")}
                          </div>
                        );
                      })()}
                      {/* GROEPSGENOTEN: 3-status-systeem (Order placed → Unready → Ready).
                          Aangekomen item = "Unready" tot de eigenaar zelf Ready drukt (box_staged_at).
                          Niet klikbaar — alleen de eigenaar bevestigt z'n eigen item. */}
                      {squad && o.status === "qc_pending" && (
                        <div style={{ display: "inline-block", background: o.box_staged_at ? "#DCFCE7" : "#FEF3C7", color: o.box_staged_at ? "#166534" : "#92400E", fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20, marginLeft: 5 }}>
                          {o.box_staged_at ? <>✓ {tr("parcel.row.ready", "Ready")}</> : <>⏳ {tr("parcel.chip.unready", "Unready")}</>}
                        </div>
                      )}
                      {/* 📸 Quality-control-embleem — PUUR afgeleid van qc_images (die alleen door
                          BuckyDrop's webhook/QC-sync gevuld worden). Foto's binnen = blauw "ready";
                          nog niet = rood "awaiting". Nooit een verzonnen vlag. Alleen bij aankomst. */}
                      {o.status === "qc_pending" && (
                        <div style={{ marginTop: 5 }}>
                          {o.qc_images?.length > 0 ? (
                            // Duidelijke klik-actie → opent de Quality-control pictures-pagina.
                            <span onClick={(e) => { e.stopPropagation(); onOpenItem && onOpenItem(o); }}
                              style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#E0F2FE", color: "#0369A1", fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 20, cursor: onOpenItem ? "pointer" : "default" }}>
                              📸 {tr("orders.item.qcView", "View quality-control pictures")} →
                            </span>
                          ) : (
                            <span style={{ display: "inline-block", background: "#FEF2F2", color: "#DC2626", fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20 }}>
                              ⏳ {tr("orders.item.qcAwaiting", "Awaiting quality-control pictures")}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {/* "→"-pijltje VERWIJDERD (user 2026-07-20): de "View quality-control
                        pictures →"-knop is nu de duidelijke tik-actie; de rij blijft klikbaar. */}
                  </motion.div>
                );
              })}
              {/* Gerefunde items van deze aankoop (user 2026-07-22): blijven zichtbaar in de
                  kaart, grijs, met de inbox-chip — de reden staat in Flowva support (belletje). */}
              {!filterStatuses && refundedItems.map((o) => (
                <div key={"ref-" + o.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#F1EFE9", borderRadius: 12, padding: "9px 11px", marginBottom: 6, opacity: 0.85 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 8, background: "#fff", border: "1px solid #EBE9E3", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {o.variant_image ? <img src={o.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(60%)" }} /> : <span style={{ fontSize: 17 }}>📦</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#8A8780", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.product_title || o.product}</div>
                    <div style={{ fontSize: 11, color: "#B5B2AC", marginBottom: 3 }}>{tr("orders.item.pcs", "{qty} pcs", { qty: o.qty || 1 })}{o.kleur ? ` · ${o.kleur}` : ""}</div>
                    <div style={{ display: "inline-block", background: "#DCFCE7", color: "#15803D", fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 20 }}>
                      {tr("orders.item.refundedInbox", "Refunded — couldn't proceed, check your inbox")}
                    </div>
                  </div>
                </div>
              ))}
              {/* Prijs-uitsplitsing (Items/Service fee/Total paid) hier VERWIJDERD (user 2026-07-20):
                  die staat al in het pakket-overzicht (parcel-sheet). Alleen de filter-resetknop blijft. */}
              {filterStatuses && (
                <motion.button whileTap={{ scale: 0.97 }} onClick={(e) => { e.stopPropagation(); onClearFilter && onClearFilter(); }}
                  style={{ width: "100%", marginTop: 4, background: "#111", color: "#fff", border: "none", borderRadius: 12, padding: "11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                  {tr("orders.filter.all", "All orders")}
                </motion.button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {wheel && <ProgressWheelModal items={items} refundedItems={refundedItems} onClose={() => setWheel(false)} onOpenItem={onOpenItem} />}
      </AnimatePresence>
    </motion.div>
  );
}

function TreasureMap({ activeFilter, onSelect, orders }) {
  const countFor = (statuses) => orders.filter(o => statuses.includes(o.status)).length;
  return (
    <div style={{ margin: "10px 20px 0", background: "#fff", borderRadius: 18, boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)", padding: "15px 16px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 2 }}>
        <div>
          {/* 📦 naast de titel = de bron van de pakket-vlucht: bij het openen van de
              pakket-sheet springt dít doosje in een boog naar linksboven in de sheet
              (ParcelSection meet/verbergt 'm via [data-journey-box]). */}
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111111" }}>{tr("orders.journey.title", "Your orders' journey in China")} <span data-journey-box style={{ fontSize: 15, display: "inline-block", transition: "opacity 0.25s" }}>📦</span></div>
          <div style={{ fontSize: 10.5, color: "#A8A5A0" }}>{tr("orders.journey.subtitle", "Tap a checkpoint to filter")}</div>
        </div>
        <motion.button whileTap={{ scale: 0.92 }} onClick={() => onSelect("all")}
          style={{ position: "relative", background: activeFilter === "all" ? "#111111" : "#F3F1ED", color: activeFilter === "all" ? "#fff" : "#555", border: "none", borderRadius: 14, padding: "7px 13px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
          {tr("orders.filter.all", "All orders")}
          {orders.length > 0 && (
            <span style={{ position: "absolute", top: -6, right: -6, minWidth: 15, height: 15, padding: "0 2px", borderRadius: 8, background: "#FF5C00", color: "#fff", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #fff", boxSizing: "content-box" }}>{orders.length}</span>
          )}
        </motion.button>
      </div>
      {/* Horizontale route: de haltes gelijkmatig verdeeld op één strakke gestippelde reislijn.
          Posities uit journeyStops.length berekend (edge = midden van de 1e/laatste bol). */}
      <div style={{ position: "relative", display: "flex", justifyContent: "space-between", marginTop: 16, marginBottom: 2 }}>
        <div style={{ position: "absolute", top: 21, left: `${50 / journeyStops.length}%`, right: `${50 / journeyStops.length}%`, height: 0, borderTop: "2px dashed #FFC4A3", zIndex: 0 }} />
        {/* 🚚 rijdt bij het openen langs de route tot het verste checkpoint met orders */}
        {(() => {
          const idx = journeyStops.reduce((a, s, i) => (countFor(s.statuses) > 0 ? i : a), -1);
          if (idx < 0) return null;
          const edge = 50 / journeyStops.length;
          return (
            <motion.span
              initial={{ left: `${edge}%`, opacity: 0, y: 0 }}
              animate={{ left: `${edge + idx * (100 / journeyStops.length)}%`, opacity: [0, 1, 1, 0], y: [0, -2, 0, -1.5, 0] }}
              transition={{ duration: 1.5, delay: 0.45, ease: "easeInOut" }}
              style={{ position: "absolute", top: 5, marginLeft: -9, fontSize: 15, zIndex: 2, pointerEvents: "none" }}>
              {/* emoji kijkt standaard naar links; hij rijdt naar rechts → spiegelen */}
              <span style={{ display: "inline-block", transform: "scaleX(-1)" }}>🚚</span>
            </motion.span>
          );
        })()}
        {journeyStops.map((s, i) => {
          const active = activeFilter === s.key;
          const count = countFor(s.statuses);
          return (
            <motion.div key={s.key}
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ ...springBouncy, delay: 0.1 + i * 0.08 }}
              onClick={() => onSelect(active ? "all" : s.key)}
              style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
              <div style={{ position: "relative", width: 42, height: 42 }}>
                {active && (
                  <motion.div animate={{ scale: [0.85, 1.4], opacity: [0.5, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                    style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid #FF5C00" }} />
                )}
                <div style={{ width: 42, height: 42, borderRadius: "50%", boxSizing: "border-box", background: active ? "#FF5C00" : "#fff", border: active ? "2px solid #FF5C00" : "2px solid #EFEBE3", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(17,17,17,0.06)" }}>
                  <s.Icon size={18} strokeWidth={2.1} color={active ? "#fff" : "#111111"} />
                </div>
                {count > 0 && (
                  <div style={{ position: "absolute", top: -4, right: -3, minWidth: 16, height: 16, padding: "0 3px", borderRadius: 8, background: "#FF5C00", color: "#fff", fontSize: 9.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #fff", boxSizing: "content-box", zIndex: 2 }}>{count}</div>
                )}
              </div>
              <div style={{ marginTop: 7, width: 74, textAlign: "center", fontSize: 9.5, fontWeight: active ? 700 : 500, color: active ? "#FF5C00" : "#8A8780", lineHeight: 1.2 }}>{tr(s.labelKey, s.label)}</div>
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
// Boom-groei + regel-reveals komen uit MotionBits (CartGrower/FoldReveal) — gedeeld
// met de pakket-sheet op Orders, zodat mand en pakket exact dezelfde motion hebben.
function RequestListSheet({ items, onRemove, onSetQty, onClose, onSend, sending, error, needed, balance, session, onEditAddress, onTopUp, onTopUpExact, onFinish, flagged, reasons, initialView }) {
  const [view, setView] = useState(initialView || "cart");
  const [agreed, setAgreed] = useState(false);   // 1 vinkje: Terms + retour + "adres klopt"
  const dragControls = useDragControls();           // rubber-band: sheet omlaag trekken om te sluiten
  // Gel-rek: hoe verder je trekt, hoe meer de kaart uitrekt (bovenkant "plakt").
  const dragStretch = useMotionValue(0);
  const stretchY = useTransform(dragStretch, [0, 170], [1, 1.055]);
  useBodyScrollLock(true);                          // feed erachter niet mee laten scrollen
  const [paying, setPaying] = useState("idle");     // "idle" | "check" — betaal-morph (knop → cirkel → vinkje)
  // Vouw-open alleen bij de éérste keer openen: daarna (terug uit checkout, of rijen
  // die her-mounten na verwijderen) staat alles er meteen — geen herhaal-animatie.
  const unfolded = useRef(false);
  useEffect(() => { unfolded.current = true; }, []);
  const isHeld = (item) => !!flagged && flagged.has(item.source_url);
  const heldReason = (item) => reasons?.[item.source_url] || tr("cart.heldReasonDefault", "On hold — changed at the factory");
  const heldCount = items.filter(isHeld).length;
  // Held-items doen NIET mee met betalen → totaal/fee/per-item alleen over de betaalbare items.
  const payable = items.filter((it) => !isHeld(it));
  const total = payable.reduce((s, it) => s + Number(it.price || 0) * (it.qty || 1), 0);
  const KOERS = 7.8;
  const totalQty = payable.reduce((s, it) => s + (it.qty || 1), 0);
  const domesticCny = 5 * totalQty;
  const domestic = Math.round((domesticCny / KOERS) * 100) / 100;
  const qcCny = 6 * totalQty;
  const qc = Math.round((qcCny / KOERS) * 100) / 100;
  // Service fee is VERHUISD naar verzenden (pay_shipping_buffered) → niet meer bij checkout.
  const charge = total + domestic + qc;
  const m = session?.user?.user_metadata || {};
  const addrName = `${m.voornaam || ""} ${m.achternaam || ""}`.trim();
  const cityLine = [m.postcode, m.stad].filter(Boolean).join(" ");
  const hasAddress = !!(m.adres && m.stad);
  // Onlogisch adres blokkeren bij checkout: de postcode moet bij het land passen
  // (dezelfde bron als het adres-formulier). Vangt óók oude/foute adressen die vóór
  // de formulier-check zijn opgeslagen (bv. land Bulgarije + Nederlandse postcode).
  const addrValid = hasAddress && isValidPostcode(m.land, m.postcode);
  const lowBalance = /balance|saldo/i.test(error || "");

  // Saldo-tekort, live meeberekend terwijl je de mand aanpast. Kwam er net een
  // echte weigering van pay_cart terug, dan wint de server-'needed' — die is
  // gezaghebbend (prijzen komen server-side uit products).
  const bal = Number(balance) || 0;
  const due = Number(needed) > 0 ? Number(needed) : charge;
  const short = Math.max(0, Math.round((due - bal) * 100) / 100);
  const topUpNeeded = short > 0;
  const topUpAmount = exactTopUp(short);          // exact het tekort, minstens €5
  const topUpOver = Math.round((topUpAmount - short) * 100) / 100;   // >0 = door het €5-minimum
  // Pas opwaarderen aanbieden als de rest klopt: eerst adres, anders stuurt de
  // klant geld vooruit voor een order die tóch nog niet door kan.
  const showShort = topUpNeeded && payable.length > 0 && hasAddress && addrValid;
  const [topping, setTopping] = useState(false);
  const [topErr, setTopErr] = useState(null);
  // Opwaarderen midden in het afrekenen: bij succes navigeert de pagina weg naar
  // iDEAL, dus 'topping' hoeft alleen bij een fout terug.
  const doTopUp = async () => {
    if (topping || !onTopUpExact) return;
    setTopping(true); setTopErr(null);
    try { await onTopUpExact(topUpAmount); }
    catch (e) { setTopErr(e?.message || tr("common.somethingWentWrong", "Something went wrong. Please try again.")); setTopping(false); }
  };

  // Bevestig & betaal → bij succes eerst de knop-morph (cirkel + vinkje dat tekent),
  // dán pas de "placed"-weergave met confetti.
  const confirmAndPay = async () => {
    const ok = await onSend();
    if (ok) {
      setPaying("check");
      setTimeout(() => { setPaying("idle"); setView("placed"); }, 950);
    }
  };

  const itemThumb = (item) => (
    <div style={{ width: 46, height: 46, borderRadius: 10, background: "#fff", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {item.variant_image ? <img src={item.variant_image} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 20 }}>📦</span>}
    </div>
  );

  const errorBlock = error ? (
    <div style={{ background: "#FEE2E2", color: "#DC2626", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginTop: 10 }}>
      {error}
      {/* Alleen als we NIET al de exacte opwaardeerknop tonen — anders twee keer hetzelfde. */}
      {lowBalance && onTopUp && !topUpNeeded && (
        <button onClick={onTopUp} style={{ display: "block", width: "100%", marginTop: 8, background: "#DC2626", color: "#fff", border: "none", borderRadius: 8, padding: "8px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
          {PRELAUNCH ? tr("cart.launchesOn", "Flowva launches {date} →", { date: LAUNCH_DATE_LABEL }) : tr("cart.topUpBalance", "Top up your balance →")}
        </button>
      )}
    </div>
  ) : null;

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={view === "placed" ? () => onFinish?.(false) : onClose}
        style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }} />
      {/* Saldo-eilandje. De header (met het saldo erin) valt achter de blur, terwijl je
          juist tijdens het afrekenen wilt zien wat je hebt staan — en of een opwaardering
          is geland als je terugkomt van iDEAL. Dus zweeft het saldo hier als eigen eiland
          bóven de blur, net als de nav. pointerEvents uit: wegtikken blijft werken. */}
      {view !== "placed" && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={springSnappy}
          style={{ position: "fixed", top: 14, left: 0, right: 0, margin: "0 auto", width: "max-content", maxWidth: "calc(100% - 32px)", zIndex: 302, pointerEvents: "none",
                   background: "#111111", borderRadius: 999, padding: "9px 16px", display: "flex", alignItems: "center", gap: 9,
                   boxShadow: "0 10px 30px rgba(0,0,0,0.45)", border: `1px solid ${topUpNeeded ? "rgba(245,158,11,0.55)" : "rgba(255,255,255,0.10)"}` }}>
          <span style={{ fontSize: 11.5, color: "#9C9893", fontWeight: 600 }}>{tr("feed.header.balanceLabel", "Balance")}</span>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: "#fff" }}>€{bal.toFixed(2)}</span>
          {topUpNeeded && payable.length > 0 && (
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#F59E0B", borderLeft: "1px solid rgba(255,255,255,0.14)", paddingLeft: 9 }}>
              {tr("cart.shortBy", "€{amount} short", { amount: short.toFixed(2) })}
            </span>
          )}
        </motion.div>
      )}
      {/* Zwevende mand-kaart: raakt de schermranden nergens (minimalistisch, "duur") en
          klapt via de gedeelde layoutId ("cart-pop") uit de mand-balk omhoog — geen paneel
          meer dat aan de onderkant vastzit. */}
      <motion.div layoutRoot
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 6, transition: { duration: 0.14, delay: 0.2, ease: "easeIn" } }}
        transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8, opacity: { duration: 0.16, ease: "easeOut" } }}
        drag="y" dragControls={dragControls} dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.55 }}
        onDrag={(e, info) => dragStretch.set(Math.max(0, info.offset.y))}
        onDragEnd={(e, info) => { dragStretch.set(0); if (info.offset.y > 110 || info.velocity.y > 650) (view === "placed" ? onFinish?.(false) : onClose()); }}
        style={{ position: "fixed", bottom: 86, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 24px)", maxWidth: 404, boxSizing: "border-box", background: "#111111", borderRadius: 28, zIndex: 301, maxHeight: "74vh", overflowY: "auto", overscrollBehavior: "contain", boxShadow: "0 30px 80px rgba(0,0,0,0.5)", scaleY: stretchY, transformOrigin: "50% 0%" }}>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.12 } }}
          style={{ padding: "18px 18px 26px" }}>
          {/* Inklap-pijltje rechtsboven (sticky, dus ook zichtbaar als de mand scrollt) —
              spiegelbeeld van het omhoog-pijltje op de balk. Sluit vanuit elke view. */}
          <div style={{ position: "sticky", top: 10, zIndex: 6, height: 0, display: "flex", justifyContent: "flex-end" }}>
            <motion.button whileTap={{ scale: 0.88 }} onClick={view === "placed" ? () => onFinish?.(false) : onClose}
              aria-label={tr("cart.collapse", "Collapse cart")}
              style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,92,0,0.15)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
              <ChevronDown size={16} color="#FF5C00" strokeWidth={2.5} />
            </motion.button>
          </div>
          <div onClick={view === "checkout" ? () => setView("cart") : view === "placed" ? () => onFinish?.(false) : onClose}
            onPointerDown={(e) => dragControls.start(e)}
            style={{ padding: "0 0 12px", cursor: "grab", touchAction: "none" }}>
            <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, margin: "0 auto" }} />
          </div>

          {view === "cart" ? (
            <motion.div key="cart">
              <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 14 }}>
                {/* Woord-voor-woord alleen bij de eerste open-beurt; daarna gewoon tekst. */}
                {unfolded.current
                  ? tr("cart.title", "🛒 Shopping cart ({count})", { count: items.length })
                  : <WordReveal text={tr("cart.title", "🛒 Shopping cart ({count})", { count: items.length })} delay={0.12} stagger={0.05} />}
              </div>

              <CartGrower skip={unfolded.current}>
              {items.map((item, i) => {
                const held = isHeld(item);
                return (
                <FoldReveal key={i} i={i} n={items.length + 4} skip={unfolded.current}>
                <motion.div layoutId={`citem-${i}`} style={{ display: "flex", alignItems: "center", gap: 12, background: "#1A1917", borderRadius: 14, padding: "10px 12px", marginBottom: 8, opacity: held ? 0.6 : 1 }}>
                  {itemThumb(item)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: held ? "line-through" : "none" }}>{item.product_title}</div>
                    <div style={{ display: "inline-block", fontSize: 9.5, color: "#C9C6C1", background: "rgba(255,255,255,0.06)", padding: "1px 7px", borderRadius: 6, marginTop: 3, fontWeight: 600 }}>{garmentType(item.product_title)}</div>
                    {held ? (
                      <div style={{ fontSize: 11, color: "#F59E0B", fontWeight: 600 }}>⏸ {heldReason(item)}</div>
                    ) : (
                      <div style={{ fontSize: 11.5, color: "#9C9893" }}>{item.kleur ? `${item.kleur} · ` : ""}€{Number(item.price).toFixed(2)}</div>
                    )}
                  </div>
                  {held ? (
                    <button onClick={() => onRemove(i)}
                      style={{ flexShrink: 0, background: "rgba(245,158,11,0.15)", color: "#F59E0B", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 9, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>{tr("cart.remove", "Remove")}</button>
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
                </FoldReveal>
                );
              })}

              {payable.length > 0 && (
                <FoldReveal i={items.length} n={items.length + 4} skip={unfolded.current}>
                <motion.div layout style={{ background: "#1E1D1A", borderRadius: 14, padding: "12px 14px", marginTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12.5, color: "#9C9893" }}>{tr("cart.lineItems", "Items")}</span>
                    <span style={{ fontSize: 12.5, color: "#fff", fontWeight: 600 }}>€{total.toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12.5, color: "#9C9893" }}>{tr("cart.lineDomestic", "Domestic shipping (¥5 × {qty})", { qty: totalQty })}</span>
                    <span style={{ fontSize: 12.5, color: "#fff", fontWeight: 600 }}>€{domestic.toFixed(2)} <span style={{ color: "#9C9893", fontWeight: 400 }}>· ¥{domesticCny}</span></span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 12.5, color: "#9C9893" }}>{tr("cart.lineQualityControl", "Quality-control (¥6 × {qty})", { qty: totalQty })}</span>
                    <span style={{ fontSize: 12.5, color: "#fff", fontWeight: 600 }}>€{qc.toFixed(2)} <span style={{ color: "#9C9893", fontWeight: 400 }}>· ¥{qcCny}</span></span>
                  </div>
                </motion.div>
                </FoldReveal>
              )}

              {errorBlock}

              {heldCount > 0 && (
                <FoldReveal i={items.length + 1} n={items.length + 4} skip={unfolded.current}>
                <div style={{ background: "rgba(245,158,11,0.12)", color: "#F59E0B", borderRadius: 10, padding: "10px 13px", fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
                  {tr("cart.heldBanner", "⏸ {countClause} on hold and won't be charged{rest}. Keep {pron} and check back soon, or remove {pron}. You haven't been charged.", { countClause: heldCount === 1 ? "1 item is" : `${heldCount} items are`, rest: payable.length ? " — you can still check out the rest" : "", pron: heldCount === 1 ? "it" : "them" })}
                </div>
                </FoldReveal>
              )}
              <FoldReveal i={items.length + 2} n={items.length + 4} skip={unfolded.current}>
              <div style={{ position: "relative" }}>
                <motion.button animate={{ scale: 1 }} transition={springBouncy}
                  whileTap={payable.length ? { scale: 0.97 } : undefined} onClick={() => payable.length && setView("checkout")} disabled={payable.length === 0}
                  style={{ width: "100%", marginTop: 12, background: payable.length ? "#FF5C00" : "#333", color: payable.length ? "#fff" : "#777", border: "none", borderRadius: 14, padding: "16px", fontSize: 15, fontWeight: 700, cursor: payable.length ? "pointer" : "default", WebkitTapHighlightColor: "transparent" }}>
                  {payable.length === 0 ? tr("cart.allOnHold", "All items are on hold") : (
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      {(heldCount > 0 ? tr("cart.checkoutAvailable", "Check out the {n} available item{s} →", { n: payable.length, s: payable.length > 1 ? "s" : "" }) : tr("cart.goToCheckout", "Go to checkout →")).replace(/\s*→\s*$/, "")}
                      <motion.span layoutId="cart-fox" style={{ fontSize: 19, display: "inline-flex", lineHeight: 1 }}><Fox /></motion.span>
                      <span aria-hidden="true">→</span>
                    </span>
                  )}
                </motion.button>
              </div>
              </FoldReveal>

              <FoldReveal i={items.length + 3} n={items.length + 4} skip={unfolded.current}>
              <motion.button whileTap={{ scale: 0.97 }} onClick={onClose}
                style={{ width: "100%", marginTop: 8, background: "transparent", color: "#C9C6C1", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14, padding: "13px", fontSize: 13, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                {tr("cart.continueShopping", "← Continue shopping & reduce your fee per item")}
              </motion.button>
              </FoldReveal>
              </CartGrower>
            </motion.div>
          ) : view === "checkout" ? (
            <motion.div key="checkout">
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <motion.span layoutId="cart-fox" style={{ fontSize: 34, flexShrink: 0 }}><Fox /></motion.span>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>{tr("cart.checkoutTitle", "Checkout")}</div>
                  <div style={{ fontSize: 12, color: "#9C9893" }}>{tr("cart.checkoutSubtitle", "Just confirm and we'll start sourcing.")}</div>
                </div>
              </div>

              <motion.div style={{ background: "#1E1D1A", borderRadius: 14, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#9C9893", letterSpacing: 0.3 }}>{tr("cart.shippingTo", "📦 SHIPPING TO")}</span>
                  {onEditAddress && <button onClick={onEditAddress} style={{ background: "none", border: "none", color: "#FF5C00", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{tr("common.edit", "Edit")}</button>}
                </div>
                {hasAddress ? (
                  <div style={{ fontSize: 12.5, color: "#C9C6C1", lineHeight: 1.55 }}>
                    {addrName && <div style={{ color: "#fff", fontWeight: 600 }}>{addrName}</div>}
                    <div>{m.adres}</div>
                    <div>{cityLine}{m.land ? `, ${m.land}` : ""}</div>
                    {m.telefoon && <div style={{ color: "#9C9893" }}>{m.telefoon}</div>}
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: "#F59E0B" }}>{tr("cart.noAddress", "⚠️ No shipping address yet — tap Edit to add one.")}</div>
                )}
                {/* Onlogisch adres (postcode past niet bij het land) → rode blokkade + Edit. */}
                {hasAddress && !addrValid && (
                  <div style={{ marginTop: 10, background: "rgba(220,38,38,0.14)", border: "1px solid rgba(220,38,38,0.4)", borderRadius: 10, padding: "9px 11px", fontSize: 11.5, color: "#F0997B", lineHeight: 1.5 }}>
                    {tr("cart.addrMismatch", "⚠️ This address looks off — the postal code doesn't match {country}. Tap Edit and fix it before ordering.", { country: m.land || tr("cart.theCountry", "the country") })}
                  </div>
                )}
              </motion.div>

              {items.map((item, i) => {
                const held = isHeld(item);
                return (
                <motion.div layoutId={`citem-${i}`} key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "#1A1917", borderRadius: 12, padding: "8px 10px", marginBottom: 6, opacity: held ? 0.6 : 1 }}>
                  {itemThumb(item)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: held ? "line-through" : "none" }}>{item.product_title}</div>
                    <div style={{ fontSize: 11, color: held ? "#F59E0B" : "#9C9893" }}>{held ? `⏸ ${heldReason(item)}` : tr("cart.itemPcsColor", "{qty} pcs{color}", { qty: item.qty || 1, color: item.kleur ? ` · ${item.kleur}` : "" })}</div>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: held ? "#F59E0B" : "#fff", flexShrink: 0 }}>{held ? "—" : `€${(Number(item.price) * (item.qty || 1)).toFixed(2)}`}</div>
                </motion.div>
                );
              })}

              <motion.div style={{ background: "#1E1D1A", borderRadius: "14px 14px 0 0", padding: "12px 14px", marginTop: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12.5, color: "#9C9893" }}>{tr("cart.lineItems", "Items")}</span>
                  <span style={{ fontSize: 12.5, color: "#fff" }}>€{total.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12.5, color: "#9C9893" }}>{tr("cart.lineDomestic", "Domestic shipping (¥5 × {qty})", { qty: totalQty })}</span>
                  <span style={{ fontSize: 12.5, color: "#fff" }}>€{domestic.toFixed(2)} <span style={{ color: "#9C9893" }}>· ¥{domesticCny}</span></span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12.5, color: "#9C9893" }}>{tr("cart.lineQualityControl", "Quality-control (¥6 × {qty})", { qty: totalQty })}</span>
                  <span style={{ fontSize: 12.5, color: "#fff" }}>€{qc.toFixed(2)} <span style={{ color: "#9C9893" }}>· ¥{qcCny}</span></span>
                </div>
              </motion.div>
              <motion.div style={{ background: "#1E1D1A", borderRadius: "0 0 14px 14px", padding: "12px 14px", marginBottom: 12, borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{tr("cart.totalNow", "Total now")}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: "#FF5C00" }}>€{charge.toFixed(2)}</span>
              </motion.div>

              {/* Wat er nu gebeurt + wanneer het komt — beantwoordt "hoe komt dit bij mij?"
                  op het moment dat de twijfel het grootst is. */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "rgba(255,92,0,0.08)", border: "1px solid rgba(255,92,0,0.22)", borderRadius: 12, padding: "10px 12px", marginBottom: 12 }}>
                <span style={{ fontSize: 14, lineHeight: "18px" }}>🚚</span>
                <span style={{ fontSize: 12, color: "#C9C6C1", lineHeight: 1.55 }}>
                  {tr("cart.deliveryExplainer", "Your items reach our warehouse in about a week — you'll see photos of your actual items there. Ship whenever you're ready; door-to-door is usually 2–4 weeks in total.")}
                </span>
              </div>

              {/* Saldo net te laag → geen doodlopende melding maar meteen het exacte
                  tekort, met de opwaardeerknop eronder bij de betaalknop. */}
              {showShort && (
                <div style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 12, padding: "11px 13px", marginBottom: 12, fontSize: 12, color: "#F0B45B", lineHeight: 1.55 }}>
                  {tr("cart.shortExplain", "Your balance is €{short} short — top up exactly that and you're set.", { short: short.toFixed(2) })}
                  {topUpOver > 0 && <> {tr("cart.shortMinimum", "The minimum top-up is €{min}, so €{rest} stays on your balance for next time.", { min: TOPUP_MIN.toFixed(2), rest: topUpOver.toFixed(2) })}</>}
                </div>
              )}

              {errorBlock}

              {heldCount > 0 && (
                <div style={{ background: "rgba(245,158,11,0.12)", color: "#F59E0B", borderRadius: 10, padding: "10px 13px", fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
                  {tr("cart.heldBannerCheckout", "⏸ {countClause} on hold and won't be charged — we'll only check out your {p} available item{s}. The held {oneClause} in your cart for when {pron} back.", { countClause: heldCount === 1 ? "1 item is" : `${heldCount} items are`, p: payable.length, s: payable.length > 1 ? "s" : "", oneClause: heldCount === 1 ? "one stays" : "ones stay", pron: heldCount === 1 ? "it's" : "they're" })}
                </div>
              )}
              <label style={{ display: "flex", alignItems: "flex-start", gap: 9, marginTop: 12, cursor: "pointer", fontSize: 11, color: "#8A8780", lineHeight: 1.55 }}>
                <span className="fl-check-wrap">
                  <input type="checkbox" className="fl-check-input" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span className="fl-check-box" />
                </span>
                <span>I confirm <b style={{ color: "#C9C6C1" }}>my delivery address above is correct</b>, and I agree to the <a href="/terms" target="_blank" rel="noreferrer" style={{ color: "#A5B4FC" }}>Terms</a> and <a href="/returns-policy" target="_blank" rel="noreferrer" style={{ color: "#A5B4FC" }}>Returns &amp; withdrawal policy</a>. Refunds go to my Flowva balance, and I have a <b style={{ color: "#C9C6C1" }}>14-day right of withdrawal</b>.{" "}
                  {/* Wettelijke informatieplicht (art. 6:230s BW): wie de retour betaalt moet VÓÓR de koop
                      duidelijk zijn, mét kostenindicatie. Staat dit er niet, dan draait Flowva zelf op voor
                      de retourkosten. Retour gaat naar Landgraaf, dus gewoon een EU-pakketje. */}
                  {tr("cart.returnCost", "If I change my mind, I pay for sending the item back — usually €5–€8 within the EU.")}</span>
              </label>
              {paying === "check" ? (
                /* Betaald → de knop wordt een cirkel waarin het vinkje zichzelf tekent */
                <div style={{ display: "flex", justifyContent: "center", marginTop: 14, marginBottom: 6 }}>
                  <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 20 }}
                    style={{ width: 58, height: 58, borderRadius: 29, background: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 26px rgba(255,92,0,0.45)" }}>
                    <motion.svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                      <motion.path d="M4 12.5L9.5 18L20 6.5" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.18, ease: "easeOut" }} />
                    </motion.svg>
                  </motion.div>
                </div>
              ) : (
                <>
                  {showShort ? (
                    /* Te weinig saldo: precies het tekort opwaarderen via iDEAL. Na het
                       betalen komt de klant terug op deze checkout (?resume=cart), ziet in
                       het eilandje dat het saldo klopt, en drukt alsnog op Order & pay. */
                    <>
                      {topErr && (
                        <div style={{ background: "#FEE2E2", color: "#DC2626", borderRadius: 10, padding: "10px 14px", fontSize: 12.5, marginTop: 10 }}>{topErr}</div>
                      )}
                      {PRELAUNCH ? (
                        <div style={{ width: "100%", boxSizing: "border-box", marginTop: 10, background: "#1E1D1A", color: "#fff", borderRadius: 14, padding: "15px", fontSize: 14, fontWeight: 700, textAlign: "center" }}>
                          {tr("cart.launchesOn", "Flowva launches {date} →", { date: LAUNCH_DATE_LABEL })}
                        </div>
                      ) : (
                        <motion.button whileTap={topping || !agreed ? undefined : { scale: 0.97 }} onClick={doTopUp} disabled={topping || !agreed}
                          style={{ width: "100%", marginTop: 10, background: topping ? "#333" : !agreed ? "#444" : "#FF5C00", color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontSize: 15, fontWeight: 700, cursor: topping || !agreed ? "default" : "pointer", WebkitTapHighlightColor: "transparent" }}>
                          {topping ? tr("cart.openingIdeal", "Opening iDEAL…") : !agreed ? tr("cart.tickBoxToContinue", "Tick the box to continue") : tr("cart.topUpExact", "Top up €{amount} & continue →", { amount: topUpAmount.toFixed(2) })}
                        </motion.button>
                      )}
                      {onTopUp && !PRELAUNCH && (
                        <motion.button whileTap={{ scale: 0.97 }} onClick={onTopUp}
                          style={{ width: "100%", marginTop: 8, background: "transparent", color: "#C9C6C1", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14, padding: "13px", fontSize: 13, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                          {tr("cart.topUpOther", "Top up a different amount")}
                        </motion.button>
                      )}
                    </>
                  ) : (
                  // Zonder adres is dit een échte actieknop (opent login/adres-editor) — een
                  // uitgeschakelde knop met "voeg een adres toe" erop leest als kapot.
                  <motion.button whileTap={sending || (hasAddress && (!addrValid || !payable.length || !agreed)) ? undefined : { scale: 0.97 }} onClick={!hasAddress ? onEditAddress : confirmAndPay} disabled={sending || (hasAddress && (!addrValid || payable.length === 0 || !agreed))}
                    style={{ width: "100%", marginTop: 10, background: sending ? "#333" : !hasAddress ? "#FF5C00" : (!addrValid || !payable.length || !agreed) ? "#444" : "#FF5C00", color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontSize: 15, fontWeight: 700, cursor: sending || (hasAddress && (!addrValid || !payable.length || !agreed)) ? "default" : "pointer", WebkitTapHighlightColor: "transparent" }}>
                    {sending ? tr("cart.processingPayment", "Processing payment…") : !hasAddress ? tr("cart.addAddressToContinue", "Add an address to continue") : payable.length === 0 ? tr("cart.allOnHold", "All items are on hold") : !agreed ? tr("cart.tickBoxToContinue", "Tick the box to continue") : heldCount > 0 ? tr("cart.payForRest", "Order & pay €{amount} for the rest →", { amount: charge.toFixed(2) }) : tr("cart.payButton", "Order & pay €{amount} →", { amount: charge.toFixed(2) })}
                  </motion.button>
                  )}

                  <motion.button whileTap={{ scale: 0.97 }} onClick={() => setView("cart")}
                    style={{ width: "100%", marginTop: 8, background: "transparent", color: "#C9C6C1", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14, padding: "13px", fontSize: 13, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                    {tr("cart.backToCart", "← Back to cart")}
                  </motion.button>
                </>
              )}
            </motion.div>
          ) : (
            <motion.div key="placed">
              <ConfettiBurst />
              <div style={{ textAlign: "center", marginBottom: 22, marginTop: 4 }}>
                <motion.span layoutId="cart-fox" style={{ fontSize: 52, display: "inline-block", marginBottom: 12 }}><Fox /></motion.span>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#FF5C00", marginBottom: 6 }}>{tr("product.orderSuccess.title", "Order placed! 🎉")}</div>
                <div style={{ fontSize: 13, color: "#888" }}>{tr("product.orderSuccess.subtitle", "We're getting it from the factory:")}</div>
              </div>
              {heldCount > 0 && (
                <div style={{ background: "rgba(245,158,11,0.12)", color: "#F59E0B", borderRadius: 10, padding: "10px 13px", fontSize: 12, marginBottom: 16, lineHeight: 1.5, textAlign: "center" }}>
                  {tr("cart.heldBannerPlaced", "⏸ {countClause} still on hold — saved in your cart for when {pron} available again.", { countClause: heldCount === 1 ? "1 item is" : `${heldCount} items are`, pron: heldCount === 1 ? "it's" : "they're" })}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
                {[
                  { icon: "🛒", text: tr("product.orderSuccess.step.buying", "Buying your item from the supplier"), lid: "ck-ship" },
                  { icon: "📸", text: tr("product.orderSuccess.step.photos", "Taking quality-control photos"), lid: "ck-items" },
                  { icon: "🏭", text: tr("product.orderSuccess.step.storing", "Storing it safely in the warehouse"), lid: "ck-total" },
                  { icon: "✈️", text: tr("product.orderSuccess.step.shipping", "Shipping it to your door"), lid: "ck-boat" },
                ].map((s) => (
                  <motion.div key={s.lid} style={{ display: "flex", alignItems: "center", gap: 12, background: "#1A1917", borderRadius: 10, padding: "12px 14px" }}>
                    <span style={{ fontSize: 18 }}>{s.icon}</span>
                    <span style={{ fontSize: 13, color: "#CCC" }}>{s.text}</span>
                  </motion.div>
                ))}
              </div>
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => onFinish?.(true)}
                style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontSize: 15, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                {tr("product.orderSuccess.trackCta", "Track it in Orders →")}
              </motion.button>
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => onFinish?.(false)}
                style={{ width: "100%", marginTop: 8, background: "transparent", color: "#888", border: "none", borderRadius: 14, padding: "13px", fontSize: 13, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                {tr("product.orderSuccess.backToFeed", "Back to feed")}
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

// Nette naam per transactiesoort. Deze lijst was incompleet — fulfillment,
// currency_fee, domestic_shipping en qc_fee stonden er niet in, waardoor de klant
// de ruwe databasenaam te zien kreeg. Nu alle negen soorten, in mensentaal.
const TX_LABEL = {
  top_up:            () => tr("tx.line.topUp", "Money added"),
  order:             () => tr("tx.line.products", "Products"),
  domestic_shipping: () => tr("tx.line.domestic", "Shipping inside China"),
  qc_fee:            () => tr("tx.line.qc", "Quality-control + photos"),
  shipping:          () => tr("tx.line.shipping", "International shipping"),
  fulfillment:       () => tr("tx.line.fulfillment", "Packing & handling"),
  service_fee:       () => tr("cart.lineServiceFee", "Service fee"),
  currency_fee:      () => tr("tx.line.currency", "Currency conversion"),
  storage_fee:       () => tr("cart.lineStorageFee", "Extended storage"),
  refund:            () => tr("tx.line.refund", "Refunded"),
  return_refund:     () => tr("tx.line.returnRefund", "Return refund"),
  buffer_return:     () => tr("tx.line.bufferRefund", "Shipping refund"),
  shipping_refund:   () => tr("tx.line.bufferRefund", "Shipping refund"),
  // 3% conversie over het teruggegeven verzenddeel — daar is nooit yuan voor gekocht.
  currency_fee_refund: () => tr("tx.line.currencyRefund", "Currency conversion refunded"),
  payout:            () => tr("tx.line.payout", "Paid out to your bank"),
  payout_reversed:   () => tr("tx.line.payoutReversed", "Payout could not be sent — returned to your balance"),
  extra_service:     () => tr("tx.line.extraService", "Extra service"),
};
const txLabel = (type) => (TX_LABEL[type] ? TX_LABEL[type]() : type);
// Leesvolgorde op de bon: eerst wat je kocht, dan de weg die het aflegt, dan onze
// fee. Onbekende soorten belanden achteraan (indexOf → -1).
const TX_ORDER = ["top_up", "order", "domestic_shipping", "qc_fee", "shipping",
  "fulfillment", "currency_fee", "service_fee", "storage_fee", "extra_service",
  "refund", "return_refund", "buffer_return"];

// Eén bon = alle transactieregels van hetzelfde moment. Dat kán omdat elke betaling
// z'n regels in één database-transactie wegschrijft, dus ze delen created_at EXACT.
// Zo hoeven de geldfuncties niet aangepast te worden voor deze weergave.
function buildReceipt(at, lines, orderById, haulByTime) {
  const has = (type) => lines.some((l) => l.type === type);
  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  const orders = [...new Set(lines.map((l) => l.order_id).filter(Boolean))]
    .map((id) => orderById.get(id)).filter(Boolean);
  const kind = has("top_up") ? "topup"
    : has("order") ? "purchase"
    : has("shipping") ? "shipment"
    : total > 0 ? "refund"
    : has("storage_fee") ? "storage"
    : "other";
  // Verzendregels hebben geen order_id, maar het pakket wordt in dezelfde
  // database-transactie aangemaakt → zelfde tijdstip, dus een exacte match.
  // orderById gaat mee zodat de pakketinhoud (order-ID's) opzoekbaar blijft.
  return { at, lines, total, orders, kind, orderById,
    haul: kind === "shipment" ? (haulByTime.get(at) || null) : null };
}

// Waarom kreeg je geld terug? Alleen benoemen wat de order écht zegt — niet gokken.
function refundReason(order) {
  if (!order) return null;
  if (order.return_status) return tr("tx.reason.returned", "you returned this item");
  if (order.defect_detected_at || order.defect_choice) return tr("tx.reason.defect", "quality issue found at inspection");
  if (order.status === "cancelled") return tr("tx.reason.cancelled", "order could not be completed");
  return null;
}

function TransactionHistory({ session }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [openAt, setOpenAt] = useState(null);   // welke bon staat uitgeklapt

  useEffect(() => {
    if (!show) return;
    let alive = true;
    (async () => {
      const [txRes, haulsRes] = await Promise.all([
        supabase.from("transactions").select("*")
          .eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(150),
        supabase.from("hauls").select("created_at, service_name, items, tracking_no, paid_eur")
          .eq("user_id", session.user.id).limit(60),
      ]);
      const rows = txRes.data || [];
      const hauls = haulsRes.data || [];
      const byTime = new Map();
      for (const t of rows) {
        if (!byTime.has(t.created_at)) byTime.set(t.created_at, []);
        byTime.get(t.created_at).push(t);
      }
      // hauls.items is een lijst ORDER-ID's (strings), geen objecten — die orders
      // moeten dus mee in dezelfde ophaal-ronde, anders blijft de pakketinhoud leeg.
      const haulOrderIds = hauls.flatMap((h) => (Array.isArray(h.items) ? h.items : []))
        .filter((x) => typeof x === "string");
      const orderIds = [...new Set([...rows.map((t) => t.order_id), ...haulOrderIds].filter(Boolean))];
      const ordersRes = orderIds.length
        ? await supabase.from("orders")
            .select("id, product, product_title, qty, price, kleur, maat, variant_image, qc_images, status, return_status, defect_detected_at, defect_choice")
            .in("id", orderIds)
        : { data: [] };
      if (!alive) return;
      const orderById = new Map((ordersRes.data || []).map((o) => [o.id, o]));
      const haulByTime = new Map(hauls.map((h) => [h.created_at, h]));
      setGroups([...byTime.entries()].map(([at, lines]) => buildReceipt(at, lines, orderById, haulByTime)));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [show]);

  const stamp = (at) => new Date(at).toLocaleString("en-GB",
    { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const title = (g) => {
    if (g.kind === "topup") return tr("tx.title.topUp", "Money added to your balance");
    if (g.kind === "purchase") {
      const n = g.orders.length || g.lines.filter((l) => l.type === "order").length;
      return tr("tx.title.order", "Order · {n} item{s}", { n, s: n > 1 ? "s" : "" });
    }
    if (g.kind === "shipment") return tr("tx.title.shipment", "Parcel shipped");
    if (g.kind === "refund") {
      const name = g.orders[0]?.product_title || g.orders[0]?.product;
      return name ? tr("tx.title.refundOf", "Refund · {name}", { name }) : tr("tx.line.refund", "Refunded");
    }
    if (g.kind === "storage") return tr("cart.lineStorageFee", "Extended storage");
    return txLabel(g.lines[0]?.type);
  };

  const icon = (g) => ({ topup: "＋", purchase: "🛍", shipment: "✈️", refund: "↩︎", storage: "📦" }[g.kind] || "•");

  const thumb = (src) => (
    <div style={{ width: 34, height: 34, borderRadius: 8, background: "#F8F7F4", border: "1px solid #F0EEE8", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {src ? <img src={src} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 14 }}>📦</span>}
    </div>
  );

  const costRow = (label, amount, key) => (
    <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12 }}>
      <span style={{ color: "#8A8780" }}>{label}</span>
      <span style={{ color: "#0F0E0C", fontWeight: 600 }}>€{Math.abs(Number(amount)).toFixed(2)}</span>
    </div>
  );

  // De uitgeklapte bon: wát je kocht (of wat er in het pakket zat) en waar het
  // geld naartoe ging — met datum én tijd, want dat vroeg niemand voor niets.
  const receipt = (g) => (
    <div style={{ background: "#F8F7F4", borderRadius: 12, padding: "11px 13px", margin: "2px 0 10px" }}>
      {g.kind === "purchase" && g.orders.length > 0 && (
        <div style={{ marginBottom: 9 }}>
          {g.orders.map((o) => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0" }}>
              {thumb(o.variant_image || o.qc_images?.[0])}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#0F0E0C", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.product_title || o.product}</div>
                <div style={{ fontSize: 10.5, color: "#A8A5A0" }}>
                  {[o.qty ? tr("tx.pcs", "{qty} pcs", { qty: o.qty }) : null, o.maat, o.kleur].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0F0E0C", flexShrink: 0 }}>€{Number(o.price || 0).toFixed(2)}</div>
            </div>
          ))}
        </div>
      )}

      {g.kind === "shipment" && g.haul && (
        <div style={{ marginBottom: 9 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, color: "#A8A5A0", marginBottom: 5 }}>
            {tr("tx.inThisParcel", "IN THIS PARCEL")}{g.haul.service_name ? ` · ${g.haul.service_name}` : ""}
          </div>
          {(Array.isArray(g.haul.items) ? g.haul.items : []).map((raw, i) => {
            // items zijn order-ID's; oudere/andere pakketten kunnen objecten bevatten.
            const o = typeof raw === "string" ? g.orderById?.get(raw) : raw;
            if (!o) return null;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px 0" }}>
                {thumb(o.variant_image || o.image || o.qc_images?.[0])}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "#0F0E0C", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {o.product_title || o.product || tr("tx.item", "Item")}
                  </div>
                  {(o.maat || o.kleur) && (
                    <div style={{ fontSize: 10.5, color: "#A8A5A0" }}>{[o.maat, o.kleur].filter(Boolean).join(" · ")}</div>
                  )}
                </div>
              </div>
            );
          })}
          {g.haul.tracking_no && (
            <div style={{ fontSize: 10.5, color: "#A8A5A0", marginTop: 4 }}>{tr("tx.tracking", "Tracking")}: {g.haul.tracking_no}</div>
          )}
        </div>
      )}

      {g.kind === "refund" && (() => { const why = refundReason(g.orders[0]); return why ? (
        <div style={{ fontSize: 11.5, color: "#8A8780", marginBottom: 8, lineHeight: 1.5 }}>{tr("tx.refundBecause", "Refunded because {why}.", { why })}</div>
      ) : null; })()}

      {/* Gelijke soorten samentellen: een mand met 2 items schreef 2× 'order', wat
          hier twee keer "Products" opleverde terwijl de prijzen al per stuk boven
          staan. Eén regel per soort, in een vaste leesbare volgorde. */}
      <div style={{ borderTop: "1px solid #ECEAE5", paddingTop: 7 }}>
        {(() => {
          const sum = new Map();
          for (const l of g.lines) sum.set(l.type, (sum.get(l.type) || 0) + Number(l.amount || 0));
          return [...sum.entries()]
            .sort((a, b) => TX_ORDER.indexOf(a[0]) - TX_ORDER.indexOf(b[0]))
            .map(([type, amount]) => costRow(txLabel(type), amount, type));
        })()}
      </div>
      <div style={{ borderTop: "1px solid #E3E1DC", marginTop: 6, paddingTop: 7, display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
        <span style={{ fontWeight: 700, color: "#0F0E0C" }}>{g.total > 0 ? tr("tx.totalAdded", "Added in total") : tr("tx.totalPaid", "Paid in total")}</span>
        <span style={{ fontWeight: 800, color: g.total > 0 ? "#10B981" : "#0F0E0C" }}>€{Math.abs(g.total).toFixed(2)}</span>
      </div>
      <div style={{ fontSize: 10.5, color: "#A8A5A0", marginTop: 6 }}>{stamp(g.at)}</div>
    </div>
  );

  return (
    <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "16px 20px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: show ? 12 : 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C" }}>{tr("tx.title", "Transaction history")}</div>
        <motion.button whileTap={{ scale: 0.9 }} transition={springSnappy} onClick={() => setShow(!show)} style={{ background: "none", border: "none", fontSize: 12, color: "#6366F1", cursor: "pointer", fontWeight: 600, WebkitTapHighlightColor: "transparent" }}>{show ? tr("common.hide", "Hide") : tr("common.show", "Show")}</motion.button>
      </div>
      <AnimatePresence initial={false}>
        {show && (
          <motion.div key="txbody" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ height: { duration: 0.3, ease: [0.4, 0, 0.2, 1] }, opacity: { duration: 0.2 } }} style={{ overflow: "hidden" }}>
            {loading ? <div style={{ textAlign: "center", padding: 20, color: "#aaa", fontSize: 13 }}>{tr("common.loading", "Loading...")}</div> :
            groups.length === 0 ? <div style={{ textAlign: "center", padding: 20, color: "#aaa", fontSize: 13 }}>{tr("tx.empty", "No transactions yet")}</div> :
            groups.map((g, i) => {
              const isOpen = openAt === g.at;
              return (
                <motion.div key={g.at} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ ...springSoft, delay: Math.min(i, 8) * 0.04 }}>
                  <motion.div whileTap={{ scale: 0.985 }} onClick={() => setOpenAt(isOpen ? null : g.at)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", cursor: "pointer", borderBottom: isOpen || i === groups.length - 1 ? "none" : "1px solid #F0EEE8", WebkitTapHighlightColor: "transparent" }}>
                    <span style={{ fontSize: 15, width: 20, textAlign: "center", flexShrink: 0 }} aria-hidden>{icon(g)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title(g)}</div>
                      <div style={{ fontSize: 11, color: "#A8A5A0" }}>{stamp(g.at)}</div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: g.total > 0 ? "#10B981" : "#EF4444", flexShrink: 0 }}>
                      {g.total > 0 ? "+" : "−"}€{Math.abs(g.total).toFixed(2)}
                    </div>
                    <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={springSnappy} style={{ display: "inline-flex", flexShrink: 0 }}>
                      <ChevronDown size={15} color="#C4C1BB" strokeWidth={2.5} />
                    </motion.span>
                  </motion.div>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div key="rcpt" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                        transition={{ height: { duration: 0.25, ease: [0.4, 0, 0.2, 1] }, opacity: { duration: 0.18 } }} style={{ overflow: "hidden" }}>
                        {receipt(g)}
                      </motion.div>
                    )}
                  </AnimatePresence>
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
    provincie: meta.provincie || "",
    land: normalizeCountry(meta.land) || "Netherlands",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const inputStyle = { width: "100%", border: "1px solid #E8E6E0", borderRadius: 10, padding: "11px 13px", fontSize: 13, background: "#F8F7F4", boxSizing: "border-box", outline: "none" };
  const labelStyle = { fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4, display: "block" };
  // ── Validatie: alle velden verplicht + postcode moet bij het land passen ──────────────
  const blank = (v) => !String(v || "").trim();
  const needsProvince = !!EU_PROVINCES[form.land];
  const pcBad = !blank(form.postcode) && !isValidPostcode(form.land, form.postcode);
  const miss = {
    voornaam: blank(form.voornaam), achternaam: blank(form.achternaam), telefoon: blank(form.telefoon),
    adres: blank(form.adres), postcode: blank(form.postcode), stad: blank(form.stad),
    provincie: needsProvince && blank(form.provincie),
  };
  const incomplete = Object.values(miss).some(Boolean);
  const canSave = !incomplete && !pcBad;
  const errBorder = (bad) => bad ? { border: "1px solid #DC2626", background: "#FEF2F2" } : {};

  const save = async () => {
    if (!canSave) return;
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
          <div><label style={labelStyle}>First name</label><input style={{ ...inputStyle, ...errBorder(miss.voornaam) }} value={form.voornaam} onChange={e => set("voornaam", e.target.value)} /></div>
          <div><label style={labelStyle}>Last name</label><input style={{ ...inputStyle, ...errBorder(miss.achternaam) }} value={form.achternaam} onChange={e => set("achternaam", e.target.value)} /></div>
        </div>
        <div style={{ marginBottom: 10 }}><label style={labelStyle}>Phone</label><input style={{ ...inputStyle, ...errBorder(miss.telefoon) }} value={form.telefoon} onChange={e => set("telefoon", e.target.value)} /></div>
        <div style={{ marginBottom: 10 }}><label style={labelStyle}>Address (street + no.)</label><input style={{ ...inputStyle, ...errBorder(miss.adres) }} value={form.adres} onChange={e => set("adres", e.target.value)} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginBottom: pcBad ? 4 : 10 }}>
          <div><label style={labelStyle}>Postal code</label><input style={{ ...inputStyle, ...errBorder(miss.postcode || pcBad) }} value={form.postcode} onChange={e => set("postcode", e.target.value)} /></div>
          <div><label style={labelStyle}>City</label><input style={{ ...inputStyle, ...errBorder(miss.stad) }} value={form.stad} onChange={e => set("stad", e.target.value)} /></div>
        </div>
        {pcBad && <div style={{ fontSize: 11.5, color: "#DC2626", marginBottom: 10 }}>Enter a valid {form.land} postal code{POSTCODE_EXAMPLE[form.land] ? ` — e.g. ${POSTCODE_EXAMPLE[form.land]}` : ""}.</div>}
        <div style={{ marginBottom: 10 }}><label style={labelStyle}>Province</label>
          {EU_PROVINCES[form.land]
            ? <select style={{ ...inputStyle, ...errBorder(miss.provincie) }} value={form.provincie} onChange={e => set("provincie", e.target.value)}>
                <option value="">Select your province…</option>
                {EU_PROVINCES[form.land].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            : <input style={{ ...inputStyle, ...errBorder(miss.provincie) }} value={form.provincie} onChange={e => set("provincie", e.target.value)} placeholder="Province / state / region" />}
        </div>
        <div style={{ marginBottom: 18 }}><label style={labelStyle}>Country</label>
          <select style={inputStyle} value={form.land} onChange={e => { set("land", e.target.value); set("provincie", ""); }}>
            {form.land && !EU_COUNTRIES.includes(form.land) && <option value={form.land}>{form.land}</option>}
            {EU_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {!canSave && <div style={{ fontSize: 11.5, color: "#92400E", marginBottom: 8, textAlign: "center" }}>{incomplete ? "Please fill in all fields to save." : "Check your postal code to save."}</div>}
        <motion.button whileTap={saving || !canSave ? undefined : { scale: 0.97 }} onClick={save} disabled={saving || !canSave}
          style={{ width: "100%", background: (saving || !canSave) ? "#E8E6E0" : "#FF5C00", color: (saving || !canSave) ? "#9C9893" : "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, cursor: (saving || !canSave) ? "default" : "pointer", WebkitTapHighlightColor: "transparent" }}>
          {saving ? "Saving..." : "Save"}
        </motion.button>
      </motion.div>
    </>
  );
}
// ── WELKOM (2026-08-13) ──────────────────────────────────────────────────────
// De eerste indruk: een kort verhaal in zes tikken in plaats van een lijstje met
// zeven features. De vos vertelt één bestelling na, gedragen door ECHTE foto's uit
// het magazijn — de knopen op de modelfoto komen terug op de meetfoto, dus je ziet
// dat het hetzelfde kledingstuk is. Bewijs verslaat beloftes.
// Slot: de vos geeft toe dat het veel is en stuurt je gewoon de winkel in.
// De volledige feature-tour is niet weg — die zit achter de ?-knop in de feed-header.
const WELCOME_QC = [1, 2, 3, 4, 5, 6, 7];   // public/intro-qc1..7.webp — 3 controle- + 4 meetfoto's
function WelcomeSheet({ onClose, onTour }) {
  const tr = useTr();
  const { setLang } = useLang();
  const needLang = !hasChosenLang();
  const [beat, setBeat] = useState(0);        // 0 = vos dead-center · 1 = wolk staat er
  const [step, setStep] = useState(0);        // 0 groet · 1 taal · 2 bestellen · 3 controle · 4 magazijn · 5 slot
  useBodyScrollLock(true);
  const morph = { type: "spring", stiffness: 260, damping: 26 };

  useEffect(() => { const t = setTimeout(() => setBeat(1), 560); return () => clearTimeout(t); }, []);
  // De foto's van de volgende stap alvast in de browsercache (buiten de DOM, dus
  // geen onzichtbare kopieën in de pagina) — anders flitsen ze in bij stap 3.
  useEffect(() => {
    if (step < 2) return;
    WELCOME_QC.forEach((n) => { const i = new Image(); i.src = `/intro-qc${n}.webp`; });
  }, [step]);

  // Tik = één stap verder. Tijdens het taal kiezen doet tikken niets (kies een taal).
  const advance = () => {
    if (step >= 5) return;
    if (step === 0) { setStep(needLang ? 1 : 2); return; }
    if (step === 1) return;
    setStep((s) => s + 1);
  };
  const chooseLang = (code) => { setLang(code); setStep(2); };
  const foxSide = step === 0 ? "left" : "right";
  const bubbleText =
    step === 0 ? tr("welcome.greeting", "Hey! First time shopping from China? I'll walk you through it.")
    : step === 1 ? tr("welcome.langSay", "Set your language to your preference!")
    : step === 2 ? tr("welcome.sayOrder", "Here's a quick example of how ordering works.")
    : step === 3 ? tr("welcome.sayCheck", "Before it ships internationally, we photograph and measure your actual item — and you get every photo in your Orders tab.")
    : step === 4 ? tr("welcome.sayWarehouse", "After the check, everything waits safely in our warehouse — free for 30 days. You bundle whatever you want into one parcel, and that's what flies to your door.")
    : tr("welcome.sayFinal", "But don't worry about that yet — have a look around first and see if you like what you find.");
  // Tweede regel ín de wolk, onder een haarlijn en in oranje: de zin die de meeste
  // aandacht verdient (Kaito) — de opdracht bij de foto, en de 100%-garantie.
  const bubbleAccent =
    step === 2 ? tr("welcome.capOrder", "Say you ordered this.")
    : step === 3 ? tr("welcome.sayRefund", "Something wrong? Send it back and get 100% of your money back.")
    : null;
  const caption = (t) => (
    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", textAlign: "center", marginTop: 10, lineHeight: 1.45 }}>{t}</div>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={advance}
      style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(9px)", WebkitBackdropFilter: "blur(9px)", display: "flex", flexDirection: "column", alignItems: "center", overflowY: "auto", overscrollBehavior: "contain", padding: "0 22px 40px", cursor: step >= 5 ? "default" : "pointer" }}>


      {/* VOS dead-center tot de wolk verschijnt */}
      {beat === 0 && (
        <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <motion.span layoutId="welcome-fox" transition={{ layout: morph }}
            style={{ fontSize: 58, lineHeight: 1, display: "inline-block", filter: "drop-shadow(0 12px 30px rgba(0,0,0,0.5))" }}><Fox /></motion.span>
        </div>
      )}

      <div style={{ width: "100%", maxWidth: 360, marginTop: "min(9vh, 70px)", paddingBottom: 24, display: "flex", flexDirection: "column", alignItems: "center" }}>
        {beat >= 1 && (
          <div style={{ position: "relative", maxWidth: 300, marginBottom: 24 }}>
            <motion.div layout transition={{ layout: morph }}
              style={{ background: "#1E1D1A", color: "#fff", borderRadius: 18, padding: "13px 17px", boxShadow: "0 12px 36px rgba(0,0,0,0.45)" }}>
              <span style={{ fontSize: 14.5, lineHeight: 1.55, fontWeight: 600, textAlign: "center", display: "block" }}>
                <WordReveal key={bubbleText} text={bubbleText} delay={0.2} stagger={0.05} />
              </span>
              {bubbleAccent && (
                <>
                  <motion.div initial={{ opacity: 0, scaleX: 0.3 }} animate={{ opacity: 1, scaleX: 1 }}
                    transition={{ delay: 0.2 + bubbleText.split(" ").length * 0.05, duration: 0.35 }}
                    style={{ height: 1, background: "rgba(255,255,255,0.18)", margin: "11px 0 10px", transformOrigin: "center" }} />
                  <span style={{ fontSize: 14.5, lineHeight: 1.5, fontWeight: 800, color: "#FF8A3D", textAlign: "center", display: "block" }}>
                    <WordReveal key={bubbleAccent} text={bubbleAccent} delay={0.3 + bubbleText.split(" ").length * 0.05} stagger={0.05} />
                  </span>
                </>
              )}
            </motion.div>
            {/* dubbele tail — cross-fade als de vos van links naar rechts springt */}
            <motion.div aria-hidden animate={{ opacity: foxSide === "left" ? 1 : 0 }} transition={{ duration: 0.22 }}
              style={{ position: "absolute", left: -8, bottom: 13, width: 0, height: 0, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderRight: "9px solid #1E1D1A" }} />
            <motion.div aria-hidden animate={{ opacity: foxSide === "right" ? 1 : 0 }} transition={{ duration: 0.22 }}
              style={{ position: "absolute", right: -8, bottom: 13, width: 0, height: 0, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderLeft: "9px solid #1E1D1A" }} />
            <motion.span layoutId="welcome-fox" transition={{ layout: morph }}
              style={{ position: "absolute", bottom: -2, [foxSide]: -38, fontSize: 34, lineHeight: 1, display: "inline-block" }}><Fox /></motion.span>
          </div>
        )}

        {/* TAAL — stap 1 */}
        {beat >= 1 && step === 1 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springSoft}
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%" }}>
            {LANGS.map((l) => (
              <motion.button key={l.code} whileTap={{ scale: 0.96 }} onClick={(e) => { e.stopPropagation(); chooseLang(l.code); }}
                style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 13, padding: "12px 14px", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", textAlign: "left", pointerEvents: "auto", WebkitTapHighlightColor: "transparent" }}>
                <span style={{ fontSize: 20, lineHeight: 1 }}>{l.flag}</span>
                <span>{l.label}</span>
              </motion.button>
            ))}
          </motion.div>
        )}

        {/* STAP 2 — "stel dat je dit bestelt": de modelfoto groot en volledig */}
        {step === 2 && (
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={springSoft} style={{ width: "100%" }}>
            <div style={{ borderRadius: 16, overflow: "hidden", background: "rgba(255,255,255,0.06)" }}>
              <img src="/intro-model.webp" alt="" style={{ width: "100%", display: "block" }} />
            </div>
          </motion.div>
        )}

        {/* STAP 3 — wat wij ermee doen: alle zeven échte foto's */}
        {step === 3 && (
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={springSoft} style={{ width: "100%" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7 }}>
              {WELCOME_QC.map((n, i) => (
                <motion.div key={n} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.12 + i * 0.055, ...springSoft }}
                  style={{ aspectRatio: "1 / 1", borderRadius: 10, overflow: "hidden", background: "rgba(255,255,255,0.06)" }}>
                  <img src={`/intro-qc${n}.webp`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </motion.div>
              ))}
            </div>
            {caption(tr("welcome.capCheck", "Real photos from a real order — yours arrive the same way."))}
          </motion.div>
        )}

        {/* STAP 4 — magazijn: één groot pakket-icoon, zelfde bel-moment als de tour */}
        {step === 4 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={springSoft}
            style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", padding: "18px 0 4px" }}>
            <motion.span initial={{ scale: 0.5 }} animate={{ scale: 1, rotate: [0, -18, 12, -6, 0] }}
              transition={{ scale: springSoft, rotate: { duration: 0.72, ease: [0.32, 0.72, 0, 1], delay: 0.1 } }}
              style={{ fontSize: 74, lineHeight: 1, display: "inline-block", filter: "drop-shadow(0 12px 30px rgba(255,92,0,0.35))" }}>📦</motion.span>
            {caption(tr("welcome.capWarehouse", "30 days free storage — you decide when it ships."))}
          </motion.div>
        )}

        {/* STAP 5 — slot: de winkel in, of alsnog de volledige uitleg */}
        {step === 5 && (
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, ...springSoft }} style={{ width: "100%" }}>
            <motion.button whileTap={{ scale: 0.97 }} onClick={(e) => { e.stopPropagation(); onClose(); }}
              style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 13, padding: "15px", fontSize: 15, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
              {tr("tour.cta", "Start shopping")} <Fox />
            </motion.button>
            <button onClick={(e) => { e.stopPropagation(); onTour(); }}
              style={{ width: "100%", marginTop: 10, background: "none", border: "none", color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 8 }}>
              {tr("welcome.demo", "Want the full picture? See the next demo")} →
            </button>
          </motion.div>
        )}
      </div>

      {/* tap-hint zolang er nog een stap volgt — als pilletje, want de kale tekst
          was op een drukke achtergrond nauwelijks te zien (Kaito 13-08). */}
      {beat >= 1 && step !== 1 && step < 5 && (
        <motion.div animate={{ opacity: [0.65, 1, 0.65] }} transition={{ duration: 1.7, repeat: Infinity, ease: "easeInOut" }}
          style={{ position: "fixed", bottom: 24, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
          <span style={{ background: "rgba(20,19,17,0.82)", border: "1px solid rgba(255,255,255,0.16)", color: "#fff", fontSize: 13.5, fontWeight: 700, padding: "9px 18px", borderRadius: 22, boxShadow: "0 6px 20px rgba(0,0,0,0.4)", whiteSpace: "nowrap" }}>
            {tr("tour.tap", "tap to continue")}
          </span>
        </motion.div>
      )}
    </motion.div>
  );
}

// Altijd bereikbare uitleg-pagina (Profile + ?-knop in de feed) —
// als VOS-GELEIDE TOUR met de bel-choreografie uit HypeCheck: per stop verschijnt
// het icoon GROOT op het podium, schudt, de vos legt 'm woord-voor-woord uit, en
// het icoon morpht (shared layoutId) z'n plek in de route in. De vos schuift mee
// omlaag met elke gelande stop. Tik = versnellen; Skip = alles meteen.
const HIW_STOPS = [
  { icon: "🏷️", key: "factory", title: "Authentic Chinese brands", sub: "not available in Europe", say: "Shop authentic Chinese brands that are not available in Europe. ⭐" },
  { icon: "🛍️", key: "buy", title: "We buy it for you", sub: "Buying from China made effortless", say: "I handle the buying process for you." },
  { icon: "🏬", key: "warehouse", title: "Stored in our warehouse", sub: "30 days free storage", say: "Your items stay safely stored in our warehouse — free for 30 days." },
  { icon: "📸", key: "photos", title: "Quality-control photos", sub: "Approve before shipping — return possible for defects", say: "Before anything ships, we photograph and measure your actual item." },
  { icon: "📦", key: "parcel", title: "One parcel — taxes paid", sub: "bundling = cheaper per item", say: "Everything ships together in one parcel — taxes and import fees are included." },
  { icon: "💸", key: "value", title: "Cut out the middleman", sub: "No retail markup.", say: "Pay local Chinese prices, without the European retail markup." },
];
const HIW_INTRO = "Hey, let's explore Flowva together!";
const HIW_GOLDEN = "With Flowva Friends, you share a parcel with friends, reducing shipping costs for everyone.";
function HowItWorksSheet({ onClose }) {
  // FULLSCREEN vos-tour op de WAZIGE feed (géén witte kaart). De vos + spraakwolk staan
  // ALTIJD gecentreerd bovenaan en bewegen NIET mee; de stappen groeien eronder naar onder.
  // Beats:
  //  0→1  vos verschijnt dead-center en morpht (layoutId "hiw-fox") naar de LINKERonderhoek
  //       van de wolk; de wolk fadet in het midden in met woord-voor-woord tekst.
  //  tik  vos morpht naar de RECHTERkant (tail flipt links→rechts, tegelijk/smooth), de wolk
  //       blijft exact staan en morpht naar de eerste stap-zin; de eerste emoji verschijnt
  //       GROOT onder de wolk en schudt (bel-moment).
  //  tik  de grote emoji krimpt op z'n plek in een compacte rij (titel schuift ernaast) en de
  //       volgende emoji verschijnt eronder groot → zo zakt de actieve emoji langzaam omlaag.
  //       De wolk morpht steeds mee van grootte (layout), dat is clean.
  const tr = useTr();
  const { setLang } = useLang();
  const [beat, setBeat] = useState(0);          // 0 = vos dead-center · 1 = wolk zichtbaar
  const [step, setStep] = useState(-1);         // -1 intro · 0..5 actieve stap · 6 klaar
  const [langPicking, setLangPicking] = useState(false);
  // De taalkeuze zit sinds 13-08 in het WELKOMSTSCHERM (dat komt altijd als eerste),
  // dus deze tour begint meteen bij de eerste stop.
  const needLang = false;
  useBodyScrollLock(true);                       // feed erachter niet mee laten scrollen (anders verschuiven de anchors)
  const done = step >= HIW_STOPS.length;
  const foxSide = (step >= 0 || done) ? "right" : "left";
  const bubbleText = done ? tr("tour.golden", HIW_GOLDEN)
    : step >= 0 ? tr("tour." + HIW_STOPS[step].key + ".say", HIW_STOPS[step].say)
    : langPicking ? "Set your language to your preference!"          // pre-selectie → Engels
    : tr("tour.greeting", HIW_INTRO);
  const awaitingTap = !done && !langPicking && (step === -1 ? beat >= 1 : true);
  const activeCount = done ? HIW_STOPS.length : step + 1;

  // Intro-entree: vos van dead-center naar de wolk (dan verschijnt de wolk).
  useEffect(() => {
    if (step !== -1) return;
    const t = setTimeout(() => setBeat(1), 620);
    return () => clearTimeout(t);
  }, [step]);

  // Puur tap-gedreven: elke tik = één stap. Na de begroeting eerst de TAALKIEZER (eerste keer);
  // pas na een taalkeuze start de eigenlijke tour (in die taal).
  const advance = () => {
    if (done) return;
    if (step === -1) {
      setBeat(1);                                              // vangnet als de 620ms-timer nog niet vuurde
      if (needLang && !langPicking) { setLangPicking(true); return; }   // begroeting → taalkiezer
      if (langPicking) return;                                 // tijdens kiezen: tik doet niks, kies een taal
      setStep(0); return;
    }
    setStep(s => s + 1);
  };
  const chooseLang = (code) => { setLang(code); setLangPicking(false); setStep(0); };  // taal → tour start
  const skipAll = () => setStep(HIW_STOPS.length);
  const morph = { type: "spring", stiffness: 260, damping: 26 };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={advance}
      style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(9px)", WebkitBackdropFilter: "blur(9px)", display: "flex", flexDirection: "column", alignItems: "center", overflowY: "auto", overscrollBehavior: "contain", padding: "0 22px 40px", cursor: done ? "default" : "pointer" }}>

      {/* top-hoek: Skip (het kruisje is weg — Skip is voldoende) */}
      <div style={{ position: "sticky", top: 0, alignSelf: "stretch", display: "flex", justifyContent: "flex-start", alignItems: "center", padding: "15px 2px 8px", zIndex: 5, background: "linear-gradient(rgba(15,14,12,0.5), rgba(15,14,12,0))" }}>
        {!done && (
          <button onClick={(e) => { e.stopPropagation(); skipAll(); }}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 700, cursor: "pointer", pointerEvents: "auto" }}>Skip</button>
        )}
      </div>

      {/* VOS dead-center (beat 0) — eigen FIXED laag zodat de layoutId-morph naar de wolk
          viewport-relatief blijft (niet meeschuift met een gescrolde kolom) */}
      {step === -1 && beat === 0 && (
        <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <motion.span layoutId="hiw-fox" transition={{ layout: morph }}
            style={{ fontSize: 58, lineHeight: 1, display: "inline-block", filter: "drop-shadow(0 12px 30px rgba(0,0,0,0.5))" }}><Fox /></motion.span>
        </div>
      )}

      {/* CONTENT-kolom: wolk (gecentreerd, vast) + stappen die naar onder groeien */}
      <div style={{ width: "100%", maxWidth: 360, marginTop: "min(15vh, 118px)", paddingBottom: 56, display: "flex", flexDirection: "column", alignItems: "center" }}>

        {/* WOLK + VOS — verschijnt vanaf beat 1, blijft altijd op deze plek staan */}
        {(beat >= 1 || step >= 0) && (
          <div style={{ position: "relative", maxWidth: 300, marginBottom: 30 }}>
            <motion.div layout transition={{ layout: morph }}
              style={{ background: "#1E1D1A", color: "#fff", borderRadius: 18, padding: "13px 17px", boxShadow: "0 12px 36px rgba(0,0,0,0.45)" }}>
              <span style={{ fontSize: 14.5, lineHeight: 1.55, fontWeight: 600, textAlign: "center", display: "block" }}>
                <WordReveal key={bubbleText} text={bubbleText} delay={0.26} stagger={0.06} />
              </span>
            </motion.div>
            {/* dubbele tail — cross-fade bij de zijwissel (links verdwijnt terwijl rechts verschijnt) */}
            <motion.div aria-hidden animate={{ opacity: foxSide === "left" ? 1 : 0 }} transition={{ duration: 0.22 }}
              style={{ position: "absolute", left: -8, bottom: 13, width: 0, height: 0, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderRight: "9px solid #1E1D1A" }} />
            <motion.div aria-hidden animate={{ opacity: foxSide === "right" ? 1 : 0 }} transition={{ duration: 0.22 }}
              style={{ position: "absolute", right: -8, bottom: 13, width: 0, height: 0, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderLeft: "9px solid #1E1D1A" }} />
            {/* de vos hangt onder de betreffende hoek en morpht van links naar rechts */}
            <motion.span layoutId="hiw-fox" transition={{ layout: morph }}
              style={{ position: "absolute", bottom: -2, [foxSide]: -38, fontSize: 34, lineHeight: 1, display: "inline-block" }}><Fox /></motion.span>
          </div>
        )}

        {/* TAALKIEZER — verschijnt na de begroeting, op dezelfde plek onder de wolk. Kies = tour start. */}
        {langPicking && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springSoft}
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%" }}>
            {LANGS.map((l) => (
              <motion.button key={l.code} whileTap={{ scale: 0.96 }}
                onClick={(e) => { e.stopPropagation(); chooseLang(l.code); }}
                style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 13, padding: "12px 14px", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", textAlign: "left", pointerEvents: "auto", WebkitTapHighlightColor: "transparent" }}>
                <span style={{ fontSize: 20, lineHeight: 1 }}>{l.flag}</span>
                <span>{l.label}</span>
              </motion.button>
            ))}
          </motion.div>
        )}

        {/* STAPPEN — groeien naar onder; actieve stap groot (schudt), gelande stappen compact */}
        {step >= 0 && HIW_STOPS.slice(0, activeCount).map((stop, i) => {
          const big = !done && i === step;
          const compact = !big;
          return (
            <motion.div key={stop.key} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ layout: morph, opacity: { duration: 0.3 } }}
              style={{ display: "flex", flexDirection: big ? "column" : "row", alignItems: "center", justifyContent: big ? "center" : "flex-start", gap: big ? 0 : 14, width: "100%", minHeight: big ? 92 : 0, padding: compact ? "9px 6px" : "6px 0" }}>
              {/* BUITEN = alleen positie (layout, morpht midden→links); BINNEN = scale/schud
                  (transform). Gescheiden houden voorkomt de framer scale-vervorming/snap. */}
              <motion.span layout transition={{ layout: morph }}
                style={{ fontSize: 22, lineHeight: 1, display: "inline-block", flexShrink: 0 }}>
                <motion.span
                  animate={{ scale: big ? 2.15 : 1, rotate: big ? [0, -24, 16, -8, 0] : 0 }}
                  transition={{ scale: morph, rotate: big ? { duration: 0.72, ease: [0.32, 0.72, 0, 1] } : { duration: 0.3 } }}
                  style={{ display: "inline-block", transformOrigin: "center", filter: big ? "drop-shadow(0 10px 26px rgba(255,92,0,0.4))" : "none" }}>
                  {stop.icon}
                </motion.span>
              </motion.span>
              {compact && (
                <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12, ...springSoft }}
                  style={{ minWidth: 0, textAlign: "left" }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: "#fff" }}>{tr("tour." + stop.key + ".title", stop.title)}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{tr("tour." + stop.key + ".sub", stop.sub)}</div>
                </motion.div>
              )}
            </motion.div>
          );
        })}

        {/* KLAAR: Friends-kaart + CTA */}
        <AnimatePresence>
          {done && (
            <motion.div key="hiw-done" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, ...springSoft }}
              style={{ width: "100%", marginTop: 10 }}>
              <div style={{ position: "relative", background: "rgba(255,92,0,0.12)", border: "1px solid rgba(255,146,79,0.35)", borderRadius: 16, padding: "15px 15px 13px", marginBottom: 12 }}>
                <motion.div initial={{ scale: 0, y: -4 }} animate={{ scale: 1, y: 0 }} transition={{ delay: 0.7, type: "spring", stiffness: 480, damping: 13 }}
                  style={{ position: "absolute", top: -12, right: 12 }}>
                  {/* pulserend + witte ring + sterkere gloed → springt eruit tegen de donkere tour-achtergrond */}
                  <motion.div animate={{ scale: [1, 1.08, 1], boxShadow: ["0 5px 16px rgba(255,92,0,0.5)", "0 9px 24px rgba(255,92,0,0.8)", "0 5px 16px rgba(255,92,0,0.5)"] }}
                    transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 0.9, ease: "easeInOut", delay: 1.2 }}
                    style={{ background: "#FF5C00", color: "#fff", fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", padding: "5px 12px", borderRadius: 20, border: "1.5px solid rgba(255,255,255,0.35)", whiteSpace: "nowrap" }}>
                    {tr("tour.recommended", "Up to 50% cheaper")}
                  </motion.div>
                </motion.div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#FF8A3D", marginBottom: 3 }}><Fox /> {tr("tour.friendsTitle", "Cheaper with Flowva Friends")}</div>
                <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.7)", lineHeight: 1.55 }}>{tr("tour.friendsBody", "Share one parcel, split shipping costs, and save more with every friend you invite.")}</div>
              </div>
              <motion.button whileTap={{ scale: 0.97 }} onClick={(e) => { e.stopPropagation(); onClose(); }}
                style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 13, padding: "15px", fontSize: 15, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                {tr("tour.cta", "Start shopping")} <Fox />
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* tap-hint onderaan */}
      {awaitingTap && (
        <motion.div animate={{ opacity: [0.3, 0.85, 0.3] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          style={{ position: "fixed", bottom: 26, left: 0, right: 0, textAlign: "center", fontSize: 12.5, fontWeight: 700, color: "rgba(255,255,255,0.6)", pointerEvents: "none" }}>
          {tr("tour.tap", "tap to continue")}
        </motion.div>
      )}
    </motion.div>
  );
}

// 💸-boogvlucht: het geld-emoji vliegt van de feed-knop in een vloeiende boog (eerst
// iets omhoog-links, dan overzeilen) naar het icoon op de "How pricing works"-sheet.
// Kwadratische bezier, gesampled naar keyframes; via portal zodat sheet-transforms
// de vlucht niet beïnvloeden. De starttangens wijst náár het controlepunt → dat
// linksboven het startpunt leggen geeft precies "eerst een beetje links omhoog".
function ArcGhost({ f, onDone }) {
  // Easing IN de gesamplede punten bakken + linear afspelen: één ease over de hele
  // vlucht. (Een ease op een keyframes-array werkt per tussen-segmentje → dat gaf op
  // kleine schermen zichtbare "hobbels", alsof het twee bogen waren.)
  const N = 22;
  const cx = f.sx - 80;
  const cy = Math.min(f.sy, f.ty) - 110;
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const xs = [], ys = [];
  for (let i = 0; i <= N; i++) {
    const t = easeIO(i / N), u = 1 - t;
    xs.push(u * u * f.sx + 2 * u * t * cx + t * t * f.tx);
    ys.push(u * u * f.sy + 2 * u * t * cy + t * t * f.ty);
  }
  return createPortal(
    <motion.span
      initial={{ x: xs[0], y: ys[0], scale: 1 }}
      animate={{ x: xs, y: ys, scale: [1, 1.35, 1] }}
      transition={{ duration: 0.8, ease: "linear", scale: { duration: 0.8, ease: "easeInOut" } }}
      onAnimationComplete={onDone}
      style={{ position: "fixed", left: -14, top: -14, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, lineHeight: 1, zIndex: 9800, pointerEvents: "none" }}>
      {f.emoji}
    </motion.span>,
    document.body,
  );
}

// 💎-uitlegpagina als in-app bottom-sheet (verving het losse /diamond-rankings.html-
// browser-tabblad). Zelfde opzet als PricingSheet; `arriving` = de 💎-boogvlucht is
// onderweg → het eigen icoon wacht verborgen en popt binnen bij de landing.
// Vertaalbare tekst met **vet**: splitst op ** en maakt de oneven stukken vet (kleur #46443F,
// zodat benadrukte feiten ook in de vertalingen behouden blijven — net als de originele <b>).
function renderBold(text) {
  if (!text || text.indexOf("**") === -1) return text;
  return text.split("**").map((part, i) => (i % 2 === 1 ? <b key={i} style={{ color: "#46443F" }}>{part}</b> : part));
}

function DiamondSheet({ onClose, arriving = false }) {
  useBodyScrollLock(true);
  // 🎇 Waterval-cascade (naar de schets van de user): ná de landing van de boogvlucht
  // valt één diamant uit het header-icoon naar rij 1; daar splitst 'ie in tweeën → rij 2;
  // per rij vallen de linkse(n) recht omlaag en splitst alleen de rechtse → tot rij 4 vol
  // is (Pascal-driehoek). De échte diamanten per rij wachten verborgen tot hun ghost
  // landt, en poppen dan binnen.
  const sheetRef = useRef(null);
  const [revealed, setRevealed] = useState(0);   // hoogste rij met zichtbare echte gems
  const [drops, setDrops] = useState([]);        // vallende ghost-diamanten
  const started = useRef(false);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (arriving || started.current) return;
    const kick = setTimeout(() => {
      if (started.current) return;
      started.current = true;
      const sheet = sheetRef.current;
      const sr = sheet?.getBoundingClientRect();
      const pos = (sel) => {
        const el = sheet?.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2 - sr.left, y: r.top + r.height / 2 - sr.top + sheet.scrollTop };
      };
      const H = sheet ? pos("[data-diamond-icon]") : null;
      const P = {};
      if (H) for (let row = 1; row <= 4; row++) for (let i = 0; i < row; i++) P[`${row}-${i}`] = pos(`[data-gem="${row}-${i}"]`);
      if (!H || Object.values(P).some((p) => !p)) { setRevealed(4); return; }   // meetprobleem → alles gewoon tonen
      const LEG = 0.5, GAP = 0.55;
      const legs = [{ f: H, t: P["1-0"], d: 0 }];
      for (let row = 1; row <= 3; row++) {
        for (let i = 0; i < row; i++) legs.push({ f: P[`${row}-${i}`], t: P[`${row + 1}-${i}`], d: row * GAP });
        legs.push({ f: P[`${row}-${row - 1}`], t: P[`${row + 1}-${row}`], d: row * GAP });   // de splitser
      }
      setDrops(legs.map((l, i) => ({ id: i, fx: l.f.x, fy: l.f.y, tx: l.t.x, ty: l.t.y, delay: l.d })));
      for (let row = 1; row <= 4; row++) timers.current.push(setTimeout(() => setRevealed(row), ((row - 1) * GAP + LEG) * 1000));
      timers.current.push(setTimeout(() => setDrops([]), (3 * GAP + LEG + 0.4) * 1000));
    }, 500);
    timers.current.push(kick);
    return () => clearTimeout(kick);
  }, [arriving]);
  const card = { background: "#fff", border: "1px solid #ECEAE5", borderRadius: 16, padding: "14px 16px", marginBottom: 12 };
  const sectionLabel = { fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "#A8A5A0", marginBottom: 2 };
  const Level = ({ gems, name, tag, desc }) => (
    <div style={{ display: "flex", gap: 14, padding: "13px 0", borderTop: "1px solid #F0EEE8" }}>
      <div style={{ flexShrink: 0, width: 92 }}>
        {gems > 0 ? (
          <>
            <div style={{ fontSize: 14, lineHeight: 1, display: "flex", gap: 3 }}>
              {Array.from({ length: gems }, (_, i) => (
                <span key={i} data-gem={`${gems}-${i}`} style={{ position: "relative", display: "inline-block", overflow: "hidden", borderRadius: 4 }}>
                  {/* landing-bounce: even kleiner → overshoot → rust (om de beurt per rij) */}
                  <motion.span initial={false}
                    animate={revealed >= gems ? { opacity: 1, scale: [0.5, 1.22, 0.92, 1] } : { opacity: 0, scale: 0.3 }}
                    transition={revealed >= gems ? { duration: 0.5, times: [0, 0.45, 0.75, 1], ease: "easeOut", delay: i * 0.12 } : { duration: 0 }}
                    style={{ display: "inline-block" }}>💎</motion.span>
                  {/* ná de bounce glanst precies dít diamantje — zo glimmen ze om de beurt */}
                  {revealed >= gems && (
                    <motion.span initial={{ x: "-130%" }} animate={{ x: "230%" }}
                      transition={{ delay: i * 0.12 + 0.55, duration: 0.5, ease: "easeInOut" }}
                      style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "60%", background: "linear-gradient(105deg, transparent, rgba(255,255,255,0.9), transparent)", pointerEvents: "none" }} />
                  )}
                </span>
              ))}
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "#FF5C00", marginTop: 5 }}>{name}</div>
          </>
        ) : (
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#A8A5A0", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>{tr("diamond.noDiamond", "No diamond")}</div>
        )}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111", marginBottom: 2 }}>{tag}</div>
        <div style={{ fontSize: 12.5, color: "#6B6862", lineHeight: 1.55 }}>{desc}</div>
      </div>
    </div>
  );
  const metrics = [
    [tr("diamond.metric.onTime.k", "On-Time Delivery Rate"), tr("diamond.metric.onTime.v", "Percentage of orders delivered within the agreed timeframe.")],
    [tr("diamond.metric.service.k", "Service Response Rate"), tr("diamond.metric.service.v", "Percentage of inquiries that receive a timely response from the supplier.")],
    [tr("diamond.metric.custom.k", "Custom Transaction Score"), tr("diamond.metric.custom.v", "Value of custom manufacturing orders completed through the platform.")],
    [tr("diamond.metric.repurchase.k", "Repurchase Rate"), tr("diamond.metric.repurchase.v", "Percentage of customers who place repeat orders.")],
    [tr("diamond.metric.interested.k", "Interested Customer Count"), tr("diamond.metric.interested.v", "Number of customers who have engaged in serious negotiations with the supplier.")],
  ];
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }} />
      <motion.div ref={sheetRef} data-diamond-sheet initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#F8F7F4", borderRadius: "24px 24px 0 0", zIndex: 301, maxHeight: "92vh", overflowY: "auto", overscrollBehavior: "contain", padding: "18px 16px 36px" }}>
        <div style={{ width: 36, height: 4, background: "#D8D5CF", borderRadius: 2, margin: "0 auto 16px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "0 4px" }}>
          <div data-diamond-icon style={{ width: 42, height: 42, borderRadius: "50%", background: "#E6F1FB", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
            {/* het diamantje wacht verborgen tot de boogvlucht erin landt, en popt dan binnen */}
            <motion.span initial={false} animate={arriving ? { opacity: 0, scale: 0.3 } : { opacity: 1, scale: 1 }} transition={springBouncy} style={{ display: "inline-block" }}>💎</motion.span>
          </div>
          <div>
            <div style={{ fontSize: 16.5, fontWeight: 800, color: "#111", letterSpacing: -0.3, lineHeight: 1.25 }}>{tr("diamond.title", "How Do 1688 Factory Diamond Rankings Work?")}</div>
            <div style={{ fontSize: 12.5, color: "#8A8780" }}>{tr("diamond.subtitle", "Straight from 1688's own supplier metrics")}</div>
          </div>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: "#46443F", margin: "12px 4px 14px" }}>
          {tr("diamond.intro", "1688 ranks factories on recent performance — the more diamonds, the stronger the factory's track record. Rankings are based on the past 30–90 days of data: on-time delivery, service responsiveness, custom manufacturing volume, customer satisfaction and repeat purchases.")}
        </div>
        <div style={card}>
          <div style={sectionLabel}>{tr("diamond.levels", "RANKING LEVELS")}</div>
          <Level gems={0} tag={tr("diamond.lvl0.tag", "A new or less active factory.")} desc={tr("diamond.lvl0.desc", "The supplier may not yet have enough transaction history or performance data to qualify for a diamond ranking.")} />
          <Level gems={1} name={tr("diamond.lvl1.name", "1 Diamond")} tag={tr("diamond.lvl1.tag", "Solid baseline performance.")} desc={tr("diamond.lvl1.desc", "Meets 1688's minimum standards for service quality, delivery reliability and transaction activity.")} />
          <Level gems={2} name={tr("diamond.lvl2.name", "2 Diamonds")} tag={tr("diamond.lvl2.tag", "Above-average performance.")} desc={tr("diamond.lvl2.desc", "Stronger reliability, customer service and order volume than lower-ranked suppliers.")} />
          <Level gems={3} name={tr("diamond.lvl3.name", "3 Diamonds")} tag={tr("diamond.lvl3.tag", "A high-performing supplier.")} desc={tr("diamond.lvl3.desc", "Consistently strong results in delivery, communication and customer satisfaction.")} />
          <Level gems={4} name={tr("diamond.lvl4.name", "4 Diamonds")} tag={tr("diamond.lvl4.tag", "The highest diamond level.")} desc={tr("diamond.lvl4.desc", "Excellent operational performance and a proven track record across all major indicators.")} />
        </div>
        <div style={card}>
          <div style={{ ...sectionLabel, marginBottom: 6 }}>{tr("diamond.measures", "WHAT 1688 MEASURES")}</div>
          {metrics.map(([k, v]) => (
            <div key={k} style={{ padding: "8px 0", borderTop: "1px solid #F1EFEA" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{k}</div>
              <div style={{ fontSize: 12.5, color: "#6B6862", lineHeight: 1.5 }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: "#8A8780", lineHeight: 1.55, margin: "0 4px 16px" }}>
          {tr("diamond.footer", "Based on 1688's official supplier performance definitions (\"指标定义\") shown in supplier profiles — on-time delivery, service response, repurchase rate, custom manufacturing transactions and interested customers.")}
        </div>
        <button onClick={onClose} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", background: "#111", color: "#fff", border: "none", borderRadius: 14, padding: "14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          {tr("sheets.gotIt", "Got it")} <Fox />
        </button>

        {/* de vallende cascade-diamanten (scrollen mee met de sheet-inhoud). Vast 16×16-
            doosje met het emoji gecentreerd → het middelpunt landt exact op het gemeten
            gem-middelpunt (strakke uitlijning); fade-out direct ná de landing zodat de
            bounce van het echte diamantje het naadloos overneemt. */}
        {drops.map((d) => (
          <motion.span key={d.id}
            initial={{ x: d.fx, y: d.fy, opacity: 0, scale: 0.9 }}
            animate={{ x: d.tx, y: d.ty, opacity: [0, 1, 1, 0], scale: 1 }}
            transition={{ delay: d.delay, duration: 0.5, ease: "easeInOut", opacity: { delay: d.delay, duration: 0.6, times: [0, 0.2, 0.82, 1] } }}
            style={{ position: "absolute", left: -8, top: -8, width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, lineHeight: 1, zIndex: 6, pointerEvents: "none" }}>💎</motion.span>
        ))}
      </motion.div>
    </>
  );
}

// Transparant fee-paneel achter de 💸-knop (feed-header + profiel). Engels,
// zelfde bottom-sheet als HowItWorksSheet. Solo + Flowva Friends + per-regel
// een labeltje wie het geld krijgt. `arriving` = de boogvlucht is onderweg →
// het eigen 💸-icoon blijft verborgen tot de vlucht landt (en popt dan binnen).
function PricingSheet({ onClose, arriving = false, onTour }) {
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
  // n = "solo" of aantal personen; savePct = besparing op de fee t.o.v. solo (8%),
  // naar beneden afgerond zodat we nooit overdrijven. Labels/"off" vertaalbaar op render.
  const peopleWord = tr("pricing.tier.people", "people");
  const offWord = tr("pricing.tier.off", "off");
  const friendTiers = [
    ["solo", "8% · min €5", true, null],
    ["2", "7% · min €4.50", false, 12],
    ["3", "6% · min €4.50", false, 25],
    ["4", "5.5% · min €4", false, 31],
    ["5", "5% · min €4", false, 37],
    ["6", "4.5% · min €4", false, 43],
    ["7", "4% · min €3.50", false, 50],
  ];
  const card = { background: "#fff", border: "1px solid #ECEAE5", borderRadius: 16, padding: "14px 16px", marginBottom: 12 };
  const sectionLabel = { fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "#A8A5A0", marginBottom: 2 };
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }} />
      <motion.div data-pricing-sheet initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#F8F7F4", borderRadius: "24px 24px 0 0", zIndex: 301, maxHeight: "92vh", overflowY: "auto", padding: "18px 16px 36px" }}>
        <div style={{ width: 36, height: 4, background: "#D8D5CF", borderRadius: 2, margin: "0 auto 16px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "0 4px" }}>
          <div data-pricing-icon style={{ width: 42, height: 42, borderRadius: "50%", background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
            {/* het emoji wacht verborgen tot de boogvlucht erin landt, en popt dan binnen */}
            <motion.span initial={false} animate={arriving ? { opacity: 0, scale: 0.3 } : { opacity: 1, scale: 1 }} transition={springBouncy} style={{ display: "inline-block" }}>💸</motion.span>
          </div>
          <div>
            <div style={{ fontSize: 19, fontWeight: 800, color: "#111", letterSpacing: -0.3 }}>{tr("pricing.title", "How pricing works")}</div>
            <div style={{ fontSize: 12.5, color: "#8A8780" }}>{tr("pricing.subtitle", "Fully transparent — no hidden markup")}</div>
          </div>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: "#46443F", margin: "12px 4px 14px" }}>
          {tr("pricing.intro", "Each line below shows exactly who gets paid. The original product link is visible on every product, for full transparency.")}
        </div>

        {/* Liever kijken dan lezen: de vos loopt de hele prijsopbouw in 6 tikken door */}
        {onTour && (
          <motion.button whileTap={{ scale: 0.98 }} onClick={onTour}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, background: "#111", color: "#fff", border: "none", borderRadius: 14, padding: "13px 15px", marginBottom: 12, cursor: "pointer", textAlign: "left", WebkitTapHighlightColor: "transparent" }}>
            <span style={{ width: 30, height: 30, borderRadius: "50%", background: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>▶</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 800 }}>{tr("ptour.cta", "Show me instead of telling me")}</span>
              <span style={{ display: "block", fontSize: 11.5, color: "rgba(255,255,255,0.6)" }}>{tr("ptour.ctaSub", "The whole price, explained in 6 taps")}</span>
            </span>
            <Fox />
          </motion.button>
        )}

        <div style={card}>
          <div style={sectionLabel}>{tr("pricing.perProduct", "PER PRODUCT")}</div>
          <Row icon="🏷️" name={tr("pricing.factoryPrice.name", "Brand price")} who={tr("pricing.who.factory", "to the brand")} amount={tr("pricing.factoryPrice.amount", "shown + link")} desc={tr("pricing.factoryPrice.desc", "The real price the brand charges — visible with its original product link.")} />
          <Row icon="📸" name={tr("pricing.qc.name", "Quality-control")} who={tr("pricing.who.agent", "to our shipping agent")} amount="¥2 · ≈€0.26" desc={tr("pricing.qc.desc", "Our shipping agent photographs every item before it ships — and takes extra photos if anything looks off.")} />
          <Row icon="📐" name={tr("pricing.measure.name", "Measurement Service")} who={tr("pricing.who.agent", "to our shipping agent")} amount="¥4 · ≈€0.51" desc={tr("pricing.measure.desc", "Our shipping agent measures the key dimensions of your item to confirm the size matches the listing. Small tolerances apply (about ±3 cm on garments).")} />
          <Row icon="🚚" name={tr("pricing.domestic.name", "China domestic shipping fee")} who={tr("pricing.who.domestic", "to the domestic carrier")} amount="¥5 · ≈€0.64" desc={tr("pricing.domestic.desc", "Transport from the brand to the consolidation warehouse in China.")} />
        </div>

        <div style={card}>
          <div style={sectionLabel}>{tr("pricing.perParcel", "PER PARCEL — charged when you ship, so bigger bundles are cheaper")}</div>
          <Row icon="📦" name={tr("pricing.fulfillment.name", "Fulfillment")} who={tr("pricing.who.agent", "to our shipping agent")} amount="¥9.9 · ≈€1.27"
            desc={tr("pricing.fulfillment.desc", "Our shipping agent receives, packs and prepares your parcel, plus 30 days of free storage. Charged once per parcel, when you ship.")}
            extra={
              <div style={{ background: "#FFF7F2", border: "1px solid #FBE2D2", borderRadius: 10, padding: "9px 11px", margin: "8px 0 0 25px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#B8430A", marginBottom: 3 }}>{tr("pricing.surcharges.title", "Two surcharges may apply:")}</div>
                <div style={{ fontSize: 11, lineHeight: 1.55, color: "#7A5340" }}>{tr("pricing.surcharge.items", "• Packages with more than 5 items → +¥2 (≈€0.26) per additional item.")}<br />{tr("pricing.surcharge.weight", "• Packages over 2 kg → +¥1.5 (≈€0.19) per kg above 2 kg, with the billable weight rounded up to the next whole kilogram.")}</div>
              </div>
            } />
          <Row icon="✈️" name={tr("pricing.intlShip.name", "International shipping")} who={tr("pricing.who.carrier", "to the carrier & customs")} amount={tr("pricing.intlShip.amount", "by weight")}
            desc={renderBold(tr("pricing.intlShip.desc", "China → your door, priced by weight. **Tax-inclusive.** A **€3 customs cost per product category** is also settled inside this shipping price."))} />
          <Row icon="💱" name={tr("pricing.currency.name", "Currency conversion")} who={tr("pricing.who.alipay", "to Alipay")} amount={tr("pricing.currency.amount", "3% · at cost")}
            desc={renderBold(tr("pricing.currency.desc", "We pay the brand and our agent in Chinese yuan (¥), converted from euros through **Alipay**, which charges a **3% conversion fee**. We pass this on **at cost** — calculated over everything that's converted to yuan (product, agent & shipping costs), never on VAT or the Flowva fee."))} />
          <Row icon="🧾" name={tr("pricing.fee.name", "Flowva fee")} who={tr("pricing.who.flowva", "Flowva's fee")} whoOrange amount="4–8% · min €3.50–€5"
            desc={renderBold(tr("pricing.fee.desc", "Our only earning, calculated over the **brand price + the estimated international shipping** — never on VAT, fulfillment or agent costs. Charged once when you ship your bundle."))} />
        </div>

        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
            <span style={{ fontSize: 19 }}>👤</span>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: "#111" }}>{tr("pricing.solo.title", "Solo shopping")}</div>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: "#46443F" }}>
            {renderBold(tr("pricing.solo.body", "You shop on your own and pay just the brand price. The fees are only paid **when you assemble your parcel to ship**. Your Flowva fee is **8% of the brand price + the estimated international shipping, min €5**."))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 11, alignItems: "flex-start" }}>
            <span style={{ fontSize: 14, marginTop: 1 }}>ℹ️</span>
            <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "#8A8780" }}>{renderBold(tr("pricing.solo.note", "**Note:** this €3 per product category is a customs charge, introduced by a new EU rule from 1 July 2026. It's included in the shipping price. Want to lower it? Shopping with friends is recommended."))}</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "flex-start" }}>
            <span style={{ fontSize: 14, marginTop: 1 }}>⚠️</span>
            <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "#8A8780" }}>{renderBold(tr("pricing.solo.warning", "Fulfillment, shipping and the fee are charged once **per parcel** — so ship everything in one bundle, not several separate parcels."))}</div>
          </div>
        </div>

        <div style={{ ...card, border: "2px solid #FF5C00" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
            <span style={{ fontSize: 19 }}>👥</span>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: "#111" }}>{tr("pricing.friends.title", "Flowva Friends")}</div>
            <div style={{ marginLeft: "auto", flexShrink: 0, whiteSpace: "nowrap", background: "#FF5C00", color: "#fff", fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 999, letterSpacing: 0.3 }}>{tr("pricing.friends.badge", "Up to 50% cheaper")}</div>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: "#46443F" }}>
            {renderBold(tr("pricing.friends.body", "Shop together in one shared basket. Everything ships as **one parcel for the whole group**, so you split the international shipping and the €3-per-category customs across all friends. And international shipping is **cheaper per product the heavier the parcel** — so a bigger group helps there too."))}
          </div>
          <div style={{ background: "#FFF7F2", border: "1px solid #FBE2D2", borderRadius: 12, padding: "12px 13px", marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#B8430A", marginBottom: 8 }}>{tr("pricing.friends.feeDrops", "Your Flowva fee drops with every friend")}</div>
            {friendTiers.map(([n, fee, gray, savePct], i) => {
              const best = i === friendTiers.length - 1;   // 7 personen = beste deal → uitgelicht
              const label = n === "solo" ? tr("pricing.tier.solo", "Solo · 1 person") : `${n} ${peopleWord}`;
              const save = savePct ? `${savePct}% ${offWord}` : "";
              return (
                <div key={n} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, padding: best ? "8px 10px" : "5px 1px", marginTop: best ? 6 : 0, borderRadius: best ? 10 : 0, background: best ? "#FF5C00" : "transparent", color: best ? "#fff" : "#46443F", borderBottom: !best && i < friendTiers.length - 1 ? "1px solid #FBE2D2" : "none" }}>
                  <span style={{ fontWeight: best ? 800 : 500 }}>{label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                    {save && (
                      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.2, padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap", background: best ? "#fff" : "#E7F6EC", color: best ? "#FF5C00" : "#178A46" }}>{save}</span>
                    )}
                    <span style={{ fontWeight: 700, whiteSpace: "nowrap", color: best ? "#fff" : (gray ? "#8A8780" : "#111") }}>{fee}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "0 4px 4px" }}>
          <span style={{ fontSize: 15, marginTop: 1 }}>🔗</span>
          <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "#8A8780" }}>{tr("pricing.footer", "On every product you'll find the original product link — check the brand price yourself, anytime. That's our promise of transparency.")}</div>
        </div>

        <motion.button whileTap={{ scale: 0.97 }} onClick={onClose}
          style={{ width: "100%", marginTop: 14, background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
          {tr("sheets.gotIt", "Got it")} <Fox />
        </motion.button>
      </motion.div>
    </>
  );
}

// ── "How pricing works" als VOS-TOUR ─────────────────────────────────────────
// Niemand leest een lap tekst; deze tour vertelt hetzelfde verhaal in 6 tikken.
// Zelfde choreografie als HowItWorksSheet (vos + wolk + stappen die naar onder
// groeien), met één verschil: elke GELANDE stap toont ook z'n bedrag, waardoor
// het onderin voelt als een bonnetje dat zich opbouwt. Finale = de Friends-ladder.
// titleKey/amountKey hergebruiken bestaande, al vertaalde pricing-teksten.
// 6 kosten worden één voor één "onthuld" en blijven zichtbaar in het bonnetje.
// Finale (S8) = de Flowva fee-regel wordt toegevoegd + Friends-staffel.
const PT_STOPS = [
  { key: "brand", icon: "🏷️", titleKey: "pricing.factoryPrice.name", title: "Brand price", amountKey: "pricing.factoryPrice.amount", amount: "shown + link",
    say: "You pay the original price charged by the brand in China — with the original product link included." },
  { key: "qcMeas", icon: "📷", title: "Quality control & measurements", amount: "¥6 · ≈€0.77",
    say: "Quality control costs ¥2 and measurements cost ¥4 — ¥6 total (about €0.77) per product." },
  { key: "domestic", icon: "🚚", title: "China domestic shipping", amount: "¥5 · ≈€0.64",
    say: "Shipping from the brand to our warehouse in China costs ¥5 (about €0.64) per product." },
  { key: "fulfillment", icon: "📦", title: "Fulfillment", amount: "¥9.90 · ≈€1.27",
    // 'per parcel' krijgt bold + oranje in bubble EN in het bonnetje-label.
    highlight: "per parcel", perParcelAmount: true,
    // Kleine extra regels onder de compacte regel in het bonnetje (niet in de bubble).
    extras: [
      "More than 5 items: +¥2 (≈€0.26) per additional item",
      "Over 2 kg: +¥1.50 (≈€0.19) per additional kg",
    ],
    extraKeys: ["ptour.fulfillment.extra1", "ptour.fulfillment.extra2"],
    say: "Fulfillment costs ¥9.90 (about €1.27) per parcel, not per product. Parcels with more than 5 items or weighing over 2 kg may include a small additional fulfillment fee." },
  { key: "intl", icon: "✈️", titleKey: "pricing.intlShip.name", title: "International shipping", amountKey: "pricing.intlShip.amount", amount: "by weight",
    say: "International shipping is calculated by weight and shipped DDP. All customs duties and import taxes are included, so you pay nothing extra on delivery." },
  { key: "currency", icon: "💱", titleKey: "pricing.currency.name", title: "Currency conversion", amountKey: "ptour.currency.amount", amount: "3% · no markup",
    say: "Alipay charges 3% to convert euros into Chinese yuan. You pay exactly that 3%, with no added markup." },
];
const PT_INTRO = "See exactly what you pay for — with every cost explained.";
const PT_GOLDEN = "With Flowva Friends, your Flowva fee gets lower with every friend who joins your parcel.";
// Zelfde staffel als de detail-sheet, compact voor de finale-ladder.
const PT_TIERS = [["solo", "8%", null], ["2", "7%", 12], ["3", "6%", 25], ["4", "5.5%", 31], ["5", "5%", 37], ["6", "4.5%", 43], ["7", "4%", 50]];

// Bubbelstijl: word-by-word reveal met optionele bold+oranje highlight-frase (bv. "per parcel").
// Deze component vervangt WordReveal alléén voor stops die een highlight-frase hebben; zo blijft
// de rest van de tour exact dezelfde animatie behouden.
function BubbleWithHighlight({ text, highlight, delay = 0.26, stagger = 0.06 }) {
  const words = String(text || "").split(/\s+/);
  const hl = String(highlight || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const flagged = new Set();
  if (hl.length) {
    const norm = (w) => w.replace(/[.,;:!?—()"'`]/g, "").toLowerCase();
    for (let i = 0; i <= words.length - hl.length; i++) {
      let ok = true;
      for (let j = 0; j < hl.length; j++) { if (norm(words[i + j]) !== hl[j]) { ok = false; break; } }
      if (ok) for (let j = 0; j < hl.length; j++) flagged.add(i + j);
    }
  }
  return words.map((w, i) => (
    <motion.span key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay + i * stagger, duration: 0.28 }}
      style={{ display: "inline-block", ...(flagged.has(i) ? { color: "#FF8A3D", fontWeight: 800 } : null) }}>
      {w}{i < words.length - 1 ? " " : ""}
    </motion.span>
  ));
}

// Amount voor de compacte bonnetje-regel: bij fulfillment tonen we óók "per parcel"
// bold+oranje (in álle talen — de vertaalde frase komt uit ptour.fulfillment.perParcel).
function AmountLabel({ stop, amountText, perParcelText }) {
  if (!stop.perParcelAmount) return <>{amountText}</>;
  return (
    <>
      {amountText} <span style={{ color: "#FF8A3D", fontWeight: 800 }}>{perParcelText}</span>
    </>
  );
}

function PricingTourSheet({ onClose, onDetails }) {
  const tr = useTr();
  const [beat, setBeat] = useState(0);          // 0 = vos dead-center · 1 = wolk zichtbaar
  const [step, setStep] = useState(-1);         // -1 intro · 0..PT_STOPS.length-1 actieve stap · PT_STOPS.length klaar
  useBodyScrollLock(true);
  const done = step >= PT_STOPS.length;
  const foxSide = (step >= 0 || done) ? "right" : "left";
  const activeStop = step >= 0 && !done ? PT_STOPS[step] : null;
  const bubbleText = done ? tr("ptour.golden", PT_GOLDEN)
    : activeStop ? tr("ptour." + activeStop.key + ".say", activeStop.say)
    : tr("ptour.greeting", PT_INTRO);
  const bubbleHighlight = activeStop && activeStop.highlight
    ? tr("ptour." + activeStop.key + ".highlight", activeStop.highlight)
    : null;
  const awaitingTap = !done && (step === -1 ? beat >= 1 : true);
  const activeCount = done ? PT_STOPS.length : step + 1;
  const stopTitle = (s) => (s.titleKey ? tr(s.titleKey, s.title) : tr("ptour." + s.key + ".title", s.title));
  const stopAmount = (s) => (s.amountKey ? tr(s.amountKey, s.amount) : s.amount);
  const perParcelWord = tr("ptour.fulfillment.perParcel", "per parcel");

  useEffect(() => {
    if (step !== -1) return;
    const t = setTimeout(() => setBeat(1), 620);
    return () => clearTimeout(t);
  }, [step]);

  const advance = () => {
    if (done) return;
    if (step === -1) { setBeat(1); setStep(0); return; }
    setStep((s) => s + 1);
  };
  const skipAll = () => setStep(PT_STOPS.length);
  const morph = { type: "spring", stiffness: 260, damping: 26 };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={advance}
      style={{ position: "fixed", inset: 0, zIndex: 320, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(9px)", WebkitBackdropFilter: "blur(9px)", display: "flex", flexDirection: "column", alignItems: "center", overflowY: "auto", overscrollBehavior: "contain", padding: "0 22px 40px", cursor: done ? "default" : "pointer" }}>

      <div style={{ position: "sticky", top: 0, alignSelf: "stretch", display: "flex", justifyContent: "flex-start", alignItems: "center", padding: "15px 2px 8px", zIndex: 5, background: "linear-gradient(rgba(15,14,12,0.5), rgba(15,14,12,0))" }}>
        {!done && (
          <button onClick={(e) => { e.stopPropagation(); skipAll(); }}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 700, cursor: "pointer", pointerEvents: "auto" }}>{tr("tour.skip", "Skip")}</button>
        )}
      </div>

      {/* VOS dead-center (beat 0) — eigen fixed laag zodat de morph viewport-relatief blijft */}
      {step === -1 && beat === 0 && (
        <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <motion.span layoutId="ptour-fox" transition={{ layout: morph }}
            style={{ fontSize: 58, lineHeight: 1, display: "inline-block", filter: "drop-shadow(0 12px 30px rgba(0,0,0,0.5))" }}><Fox /></motion.span>
        </div>
      )}

      <div style={{ width: "100%", maxWidth: 360, marginTop: "min(15vh, 118px)", paddingBottom: 56, display: "flex", flexDirection: "column", alignItems: "center" }}>

        {/* WOLK + VOS */}
        {(beat >= 1 || step >= 0) && (
          <div style={{ position: "relative", maxWidth: 300, marginBottom: 30 }}>
            <motion.div layout transition={{ layout: morph }}
              style={{ background: "#1E1D1A", color: "#fff", borderRadius: 18, padding: "13px 17px", boxShadow: "0 12px 36px rgba(0,0,0,0.45)" }}>
              <span style={{ fontSize: 14.5, lineHeight: 1.55, fontWeight: 600, textAlign: "center", display: "block" }}>
                {bubbleHighlight
                  ? <BubbleWithHighlight key={bubbleText} text={bubbleText} highlight={bubbleHighlight} />
                  : <WordReveal key={bubbleText} text={bubbleText} delay={0.26} stagger={0.06} />}
              </span>
            </motion.div>
            <motion.div aria-hidden animate={{ opacity: foxSide === "left" ? 1 : 0 }} transition={{ duration: 0.22 }}
              style={{ position: "absolute", left: -8, bottom: 13, width: 0, height: 0, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderRight: "9px solid #1E1D1A" }} />
            <motion.div aria-hidden animate={{ opacity: foxSide === "right" ? 1 : 0 }} transition={{ duration: 0.22 }}
              style={{ position: "absolute", right: -8, bottom: 13, width: 0, height: 0, borderTop: "8px solid transparent", borderBottom: "8px solid transparent", borderLeft: "9px solid #1E1D1A" }} />
            <motion.span layoutId="ptour-fox" transition={{ layout: morph }}
              style={{ position: "absolute", bottom: -2, [foxSide]: -38, fontSize: 34, lineHeight: 1, display: "inline-block" }}><Fox /></motion.span>
          </div>
        )}

        {/* STAPPEN = het bonnetje dat zich opbouwt (gelande stap toont z'n bedrag) */}
        {step >= 0 && PT_STOPS.slice(0, activeCount).map((stop, i) => {
          const big = !done && i === step;
          const showExtras = !big && stop.extras && stop.extras.length;
          return (
            <motion.div key={stop.key} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ layout: morph, opacity: { duration: 0.3 } }}
              style={{ display: "flex", flexDirection: "column", width: "100%", minHeight: big ? 92 : 0, padding: big ? "6px 0" : "9px 6px" }}>
              <div style={{ display: "flex", flexDirection: big ? "column" : "row", alignItems: "center", justifyContent: big ? "center" : "flex-start", gap: big ? 0 : 14, width: "100%" }}>
                <motion.span layout transition={{ layout: morph }}
                  style={{ fontSize: 22, lineHeight: 1, display: "inline-block", flexShrink: 0 }}>
                  <motion.span
                    animate={{ scale: big ? 2.15 : 1, rotate: big ? [0, -24, 16, -8, 0] : 0 }}
                    transition={{ scale: morph, rotate: big ? { duration: 0.72, ease: [0.32, 0.72, 0, 1] } : { duration: 0.3 } }}
                    style={{ display: "inline-block", transformOrigin: "center", filter: big ? "drop-shadow(0 10px 26px rgba(255,92,0,0.4))" : "none" }}>
                    {stop.icon}
                  </motion.span>
                </motion.span>
                {!big && (
                  <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12, ...springSoft }}
                    style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ minWidth: 0, flex: 1, textAlign: "left", fontSize: 14.5, fontWeight: 700, color: "#fff" }}>{stopTitle(stop)}</div>
                    <div style={{ flexShrink: 0, fontSize: 12, fontWeight: 800, color: "#FF9A5C", whiteSpace: "nowrap" }}>
                      <AmountLabel stop={stop} amountText={stopAmount(stop)} perParcelText={perParcelWord} />
                    </div>
                  </motion.div>
                )}
              </div>
              {showExtras && (
                <motion.div initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, ...springSoft }}
                  style={{ marginLeft: 36, marginTop: 4, fontSize: 11, lineHeight: 1.5, color: "rgba(255,255,255,0.55)" }}>
                  {stop.extras.map((line, ix) => (
                    <div key={ix}>+ {stop.extraKeys ? tr(stop.extraKeys[ix], line) : line}</div>
                  ))}
                </motion.div>
              )}
            </motion.div>
          );
        })}

        {/* FINALE: Flowva fee komt als laatste regel in het bonnetje + Friends-staffel telt naar beneden */}
        <AnimatePresence>
          {done && (
            <motion.div key="ptour-done" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, ...springSoft }}
              style={{ width: "100%", marginTop: 4 }}>
              {/* Flowva fee — verschijnt eerst, als afsluitende regel van het bonnetje */}
              <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15, ...springSoft }}
                style={{ display: "flex", flexDirection: "column", width: "100%", padding: "9px 6px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, width: "100%" }}>
                  <span style={{ fontSize: 22, lineHeight: 1, display: "inline-block", flexShrink: 0 }}>🧾</span>
                  <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ minWidth: 0, flex: 1, textAlign: "left", fontSize: 14.5, fontWeight: 700, color: "#fff" }}>{tr("pricing.fee.name", "Flowva fee")}</div>
                    <div style={{ flexShrink: 0, fontSize: 12, fontWeight: 800, color: "#FF9A5C", whiteSpace: "nowrap" }}>4–8% · min €3.50–€5</div>
                  </div>
                </div>
                {/* waarover de fee gerekend wordt — zelfde grondslag als in het betaalscherm */}
                <div style={{ marginLeft: 36, marginTop: 4, fontSize: 11, lineHeight: 1.5, color: "rgba(255,255,255,0.55)" }}>
                  {tr("ptour.fee.base", "over the brand price + the estimated international shipping")}
                </div>
              </motion.div>
              <div style={{ background: "rgba(255,92,0,0.12)", border: "1px solid rgba(255,146,79,0.35)", borderRadius: 16, padding: "14px 15px 12px", marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#FF8A3D", marginBottom: 9 }}>{tr("ptour.friends.dropdownTitle", "Save up to 50% on your fee with Flowva Friends")}</div>
                {PT_TIERS.map(([n, fee, save], i) => {
                  const best = i === PT_TIERS.length - 1;
                  const label = n === "solo" ? tr("pricing.tier.solo", "Solo · 1 person") : `${n} ${tr("pricing.tier.people", "people")}`;
                  return (
                    <motion.div key={n} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.55 + i * 0.13, ...springSoft }}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: best ? "8px 10px" : "5px 2px", marginTop: best ? 6 : 0, borderRadius: best ? 10 : 0, background: best ? "#FF5C00" : "transparent", color: best ? "#fff" : "rgba(255,255,255,0.75)" }}>
                      <span style={{ fontWeight: best ? 800 : 500 }}>{label}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                        {save && <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 999, background: best ? "#fff" : "rgba(23,138,70,0.25)", color: best ? "#FF5C00" : "#7BE0A6", whiteSpace: "nowrap" }}>{save}% {tr("pricing.tier.off", "off")}</span>}
                        <span style={{ fontWeight: 800, whiteSpace: "nowrap" }}>{fee}</span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
              <motion.button whileTap={{ scale: 0.97 }} onClick={(e) => { e.stopPropagation(); onDetails(); }}
                style={{ width: "100%", marginBottom: 9, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 13, padding: "13px", fontSize: 14, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                {tr("ptour.details", "See the full breakdown")}
              </motion.button>
              <motion.button whileTap={{ scale: 0.97 }} onClick={(e) => { e.stopPropagation(); onClose(); }}
                style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 13, padding: "15px", fontSize: 15, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                {tr("sheets.gotIt", "Got it")} <Fox />
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {awaitingTap && (
        <motion.div animate={{ opacity: [0.3, 0.85, 0.3] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          style={{ position: "fixed", bottom: 26, left: 0, right: 0, textAlign: "center", fontSize: 12.5, fontWeight: 700, color: "rgba(255,255,255,0.6)", pointerEvents: "none" }}>
          {tr("tour.tap", "tap to continue")}
        </motion.div>
      )}
    </motion.div>
  );
}

// Taal-switcher in Profiel: rij + inklap-picker van de 8 talen. useLang() maakt 'm reactief;
// setLang her-rendert de hele app (SupplyFlow abonneert via useLangVersion), dus alles wisselt mee.
function LanguageRow() {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);
  const current = LANGS.find((l) => l.code === lang) || LANGS[0];
  return (
    <div style={{ marginBottom: 12 }}>
      <motion.div whileTap={{ scale: 0.98 }} onClick={() => setOpen((o) => !o)}
        style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "15px 18px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🌐</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C" }}>{tr("profile.entry.language", "Language")}</div>
          <div style={{ fontSize: 12, color: "#A8A5A0" }}>{current.flag} {current.label}</div>
        </div>
        <div style={{ color: "#C9C6C1", fontSize: 16 }}>{open ? "▲" : "▾"}</div>
      </motion.div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }} style={{ overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: "10px 2px 2px" }}>
              {LANGS.map((l) => {
                const active = l.code === lang;
                return (
                  <motion.button key={l.code} whileTap={{ scale: 0.96 }} onClick={() => { setLang(l.code); setOpen(false); }}
                    style={{ display: "flex", alignItems: "center", gap: 8, background: active ? "#FFF0E7" : "#fff", border: `1px solid ${active ? "#FF5C00" : "#E8E6E0"}`, borderRadius: 12, padding: "10px 12px", cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: active ? "#B8430A" : "#0F0E0C", textAlign: "left", WebkitTapHighlightColor: "transparent" }}>
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{l.flag}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>{l.label}</span>
                    {active && <span style={{ color: "#FF5C00" }}>✓</span>}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function SupplyFlow({ session, factoriesVisible = true }) {
  useLangVersion();   // her-render de héle app bij een taalwissel (bv. via de Profiel-switcher)
  // ── Bezoek-trechter (2026-08-16) ────────────────────────────────────────────
  // "Ik ben er" bij binnenkomst + een hartslag zolang het tabblad zichtbaar is,
  // zodat we weten hoe lang iemand blijft. Product-opens en mandje-acties worden
  // apart gemeld (zie hieronder). Stil falen: meten mag de app nooit ophouden.
  useEffect(() => {
    let taal = null;
    try { taal = localStorage.getItem("flowva_lang"); } catch { /* geen taal bekend */ }
    // Verse bezoeker zonder opgeslagen keuze → browsertaal meesturen, anders toont
    // de trechter "?" terwijl juist de taal van nieuwe bezoekers interessant is.
    if (!taal) { try { taal = (navigator.language || "en").slice(0, 2); } catch { taal = "en"; } }
    track("visit", null, taal);
    const tik = () => { if (!document.hidden) track("visit"); };
    const id = setInterval(tik, 30000);
    document.addEventListener("visibilitychange", tik);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tik); };
  }, []);
  const [rawTab, setTab] = useState(() => { try { return new URLSearchParams(window.location.search).get("tab") === "profile" ? "profile" : "feed"; } catch { return "feed"; } });
  // 🫧 Blob-pull op de nav: houd een knop vast en beweeg → de oranje blob wordt elastisch
  // naar je vinger toe getrokken (rekt uit, wordt platter); loslaten boven een andere tab
  // = daarheen springen. Tik zonder bewegen blijft gewoon een tik.
  // Zet de admin de fabrieken uit (app_settings.factories_visible), dan valt de
  // Feed-tab weg en houden we 4 tabs over: de etalage is dan puur Brands. Niets
  // wordt verwijderd — weer aanzetten brengt de Feed ongewijzigd terug.
  const NAV_TABS = factoriesVisible
    ? ["feed", "brands", "orders", "transit", "profile"]
    : ["brands", "orders", "transit", "profile"];
  // Fabrieken uit → de Feed bestaat niet meer, dus val terug op Brands. Bewust
  // AFGELEID en niet via setTab in een effect: de vlag komt asynchroon binnen, en
  // een tab-wissel tijdens het mounten liet <AnimatePresence mode="wait"> vastlopen
  // (de oude Feed ging er nooit uit → scherm bleef op "Loading products…" hangen).
  const tab = (!factoriesVisible && rawTab === "feed") ? "brands" : rawTab;
  const navRef = useRef(null);
  const navDrag = useRef({ on: false, moved: false, startX: 0 });
  const pullRaw = useMotionValue(0);
  const pullX = useSpring(pullRaw, { stiffness: 420, damping: 30 });
  // Rek verankerd aan het BEGINPUNT: de blob schuift maar een beetje mee (x) en rekt
  // vooral uit richting je vinger (transformOrigin = de kant waar je vandaan trekt).
  const pullShift = useTransform(pullX, (v) => v * 0.35);
  const pullScaleX = useTransform(pullX, (v) => 1 + Math.min(1.05, Math.abs(v) / 55));
  const pullScaleY = useTransform(pullX, (v) => 1 - Math.min(0.35, Math.abs(v) / 120));
  const pullOrigin = useTransform(pullX, (v) => (v >= 0 ? "0% 50%" : "100% 50%"));
  // hard = direct naar 0 (zonder na-veren) — nodig bij een tab-wissel, anders erft de
  // blob op de nieuwe cel de oude uitrek-stand (de glitch uit de screenshots).
  const resetPull = (hard) => { if (hard) { pullRaw.jump(0); pullX.jump(0); } else { pullRaw.set(0); } };
  useEffect(() => { resetPull(true); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const navPointerMove = (e) => {
    const d = navDrag.current;
    if (!d.on || !navRef.current) return;
    if (Math.abs(e.clientX - d.startX) > 8) d.moved = true;
    const r = navRef.current.getBoundingClientRect();
    const tabW = r.width / NAV_TABS.length;
    const center = r.left + tabW * (NAV_TABS.indexOf(tab) + 0.5);
    const dx = e.clientX - center;
    pullRaw.set(Math.max(-tabW * 1.5, Math.min(tabW * 1.5, dx * 0.5)));
  };
  const navPointerUp = (e) => {
    // Window-luisteraars opruimen — óók als je buiten de balk loslaat (dat was de
    // "blob blijft hangen"-glitch: de nav kreeg dan nooit een pointerup).
    window.removeEventListener("pointermove", navPointerMove);
    const d = navDrag.current;
    if (!d.on) return;
    d.on = false;
    if (d.moved && navRef.current) {
      const r = navRef.current.getBoundingClientRect();
      const inside = e.clientY >= r.top - 30 && e.clientY <= r.bottom + 30 && e.clientX >= r.left && e.clientX <= r.right;
      const idx = Math.max(0, Math.min(NAV_TABS.length - 1, Math.floor((e.clientX - r.left) / (r.width / NAV_TABS.length))));
      if (inside && NAV_TABS[idx] !== tab) { resetPull(true); setTab(NAV_TABS[idx]); setSelectedOrder(null); return; }
    }
    resetPull(false);   // niets gekozen → elastisch terugveren naar het beginpunt
  };
  const navPointerDown = (e) => {
    navDrag.current = { on: true, moved: false, startX: e.clientX };
    window.addEventListener("pointermove", navPointerMove);
    window.addEventListener("pointerup", navPointerUp, { once: true });
    window.addEventListener("pointercancel", navPointerUp, { once: true });
  };
  const [products, setProducts] = useState([]);
  const [factories, setFactories] = useState([]);
  const [selectedFactory, setSelectedFactory] = useState(null);
  // Scroll-onafhankelijke shape-morph (fabriekskaart ↔ 'All factories'-pill).
  const [morph, setMorph] = useState(null); // { from:{left,top,width,height}, target:"pill"|"card", id, previews, extra, dia }
  const pillRef = useRef(null);
  const ghostRef = useRef(null);
  const overlayRef = useRef(null);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productsError, setProductsError] = useState(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [activeSub, setActiveSub] = useState(null);          // categorieknop binnen een winkel
  const [sizeFilter, setSizeFilter] = useState(null);        // maatknop binnen een winkel
  const [genderFilter, setGenderFilter] = useState(null);    // dames/heren bovenaan Brands
  const [productScores, setProductScores] = useState(new Map()); // populariteit per product (gastdata)
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderFilter, setOrderFilter] = useState("all");
  const [selectedProduct, setSelectedProduct] = useState(null);
  // Trechter: "product geopend" — centraal gemeten zodra de productsheet opengaat,
  // zodat ELK pad meetelt (feed, merkpagina, favorieten, zoeken) en niets dubbel telt.
  const laatstGemetenProduct = useRef(null);
  useEffect(() => {
    const pid = selectedProduct?.id;
    if (pid == null || laatstGemetenProduct.current === pid) return;
    laatstGemetenProduct.current = pid;
    track("product", pid);
  }, [selectedProduct?.id]);
  const [previewProduct, setPreviewProduct] = useState(null);
  const [reviewProduct, setReviewProduct] = useState(null);
  const [actionProduct, setActionProduct] = useState(null);
  // Coming soon / demo — hype-check-stemsheet + tellingen (id -> stats) + mijn stem (id -> reaction)
  const [hypeProduct, setHypeProduct] = useState(null);
  // "Foto vliegt naar de mand": bron-rect + doelpunt voor de FlyingImage-ghost.
  const [cartFlight, setCartFlight] = useState(null);
  const [voteStats, setVoteStats] = useState({});
  const [myVotes, setMyVotes] = useState({});
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);      // eerste indruk (2 schermen)
  const [showPricing, setShowPricing] = useState(false);
  const [showPricingTour, setShowPricingTour] = useState(false);
  const [showDiamond, setShowDiamond] = useState(false);
  // 💸 opent ALTIJD de vos-tour. De lap tekst (PricingSheet) komt er pas bij als je
  // in de tour op "See the full breakdown" tikt — dán schuift die van onderen omhoog.
  const closePricingTour = () => setShowPricingTour(false);
  const openBreakdown = () => { setShowPricingTour(false); setShowPricing(true); };
  // Boogvlucht van een feed-knop naar het icoon op z'n sheet (💸 pricing / 💎 diamond).
  // pending=true tot het doel gemeten is (sheet mount eerst, transform-gecorrigeerd).
  const [arcFlight, setArcFlight] = useState(null);   // { kind, emoji, sx, sy, tx, ty, pending }
  // Sheet dicht (backdrop-tik, ook mid-vlucht) → vlucht-state mee opruimen, anders
  // blijft het emoji verborgen en blokkeert de guard een volgende boog.
  useEffect(() => { if (!showPricing) setArcFlight((f) => (f?.kind === "pricing" ? null : f)); }, [showPricing]);
  useEffect(() => { if (!showDiamond) setArcFlight((f) => (f?.kind === "diamond" ? null : f)); }, [showDiamond]);
  const ARC_SHEETS = {
    pricing: { emoji: "💸", btn: "[data-money-btn]", icon: "[data-pricing-icon]", sheet: "[data-pricing-sheet]" },
    diamond: { emoji: "💎", btn: "[data-diamond-btn]", icon: "[data-diamond-icon]", sheet: "[data-diamond-sheet]" },
  };
  const openSheetWithArc = (kind) => {
    const cfg = ARC_SHEETS[kind];
    const open = kind === "diamond" ? setShowDiamond : setShowPricing;
    const isOpen = kind === "diamond" ? showDiamond : showPricing;
    if (isOpen || arcFlight) { open(true); return; }
    const src = document.querySelector(cfg.btn)?.getBoundingClientRect();
    open(true);
    if (!src) return;
    setArcFlight({ kind, emoji: cfg.emoji, pending: true, sx: src.left + src.width / 2, sy: src.top + src.height / 2 });
    // 50ms-timer i.p.v. rAF: de sheet is dan gemount, en timers lopen óók door als
    // frames even stilstaan (achtergrond-tab) — geen eeuwig-verborgen emoji's.
    setTimeout(() => {
      const icon = document.querySelector(cfg.icon);
      if (!icon) { setArcFlight(null); return; }
      const r = icon.getBoundingClientRect();
      // De sheet schuift nog omhoog (translateY) — corrigeer naar de EINDpositie.
      let dx = 0, dy = 0;
      const sheet = document.querySelector(cfg.sheet);
      if (sheet) {
        const tr = getComputedStyle(sheet).transform;
        if (tr && tr !== "none") { const m = new DOMMatrixReadOnly(tr); dx = m.e; dy = m.f; }
      }
      setArcFlight((f) => f ? { ...f, tx: r.left + r.width / 2 - dx, ty: r.top + r.height / 2 - dy, pending: false } : null);
    }, 50);
  };
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [orders, setOrders] = useState([]);
  // Auto-gerefunde (geannuleerde) orders voor het belletje: out-of-stock / niet-verzonden.
  const [refundNotices, setRefundNotices] = useState([]);
  const [seenRefundIds, setSeenRefundIds] = useState([]);
  // Flowva support: berichten van de admin (templates) + de inbox-sheet.
  const [supportMsgs, setSupportMsgs] = useState([]);
  const [showSupport, setShowSupport] = useState(false);
  // "New message"-badge (user 2026-07-22): alleen bij de EERSTE keer lezen — we onthouden
  // welke berichten ongelezen waren op het moment van openen; volgende keer is 'ie weg.
  const [freshSupportIds, setFreshSupportIds] = useState([]);
  const openSupport = async () => {
    setShowNotifs(false);
    setFreshSupportIds(supportMsgs.filter((m) => !m.read).map((m) => m.id));
    setShowSupport(true);
    // Openen = gelezen: server-side markeren + lokaal bijwerken (badge telt direct af).
    try { await supabase.rpc("support_mark_all_read"); } catch {}
    setSupportMsgs((cur) => cur.map((m) => ({ ...m, read: true })));
  };
  const closeSupport = () => { setShowSupport(false); setFreshSupportIds([]); };
  // Template_key → vertaalde berichttekst (8 talen; Engels = fallback). 'custom' = de
  // vrije tekst die de admin typte (body, onvertaald).
  const supportText = (m) => {
    const p = { productName: m.product_title || "your item" };
    switch (m.template_key) {
      case "delay": return tr("support.tpl.delay", "“{productName}” is delayed at the factory — we're keeping an eye on it, please allow a few more days.", p);
      case "never_shipped": return tr("support.tpl.neverShipped", "The factory never shipped “{productName}”. You've been fully refunded — sorry about this.", p);
      case "unavailable": return tr("support.tpl.unavailable", "“{productName}” turned out to be unavailable after all. You've been fully refunded.", p);
      case "refund_accepted": return tr("support.tpl.refundAccepted", "Your refund request for “{productName}” has been accepted — you've been fully refunded.", p);
      case "deny_ok_item": return tr("support.tpl.denyOkItem", "We reviewed the quality-control photos of “{productName}” carefully — your item matches what you ordered and we found no defect. It will ship as normal.", p);
      case "deny_change_mind": return tr("support.tpl.denyChangeMind", "The factory doesn't accept change-of-mind returns at this stage. “{productName}” will ship as normal — after it arrives you can still use our regular return policy.", p);
      case "deny_size_match": return tr("support.tpl.denySizeMatch", "The size and variant of “{productName}” match exactly what was selected at checkout, so we can't treat this as a fault. It will ship as normal.", p);
      case "deny_minor_variation": return tr("support.tpl.denyMinorVariation", "Small variations in color or finish can occur and fall within normal production standards — “{productName}” isn't considered defective. It will ship as normal.", p);
      case "deny_evidence": return tr("support.tpl.denyEvidence", "The evidence provided for “{productName}” isn't enough to confirm a defect. Send a new request with clearer photos if you'd like us to take another look — otherwise it ships as normal.", p);
      case "storage_month_left": return tr("support.tpl.storageMonthLeft", "“{productName}” has been in the warehouse for 60 days — you have one month left. Ship it before day 90, or it will be forfeited.", p);
      case "storage_warning": return tr("support.tpl.storageWarning", "Today is the last day you can ship “{productName}” — tomorrow it will be forfeited.", p);
      case "storage_forfeited": return tr("support.tpl.storageForfeited", "“{productName}” has been forfeited — contact support for more info.", p);
      case "custom": return m.body || "";
      default: return tr("support.tpl.unknownRefund", "Something went wrong with “{productName}” and we couldn't resolve it. To be safe, you've been fully refunded.", p);
    }
  };
  const [balance, setBalance] = useState(0);
  // Mag dit account winkels zien die nog verborgen zijn? (profiles.can_preview)
  const [canPreview, setCanPreview] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [successProduct, setSuccessProduct] = useState(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupAgreed, setTopupAgreed] = useState(false);
  const [payoutInfo, setPayoutInfo] = useState(null);    // null = paneel dicht
  const [payoutBusy, setPayoutBusy] = useState(false);
  // Apparaat-lokale state PER GEBRUIKER opslaan, zodat een ander account op hetzelfde
  // toestel nooit de mand/favorieten/haul van de vorige ziet — ook zonder uitloggen.
  const uid = session?.user?.id || "anon";
  const lsKey = (base) => `${base}_${uid}`;

  // —— BROWSE-FIRST GUEST-GATE ——————————————————————————————————————————
  // Zonder sessie mag je vrij rondkijken (etalage). Acties die je identiteit of geld raken
  // (afrekenen, koop-nu, opwaarderen, adres, orders/warehouse/transit/profiel, Friends) roepen
  // requireAuth() aan → dat opent een inlog/registreer-overlay i.p.v. de actie uit te voeren.
  const isGuest = !session;
  const [authOpen, setAuthOpen] = useState(false);
  const requireAuth = () => { if (isGuest) { setAuthOpen(true); return false; } return true; };
  // Zodra er een sessie is (na inloggen) de overlay sluiten — SupplyFlow blijft dezelfde
  // instance (App remount niet), dus dit doen we expliciet i.p.v. via unmount.
  useEffect(() => { if (session) setAuthOpen(false); }, [session]);

  // 📦 Automatisch pakket (Optie B): aangekomen items zitten VANZELF in je pakket.
  // Alleen de uitzonderingen bewaren we: ids die de klant bewust apart houdt.
  const [parcelHeldOut, setParcelHeldOut] = useState(() => {
    try {
      const saved = localStorage.getItem(lsKey("flowva_parcel_heldout"));
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  useEffect(() => {
    localStorage.setItem(lsKey("flowva_parcel_heldout"), JSON.stringify(parcelHeldOut));
  }, [parcelHeldOut]);
  // Sync-tikker: bumpen zodra de klant elders een groep-item Ready/Unready zet, zodat de
  // group parcel (eigen squad-poll) meteen ververst i.p.v. tot de 8s-poll te wachten.
  const [parcelRefresh, setParcelRefresh] = useState(0);
  // Belletje: refund-meldingen (out-of-stock / niet verzonden) die de klant al wegtikte —
  // per account bewaard, zodat de melding niet eeuwig blijft staan.
  useEffect(() => {
    try { setSeenRefundIds(JSON.parse(localStorage.getItem(lsKey("flowva_seen_refunds")) || "[]")); } catch { setSeenRefundIds([]); }
  }, [uid]);
  const dismissRefundNotice = (id) => {
    setSeenRefundIds((cur) => {
      const next = cur.includes(id) ? cur : [...cur, id];
      try { localStorage.setItem(lsKey("flowva_seen_refunds"), JSON.stringify(next)); } catch {}
      return next;
    });
  };
  // Apart houden / terugzetten. GROEP: sync direct met de server (box_staged_at):
  // apart = niet Ready (uit de doos); terugzetten = weer Ready (de klant heeft de
  // foto's al gezien via de sheet). Solo blijft puur client-side zoals voorheen.
  const toggleParcelHold = (id) => {
    const wasHeld = parcelHeldOut.includes(id);
    setParcelHeldOut((prev) => (wasHeld ? prev.filter((x) => x !== id) : [...prev, id]));
    const o = orders.find((x) => x.id === id);
    if (o?.ff_group_id) {
      supabase.rpc("ff_stage_box", { p_order_ids: [id], p_staged: wasHeld }).then(() => { fetchOrders(); setParcelRefresh((n) => n + 1); });
    }
  };
  // ✓ Ready (Flowva Friends): de klant bevestigt na het inspecteren van de foto's dat
  // het item mee mag in het groepspakket → box_staged_at (server telt alleen Ready-items
  // in de verzend-gate + gewichtssplitsing). Haalt het item ook uit "apart gehouden".
  const markParcelReady = async (o) => {
    const { data } = await supabase.rpc("ff_stage_box", { p_order_ids: [o.id], p_staged: true });
    if (data?.ok) {
      setParcelHeldOut((prev) => prev.filter((x) => x !== o.id));
      setInspectItem((cur) => (cur && cur.id === o.id ? { ...cur, box_staged_at: new Date().toISOString() } : cur));
      setSelectedOrder((cur) => (cur && cur.id === o.id ? { ...cur, box_staged_at: new Date().toISOString() } : cur));
      fetchOrders();
      setParcelRefresh((n) => n + 1);
    }
  };
  // Sheet openen — eigen items verrijken vanuit `orders` (heeft dispute-/probleem-velden).
  const openInspectItem = (o) => {
    const own = orders.find((x) => x.id === o.id);
    setInspectItem(own ? { ...o, ...own } : o);
  };

  // Aanvraaglijst: items verzamelen en in één keer aanvragen (= één service fee).
  const [requestList, setRequestList] = useState(() => {
    try {
      const saved = localStorage.getItem(lsKey("supplyflow_request_list"));
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [showRequestList, setShowRequestList] = useState(false);
  // Trechter: "checkout gestart" = het mandje/checkout-scherm openen mét items erin
  // (in deze app is de mand-sheet hét afrekenscherm: totalen + betaalknop).
  useEffect(() => {
    if (showRequestList && requestList.length > 0) track("checkout");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRequestList]);
  const [sendingList, setSendingList] = useState(false);
  const [listError, setListError] = useState(null);
  // Het bedrag dat pay_cart server-side nodig had toen het saldo te laag was —
  // gezaghebbender dan de client-berekening, dus dat wint in de tekort-melding.
  const [listNeeded, setListNeeded] = useState(null);
  // Terug van een opwaardering midden in het afrekenen (?resume=cart): de mand
  // meteen op het checkout-scherm openen i.p.v. bij de itemlijst.
  const [resumeCheckout, setResumeCheckout] = useState(false);
  // Source_urls van cart-items die "on hold" staan wegens een leverancier-wijziging,
  // plus per-url de reden (uitverkocht / variant weg / prijs omhoog) voor de badges.
  const [flaggedUrls, setFlaggedUrls] = useState([]);
  const [flaggedReasons, setFlaggedReasons] = useState({});
  // Flowva Friends: groep-sheet + actieve groep om "voor te shoppen".
  const [showFriends, setShowFriends] = useState(false);
  const [groupOrders, setGroupOrders] = useState([]);   // alle orders van de actieve groep (alleen-lezen)
  const [groupHostId, setGroupHostId] = useState(null); // host van de actieve groep → 🏠-badge in de squad-lijst
  const [squadWheel, setSquadWheel] = useState(null);   // squad-item waarvan de voortgangscirkel openstaat
  // 🔍 Item-inspectiesheet (Friends): squad-/pakket-item dat openstaat. Eigen items
  // verrijken we vanuit `orders` (RPC-rijen missen dispute-/probleem-velden).
  const [inspectItem, setInspectItem] = useState(null);
  // Geleverde orders die de klant zelf uit de lijst heeft weggehaald (✕). Per-device in localStorage —
  // het is puur een weergave-voorkeur; de order/het pakket blijft gewoon in de In transit-tab vindbaar.
  // Weggeruimde (afgeleverde) kaarten. BUG-FIX 2026-07-22: was één lijst per TOESTEL
  // (key zonder uid) — wisselen van testaccount verborg andermans kaarten. Nu per
  // account, met migratie van de oude key; fetchOrders schoont niet-afgeleverde ids
  // er automatisch uit (zelfherstellend voor toestellen waar 't al misging).
  const [dismissedOrders, setDismissedOrders] = useState(() => {
    try {
      const own = localStorage.getItem(lsKey("flowva_dismissed_orders"));
      if (own != null) return new Set(JSON.parse(own));
      return new Set(JSON.parse(localStorage.getItem("flowva_dismissed_orders") || "[]"));
    } catch { return new Set(); }
  });
  const dismissOrders = (ids) => setDismissedOrders((prev) => {
    const next = new Set(prev); ids.forEach((id) => next.add(id));
    try { localStorage.setItem(lsKey("flowva_dismissed_orders"), JSON.stringify([...next])); } catch {}
    return next;
  });
  const [hauls, setHauls] = useState([]);   // parcels — voor "Parcel N"-nummering in de Orders-tab
  const [friendsJoinCode, setFriendsJoinCode] = useState(null);
  const [friendsGroupId, setFriendsGroupId] = useState(null);   // direct een lobby openen (vanaf de groeps-cart)
  const [activeGroup, setActiveGroup] = useState(() => {
    try { return JSON.parse(localStorage.getItem(lsKey("flowva_active_group")) || "null"); } catch { return null; }
  });
  const [groupToast, setGroupToast] = useState(null);   // {kind,name} als de actieve groep van status wisselt
  // Verzend-lock van de groep-order in het detailscherm (user 2026-07-22, keuze B): zodra de
  // host de verzending vergrendelt, mag niemand nog Ready wijzigen of een refund aanvragen.
  const [selGroupShipLocked, setSelGroupShipLocked] = useState(false);
  useEffect(() => {
    if (!selectedOrder?.ff_group_id) { setSelGroupShipLocked(false); return; }
    let on = true;
    supabase.rpc("ff_group_shipping_state", { p_group_id: selectedOrder.ff_group_id }).then(({ data }) => {
      if (on) setSelGroupShipLocked(["quoted", "consolidating", "shipped"].includes(data?.shipment?.status));
    });
    return () => { on = false; };
  }, [selectedOrder?.id, selectedOrder?.ff_group_id]);
  // Verzend-lock van de ACTIEVE groep (user 2026-07-22): zodra de admin de verzending lockt
  // mag je niks meer aan de groep-mand toevoegen. De groep-status blijft 'gathering', dus dit
  // is het enige betrouwbare signaal. Herchecken bij het openen van een product.
  const [activeGroupShipLocked, setActiveGroupShipLocked] = useState(false);
  useEffect(() => {
    if (!activeGroup?.id) { setActiveGroupShipLocked(false); return; }
    let on = true;
    supabase.rpc("ff_group_shipping_state", { p_group_id: activeGroup.id }).then(({ data }) => {
      if (on) setActiveGroupShipLocked(["quoted", "consolidating", "shipped"].includes(data?.shipment?.status));
    });
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup?.id, selectedProduct?.id, showRequestList]);
  // Favorieten (per apparaat) + filter in de feed.
  const [favorites, setFavorites] = useState(() => { try { return JSON.parse(localStorage.getItem(lsKey("flowva_favorites")) || "[]"); } catch { return []; } });
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  // VABLE — eigen merk (borduurdesigns). Knop in de feed-header opent dit blad.
  // Vervang img:null door je echte foto-URL's (en VABLE_URL door je winkel-link).
  //
  // ⚡ AAN/UIT-KNOP (Kaito 17-08): op false staat de phoenix-knop niet in de feed.
  // Alles eromheen — het blad, de items, de vertalingen — blijft gewoon bestaan.
  // Wil je VABLE terug? Zet deze ene regel op `true` en het staat er weer.
  const VABLE_AAN = false;
  const [showVable, setShowVable] = useState(false);
  // Tab-wissel (Feed ↔ Brands ↔ rest): drill-in/zoek/favorieten-staat resetten zodat je
  // nooit met de fabriek-drill van de éne feed in de andere landt.
  useEffect(() => {
    setSelectedFactory(null); setShowFavoritesOnly(false); setSearch("");
    setActiveCategory("All"); setActiveSub(null); setSizeFilter(null); setMorph(null);
    feedScrollRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  // Scroll-behoud: bewaar de scrollpositie van de fabriek-feed bij het inzoomen op een
  // fabriek, en herstel 'm zodra je teruggaat — i.p.v. weer bovenaan te beginnen.
  const feedScrollRef = useRef(0);
  useLayoutEffect(() => {
    if ((tab === "feed" || tab === "brands") && !selectedFactory && !showFavoritesOnly && feedScrollRef.current) {
      const y = feedScrollRef.current;
      window.scrollTo(0, y);
      requestAnimationFrame(() => window.scrollTo(0, y));
      feedScrollRef.current = 0;
    }
  }, [selectedFactory, showFavoritesOnly, tab]);
  // Shape-morph (scroll-onafhankelijk): een position:fixed "ghost" kruipt van de aangetikte
  // fabriekskaart naar de 'All factories'-pill (en omgekeerd). Omdat we de VIEWPORT-rect van
  // het aangetikte element vastleggen i.p.v. Framers pagina-coördinaten, komt de morph voor
  // ELKE scrollpositie netjes uit de plek waar je tikt. Draait ná het scroll-herstel hierboven,
  // zodat de terugkerende kaart op z'n herstelde positie wordt gemeten.
  // De parallax verschuift de foto's ín de kaart (±12px, scroll-afhankelijk). De ghost
  // moet op de twee handoff-momenten (start + landing) EXACT dezelfde verschuiving
  // hebben, anders "springt" het beeld — dat was het stotteren bij terug-naar-feed.
  const plxApplyRef = useRef(null);
  useLayoutEffect(() => {
    if (!morph) return;
    const ghost = ghostRef.current;
    // Bij terug morphen we naar het FOTOGEBIED van de kaart (niet de hele kaart — daar
    // staan ook de statistieken; die horen niet bij de foto en moeten blijven staan).
    const destEl = morph.target === "pill"
      ? pillRef.current
      : (morph.id != null ? document.querySelector(`[data-factory-img="${morph.id}"]`) : null);
    if (!ghost || !destEl) { setMorph(null); return; }
    // Eindvorm: pill is rondom rond; het fotogebied is alleen bovenaan rond (de onderkant
    // sluit naadloos aan op het stats-gedeelte van de kaart).
    const toR = morph.target === "pill" ? "22px" : "20px 20px 0px 0px";
    // Snelle her-klik: de vorige vlucht kan nog een .44s-transitie op de ghost hebben
    // staan, en React schrijft net de nieuwe bron-rect in de style — zonder dit zou de
    // ghost zichtbaar van de oude naar de nieuwe bronpositie tweenen.
    ghost.style.transition = "none";
    destEl.style.visibility = "hidden"; // verberg alleen het doel-fotogebied; de ghost neemt het over
    let done = false;
    let armTimer = 0;
    let safetyTimer = 0;
    let raf1 = 0, raf2 = 0;
    const finish = () => {
      if (done) return; done = true;
      ghost.removeEventListener("transitionend", onEnd);
      window.removeEventListener("scroll", onScroll);
      clearTimeout(armTimer); clearTimeout(safetyTimer);
      // Parallax syncen op het landingsmoment: ghost-foto's en kaart-foto's krijgen
      // dezelfde verschuiving → naadloze overdracht, geen sprong meer.
      plxApplyRef.current?.();
      destEl.style.visibility = "";
      setMorph(null);
    };
    // Rond pas af op de breedte-transitie (verandert altijd 390↔125); negeer de
    // opacity-transitie van de overlay, anders zou die de morph te vroeg afbreken.
    const onEnd = (e) => { if (e.propertyName === "width") finish(); };
    // Scrollt de gebruiker TIJDENS de morph? Rond dan meteen af, zodat de foto direct bij
    // de echte kaart hoort i.p.v. dat de fixed ghost in beeld blijft "hangen".
    const onScroll = () => finish();
    // De vlucht start pas NA de eerste paint (dubbele rAF), om twee redenen:
    // (1) left/top/width/height-transities draaien per frame op de MAIN THREAD — en die
    //     is op dít moment verstopt door de zware feed-remount. De transitieklok tikt op
    //     wandtijd door, dus meteen starten = "bevroren" op de bron staan en dan in één
    //     klap naar het eind springen (het stotteren).
    // (2) het doel pas meten als de pagina écht op z'n plek staat: het rAF-scroll-herstel
    //     hierboven en framer's entree-styles zijn dan verwerkt → geen landing op een
    //     verouderde (te lage) rect meer.
    let started = false;
    const start = () => {
      if (done || started) return; started = true;
      const to = destEl.getBoundingClientRect();
      if (!to.width || !to.height) { finish(); return; }
      void ghost.offsetWidth; // forceer reflow op de bron-rect vóór we naar het doel zetten
      plxApplyRef.current?.(); // parallax syncen op het startmoment (ghost staat op de bron-rect)
      const ease = "cubic-bezier(0.32, 0.72, 0, 1)";
      ghost.style.transition = `left .44s ${ease}, top .44s ${ease}, width .44s ${ease}, height .44s ${ease}, border-radius .44s ${ease}`;
      ghost.style.left = `${to.left}px`;
      ghost.style.top = `${to.top}px`;
      ghost.style.width = `${to.width}px`;
      ghost.style.height = `${to.height}px`;
      ghost.style.borderRadius = toR;
      // Overlay (witte 'All factories'-pill): heen pas op het eind in, terug meteen uit →
      // de foto blijft tijdens de beweging zichtbaar.
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.style.transition = morph.target === "pill" ? "opacity .2s ease 0.22s" : "opacity .18s ease";
        overlay.style.opacity = morph.target === "pill" ? "1" : "0";
      }
      ghost.addEventListener("transitionend", onEnd);
      safetyTimer = setTimeout(finish, 560); // vangnet als transitionend uitblijft
      // Scroll-luisteraar pas na ~120ms koppelen: de eerste momenten scrollen we ZELF
      // programmatisch (scrollTo bij in-/uitzoomen) — die scroll mag de morph niet afbreken.
      armTimer = setTimeout(() => window.addEventListener("scroll", onScroll, { passive: true, once: true }), 120);
    };
    raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(start); });
    // Vangnet: in een achtergrond-tab staat rAF stil — dan start de timer de vlucht
    // alsnog, zodat het doelgebied nooit verborgen blijft hangen. (started-guard: wie
    // het eerst komt, wint; de ander is een no-op.)
    const startFallback = setTimeout(start, 300);
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(startFallback); clearTimeout(safetyTimer); clearTimeout(armTimer); ghost.removeEventListener("transitionend", onEnd); window.removeEventListener("scroll", onScroll); destEl.style.visibility = ""; };
  }, [morph]);
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
  // Servicebelofte op het TOEVOEGMOMENT (Kaito 13-08): precies daar denkt iemand
  // "en als het niet past?". De mandje-balk zegt de eerste seconden wat wij doen,
  // en zakt daarna terug naar z'n normale tekst — geen popup, geen vaste ruimte.
  // Aan de toevoeg-ACTIE gehangen (niet aan een teller): dat is het enige moment
  // dat we echt bedoelen, en het overleeft herladen met een gevuld mandje.
  const [justAdded, setJustAdded] = useState(false);
  const justAddedTimer = useRef(null);
  const flashPromise = () => {
    setJustAdded(true);
    clearTimeout(justAddedTimer.current);
    justAddedTimer.current = setTimeout(() => setJustAdded(false), 4600);
  };
  useEffect(() => () => clearTimeout(justAddedTimer.current), []);
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
    if (!activeGroup) { setGroupOrders([]); setGroupHostId(null); return; }
    let on = true;
    supabase.rpc("ff_group_orders", { p_group_id: activeGroup.id }).then(({ data }) => {
      if (on && data?.ok) { setGroupOrders(data.orders || []); setGroupHostId(data.host_id || null); }
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
        if (session) {
          setShowFriends(true);
          window.history.replaceState({}, "", window.location.pathname);
        } else {
          setAuthOpen(true);   // gast met invite-link → eerst inloggen; de effect hieronder opent de lobby ná login
        }
      }
    } catch { /* ignore */ }
  }, []);
  // Terug van iDEAL na een opwaardering midden in een betaling. ?resume=… zegt
  // waar de klant zat, zodat hij niet op de feed landt maar meteen weer op het
  // scherm staat waar alleen nog "betalen" hoeft — met het saldo nu op peil.
  useEffect(() => {
    if (!session) return;
    try {
      const q = new URLSearchParams(window.location.search);
      const resume = q.get("resume");
      if (!resume) return;
      if (resume === "cart") { setResumeCheckout(true); setShowRequestList(true); }
      else if (resume === "friends") { const gid = q.get("g"); if (gid) setFriendsGroupId(gid); setShowFriends(true); }
      else if (resume === "orders") { setTab("orders"); setSelectedOrder(null); }
      window.history.replaceState({}, "", window.location.pathname);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Gast die met een ?join-code net inlogt: alsnog de Friends-lobby openen.
  useEffect(() => {
    if (session && friendsJoinCode) {
      setShowFriends(true);
      try { window.history.replaceState({}, "", window.location.pathname); } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

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

  // Toon "How Flowva works" één keer automatisch bij de allereerste keer — ALLEEN voor
  // gasten (ingelogde gebruikers kennen de app al; zij openen 'm via Profile → How Flowva
  // works). Deps op isGuest: logt iemand snel in (sessie laadt), dan ruimt de cleanup de
  // 900ms-timer op vóór 'ie vuurt, dus de tour verschijnt niet voor ingelogde gebruikers.
  useEffect(() => {
    if (!isGuest) return;
    try {
      if (!localStorage.getItem(lsKey("flowva_seen_howitworks"))) {
        const t = setTimeout(() => setShowWelcome(true), 900);
        return () => clearTimeout(t);
      }
    } catch { /* localStorage kan geblokkeerd zijn */ }
  }, [isGuest]);
  // Eén vlag voor beide: wie het welkomstscherm heeft gezien krijgt 'm niet opnieuw.
  const markIntroSeen = () => { try { localStorage.setItem(lsKey("flowva_seen_howitworks"), "1"); } catch { /* ignore */ } };
  const closeHowItWorks = () => { markIntroSeen(); setShowHowItWorks(false); };
  const closeWelcome = () => { markIntroSeen(); setShowWelcome(false); };

  // Instant checkout: reken de hele mand in één keer af (server-side pay_cart).
  // Geeft true terug bij succes → de sheet morpht dan naar de "placed"-weergave.
  const submitRequestList = async () => {
    if (!requestList.length || sendingList) return false;
    if (isGuest) { setAuthOpen(true); return false; }   // gast → eerst een account
    setSendingList(true);
    setListError(null);
    setListNeeded(null);

    // Holds komen alleen nog van de handmatige admin-vlag (price_alert, gelezen bij het
    // openen van de winkelwagen). De automatische live-prijscheck bij checkout is bewust
    // verwijderd (user 2026-07-21, simpel houden): de admin ververst prijzen handmatig
    // via "prijzen & voorraad"; een geweigerde order wordt sowieso auto-terugbetaald.
    const heldSet = new Set(flaggedUrls);

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
      if (data?.error === "Insufficient balance") {
        // Geen doodlopende melding: het tekort-blok in de sheet biedt nu zelf
        // "waardeer precies €X op" aan, dus alleen het bedrag doorgeven.
        setListNeeded(Number(data.needed) || null);
      } else {
        setListError(data?.error || tr("common.somethingWentWrong", "Something went wrong. Please try again."));
      }
      return false;
    }
    // Betaalde items verlaten de cart; held items blijven bewaard.
    track("paid");                                     // trechter: bestelling betaald ✓
    setRequestList((list) => list.filter((it) => it.source_url && heldSet.has(it.source_url)));
    fetchOrders();
    fetchBalance();
    return true;
  };

  // Catalogus (producten + fabrieken) — óók aangeroepen door de vos-pull-to-refresh.
  const refreshCatalog = async (initial = false) => {
    if (initial) { setLoadingProducts(true); setProductsError(null); }
    const [p, f, sc] = await Promise.all([
      supabase.from("products").select("*").order("id"),
      supabase.from("factories").select("*"),
      supabase.rpc("product_scores"),
    ]);
    // Populariteit op eigen gastdata (22-08): bekeken + 10× in-mandje, interne
    // accounts niet meegeteld. Bepaalt de volgorde in de winkel én de etalage.
    setProductScores(new Map((sc.data ?? []).map((r) => [r.product_id, Number(r.score) || 0])));
    // Verborgen winkels (factories.hidden) verdwijnen mét hun producten uit de app.
    // Accounts met can_preview zien ze wél — zo kan een winkel rustig afgemaakt worden
    // terwijl klanten er niets van merken (2026-08-16).
    const verborgenWinkels = new Set((f.data ?? []).filter((x) => x.hidden).map((x) => x.id));
    if (p.error) { if (initial) setProductsError(p.error.message); }
    else setProducts((p.data ?? []).filter((x) => !x.hidden && (canPreview || !verborgenWinkels.has(x.factory_id))));
    setFactories((f.data ?? []).filter((x) => canPreview || !x.hidden));
    if (initial) setLoadingProducts(false);
  };
  useEffect(() => { refreshCatalog(true); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // De catalogus laadt vóórdat het profiel binnen is. Blijkt dit account te mogen
  // vooruitkijken, dan halen we 'm één keer opnieuw op — nu mét de verborgen winkels.
  useEffect(() => { if (canPreview) refreshCatalog(false); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPreview]);

  // 🦊 Pull-to-refresh op de feed: trek omlaag → drie pootafdrukken lichten één voor
  // één op; ver genoeg loslaten → de vos huppelt terwijl de catalogus ververst.
  const [pull, setPull] = useState(0);
  const [ptrBusy, setPtrBusy] = useState(false);
  const ptrRef = useRef({ startY: 0, active: false });
  // Elastische bottom-pull (rek de content omhoog als je op de bodem verder trekt).
  const stretchRef = useRef(null);       // de content-wrapper die meebeweegt
  const bottomGlowRef = useRef(null);    // oranje 'einde'-gloed onderaan
  const bpRef = useRef({ startY: 0, active: false });
  const uiRef = useRef({});
  uiRef.current = {
    tab,
    blocked: !!(selectedProduct || showRequestList || showFriends || showVable || hypeProduct || showNotifs || authOpen || morph || selectedOrder),
    // Voor de bottom-pull: alléén échte fixed-overlays blokkeren (order-detail is gewone
    // scrollende content en mág rekken → niet in deze lijst).
    overlay: !!(selectedProduct || showRequestList || showFriends || showVable || hypeProduct || showNotifs || authOpen || morph || previewProduct || actionProduct || reviewProduct || orderSuccess || successProduct || showEditProfile || showHowItWorks || showWelcome || showPricing || showPricingTour || showDiamond || squadWheel),
  };
  useEffect(() => {
    const onStart = (e) => {
      const u = uiRef.current;
      if ((u.tab !== "feed" && u.tab !== "brands") || u.blocked || window.scrollY > 0) return;
      ptrRef.current = { startY: e.touches[0].clientY, active: true };
    };
    const onMove = (e) => {
      if (!ptrRef.current.active) return;
      const dy = e.touches[0].clientY - ptrRef.current.startY;
      if (dy <= 0 || window.scrollY > 0) { setPull(0); return; }
      if (e.cancelable) e.preventDefault();   // native overscroll uit zolang wij trekken
      setPull(Math.min(110, dy * 0.5));
    };
    const onEnd = () => {
      if (!ptrRef.current.active) return;
      ptrRef.current.active = false;
      setPull((p) => {
        if (p >= 62) {
          setPtrBusy(true);
          Promise.resolve(refreshCatalog(false)).finally(() => { setPtrBusy(false); setPull(0); });
          return 62;   // blijf op "refresh"-hoogte hangen terwijl we laden
        }
        return 0;
      });
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    return () => { window.removeEventListener("touchstart", onStart); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Elastische bottom-pull: sta je onderaan een pagina en trek je verder omhoog, dan rekt
  // de content elastisch mee (met weerstand) en gloeit er onderaan iets oranjes op; loslaten
  // = terugveren. Werkt op álle tabs. Imperatief (ref + style) zodat een touchmove niet de
  // hele app re-rendert. De wrapper krijgt alléén tijdens de trek een transform → in rust
  // geen containing-block (anders zouden fixed sheets binnen de tabs verspringen).
  useEffect(() => {
    const MAX = 78;
    const atBottom = () => (window.scrollY + window.innerHeight) >= (document.documentElement.scrollHeight - 2);
    // Zit het touch-target in een fixed/sticky overlay bínnen de wrapper (bv. een
    // warehouse-sheet)? Dan niet de pagina erachter rekken.
    const insideFixed = (node) => {
      let el = node; const stop = stretchRef.current;
      while (el && el !== stop && el !== document.body) {
        const pos = getComputedStyle(el).position;
        if (pos === "fixed" || pos === "sticky") return true;
        el = el.parentElement;
      }
      return false;
    };
    const setGlow = (px) => { const g = bottomGlowRef.current; if (g) g.style.opacity = String(Math.min(1, Math.abs(px) / 44)); };
    const onStart = (e) => {
      const b = bpRef.current; b.active = false;
      const u = uiRef.current;
      const w = stretchRef.current;
      const t = e.touches ? e.touches[0] : e;
      if (u.overlay) return;                                   // een sheet/overlay staat open
      if (!w || !w.contains(e.target)) return;                 // nav/cart/sheets zitten buiten de wrapper
      if (insideFixed(e.target)) return;                       // interne fixed overlay
      if (!atBottom()) return;                                 // alleen als je écht onderaan staat
      b.startY = t.clientY; b.active = true;
      w.style.transition = "none";
      const g = bottomGlowRef.current; if (g) g.style.transition = "none";
    };
    const onMove = (e) => {
      const b = bpRef.current; if (!b.active) return;
      const w = stretchRef.current; if (!w) return;
      const t = e.touches ? e.touches[0] : e;
      const dy = t.clientY - b.startY;                         // vinger omhoog → dy < 0
      if (dy >= 0 || !atBottom()) { w.style.transform = ""; setGlow(0); if (dy >= 0) b.active = false; return; }
      const pulled = Math.min(MAX, Math.abs(dy) * 0.42);       // weerstand
      w.style.transform = `translateY(${-pulled}px)`;
      setGlow(pulled);
      if (e.cancelable) e.preventDefault();
    };
    const onEnd = () => {
      const b = bpRef.current; if (!b.active) return;
      b.active = false;
      const w = stretchRef.current, g = bottomGlowRef.current;
      if (w) { w.style.transition = "transform .5s cubic-bezier(0.22, 1.1, 0.36, 1)"; w.style.transform = "translateY(0px)"; }
      if (g) { g.style.transition = "opacity .45s ease"; g.style.opacity = "0"; }
      // Na de terugveer: transition + lege transform opruimen (geen containing-block in rust).
      setTimeout(() => { if (w && !bpRef.current.active) { w.style.transition = ""; w.style.transform = ""; } }, 520);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => { window.removeEventListener("touchstart", onStart); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); window.removeEventListener("touchcancel", onEnd); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Grof-pointer (touch = telefoon/tablet): daar geeft de collage-parallax op sommige mobiele
  // GPU's beeld-FLIKKER (willChange:transform + constante transform-updates blanken de foto
  // heel even). Detecteer 't en sla de JS-parallax daar volledig over → statische foto's, geen
  // flikker. Desktop (fine pointer) houdt het effect.
  const coarsePointer = typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  // Micro-parallax op álle collage-foto's ([data-plx] = factor; groot 0.05, klein 0.035) —
  // rAF-throttled, geclamped ±12px. De trage interval vangt net-gemounte foto's én de
  // morph-ghost (die dezelfde collage rendert), zodat de kaart↔ghost-handoff blijft kloppen.
  useEffect(() => {
    if (coarsePointer) return;   // mobiel: geen JS-parallax → geen beeld-flikker (plxApplyRef blijft null; de morph roept 't via ?.() aan = no-op)
    let raf = 0;
    const apply = () => {
      raf = 0;
      const vh = window.innerHeight;
      document.querySelectorAll("img[data-plx]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < -40 || r.top > vh + 40) return;
        const k = parseFloat(el.dataset.plx) || 0.05;
        const off = Math.max(-12, Math.min(12, ((r.top + r.height / 2) - vh / 2) * k));
        el.style.transform = `translateY(${off.toFixed(1)}px) scale(1.12)`;
      });
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply); };
    window.addEventListener("scroll", onScroll, { passive: true });
    const iv = setInterval(apply, 350);
    plxApplyRef.current = apply;   // de morph roept dit aan op z'n handoff-momenten
    apply();
    return () => { window.removeEventListener("scroll", onScroll); clearInterval(iv); if (raf) cancelAnimationFrame(raf); plxApplyRef.current = null; };
  }, []);

  // Hype-check: laad de stem-tellingen + mijn eigen stem voor alle demo/"Coming soon"-producten.
  useEffect(() => {
    const demoIds = products.filter((p) => p.demo).map((p) => p.id);
    if (!demoIds.length) { setVoteStats({}); setMyVotes({}); return; }
    getVoteStats(demoIds).then(setVoteStats);
    getMyVotes(demoIds, !!session).then(setMyVotes);
  }, [products, session]);


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
    // can_preview: mag dit account winkels zien die nog verborgen zijn? (2026-08-16)
    const { data } = await supabase.from("profiles").select("balance, can_preview").eq("id", session.user.id).single();
    setBalance(data?.balance || 0);
    setCanPreview(!!data?.can_preview);
  };

  const fetchOrders = async () => {
    // Verbeurde items blijven ZICHTBAAR (user 2026-07-22): grijze chip in de lijst + in het
    // pakket; alleen geannuleerde orders blijven eruit.
    const { data } = await supabase.from("orders").select("*").eq("user_id", session.user.id).not("status", "in", "(cancelled)").order("created_at", { ascending: false });
    setOrders(data || []);
    // Zelfherstel (bug-fix 2026-07-22): "weggeruimd" hoort alleen bij AFGELEVERDE en
    // IN-TRANSIT kaarten (die laatste zijn sinds vandaag ook wegklikbaar — het pakket
    // leeft door in de Transit-tab). Staat een andere levende order tóch in het
    // weggeruimd-lijstje (oude toestel-brede key / account-wissel), haal 'm eruit.
    setDismissedOrders((prev) => {
      const wrong = (data || []).filter((o) =>
        prev.has(o.id) && o.status !== "delivered" &&
        (statusConfig[o.status]?.step ?? 0) <= statusConfig.qc_pending.step).map((o) => o.id);
      if (!wrong.length) return prev;
      const next = new Set(prev); wrong.forEach((id) => next.delete(id));
      try { localStorage.setItem(lsKey("flowva_dismissed_orders"), JSON.stringify([...next])); } catch {}
      return next;
    });
    // Auto-gerefunde orders (out-of-stock / niet verzonden) worden geannuleerd en verdwijnen
    // uit de lijst — maar de klant MOET weten dat 'ie z'n geld terugkreeg (belletje-melding,
    // user 2026-07-21). bd_error draagt de reden (gezet door refund_order); we tonen alleen
    // de laatste 14 dagen en filteren op de twee bekende automatische redenen.
    const { data: refunded } = await supabase.from("orders")
      .select("id, product_title, product, kleur, qty, price, variant_image, bd_error, created_at, ff_group_id, request_group_id")
      .eq("user_id", session.user.id).eq("status", "cancelled").not("bd_error", "is", null)
      .gte("created_at", new Date(Date.now() - 14 * 864e5).toISOString())
      .order("created_at", { ascending: false });
    setRefundNotices((refunded || []).filter((o) =>
      /^out of stock \/ unavailable/i.test(o.bd_error || "") || /^buckydrop cancelled the order/i.test(o.bd_error || "") || /^factory defect/i.test(o.bd_error || "") || /^support refund/i.test(o.bd_error || "")));
    // Flowva support-berichten (belletje + inbox-sheet). Template_key → vertaalde tekst client-side.
    const { data: sup } = await supabase.from("support_messages")
      .select("id, order_id, product_title, template_key, group_name, body, read, created_at")
      .eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(20);
    setSupportMsgs(sup || []);
  };
  // Parcels (oudste eerst) — zelfde set + nummering als de In transit-tab.
  const fetchHauls = async () => {
    const { data } = await supabase.from("hauls").select("id, items, created_at, status, settled_at, refund_eur").eq("user_id", session.user.id).in("status", ["confirmed", "shipped"]).order("created_at", { ascending: true });
    setHauls(data || []);
  };

  // Ververs orders bij het openen van Orders/Transit — de status kan net
  // gewijzigd zijn (bijv. naar "In transit" na een pakket-betaling).
  useEffect(() => {
    if (session && (tab === "orders" || tab === "transit")) { fetchOrders(); fetchHauls(); }
  }, [tab]);
  // Pakketten ook bij BINNENKOMST laden (2026-08-17): de 🎉-refundmelding leeft in
  // het belletje op de feed — zonder deze fetch wist het belletje pas van de refund
  // nadat je toevallig Orders/Transit had geopend.
  useEffect(() => {
    if (session) fetchHauls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

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
    track("topup");                                    // trechter: opwaarderen gestart
    setLoadingBalance(true);
    try {
      // invokeAsUser ververst een (bijna) verlopen sessie eerst en stuurt de JWT
      // expliciet mee — anders krijg je "Not authenticated" terwijl de app nog
      // gewoon je saldo toont (iOS bevriest de auto-refresh op de achtergrond).
      const { data, error } = await invokeAsUser("create-checkout", {
        amount: Math.round(parseFloat(topupAmount) * 100),
      });
      if (error) throw new Error(await functionErrorMessage(error));
      // Saldo-plafond (Terms §5.1): server weigert boven €1.000. Nette melding i.p.v.
      // een technische foutcode, mét het bedrag dat nog wél kan.
      if (data?.error === "balance_cap_reached") {
        alert(tr("profile.topup.capReached", "Your balance is already at the €{cap} maximum. Spend some of it first, or pay part of it out.", { cap: data.cap }));
        setLoadingBalance(false); return;
      }
      if (data?.error === "balance_cap_exceeded") {
        alert(tr("profile.topup.capExceeded", "Your balance can hold at most €{cap}. You can add up to €{max} right now.", { cap: data.cap, max: Number(data.maxTopUp).toFixed(2) }));
        setLoadingBalance(false); return;
      }
      if (!data?.url) throw new Error(data?.error || "Could not start the payment");
      window.location.href = data.url;
    } catch (err) { alert("Something went wrong: " + err.message); }
    setLoadingBalance(false);
  };

  // ── Saldo terug naar de bank ──────────────────────────────────────────────
  // Stripe stort alleen terug NAAR DE BETAALMETHODE WAARMEE GESTORT IS — een ander
  // rekeningnummer kan technisch niet. Daarom vragen we niets: we halen op wat er
  // terug kan en waarheen, en de klant bevestigt alleen nog.
  const askPayout = async () => {
    setPayoutBusy(true); setPayoutInfo(null);
    try {
      const { data, error } = await invokeAsUser("payout-balance", { action: "check" });
      if (error) throw new Error(await functionErrorMessage(error));
      setPayoutInfo(data);
    } catch (err) { setPayoutInfo({ ok: false, error: err.message }); }
    setPayoutBusy(false);
  };

  const doPayout = async () => {
    if (!payoutInfo?.payable) return;
    setPayoutBusy(true);
    try {
      const { data, error } = await invokeAsUser("payout-balance", { action: "payout", amount: payoutInfo.payable });
      if (error) throw new Error(await functionErrorMessage(error));
      if (!data?.ok) throw new Error(data?.error || "Could not process the payout");
      setPayoutInfo({ ...data, done: true });
      fetchBalance();
    } catch (err) { setPayoutInfo({ ok: false, error: err.message }); }
    setPayoutBusy(false);
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
  // Flowva support (user 2026-07-22): vaste regel in het belletje — ook bij 0 berichten.
  // Ongelezen berichten tellen mee in het badge-getal.
  const unreadSupport = supportMsgs.filter((m) => !m.read).length;
  // Meldingen afgeleid uit je orders: probleem, offerte klaar, agent reageerde, pakket bezorgd.
  const notifications = [
    // Auto-gerefunde orders (user 2026-07-21): out-of-stock of niet-verzonden → klant ziet
    // dat 'ie z'n geld terugkreeg. Wegtikbaar (dismiss), anders blijft 'ie 14 dagen staan.
    // Support-refunds NIET hier (het support-bericht hierboven ís de melding).
    ...refundNotices.filter((o) => !seenRefundIds.includes(o.id) && !/^support refund/i.test(o.bd_error || "")).map((o) => ({
      icon: /^factory defect/i.test(o.bd_error || "") ? "↩" : "⛔",
      text: /^factory defect/i.test(o.bd_error || "")
        ? tr("orders.notif.defectRefund", "“{productName}” had a factory defect — fully refunded, sorry!", { productName: o.product_title || o.product })
        : /^out of stock/i.test(o.bd_error || "")
          ? tr("orders.notif.oosRefund", "“{productName}” is out of stock — you received a refund", { productName: o.product_title || o.product })
          : tr("orders.notif.unsentRefund", "“{productName}” could not be sent — the reason is unclear and you received a refund", { productName: o.product_title || o.product }),
      dismissId: o.id,
    })),
    // 🎉 Verzend-refund (user 2026-08-17): de echte vrachtrekening viel lager uit →
    // geld terug op het saldo. Tikken = naar Transit (daar staat het bewijs); daarna weg.
    ...hauls.filter((h) => h.settled_at && Number(h.refund_eur) > 0 && !seenRefundIds.includes(h.id)).map((h) => ({
      icon: "🎉",
      text: tr("orders.notif.shipRefund", "Good news — you got €{amount} back! The real shipping bill was lower than the estimate. Tap to see the proof in Transit.", { amount: Number(h.refund_eur).toFixed(2) }),
      dismissId: h.id,
      transit: true,
    })),
    ...flaggedInCart.map((it) => ({ icon: "⏸️", text: `On hold: ${it.product_title} — ${flaggedReasons[it.source_url] || "changed at the factory"}`, cart: true })),
    ...orders.filter(o => o.problem_type).map(o => ({ icon: "⚠️", text: tr("orders.notif.actionNeeded", "Action needed: issue with {productName}", { productName: o.product_title || o.product }), order: o })),
    // Opslag-belmeldingen VERWIJDERD (user 2026-07-22): vervangen door Flowva
    // support-berichten op dag 60 / dag 90 / verbeurd — de teller op de itemregel
    // toont de dagen al continu.
    ...orders.filter(o => o.last_message_sender === "agent" && o.last_message_read === false).map(o => ({ icon: "💬", text: tr("orders.notif.agentReplied", "Your agent replied ({productName})", { productName: o.product_title || o.product }), order: o })),
    // "Delivered" zit bewust NIET meer in het belletje (bleef anders eeuwig staan) —
    // geleverde pakketten zie je in de Transit-tab.
  ];
  // Filter voor de reiskaart: een checkpoint kan meerdere statussen bundelen.
  const matchesFilter = (o) => orderFilter === "all" || (journeyStops.find(j => j.key === orderFilter)?.statuses || [orderFilter]).includes(o.status);
  // Modus-scheiding: solo-modus = alleen solo-orders (ff_group_id null); groep-modus = alleen die groep.
  // Zo zijn Orders/Warehouse/Transit twee duidelijk gescheiden modussen.
  // Solo/standaard-modus toont ALLE orders (ook groep-orders) zodat een geplaatste
  // groep-order altijd zichtbaar/volgbaar is; groep-modus blijft op die groep gefocust.
  // STRIKTE modus-scheiding (user 2026-07-22): solo toont alléén solo-orders; een groep
  // alléén die groep. (Vervangt de 2026-06-26-keuze waarbij solo alles toonde.)
  const visibleOrders = orders.filter((o) => (activeGroup ? o.ff_group_id === activeGroup.id : !o.ff_group_id) && !dismissedOrders.has(o.id));
  // Parcels genummerd op volgorde van aanmaak (Parcel 1 = oudste). order_id → { n, created_at }.
  const orderToParcel = {};
  hauls.forEach((h, i) => { (Array.isArray(h.items) ? h.items : []).forEach((id) => { orderToParcel[id] = { n: i + 1, created_at: h.created_at }; }); });
  const parcelInfoFor = (groupItems) => {
    const p = groupItems.map((o) => orderToParcel[o.id]).find(Boolean);
    if (!p) return null;
    let date = ""; try { date = new Date(p.created_at).toLocaleDateString("en-GB"); } catch {}
    return { label: tr("orders.card.parcelLabel", "Parcel {n}", { n: p.n }), date };
  };
  // Gerefunde items (user 2026-07-21/22): hoort de aankoop-groep nog een levende kaart te
  // hebben, dan tonen we het refunded item ÍN die kaart (met inbox-chip); is de hele aankoop
  // weg, dan als losse grijze kaart. Altijd binnen de actieve modus (solo vs die ene groep).
  const modeRefunds = refundNotices.filter((o) => (activeGroup ? o.ff_group_id === activeGroup.id : !o.ff_group_id));
  const liveGroupKeys = new Set(visibleOrders.map((o) => o.request_group_id || o.id));
  const refundedByGroup = {};
  modeRefunds.forEach((o) => { const k = o.request_group_id || o.id; (refundedByGroup[k] = refundedByGroup[k] || []).push(o); });
  // Wegklikbaar (user 2026-07-22): weggeklikte refund-kaarten blijven weg (zelfde
  // dismissed-lijst; cancelled orders zitten niet in fetchOrders, dus geen zelfherstel-botsing).
  const standaloneRefunds = modeRefunds.filter((o) => !liveGroupKeys.has(o.request_group_id || o.id) && !dismissedOrders.has(o.id));
  // 📦 Automatisch pakket: alle verzendbare magazijn-items van de actieve modus (solo =
  // geen ff_group_id, groep = die groep) zitten er vanzelf in; wat de klant apart houdt
  // (parcelHeldOut) blijft bewaard tot 'ie het terugzet. Al-betaalde (orderToParcel),
  // dispute- en retour-items doen nooit mee — zelfde regels als de oude warehouse.
  const parcelEligible = orders.filter((o) =>
    o.status === "qc_pending" && !orderToParcel[o.id] &&
    o.dispute_status !== "pending" && o.dispute_status !== "bucky_flagged" && !o.return_status &&
    (activeGroup ? o.ff_group_id === activeGroup.id : !o.ff_group_id));
  // Items met een LOPEND refund-verzoek (user 2026-07-22): blijven zichtbaar in het pakket
  // (embleem "Refund requested — awaiting response") en blokkeren Confirm & ship.
  const parcelPendingRefunds = orders.filter((o) =>
    o.status === "qc_pending" && o.dispute_status === "pending" && !orderToParcel[o.id] &&
    (activeGroup ? o.ff_group_id === activeGroup.id : !o.ff_group_id));
  // Defect gedetecteerd (user 2026-07-22): net als bij Friends blijft het item ZICHTBAAR
  // in het pakket-overzicht, met "Action needed" + "It's currently not in your parcel" —
  // solo heeft geen lock, dus we zeggen expliciet dat het item niet meegaat totdat de
  // klant kiest (accepteren → schuift vanzelf het pakket in; retour → refund).
  const parcelDefects = orders.filter((o) =>
    o.status === "qc_pending" && o.dispute_status === "bucky_flagged" && !orderToParcel[o.id] &&
    (activeGroup ? o.ff_group_id === activeGroup.id : !o.ff_group_id));
  // Verbeurde items (user 2026-07-22): blijven grijs zichtbaar in het pakket met het
  // embleem "Item forfeited", maar tellen nergens meer mee — Confirm & ship werkt gewoon.
  const parcelForfeited = orders.filter((o) =>
    o.status === "forfeited" && !orderToParcel[o.id] &&
    (activeGroup ? o.ff_group_id === activeGroup.id : !o.ff_group_id));
  // Onderweg naar het magazijn (user 2026-07-22): SOLO toont "Order placed"-items óók in
  // het pakket, grijs — zo ziet de klant het hele pakket vormen (net als Friends). Ze
  // tellen NIET mee in Confirm & ship (nog niet aangekomen). Groep = memberSections.
  const parcelComing = activeGroup ? [] : orders.filter((o) =>
    ["quote_accepted", "purchased", "bought", "shipped_local"].includes(o.status) &&
    !orderToParcel[o.id] && !o.ff_group_id);
  // SOLO: hold-out is verwijderd (user-keuze 2026-07-20) — alles zit ALTIJD in het pakket.
  // Alleen de GROEP-modus houdt nog apart-houden (onderdeel van de Ready-flow).
  const parcelItems = activeGroup ? parcelEligible.filter((o) => !parcelHeldOut.includes(o.id)) : parcelEligible;
  const parcelHeldItems = activeGroup ? parcelEligible.filter((o) => parcelHeldOut.includes(o.id)) : [];
  // Toestand van een item voor het pakket-chipje op de orderkaart (null = geen chip).
  // GROEP: "in de doos" is automatisch bij aankomst, maar de klant bevestigt met Ready
  // (na foto-inspectie) → extra states "ready" (bevestigd) en "confirm" (nog inspecteren).
  // SOLO: "in_solo" = puur info (in je pakket), niet klikbaar, geen hold-out.
  const parcelStateFor = (o) => {
    if (o.status !== "qc_pending") return null;
    if (orderToParcel[o.id]) return "locked";
    if (o.dispute_status === "pending" || o.dispute_status === "bucky_flagged" || o.return_status) return null;
    if (activeGroup ? o.ff_group_id !== activeGroup.id : o.ff_group_id) return null;   // andere modus
    if (activeGroup) {
      if (parcelHeldOut.includes(o.id)) return "out";
      return o.box_staged_at ? "ready" : "confirm";
    }
    return "in_solo";
  };
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
    const matchCat = activeCategory === "All" ? true : p.category === activeCategory;
    // Subcategorie werkt los van de hoofdcategorie: de winkel-filterknoppen (Tops,
    // Skirts, …) zetten alleen activeSub, ook als de hoofdcategorie op "All" staat.
    const matchSub = !activeSub || p.subcategory === activeSub;
    const q = search.trim().toLowerCase();
    const matchSearch = !q || (p.title || "").toLowerCase().includes(q);
    const matchFav = !showFavoritesOnly || isFavorite(p);
    return matchCat && matchSub && matchSearch && matchFav;
    // Demo's altijd achteraan; daarbinnen de handmatige winkelvolgorde uit de admin
    // (products.sort_order — mooiste producten bovenaan), id als terugval.
  }).sort((a, b) => (a.demo ? 1 : 0) - (b.demo ? 1 : 0)
    || (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9)
    || (a.id ?? 0) - (b.id ?? 0));

  // ── Fabriek-first feed ──────────────────────────────────────────────────
  // Hoort een product bij deze fabriek? Echte koppeling (factory_id), met
  // fallback op de leverancier-naam voor nog-niet-gekoppelde producten.
  const belongsToFactory = (p, f) => p.factory_id === f.id || (p.factory_id == null && (p.supplier || "") === f.name);
  // Fabriek-kaarten: alleen fabrieken met zichtbare producten, gesorteerd op
  // diamanten (4 = hoogste). De zoekbalk filtert hier op fabrieksnaam.
  // useMemo: dit is O(fabrieken × producten) en de feed re-rendert vaak (CountUp,
  // stem-polling, PTR) — zonder memo betaalt elke render deze rekensom mee, en dat
  // vertraagt precies het frame waarin de terug-morph moet vertrekken.
  const factoryCards = useMemo(() => factories
    // Feed toont fabrieken; Brands toont taobao-stores (zelfde tabel, store_type splitst).
    .filter(f => tab === "brands" ? f.store_type === "taobao" : (f.store_type || "factory") !== "taobao")
    // Dames/heren-keuze bovenaan Brands (Kaito 17-08): winkels dragen factories.gender.
    .filter(f => tab !== "brands" || !genderFilter || (f.gender || "women") === genderFilter)
    .map(f => {
      const fp = products.filter(p => belongsToFactory(p, f));
      // Kaart-plaatje: een geüploade fabrieksfoto wint, anders pakt de kaart
      // automatisch de foto van het eerste product van die fabriek.
      const cover = (f.logo && f.logo.startsWith("http"))
        ? f.logo
        : (fp.find(p => p.image && p.image.startsWith("http"))?.image || null);
      // Etalage = de top-3 populairste producten van de winkel (gastdata), zodat de
      // kaart in Brands hetzelfde toont als de eerste rij ín de winkel (Kaito 22-08).
      // De handmatig geüploade storefront_images blijven in de database als reserve,
      // maar worden niet meer getoond.
      const previews = fp.filter(p => p.image && p.image.startsWith("http"))
        .sort((a, b) => (productScores.get(b.id) || 0) - (productScores.get(a.id) || 0) || a.id - b.id)
        .slice(0, 3)
        .map(p => p.image);
      // Winkelscore (Kaito 21-08): som van de populariteit van de producten —
      // de winkel waar gasten het meest naar kijken/toevoegen staat bovenaan.
      const popScore = fp.reduce((s, p) => s + (productScores.get(p.id) || 0), 0);
      return { ...f, count: fp.length, cover, previews, popScore };
    })
    .filter(f => f.count > 0)
    .filter(f => { const q = search.trim().toLowerCase(); return !q || (f.name || "").toLowerCase().includes(q); })
    .sort((a, b) => (b.popScore || 0) - (a.popScore || 0) || (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || (Number(b.diamonds) || 0) - (Number(a.diamonds) || 0) || (a.name || "").localeCompare(b.name || "")), [factories, products, search, tab, genderFilter, productScores]);
  // ── Winkel-filters (16-08) ────────────────────────────────────────────────
  // Sommige winkels verkopen bereiken ("S-M", "M-L") in plaats van losse maten.
  // Die krijgen géén eigen knop maar tellen mee bij elke maat die ze dekken —
  // een S-M-kledingstuk past immers zowel een S- als een M-klant.
  const MAAT_VOLGORDE = ["XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL"];
  const splitsMaat = (o) => {
    const s = String(o || "").trim();
    const m = s.toUpperCase().match(/^(XS|S|M|L|XL|XXL|2XL|3XL)\s*[-–/]\s*(XS|S|M|L|XL|XXL|2XL|3XL)$/);
    if (!m) return [s];
    const a = MAAT_VOLGORDE.indexOf(m[1]), b = MAAT_VOLGORDE.indexOf(m[2]);
    return (a < 0 || b < 0) ? [s] : MAAT_VOLGORDE.slice(Math.min(a, b), Math.max(a, b) + 1);
  };
  // Welke maten biedt dit product, en is zo'n maat als geheel uitverkocht?
  // (Combinatie-uitval per kleur negeren we hier bewust — te zwaar voor de feed;
  //  de productpagina streept die zelf al door.)
  const productSizes = (p) => {
    const g = (Array.isArray(p.sizes) ? p.sizes : []).find(v => /size|maat/i.test(v?.name || ""));
    if (!g) return [];
    const oosLos = new Set((Array.isArray(p.oos_variants) ? p.oos_variants : [])
      .filter(o => o && !o.combo && /size|maat/i.test(o.name || "")).map(o => o.value));
    // Uitverkocht-check op de rúwe optiewaarde ("S-M"), pas daarna uitklappen.
    return [...new Set((g.options || []).filter(o => !oosLos.has(o)).flatMap(splitsMaat))];
  };
  // Alle producten van de geopende winkel (zonder categorie/maat-filter) — hieruit
  // komen de filterknoppen mét aantallen, zodat je ziet wat er te halen valt.
  const facAll = selectedFactory ? products.filter(p => belongsToFactory(p, selectedFactory)) : [];
  const facSizes = [...new Set(facAll.flatMap(productSizes))]
    .sort((a, b) => {
      const ia = MAAT_VOLGORDE.indexOf(String(a).toUpperCase()), ib = MAAT_VOLGORDE.indexOf(String(b).toUpperCase());
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || String(a).localeCompare(String(b));
    });
  const facSubs = [...new Set(facAll.map(p => p.subcategory).filter(Boolean))]
    .map(sub => ({ sub, n: facAll.filter(p => p.subcategory === sub).length }))
    .sort((a, b) => b.n - a.n);

  // Drill-in: producten van de geopende fabriek, met de gewone filters + maatfilter.
  const factoryProducts = selectedFactory
    ? visibleProducts.filter(p => belongsToFactory(p, selectedFactory)
        && (!sizeFilter || productSizes(p).includes(sizeFilter)))
        // Populairste eerst (gastdata: bekeken + 10× mandje); zonder data blijft
        // de oorspronkelijke volgorde staan (score 0 → stabiele sort op id).
        .sort((a, b) => (productScores.get(b.id) || 0) - (productScores.get(a.id) || 0) || a.id - b.id)
    : [];

  // Herbruikbare productkaart (zelfde stijl als voorheen) — voor drill-in + favorieten.
  const productCardEl = (p) => {
    const isDemo = !!p.demo;
    return (
    <motion.div key={p.id} layout layoutId={`card-${p.id}`} className={activeGroup && !isDemo ? "ff-glow" : ""}
      initial={{ opacity: 0, scale: 0.92, y: 14 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.16, ease: [0.32, 0.72, 0, 1] } }}
      onClick={() => isDemo ? setHypeProduct(p) : setSelectedProduct(p)}
      whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}
      transition={springMorph}
      style={{ background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)", cursor: "pointer" }}>
      <div style={{ position: "relative" }}>
        {/* 3:4 = exact het formaat waarin de foto's binnenkomen (studio levert 1080×1440,
            1688/Taobao ook 3:4). Zo wordt er niets meer bijgesneden en zie je het hele
            beeld zoals het gemaakt is. Stond op 4:5, wat er 6% van boven én onder afhaalde. */}
        <motion.div layoutId={`pimg-${p.id}`} data-pcard-img={p.id} transition={springMorph} style={{ background: "#fff", aspectRatio: "3 / 4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48, overflow: "hidden" }}>
          {p.image?.startsWith("http") ? (
            <>
              <img src={p.image} referrerPolicy="no-referrer" alt={p.title} decoding="async"
                onError={(e) => { e.currentTarget.style.display = "none"; const fb = e.currentTarget.nextSibling; if (fb) fb.style.display = "flex"; }}
                style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <span style={{ display: "none", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>📦</span>
            </>
          ) : p.image}
        </motion.div>
        {isDemo ? (
          <>
            <span style={{ position: "absolute", top: 10, right: 10, background: "#F5C518", color: "#4a3800", fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 8 }}>{tr("product.badge.comingSoon", "Coming soon")}</span>
            <span style={{ position: "absolute", top: 34, right: 11, color: "#fff", fontSize: 10, fontWeight: 700, letterSpacing: 0.2, textShadow: "0 1px 3px rgba(0,0,0,0.55)", pointerEvents: "none" }}>{tr("product.badge.tapToView", "tap to view")}</span>
            <span style={{ position: "absolute", top: 10, left: 10, background: "#FF5C00", color: "#fff", fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 8, boxShadow: "0 2px 8px rgba(17,17,17,0.18)", whiteSpace: "nowrap" }}>{tr("product.badge.vote", "Vote")}</span>
          </>
        ) : (
          <motion.div layoutId={`plus-${p.id}`} transition={{ duration: 0.34, ease: [0.32, 0.72, 0, 1] }}
            onClick={e => { e.stopPropagation(); setActionProduct(p); }}
            whileTap={{ scale: 0.82 }}
            style={{ position: "absolute", right: 10, bottom: 10, width: 36, height: 36, borderRadius: 18, background: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(255,92,0,0.4)", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
            <Plus size={19} color="#fff" strokeWidth={2.6} />
          </motion.div>
        )}
      </div>
      <div style={{ padding: "11px 13px 13px" }}>
        {/* Alleen het kledingtype — "Taobao", "MOQ 1" en de fee-disclaimer stonden op
            élke kaart en zijn jargon dat honderden keren herhaald werd (Kaito 13-08).
            De uitleg over fees hoort op één plek (?- en 💸-knop), niet overal. */}
        <div style={{ fontSize: 11.5, marginBottom: 3, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#FF5C00", fontWeight: 600, flexShrink: 0 }}>{garmentType(p.title)}</span>
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "#111111", marginBottom: 7, lineHeight: 1.35 }}>{p.title}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111111" }}>€{Number(p.price).toFixed(2)}</div>
            {isDemo && <div style={{ fontSize: 9.5, color: "#A8A5A0", marginTop: 1, lineHeight: 1.2 }}>{tr("product.priceCaption.demo", "factory price · not live yet")}</div>}
          </div>
          {!isDemo && Number(p.rating) > 0 && (
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#111111" }}>★ {Number(p.rating).toFixed(1)}</div>
          )}
        </div>
      </div>
    </motion.div>
    );
  };

  // Gedeelde fabrieks-collage (1 grote + 2 kleine foto's + diamant-badge + "+N more").
  // Gebruikt in ZOWEL de feed-kaart als de morph-ghost, zodat de morph exact dezelfde
  // 3 foto's toont en ze nooit uiteen kunnen lopen. De aanroeper levert de flex-container.
  const factoryCollage = (pv = [], extra = 0, dia = 0) => {
    // De grote foto krijgt [data-plx]: een scroll-listener geeft 'm een micro-parallax
    // (±10px meeschuiven, iets ingezoomd zodat er geen randen ontstaan).
    const imgBox = (src, big) => (
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, background: "#ECE8E0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: big ? 44 : 26, overflow: "hidden" }}>
        {src ? <img src={src} referrerPolicy="no-referrer" alt="" decoding="async" data-plx={big ? "0.05" : "0.035"} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 12%", display: "block", transform: coarsePointer ? "none" : "scale(1.12)", willChange: coarsePointer ? "auto" : "transform" }} /> : "🏭"}
      </div>
    );
    return (
      <>
        {imgBox(pv[0], true)}
        {pv.length >= 2 && (
          <div style={{ flex: 0.62, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            {imgBox(pv[1])}
            {pv.length >= 3 && (
              <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex" }}>
                {imgBox(pv[2])}
                {extra > 0 && (
                  <div style={{ position: "absolute", right: 6, bottom: 6, background: "rgba(17,17,17,0.74)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 12 }}>{tr("feed.factoryCard.moreImages", "+{count} more", { count: extra })}</div>
                )}
              </div>
            )}
          </div>
        )}
        {dia >= 1 && (
          <div style={{ position: "absolute", top: 11, left: 11, background: "rgba(17,17,17,0.82)", borderRadius: 20, padding: "3px 9px", fontSize: 12, fontWeight: 700, letterSpacing: 1, overflow: "hidden" }}>
            <span style={{ position: "relative", display: "inline-block" }}>
              {"💎".repeat(dia)}
              {/* glans-sweep over de diamanten — vuurt pas als de kaart IN BEELD scrollt */}
              <motion.span initial={{ x: "-130%" }} whileInView={{ x: "330%" }} viewport={{ once: true, amount: 0.9 }}
                transition={{ duration: 1.0, delay: 0.5, ease: "easeInOut" }}
                style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "45%", background: "linear-gradient(105deg, transparent, rgba(255,255,255,0.55), transparent)", pointerEvents: "none" }} />
            </span>
          </div>
        )}
      </>
    );
  };

  // Fabriek-kaart = volledige telefoon-breedte, één per rij (verticaal scrollen).
  // Etalage-collage: 1 grote + 2 kleine product-foto's → je ziet meteen wat de fabriek maakt.
  const factoryCardEl = (f) => {
    const isTaobao = f.store_type === "taobao";
    // Taobao-stores hebben geen 1688-diamant-rang → geen 💎-badge op de collage.
    const dia = isTaobao ? 0 : Math.max(0, Math.min(4, Number(f.diamonds) || 0));
    const stats = (isTaobao ? [
      // Reviews samengevoegd met de rating (user 2026-08-13): het aantal reviews staat
      // nu rechtsboven ín de rating-tegel — twee losse cijfers vertelden hetzelfde verhaal.
      { label: tr("feed.brandCard.stat.rating", "Store rating"), v: f.tb_rating,
        extra: f.tb_reviews ? `${f.tb_reviews} ${tr("feed.brandCard.stat.reviewsWord", "reviews")}` : null },
      { label: tr("feed.brandCard.stat.followers", "Followers"), v: f.tb_followers },
      // Service score eruit (user 2026-07-26): zei bijna hetzelfde als Store rating,
      // en met 5 tegels bleef er een weesje onderaan het 2-koloms raster liggen.
      { label: tr("feed.brandCard.stat.shipSpeed", "Domestic shipping speed"), v: f.tb_ship_speed },
    ] : [
      { label: tr("feed.factoryCard.stat.repurchase", "Repurchase rate"), v: f.repurchase },
      { label: tr("feed.factoryCard.stat.service", "Service score"), v: f.service },
      { label: tr("feed.factoryCard.stat.ontime", "On-time delivery"), v: f.ontime },
      { label: tr("feed.factoryCard.stat.reviews", "Positive reviews"), v: f.reviews },
    ]).filter(s => s.v);
    const pv = (f.previews && f.previews.length) ? f.previews : (f.cover ? [f.cover] : []);
    const extra = Math.max(0, (f.count || 0) - 3);
    // Is dit de kaart waar de morph NU naartoe terugkeert? Zo ja: geen entree-animatie,
    // zodat de kaart meteen op z'n eind-rect staat (correcte meting + geen na-schok).
    const isMorphTarget = !!morph && morph.target === "card" && String(morph.id) === String(f.id);
    return (
      <motion.div key={f.id} layout={!isMorphTarget} data-factory-id={f.id} className={activeGroup ? "ff-glow" : ""}
        initial={isMorphTarget ? false : { opacity: 0, scale: 0.96, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.16, ease: [0.32, 0.72, 0, 1] } }}
        onClick={(e) => { const card = e.currentTarget; const ia = card.querySelector('[data-factory-img]'); const r = (ia || card).getBoundingClientRect(); feedScrollRef.current = window.scrollY; setMorph({ from: { left: r.left, top: r.top, width: r.width, height: r.height }, target: "pill", id: f.id, previews: pv, extra, dia }); track("store", f.id); setSelectedFactory(f); setSearch(""); setActiveCategory("All"); setActiveSub(null); setSizeFilter(null); window.scrollTo(0, 0); }}
        whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }}
        transition={springMorph}
        style={{ background: "#fff", borderRadius: 20, overflow: "hidden", boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 8px 22px rgba(17,17,17,0.06)", cursor: "pointer" }}>
        <div data-factory-img={f.id} style={{ position: "relative", display: "flex", gap: 2, aspectRatio: "5 / 4", overflow: "hidden" }}>
          {factoryCollage(pv, extra, dia)}
        </div>
        <div style={{ padding: "13px 15px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            {/* Brands (user 2026-08-12): Taobao-shopavatar als rondje naast de naam —
                Instagram-patroon "rondje + naam = echte winkel". Fabrieken ongewijzigd. */}
            <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
              {isTaobao && f.profile_image && (
                <img src={f.profile_image} referrerPolicy="no-referrer" alt="" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", border: "1px solid #ECEAE5", flexShrink: 0 }} />
              )}
              <div style={{ fontSize: 15.5, fontWeight: 700, color: "#111111", lineHeight: 1.3 }}>
                {f.name}
                {/* Verborgen winkel: alleen jij ziet 'm. Duidelijk labelen, anders vergeet
                    je dat klanten deze winkel helemaal niet zien (2026-08-16). */}
                {f.hidden && (
                  <span style={{ display: "inline-block", marginLeft: 7, verticalAlign: "middle", background: "#FEF3C7", color: "#92400E", border: "1px solid #FCD9B6", borderRadius: 7, padding: "2px 7px", fontSize: 10, fontWeight: 800, whiteSpace: "nowrap" }}>
                    🙈 {tr("feed.hiddenStore", "Only you can see this")}
                  </span>
                )}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#A8A5A0", whiteSpace: "nowrap", flexShrink: 0 }}>{tr("feed.factoryCard.productCount", "{count} product{s} ›", { count: f.count, s: f.count === 1 ? "" : "s" })}</div>
          </div>
          {stats.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 11 }}>
              {stats.map(s => (
                <div key={s.label} style={{ background: "#F6F4EF", borderRadius: 10, padding: "7px 10px" }}>
                  {/* s.extra (aantal reviews) staat rechtsboven naast het cijfer. */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 5 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#FF5C00", lineHeight: 1.1 }}>{s.v}</span>
                    {s.extra && <span style={{ fontSize: 9.5, fontWeight: 600, color: "#A8A5A0", lineHeight: 1.1, whiteSpace: "nowrap" }}>{s.extra}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: "#8A8780", lineHeight: 1.25, marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    );
  };

  // Terug-pill ("All brands"/"All factories") — één definitie, twee plekken (user 2026-08-12):
  // normaal onder de kop; op een merkpagina MÉT logo in de kopregel naast de drie knopjes.
  // Er rendert altijd precies één pill (condities sluiten elkaar uit), dus pillRef + de
  // morph-meting (useLayoutEffect ná render) blijven gewoon kloppen.
  const backPillEl = (inHeader) => (
    <motion.div
      ref={pillRef}
      whileTap={{ scale: 0.96 }}
      onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const sf = selectedFactory; const spv = (sf.previews && sf.previews.length) ? sf.previews : (sf.cover ? [sf.cover] : []); setMorph({ from: { left: r.left, top: r.top, width: r.width, height: r.height }, target: "card", id: sf.id, previews: spv, extra: Math.max(0, (sf.count || 0) - 3), dia: Math.max(0, Math.min(4, Number(sf.diamonds) || 0)) }); setSelectedFactory(null); setSearch(""); setActiveCategory("All"); setActiveSub(null); setSizeFilter(null); }}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, marginBottom: inHeader ? 0 : 16, marginTop: inHeader ? 2 : 0, cursor: "pointer", color: "#111", fontSize: 14, fontWeight: 700, background: "#fff", border: "1px solid #E4E1DA", borderRadius: 22, padding: "9px 16px 9px 12px", boxShadow: "0 1px 2px rgba(17,17,17,0.05), 0 4px 12px rgba(17,17,17,0.05)", WebkitTapHighlightColor: "transparent", whiteSpace: "nowrap" }}>
      <span style={{ fontSize: 19, lineHeight: 1, marginTop: -2 }}>‹</span> {tab === "brands" ? tr("feed.backToBrands", "All brands") : tr("feed.backToFactories", "All factories")}
    </motion.div>
  );

  return (
    <div style={{ fontFamily: "'Inter', 'Helvetica Neue', sans-serif", background: "#F8F7F4", minHeight: "100vh", maxWidth: 430, margin: "0 auto", width: "100%", position: "relative" }}>

      <GroupModeGlow key={activeGroup?.id || "none"} active={activeGroupShopping} dimmed={!!(selectedProduct || showRequestList || showFriends || showNotifs || showVable)} />

      {/* 🦊 Pull-to-refresh indicator: pootafdrukken lichten op met de trek-afstand; bij
          verversen huppelt de vos. In-flow → duwt de feed zachtjes mee omlaag. */}
      {/* Zwevende overlay (géén layout-push: de feed en de 'All factories'-pill blijven
          gewoon staan terwijl je trekt — dat verspringen was de bug). */}
      {(pull > 0 || ptrBusy) && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 90, display: "flex", justifyContent: "center", gap: 14, paddingTop: Math.min(30, 8 + pull * 0.2), pointerEvents: "none", opacity: ptrBusy ? 1 : Math.min(1, pull / 45) }}>
          {[0.3, 0.55, 0.85].map((t, i) => (
            <motion.span key={i}
              animate={ptrBusy ? { y: [0, -7, 0] } : { y: 0 }}
              transition={ptrBusy ? { duration: 0.55, repeat: Infinity, ease: "easeInOut", delay: i * 0.14 } : { duration: 0.1 }}
              style={{ fontSize: 15, display: "inline-block", opacity: ptrBusy || pull / 110 >= t ? 1 : 0.2, transition: "opacity .15s", transform: `rotate(${i % 2 ? 14 : -10}deg)` }}>🐾</motion.span>
          ))}
        </div>
      )}
      {/* Shape-morph ghost: scroll-onafhankelijke doos met de FABRIEKSFOTO die kaart ↔ pill
          verbindt. De 'All factories'-pill ligt als overlay erbovenop en faadt pas op het eind
          in (heen) / meteen uit (terug), zodat de foto de hele morph zichtbaar blijft. */}
      {morph && (
        <div ref={ghostRef} aria-hidden style={{
          position: "fixed",
          left: morph.from.left, top: morph.from.top, width: morph.from.width, height: morph.from.height,
          background: "#ECE8E0", boxSizing: "border-box",
          // Rand + schaduw per richting laten kloppen met het DOEL, anders 'popt' dat bij de
          // overdracht: de pill heeft een rand + lichte schaduw; het fotogebied van de kaart
          // heeft géén eigen rand/schaduw (de kaart zelf draagt die al). box-sizing border-box
          // zodat de gemeten (border-box) maat exact klopt, ook mét rand.
          border: morph.target === "pill" ? "1px solid #E4E1DA" : "none",
          boxShadow: morph.target === "pill" ? "0 1px 2px rgba(17,17,17,0.05), 0 4px 12px rgba(17,17,17,0.05)" : "none",
          borderRadius: morph.target === "pill" ? "20px 20px 0px 0px" : "22px",
          overflow: "hidden", zIndex: 60, pointerEvents: "none",
          display: "flex", gap: 2,
          willChange: "left, top, width, height", contain: "layout paint",
        }}>
          {factoryCollage(morph.previews || [], morph.extra || 0, morph.dia || 0)}
          <div ref={overlayRef} style={{
            position: "absolute", inset: 0, boxSizing: "border-box", background: "#fff",
            display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 4,
            padding: "9px 16px 9px 12px",
            color: "#111", fontSize: 14, fontWeight: 700, whiteSpace: "nowrap",
            opacity: morph.target === "pill" ? 0 : 1,
          }}>
            {/* Label meebewegen met de tab — stond hardcoded op "All factories", waardoor
                de Brands-morph heel even de verkeerde tekst flitste (user 2026-08-12). */}
            <span style={{ fontSize: 19, lineHeight: 1, marginTop: -2 }}>‹</span> {tab === "brands" ? tr("feed.backToBrands", "All brands") : tr("feed.backToFactories", "All factories")}
          </div>
        </div>
      )}
      {/* Oranje 'einde van de lijst'-gloed: gloeit onderaan op naarmate je de bottom-pull
          verder rekt. Fixed sibling (beweegt niet mee met de wrapper-transform), onder de nav. */}
      <div ref={bottomGlowRef} aria-hidden style={{ position: "fixed", left: 0, right: 0, bottom: 0, margin: "0 auto", width: "100%", maxWidth: 430, height: 130, zIndex: 92, pointerEvents: "none", opacity: 0, background: "linear-gradient(to top, rgba(255,92,0,0.32), rgba(255,92,0,0.13) 42%, rgba(255,92,0,0) 80%)" }} />
      {/* Content-wrapper voor de elastische bottom-pull: bevat alléén scrollende content
          (header + tabs). Nav, cart-balk, sheets, toasts en de gloed zijn siblings hierbuiten,
          dus die bewegen niet mee als de wrapper omhoog rekt. */}
      <div ref={stretchRef}>
      {/* Header */}
      <div style={{ padding: "16px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#111111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, boxShadow: activeGroup ? "0 0 0 2px rgba(255,92,0,0.6)" : "none", transition: "box-shadow .3s", flexShrink: 0 }}><Fox /></div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2.5, color: "#111111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>FLOWVA{activeGroup && <span style={{ color: "#FF5C00" }}> {tr("feed.header.friendsSuffix", "FRIENDS")}</span>}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ background: "#EFEDE8", borderRadius: 20, padding: "7px 13px", display: "flex", gap: 6, alignItems: "baseline" }}>
            <span style={{ fontSize: 11, color: "#8A8780" }}>{tr("feed.header.balanceLabel", "Balance")}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#111111" }}>€{parseFloat(balance).toFixed(2)}</span>
          </div>
          <div style={{ position: "relative" }}>
            <motion.div whileTap={{ scale: 0.88 }} transition={springSnappy} onClick={() => setShowNotifs(!showNotifs)}
              style={{ width: 38, height: 38, borderRadius: "50%", background: showNotifs ? "#111111" : "#fff", border: "1px solid #ECEAE5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
              <Bell size={17} color={showNotifs ? "#fff" : "#111111"} strokeWidth={2} />
            </motion.div>
            {(notifications.length > 0 || warehouseCount > 0 || unreadSupport > 0) && !showNotifs && (
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springBouncy}
                style={{ position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, padding: "0 3px", borderRadius: 9, background: "#FF5C00", border: "2px solid #F8F7F4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", boxSizing: "content-box" }}>
                {notifications.length + warehouseCount + unreadSupport}
              </motion.div>
            )}
            <AnimatePresence>
              {showNotifs && (
                <motion.div initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.96 }}
                  transition={springSnappy}
                  style={{ position: "absolute", top: 46, right: 0, width: 280, background: "#fff", borderRadius: 16, boxShadow: "0 12px 40px rgba(17,17,17,0.18)", zIndex: 150, overflow: "hidden", transformOrigin: "top right", border: "1px solid #ECEAE5" }}>
                  <div style={{ padding: "12px 14px 10px", fontSize: 13, fontWeight: 700, color: "#111111", borderBottom: "1px solid #F0EEE8" }}>{tr("feed.notifs.title", "Notifications")}</div>
                  {/* Flowva support: VASTE regel (user 2026-07-22) — ook bij 0 berichten.
                      Opent de inbox; ongelezen = oranje teller. */}
                  <div onClick={openSupport}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: "1px solid #F0EEE8", cursor: "pointer" }}>
                    <span style={{ fontSize: 17 }}>💬</span>
                    <span style={{ fontSize: 12.5, color: "#333", lineHeight: 1.4, flex: 1 }}>
                      {tr("orders.notif.supportRow", "Flowva support · {count} message{s}", { count: supportMsgs.length, s: supportMsgs.length === 1 ? "" : "s" })}
                    </span>
                    {unreadSupport > 0 && (
                      <span style={{ background: "#FF5C00", color: "#fff", fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 999 }}>{unreadSupport}</span>
                    )}
                    <span style={{ color: "#ccc", fontSize: 14 }}>→</span>
                  </div>
                  {warehouseCount > 0 && (
                    <div onClick={() => { setShowNotifs(false); setTab("orders"); /* magazijn = onderdeel van Orders sinds de merge */ }}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: "1px solid #F0EEE8", cursor: "pointer" }}>
                      <span style={{ fontSize: 17 }}>🏭</span>
                      <span style={{ fontSize: 12.5, color: "#333", lineHeight: 1.4, flex: 1 }}>{tr("feed.notifs.warehouseRow", "{count} product{s} in your warehouse", { count: warehouseCount, s: warehouseCount > 1 ? "s" : "" })}</span>
                      <span style={{ color: "#ccc", fontSize: 14 }}>→</span>
                    </div>
                  )}
                  {notifications.map((n, i) => (
                    // Refund-melding (dismissId): tikken = gelezen/wegtikken (er is geen order
                    // meer om te openen — die is geannuleerd + terugbetaald). Anders: navigeren.
                    <div key={n.dismissId || i} onClick={() => { if (n.support) { openSupport(); return; } if (n.transit) { dismissRefundNotice(n.dismissId); setShowNotifs(false); setTab("transit"); return; } if (n.dismissId) { dismissRefundNotice(n.dismissId); return; } setShowNotifs(false); if (n.cart) { setShowRequestList(true); } else { setTab("orders"); setSelectedOrder(n.order); } }}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: i < notifications.length - 1 ? "1px solid #F0EEE8" : "none", cursor: "pointer" }}>
                      <span style={{ fontSize: 17 }}>{n.icon}</span>
                      <span style={{ fontSize: 12.5, color: "#333", lineHeight: 1.4, flex: 1 }}>{n.text}</span>
                      <span style={{ color: "#ccc", fontSize: 14 }}>{n.dismissId && !n.transit ? "✕" : "→"}</span>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Warehouse-banner verwijderd — de warehouse-melding leeft nu in het belletje + het Warehouse-nav-badge. */}

      {/* 💬 FLOWVA SUPPORT — inbox met admin-berichten (vaste templates, 8 talen).
          Geopend vanuit het belletje ("Flowva support left a message"); openen = gelezen. */}
      <AnimatePresence>
        {showSupport && (
          <>
            <motion.div key="support-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeSupport}
              style={{ position: "fixed", inset: 0, zIndex: 380, background: "rgba(17,17,17,0.5)", backdropFilter: "blur(6px)" }} />
            <motion.div key="support-sheet" initial={{ y: "104%" }} animate={{ y: 0 }} exit={{ y: "104%" }} transition={springMorph}
              style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 430, background: "#FAF9F6", borderRadius: "24px 24px 0 0", zIndex: 381, maxHeight: "78vh", overflowY: "auto", overscrollBehavior: "contain", padding: "14px 18px calc(22px + env(safe-area-inset-bottom))" }}>
              <div style={{ width: 38, height: 4.5, borderRadius: 999, background: "#E3E1DB", margin: "0 auto 14px" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#111111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}><Fox /></div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#111111" }}>{tr("support.title", "Flowva support")}</div>
              </div>
              {supportMsgs.length === 0 && (
                <div style={{ textAlign: "center", padding: "26px 0", fontSize: 13, color: "#A8A5A0" }}>{tr("support.empty", "No messages yet")}</div>
              )}
              {supportMsgs.map((m) => (
                <div key={m.id} style={{ position: "relative", background: "#fff", border: "1px solid #ECEAE5", borderRadius: 14, padding: "13px 15px", marginBottom: 10 }}>
                  {/* "New message"-badge: alleen bij de eerste keer lezen (user 2026-07-22). */}
                  {freshSupportIds.includes(m.id) && (
                    <span style={{ position: "absolute", top: 11, right: 12, background: "#FF5C00", color: "#fff", fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, padding: "3px 9px", borderRadius: 999 }}>{tr("support.newBadge", "New message")}</span>
                  )}
                  {/* Kop: product + exacte verzenddatum & -tijd (user 2026-07-22). Berichten
                      blijven altijd terug te lezen — er verdwijnt hier nooit iets. */}
                  {m.product_title && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#111111", marginBottom: 2, paddingRight: 96 }}>{m.product_title}</div>}
                  <div style={{ fontSize: 11, color: "#A8A5A0", marginBottom: 6 }}>
                    {(() => { try { return new Date(m.created_at).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } })()}
                  </div>
                  <div style={{ fontSize: 13.5, color: "#111111", lineHeight: 1.55 }}>{supportText(m)}</div>
                  {/* Modus-context (user 2026-07-22): waar is het item besteld + waar kijk je. */}
                  <div style={{ marginTop: 8, fontSize: 11.5, color: "#8A8780", lineHeight: 1.5, borderTop: "1px solid #F0EEE8", paddingTop: 8 }}>
                    {m.group_name
                      ? tr("support.ctx.group", "Item ordered in Flowva Friends group: {group} — switch to Flowva Friends to see the status of this item.", { group: m.group_name })
                      : tr("support.ctx.solo", "Item ordered in Flowva solo — switch to solo shopping to see the status of this item.")}
                  </div>
                </div>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Tab-inhoud met vloeiende overgangen */}
      <AnimatePresence mode="wait" initial={false}>

      {/* FEED TAB */}
      {(tab === "feed" || tab === "brands") && (
        /* FEED + BRANDS delen exact dezelfde machinerie: tab "brands" toont taobao-stores
           (store_type='taobao') i.p.v. fabrieken — zelfde kaarten, morph, drill-in en cart. */
        <motion.div key={tab} {...pageTransition} style={{ padding: "10px 20px 80px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            {/* Merkpagina (user 2026-08-12): heeft de store een brand_logo → dan staat op de
                titelplek de "All brands"-pill (zelfde hoogte als de drie knopjes) en komt het
                logo als volle-breedte header eronder. Zonder logo: gewoon de naam. */}
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6, color: "#111111", marginBottom: 2, minWidth: 0 }}>{showFavoritesOnly ? tr("feed.title.favorites", "Favorites") : selectedFactory ? (tab === "brands" && selectedFactory.brand_logo ? backPillEl(true) : selectedFactory.name) : tab === "brands" ? <>{tr("feed.title.brandFeed.word1", "Brand")} <span style={{ color: "#FF5C00" }}>{tr("feed.title.brandFeed.word2", "Feed")}</span></> : <>{tr("feed.title.factoryFeed.word1", "Factory")} <span style={{ color: "#FF5C00" }}>{tr("feed.title.factoryFeed.word2", "Feed")}</span></>}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {/* 💸 opent ALTIJD de vos-tour; de volledige tekst-sheet komt pas via
                  "See the full breakdown" in de tour (geen boogvlucht meer nodig). */}
              <motion.button data-money-btn whileTap={{ scaleX: 1.15, scaleY: 0.85 }} transition={springSnappy} onClick={() => setShowPricingTour(true)} aria-label={tr("feed.aria.pricingButton", "How pricing works")}
                style={{ width: 42, height: 42, borderRadius: "50%", background: "#fff", border: "1px solid #ECEAE5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18, lineHeight: 1, WebkitTapHighlightColor: "transparent" }}>
                {/* het emoji "vertrekt" tijdens de boogvlucht (de knop-cirkel blijft) */}
                <span style={{ display: "inline-block", opacity: arcFlight?.kind === "pricing" ? 0 : 1, transition: "opacity .15s" }}>💸</span>
              </motion.button>
              {/* ? = de volledige uitleg-tour. Die start sinds 13-08 niet meer vanzelf
                  (het welkomstscherm doet de eerste indruk) maar is hier altijd bereikbaar. */}
              <motion.button whileTap={{ scaleX: 1.15, scaleY: 0.85 }} transition={springSnappy} onClick={() => setShowHowItWorks(true)} aria-label={tr("feed.aria.howButton", "How Flowva works")}
                style={{ width: 42, height: 42, borderRadius: "50%", background: "#fff", border: "1px solid #ECEAE5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18, fontWeight: 800, color: "#0F0E0C", lineHeight: 1, WebkitTapHighlightColor: "transparent" }}>
                ?
              </motion.button>
              {/* Diamant-rang is een 1688-fabriek-ding — niet tonen op de Brands-tab */}
              {tab !== "brands" && (
              <motion.button data-diamond-btn whileTap={{ scaleX: 1.15, scaleY: 0.85 }} transition={springSnappy} onClick={() => openSheetWithArc("diamond")} aria-label={tr("feed.aria.diamondButton", "How diamond rankings work")}
                style={{ width: 42, height: 42, borderRadius: "50%", background: "#fff", border: "1px solid #ECEAE5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 18, lineHeight: 1, WebkitTapHighlightColor: "transparent" }}>
                <span style={{ display: "inline-block", opacity: arcFlight?.kind === "diamond" ? 0 : 1, transition: "opacity .15s" }}>💎</span>
              </motion.button>
              )}
              <motion.button whileTap={{ scaleX: 1.15, scaleY: 0.85 }} transition={springSnappy} onClick={() => setShowFavoritesOnly((v) => !v)} aria-label={tr("feed.aria.favoritesButton", "favorites")}
                style={{ width: 42, height: 42, borderRadius: "50%", background: showFavoritesOnly ? "#FF5C00" : "#fff", border: "1px solid #ECEAE5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Star size={19} color={showFavoritesOnly ? "#fff" : "#111111"} fill={showFavoritesOnly ? "#fff" : "none"} strokeWidth={2} />
              </motion.button>
              {VABLE_AAN && (
                <motion.button whileTap={{ scale: 0.85 }} transition={springSnappy} onClick={() => setShowVable(true)} aria-label={tr("feed.aria.vableButton", "VABLE — our brand")}
                  style={{ width: 42, height: 42, borderRadius: "50%", background: "#111111", border: "1px solid #111111", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                  <img src="/vable-phoenix.svg" alt="VABLE" style={{ width: 26, height: 26, filter: "brightness(0) invert(1)" }} />
                </motion.button>
              )}
            </div>
          </div>
          {/* Merkpagina mét logo: subtitel weg — het logo IS de header (user 2026-08-12). */}
          {!(selectedFactory && !showFavoritesOnly && tab === "brands" && selectedFactory.brand_logo) && (
            <div style={{ fontSize: 13.5, color: "#8A8780", marginBottom: 16 }}>{showFavoritesOnly ? tr("feed.subtitle.favorites", "Your starred products.") : selectedFactory ? (tab === "brands" ? tr("feed.subtitle.brand", "Curated products from this store.") : tr("feed.subtitle.factory", "Curated products from this factory.")) : tab === "brands" ? tr("feed.subtitle.brandsDefault", "Tap a store to explore its products.") : tr("feed.subtitle.default", "Tap a factory to explore its products.")}</div>
          )}

          {/* Volle-breedte merk-header (user 2026-08-12): banner met ronde hoeken zoals de
              productkaarten. Het logo blijft ONAANGETAST scherp in het midden (contain);
              de volle breedte wordt gevuld door dezelfde afbeelding er sterk vervaagd
              achter te leggen — bij marmer/beige zie je doorlopend marmer, bij een wit
              logo een strakke witte kaart. Werkt automatisch voor elk merk, elk formaat. */}
          {selectedFactory && !showFavoritesOnly && tab === "brands" && selectedFactory.brand_logo && (
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
              style={{ position: "relative", width: "100%", height: 120, borderRadius: 18, overflow: "hidden", margin: "2px 0 12px", boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 8px 22px rgba(17,17,17,0.06)", transform: "translateZ(0)" }}>
              <img src={selectedFactory.brand_logo} referrerPolicy="no-referrer" alt="" aria-hidden
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "blur(26px) saturate(1.05)", transform: "scale(1.3)" }} />
              <img src={selectedFactory.brand_logo} referrerPolicy="no-referrer" alt={selectedFactory.name}
                style={{ position: "relative", display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
            </motion.div>
          )}

          {/* Terug-knop bij drill-in — duidelijke pill. Op een merkpagina mét logo staat 'ie
              al bovenin de kopregel (backPillEl(true)), dus hier alleen zónder logo. */}
          {selectedFactory && !showFavoritesOnly && !(tab === "brands" && selectedFactory.brand_logo) && backPillEl(false)}
          {/* === BODY: smooth fade+slide bij wisselen feed ↔ fabriek ↔ favorieten === */}
          {/* Bij een TERUG-morph géén y:22-entree: framer zet die translateY al bij de render
              als inline style, dus de morph zou de doelkaart 22px te laag meten en dáár landen
              (de foto hing dan even over de titelrij). Zelfde principe als isMorphTarget. */}
          <motion.div
            key={showFavoritesOnly ? "favs" : selectedFactory ? `fac-${selectedFactory.id}` : "factory-list"}
            initial={morph && morph.target === "card" ? false : { opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.34, ease: [0.22, 0.61, 0.36, 1] }}>
          {showFavoritesOnly ? (
            <>
              {!loadingProducts && !productsError && visibleProducts.length === 0 && (
                <div style={{ textAlign: "center", padding: 40, color: "#999", lineHeight: 1.5 }}>{tr("feed.empty.favorites", "No favorites yet — tap the ☆ on any product to save it here.")}</div>
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
              {/* Winkel-filters (16-08): categorieknoppen mét aantallen + maatknoppen.
                  Alleen categorieën die déze winkel echt heeft; lege knoppen bestaan niet. */}
              {facSubs.length > 1 && (
                <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 4, marginBottom: 8, WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
                  {[{ sub: null, n: facAll.length }, ...facSubs].map(({ sub, n }) => {
                    const sel = activeSub === sub;
                    const label = sub === null ? tr("feed.sub.all", "All")
                      : sub === "Tops" ? tr("feed.sub.tops", "Tops")
                      : sub === "Trousers" ? tr("feed.sub.trousers", "Trousers")
                      : sub === "Dresses" ? tr("feed.sub.dresses", "Dresses")
                      : sub === "Skirts" ? tr("feed.sub.skirts", "Skirts")
                      : sub === "Outerwear" ? tr("feed.sub.outerwear", "Outerwear")
                      : sub === "Shorts" ? tr("feed.sub.shorts", "Shorts")
                      : sub === "Sets" ? tr("feed.sub.sets", "Sets") : sub;
                    return (
                      <motion.button key={sub || "all"} whileTap={{ scale: 0.93 }} transition={springSnappy}
                        onClick={() => setActiveSub(sub)}
                        style={{ flexShrink: 0, padding: "7px 13px", borderRadius: 999, border: "1px solid " + (sel ? "#0F0E0C" : "#E8E6E0"), background: sel ? "#0F0E0C" : "#fff", color: sel ? "#fff" : "#555", fontSize: 12.5, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                        {label} <span style={{ opacity: 0.55, fontWeight: 500 }}>{n}</span>
                      </motion.button>
                    );
                  })}
                </div>
              )}
              {facSizes.length > 1 && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", overflowX: "auto", paddingBottom: 4, marginBottom: 12, WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
                  <span style={{ flexShrink: 0, fontSize: 11.5, color: "#A8A5A0", fontWeight: 600 }}>{tr("feed.sizeLabel", "Size")}</span>
                  {facSizes.map((m) => {
                    const sel = sizeFilter === m;
                    return (
                      <motion.button key={m} whileTap={{ scale: 0.9 }} transition={springSnappy}
                        onClick={() => setSizeFilter(sel ? null : m)}
                        style={{ flexShrink: 0, minWidth: 34, padding: "6px 9px", borderRadius: 10, border: "1px solid " + (sel ? "#FF5C00" : "#E8E6E0"), background: sel ? "#FF5C00" : "#fff", color: sel ? "#fff" : "#555", fontSize: 12, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                        {m}
                      </motion.button>
                    );
                  })}
                </div>
              )}
              {factoryProducts.length === 0 && (
                <div style={{ textAlign: "center", padding: 40, color: "#999" }}>{tr("feed.empty.factoryProducts", "No products in this view.")}</div>
              )}
              {factoryProducts.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <AnimatePresence mode="popLayout" initial={false}>
                    {factoryProducts.map(productCardEl)}
                  </AnimatePresence>
                </div>
              )}
            </>
          ) : tab !== "brands" && factories.length === 0 ? (
            <>
              {/* Terugval: nog geen fabrieken (SQL nog niet gedraaid) → klassieke feed */}
              {loadingProducts && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>{tr("feed.loading.products", "Loading products...")}</div>}
              {productsError && <div style={{ textAlign: "center", padding: 40, color: "#B45309" }}>{tr("feed.error.products", "Couldn't load products: {error}", { error: productsError })}</div>}
              {!loadingProducts && !productsError && products.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>{tr("feed.empty.noProducts", "No products found")}</div>}
              {!loadingProducts && !productsError && products.length > 0 && visibleProducts.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>{tr("feed.empty.noResults", "No results found")}</div>}
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
              {/* Dames/heren-keuze (17-08) — alleen op Brands, en alleen als beide bestaan. */}
              {tab === "brands" && !loadingProducts && (() => {
                const genders = new Set(factories.filter(f => f.store_type === "taobao").map(f => f.gender || "women"));
                if (genders.size < 2) return null;
                return (
                  <div style={{ display: "flex", gap: 7, marginBottom: 14 }}>
                    {[
                      { key: null, label: tr("feed.gender.all", "All") },
                      { key: "women", label: tr("feed.gender.women", "Women") },
                      { key: "men", label: tr("feed.gender.men", "Men") },
                    ].map(({ key, label }) => {
                      const sel = genderFilter === key;
                      return (
                        <motion.button key={key ?? "all"} whileTap={{ scale: 0.93 }} transition={springSnappy}
                          onClick={() => setGenderFilter(key)}
                          style={{ padding: "8px 16px", borderRadius: 999, border: "1px solid " + (sel ? "#0F0E0C" : "#E8E6E0"), background: sel ? "#0F0E0C" : "#fff", color: sel ? "#fff" : "#555", fontSize: 13, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                          {label}
                        </motion.button>
                      );
                    })}
                  </div>
                );
              })()}
              {loadingProducts && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>{tab === "brands" ? tr("feed.loading.brands", "Loading brands...") : tr("feed.loading.factories", "Loading factories...")}</div>}
              {productsError && <div style={{ textAlign: "center", padding: 40, color: "#B45309" }}>{tr("feed.error.factories", "Couldn't load: {error}", { error: productsError })}</div>}
              {!loadingProducts && !productsError && factoryCards.length === 0 && (
                <div style={{ textAlign: "center", padding: 40, color: "#999", lineHeight: 1.5 }}>{search ? (tab === "brands" ? tr("feed.empty.brandsSearch", "No brands match your search.") : tr("feed.empty.factoriesSearch", "No factories match your search.")) : tab === "brands" ? tr("feed.empty.brands", "No brands yet — check back soon.") : tr("feed.empty.factories", "No factories yet — check back soon.")}</div>
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
              return (
                <AnimatePresence initial={false}>
                  {Object.values(grouped)
                    .filter(items => items.some(matchesFilter))         // groep tonen als één item bij het filter past
                    .sort((a, b) => (a[0].id < b[0].id ? 1 : -1))       // nieuwste bovenaan
                    .map(items => (
                      <OrderGroupCard key={items[0].request_group_id || items[0].id} items={items}
                        groupSize={items[0]?.ff_group_id ? (myGroups.find((g) => g.group_id === items[0].ff_group_id)?.member_count || null) : null}
                        onOpenItem={(o) => { setSelectedOrder(o); setConfirmCancel(false); }} onDismiss={dismissOrders} parcel={parcelInfoFor(items)}
                        parcelStateFor={parcelStateFor} onToggleParcel={toggleParcelHold}
                        refundedItems={refundedByGroup[items[0].request_group_id || items[0].id] || []}
                        activeFilter={orderFilter} onClearFilter={() => setOrderFilter("all")} />
                    ))}
                </AnimatePresence>
              );
            })()}
            {activeGroup && groupOrders.filter((o) => o.user_id !== session.user.id && matchesFilter(o)).length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 11, color: "#A8A5A0", fontWeight: 600, letterSpacing: 0.4, margin: "0 2px 8px" }}>{tr("orders.squad.header", "SQUAD · {groupName}", { groupName: activeGroup.name })}</div>
                {(() => {
                  const others = groupOrders.filter((o) => o.user_id !== session.user.id);
                  const byMember = others.reduce((acc, o) => { (acc[o.user_id] = acc[o.user_id] || []).push(o); return acc; }, {});
                  return (
                    <AnimatePresence initial={false}>
                      {Object.values(byMember).filter((mo) => mo.some(matchesFilter)).map((memberOrders) => {
                        const m0 = memberOrders[0];
                        return (
                          <motion.div key={m0.user_id} layout exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }} style={{ marginBottom: 12 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 6px" }}>
                              <div style={{ width: 22, height: 22, borderRadius: "50%", overflow: "hidden", background: "#0F0E0C", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                {m0.avatar_url ? <img src={m0.avatar_url} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{(m0.member || "?").charAt(0).toUpperCase()}</span>}
                              </div>
                              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0F0E0C" }}>{m0.member}</div>
                              {/* Host-badge (user 2026-07-22): duidelijk wie het groepspakket ontvangt. */}
                              {m0.user_id === groupHostId && (
                                <span style={{ background: "#FFF0E7", color: "#B8430A", fontSize: 10, fontWeight: 800, letterSpacing: 0.4, padding: "2px 8px", borderRadius: 20 }}>🏠 {tr("orders.squad.host", "Host")}</span>
                              )}
                            </div>
                            <OrderGroupCard items={memberOrders} groupSize={null} squad
                              onOpenItem={openInspectItem}
                              activeFilter={orderFilter} onClearFilter={() => setOrderFilter("all")} />
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  );
                })()}
                <div style={{ fontSize: 11, color: "#A8A5A0", margin: "2px 2px 0", lineHeight: 1.4 }}>{tr("orders.squad.inspectNote", "👀 Tap any item to see its journey and inspect the photos. You're only notified about your own items.")}</div>
              </div>
            )}
            {/* Gerefunde (geannuleerde) items blijven 14 dagen zichtbaar als grijze kaart met
                REFUNDED-badge (user 2026-07-21) — voorheen verdwenen ze spoorloos uit de lijst.
                MODUS-SCHEIDING (user): solo toont alleen solo-refunds; groep-modus alleen
                de refunds van díé groep. */}
            {orderFilter === "all" && standaloneRefunds.map((o) => (
              <div key={"refund-" + o.id} style={{ position: "relative", background: "#F1EFE9", border: "1px solid #E3E0D9", borderRadius: 16, marginBottom: 10, padding: "13px 15px", opacity: 0.85 }}>
                {/* Wegklikbaar (user 2026-07-22) — de refund blijft altijd terug te vinden
                    in het belletje en de transactie-historie. */}
                <motion.button whileTap={{ scale: 0.82 }} onClick={() => dismissOrders([o.id])} title={tr("orders.card.removeTitle", "Remove from orders")}
                  style={{ position: "absolute", top: 8, right: 9, zIndex: 3, width: 23, height: 23, borderRadius: 999, background: "#E8E6E0", border: "none", display: "flex", alignItems: "center", justifyContent: "center", color: "#9A968F", cursor: "pointer", padding: 0, WebkitTapHighlightColor: "transparent" }}>
                  <X size={13} strokeWidth={2.7} />
                </motion.button>
                <div style={{ position: "absolute", top: 11, right: 40, background: "#DCFCE7", color: "#15803D", fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, padding: "3px 8px", borderRadius: 7 }}>{tr("orders.detail.badge.refunded", "REFUNDED")}</div>
                <div style={{ fontSize: 11, color: "#A8A5A0" }}>{(() => { try { return new Date(o.created_at).toLocaleDateString("en-GB"); } catch { return ""; } })()}</div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "#6B6862", paddingRight: 82, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.product_title || o.product}</div>
                <div style={{ fontSize: 11.5, color: "#8A8780", marginTop: 2 }}>
                  {o.kleur ? `${o.kleur} · ` : ""}
                  {/^factory defect/i.test(o.bd_error || "")
                    ? tr("orders.refunded.reasonDefect", "factory defect — fully refunded")
                    : /^out of stock/i.test(o.bd_error || "")
                      ? tr("orders.refunded.reasonOos", "out of stock — fully refunded")
                      : /refund_accepted/i.test(o.bd_error || "")
                        ? tr("orders.refunded.reasonAccepted", "refund request accepted — fully refunded")
                        : /^support refund/i.test(o.bd_error || "")
                          ? tr("orders.refunded.reasonSupport", "couldn't proceed — fully refunded, see your inbox")
                          : tr("orders.refunded.reasonUnsent", "could not be sent — fully refunded")}
                </div>
              </div>
            ))}
            {visibleOrders.filter(matchesFilter).length === 0 && !(activeGroup && groupOrders.some((o) => o.user_id !== session.user.id && matchesFilter(o))) && (
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
                <div style={{ fontSize: 15, fontWeight: 600, color: "#0F0E0C", marginBottom: 6 }}>{tr("orders.empty.title", "No orders yet")}</div>
                <div style={{ fontSize: 13 }}>{tr("orders.empty.subtitle", "Order something in the feed!")}</div>
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
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111111" }}>{tr("orders.detail.qcPics.title", "Quality-control pictures")}</div>
          </div>
          {/* Productkop + statusblok VERWIJDERD (user 2026-07-20): dit scherm is nu puur de
              Quality-control pictures. Het product staat al bij de foto's ("Your order"-badge). */}
          {/* Probleem gemeld door agent */}
          {selectedOrder.problem_type === "out_of_stock" ? (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={springSoft}
              style={{ background: "#F0FDF4", border: "1.5px solid #34D17B", borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#15803D", marginBottom: 6 }}>{tr("orders.detail.oos.title", "📦 Out of stock — refunded")}</div>
              <div style={{ fontSize: 13, color: "#166534", lineHeight: 1.5 }}>{tr("orders.detail.oos.body", "Unfortunately this item is out of stock. The item price has been automatically refunded to your balance — no action needed.")}</div>
            </motion.div>
          ) : selectedOrder.problem_type && problemTypes[selectedOrder.problem_type] ? (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={springSoft}
              style={{ background: "#FFF7ED", border: "1.5px solid #F59E0B", borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#B45309", marginBottom: 6 }}>
                {problemTypes[selectedOrder.problem_type].icon} {tr(problemTypes[selectedOrder.problem_type].labelKey, problemTypes[selectedOrder.problem_type].label)}
              </div>
              <div style={{ fontSize: 13, color: "#92400E", lineHeight: 1.5, marginBottom: 12 }}>
                {tr(problemTypes[selectedOrder.problem_type].msgKey, problemTypes[selectedOrder.problem_type].msg)}
              </div>
              {selectedOrder.status === "quote_accepted" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <motion.button whileTap={{ scale: 0.96 }} onClick={acknowledgeProblem}
                    style={{ flex: 1, background: "#FF5C00", color: "#fff", border: "none", borderRadius: 10, padding: "11px 8px", fontSize: 13, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                    {tr("orders.detail.problem.agree", "✓ Agreed, continue")}
                  </motion.button>
                  {selectedOrder.status === "quote_accepted" ? (
                    <motion.button whileTap={{ scale: 0.96 }} onClick={() => confirmCancel ? cancelPaidOrder() : setConfirmCancel(true)}
                      style={{ flex: 1, background: confirmCancel ? "#DC2626" : "#FEE2E2", color: confirmCancel ? "#fff" : "#DC2626", border: "none", borderRadius: 10, padding: "11px 8px", fontSize: 13, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                      {confirmCancel ? tr("orders.detail.problem.confirmRefund", "Sure? Yes, refund") : tr("orders.detail.problem.cancelRefund", "✕ Cancel & refund")}
                    </motion.button>
                  ) : (
                    <motion.button whileTap={{ scale: 0.96 }} onClick={() => confirmCancel ? cancelRequest() : setConfirmCancel(true)}
                      style={{ flex: 1, background: confirmCancel ? "#DC2626" : "#FEE2E2", color: confirmCancel ? "#fff" : "#DC2626", border: "none", borderRadius: 10, padding: "11px 8px", fontSize: 13, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                      {confirmCancel ? tr("orders.detail.problem.confirmCancel", "Sure? Yes, cancel") : tr("orders.detail.problem.cancelRequest", "✕ Cancel request")}
                    </motion.button>
                  )}
                </div>
              )}
            </motion.div>
          ) : null}

          {/* Door BuckyDrop gemeld defect: de klant kiest HIER (retour/accept) — de oude
              "Review in your warehouse"-knop wees naar de verdwenen warehouse-tab. */}
          {selectedOrder.dispute_status === "bucky_flagged" && (
            <div style={{ background: "#FFF7ED", border: "1.5px solid #F59E0B", borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#B45309", marginBottom: 4 }}>{tr("orders.detail.buckyFlagged.title", "⚠️ Quality-control flagged a possible defect")}</div>
              <div style={{ fontSize: 13, color: "#92400E", lineHeight: 1.5, marginBottom: 12 }}>{tr("orders.detail.buckyFlagged.body", "Our warehouse spotted something off with your item. Review the photos and choose to return it for a full refund or accept it as-is.")}</div>
              <DefectChoice order={selectedOrder}
                onResolved={(patch) => { setSelectedOrder((cur) => (cur ? { ...cur, ...patch } : cur)); fetchOrders(); }} />
            </div>
          )}
          {/* Eigen klant-melding: in behandeling, of afgewezen met standaardbericht */}
          {selectedOrder.dispute_status === "pending" && (
            <div style={{ background: "#FFF7ED", border: "1.5px solid #F59E0B", borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#B45309", marginBottom: 4 }}>{tr("orders.detail.dispute.pendingTitle", "⏳ Your report is under review")}</div>
              <div style={{ fontSize: 13, color: "#92400E", lineHeight: 1.5 }}>{tr("orders.detail.dispute.pendingBody", "We're checking your report and proof — you'll hear from us soon.")}</div>
            </div>
          )}
          {selectedOrder.dispute_status === "rejected" && selectedOrder.dispute_response && (
            <div style={{ background: "#F8F7F4", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C", marginBottom: 6 }}>{tr("orders.detail.dispute.rejectedTitle", "Return request declined")}</div>
              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.55 }}>{selectedOrder.dispute_response}</div>
            </div>
          )}
          {/* Vos-statusbanner VERWIJDERD (user 2026-07-20): dit scherm toont enkel de QC-foto's. */}

          {selectedOrder.status === "qc_pending" && selectedOrder.qc_images?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#0F0E0C", marginBottom: 12 }}>{tr("orders.detail.qcPics.title", "Quality-control pictures")}</div>
              {(() => {
                // Foto van de gekochte variant; oudere orders hebben die niet
                // opgeslagen — val dan terug op de productfoto uit de feed.
                const feedProduct = products.find(p => p.title === (selectedOrder.product_title || selectedOrder.product));
                const orderImage = selectedOrder.variant_image || (feedProduct?.image?.startsWith("http") ? feedProduct.image : null);
                return orderImage ? (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springSoft}
                    style={{ marginBottom: 10, borderRadius: 12, overflow: "hidden", position: "relative", background: "#fff" }}>
                    <img src={orderImage} referrerPolicy="no-referrer" alt="your order" style={{ width: "100%", aspectRatio: "3 / 4", objectFit: "cover", display: "block" }} />
                    <div style={{ position: "absolute", top: 8, left: 8, background: "#0F0E0C", color: "#FF5C00", fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 20 }}>
                      {tr("orders.detail.qcPics.yourOrderBadge", "Your order")}{selectedOrder.kleur ? ` · ${selectedOrder.kleur}` : ""}
                    </div>
                  </motion.div>
                ) : null;
              })()}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {selectedOrder.qc_images.map((url, i) => (
                  <div key={i} style={{ borderRadius: 12, overflow: "hidden", aspectRatio: "1", position: "relative" }}>
                    <img src={url} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    {i === 3 && <div style={{ position: "absolute", bottom: 6, left: 6, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, padding: "2px 6px", borderRadius: 6 }}>{tr("orders.detail.qcPics.weightBadge", "⚖️ Weight")}</div>}
                  </div>
                ))}
              </div>
              {/* Measurement-foto's (Garment Measurement Service) — apart blok zodat de klant
                  ALLE foto's ziet die BuckyDrop maakte (QC + measurement), niet alleen de QC-set. */}
              {selectedOrder.measurement_images?.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#0F0E0C", marginBottom: 12 }}>{tr("orders.detail.measPics.title", "Measurement pictures")}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {selectedOrder.measurement_images.map((url, i) => (
                      <div key={i} style={{ borderRadius: 12, overflow: "hidden", aspectRatio: "1" }}>
                        <img src={url} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {selectedOrder.weight_grams && (
                <div style={{ marginTop: 10, background: "#F0FDF4", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#065F46", fontWeight: 600 }}>
                  {tr("orders.detail.qcPics.weightLine", "⚖️ Weight: {grams}g · shipping is charged per parcel — bundle to save", { grams: selectedOrder.weight_grams })}
                </div>
              )}
              {/* GROEP: item zit automatisch in het groepspakket — hier bevestigt de klant met
                  Ready dat de foto's zijn geïnspecteerd (gate: pas verzenden als iedereen Ready is).
                  SOLO: item zit al automatisch in het pakket (geen "Add to parcel" meer). Na het
                  inspecteren van de foto's kan de klant hier een probleem melden → "Request a refund"
                  (submit_dispute → zichtbaar in admin). Verborgen zodra er al een defect/dispute/
                  retour/probleem loopt — dan staat het bijbehorende blok hierboven al. */}
              {(selectedOrder.dispute_status || selectedOrder.return_status || selectedOrder.problem_type) ? null : (
                <>
                  {/* GROEP: eerst de Ready-flow (bevestigen voor het groepspakket). Bij een
                      vergrendelde verzending (user 2026-07-22, keuze B): knop doorgestreept +
                      "your admin locked the group" — je kunt niks meer wijzigen. */}
                  {selectedOrder.ff_group_id && (selectedOrder.box_staged_at ? (
                    <div style={{ marginTop: 10, background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 12, padding: "12px", textAlign: "center", fontSize: 13, fontWeight: 700, color: "#065F46" }}>
                      {tr("inspect.readyDone", "✓ Ready — ships with the group parcel")}
                    </div>
                  ) : selGroupShipLocked ? (
                    <div style={{ width: "100%", marginTop: 10, background: "#F1EFE9", borderRadius: 12, padding: "12px", textAlign: "center" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#B8B5B0", textDecoration: "line-through" }}>{tr("inspect.readyBtn", "✓ Looks good — Ready to ship")}</span>
                      <div style={{ fontSize: 11.5, color: "#8A8780", marginTop: 4 }}>🔒 {tr("group.locked.note", "Your admin locked the group")}</div>
                    </div>
                  ) : (
                    <button onClick={() => markParcelReady(selectedOrder)} style={{ width: "100%", marginTop: 10, background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                      {tr("inspect.readyBtn", "✓ Looks good — Ready to ship")}
                    </button>
                  ))}
                  {/* …en daaronder — solo én groep (user 2026-07-21) — de klacht-ingang:
                      Request a refund met tekst + eigen bewijs-foto's → zichtbaar in admin.
                      Geblokkeerd zolang de groep-verzending gelockt is. */}
                  <RefundRequest order={selectedOrder} locked={selGroupShipLocked}
                    onSubmitted={(patch) => { setSelectedOrder((cur) => (cur ? { ...cur, ...patch } : cur)); fetchOrders(); }} />
                </>
              )}
            </div>
          )}
          {(selectedOrder.status === "shipped_international" || selectedOrder.status === "delivered") && (
            <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: "14px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#E0F2FE", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Plane size={16} color="#0369A1" strokeWidth={2.2} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C" }}>{tr("orders.status.inTransit", "In transit")}</div>
                <div style={{ fontSize: 12, color: "#8A8780", lineHeight: 1.4 }}>{tr("orders.detail.inTransit.body", "This item shipped in a parcel — track its delivery in the In transit tab.")}</div>
              </div>
            </div>
          )}
          {(selectedOrder.status === "shipped_international" || selectedOrder.status === "delivered") && (selectedOrder.qc_images?.length > 0 || selectedOrder.measurement_images?.length > 0) && (
            <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: "16px", marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>{tr("orders.detail.recordedCondition.title", "Recorded condition")} <span style={{ fontSize: 11, fontWeight: 500, color: "#A8A5A0" }}>{tr("orders.detail.recordedCondition.subtitle", "· kept for returns")}</span></div>
              <div style={{ fontSize: 12, color: "#8A8780", lineHeight: 1.5, marginBottom: 12 }}>
                {tr("orders.detail.recordedCondition.body", "These quality-control & measurement photos are the documented condition of your item before it shipped — we keep them as the record if you request a return or withdrawal. For a change of mind the international shipping isn't refunded; a faulty item is on us. See our Returns policy.")}
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
        </motion.div>
      )}

      {/* 📦 Automatisch pakket — balk + sheet + verzendflow op de Orders-pagina
          (de aparte warehouse-tab is opgegaan in Orders). Top-level gerenderd zodat de
          fixed pakket-balk niet in een ge-transformde pagina-container zit. */}
      {tab === "orders" && !selectedOrder && session && !isGuest && (
        <ParcelSection session={session} activeGroupId={activeGroup?.id || null}
          parcelItems={parcelItems} heldOutItems={parcelHeldItems}
          pendingRefunds={parcelPendingRefunds}
          defectItems={parcelDefects}
          forfeitedItems={parcelForfeited}
          comingItems={parcelComing}
          refreshSignal={parcelRefresh}
          onToggleHold={activeGroup ? toggleParcelHold : undefined}
          onInspectItem={openInspectItem}
          onShipped={() => { fetchOrders(); fetchHauls(); fetchBalance(); }} />
      )}

      {/* TRANSIT TAB */}
      {tab === "transit" && (
        <motion.div key="transit" {...pageTransition}>
          {isGuest ? (
            <div style={{ padding: "60px 30px", textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✈️</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0F0E0C", marginBottom: 6 }}>{tr("feed.transit.guestTitle", "In transit")}</div>
              <div style={{ fontSize: 13, color: "#8A8780", lineHeight: 1.55, maxWidth: 270, margin: "0 auto" }}>{tr("feed.transit.guestBody", "Track your parcels on their way from the warehouse to your door here — once you've placed an order.")}</div>
            </div>
          ) : (
            <TransitTab session={session} orders={orders} activeGroupId={activeGroup?.id || null} />
          )}
        </motion.div>
      )}

      {/* PROFILE TAB */}
      {tab === "profile" && (
        <motion.div key="profile" {...pageTransition} style={{ padding: "16px 20px", paddingBottom: 80 }}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6, color: "#111111", marginBottom: 14 }}>{tr("profile.title", "Profile")}</div>
          {isGuest ? (
            <>
              {/* GUEST-PROFIEL — browse-first: alleen Flowva Friends + verzendadres vragen een account. */}
              <div style={{ background: "#111111", borderRadius: 18, padding: "20px", marginBottom: 12, textAlign: "center" }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: "#1E1D1A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, margin: "0 auto 10px" }}><Fox /></div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginBottom: 4 }}>{tr("profile.guest.title", "Browse freely 👋")}</div>
                <div style={{ fontSize: 12.5, color: "#B7B3AD", lineHeight: 1.5, marginBottom: 14 }}>{tr("profile.guest.body", "Explore everything without an account. You only need one to order or to team up with friends.")}</div>
                <button onClick={() => setAuthOpen(true)} style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "13px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{tr("profile.guest.cta", "Create a free account · Log in →")}</button>
              </div>
              {/* S1 — Flowva Friends gate */}
              <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "18px", marginBottom: 12, textAlign: "center" }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, margin: "0 auto 10px" }}><Fox /></div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C", marginBottom: 8 }}>{tr("profile.friends.title", "Flowva Friends")}</div>
                {/* Deal-embleem — elke gast ziet meteen de groep-besparing (fee 8%→4% + gedeelde verzending) */}
                <div style={{ position: "relative", overflow: "hidden", display: "inline-flex", alignItems: "center", gap: 6, background: "linear-gradient(135deg, #FF7A1A, #FF5C00)", color: "#fff", fontSize: 12.5, fontWeight: 800, padding: "8px 15px", borderRadius: 999, boxShadow: "0 5px 16px rgba(255,92,0,0.35)", marginBottom: 12, letterSpacing: 0.2 }}>
                  <span style={{ fontSize: 14, lineHeight: 1 }}>💸</span> {tr("profile.guest.friendsDeal", "Up to 50% cheaper on fees & shipping!")}
                  <motion.span initial={{ x: "-130%" }} animate={{ x: "260%" }} transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 2.6, ease: "easeInOut" }}
                    style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "38%", background: "linear-gradient(105deg, transparent, rgba(255,255,255,0.55), transparent)", pointerEvents: "none" }} />
                </div>
                <div style={{ fontSize: 12.5, color: "#8A8780", lineHeight: 1.5, marginBottom: 12 }}>{tr("profile.guest.friendsBody", "Team up and split the fees with your squad.")}</div>
                <button onClick={() => setAuthOpen(true)} style={{ width: "100%", background: "#FFF0E7", border: "1px dashed rgba(255,92,0,0.4)", color: "#FF5C00", borderRadius: 12, padding: "12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{tr("profile.guest.friendsCta", "Create an account to unlock Flowva Friends")}</button>
              </div>
              {/* Publieke info — ook voor gasten */}
              <motion.div whileTap={{ scale: 0.98 }} onClick={() => setShowHowItWorks(true)}
                style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "15px 18px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}><Fox /></div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C" }}>{tr("profile.entry.howItWorks", "How Flowva works")}</div><div style={{ fontSize: 12, color: "#A8A5A0" }}>{tr("profile.entry.howItWorksSub", "Prices, fees, shipping & the haul model")}</div></div>
                <div style={{ color: "#C9C6C1", fontSize: 18 }}>→</div>
              </motion.div>
              <motion.div whileTap={{ scale: 0.98 }} onClick={() => setShowPricing(true)}
                style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "15px 18px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>💸</div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C" }}>{tr("profile.entry.pricing", "How pricing works")}</div><div style={{ fontSize: 12, color: "#A8A5A0" }}>{tr("profile.entry.pricingSub", "Every fee, and exactly who gets paid")}</div></div>
                <div style={{ color: "#C9C6C1", fontSize: 18 }}>→</div>
              </motion.div>
              <a href="/returns-policy" style={{ textDecoration: "none", background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "15px 18px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: "#F3F1ED", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>↩️</div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C" }}>{tr("profile.entry.returns", "Returns & withdrawal")}</div><div style={{ fontSize: 12, color: "#A8A5A0" }}>{tr("profile.entry.returnsSubGuest", "Read the policy")}</div></div>
                <div style={{ color: "#C9C6C1", fontSize: 18 }}>→</div>
              </a>
              <LanguageRow />
              {/* S2 — Shipping address gate */}
              <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "18px", marginBottom: 12, textAlign: "center" }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>📦</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>{tr("profile.guest.addressTitle", "Shipping address")}</div>
                <div style={{ fontSize: 12.5, color: "#8A8780", lineHeight: 1.5, marginBottom: 12 }}>{tr("profile.guest.addressBody", "You'll add this when you're ready to place your first order.")}</div>
                <button onClick={() => setAuthOpen(true)} style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{tr("profile.guest.addressCta", "Create an account to write your shipping address")}</button>
              </div>
            </>
          ) : (<>
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
                <WordReveal key={(session?.user?.id || "u") + avatarUploading} text={avatarUploading ? tr("profile.avatarUploading", "Uploading...") : tr("profile.greeting", "Hi {name}! 👋", { name: session?.user?.user_metadata?.voornaam || "there" })} delay={0.15} />
              </div>
              <div style={{ fontSize: 12.5, color: "#A8A5A0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session?.user?.email}</div>
            </div>
            <motion.div whileTap={{ scale: 0.88 }} onClick={() => setShowEditProfile(true)}
              style={{ width: 36, height: 36, borderRadius: "50%", background: "#F3F1ED", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>✏️</motion.div>
          </div>
          <div style={{ background: "#111111", borderRadius: 18, padding: "18px 20px", marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#9C9893", fontWeight: 600, marginBottom: 8 }}>{tr("profile.balance.label", "Available balance")}</div>
            <div style={{ fontSize: 34, fontWeight: 800, color: "#fff", letterSpacing: -0.5, marginBottom: 4 }}><CountUp to={parseFloat(balance) || 0} decimals={2} prefix="€" duration={0.9} /></div>
            <div style={{ fontSize: 12, color: "#9C9893" }}>{tr("profile.balance.caption", "For orders and shipping")}</div>
          </div>
          <div style={{ background: "#fff", borderRadius: 18, padding: "16px 18px", marginBottom: 12, boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#111111", marginBottom: 12 }}>{tr("profile.topup.title", "Top up balance")}</div>
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
            <input type="number" placeholder={tr("profile.topup.customPlaceholder", "Or type an amount...")} value={topupAmount} onChange={e => setTopupAmount(e.target.value)}
              style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 10, padding: "10px 14px", fontSize: 14, background: "#F8F7F4", boxSizing: "border-box", marginBottom: 10 }} />
            <label style={{ display: "flex", alignItems: "flex-start", gap: 9, margin: "2px 2px 10px", cursor: "pointer", fontSize: 11, color: "#8A8780", lineHeight: 1.5 }}>
              <input type="checkbox" checked={topupAgreed} onChange={e => setTopupAgreed(e.target.checked)} style={{ marginTop: 1, accentColor: "#FF5C00", width: 16, height: 16, flexShrink: 0 }} />
              <span>I agree to the <a href="/terms" target="_blank" rel="noreferrer" style={{ color: "#FF5C00" }}>Terms</a>, and that my balance is prepayment for Flowva orders and that any refunds are credited back to my balance.</span>
            </label>
            {PRELAUNCH ? (
              <div style={{ width: "100%", boxSizing: "border-box", background: "#111111", color: "#fff", borderRadius: 10, padding: "13px 14px", textAlign: "center", lineHeight: 1.4 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{tr("profile.prelaunch.title", "🚀 Flowva launches {date}", { date: LAUNCH_DATE_LABEL })}</div>
                <div style={{ fontSize: 11.5, fontWeight: 500, color: "#B7B3AD", marginTop: 3 }}>{tr("profile.prelaunch.body", "Top-ups & ordering open on launch day — you can already browse and build your cart.")}</div>
                <div style={{ fontSize: 11.5, fontWeight: 500, color: "#B7B3AD", marginTop: 6 }}>{tr("profile.prelaunch.follow", "Follow flowva.app on TikTok to stay updated.")}</div>
              </div>
            ) : (
              <button onClick={handleTopup} disabled={loadingBalance || !topupAmount || !topupAgreed}
                style={{ width: "100%", background: loadingBalance || !topupAmount || !topupAgreed ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700, cursor: loadingBalance || !topupAmount || !topupAgreed ? "default" : "pointer" }}>
                {loadingBalance ? tr("common.loading", "Loading...") : tr("profile.topup.cta", "+ Add €{amount} via iDEAL", { amount: topupAmount || "0" })}
              </button>
            )}
          </div>
          {/* Geld over? Terug naar de bank. Bewust klein en onder het opwaarderen: het
              is een recht, geen aanbod. Stripe stort uitsluitend terug naar de methode
              waarmee betaald is, dus er valt niets in te vullen. */}
          {parseFloat(balance) > 0 && (
            <div style={{ background: "#fff", borderRadius: 18, padding: "16px 18px", marginBottom: 12, boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)" }}>
              {!payoutInfo ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111111", marginBottom: 4 }}>{tr("profile.payout.title", "Money left over?")}</div>
                  <div style={{ fontSize: 12, color: "#8A8780", lineHeight: 1.5, marginBottom: 12 }}>
                    {tr("profile.payout.body", "Send your remaining balance back to the bank account or card you paid with. It's your money — you can ask for it any time.")}
                  </div>
                  <button onClick={askPayout} disabled={payoutBusy}
                    style={{ width: "100%", background: "transparent", color: "#111111", border: "1px solid #E8E6E0", borderRadius: 10, padding: "12px", fontSize: 13.5, fontWeight: 700, cursor: payoutBusy ? "default" : "pointer" }}>
                    {payoutBusy ? tr("common.loading", "Loading...") : tr("profile.payout.cta", "Pay out my balance →")}
                  </button>
                </>
              ) : payoutInfo.done ? (
                <div style={{ textAlign: "center", padding: "6px 0" }}>
                  <div style={{ fontSize: 26, marginBottom: 6 }}>✓</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#111111", marginBottom: 4 }}>
                    {tr("profile.payout.doneTitle", "€{amount} is on its way", { amount: Number(payoutInfo.paid).toFixed(2) })}
                  </div>
                  <div style={{ fontSize: 12, color: "#8A8780", lineHeight: 1.5 }}>
                    {tr("profile.payout.doneBody", "Your bank usually shows it within a few working days. It goes back to the account you paid with.")}
                  </div>
                </div>
              ) : payoutInfo.ok && payoutInfo.payable > 0 ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111111", marginBottom: 8 }}>{tr("profile.payout.confirmTitle", "Pay out your balance")}</div>
                  <div style={{ background: "#F8F7F4", borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "#111111", letterSpacing: -0.4 }}>€{Number(payoutInfo.payable).toFixed(2)}</div>
                    {payoutInfo.destination && (
                      <div style={{ fontSize: 12, color: "#8A8780", marginTop: 3 }}>
                        {tr("profile.payout.destination", "back to your {method}{last4}", {
                          method: payoutInfo.destination.method,
                          last4: payoutInfo.destination.last4 ? ` ••${payoutInfo.destination.last4}` : "",
                        })}
                      </div>
                    )}
                  </div>
                  <button onClick={doPayout} disabled={payoutBusy}
                    style={{ width: "100%", background: payoutBusy ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700, cursor: payoutBusy ? "default" : "pointer" }}>
                    {payoutBusy ? tr("profile.payout.sending", "Sending…") : tr("profile.payout.confirmCta", "Send it back →")}
                  </button>
                  <button onClick={() => setPayoutInfo(null)} style={{ width: "100%", marginTop: 8, background: "none", border: "none", color: "#8A8780", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 6 }}>
                    {tr("common.close", "Close")}
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111111", marginBottom: 6 }}>{tr("profile.payout.blockedTitle", "We can't pay this out automatically")}</div>
                  <div style={{ fontSize: 12, color: "#8A8780", lineHeight: 1.5, marginBottom: 12 }}>
                    {payoutInfo.openOrders > 0 || payoutInfo.inTransit > 0
                      ? tr("profile.payout.blockedOrders", "You still have an order running. Your balance covers its shipping, so you can pay out what's left once your parcel has been delivered.")
                      : tr("profile.payout.blockedOther", "Write to us and a real person will sort it out for you — contact@flowva.app.")}
                  </div>
                  <button onClick={() => setPayoutInfo(null)} style={{ width: "100%", background: "transparent", color: "#111111", border: "1px solid #E8E6E0", borderRadius: 10, padding: "11px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                    {tr("common.close", "Close")}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Flowva Friends — switch-lijst: Solo (standaard aan) + één groep tegelijk live. activeGroup = één waarde → wederzijds uitsluitend. */}
          {(() => {
            const gathering = myGroups.filter((g) => g.status === "gathering");
            const placed = myGroups.filter((g) => g.status !== "gathering");
            const isOn = (gid) => !!activeGroup && activeGroup.id === gid;
            const sw = (on) => (
              <div role="switch" aria-checked={on} style={{ width: 46, height: 27, borderRadius: 999, background: on ? "#FF5C00" : "#E3E1DC", position: "relative", flexShrink: 0, transition: "background .25s" }}>
                <motion.div animate={{ x: on ? 19 : 0 }} transition={springBouncy}
                  style={{ position: "absolute", top: 3, left: 3, width: 21, height: 21, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
              </div>
            );
            const rowStyle = (on) => ({ display: "flex", alignItems: "center", gap: 11, boxSizing: "border-box", width: "100%", cursor: "pointer", borderRadius: 13, padding: "11px 13px", transition: "border-color .2s, background .2s", background: on ? "#FFF7F2" : "#F8F7F4", border: `1.5px solid ${on ? "rgba(255,92,0,0.6)" : "#ECEAE5"}` });
            const groupRow = (g, liveLabel) => {
              const on = isOn(g.group_id);
              return (
                <div key={g.group_id} onClick={() => setActiveGroup(on ? null : { id: g.group_id, name: g.name })} style={rowStyle(on)}>
                  <div style={{ width: 30, height: 30, borderRadius: 9, background: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Users size={15} color="#fff" strokeWidth={2.2} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "#111111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}{g.role === "admin" ? tr("profile.friends.adminSuffix", " · admin") : ""}</div>
                    <div style={{ fontSize: 11, color: "#A8A5A0" }}>{tr("profile.friends.memberCount", "{count}/{max} friends", { count: g.member_count, max: g.max_size })}{on ? ` · ${liveLabel}` : ""}</div>
                  </div>
                  {sw(on)}
                </div>
              );
            };
            return (
              <div style={{ background: "#fff", border: `1px solid ${activeGroup ? "rgba(255,92,0,0.5)" : "#E8E6E0"}`, borderRadius: 16, padding: "15px 18px", marginBottom: 12, boxShadow: activeGroup ? "0 0 0 3px rgba(255,92,0,0.08)" : "none", transition: "border-color .25s, box-shadow .25s" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 11, background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}><Fox /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C" }}>{tr("profile.friends.title", "Flowva Friends")}</div>
                    <div style={{ fontSize: 12, color: "#A8A5A0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeGroup ? ((myGroups.find((g) => g.group_id === activeGroup.id)?.status || "gathering") === "gathering" ? tr("profile.friends.shoppingFor", "Shopping for {name}", { name: activeGroup.name }) : tr("profile.friends.following", "Following {name}", { name: activeGroup.name })) : tr("profile.friends.soloSubtitle", "Shopping solo — flip a group on to team up")}</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 10 }}>
                  {/* Solo shopping — standaard aan zolang er geen groep actief is */}
                  <div onClick={() => setActiveGroup(null)} style={rowStyle(!activeGroup)}>
                    <div style={{ width: 30, height: 30, borderRadius: 9, background: "#111111", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><User size={15} color="#fff" strokeWidth={2.3} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "#111111" }}>{tr("profile.friends.soloRow", "Solo shopping")}</div>
                      <div style={{ fontSize: 11, color: "#A8A5A0" }}>{tr("profile.friends.soloRowSub", "Just you — the default")}</div>
                    </div>
                    {sw(!activeGroup)}
                  </div>
                  {gathering.map((g) => groupRow(g, tr("profile.friends.liveLabel", "live")))}
                  {placed.map((g) => groupRow(g, tr("profile.friends.followingLabel", "following")))}
                </div>
                {activeGroup && placed.some((g) => g.group_id === activeGroup.id) && (
                  <button onClick={() => { setFriendsGroupId(activeGroup.id); setShowFriends(true); }}
                    style={{ background: "transparent", border: "none", color: "#16A34A", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "10px 0 0", textAlign: "left" }}>{tr("profile.friends.openGroup", "Open group & see details →")}</button>
                )}
                <button onClick={() => { if (!requireAuth()) return; setFriendsJoinCode(null); setShowFriends(true); }}
                  style={{ width: "100%", marginTop: 12, background: "#FFF0E7", border: "1px dashed rgba(255,92,0,0.4)", color: "#FF5C00", borderRadius: 12, padding: "12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{tr("profile.friends.manageCta", "+ Create, join or manage groups")}</button>
              </div>
            );
          })()}
          <PushToggle session={session} />
          <LanguageRow />
          <motion.div whileTap={{ scale: 0.98 }} onClick={() => setShowHowItWorks(true)}
            style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "15px 18px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}><Fox /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C" }}>{tr("profile.entry.howItWorks", "How Flowva works")}</div>
              <div style={{ fontSize: 12, color: "#A8A5A0" }}>{tr("profile.entry.howItWorksSub", "Prices, fees, shipping & the haul model")}</div>
            </div>
            <div style={{ color: "#C9C6C1", fontSize: 18 }}>→</div>
          </motion.div>
          <motion.div whileTap={{ scale: 0.98 }} onClick={() => setShowPricing(true)}
            style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "15px 18px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: "#FFF0E7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>💸</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C" }}>{tr("profile.entry.pricing", "How pricing works")}</div>
              <div style={{ fontSize: 12, color: "#A8A5A0" }}>{tr("profile.entry.pricingSub", "Every fee, and exactly who gets paid")}</div>
            </div>
            <div style={{ color: "#C9C6C1", fontSize: 18 }}>→</div>
          </motion.div>
          <a href="/returns" style={{ textDecoration: "none", background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "15px 18px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: "#F3F1ED", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>↩️</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C" }}>{tr("profile.entry.returns", "Returns & withdrawal")}</div>
              <div style={{ fontSize: 12, color: "#A8A5A0" }}>{tr("profile.entry.returnsSub", "Cancel an order or read the policy")}</div>
            </div>
            <div style={{ color: "#C9C6C1", fontSize: 18 }}>→</div>
          </a>
          <TransactionHistory session={session} />
          <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "16px 20px", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C" }}>{tr("profile.address.title", "📦 Shipping address")}</div>
              <motion.button whileTap={{ scale: 0.9 }} transition={springSnappy} onClick={() => setShowEditProfile(true)}
                style={{ background: "none", border: "none", fontSize: 12, color: "#6366F1", cursor: "pointer", fontWeight: 600, WebkitTapHighlightColor: "transparent" }}>{tr("profile.address.edit", "✏️ Edit")}</motion.button>
            </div>
            {[
              { label: tr("profile.address.name", "Name"), value: `${session?.user?.user_metadata?.voornaam || ""} ${session?.user?.user_metadata?.achternaam || ""}` },
              { label: tr("profile.address.address", "Address"), value: session?.user?.user_metadata?.adres || "-" },
              { label: tr("profile.address.postalCode", "Postal code"), value: session?.user?.user_metadata?.postcode || "-" },
              { label: tr("profile.address.city", "City"), value: session?.user?.user_metadata?.stad || "-" },
              { label: tr("profile.address.country", "Country"), value: session?.user?.user_metadata?.land || "-" },
              { label: tr("profile.address.phone", "Phone"), value: session?.user?.user_metadata?.telefoon || "-" },
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
              ["supplyflow_request_list", "supplyflow_haul", "flowva_parcel_heldout", "flowva_favorites", "flowva_active_group", "flowva_seen_howitworks"]
                .forEach((k) => { localStorage.removeItem(lsKey(k)); localStorage.removeItem(k); });
            } catch { /* ignore */ }
            supabase.auth.signOut();
          }} style={{ width: "100%", background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>{tr("profile.logout", "Log out")}</button>
          </>)}

          <div style={{ display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap", marginTop: 20 }}>
            <a href="/terms" style={{ fontSize: 11.5, color: "#A8A5A0", textDecoration: "none" }}>{tr("common.footer.terms", "Terms")}</a>
            <span style={{ fontSize: 11.5, color: "#D4D1CA" }}>·</span>
            <a href="/privacy" style={{ fontSize: 11.5, color: "#A8A5A0", textDecoration: "none" }}>{tr("common.footer.privacy", "Privacy")}</a>
            <span style={{ fontSize: 11.5, color: "#D4D1CA" }}>·</span>
            <a href="/returns-policy" style={{ fontSize: 11.5, color: "#A8A5A0", textDecoration: "none" }}>{tr("common.footer.returns", "Returns")}</a>
          </div>
          <div style={{ textAlign: "center", fontSize: 10.5, color: "#C9C6C1", marginTop: 8 }}>{tr("common.footer.build", "© Flowva · build {buildId}", { buildId: typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev" })}</div>
        </motion.div>
      )}

      </AnimatePresence>
      </div>{/* /content-wrapper bottom-pull */}

      {/* Order Request Modal */}
      <AnimatePresence>
        {selectedProduct && (
          <OrderRequest product={selectedProduct} session={session}
            onRequireAuth={() => setAuthOpen(true)}
            onClose={() => setSelectedProduct(null)}
            onSuccess={() => { setSuccessProduct(selectedProduct); setSelectedProduct(null); fetchOrders(); }}
            listCount={requestList.length}
            onAddToList={(item, rect, pid) => {
              track("cart", pid ?? selectedProduct?.id);  // trechter: "in mandje gelegd" — mét product, voor de populariteits-sortering
              setRequestList(list => [...list, item]);
              flashPromise();          // mandje-balk zegt heel even wat wij met het item doen
              setSelectedProduct(null);
              // Foto vliegt van de FEED-KAART van het item naar het 📋-icoon van de mand-balk.
              // We wachten tot de sheet-dichtklap-morph klaar is (anders vechten twee animaties
              // om je aandacht), meten dan de kaart (fallback: de sheet-foto-rect van de tik).
              if (rect && item.variant_image) {
                setTimeout(() => {
                  let f = rect;
                  const card = pid != null ? document.querySelector(`[data-pcard-img="${pid}"]`) : null;
                  const cr = card?.getBoundingClientRect();
                  if (cr && cr.width > 0 && cr.bottom > 0 && cr.top < window.innerHeight) f = cr;
                  const t = document.querySelector("[data-cart-emoji]")?.getBoundingClientRect();
                  const tx = t ? t.left + t.width / 2 - 21 : window.innerWidth / 2 - 170;
                  const ty = t ? t.top + t.height / 2 - 21 : window.innerHeight - 132;
                  setCartFlight({ src: item.variant_image, fx: f.left, fy: f.top, fw: f.width, fh: f.height, tx, ty });
                }, 480);
              }
            }}
            isFavorite={isFavorite(selectedProduct)} onToggleFavorite={() => toggleFavorite(selectedProduct)}
            activeGroup={activeGroupShopping ? activeGroup : null} activeGroupShipLocked={activeGroupShipLocked} groupLocked={!!activeGroup && !activeGroupShopping} lockedGroupName={activeGroup && !activeGroupShopping ? activeGroup.name : null} onActiveGroupGone={() => setActiveGroup(null)} />
        )}
      </AnimatePresence>

      {/* Productfoto onderweg naar de mand-balk */}
      {cartFlight && <FlyingImage flight={cartFlight} onDone={() => setCartFlight(null)} />}

      {/* 💸/💎 in boogvlucht van de feed-knop naar z'n sheet */}
      {arcFlight && !arcFlight.pending && <ArcGhost f={arcFlight} onDone={() => setArcFlight(null)} />}

      {/* Hype check — stemsheet voor een Coming soon/demo-product (niet koopbaar) */}
      <AnimatePresence>
        {hypeProduct && (
          <HypeCheckSheet
            product={hypeProduct}
            session={session}
            onClose={() => setHypeProduct(null)}
            onRequireAuth={() => { setHypeProduct(null); setAuthOpen(true); }}
            initialStats={voteStats[hypeProduct.id]}
            initialMyVote={myVotes[hypeProduct.id]}
            onVoted={(id, st, r) => { if (st) setVoteStats((v) => ({ ...v, [id]: st })); setMyVotes((v) => ({ ...v, [id]: { ...(v[id] || {}), reaction: r } })); }}
            onNotify={(id, on, st) => { if (st) setVoteStats((v) => ({ ...v, [id]: st })); setMyVotes((v) => ({ ...v, [id]: { ...(v[id] || {}), notify: on } })); }}
          />
        )}
      </AnimatePresence>

      {/* Zwevende aanvraaglijst-balk: morpht open naar de zwarte lijst-sheet
          (zelfde layoutId — het balkje IS de dichtgevouwen lijst) */}
      <AnimatePresence>
        {showFriends && !isGuest && (
          <Friends session={session} initialJoinCode={friendsJoinCode} initialGroupId={friendsGroupId}
            activeGroupId={activeGroup?.id} balance={balance}
            onShopForGroup={(g) => setActiveGroup(g)} onOpenProduct={openProductByUrl}
            onClose={() => { setShowFriends(false); setFriendsJoinCode(null); setFriendsGroupId(null); }} />
        )}
        {showVable && (
          <>
            {/* Stabiele keys: anders hergebruikt React de DOM-node van een unmountende
                sibling (de cart-pop-balk met layoutId) voor deze backdrop → framer's
                inline-styles (border-radius/box-shadow/translate) blijven plakken en
                geven een rare "boog" achter de sheet. */}
            <motion.div key="vable-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowVable(false)}
              style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }} />
            <motion.div key="vable-sheet" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 34 }}
              style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#fff", borderRadius: "24px 24px 0 0", zIndex: 301, maxHeight: "88vh", overflowY: "auto", padding: 0 }}>
              <div style={{ position: "relative", width: "100%", aspectRatio: "1080 / 1934", background: "#0b101d", overflow: "hidden" }}>
                <video src="/vable/hero.mp4" poster="/vable/hero-poster.jpg" autoPlay loop muted playsInline preload="auto"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0) 16%)" }} />
                <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", width: 38, height: 4, background: "rgba(255,255,255,0.6)", borderRadius: 2, zIndex: 3 }} />
                <button onClick={() => setShowVable(false)} aria-label={tr("common.aria.close", "close")} style={{ position: "absolute", top: 12, right: 12, background: "rgba(0,0,0,0.4)", border: "none", borderRadius: 999, width: 30, height: 30, fontSize: 14, color: "#fff", cursor: "pointer", zIndex: 3 }}>✕</button>
                <div style={{ position: "absolute", top: 16, left: 16, zIndex: 3, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,0.9)", textShadow: "0 1px 8px rgba(0,0,0,0.6)" }}>{tr("feed.vable.eyebrow", "Shop our brand")}</div>
                <div style={{ position: "absolute", top: "34%", left: 18, right: 18, textAlign: "center", zIndex: 2 }}>
                  <img src="/vable-logo.svg" alt="VABLE" style={{ height: 116, width: "auto", maxWidth: "90%", filter: "brightness(0) invert(1) drop-shadow(0 2px 16px rgba(0,0,0,0.5))", marginBottom: 18 }} />
                  <div style={{ fontSize: 11.5, letterSpacing: 3, textTransform: "uppercase", color: "rgba(255,255,255,0.85)", textShadow: "0 1px 8px rgba(0,0,0,0.55)", marginBottom: 10 }}>{tr("feed.vable.dropLabel", "First drop coming soon")}</div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: "rgba(255,255,255,0.9)", textShadow: "0 1px 10px rgba(0,0,0,0.55)" }}>{tr("feed.vable.tagline", "Wearable art")}</div>
                </div>
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
                ? tr("feed.groupToast.placed", "Your group {name} is placed — everyone's in! Tap to view.", { name: groupToast.name || "order" })
                : tr("feed.groupToast.closed", "Your group {name} closed. Tap for details.", { name: groupToast.name || "" })}
            </div>
            <button onClick={(e) => { e.stopPropagation(); setGroupToast(null); }} aria-label={tr("common.aria.dismiss", "dismiss")} style={{ background: "transparent", border: "none", color: "#9C9893", fontSize: 14, cursor: "pointer" }}>✕</button>
          </div>
        )}
        {infoToast && (
          <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", zIndex: 350, background: "#0F0E0C", color: "#fff", borderRadius: 999, padding: "10px 18px", fontSize: 13, fontWeight: 600, boxShadow: "0 8px 30px rgba(0,0,0,0.4)", maxWidth: "90%", textAlign: "center" }}>{infoToast}</div>
        )}
        {activeGroupShopping && (tab === "feed" || tab === "brands") && !selectedProduct && !showFriends && !showRequestList && !showVable && !hypeProduct && (
          <motion.div layoutId="squad-pop" layoutRoot initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0, scale: 0.96 }} whileTap={{ scale: 0.97 }} transition={springMorph}
            onClick={() => { setFriendsGroupId(activeGroup.id); setShowFriends(true); }}
            style={{ position: "fixed", bottom: 86, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 40px)", maxWidth: 390, background: "#111111", borderRadius: 999, overflow: "hidden", cursor: "pointer", zIndex: 301, boxShadow: "0 12px 40px rgba(17,17,17,0.35), 0 0 12px rgba(255,92,0,0.5)", border: "1px solid rgba(255,92,0,0.6)" }}>
            <div style={{ padding: "11px 18px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 18 }}><Fox /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tr("feed.groupBanner.shopping", "{group} · group cart", { group: activeGroup.name })}</div>
                <div style={{ fontSize: 11.5, color: "#9C9893" }}>{tr("feed.groupBanner.shoppingSub", "Tap to open your squad")} <Fox /></div>
              </div>
              <motion.div animate={{ y: [0, -3, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,92,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ChevronUp size={16} color="#FF5C00" strokeWidth={2.5} />
              </motion.div>
              <button onClick={(e) => { e.stopPropagation(); setActiveGroup(null); }} aria-label={tr("feed.aria.exitGroupMode", "exit group mode")}
                style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#9C9893", width: 26, height: 26, borderRadius: "50%", fontSize: 12, cursor: "pointer", flexShrink: 0 }}>✕</button>
            </div>
          </motion.div>
        )}
        {/* Geplaatste/gevolgde groep: maak glashelder dat de groep op slot zit en je nu solo winkelt. */}
        {activeGroup && !activeGroupShopping && (tab === "feed" || tab === "brands") && !selectedProduct && !showFriends && !showRequestList && requestList.length === 0 && !showVable && !hypeProduct && (
          <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={springMorph}
            onClick={() => { setFriendsGroupId(activeGroup.id); setShowFriends(true); }}
            style={{ position: "fixed", bottom: 78, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 40px)", maxWidth: 390, background: "#111111", borderRadius: 16, overflow: "hidden", cursor: "pointer", zIndex: 301, boxShadow: "0 12px 40px rgba(17,17,17,0.35)", border: "1px solid rgba(52,209,123,0.35)" }}>
            <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 18 }}>📦</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tr("feed.groupBanner.placed", "{group} · order placed", { group: activeGroup.name })}</div>
                <div style={{ fontSize: 11.5, color: "#9C9893" }}>{tr("feed.groupBanner.placedSub", "Group locked — you can't shop in this group anymore")}</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setActiveGroup(null); }} aria-label={tr("feed.aria.stopFollowing", "stop following")}
                style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#9C9893", fontSize: 11, fontWeight: 700, padding: "6px 11px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>{tr("feed.groupBanner.shopSolo", "Shop solo ✓")}</button>
            </div>
          </motion.div>
        )}
        {requestList.length > 0 && (tab === "feed" || tab === "brands") && !showRequestList && !selectedProduct && !showFriends && !activeGroupShopping && !showVable && !hypeProduct && (
          <motion.div key="cart-pop-bar" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} whileTap={{ scaleX: 1.03, scaleY: 0.93 }} transition={springMorph}
            onClick={() => { setListError(null); setShowRequestList(true); }}
            style={{ position: "fixed", bottom: 86, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 40px)", maxWidth: 390, background: "#111111", borderRadius: 999, overflow: "hidden", cursor: "pointer", zIndex: 301, boxShadow: "0 12px 40px rgba(17,17,17,0.35)" }}>
            <div style={{ padding: "11px 18px", display: "flex", alignItems: "center", gap: 12 }}>
              <span data-cart-emoji style={{ fontSize: 18 }}>📋</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{tr("cart.popBar.title", "Shopping cart · {count} item{s}", { count: requestList.length, s: requestList.length > 1 ? "s" : "" })}</div>
                <AnimatePresence mode="wait" initial={false}>
                  {justAdded ? (
                    <motion.div key="promise" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}
                      style={{ fontSize: 11.5, color: "#FF8A3D", fontWeight: 600 }}>
                      {tr("cart.popBar.promise", "✓ We photograph & measure it before it ships")}
                    </motion.div>
                  ) : (
                    <motion.div key="sub" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}
                      style={{ fontSize: 11.5, color: "#9C9893" }}>
                      {tr("cart.popBar.subtitle", "Tap to open — one fee at shipping")} <Fox />
                    </motion.div>
                  )}
                </AnimatePresence>
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
            onClose={() => { setShowRequestList(false); setResumeCheckout(false); }}
            onSend={submitRequestList}
            sending={sendingList}
            error={listError}
            needed={listNeeded}
            balance={balance}
            initialView={resumeCheckout ? "checkout" : "cart"}
            session={session}
            onEditAddress={() => { setShowRequestList(false); if (isGuest) { setAuthOpen(true); return; } setTab("profile"); setShowEditProfile(true); }}
            onTopUp={() => { setShowRequestList(false); setTab("profile"); }}
            onTopUpExact={(amt) => startTopUp(amt, "/?resume=cart")}
            onFinish={(goOrders) => { setShowRequestList(false); setResumeCheckout(false); if (goOrders) { setTab("orders"); setSelectedOrder(null); } }}
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
              <button onClick={() => setPreviewProduct(null)} style={{ background: "none", border: "none", fontSize: 14, color: "#666", cursor: "pointer", padding: 0, marginBottom: 12 }}>{tr("common.back", "← Back")}</button>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>{previewProduct.title}</div>
              <div style={{ fontSize: 12, color: "#aaa", marginBottom: 16 }}>{tr("product.preview.subtitle", "Product preview")}</div>
              <PreviewGallery images={previewProduct.preview_images} />
              <button onClick={() => { setPreviewProduct(null); setSelectedProduct(previewProduct); }}
                style={{ width: "100%", marginTop: 20, background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                {tr("product.preview.viewProductCta", "View product →")}
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
              <ConfettiBurst />
              <div style={{ width: 36, height: 4, background: "#333", borderRadius: 2, margin: "0 auto 24px" }} />
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <motion.span layoutId="cart-fox" style={{ fontSize: 56, display: "inline-block", marginBottom: 16 }}><Fox /></motion.span>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#FF5C00", marginBottom: 8 }}>{tr("product.orderSuccess.title", "Order placed! 🎉")}</div>
                <div style={{ fontSize: 14, color: "#888", lineHeight: 1.6 }}>
                  {tr("product.orderSuccess.subtitle", "We're getting it from the factory:")}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
                {[
                  { icon: "🛒", text: tr("product.orderSuccess.step.buying", "Buying your item from the supplier"), lid: "ck-ship" },
                  { icon: "📸", text: tr("product.orderSuccess.step.photos", "Taking quality-control photos"), lid: "ck-items" },
                  { icon: "🏭", text: tr("product.orderSuccess.step.storing", "Storing it safely in the warehouse"), lid: "ck-total" },
                  { icon: "✈️", text: tr("product.orderSuccess.step.shipping", "Shipping it to your door"), lid: "ck-boat" },
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
                {tr("product.orderSuccess.trackCta", "Track it in Orders →")}
              </motion.button>
              <motion.button onClick={() => { setSuccessProduct(null); setOrderSuccess(false); }}
                style={{ width: "100%", background: "transparent", color: "#888", border: "none", padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 6 }}>
                {tr("product.orderSuccess.backToFeed", "Back to feed")}
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
                    { Icon: ShoppingBag, label: tr("product.actions.viewProduct", "View product"), sub: tr("product.actions.viewProductSub", "Choose options & add to cart"), accent: true, show: true,
                      go: () => { const p = actionProduct; setActionProduct(null); setSelectedProduct(p); } },
                    { Icon: Eye, label: tr("product.actions.preview", "Product preview"), sub: tr("product.actions.previewSub", "View extra photos"), accent: false, show: actionProduct.preview_images?.length > 0,
                      go: () => { const p = actionProduct; setActionProduct(null); setPreviewProduct(p); } },
                    { Icon: Star, label: tr("product.actions.reviews", "Reviews"), sub: tr("product.actions.reviewsSub", "Ratings & photos"), accent: false, show: true,
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
        {showWelcome && <WelcomeSheet onClose={closeWelcome} onTour={() => { markIntroSeen(); setShowWelcome(false); setShowHowItWorks(true); }} />}
        {showHowItWorks && <HowItWorksSheet onClose={closeHowItWorks} />}
        {showPricing && <PricingSheet onClose={() => setShowPricing(false)} arriving={arcFlight?.kind === "pricing"} onTour={() => { setShowPricing(false); setShowPricingTour(true); }} />}
        {showPricingTour && <PricingTourSheet onClose={closePricingTour} onDetails={openBreakdown} />}
        {showDiamond && <DiamondSheet onClose={() => setShowDiamond(false)} arriving={arcFlight?.kind === "diamond"} />}
        {squadWheel && <ProgressWheelModal items={[squadWheel]} onClose={() => setSquadWheel(null)} />}
      </AnimatePresence>
      {/* 🔍 Item-inspectiesheet (Friends): squad-breed foto's inspecteren + eigen Ready-bevestiging.
          Bewust BUITEN AnimatePresence — de sheet regelt z'n eigen exit-animatie (portal-issue). */}
      {inspectItem && (
        <ItemInspectSheet key={inspectItem.id} item={inspectItem} isOwn={inspectItem.user_id === session?.user?.id}
          onReady={markParcelReady} onHoldOut={(o) => { if (!parcelHeldOut.includes(o.id)) toggleParcelHold(o.id); }}
          onClose={() => setInspectItem(null)} />
      )}

      {/* Review-pagina */}
      <AnimatePresence>
        {reviewProduct && (
          <ReviewPage product={reviewProduct} session={session} onClose={() => setReviewProduct(null)} />
        )}
      </AnimatePresence>

      {/* Gast → inlog/registreer-overlay. Browse-first: de etalage blijft open; alleen acties
          die identiteit/geld raken leiden hierheen. Sluit vanzelf zodra er een sessie is. */}
      <AnimatePresence>
        {authOpen && isGuest && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            style={{ position: "fixed", inset: 0, zIndex: 9000, background: "#F8F7F4", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
            <motion.button onClick={() => setAuthOpen(false)} whileTap={{ scale: 0.88 }} aria-label={tr("common.aria.closeCapitalized", "Close")}
              style={{ position: "fixed", top: 14, right: 14, zIndex: 9001, width: 38, height: 38, borderRadius: 19, border: "none", background: "rgba(255,255,255,0.92)", boxShadow: "0 2px 10px rgba(17,17,17,0.14)", fontSize: 17, cursor: "pointer", color: "#111", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</motion.button>
            <Auth />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom nav — layout+layoutRoot isoleert de navPill (layoutId) van pagina-scroll-
          sprongen. LET OP: centreren via left/right+margin, NIET via transform — framer's
          layout-projectie zet z'n eigen transform en overschrijft translateX(-50%). */}
      <motion.div ref={navRef} layout layoutRoot
        onPointerDown={navPointerDown}
        style={{ position: "fixed", zIndex: 100, bottom: 12, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 28px)", maxWidth: 402, borderRadius: 999, display: "flex", padding: "6px 8px", overflow: "hidden", background: "#fff", border: "1px solid #ECEAE5", boxShadow: "0 10px 30px rgba(17,17,17,0.14)", touchAction: "none" }}>
        {[
          { id: "feed", Icon: Home, label: tr("feed.nav.feed", "Feed") },
          { id: "brands", Icon: ShoppingBag, label: tr("feed.nav.brands", "Brands") },
          { id: "orders", Icon: Package, label: tr("common.tab.orders", "Orders") },
          { id: "transit", Icon: Plane, label: tr("feed.nav.transit", "Transit") },
          { id: "profile", Icon: User, label: tr("feed.nav.profile", "Profile") },
        ].filter(t => NAV_TABS.includes(t.id)).map(t => {
          const active = tab === t.id;
          return (
            <motion.button key={t.id} onClick={() => { if (navDrag.current.moved) return; setTab(t.id); setSelectedOrder(null); }}
              whileTap={{ scaleX: 1.12, scaleY: 0.86 }} transition={springSnappy}
              style={{ position: "relative", flex: 1, background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer", WebkitTapHighlightColor: "transparent", padding: "6px 0 7px" }}>
              {active && (
                <motion.div layoutId="navPill" transition={springSnappy}
                  style={{ position: "absolute", inset: 0, zIndex: 0 }}>
                  {/* pull-laag: vasthouden + bewegen trekt de blob elastisch naar je vinger,
                      verankerd aan het beginpunt (rekt één kant op, schuift maar licht mee) */}
                  <motion.div style={{ position: "absolute", inset: 0, x: pullShift, scaleX: pullScaleX, scaleY: pullScaleY, transformOrigin: pullOrigin }}>
                    {/* gel-blob: rekt uit (breder + platter) bij de sprong naar een nieuwe tab */}
                    <motion.div key={tab}
                      animate={{ scaleX: [1, 1.35, 0.92, 1], scaleY: [1, 0.72, 1.06, 1] }}
                      transition={{ duration: 0.5, times: [0, 0.35, 0.7, 1], ease: "easeOut" }}
                      style={{ position: "absolute", inset: 0, borderRadius: 999, background: "rgba(255,92,0,0.17)", boxShadow: "inset 0 0 0 1px rgba(255,92,0,0.35), inset 2px 3px 6px rgba(255,255,255,0.5)" }} />
                  </motion.div>
                </motion.div>
              )}
              <motion.span animate={{ scale: active ? 1.12 : 1, y: active ? -1 : 0 }} transition={springSnappy}
                style={{ position: "relative", zIndex: 1, display: "flex" }}>
                <t.Icon size={21} color={active ? "#111111" : "#A8A5A0"} strokeWidth={active ? 2.3 : 1.8} />
                {t.id === "orders" && warehouseCount > 0 && (
                  <div style={{ position: "absolute", top: -5, right: -8, background: "#FF5C00", borderRadius: 9, minWidth: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", border: "2px solid #fff", padding: "0 2px", boxSizing: "content-box" }}>{warehouseCount}</div>
                )}
              </motion.span>
              <span style={{ position: "relative", zIndex: 1, fontSize: 10, fontWeight: active ? 700 : 500, color: active ? "#111111" : "#A8A5A0" }}>{t.label}</span>
            </motion.button>
          );
        })}
      </motion.div>
    </div>
  );
}
