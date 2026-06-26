import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { motion } from "framer-motion";
import { problemTypes } from "./problemTypes";
import { toEnglish, toChinese, hasChinese } from "./translate";

const statusSteps = [
  { key: "requested",       label: "Request received 收到请求",     icon: "🛒", desc: "Check stock, price & shipping 检查库存、价格和运费" },
  { key: "quote_sent",      label: "Quote sent 已发送报价",       icon: "📋", desc: "Waiting for payment 等待客户付款" },
  { key: "quote_accepted",  label: "Paid by customer 客户已付款",      icon: "💰", desc: "Money on its way via Wise 货款转账中" },
  { key: "purchased",       label: "Purchased in China 已下单",        icon: "✅", desc: "Product bought on 1688 已在1688购买" },
  { key: "shipped_local",   label: "In transit in China 境内运输中",       icon: "🚚", desc: "On its way to the warehouse 运往仓库" },
  { key: "qc_pending",      label: "QC photos uploaded 质检照片已上传",      icon: "📸", desc: "Waiting for customer 等待客户" },
];

function ChatPanel({ order, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [displayTx, setDisplayTx] = useState({});
  const bottomRef = useRef(null);

  // Vangnet: Engelse klantberichten zonder opgeslagen vertaling alsnog
  // naar het Chinees vertalen bij weergave, en bewaren.
  useEffect(() => {
    messages.forEach(async (m) => {
      if (m.sender === "customer" && !m.message_translated && !hasChinese(m.message) && !displayTx[m.id]) {
        const t = await toChinese(m.message);
        if (t) {
          setDisplayTx(prev => ({ ...prev, [m.id]: t }));
          supabase.from("order_messages").update({ message_translated: t }).eq("id", m.id).then(() => {});
        }
      }
    });
  }, [messages]);

  useEffect(() => {
    fetchMessages();
    const channel = supabase
      .channel(`chat-agent-${order.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "order_messages", filter: `order_id=eq.${order.id}` },
        (payload) => setMessages(prev => [...prev, payload.new]))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [order.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const fetchMessages = async () => {
    const { data } = await supabase.from("order_messages").select("*").eq("order_id", order.id).order("created_at");
    setMessages(data || []);
    // Markeer als gelezen door agent
    await supabase.from("orders").update({ last_message_read: true }).eq("id", order.id);
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    const msg = input.trim(); setInput("");
    // Chinees getypt? Vertaal naar het Engels zodat de klant het kan lezen.
    const translated = hasChinese(msg) ? await toEnglish(msg) : null;
    let { error } = await supabase.from("order_messages").insert({ order_id: order.id, sender: "agent", message: msg, message_translated: translated });
    if (error && /message_translated/i.test(error.message)) {
      await supabase.from("order_messages").insert({ order_id: order.id, sender: "agent", message: msg });
    }
    // Update order met laatste bericht info
    await supabase.from("orders").update({
      last_message_sender: "agent",
      last_message_read: false,
    }).eq("id", order.id);
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ background: "#0F0E0C", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ color: "#FF5C00", fontSize: 13, fontWeight: 700 }}>Chat with customer 与客户聊天</div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      <div style={{ height: 200, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.length === 0 && <div style={{ textAlign: "center", color: "#aaa", fontSize: 13, padding: "20px 0" }}>No messages yet 暂无消息</div>}
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.sender === "agent" ? "flex-end" : "flex-start" }}>
            <div style={{ background: m.sender === "agent" ? "#0F0E0C" : "#F8F7F4", color: m.sender === "agent" ? "#FF5C00" : "#333", padding: "8px 12px", borderRadius: 10, fontSize: 13, maxWidth: "80%" }}>
              <div>{m.message}</div>
              {m.sender === "customer" && (m.message_translated || displayTx[m.id]) && (
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
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMessage()}
          placeholder="输入消息… (type a message)"
          style={{ flex: 1, border: "1px solid #E8E6E0", borderRadius: 8, padding: "8px 12px", fontSize: 13, background: "#F8F7F4" }} />
        <button onClick={sendMessage} style={{ background: "#FF5C00", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>→</button>
      </div>
    </div>
  );
}

function OrderDetail({ order: initialOrder, onBack, onUpdate }) {
  const [order, setOrder] = useState(initialOrder);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [weight, setWeight] = useState(order.weight_grams?.toString() || "");
  const [eurRate, setEurRate] = useState(0.13);

  // Quote velden
  const [quotedPrice, setQuotedPrice] = useState(order.quoted_price?.toString() || "");
  const [quotedLocalShipping, setQuotedLocalShipping] = useState(order.quoted_local_shipping?.toString() || "");
  const [quoteNote, setQuoteNote] = useState(order.quote_note || "");
  const [defectNote, setDefectNote] = useState(order.agent_notitie || "");
  const [defectUploading, setDefectUploading] = useState(false);

  const quotedPriceEur = quotedPrice ? parseFloat(quotedPrice) * eurRate : 0;
  const quotedLocalShippingEur = quotedLocalShipping ? parseFloat(quotedLocalShipping) * eurRate : 0;
  const quotedTotal = quotedPrice && quotedLocalShipping
    ? (quotedPriceEur + quotedLocalShippingEur).toFixed(2)
    : null;

  useEffect(() => {
    fetch(`https://v6.exchangerate-api.com/v6/${import.meta.env.VITE_EXCHANGE_API_KEY}/latest/CNY`)
      .then(r => r.json()).then(d => { if (d.conversion_rates?.EUR) setEurRate(d.conversion_rates.EUR); });
  }, []);

  const currentStep = statusSteps.findIndex(s => s.key === order.status);

  const sendQuote = async () => {
    if (!quotedPrice) { alert("Enter the exact product price! 请填写产品价格"); return; }
    if (!quotedLocalShipping) { alert("Enter the local shipping costs! 请填写境内运费"); return; }
    setSaving(true);
    const total = (parseFloat(quotedPrice) * eurRate) + (parseFloat(quotedLocalShipping) * eurRate);
    const { error } = await supabase.from("orders").update({
      status: "quote_sent",
      quoted_price: parseFloat(quotedPrice),
      quoted_local_shipping: parseFloat(quotedLocalShipping),
      quoted_total: total,
      quote_note: quoteNote,
      quote_sent_at: new Date().toISOString(),
    }).eq("id", order.id);
    if (!error) {
      const updated = { ...order, status: "quote_sent", quoted_price: parseFloat(quotedPrice), quoted_local_shipping: parseFloat(quotedLocalShipping), quoted_total: total, quote_note: quoteNote };
      setOrder(updated);
      onUpdate(updated);
    }
    setSaving(false);
  };

  // Meld een probleem met één tik: vlag op de order + automatisch chatbericht.
  const reportProblem = async (type) => {
    setSaving(true);
    const p = problemTypes[type];
    const { error } = await supabase.from("orders").update({
      problem_type: type,
      last_message_sender: "agent",
      last_message_read: false,
    }).eq("id", order.id);
    if (!error) {
      await supabase.from("order_messages").insert({ order_id: order.id, sender: "agent", message: `⚠️ ${p.msg}` });
      const updated = { ...order, problem_type: type };
      setOrder(updated);
      onUpdate(updated);
    } else {
      alert("Couldn't report the issue: " + error.message);
    }
    setSaving(false);
  };

  const clearProblem = async () => {
    setSaving(true);
    const { error } = await supabase.from("orders").update({ problem_type: null }).eq("id", order.id);
    if (!error) {
      await supabase.from("order_messages").insert({ order_id: order.id, sender: "agent", message: "✓ The issue is resolved — continuing with your request!" });
      const updated = { ...order, problem_type: null };
      setOrder(updated);
      onUpdate(updated);
    }
    setSaving(false);
  };

  const updateStatus = async (newStatus) => {
    if (newStatus === "qc_pending" && !weight) { alert("Enter the weight first! 请先填写重量"); return; }
    if (newStatus === "qc_pending" && (!order.qc_images || order.qc_images.length < 4)) { alert("Upload at least 4 QC photos! 请上传至少4张质检照片"); return; }
    setSaving(true);
    const updates = { status: newStatus };
    if (newStatus === "qc_pending") {
      updates.weight_grams = parseFloat(weight);
      updates.arrived_at = new Date().toISOString();
    }
    const { error } = await supabase.from("orders").update(updates).eq("id", order.id);
    if (!error) {
      const updated = { ...order, ...updates };
      setOrder(updated);
      onUpdate(updated);
    }
    setSaving(false);
  };

  const uploadQcImages = async (files) => {
    setUploading(true);
    const urls = [];
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop();
      const fileName = `qc-${order.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(fileName, file);
      if (!error) {
        const { data } = supabase.storage.from("product-images").getPublicUrl(fileName);
        urls.push(data.publicUrl);
      }
    }
    const existing = order.qc_images || [];
    const allUrls = [...existing, ...urls];
    await supabase.from("orders").update({ qc_images: allUrls }).eq("id", order.id);
    const updated = { ...order, qc_images: allUrls };
    setOrder(updated);
    onUpdate(updated);
    setUploading(false);
  };

  const removeQcImage = async (i) => {
    const updated = (order.qc_images || []).filter((_, idx) => idx !== i);
    await supabase.from("orders").update({ qc_images: updated }).eq("id", order.id);
    const u = { ...order, qc_images: updated };
    setOrder(u); onUpdate(u);
  };

  const uploadDefectImages = async (files) => {
    setDefectUploading(true);
    const urls = [];
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop();
      const fileName = `defect-${order.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(fileName, file);
      if (!error) {
        const { data } = supabase.storage.from("product-images").getPublicUrl(fileName);
        urls.push(data.publicUrl);
      }
    }
    const all = [...(order.agent_defect_images || []), ...urls];
    await supabase.from("orders").update({ agent_defect_images: all }).eq("id", order.id);
    const u = { ...order, agent_defect_images: all };
    setOrder(u); onUpdate(u);
    setDefectUploading(false);
  };

  const removeDefectImage = async (i) => {
    const updated = (order.agent_defect_images || []).filter((_, idx) => idx !== i);
    await supabase.from("orders").update({ agent_defect_images: updated }).eq("id", order.id);
    const u = { ...order, agent_defect_images: updated };
    setOrder(u); onUpdate(u);
  };

  const flagDefect = async () => {
    const note = defectNote.trim() || null;
    const { error } = await supabase.from("orders").update({ dispute_status: "bucky_flagged", problem_type: "defect", agent_notitie: note }).eq("id", order.id);
    if (error) { alert("Could not flag 无法标记: " + error.message); return; }
    const u = { ...order, dispute_status: "bucky_flagged", problem_type: "defect", agent_notitie: note };
    setOrder(u); onUpdate(u);
  };

  const clearDefectFlag = async () => {
    const { error } = await supabase.from("orders").update({ dispute_status: null, problem_type: null }).eq("id", order.id);
    if (error) { alert("Could not clear 无法清除: " + error.message); return; }
    const u = { ...order, dispute_status: null, problem_type: null };
    setOrder(u); onUpdate(u);
  };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#F8F7F4", minHeight: "100vh", maxWidth: 430, margin: "0 auto" }}>
      <div style={{ background: "#0F0E0C", padding: "20px 20px 16px" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#888", fontSize: 14, cursor: "pointer", padding: 0, marginBottom: 8 }}>← Back</button>
        <div style={{ color: "#FF5C00", fontSize: 11, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase" }}>Order detail</div>
        <div style={{ color: "#fff", fontSize: 18, fontWeight: 700, marginTop: 4 }}>{order.product_title || order.product}</div>
        <div style={{ color: "#888", fontSize: 13, marginTop: 2 }}>{order.id} · {order.qty} pcs</div>
        {order.kleur && <div style={{ color: "#888", fontSize: 12, marginTop: 2 }}>Variants 款式: {order.kleur}</div>}
        {order.source_url && (
          <a href={order.source_url} target="_blank" rel="noreferrer"
            style={{ display: "inline-block", marginTop: 10, background: "#FF5C00", color: "#fff", fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 8, textDecoration: "none" }}>
            Open on {order.platform || "1688"} →
          </a>
        )}
      </div>

      <div style={{ padding: "16px 20px 32px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Status timeline */}
        <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 12 }}>Status</div>
          {statusSteps.map((step, i) => {
            const isDone = i < currentStep;
            const isCurrent = i === currentStep;
            return (
              <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: i < statusSteps.length - 1 ? "1px solid #F0EEE8" : "none" }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: isDone ? "#0F0E0C" : isCurrent ? "#FF5C00" : "#F0EEE8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                  {isDone ? "✓" : step.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: isDone ? "#10B981" : isCurrent ? "#0F0E0C" : "#bbb" }}>{step.label}</div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>{step.desc}</div>
                </div>
                {isCurrent && <div style={{ background: "#FF5C00", color: "#fff", fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 10 }}>Now</div>}
              </div>
            );
          })}
        </div>

        {/* OFFERTE FORMULIER - alleen bij requested */}
        {order.status === "requested" && (
          <div style={{ background: "#fff", border: "1.5px solid #FF5C00", borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>📋 Create quote 创建报价</div>
            <div style={{ fontSize: 12, color: "#aaa", marginBottom: 14 }}>Check stock & price on 1688, then fill in the exact amounts 检查后填写准确金额</div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6 }}>Exact product price (¥ Yuan) 产品价格</div>
              <input type="number" step="0.01" placeholder="e.g. 85" value={quotedPrice} onChange={e => {
                setQuotedPrice(e.target.value);
              }}
                style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 14, boxSizing: "border-box", background: "#F8F7F4" }} />
              {quotedPrice && <div style={{ fontSize: 11, color: "#10B981", marginTop: 4 }}>≈ €{(parseFloat(quotedPrice) * eurRate).toFixed(2)} EUR</div>}
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>Price stated at request: €{parseFloat(order.price || 0).toFixed(2)}</div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6 }}>Local shipping China (¥) 境内运费</div>
              <input type="number" step="0.01" placeholder="e.g. 15" value={quotedLocalShipping} onChange={e => setQuotedLocalShipping(e.target.value)}
                style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 14, boxSizing: "border-box", background: "#F8F7F4" }} />
              {quotedLocalShipping && <div style={{ fontSize: 11, color: "#10B981", marginTop: 4 }}>≈ €{(parseFloat(quotedLocalShipping) * eurRate).toFixed(2)} EUR</div>}
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6 }}>Note for customer (optional) 给客户的备注</div>
              <textarea placeholder="e.g. Size L sold out, size M available. Or: price increased slightly."
                value={quoteNote} onChange={e => setQuoteNote(e.target.value)}
                style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, background: "#F8F7F4", minHeight: 70, resize: "vertical", boxSizing: "border-box" }} />
            </div>

            {quotedTotal && (
              <div style={{ background: "#0F0E0C", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "#888" }}>Product price</span>
                  <span style={{ fontSize: 12, color: "#fff" }}>¥{quotedPrice} (€{quotedPriceEur.toFixed(2)})</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: "#888" }}>Local shipping</span>
                  <span style={{ fontSize: 12, color: "#fff" }}>¥{quotedLocalShipping} (€{quotedLocalShippingEur.toFixed(2)})</span>
                </div>
                <div style={{ borderTop: "1px solid #333", paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#FF5C00" }}>Customer pays total 客户支付总额</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#FF5C00" }}>€{quotedTotal}</span>
                </div>
              </div>
            )}

            <button onClick={sendQuote} disabled={saving}
              style={{ width: "100%", background: saving ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700, cursor: saving ? "default" : "pointer" }}>
              {saving ? "Sending..." : "📋 Send quote to customer 发送报价 →"}
            </button>
          </div>
        )}

        {/* PROBLEEM MELDEN - tot en met betaald (daarna is het gekocht) */}
        {["requested", "quote_sent", "quote_accepted"].includes(order.status) && (
          order.problem_type ? (
            <div style={{ background: "#FFF7ED", border: "1.5px solid #F59E0B", borderRadius: 14, padding: 16, marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#B45309", marginBottom: 6 }}>
                ⚠️ Issue reported 已报告: {problemTypes[order.problem_type]?.icon} {problemTypes[order.problem_type]?.label || order.problem_type}
              </div>
              <div style={{ fontSize: 12, color: "#92400E", lineHeight: 1.5, marginBottom: 10 }}>
                The customer received a message and can respond or cancel. 客户已收到消息，可回复或取消。
              </div>
              <button onClick={clearProblem} disabled={saving}
                style={{ width: "100%", background: "#fff", color: "#B45309", border: "1px solid #F59E0B", borderRadius: 10, padding: "10px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                ✓ Issue resolved — continue 问题已解决
              </button>
            </div>
          ) : (
            <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16, marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>⚠️ Report an issue 报告问题</div>
              <div style={{ fontSize: 12, color: "#aaa", marginBottom: 12 }}>One tap — the customer gets an automatic message and can respond or cancel 一键通知客户</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {Object.entries(problemTypes).map(([key, p]) => {
                  const zh = { out_of_stock: "缺货", variant_unavailable: "尺码/款式无货", price_changed: "价格有变", link_broken: "链接失效" }[key];
                  return (
                    <button key={key} onClick={() => reportProblem(key)} disabled={saving}
                      style={{ background: "#F8F7F4", color: "#0F0E0C", border: "1px solid #E8E6E0", borderRadius: 10, padding: "10px 8px", fontSize: 12, fontWeight: 600, cursor: "pointer", textAlign: "center" }}>
                      {p.icon} {p.label}
                      <div style={{ fontSize: 11, color: "#999", fontWeight: 500, marginTop: 2 }}>{zh}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )
        )}

        {/* OFFERTE VERSTUURD - wacht op betaling */}
        {order.status === "quote_sent" && (
          <div style={{ background: "#F0FDF4", border: "1.5px solid #10B981", borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#065F46", marginBottom: 8 }}>✓ Quote sent 已发送报价</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: "#666" }}>Product price</span>
              <span style={{ fontSize: 12, fontWeight: 600 }}>€{order.quoted_price?.toFixed(2)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: "#666" }}>Local shipping</span>
              <span style={{ fontSize: 12, fontWeight: 600 }}>¥{order.quoted_local_shipping}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, borderTop: "1px solid #D1FAE5" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#065F46" }}>Total</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#065F46" }}>€{order.quoted_total?.toFixed(2)}</span>
            </div>
            {order.quote_note && <div style={{ marginTop: 8, fontSize: 12, color: "#666", fontStyle: "italic" }}>"{order.quote_note}"</div>}
            <div style={{ marginTop: 10, fontSize: 12, color: "#10B981", fontWeight: 600 }}>⏳ Waiting for customer payment 等待付款…</div>
          </div>
        )}

        {/* BETAALD - agent kan inkopen */}
        {order.status === "quote_accepted" && (
          <div style={{ background: "#fff", border: "1.5px solid #FF5C00", borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 8 }}>💰 Customer has paid! 客户已付款</div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 14 }}>
              {order.problem_type
                ? "⚠️ An issue is open — wait for the customer's reply before purchasing. 请等客户回复后再采购。"
                : "Money is on its way via Wise. Purchase on 1688 now. 请现在去1688采购。"}
            </div>
            <button onClick={() => updateStatus("purchased")} disabled={saving || !!order.problem_type}
              style={{ width: "100%", background: saving || order.problem_type ? "#E8E6E0" : "#FF5C00", color: saving || order.problem_type ? "#999" : "#0F0E0C", border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700, cursor: saving || order.problem_type ? "default" : "pointer" }}>
              {saving ? "Saving..." : order.problem_type ? "Blocked — issue open 已锁定" : "✅ Purchased on 1688 已下单 →"}
            </button>
          </div>
        )}

        {/* PURCHASED → SHIPPED_LOCAL */}
        {order.status === "purchased" && (
          <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 12 }}>Product shipped to the warehouse? 已发往仓库？</div>
            <button onClick={() => updateStatus("shipped_local")} disabled={saving}
              style={{ width: "100%", background: saving ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700, cursor: saving ? "default" : "pointer" }}>
              {saving ? "Saving..." : "🚚 Markeer als: In transit in China 境内运输中 →"}
            </button>
          </div>
        )}

        {/* QC FOTO's + GEWICHT */}
        {order.status === "shipped_local" && (
          <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>Upload QC photos 上传质检照片</div>
            <div style={{ fontSize: 11, color: "#aaa", marginBottom: 12 }}>Upload 3 product photos + 1 photo on the scale 三张产品照+一张称重照</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              {[0, 1, 2, 3].map(slot => {
                const url = order.qc_images?.[slot];
                const label = slot === 3 ? "⚖️ Weegschaal" : `📷 Foto ${slot + 1}`;
                return (
                  <div key={slot} style={{ position: "relative", borderRadius: 10, overflow: "hidden", aspectRatio: "1", background: "#F8F7F4", border: `1.5px dashed ${url ? "#10B981" : "#E8E6E0"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {url ? (
                      <>
                        <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        <button onClick={() => removeQcImage(slot)} style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: 6, width: 22, height: 22, fontSize: 11, cursor: "pointer" }}>✕</button>
                      </>
                    ) : (
                      <label style={{ cursor: "pointer", textAlign: "center", padding: 8 }}>
                        <div style={{ fontSize: 11, color: "#aaa" }}>{label}</div>
                        <input type="file" accept="image/*" onChange={e => uploadQcImages(e.target.files)} style={{ display: "none" }} disabled={uploading} />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 6 }}>Weight (grams) 重量（克）</div>
            <input type="number" placeholder="bijv. 350" value={weight} onChange={e => setWeight(e.target.value)}
              style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 14, boxSizing: "border-box", background: "#F8F7F4", marginBottom: 12 }} />

            <button onClick={() => updateStatus("qc_pending")} disabled={saving || uploading}
              style={{ width: "100%", background: saving || uploading ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700, cursor: saving || uploading ? "default" : "pointer" }}>
              {saving ? "Saving..." : uploading ? "Uploading..." : "📸 QC uploaded — send to customer 发送给客户 →"}
            </button>
          </div>
        )}

        {/* QC KLAAR */}
        {order.status === "qc_pending" && (
          <div style={{ background: "#F0FDF4", border: "1px solid #10B981", borderRadius: 12, padding: "12px 16px", fontSize: 13, color: "#065F46", textAlign: "center" }}>
            ✓ QC uploaded — waiting for customer to build parcel 等待客户组合包裹
          </div>
        )}

        {/* DEFECT melden aan de klant (agent) */}
        {(order.status === "shipped_local" || order.status === "qc_pending") && (
          <div style={{ background: "#fff", border: `1.5px solid ${order.dispute_status === "bucky_flagged" ? "#F59E0B" : "#E8E6E0"}`, borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>⚠️ Report a defect 报告缺陷</div>
            <div style={{ fontSize: 11, color: "#aaa", marginBottom: 12 }}>Add close-up photos + a message. The customer can then return or accept it. 添加缺陷照片和留言，客户可退货或接受</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
              {(order.agent_defect_images || []).map((url, i) => (
                <div key={i} style={{ position: "relative", borderRadius: 10, overflow: "hidden", aspectRatio: "1" }}>
                  <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button onClick={() => removeDefectImage(i)} style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: 6, width: 22, height: 22, fontSize: 11, cursor: "pointer" }}>✕</button>
                </div>
              ))}
              <label style={{ cursor: "pointer", borderRadius: 10, aspectRatio: "1", background: "#F8F7F4", border: "1.5px dashed #E8E6E0", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 8 }}>
                <div style={{ fontSize: 11, color: "#aaa" }}>{defectUploading ? "Uploading…" : "📷 + Add 添加"}</div>
                <input type="file" accept="image/*" multiple onChange={e => uploadDefectImages(e.target.files)} style={{ display: "none" }} disabled={defectUploading} />
              </label>
            </div>
            <textarea placeholder="Message to the customer — what's wrong? 给客户的留言" value={defectNote} onChange={e => setDefectNote(e.target.value)}
              style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, background: "#F8F7F4", minHeight: 70, resize: "vertical", boxSizing: "border-box", marginBottom: 12 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={flagDefect} disabled={defectUploading}
                style={{ flex: 1, background: "#F59E0B", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                {order.dispute_status === "bucky_flagged" ? "Update defect 更新缺陷" : "⚠️ Flag defect 标记缺陷"}
              </button>
              {order.dispute_status === "bucky_flagged" && (
                <button onClick={clearDefectFlag}
                  style={{ background: "#F8F7F4", color: "#555", border: "1px solid #E8E6E0", borderRadius: 10, padding: "12px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                  Clear 清除
                </button>
              )}
            </div>
            {order.dispute_status === "bucky_flagged" && (
              <div style={{ marginTop: 10, fontSize: 12, color: "#B45309", fontWeight: 600 }}>✓ Flagged — the customer will choose return or accept. 已标记，客户将选择退货或接受</div>
            )}
          </div>
        )}

        {/* Dispute melding */}
        {order.dispute_status === "pending" && (
          <div style={{ background: "#FEF3C7", border: "1.5px solid #F59E0B", borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#B45309", marginBottom: 6 }}>⚠️ Customer reported a problem 客户报告了问题</div>
            <div style={{ fontSize: 13, color: "#92400E" }}>{order.dispute_description}</div>
            {order.dispute_images?.length > 0 && (
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {order.dispute_images.map((url, i) => (
                  <img key={i} src={url} alt="" style={{ width: 60, height: 60, borderRadius: 8, objectFit: "cover" }} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Chat */}
        {showChat && <ChatPanel order={order} onClose={() => setShowChat(false)} />}

        <button onClick={() => setShowChat(!showChat)}
          style={{ background: "#0F0E0C", color: "#FF5C00", border: "none", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          💬 {showChat ? "Chat sluiten" : "Chat with customer 与客户聊天"}
        </button>
      </div>
    </div>
  );
}

function HaulDetail({ haul, orders, onBack, onUpdate }) {
  const [saving, setSaving] = useState(false);
  const [exactShipping, setExactShipping] = useState(haul.exact_shipping_eur?.toString() || "");
  const [trackingNumber, setTrackingNumber] = useState(haul.tracking_number || "");
  const [uploadingBox, setUploadingBox] = useState(false);
  const [boxPhoto, setBoxPhoto] = useState(haul.box_photo || null);

  const haulOrders = orders.filter(o => haul.items?.includes(o.id));
  const totalWeight = haulOrders.reduce((sum, o) => sum + (o.weight_grams || 0), 0);
  const refund = haul.paid_eur && exactShipping ? (haul.paid_eur - parseFloat(exactShipping)).toFixed(2) : null;

  const uploadBoxPhoto = async (file) => {
    setUploadingBox(true);
    const ext = file.name.split(".").pop();
    const fileName = `box-${haul.id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(fileName, file);
    if (!error) {
      const { data } = supabase.storage.from("product-images").getPublicUrl(fileName);
      await supabase.from("hauls").update({ box_photo: data.publicUrl }).eq("id", haul.id);
      setBoxPhoto(data.publicUrl);
      onUpdate({ ...haul, box_photo: data.publicUrl });
    }
    setUploadingBox(false);
  };

  const markShipped = async () => {
    if (!exactShipping) { alert("Vul eerst de exacte verzendkosten in!"); return; }
    if (!trackingNumber) { alert("Vul eerst het tracking number in!"); return; }
    if (!boxPhoto) { alert("Upload a photo of the box first! 请先上传箱子照片"); return; }
    setSaving(true);
    const exactEur = parseFloat(exactShipping);

    // Afwikkeling (haul + buffer-refund + orders op verzonden) gebeurt nu
    // server-side, atomair en idempotent in agent_settle_haul. De tabellen
    // profiles/transactions zijn afgeschermd; alleen deze RPC mag erbij.
    const { data, error } = await supabase.rpc("agent_settle_haul", {
      p_haul_id: String(haul.id),
      p_exact_eur: exactEur,
      p_tracking: trackingNumber,
    });
    if (error || (data && data.ok === false)) {
      alert("Settle failed: " + (error?.message || data?.error || "unknown error"));
      setSaving(false);
      return;
    }

    onUpdate({ ...haul, status: "shipped", exact_shipping_eur: exactEur, tracking_number: trackingNumber });
    setSaving(false);
  };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#F8F7F4", minHeight: "100vh", maxWidth: 430, margin: "0 auto" }}>
      <div style={{ background: "#0F0E0C", padding: "20px 20px 16px" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#888", fontSize: 14, cursor: "pointer", padding: 0, marginBottom: 8 }}>← Back</button>
        <div style={{ color: "#FF5C00", fontSize: 11, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase" }}>Haul verwerken</div>
        <div style={{ color: "#fff", fontSize: 18, fontWeight: 700, marginTop: 4 }}>{haulOrders.length} producten · {totalWeight}g</div>
        <div style={{ color: "#888", fontSize: 13, marginTop: 2 }}>Paid 已付: €{haul.paid_eur?.toFixed(2)}</div>
      </div>

      <div style={{ padding: "16px 20px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 12 }}>Products 产品</div>
          {haulOrders.map((o, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: i < haulOrders.length - 1 ? "1px solid #F0EEE8" : "none" }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: "#F0EEE8", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                {o.image?.startsWith("http") ? <img src={o.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "📦"}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C" }}>{o.product_title || o.product}</div>
                <div style={{ fontSize: 11, color: "#aaa" }}>{o.weight_grams ? `${o.weight_grams}g` : "?"} · {o.qty} pcs</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>Photo of packed box 包裹照片</div>
          <div style={{ fontSize: 11, color: "#aaa", marginBottom: 12 }}>Take a photo of the box with the shipping label visible 拍摄带运单的箱子照片</div>
          {boxPhoto ? (
            <div style={{ borderRadius: 10, overflow: "hidden", aspectRatio: "4/3" }}>
              <img src={boxPhoto} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          ) : (
            <label style={{ display: "block", border: "1.5px dashed #E8E6E0", borderRadius: 10, padding: 20, textAlign: "center", cursor: "pointer", background: "#F8F7F4" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
              <div style={{ fontSize: 12, color: "#aaa" }}>{uploadingBox ? "Uploading..." : "Tap to upload a photo 点击上传照片"}</div>
              <input type="file" accept="image/*" onChange={e => e.target.files[0] && uploadBoxPhoto(e.target.files[0])} style={{ display: "none" }} disabled={uploadingBox} />
            </label>
          )}
        </div>

        <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 10 }}>Exact shipping cost (€) 实际运费</div>
          <input type="number" placeholder="bijv. 18.50" value={exactShipping} onChange={e => setExactShipping(e.target.value)}
            style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 14, boxSizing: "border-box", background: "#F8F7F4", marginBottom: 12 }} />
          {refund && (
            <div style={{ background: parseFloat(refund) >= 0 ? "#F0FDF4" : "#FEF3C7", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: parseFloat(refund) >= 0 ? "#10B981" : "#B45309", fontWeight: 600 }}>
                {parseFloat(refund) >= 0 ? `✓ Customer gets €${refund} back 客户将收到退款` : `⚠️ Shortfall of €${Math.abs(parseFloat(refund)).toFixed(2)}`}
              </div>
            </div>
          )}
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 8 }}>Tracking number (DHL)</div>
          <input placeholder="bijv. 1234567890NL" value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)}
            style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, boxSizing: "border-box", background: "#F8F7F4" }} />
        </div>

        <button onClick={markShipped} disabled={saving || haul.status === "shipped"}
          style={{ background: saving || haul.status === "shipped" ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 14, fontWeight: 700, cursor: saving || haul.status === "shipped" ? "default" : "pointer" }}>
          {haul.status === "shipped" ? "✓ Shipped 已发货" : saving ? "Saving..." : "✈️ Mark as shipped internationally 标记为已国际发货"}
        </button>
      </div>
    </div>
  );
}

export default function AgentPanel() {
  const [orders, setOrders] = useState([]);
  const [hauls, setHauls] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedHaul, setSelectedHaul] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("orders");

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    const [{ data: ordersData }, { data: haulsData }] = await Promise.all([
      supabase.from("orders").select("*").order("created_at", { ascending: false }),
      supabase.from("hauls").select("*").order("created_at", { ascending: false }),
    ]);
    setOrders(ordersData || []);
    setHauls(haulsData || []);
    setLoading(false);
  };

  const updateOrderInList = (updated) => setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
  const updateHaulInList = (updated) => setHauls(prev => prev.map(h => h.id === updated.id ? updated : h));
  const getStepIndex = (status) => statusSteps.findIndex(s => s.key === status);

  const activeOrders = orders.filter(o => ["requested", "quote_sent", "quote_accepted", "purchased", "shipped_local", "qc_pending"].includes(o.status));
  const newRequests = orders.filter(o => o.status === "requested").length;
  const pendingHauls = hauls.filter(h => h.status === "confirmed" || h.status === "packing");
  const shippedHauls = hauls.filter(h => h.status === "shipped" || h.status === "delivered");

  if (selectedOrder) return <OrderDetail order={selectedOrder} onBack={() => setSelectedOrder(null)} onUpdate={updateOrderInList} />;
  if (selectedHaul) return <HaulDetail haul={selectedHaul} orders={orders} onBack={() => setSelectedHaul(null)} onUpdate={updateHaulInList} />;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#F8F7F4", minHeight: "100vh", maxWidth: 430, margin: "0 auto" }}>
      <div style={{ background: "#0F0E0C", padding: "20px 20px 16px" }}>
        <div style={{ color: "#FF5C00", fontSize: 11, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", marginBottom: 2 }}>Flowva</div>
        <div style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>Agent Panel 🇨🇳</div>
        <div style={{ color: "#888", fontSize: 13, marginTop: 2 }}>{activeOrders.length} active orders · {pendingHauls.length} parcel{pendingHauls.length === 1 ? "" : "s"} ready</div>
      </div>

      <div style={{ display: "flex", background: "#fff", borderBottom: "1px solid #E8E6E0" }}>
        {[
          { key: "orders", label: "Orders", count: activeOrders.length, alert: newRequests },
          { key: "hauls", label: "Parcels 包裹", count: pendingHauls.length },
          { key: "shipped", label: "Shipped 已发货", count: shippedHauls.length },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ flex: 1, padding: "12px 4px", background: "none", border: "none", borderBottom: tab === t.key ? "2px solid #FF5C00" : "2px solid transparent", fontSize: 12, fontWeight: tab === t.key ? 700 : 400, color: tab === t.key ? "#0F0E0C" : "#888", cursor: "pointer" }}>
            {t.label}
            {t.count > 0 && (
              <span style={{ marginLeft: 4, background: t.alert > 0 ? "#EF4444" : "#E8E6E0", color: t.alert > 0 ? "#fff" : "#0F0E0C", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10 }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div style={{ padding: "12px 16px" }}>
        {loading && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>Loading...</div>}

        {tab === "orders" && (
          <>
            {activeOrders.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>No active orders 暂无订单</div>}
            {activeOrders.map(order => {
              const step = getStepIndex(order.status);
              const stepInfo = statusSteps[step];
              const isNew = order.status === "requested";
              const customerReplied = order.last_message_sender === "customer" && order.last_message_read === false;
              const agentWaiting = order.last_message_sender === "agent" && order.last_message_read === false;
              return (
                <motion.div key={order.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  onClick={() => setSelectedOrder(order)}
                  style={{ background: "#fff", border: `1.5px solid ${isNew ? "#FF5C00" : customerReplied ? "#6366F1" : "#E8E6E0"}`, borderRadius: 14, padding: "14px 16px", marginBottom: 10, cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: "#aaa", marginBottom: 3 }}>{order.id} · {order.qty} pcs</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#0F0E0C", marginBottom: 6 }}>{order.product_title || order.product}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 14 }}>{stepInfo?.icon}</span>
                        <span style={{ fontSize: 12, color: isNew ? "#0F0E0C" : "#666", fontWeight: isNew ? 700 : 400 }}>{stepInfo?.label}</span>
                      </div>
                      {isNew && <div style={{ fontSize: 11, color: "#666", marginTop: 4, fontWeight: 600 }}>📋 Quote required 需要报价</div>}
                      {order.dispute_status === "pending" && <div style={{ fontSize: 11, color: "#EF4444", fontWeight: 700, marginTop: 4 }}>⚠️ Dispute gemeld</div>}
                      {customerReplied && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                          <span style={{ fontSize: 14 }}>💬</span>
                          <span style={{ fontSize: 12, color: "#6366F1", fontWeight: 700 }}>Customer replied 客户已回复</span>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#6366F1", display: "inline-block" }} />
                        </div>
                      )}
                      {agentWaiting && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                          <span style={{ fontSize: 14 }}>💬</span>
                          <span style={{ fontSize: 12, color: "#888" }}>Customer has not read it yet 客户未读</span>
                        </div>
                      )}
                    </div>
                    {isNew && <div style={{ background: "#FF5C00", color: "#fff", fontSize: 10, fontWeight: 700, padding: "4px 8px", borderRadius: 8 }}>New 新</div>}
                    {!isNew && <div style={{ color: "#ccc", fontSize: 18 }}>→</div>}
                  </div>
                  <div style={{ marginTop: 8, height: 3, background: "#F0EEE8", borderRadius: 2 }}>
                    <div style={{ height: "100%", width: `${((step + 1) / statusSteps.length) * 100}%`, background: "#FF5C00", borderRadius: 2 }} />
                  </div>
                </motion.div>
              );
            })}
          </>
        )}

        {tab === "hauls" && (
          <>
            {pendingHauls.length === 0 && <div style={{ textAlign: "center", padding: "40px 0" }}><div style={{ fontSize: 48, marginBottom: 12 }}>📦</div><div style={{ fontSize: 14, color: "#999" }}>Geen parcels ready</div></div>}
            {pendingHauls.map(haul => {
              const haulOrders = orders.filter(o => haul.items?.includes(o.id));
              const totalWeight = haulOrders.reduce((sum, o) => sum + (o.weight_grams || 0), 0);
              return (
                <motion.div key={haul.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  onClick={() => setSelectedHaul(haul)}
                  style={{ background: "#fff", border: "2px solid #FF5C00", borderRadius: 14, padding: "14px 16px", marginBottom: 10, cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#0F0E0C", marginBottom: 4 }}>{haulOrders.length} producten · {totalWeight}g</div>
                      <div style={{ fontSize: 12, color: "#666" }}>Paid 已付: €{haul.paid_eur?.toFixed(2)}</div>
                      {!haul.box_photo && <div style={{ fontSize: 11, color: "#F59E0B", fontWeight: 600, marginTop: 4 }}>📷 Box photo required 需要箱子照片</div>}
                    </div>
                    <div style={{ background: "#FF5C00", color: "#fff", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 10 }}>Inpakken</div>
                  </div>
                </motion.div>
              );
            })}
          </>
        )}

        {tab === "shipped" && (
          <>
            {shippedHauls.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>Nothing shipped yet 暂未发货</div>}
            {shippedHauls.map(haul => {
              const haulOrders = orders.filter(o => haul.items?.includes(o.id));
              return (
                <div key={haul.id} onClick={() => setSelectedHaul(haul)}
                  style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: "14px 16px", marginBottom: 10, cursor: "pointer" }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#0F0E0C", marginBottom: 4 }}>{haulOrders.length} producten</div>
                  <div style={{ fontSize: 12, color: "#aaa" }}>Tracking: {haul.tracking_number}</div>
                  <div style={{ fontSize: 12, color: "#10B981", marginTop: 2 }}>✓ Shipped 已发货</div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
