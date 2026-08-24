// Publieke retour-/herroepingsbeleidpagina (/returns) — geen login vereist.
import { tr } from "./i18n";

export default function ReturnsPage() {
  // In de component (NIET module-scope): tr() moet de gekozen taal van dit moment lezen.
  const SECTIONS = [
    { h: tr("ret.s1.h", "1. Who you buy from"), b: tr("ret.s1.b", "You purchase from Flowva. We curate the products, set the price, add a service fee, and arrange sourcing, quality control and international shipping for you. Flowva is the seller.") },
    { h: tr("ret.s2.h", "2. Your 14-day right of withdrawal"), b: tr("ret.s2.b", "You may withdraw within 14 days without giving a reason. In the EU this is your legal right — and we honour the same 14 days for every country we deliver to. The 14 days start the day you receive the item — not the order day. Because items ship from China, your window begins when the parcel arrives. You may also withdraw before it arrives.") },
    { h: tr("ret.s3.h", "3. How to withdraw"), b: tr("ret.s3.b", "Use the “Withdraw / cancel order” page — no login needed. Give your name, order number and email. You'll get an automatic confirmation, then 14 days to send the item back.") },
    { h: tr("ret.s4.h", "4. What you get refunded"), b: tr("ret.s4.b", "Partial return (you keep some items): we refund the product price of the returned item(s) only — shipping is not refunded for a partial return. Full withdrawal: product price plus the standard outbound delivery cost.") },
    { h: tr("ret.s5.h", "5. Return shipping costs"), b: tr("ret.s5.b", "You pay return shipping. We provide a return address in the Netherlands, so you never ship back to China. Within the EU that's usually €5–€10; from the UK, USA, Canada, Australia or Norway typically €10–€25, depending on the carrier. Return within 14 days of your request.") },
    { h: tr("ret.s6.h", "6. Condition of items"), b: tr("ret.s6.b", "Return items in original condition (unworn, with tags and packaging). We may reduce your refund for any loss of value caused by handling beyond what is needed to inspect the item.") },
    { h: tr("ret.s7.h", "7. Refunds"), b: tr("ret.s7.b", "We refund within 14 days of receiving the item back (or proof you sent it), to your Flowva balance.") },
    { h: tr("ret.s8.h", "8. Cancelling during fulfilment"), b: tr("ret.s8.b", "Before we've purchased the item: cancelled at no cost, full refund. After it has shipped: handled as a return — you return it to our NL address.") },
    { h: tr("ret.s9.h", "9. Excluded items"), b: tr("ret.s9.b", "The 14-day right does not apply to custom or personalised products, sealed hygiene items once unsealed, perishable goods, and other categories excluded by law.") },
    { h: tr("ret.s10.h", "10. Faulty or wrong items"), b: tr("ret.s10.b", "Every item is quality-controlled and photographed before it ships. Flowva covers the return shipping only when an item has a genuine defect that was missed twice: not flagged at quality-control, and not visible in the quality-control photos you approved. If the photos showed the item was fine, or an issue was flagged and you chose to accept and ship anyway, a return counts as change of mind and you pay the return shipping. Minor variations from supplier photos are normal and not a defect.") },
  ];
  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#F8F7F4", minHeight: "100vh", padding: "32px 16px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <button onClick={() => { window.location.href = "/?tab=profile"; }}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#fff", border: "1px solid #E8E6E0", borderRadius: 999, padding: "9px 16px 9px 12px", fontSize: 13.5, fontWeight: 700, color: "#0F0E0C", cursor: "pointer", marginBottom: 14, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
          <span style={{ fontSize: 18, lineHeight: 1, marginTop: -2 }}>‹</span> {tr("common.backPlain", "Back")}
        </button>
      <div style={{ background: "#fff", borderRadius: 22, padding: "28px 26px", boxShadow: "0 8px 40px rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: "#0F0E0C", marginBottom: 4 }}>{tr("ret.title", "Returns & withdrawal")}</div>
        <div style={{ fontSize: 13.5, color: "#8A8780", marginBottom: 22 }}>{tr("ret.subtitle", "Your rights and how returns work at Flowva.")}</div>
        {SECTIONS.map((s) => (
          <div key={s.h} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>{s.h}</div>
            <div style={{ fontSize: 13.5, color: "#555", lineHeight: 1.65 }}>{s.b}</div>
          </div>
        ))}
        <a href="/withdraw" style={{ display: "inline-block", background: "#FF5C00", color: "#fff", borderRadius: 12, padding: "13px 24px", fontSize: 14, fontWeight: 700, textDecoration: "none", marginTop: 8 }}>{tr("ret.cta", "Withdraw / cancel an order →")}</a>
        <div style={{ fontSize: 11.5, color: "#A8A5A0", marginTop: 16, lineHeight: 1.5 }}>{tr("ret.footer", "This policy does not affect your mandatory statutory consumer rights. Governing law: the Netherlands.")}</div>
      </div>
      </div>
    </div>
  );
}
