// Publieke juridische pagina (geen login). Rendert een markdown-document uit src/legal/.
import Markdown from "./Markdown";

export default function LegalPage({ source }) {
  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#F8F7F4", minHeight: "100vh", padding: "32px 16px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", background: "#fff", borderRadius: 22, padding: "30px 28px", boxShadow: "0 8px 40px rgba(0,0,0,0.06)" }}>
        <a href="/" style={{ fontSize: 13, color: "#FF5C00", textDecoration: "none", fontWeight: 600 }}>← Back to Flowva</a>
        <div style={{ height: 16 }} />
        <Markdown source={source} />
        <div style={{ fontSize: 11.5, color: "#A8A5A0", marginTop: 22, lineHeight: 1.5, borderTop: "1px solid #EDEAE3", paddingTop: 14 }}>
          This document does not affect your mandatory statutory consumer rights. Governing law: the Netherlands.
        </div>
      </div>
    </div>
  );
}
