// Publieke retour-/herroepingsbeleidpagina (/returns) — geen login vereist.
const SECTIONS = [
  { h: "1. Who you buy from", b: "You purchase from Flowva. We curate the products, set the price, add a service fee, and arrange sourcing, quality control and international shipping for you. Flowva is the seller." },
  { h: "2. Your 14-day right of withdrawal", b: "As an EU consumer you may withdraw within 14 days without giving a reason. The 14 days start the day you receive the item — not the order day. Because items ship from China, your window begins when the parcel arrives. You may also withdraw before it arrives." },
  { h: "3. How to withdraw", b: "Use the “Withdraw / cancel order” page — no login needed. Give your name, order number and email. You'll get an automatic confirmation, then 14 days to send the item back." },
  { h: "4. What you get refunded", b: "Partial return (you keep some items): we refund the product price of the returned item(s) only — shipping is not refunded for a partial return. Full withdrawal: product price plus the standard outbound delivery cost." },
  { h: "5. Return shipping costs", b: "You pay return shipping. We provide a return address in the Netherlands, so you never ship back to China. Return within 14 days of your request." },
  { h: "6. Condition of items", b: "Return items in original condition (unworn, with tags and packaging). We may reduce your refund for any loss of value caused by handling beyond what is needed to inspect the item." },
  { h: "7. Refunds", b: "We refund within 14 days of receiving the item back (or proof you sent it), to your Flowva balance." },
  { h: "8. Cancelling during fulfilment", b: "Before we've purchased the item: cancelled at no cost, full refund. After it has shipped: handled as a return — you return it to our NL address." },
  { h: "9. Excluded items", b: "The 14-day right does not apply to custom or personalised products, sealed hygiene items once unsealed, perishable goods, and other categories excluded by law." },
  { h: "10. Faulty or wrong items", b: "If an item arrives defective, damaged in transit or not as described, we cover the return cost and provide a repair, replacement or full refund. Every item is quality-controlled and photographed before it ships. Minor variations from supplier photos are normal and not a defect." },
];

export default function ReturnsPage() {
  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#F8F7F4", minHeight: "100vh", padding: "32px 16px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", background: "#fff", borderRadius: 22, padding: "28px 26px", boxShadow: "0 8px 40px rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: "#0F0E0C", marginBottom: 4 }}>Returns &amp; withdrawal</div>
        <div style={{ fontSize: 13.5, color: "#8A8780", marginBottom: 22 }}>Your rights and how returns work at Flowva.</div>
        {SECTIONS.map((s) => (
          <div key={s.h} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>{s.h}</div>
            <div style={{ fontSize: 13.5, color: "#555", lineHeight: 1.65 }}>{s.b}</div>
          </div>
        ))}
        <a href="/withdraw" style={{ display: "inline-block", background: "#FF5C00", color: "#fff", borderRadius: 12, padding: "13px 24px", fontSize: 14, fontWeight: 700, textDecoration: "none", marginTop: 8 }}>Withdraw / cancel an order →</a>
        <div style={{ fontSize: 11.5, color: "#A8A5A0", marginTop: 16, lineHeight: 1.5 }}>This policy does not affect your mandatory statutory consumer rights. Governing law: the Netherlands.</div>
      </div>
    </div>
  );
}
