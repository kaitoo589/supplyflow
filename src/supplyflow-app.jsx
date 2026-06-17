import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import OrderRequest from "./OrderRequest";
import { WarehouseTab, TransitTab } from "./WarehouseAndHaul";
import { motion, AnimatePresence } from "framer-motion";
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

import { topCategories, clothesCategories } from "./categories";

const statusConfig = {
  requested:            { label: "Request completed",        color: "#92400E", bg: "#FEF3C7", step: 0 },
  quote_sent:           { label: "Pay quote",          color: "#6366F1", bg: "#EDE9FE", step: 1 },
  quote_accepted:       { label: "Purchasing product",    color: "#0369A1", bg: "#E0F2FE", step: 2 },
  purchased:            { label: "Purchase successful",           color: "#065F46", bg: "#D1FAE5", step: 3 },
  shipped_local:        { label: "In transit in China",        color: "#0369A1", bg: "#E0F2FE", step: 4 },
  qc_pending:           { label: "QC photos ready!",         color: "#065F46", bg: "#D1FAE5", step: 5 },
  shipped_international:{ label: "Shipped internationally", color: "#065F46", bg: "#D1FAE5", step: 6 },
  delivered:            { label: "Delivered",                  color: "#166534", bg: "#DCFCE7", step: 7 },
};

// Labels van de tracking-bolletjes — index = statusConfig[...].step.
const trackingSteps = [
  "Request completed",
  "Pay quote",
  "Purchasing product",
  "Purchase successful",
  "In transit in China",
  "QC photos ready!",
  "In transit",
  "Delivered",
];

const foxMessages = {
  requested:            { msg: "Request received! 🎉 Our agent will now check availability, confirm the price and calculate local shipping costs. You'll receive a quote once everything is verified.", icon: "🛒" },
  quote_sent:           { msg: "Your quote is ready! Check the exact price below and pay from your balance to confirm the order.", icon: "📋" },
  quote_accepted:       { msg: "Payment received! Our agent is now purchasing the product on 1688.", icon: "💰" },
  purchased:            { msg: "Done — your product has been purchased and is on its way to our warehouse in China.", icon: "✅" },
  shipped_local:        { msg: "Your product is in transit within China to our warehouse.", icon: "🚚" },
  qc_pending:           { msg: "Your product has arrived at our warehouse! Go to your warehouse to view it and add it to a parcel.", icon: "🏭" },
  shipped_international:{ msg: "Your parcel is on its international journey. Hang tight!", icon: "✈️" },
  delivered:            { msg: "Your order has been delivered. Enjoy!", icon: "🎉" },
};

const extraServices = [
  {
    category: "Productinspectie",
    icon: "🔍",
    items: [
      { id: "detailed_photo", label: "Gedetailleerde foto's", desc: "Extra close-up foto's van het product", price: 2.00 },
      { id: "detailed_inspection", label: "Gedetailleerde inspectie", desc: "Volledige kwaliteitscontrole", price: 5.50 },
      { id: "reinspection", label: "Herkeuring", desc: "Opnieuw inspecteren na melding", price: 6.00 },
      { id: "power_inspection", label: "Inschakelinspectie", desc: "Voor elektronica & apparaten", price: 12.00 },
    ],
  },
  {
    category: "Verpakkingsservice",
    icon: "📦",
    items: [
      { id: "bubble_wrap", label: "Bubbeltjesfolie", desc: "Extra bescherming rondom product", price: 5.00 },
      { id: "dust_bag", label: "Stofzakje", desc: "Stoffen beschermzak", price: 4.00 },
      { id: "kraft_mailer", label: "Kraft bubbel envelop", desc: "Stevige kartonnen envelop", price: 3.00 },
      { id: "plastic_seal", label: "Plastic sealing", desc: "Luchtdicht verpakt", price: 10.00 },
      { id: "custom_epe", label: "Maatverpakking EPE", desc: "Op maat gemaakte schuimverpakking", price: 23.00 },
    ],
  },
  {
    category: "Extra diensten",
    icon: "✨",
    items: [
      { id: "video", label: "Productvideo", desc: "Korte video van het product", price: 20.00 },
      { id: "model_photo", label: "Modelfoto's", desc: "Product gefotografeerd op model", price: 30.00 },
      { id: "label_removal", label: "Label verwijderen", desc: "Originele labels verwijderen", price: 3.00 },
      { id: "ironing", label: "Strijkservice", desc: "Kleding strijkvrij maken", price: 20.00 },
      { id: "thread_trim", label: "Draadjes knippen", desc: "Losse draadjes verwijderen", price: 5.00 },
      { id: "split_order", label: "Order splitsen", desc: "Bestelling opsplitsen", price: 2.00 },
    ],
  },
];

// Reiskaart: de route van fabriek (China) naar jouw huis, met checkpoints.
// Tik op een checkpoint om je orders op die fase te filteren.
const journeyStops = [
  { key: "requested", label: "Request completed", Icon: Factory, statuses: ["requested"], x: 11, y: 18 },
  { key: "quote_sent", label: "Pay quote", Icon: CreditCard, statuses: ["quote_sent"], x: 36, y: 10 },
  { key: "quote_accepted", label: "Purchasing product", Icon: ShoppingBag, statuses: ["quote_accepted"], x: 62, y: 16 },
  { key: "purchased", label: "Purchase successful", Icon: PackageCheck, statuses: ["purchased"], x: 86, y: 26 },
  { key: "shipped_local", label: "In transit in China", Icon: Truck, statuses: ["shipped_local"], x: 72, y: 50 },
  { key: "qc_pending", label: "QC photos ready!", Icon: Camera, statuses: ["qc_pending"], x: 46, y: 56 },
  { key: "shipped_international", label: "In transit", Icon: Plane, statuses: ["shipped_international"], x: 20, y: 52 },
  { key: "delivered", label: "Delivered", Icon: Home, statuses: ["delivered"], x: 13, y: 84, home: true },
];

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
        <img src={images[current]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
function RequestListSheet({ items, onRemove, onClose, onSend, sending, error }) {
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }} />
      <motion.div layoutId="request-list-morph" transition={springMorph}
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#111111", borderRadius: "24px 24px 0 0", zIndex: 301, maxHeight: "88vh", overflowY: "auto" }}>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.18 } }} exit={{ opacity: 0, transition: { duration: 0.08 } }}
          style={{ padding: "20px 20px 40px" }}>
          <div onClick={onClose} style={{ padding: "0 0 12px", cursor: "pointer" }}>
            <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, margin: "0 auto" }} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 14 }}>📋 Request list ({items.length})</div>

          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 16 }}>
            <span style={{ fontSize: 28, flexShrink: 0 }}>🦊</span>
            <SpeechBubble bg="#1E1D1A" color="#C9C6C1">
              <span style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                Smart move! Sending all your requests <b style={{ color: "#FF5C00" }}>in one go</b> means just <b style={{ color: "#FF5C00" }}>one service fee</b> (8%, min €5) over the whole bundle. Separate requests each get their own fee.
              </span>
            </SpeechBubble>
          </div>

          {items.map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, background: "#1A1917", borderRadius: 14, padding: "10px 12px", marginBottom: 8 }}>
              <div style={{ width: 46, height: 46, borderRadius: 10, background: "#fff", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {item.variant_image ? <img src={item.variant_image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <span style={{ fontSize: 20 }}>📦</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.product_title}</div>
                <div style={{ fontSize: 11.5, color: "#9C9893" }}>{item.qty} pcs{item.kleur ? ` · ${item.kleur}` : ""} · indicative €{Number(item.price).toFixed(2)}</div>
              </div>
              <motion.button whileTap={{ scale: 0.85 }} onClick={() => onRemove(i)}
                style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                <X size={13} color="#9C9893" />
              </motion.button>
            </div>
          ))}

          {error && (
            <div style={{ background: "#FEE2E2", color: "#DC2626", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginTop: 8 }}>{error}</div>
          )}

          <motion.button whileTap={sending ? undefined : { scale: 0.97 }} onClick={onSend} disabled={sending || items.length === 0}
            style={{ width: "100%", marginTop: 12, background: sending ? "#333" : "#FF5C00", color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontSize: 15, fontWeight: 700, cursor: sending ? "default" : "pointer", WebkitTapHighlightColor: "transparent" }}>
            {sending ? "Sending..." : `Send ${items.length} request${items.length > 1 ? "s" : ""} in one go →`}
          </motion.button>
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
            {loading ? <div style={{ textAlign: "center", padding: 20, color: "#aaa", fontSize: 13 }}>Laden...</div> :
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
    land: meta.land || "Nederland",
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
        <div style={{ marginBottom: 18 }}><label style={labelStyle}>Country</label><input style={inputStyle} value={form.land} onChange={e => set("land", e.target.value)} /></div>
        <motion.button whileTap={saving ? undefined : { scale: 0.97 }} onClick={save} disabled={saving}
          style={{ width: "100%", background: saving ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, cursor: saving ? "default" : "pointer", WebkitTapHighlightColor: "transparent" }}>
          {saving ? "Saving..." : "Save"}
        </motion.button>
      </motion.div>
    </>
  );
}

export default function SupplyFlow({ session }) {
  const [tab, setTab] = useState("feed");
  const [products, setProducts] = useState([]);
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
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [orders, setOrders] = useState([]);
  const [balance, setBalance] = useState(0);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [successProduct, setSuccessProduct] = useState(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [topupAmount, setTopupAmount] = useState("");
  const [haulItems, setHaulItems] = useState(() => {
    try {
      const saved = localStorage.getItem("supplyflow_haul");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem("supplyflow_haul", JSON.stringify(haulItems));
  }, [haulItems]);

  // Aanvraaglijst: items verzamelen en in één keer aanvragen (= één service fee).
  const [requestList, setRequestList] = useState(() => {
    try {
      const saved = localStorage.getItem("supplyflow_request_list");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [showRequestList, setShowRequestList] = useState(false);
  const [sendingList, setSendingList] = useState(false);
  const [listError, setListError] = useState(null);

  useEffect(() => {
    localStorage.setItem("supplyflow_request_list", JSON.stringify(requestList));
  }, [requestList]);

  const submitRequestList = async () => {
    if (!requestList.length || sendingList) return;
    setSendingList(true);
    setListError(null);
    const groupId = "SF-G-" + Date.now();
    const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    let payloads = requestList.map((item, i) => ({
      ...item,
      id: `SF-${Date.now()}-${i + 1}`,
      user_id: session.user.id,
      status: "requested",
      request_group_id: groupId,
      date,
    }));
    let { error } = await supabase.from("orders").insert(payloads);
    // Vangnet: kolommen die nog niet bestaan (SQL nog niet gedraaid) strippen en opnieuw.
    for (const col of ["request_group_id", "variant_image"]) {
      if (error && new RegExp(col, "i").test(error.message)) {
        payloads = payloads.map(({ [col]: _omit, ...rest }) => rest);
        ({ error } = await supabase.from("orders").insert(payloads));
      }
    }
    setSendingList(false);
    if (error) { setListError(error.message); return; }
    setRequestList([]);
    setShowRequestList(false);
    setOrderSuccess(true);
    fetchOrders();
  };

  useEffect(() => {
    async function fetchProducts() {
      setLoadingProducts(true); setProductsError(null);
      const { data, error } = await supabase.from("products").select("*").order("id");
      if (error) { setProductsError(error.message); } else { setProducts(data ?? []); }
      setLoadingProducts(false);
    }
    fetchProducts();
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
    await supabase.from("order_messages").insert({ order_id: selectedOrder.id, sender: "customer", message: "✕ I've cancelled my request." });
    await supabase.from("orders").update({ status: "cancelled", problem_type: null }).eq("id", selectedOrder.id);
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
    if (error) { alert("Upload mislukt: " + error.message); setAvatarUploading(false); return; }
    const { data } = supabase.storage.from("product-images").getPublicUrl(name);
    await supabase.auth.updateUser({ data: { avatar_url: data.publicUrl } });
    setAvatarUploading(false);
  };

  const warehouseCount = orders.filter(o => o.status === "qc_pending").length;
  const qcOrder = orders.find(o => o.status === "qc_pending");
  const avatarUrl = session?.user?.user_metadata?.avatar_url || null;

  // Meldingen afgeleid uit je orders: probleem, offerte klaar, agent reageerde, pakket bezorgd.
  const notifications = [
    ...orders.filter(o => o.problem_type).map(o => ({ icon: "⚠️", text: `Action needed: issue with ${o.product_title || o.product}`, order: o })),
    ...orders.filter(o => o.status === "quote_sent").map(o => ({ icon: "📋", text: `Quote received for ${o.product_title || o.product}`, order: o })),
    ...orders.filter(o => o.last_message_sender === "agent" && o.last_message_read === false).map(o => ({ icon: "💬", text: `Your agent replied (${o.product_title || o.product})`, order: o })),
    ...orders.filter(o => o.status === "delivered").map(o => ({ icon: "🎉", text: `${o.product_title || o.product} was delivered!`, order: o })),
  ];
  // Filter voor de reiskaart: een checkpoint kan meerdere statussen bundelen.
  const matchesFilter = (o) => orderFilter === "all" || (journeyStops.find(j => j.key === orderFilter)?.statuses || [orderFilter]).includes(o.status);

  // Alleen categorie-chips tonen waar echt producten in zitten — lege
  // categorieën blijven verborgen tot de admin er iets aan toevoegt.
  const presentCats = new Set(products.map(p => p.category).filter(Boolean));
  const visibleCategories = topCategories.filter(c => c === "All" || presentCats.has(c));
  const presentSubs = new Set(products.filter(p => p.category === "Clothes").map(p => p.subcategory).filter(Boolean));
  const visibleProducts = products.filter(p => {
    const matchCat =
      activeCategory === "All" ? true :
      activeCategory === "Clothes" ? (p.category === "Clothes" && (!activeSub || p.subcategory === activeSub)) :
      p.category === activeCategory;
    const q = search.trim().toLowerCase();
    const matchSearch = !q || (p.title || "").toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  return (
    <div style={{ fontFamily: "'Inter', 'Helvetica Neue', sans-serif", background: "#F8F7F4", minHeight: "100vh", maxWidth: 430, margin: "0 auto", width: "100%", position: "relative" }}>

      {/* Header */}
      <div style={{ padding: "16px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#111111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>🦊</div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2.5, color: "#111111" }}>FLOWVA</div>
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
                    <div key={i} onClick={() => { setShowNotifs(false); setTab("orders"); setSelectedOrder(n.order); }}
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
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6, color: "#111111", marginBottom: 2 }}>Discover</div>
          <div style={{ fontSize: 13.5, color: "#8A8780", marginBottom: 16 }}>From factory floor to your door.</div>
          <div style={{ background: "#F0EEE8", borderRadius: 15, padding: "12px 14px", display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
            <Search size={17} color="#8A8780" strokeWidth={2} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products by name..."
              style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 14, color: "#111111", fontFamily: "inherit" }} />
            {search ? (
              <X size={15} color="#8A8780" onClick={() => setSearch("")} style={{ cursor: "pointer" }} />
            ) : (
              <SlidersHorizontal size={15} color="#8A8780" onClick={() => setShowClothesPicker(true)} style={{ cursor: "pointer" }} />
            )}
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 18, paddingBottom: 4 }}>
            {visibleCategories.map((c) => {
              const active = activeCategory === c;
              const label = c === "Clothes" && activeSub ? `Clothes · ${activeSub}` : c;
              return (
                <motion.div key={c} layout whileTap={{ scale: 0.92 }} transition={springSnappy}
                  onClick={() => {
                    if (c === "Clothes") { setActiveCategory("Clothes"); setShowClothesPicker(true); }
                    else { setActiveCategory(c); setActiveSub(null); }
                  }}
                  style={{ position: "relative", display: "flex", alignItems: "center", gap: 5, padding: "8px 15px", borderRadius: 20, background: active ? "transparent" : "#fff", color: active ? "#fff" : "#555", fontSize: 13, fontWeight: active ? 600 : 500, border: "1px solid " + (active ? "transparent" : "#ECEAE5"), whiteSpace: "nowrap", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                  {/* Glijdend pilletje achter de actieve chip — zelfde patroon als de bottom-nav */}
                  {active && (
                    <motion.div layoutId="catPill" transition={springSnappy}
                      style={{ position: "absolute", inset: 0, background: "#111111", borderRadius: 20, zIndex: 0 }} />
                  )}
                  <span style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 5 }}>
                    {label}{c === "Clothes" && <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>}
                  </span>
                </motion.div>
              );
            })}
          </div>
          {loadingProducts && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>Loading products...</div>}
          {productsError && <div style={{ textAlign: "center", padding: 40, color: "#B45309" }}>Couldn't load products: {productsError}</div>}
          {!loadingProducts && !productsError && products.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>No products found</div>}
          {!loadingProducts && !productsError && products.length > 0 && visibleProducts.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>No results found</div>}
          {!loadingProducts && !productsError && visibleProducts.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {/* popLayout: kaarten faden in/uit bij categoriewissel en de rest
                  schuift met een spring naar z'n nieuwe plek */}
              <AnimatePresence mode="popLayout" initial={false}>
              {visibleProducts.map(p => (
                <motion.div key={p.id} layout layoutId={`card-${p.id}`}
                  initial={{ opacity: 0, scale: 0.92, y: 14 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.16, ease: [0.32, 0.72, 0, 1] } }}
                  onClick={() => { if (!session) { alert("Log in to order!"); return; } setSelectedProduct(p); }}
                  whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}
                  transition={springMorph}
                  style={{ background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 2px rgba(17,17,17,0.04), 0 6px 18px rgba(17,17,17,0.05)", cursor: "pointer" }}>
                  <div style={{ position: "relative" }}>
                    <motion.div layoutId={`pimg-${p.id}`} transition={springMorph} style={{ background: "#fff", height: 160, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48, overflow: "hidden" }}>
                      {p.image?.startsWith("http") ? <img src={p.image} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : p.image}
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
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#111111" }}>€{Number(p.price).toFixed(2)}</div>
                      {Number(p.rating) > 0
                        ? <div style={{ fontSize: 11.5, fontWeight: 600, color: "#111111" }}>★ {Number(p.rating).toFixed(1)}</div>
                        : <div style={{ fontSize: 11, color: "#A8A5A0" }}>MOQ {p.moq}</div>}
                    </div>
                  </div>
                </motion.div>
              ))}
              </AnimatePresence>
            </div>
          )}
        </motion.div>
      )}

      {/* ORDERS TAB */}
      {tab === "orders" && !selectedOrder && (
        <motion.div key="orders-list" {...pageTransition} style={{ paddingBottom: 80, width: "100%" }}>
          <TreasureMap activeFilter={orderFilter} onSelect={setOrderFilter} orders={orders} />
          <div style={{ padding: "16px 20px" }}>
            {orders.filter(matchesFilter).map(order => {
              const s = statusConfig[order.status] || statusConfig.requested;
              const agentReplied = order.last_message_sender === "agent" && order.last_message_read === false;
              const customerWaiting = order.last_message_sender === "customer" && order.last_message_read === false;
              const hasMessage = agentReplied || customerWaiting;
              return (
                <motion.div key={order.id}
                  whileTap={{ scale: 0.985 }} whileHover={{ y: -2 }} transition={springSnappy}
                  style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: "14px 16px", marginBottom: 10, cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                    onClick={() => { setSelectedOrder(order); setConfirmCancel(false); }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: "#aaa", marginBottom: 3 }}>{order.id} · {order.qty} pcs</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", marginBottom: 6 }}>{order.product_title || order.product}</div>
                      <div style={{ display: "inline-block", background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20 }}>{s.label}</div>
                      {order.problem_type && (
                        <div style={{ display: "inline-block", background: "#FFF7ED", color: "#B45309", border: "1px solid #F59E0B", fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20, marginLeft: 6 }}>⚠️ Action needed</div>
                      )}
                      {/* Chat status onder de badge */}
                      {agentReplied && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                          <span style={{ fontSize: 14 }}>💬</span>
                          <span style={{ fontSize: 12, color: "#6366F1", fontWeight: 700 }}>Agent heeft gereageerd</span>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#6366F1", display: "inline-block" }} />
                        </div>
                      )}
                      {customerWaiting && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                          <span style={{ fontSize: 14 }}>💬</span>
                          <span style={{ fontSize: 12, color: "#888" }}>Bericht nog niet gelezen door agent</span>
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      {agentReplied && (
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#6366F1" }} />
                      )}
                      <div style={{ color: "#ccc", fontSize: 18 }}>→</div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
            {orders.filter(matchesFilter).length === 0 && (
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
                    <img src={orderImage} alt="your order" style={{ width: "100%", aspectRatio: "1", objectFit: "contain", display: "block" }} />
                    <div style={{ position: "absolute", top: 8, left: 8, background: "#0F0E0C", color: "#FF5C00", fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 20 }}>
                      Your order{selectedOrder.kleur ? ` · ${selectedOrder.kleur}` : ""}
                    </div>
                  </motion.div>
                ) : null;
              })()}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {selectedOrder.qc_images.map((url, i) => (
                  <div key={i} style={{ borderRadius: 12, overflow: "hidden", aspectRatio: "1", position: "relative" }}>
                    <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    {i === 3 && <div style={{ position: "absolute", bottom: 6, left: 6, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 10, padding: "2px 6px", borderRadius: 6 }}>⚖️ Weight</div>}
                  </div>
                ))}
              </div>
              {selectedOrder.weight_grams && (
                <div style={{ marginTop: 10, background: "#F0FDF4", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#065F46", fontWeight: 600 }}>
                  ⚖️ Weight: {selectedOrder.weight_grams}g · ~€{((selectedOrder.weight_grams / 1000) * 10).toFixed(2)} shipping
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
          <WarehouseTab session={session} haulItems={haulItems} setHaulItems={setHaulItems} />
        </motion.div>
      )}

      {/* TRANSIT TAB */}
      {tab === "transit" && (
        <motion.div key="transit" {...pageTransition}>
          <TransitTab session={session} orders={orders} />
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
                {avatarUrl ? <img src={avatarUrl} alt="profielfoto" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "🦊"}
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
          <PushToggle session={session} />
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
          <button onClick={() => supabase.auth.signOut()} style={{ width: "100%", background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Log out</button>
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
            onAddToList={(item) => { setRequestList(list => [...list, item]); setSelectedProduct(null); }} />
        )}
      </AnimatePresence>

      {/* Zwevende aanvraaglijst-balk: morpht open naar de zwarte lijst-sheet
          (zelfde layoutId — het balkje IS de dichtgevouwen lijst) */}
      <AnimatePresence>
        {requestList.length > 0 && !showRequestList && !selectedProduct && (
          <motion.div layoutId="request-list-morph" transition={springMorph}
            onClick={() => { setListError(null); setShowRequestList(true); }}
            style={{ position: "fixed", bottom: 78, left: 0, right: 0, margin: "0 auto", width: "calc(100% - 40px)", maxWidth: 390, background: "#111111", borderRadius: 16, overflow: "hidden", cursor: "pointer", zIndex: 301, boxShadow: "0 12px 40px rgba(17,17,17,0.35)" }}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.1, duration: 0.16 } }} exit={{ opacity: 0, transition: { duration: 0.08 } }}
              style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 18 }}>📋</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Request list · {requestList.length} item{requestList.length > 1 ? "s" : ""}</div>
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
            onClose={() => setShowRequestList(false)}
            onSend={submitRequestList}
            sending={sendingList}
            error={listError}
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
                Request →
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
            <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
              style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#0F0E0C", borderRadius: "24px 24px 0 0", zIndex: 201, padding: "32px 24px 48px" }}>
              <div style={{ width: 36, height: 4, background: "#333", borderRadius: 2, margin: "0 auto 24px" }} />
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ fontSize: 56, marginBottom: 16 }}>🦊</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#FF5C00", marginBottom: 8 }}>Request sent!</div>
                <div style={{ fontSize: 14, color: "#888", lineHeight: 1.6 }}>
                  Our agent will get started right away:
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
                {[
                  { icon: "🔍", text: "Checking if the product is still in stock" },
                  { icon: "📏", text: "Verifying your size/variant is available" },
                  { icon: "💰", text: "Confirming the exact price" },
                  { icon: "🚚", text: "Calculating local shipping costs" },
                  { icon: "📋", text: "Sending you a quote" },
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, background: "#1A1917", borderRadius: 10, padding: "10px 14px" }}>
                    <span style={{ fontSize: 18 }}>{item.icon}</span>
                    <span style={{ fontSize: 13, color: "#CCC" }}>{item.text}</span>
                  </div>
                ))}
              </div>
              <motion.button whileTap={{ scale: 0.97 }}
                onClick={() => { setSuccessProduct(null); setOrderSuccess(false); setTab("orders"); setSelectedOrder(null); }}
                style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                View your request in Orders →
              </motion.button>
              <button onClick={() => { setSuccessProduct(null); setOrderSuccess(false); }}
                style={{ width: "100%", background: "transparent", color: "#888", border: "none", padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 6 }}>
                Back to feed
              </button>
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
                    { Icon: ShoppingBag, label: "Request", sub: "Request a quote", accent: true, show: true,
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
                const subs = clothesCategories.flatMap(g => g.items).filter(s => presentSubs.has(s));
                if (subs.length === 0) {
                  return <div style={{ textAlign: "center", padding: "24px 0", color: "#aaa", fontSize: 13 }}>🦊 No subcategories yet — they appear as products are added.</div>;
                }
                return (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {subs.map((it) => {
                      const sel = activeSub === it;
                      return (
                        <motion.button key={it} whileTap={{ scale: 0.9 }} transition={springSnappy}
                          onClick={() => { setActiveSub(it); setActiveCategory("Clothes"); setShowClothesPicker(false); }}
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
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "#fff", borderTop: "1px solid #ECEAE5", display: "flex", padding: "9px 0 15px" }}>
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
