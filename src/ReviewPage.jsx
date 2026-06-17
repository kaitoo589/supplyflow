import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "./supabase";
import { springSoft, springSnappy, springBouncy, springMorph } from "./motion";

function Stars({ value, size = 16 }) {
  return (
    <span style={{ display: "inline-flex", gap: 1, lineHeight: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ fontSize: size, color: i <= Math.round(value) ? "#111111" : "#E0DED8" }}>★</span>
      ))}
    </span>
  );
}

const FILTERS = [
  { key: "recent", label: "Newest" },
  { key: "highest", label: "Highest" },
  { key: "lowest", label: "Lowest" },
  { key: "photos", label: "With photos" },
];

// Sterren-kiezer met pop-animatie.
function StarPicker({ value, onChange, size = 34 }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <motion.button key={i} whileTap={{ scale: 0.8 }} onClick={() => onChange(i)}
          animate={{ scale: value === i ? [1, 1.25, 1] : 1 }} transition={springSnappy}
          style={{ background: "none", border: "none", fontSize: size, lineHeight: 1, cursor: "pointer", padding: 0, color: i <= value ? "#111111" : "#E0DED8", WebkitTapHighlightColor: "transparent" }}>
          ★
        </motion.button>
      ))}
    </div>
  );
}

function WriteReview({ product, session, deliveredOrder, existing, onClose, onSaved }) {
  const [rating, setRating] = useState(existing?.rating || 0);
  const [quality, setQuality] = useState(existing?.quality_score || 0);
  const [body, setBody] = useState(existing?.body || "");
  const [buyAgain, setBuyAgain] = useState(existing?.would_buy_again || false);
  // Bij bewerken: bestaande foto's als preview tonen (url i.p.v. file)
  const [files, setFiles] = useState(() => (existing?.photos || []).map((u) => ({ url: u, preview: u })));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [needRating, setNeedRating] = useState(false);

  const addFiles = (e) => {
    const list = Array.from(e.target.files || []);
    const mapped = list.map(f => ({ file: f, preview: URL.createObjectURL(f) }));
    setFiles(prev => [...prev, ...mapped].slice(0, 5));
    e.target.value = "";
  };

  const submit = async () => {
    if (!rating) { setNeedRating(true); return; }
    setSaving(true); setErr(null);
    try {
      const urls = [];
      for (const f of files) {
        if (f.url) { urls.push(f.url); continue; }
        const ext = (f.file.name.split(".").pop() || "jpg").toLowerCase();
        const name = `reviews/${session.user.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await supabase.storage.from("product-images").upload(name, f.file);
        if (error) throw new Error("Photo upload failed: " + error.message);
        const { data } = supabase.storage.from("product-images").getPublicUrl(name);
        urls.push(data.publicUrl);
      }
      if (existing) {
        const { error } = await supabase.from("reviews").update({
          rating,
          quality_score: quality || null,
          body: body.trim() || null,
          photos: urls,
          would_buy_again: buyAgain,
        }).eq("id", existing.id);
        if (error) throw new Error(error.message);
      } else {
        const meta = session.user.user_metadata || {};
        const initial = (meta.achternaam || "").slice(0, 1);
        const username = (meta.voornaam ? `${meta.voornaam}${initial ? " " + initial + "." : ""}` : session.user.email.split("@")[0]);
        const { error } = await supabase.from("reviews").insert({
          product_id: product.id,
          user_id: session.user.id,
          username,
          rating,
          quality_score: quality || null,
          body: body.trim() || null,
          variant: deliveredOrder?.kleur || null,
          photos: urls,
          would_buy_again: buyAgain,
        });
        if (error) throw new Error(error.message);
      }
      onSaved();
    } catch (e) {
      setErr(e.message);
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }} />
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#fff", borderRadius: "24px 24px 0 0", zIndex: 401, maxHeight: "88vh", overflowY: "auto", padding: "20px 20px 40px" }}>
        <div style={{ width: 36, height: 4, background: "#E8E6E0", borderRadius: 2, margin: "0 auto 16px" }} />
        <div style={{ fontSize: 18, fontWeight: 700, color: "#0F0E0C", marginBottom: 2 }}>{existing ? "Edit your review" : "Write a review"}</div>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 18 }}>{product.title}</div>

        <div style={{ fontSize: 13, fontWeight: 600, color: needRating ? "#DC2626" : "#0F0E0C", marginBottom: 8 }}>
          Your rating {needRating && <span style={{ fontWeight: 700 }}>· Choose a star rating</span>}
        </div>
        <motion.div animate={needRating ? { x: [0, -8, 8, -6, 6, 0] } : { x: 0 }} transition={{ duration: 0.4 }}
          onClick={() => setNeedRating(false)} style={{ marginBottom: 18 }}>
          <StarPicker value={rating} onChange={(v) => { setRating(v); setNeedRating(false); }} />
        </motion.div>

        <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 8 }}>Product Quality Score <span style={{ color: "#aaa", fontWeight: 400 }}>(optional)</span></div>
        <div style={{ marginBottom: 18 }}><StarPicker value={quality} onChange={setQuality} size={24} /></div>

        <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 8 }}>Your review</div>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={4}
          placeholder="What did you think of the product? Quality, size, delivery..."
          style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 12, padding: "12px 14px", fontSize: 13, background: "#F8F7F4", boxSizing: "border-box", fontFamily: "inherit", resize: "vertical", marginBottom: 16, outline: "none" }} />

        <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 8 }}>Photos <span style={{ color: "#aaa", fontWeight: 400 }}>(camera or gallery, max 5)</span></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {files.map((f, i) => (
            <motion.div key={f.preview} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={springBouncy}
              style={{ position: "relative", width: 64, height: 64, borderRadius: 10, overflow: "hidden" }}>
              <img src={f.preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <button onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))}
                style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: 6, width: 20, height: 20, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </motion.div>
          ))}
          {files.length < 5 && (
            <label style={{ width: 64, height: 64, borderRadius: 10, border: "1.5px dashed #E8E6E0", background: "#F8F7F4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, cursor: "pointer" }}>
              📷
              <input type="file" accept="image/*" multiple onChange={addFiles} style={{ display: "none" }} />
            </label>
          )}
        </div>

        <motion.button whileTap={{ scale: 0.97 }} onClick={() => setBuyAgain(!buyAgain)}
          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: buyAgain ? "#DCFCE7" : "#F8F7F4", border: "1px solid " + (buyAgain ? "#86EFAC" : "#E8E6E0"), borderRadius: 12, padding: "12px 14px", fontSize: 13, fontWeight: 600, color: buyAgain ? "#166534" : "#555", cursor: "pointer", marginBottom: 16, boxSizing: "border-box", WebkitTapHighlightColor: "transparent" }}>
          <motion.span animate={{ scale: buyAgain ? [1, 1.3, 1] : 1 }} transition={springSnappy}>{buyAgain ? "✓" : "○"}</motion.span>
          I would buy this again
        </motion.button>

        {err && <div style={{ background: "#FEE2E2", color: "#DC2626", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>{err}</div>}

        <motion.button whileTap={saving ? undefined : { scale: 0.97 }} onClick={submit} disabled={saving}
          style={{ width: "100%", background: saving ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, cursor: saving ? "default" : "pointer", WebkitTapHighlightColor: "transparent" }}>
          {saving ? (existing ? "Saving..." : "Posting...") : existing ? "Save changes →" : "Post review →"}
        </motion.button>
      </motion.div>
    </>
  );
}

export default function ReviewPage({ product, session, onClose }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [orderCount, setOrderCount] = useState(0);
  const [filter, setFilter] = useState("recent");
  const [deliveredOrder, setDeliveredOrder] = useState(null);
  const [showWrite, setShowWrite] = useState(false);

  const fetchReviews = async () => {
    const { data, error } = await supabase.from("reviews").select("*").eq("product_id", product.id);
    if (error) setError(error.message);
    setReviews(data || []);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.from("reviews").select("*").eq("product_id", product.id);
      const { count } = await supabase.from("orders").select("id", { count: "exact", head: true }).eq("product_title", product.title);
      let delivered = null;
      if (session) {
        const { data: ords } = await supabase.from("orders").select("id, kleur, status")
          .eq("user_id", session.user.id).eq("product_title", product.title).eq("status", "delivered").limit(1);
        delivered = ords?.[0] || null;
      }
      if (!active) return;
      if (error) setError(error.message);
      setReviews(data || []);
      setOrderCount(count || 0);
      setDeliveredOrder(delivered);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [product.id, product.title, session]);

  const myReview = session ? reviews.find((r) => r.user_id === session.user.id) : null;

  const count = reviews.length;
  const avg = count ? reviews.reduce((s, r) => s + r.rating, 0) / count : 0;
  const qualityScores = reviews.filter((r) => r.quality_score != null);
  const avgQuality = qualityScores.length ? qualityScores.reduce((s, r) => s + r.quality_score, 0) / qualityScores.length : 0;
  const photoCount = reviews.filter((r) => (r.photos || []).length > 0).length;
  const buyAgainCount = reviews.filter((r) => r.would_buy_again).length;
  const buyAgainPct = count ? Math.round((buyAgainCount / count) * 100) : 0;
  const displayOrders = product.orders != null ? product.orders : orderCount;

  const sorted = [...reviews];
  if (filter === "recent") sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (filter === "highest") sorted.sort((a, b) => b.rating - a.rating);
  if (filter === "lowest") sorted.sort((a, b) => a.rating - b.rating);
  const withoutMine = myReview ? sorted.filter((r) => r.id !== myReview.id) : sorted;
  const visible = filter === "photos" ? withoutMine.filter((r) => (r.photos || []).length > 0) : withoutMine;

  const dist = [5, 4, 3, 2, 1].map((star) => ({ star, n: reviews.filter((r) => r.rating === star).length }));

  const stats = [
    { label: "Avg. score", value: count ? avg.toFixed(1) + " ★" : "–" },
    { label: "Reviews", value: count },
    { label: "With photo", value: photoCount },
    { label: "Orders", value: displayOrders },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      style={{ position: "fixed", inset: 0, left: 0, right: 0, margin: "0 auto", maxWidth: 430, zIndex: 300, background: "#F8F7F4", overflowY: "auto", fontFamily: "'Inter', 'Helvetica Neue', sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#0F0E0C", padding: "16px 20px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 2 }}>
        <motion.button whileTap={{ scale: 0.9 }} onClick={onClose}
          style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 10, color: "#fff", fontSize: 16, padding: "8px 12px", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>←</motion.button>
        <div style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>Reviews</div>
      </div>

      <div style={{ padding: "16px 20px 60px" }}>
        {/* Product header */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springSoft}
          style={{ display: "flex", gap: 14, marginBottom: 18 }}>
          <motion.div layoutId={`pimg-${product.id}`} transition={springMorph} style={{ width: 80, height: 80, borderRadius: 14, background: "#fff", flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36 }}>
            {product.image?.startsWith("http") ? <img src={product.image} alt={product.title} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : product.image}
          </motion.div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0F0E0C" }}>{product.title}</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>🏭 {product.supplier || product.factory || product.platform || "Unknown supplier"}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <Stars value={avg} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C" }}>{count ? avg.toFixed(1) : "–"}</span>
              <span style={{ fontSize: 12, color: "#888" }}>({count} review{count === 1 ? "" : "s"})</span>
            </div>
          </div>
        </motion.div>

        {/* Overview stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
          {stats.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springSoft, delay: i * 0.05 }}
              style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#0F0E0C" }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "#888" }}>{s.label}</div>
            </motion.div>
          ))}
        </div>

        {/* Quality score + buy again + verdeling */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springSoft, delay: 0.15 }}
          style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "16px", marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 12, color: "#888" }}>Product Quality Score</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#0F0E0C" }}>{count ? avgQuality.toFixed(1) : "–"}<span style={{ fontSize: 13, color: "#aaa" }}>/5</span></div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, color: "#888" }}>Would buy again</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#FF5C00" }}>{buyAgainPct}%</div>
            </div>
          </div>
          {dist.map((d) => (
            <div key={d.star} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: "#888", width: 28 }}>{d.star} ★</span>
              <div style={{ flex: 1, height: 6, background: "#F0EEE8", borderRadius: 3, overflow: "hidden" }}>
                <motion.div initial={{ width: 0 }} animate={{ width: count ? (d.n / count) * 100 + "%" : "0%" }} transition={{ ...springSoft, delay: 0.2 }}
                  style={{ height: "100%", background: "#111111", borderRadius: 3 }} />
              </div>
              <span style={{ fontSize: 11, color: "#aaa", width: 20, textAlign: "right" }}>{d.n}</span>
            </div>
          ))}
        </motion.div>

        {/* Eigen review bovenaan — altijd aan te passen */}
        {!loading && myReview && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springSoft}
            style={{ background: "#fff", border: "1.5px solid #FF5C00", borderRadius: 16, padding: "14px 16px", marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ background: "#FFF0E7", color: "#FF5C00", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20 }}>Your review</span>
                <Stars value={myReview.rating} size={13} />
              </div>
              <motion.button whileTap={{ scale: 0.94 }} onClick={() => setShowWrite(true)}
                style={{ background: "#0F0E0C", color: "#FF5C00", border: "none", borderRadius: 10, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                ✎ Edit
              </motion.button>
            </div>
            {myReview.variant && <div style={{ fontSize: 11, color: "#888", marginBottom: 6, fontWeight: 600 }}>{myReview.variant}</div>}
            {myReview.body && <div style={{ fontSize: 13, color: "#333", lineHeight: 1.5, marginBottom: 8 }}>{myReview.body}</div>}
            {(myReview.photos || []).length > 0 && (
              <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 8 }}>
                {myReview.photos.map((u, idx) => (
                  <img key={idx} src={u} alt="" style={{ width: 64, height: 64, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                ))}
              </div>
            )}
            {myReview.would_buy_again && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#F3F1ED", color: "#555", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20 }}>
                ✓ Would buy again
              </div>
            )}
          </motion.div>
        )}

        {/* Review schrijven (alleen als je er nog geen hebt) */}
        {!loading && session && !myReview && (
          deliveredOrder ? (
            <motion.button whileTap={{ scale: 0.97 }} onClick={() => setShowWrite(true)}
              style={{ width: "100%", background: "#0F0E0C", color: "#FF5C00", border: "none", borderRadius: 12, padding: "13px", fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 18, WebkitTapHighlightColor: "transparent" }}>
              ✍️ Write a review
            </motion.button>
          ) : (
            <div style={{ textAlign: "center", background: "#F8F7F4", border: "1px solid #E8E6E0", color: "#888", borderRadius: 12, padding: "11px", fontSize: 13, marginBottom: 18 }}>
              📦 You can review once your order is delivered
            </div>
          )
        )}

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 16, paddingBottom: 4 }}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <motion.button key={f.key} whileTap={{ scale: 0.92 }} onClick={() => setFilter(f.key)}
                style={{ padding: "7px 14px", borderRadius: 20, border: "1px solid " + (active ? "#0F0E0C" : "#E8E6E0"), background: active ? "#0F0E0C" : "#fff", color: active ? "#FF5C00" : "#555", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                {f.label}
              </motion.button>
            );
          })}
        </div>

        {/* Reviews */}
        {loading && <div style={{ textAlign: "center", padding: 30, color: "#aaa", fontSize: 13 }}>Loading reviews...</div>}
        {error && <div style={{ textAlign: "center", padding: 30, color: "#B45309", fontSize: 13 }}>Couldn't load reviews: {error}</div>}
        {!loading && !error && count === 0 && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#aaa" }}>
            <div style={{ fontSize: 42, marginBottom: 10 }}>📝</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#0F0E0C" }}>No reviews yet</div>
            <div style={{ fontSize: 13 }}>Be the first to review this product.</div>
          </div>
        )}
        <AnimatePresence mode="popLayout">
          {visible.map((r, i) => (
            <motion.div key={r.id} layout
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
              transition={{ ...springSoft, delay: i * 0.04 }}
              style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 16, padding: "14px 16px", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#0F0E0C", color: "#FF5C00", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
                    {(r.username || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C" }}>{r.username || "Anonymous"}</div>
                    <div style={{ fontSize: 11, color: "#aaa" }}>{r.created_at ? new Date(r.created_at).toLocaleDateString("en-GB") : ""}</div>
                  </div>
                </div>
                <Stars value={r.rating} size={13} />
              </div>
              {r.variant && <div style={{ fontSize: 11, color: "#888", marginBottom: 6, fontWeight: 600 }}>{r.variant}</div>}
              {r.body && <div style={{ fontSize: 13, color: "#333", lineHeight: 1.5, marginBottom: 8 }}>{r.body}</div>}
              {(r.photos || []).length > 0 && (
                <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 8 }}>
                  {r.photos.map((u, idx) => (
                    <img key={idx} src={u} alt="" style={{ width: 64, height: 64, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                  ))}
                </div>
              )}
              {r.would_buy_again && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#F3F1ED", color: "#555", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20 }}>
                  ✓ Would buy again
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Schrijf-review sheet */}
      <AnimatePresence>
        {showWrite && (deliveredOrder || myReview) && (
          <WriteReview product={product} session={session} deliveredOrder={deliveredOrder} existing={myReview}
            onClose={() => setShowWrite(false)}
            onSaved={() => { setShowWrite(false); fetchReviews(); }} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
