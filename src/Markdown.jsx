// Lichte markdown-renderer voor de juridische pagina's (geen dependency).
// Ondersteunt: # ## ### koppen, paragrafen, **vet**, `code`, - opsommingen,
// 1. genummerd, | tabellen |, --- scheidingslijn. [LEGAL REVIEW: ...]-markers
// worden geel gemarkeerd zodat ze tijdens de review opvallen (verwijderen vóór live).

function inline(text) {
  const nodes = [];
  const re = /(\*\*[^*]+\*\*|\[LEGAL REVIEW:[^\]]*\]|`[^`]+`)/g;
  let last = 0, m, key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) nodes.push(<strong key={key++} style={{ color: "#0F0E0C" }}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) nodes.push(<code key={key++} style={{ background: "#F0EEE8", padding: "1px 5px", borderRadius: 4, fontSize: "0.9em" }}>{tok.slice(1, -1)}</code>);
    else nodes.push(<mark key={key++} style={{ background: "#FEF3C7", color: "#92400E", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>{tok}</mark>);
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const BLOCK_START = /^(#{1,4}\s|---+\s*$|\s*[-*]\s|\s*\d+\.\s)/;
const splitRow = (r) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
const H_SIZE = { 1: 25, 2: 18, 3: 15, 4: 13.5 };

export default function Markdown({ source }) {
  const lines = (source || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let mh;
    if ((mh = /^(#{1,4})\s+(.*)$/.exec(line))) { blocks.push({ t: "h", level: mh[1].length, text: mh[2] }); i++; continue; }
    if (/^---+$/.test(line.trim())) { blocks.push({ t: "hr" }); i++; continue; }
    if (line.includes("|") && i + 1 < lines.length && lines[i + 1].includes("-") && /^[\s:|-]+$/.test(lines[i + 1])) {
      const head = line; const rows = []; i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) { rows.push(lines[i]); i++; }
      blocks.push({ t: "table", head, rows }); continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
      blocks.push({ t: "ul", items }); continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      blocks.push({ t: "ol", items }); continue;
    }
    const para = [line]; i++;
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i]) && !lines[i].includes("|")) { para.push(lines[i]); i++; }
    blocks.push({ t: "p", text: para.join(" ") });
  }

  return (
    <div style={{ fontSize: 13.5, color: "#444", lineHeight: 1.7 }}>
      {blocks.map((b, k) => {
        if (b.t === "h") return <div key={k} style={{ fontSize: H_SIZE[b.level] || 13, fontWeight: b.level <= 2 ? 800 : 700, color: "#0F0E0C", margin: b.level === 1 ? "0 0 6px" : "22px 0 8px" }}>{inline(b.text)}</div>;
        if (b.t === "hr") return <hr key={k} style={{ border: "none", borderTop: "1px solid #EDEAE3", margin: "20px 0" }} />;
        if (b.t === "p") return <p key={k} style={{ margin: "0 0 12px" }}>{inline(b.text)}</p>;
        if (b.t === "ul") return <ul key={k} style={{ margin: "0 0 12px", paddingLeft: 20 }}>{b.items.map((it, j) => <li key={j} style={{ marginBottom: 4 }}>{inline(it)}</li>)}</ul>;
        if (b.t === "ol") return <ol key={k} style={{ margin: "0 0 12px", paddingLeft: 20 }}>{b.items.map((it, j) => <li key={j} style={{ marginBottom: 4 }}>{inline(it)}</li>)}</ol>;
        if (b.t === "table") {
          const head = splitRow(b.head); const rows = b.rows.map(splitRow);
          return (
            <div key={k} style={{ overflowX: "auto", margin: "0 0 14px" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
                <thead><tr>{head.map((c, j) => <th key={j} style={{ textAlign: "left", padding: "6px 9px", borderBottom: "2px solid #E8E6E0", color: "#0F0E0C", fontWeight: 700 }}>{inline(c)}</th>)}</tr></thead>
                <tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, l) => <td key={l} style={{ padding: "6px 9px", borderBottom: "1px solid #F0EEE8", verticalAlign: "top" }}>{inline(c)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
