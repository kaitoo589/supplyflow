import { useState } from "react";
import { supabase } from "./supabase";

// Publieke EU-herroepingsknop — geen login vereist. Stuurt het verzoek naar de
// withdrawal-request edge function (logt + bevestigingsmail).
export default function WithdrawalPage() {
  const [form, setForm] = useState({ name: "", orderNumber: "", email: "", message: "" });
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const input = { width: "100%", border: "1px solid #E8E6E0", borderRadius: 10, padding: "12px 14px", fontSize: 14, background: "#fff", boxSizing: "border-box", outline: "none", marginBottom: 12 };

  const submit = async () => {
    setError(null);
    if (!form.name.trim() || !form.orderNumber.trim() || !/.+@.+\..+/.test(form.email)) {
      setError("Please fill in your name, order number and a valid email.");
      return;
    }
    setSending(true);
    const { data, error } = await supabase.functions.invoke("withdrawal-request", { body: form });
    setSending(false);
    if (error || !data?.ok) { setError(data?.error || error?.message || "Something went wrong. Please try again."); return; }
    setDone(true);
  };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#F8F7F4", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 22, padding: "28px 24px", maxWidth: 420, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,0.08)" }}>
        {done ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>✅</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0F0E0C", marginBottom: 8 }}>Request received</div>
            <div style={{ fontSize: 14, color: "#555", lineHeight: 1.6, marginBottom: 18 }}>
              We've logged your withdrawal request and emailed you a confirmation. If your item has already shipped, return it within 14 days — we'll send the return details. Once received and checked, we refund the product price to your balance.
            </div>
            <a href="/" style={{ display: "inline-block", background: "#FF5C00", color: "#fff", borderRadius: 12, padding: "12px 22px", fontSize: 14, fontWeight: 700, textDecoration: "none" }}>Back to Flowva</a>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#0F0E0C", marginBottom: 4 }}>Withdraw or cancel an order</div>
            <div style={{ fontSize: 13.5, color: "#8A8780", lineHeight: 1.6, marginBottom: 18 }}>
              You can withdraw within 14 days of receiving your order — no account needed. Fill this in and we'll confirm by email. See our <a href="/returns" style={{ color: "#FF5C00", fontWeight: 600 }}>returns policy</a>.
            </div>
            {error && <div style={{ background: "#FEE2E2", color: "#DC2626", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <input style={input} placeholder="Your name" value={form.name} onChange={(e) => set("name", e.target.value)} />
            <input style={input} placeholder="Order number (e.g. SF-...)" value={form.orderNumber} onChange={(e) => set("orderNumber", e.target.value)} />
            <input style={input} type="email" placeholder="Email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            <textarea style={{ ...input, minHeight: 80, resize: "vertical" }} placeholder="Reason (optional)" value={form.message} onChange={(e) => set("message", e.target.value)} />
            <button onClick={submit} disabled={sending}
              style={{ width: "100%", background: sending ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, cursor: sending ? "default" : "pointer" }}>
              {sending ? "Sending..." : "Submit withdrawal request"}
            </button>
            <div style={{ fontSize: 11.5, color: "#A8A5A0", marginTop: 12, lineHeight: 1.5 }}>
              Return shipping is paid by you unless the item is faulty. Refunds are issued after we receive and check the returned item.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
