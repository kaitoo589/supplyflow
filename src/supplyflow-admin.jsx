import { useState } from "react";

const initialDrops = [
  {
    id: 1,
    name: "Drop #1 — Week 23",
    status: "live",
    date: "2 jun 2026",
    products: [
      { id: 1, title: "Minimalist leather wallet", price: 12.50, moq: 50, platform: "1688", sourceUrl: "https://1688.com/product/123456", category: "Accessories", orders: 14, image: "💼" },
      { id: 2, title: "Ceramic coffee mug set", price: 4.20, moq: 100, platform: "Taobao", sourceUrl: "https://taobao.com/item/789", category: "Home", orders: 8, image: "☕" },
      { id: 3, title: "Bamboo phone stand", price: 2.80, moq: 200, platform: "1688", sourceUrl: "https://1688.com/product/555", category: "Tech", orders: 22, image: "📱" },
    ],
  },
  {
    id: 2,
    name: "Drop #2 — Week 24",
    status: "draft",
    date: "9 jun 2026",
    products: [
      { id: 4, title: "Canvas tote bag", price: 3.50, moq: 100, platform: "Weidian", sourceUrl: "https://weidian.com/item/999", category: "Accessories", orders: 0, image: "🛍️" },
    ],
  },
];

const emptyProduct = { title: "", price: "", moq: "", platform: "1688", sourceUrl: "", category: "Accessories", image: "📦" };
const platforms = ["1688", "Taobao", "Weidian", "Alibaba"];
const categories = ["Accessories", "Home", "Tech", "Sports", "Fashion", "Beauty"];
const categoryIcons = { Accessories: "👜", Home: "🏠", Tech: "💻", Sports: "⚽", Fashion: "👗", Beauty: "💄" };

export default function SupplyFlowAdmin() {
  const [drops, setDrops] = useState(initialDrops);
  const [view, setView] = useState("drops");
  const [selectedDrop, setSelectedDrop] = useState(null);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProduct, setNewProduct] = useState(emptyProduct);
  const [showNewDrop, setShowNewDrop] = useState(false);
  const [newDropName, setNewDropName] = useState("");
  const [newDropDate, setNewDropDate] = useState("");

  const totalOrders = drops.flatMap(d => d.products).reduce((a, p) => a + p.orders, 0);
  const liveDrops = drops.filter(d => d.status === "live").length;
  const totalProducts = drops.flatMap(d => d.products).length;

  const addProduct = () => {
    if (!newProduct.title || !newProduct.price) return;
    const updated = drops.map(d =>
      d.id === selectedDrop.id
        ? { ...d, products: [...d.products, { ...newProduct, id: Date.now(), price: parseFloat(newProduct.price), moq: parseInt(newProduct.moq) || 0, orders: 0 }] }
        : d
    );
    setDrops(updated);
    setSelectedDrop(updated.find(d => d.id === selectedDrop.id));
    setNewProduct(emptyProduct);
    setShowAddProduct(false);
  };

  const removeProduct = (productId) => {
    const updated = drops.map(d =>
      d.id === selectedDrop.id
        ? { ...d, products: d.products.filter(p => p.id !== productId) }
        : d
    );
    setDrops(updated);
    setSelectedDrop(updated.find(d => d.id === selectedDrop.id));
  };

  const publishDrop = (dropId) => {
    setDrops(drops.map(d => d.id === dropId ? { ...d, status: "live" } : d));
    if (selectedDrop?.id === dropId) setSelectedDrop({ ...selectedDrop, status: "live" });
  };

  const archiveDrop = (dropId) => {
    setDrops(drops.map(d => d.id === dropId ? { ...d, status: "archived" } : d));
    if (selectedDrop?.id === dropId) setSelectedDrop({ ...selectedDrop, status: "archived" });
  };

  const createDrop = () => {
    if (!newDropName) return;
    const drop = { id: Date.now(), name: newDropName, status: "draft", date: newDropDate || "Datum onbekend", products: [] };
    setDrops([...drops, drop]);
    setShowNewDrop(false);
    setNewDropName("");
    setNewDropDate("");
  };

  const statusBadge = (status) => {
    const map = {
      live: { label: "Live", bg: "#D1FAE5", color: "#065F46" },
      draft: { label: "Concept", bg: "#FEF3C7", color: "#92400E" },
      archived: { label: "Archief", bg: "#F3F4F6", color: "#6B7280" },
    };
    const s = map[status] || map.draft;
    return (
      <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20 }}>
        {s.label}
      </span>
    );
  };

  return (
    <div style={{
      fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif",
      background: "#F8F7F4",
      minHeight: "100vh",
      maxWidth: 480,
      margin: "0 auto",
    }}>

      {/* Header */}
      <div style={{ background: "#0F0E0C", padding: "20px 20px 16px" }}>
        <div style={{ color: "#C8F135", fontSize: 11, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", marginBottom: 2 }}>SupplyFlow</div>
        <div style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>Admin panel</div>
        <div style={{ color: "#666", fontSize: 13, marginTop: 2 }}>Beheer je drops en producten</div>
      </div>

      {/* Stats */}
      {view === "drops" && !selectedDrop && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: "#E8E6E0" }}>
          {[
            { label: "Totaal orders", value: totalOrders },
            { label: "Live drops", value: liveDrops },
            { label: "Producten", value: totalProducts },
          ].map(s => (
            <div key={s.label} style={{ background: "#fff", padding: "14px 16px" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#0F0E0C" }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: "16px 20px", paddingBottom: 32 }}>

        {/* DROPS OVERVIEW */}
        {view === "drops" && !selectedDrop && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F0E0C" }}>Drops</div>
              <button
                onClick={() => setShowNewDrop(true)}
                style={{
                  background: "#C8F135", color: "#0F0E0C",
                  border: "none", borderRadius: 10,
                  padding: "8px 14px", fontSize: 13, fontWeight: 700,
                  cursor: "pointer",
                }}>+ Nieuwe drop</button>
            </div>

            {/* New drop form */}
            {showNewDrop && (
              <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 12 }}>Nieuwe drop aanmaken</div>
                <input
                  placeholder="Naam (bijv. Drop #3 — Week 25)"
                  value={newDropName}
                  onChange={e => setNewDropName(e.target.value)}
                  style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 8, boxSizing: "border-box", background: "#F8F7F4" }}
                />
                <input
                  placeholder="Datum (bijv. 16 jun 2026)"
                  value={newDropDate}
                  onChange={e => setNewDropDate(e.target.value)}
                  style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 12, boxSizing: "border-box", background: "#F8F7F4" }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={createDrop} style={{ flex: 1, background: "#0F0E0C", color: "#C8F135", border: "none", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Aanmaken</button>
                  <button onClick={() => setShowNewDrop(false)} style={{ flex: 1, background: "#F8F7F4", color: "#666", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px", fontSize: 13, cursor: "pointer" }}>Annuleren</button>
                </div>
              </div>
            )}

            {drops.map(drop => (
              <div
                key={drop.id}
                style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: "14px 16px", marginBottom: 10, cursor: "pointer" }}
                onClick={() => setSelectedDrop(drop)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C", marginBottom: 4 }}>{drop.name}</div>
                    <div style={{ fontSize: 12, color: "#aaa" }}>{drop.date}</div>
                  </div>
                  {statusBadge(drop.status)}
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: "#666" }}>{drop.products.length} producten</div>
                  <div style={{ fontSize: 12, color: "#666" }}>{drop.products.reduce((a, p) => a + p.orders, 0)} orders</div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* DROP DETAIL */}
        {view === "drops" && selectedDrop && (
          <>
            <button onClick={() => { setSelectedDrop(null); setShowAddProduct(false); }} style={{ background: "none", border: "none", fontSize: 14, color: "#666", cursor: "pointer", marginBottom: 16, padding: 0 }}>← Terug</button>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#0F0E0C" }}>{selectedDrop.name}</div>
                <div style={{ fontSize: 13, color: "#aaa", marginTop: 2 }}>{selectedDrop.date}</div>
              </div>
              {statusBadge(selectedDrop.status)}
            </div>

            {/* Drop actions */}
            <div style={{ display: "flex", gap: 8, marginBottom: 20, marginTop: 12 }}>
              {selectedDrop.status === "draft" && (
                <button
                  onClick={() => publishDrop(selectedDrop.id)}
                  style={{ flex: 1, background: "#C8F135", color: "#0F0E0C", border: "none", borderRadius: 10, padding: "10px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                >Publiceren</button>
              )}
              {selectedDrop.status === "live" && (
                <button
                  onClick={() => archiveDrop(selectedDrop.id)}
                  style={{ flex: 1, background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: 10, padding: "10px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >Archiveren</button>
              )}
              <button
                onClick={() => setShowAddProduct(true)}
                style={{ flex: 1, background: "#0F0E0C", color: "#fff", border: "none", borderRadius: 10, padding: "10px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >+ Product toevoegen</button>
            </div>

            {/* Add product form */}
            {showAddProduct && (
              <div style={{ background: "#fff", border: "1.5px solid #C8F135", borderRadius: 14, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 12 }}>Product toevoegen</div>
                {[
                  { key: "title", placeholder: "Productnaam", type: "text" },
                  { key: "sourceUrl", placeholder: "Link (1688 / Taobao / Weidian URL)", type: "text" },
                  { key: "price", placeholder: "Prijs per stuk (€)", type: "number" },
                  { key: "moq", placeholder: "Minimum bestelling (MOQ)", type: "number" },
                ].map(field => (
                  <input
                    key={field.key}
                    type={field.type}
                    placeholder={field.placeholder}
                    value={newProduct[field.key]}
                    onChange={e => setNewProduct({ ...newProduct, [field.key]: e.target.value })}
                    style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 8, boxSizing: "border-box", background: "#F8F7F4" }}
                  />
                ))}
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <select
                    value={newProduct.platform}
                    onChange={e => setNewProduct({ ...newProduct, platform: e.target.value })}
                    style={{ flex: 1, border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, background: "#F8F7F4" }}
                  >
                    {platforms.map(p => <option key={p}>{p}</option>)}
                  </select>
                  <select
                    value={newProduct.category}
                    onChange={e => setNewProduct({ ...newProduct, category: e.target.value, image: categoryIcons[e.target.value] || "📦" })}
                    style={{ flex: 1, border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, background: "#F8F7F4" }}
                  >
                    {categories.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={addProduct} style={{ flex: 1, background: "#0F0E0C", color: "#C8F135", border: "none", borderRadius: 8, padding: "10px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Toevoegen</button>
                  <button onClick={() => { setShowAddProduct(false); setNewProduct(emptyProduct); }} style={{ flex: 1, background: "#F8F7F4", color: "#666", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px", fontSize: 13, cursor: "pointer" }}>Annuleren</button>
                </div>
              </div>
            )}

            {/* Products list */}
            {selectedDrop.products.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#aaa", fontSize: 14 }}>
                Nog geen producten. Voeg je eerste product toe.
              </div>
            )}

            {selectedDrop.products.map(product => (
              <div key={product.id} style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: "14px 16px", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: "#F0EEE8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
                    {product.image}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 2 }}>{product.title}</div>
                    <div style={{ fontSize: 11, color: "#aaa", marginBottom: 4 }}>{product.platform} · {product.category}</div>
                    <div style={{ display: "flex", gap: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C" }}>€{parseFloat(product.price).toFixed(2)}</span>
                      <span style={{ fontSize: 12, color: "#aaa" }}>MOQ {product.moq}</span>
                      <span style={{ fontSize: 12, color: "#10B981", fontWeight: 600 }}>{product.orders} orders</span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeProduct(product.id)}
                    style={{ background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}
                  >Verwijder</button>
                </div>

                {/* Source link */}
                {product.sourceUrl && (
                  <div style={{ marginTop: 10, background: "#F8F7F4", borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 11, color: "#aaa", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{product.sourceUrl}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#6366F1", marginLeft: 8, flexShrink: 0 }}>Agent link</div>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
