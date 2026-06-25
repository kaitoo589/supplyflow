import { useState } from "react";

// #12 — idempotentie-token voor de instant-buy pay_cart (module-scope). Zie supplyflow-app.jsx.
let _buyPayToken = null;
const buyPayToken = () => (_buyPayToken ||= (globalThis.crypto?.randomUUID?.() || `bp-${Date.now()}-${Math.random().toString(36).slice(2)}`));
const rotateBuyPayToken = () => { _buyPayToken = null; };
import { supabase } from "./supabase";
import { motion, AnimatePresence } from "framer-motion";
import { springMorph } from "./motion";
import { ffAddItem, ffShareProduct } from "./ffApi";

const spring = springMorph;

export default function OrderRequest({ product, session, onClose, onSuccess, onAddToList, listCount = 0, isFavorite = false, onToggleFavorite, activeGroup = null, onActiveGroupGone }) {
  const [selectedVariants, setSelectedVariants] = useState({});
  const [aantal, setAantal] = useState(1);
  const [opmerking, setOpmerking] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [direction, setDirection] = useState(0);
  const [missingVariants, setMissingVariants] = useState([]);
  const [showSizeGuide, setShowSizeGuide] = useState(false);
  const [addedToGroup, setAddedToGroup] = useState(false);
  const [sharedToGroup, setSharedToGroup] = useState(false);

  const productVariants = product.sizes?.length > 0 ? product.sizes : null;

  // Foto die hoort bij de laatst gekozen optie (bijv. "Wit" → witte foto),
  // anders de standaard productfoto.
  const variantImage = Object.values(selectedVariants).map(opt => product.variant_images?.[opt]).filter(Boolean).pop();
  // Hoofdfoto-galerij: alle officiële foto's, klant tikt erdoorheen.
  const photos = [...new Set([...(product.gallery || []), product.image].filter(u => typeof u === "string" && u.startsWith("http")))];
  const [galleryPhoto, setGalleryPhoto] = useState(photos[0] || null);
  const displayImage = variantImage || galleryPhoto || (product.image?.startsWith("http") ? product.image : null);

  // Valideert varianten en bouwt het order-item (zonder id/status) —
  // gedeeld door "direct versturen" en "toevoegen aan aanvraaglijst".
  const buildItem = () => {
    if (productVariants) {
      const missing = productVariants.filter(v => !selectedVariants[v.name]).map(v => v.name);
      if (missing.length) { setMissingVariants(missing); return null; }
    }
    const variantString = Object.entries(selectedVariants)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    return {
      product: product.title,
      product_title: product.title,
      source_url: product.source_url || "",
      platform: product.platform,
      price: product.price,
      qty: aantal,
      kleur: variantString,
      variant_image: displayImage,
      opmerking,
    };
  };

  const handleSubmit = async () => {
    const item = buildItem();
    if (!item) return;
    setLoading(true);
    setError(null);
    // Live prijscheck vóór afschrijven — zelfde guard als de winkelwagen.
    try {
      const { data: chk } = await supabase.functions.invoke("check-cart-prices", {
        body: { items: [{ source_url: item.source_url, kleur: item.kleur }] },
      });
      if (chk?.anyChanged) {
        setLoading(false);
        setError("This item's supplier price just changed, so it's temporarily on hold. We're updating it — please check back soon.");
        return;
      }
    } catch { /* check onbereikbaar → fail-open */ }
    // Instant checkout: koop dit item direct af (server-side pay_cart).
    const { data, error } = await supabase.rpc("pay_cart", { p_items: [item], p_idem: buyPayToken() });
    if (!error) rotateBuyPayToken();   // server antwoordde → volgende poging vers token
    setLoading(false);
    if (error) { setError(error.message); return; }
    if (!data?.ok) {
      setError(
        data?.error === "Insufficient balance"
          ? "Insufficient balance — top up to complete your order."
          : data?.error || "Something went wrong. Please try again."
      );
      return;
    }
    onSuccess();
  };

  const handleAddToList = () => {
    const item = buildItem();
    if (!item) return;
    onAddToList(item);
  };

  // Flowva Friends: voeg dit item toe aan de gedeelde mand van de actieve groep.
  const handleAddToGroup = async () => {
    if (!activeGroup) return;
    const item = buildItem();
    if (!item) return;
    setLoading(true); setError(null);
    const r = await ffAddItem(activeGroup.id, item);
    setLoading(false);
    if (!r.ok) {
      setError(r.error || "Could not add to the group");
      // Groep bestaat niet meer / geen lid / gesloten → stop met "voor deze groep shoppen".
      if (/not a member|not found|closed|full/i.test(r.error || "")) onActiveGroupGone?.();
      return;
    }
    setAddedToGroup(true);
    setTimeout(() => { onClose?.(); }, 850);   // na de ✓-bevestiging terug naar de feed
  };

  // Flowva Friends: deel dit product in de groepschat (zonder het zelf toe te voegen).
  const handleShareToGroup = async () => {
    if (!activeGroup) return;
    const item = buildItem();
    if (!item) return;
    const r = await ffShareProduct(activeGroup.id, item);
    if (!r.ok) {
      setError(r.error || "Could not share to the group");
      if (/not a member|not found|closed/i.test(r.error || "")) onActiveGroupGone?.();
      return;
    }
    setSharedToGroup(true);
    setTimeout(() => setSharedToGroup(false), 1600);
  };

  const stagger = { animate: { transition: { staggerChildren: 0.06 } } };
  const fadeUp = {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0, transition: spring },
  };

  return (
    <>
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 100,
          background: "rgba(0,0,0,0.35)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      />

      <div
        key="card-wrapper"
        style={{
          position: "fixed", inset: 0, zIndex: 101,
          display: "flex", alignItems: "flex-end", justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <motion.div
          key="card"
          layoutId={`card-${product.id}`}
          transition={spring}
          style={{
            width: "100%", maxWidth: 430,
            background: "#fff",
            borderRadius: "24px 24px 0 0",
            maxHeight: "92vh", overflowY: "auto",
            boxShadow: "0 -4px 60px rgba(0,0,0,0.15)",
            pointerEvents: "all",
          }}
        >
          <motion.div
            layoutId={`card-inner-${product.id}`}
            transition={spring}
            style={{ background: "#0F0E0C", padding: "20px 20px 24px", borderRadius: "24px 24px 0 0" }}
          >
            <motion.div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, margin: "0 auto 16px" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <motion.div layoutId={`title-${product.id}`} transition={spring}
                  style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>
                  {product.title}
                </motion.div>
                <motion.div layoutId={`platform-${product.id}`} transition={spring}
                  style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
                  {product.platform} · €{Number(product.price).toFixed(2)} · factory price
                </motion.div>
              </div>
              <motion.button
                whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.85 }}
                onClick={onClose}
                style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 10, padding: "8px 12px", cursor: "pointer", fontSize: 16, color: "#fff" }}
              >✕</motion.button>
            </div>
          </motion.div>

          <motion.div variants={stagger} initial="initial" animate="animate" style={{ padding: "24px 20px 40px" }}>

            {/* Productafbeelding — morpht vanuit de feed-kaart, wisselt mee met de gekozen optie */}
            {displayImage && (
              <motion.div layoutId={`pimg-${product.id}`} transition={spring} style={{ marginBottom: product.description ? 16 : 24, borderRadius: 16, overflow: "hidden", aspectRatio: "1", background: "#fff", position: "relative" }}>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.img key={displayImage} src={displayImage} alt={product.title}
                    initial={{ opacity: 0, scale: 1.04 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                </AnimatePresence>
              </motion.div>
            )}
            {photos.length > 1 && (
              <motion.div variants={fadeUp} style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: product.description ? 16 : 24, paddingBottom: 2 }}>
                {photos.map((url) => {
                  const active = !variantImage && displayImage === url;
                  return (
                    <button key={url} onClick={() => setGalleryPhoto(url)}
                      style={{ flexShrink: 0, width: 54, height: 54, borderRadius: 10, overflow: "hidden", border: `2px solid ${active ? "#FF5C00" : "#E8E6E0"}`, background: "#fff", padding: 0, cursor: "pointer" }}>
                      <img src={url} referrerPolicy="no-referrer" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    </button>
                  );
                })}
              </motion.div>
            )}

            {product.gender?.length > 0 && (
              <motion.div variants={fadeUp} style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
                {product.gender.map((g) => (
                  <span key={g} style={{ fontSize: 11.5, fontWeight: 700, color: "#6B6862", background: "#F3F1ED", borderRadius: 20, padding: "4px 11px" }}>{g}</span>
                ))}
              </motion.div>
            )}

            {/* Beschrijving */}
            {product.description && (
              <motion.div variants={fadeUp} style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 6 }}>Description</div>
                <div style={{ fontSize: 13, color: "#555", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{product.description}</div>
              </motion.div>
            )}

            {product.material?.length > 0 && (
              <motion.div variants={fadeUp} style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 8 }}>Materials</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {product.material.map((m, i) => (
                    <div key={i} style={{ background: "#F8F7F4", borderRadius: 10, padding: "7px 12px", display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{m.name}</span>
                      {m.pct ? <span style={{ fontSize: 12, fontWeight: 700, color: "#FF5C00" }}>{String(m.pct).replace("%", "")}%</span> : null}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {(() => {
              const fname = product.supplier && product.supplier !== product.platform ? product.supplier : null;
              const st = product.factory_stats;
              if (!fname && !st) return null;
              const stats = st ? [
                { label: "Repurchase rate", v: st.repurchase },
                { label: "Service score", v: st.service },
                { label: "On-time delivery", v: st.ontime },
                { label: "Positive reviews", v: st.reviews },
              ].filter(s => s.v) : [];
              return (
                <motion.div variants={fadeUp} style={{ background: "#F8F7F4", borderRadius: 14, padding: "12px 14px", marginBottom: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: stats.length ? 10 : 0 }}>
                    <span style={{ fontSize: 17 }}>🏭</span>
                    <div>
                      <div style={{ fontSize: 11, color: "#A8A5A0", fontWeight: 600 }}>Factory</div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#111" }}>{fname || "Verified supplier"}</div>
                    </div>
                  </div>
                  {stats.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {stats.map(s => (
                        <div key={s.label} style={{ background: "#fff", borderRadius: 10, padding: "8px 10px", border: "1px solid #EFEDE7" }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: "#FF5C00" }}>{s.v}</div>
                          <div style={{ fontSize: 10.5, color: "#8A8780" }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              );
            })()}

            {/* Aantal */}
            <motion.div variants={fadeUp} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 10 }}>Quantity</div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.8 }}
                  onClick={() => { setDirection(-1); setAantal(Math.max(1, aantal - 1)); }}
                  style={{ width: 40, height: 40, borderRadius: 12, border: "1px solid #E8E6E0", background: "#fff", fontSize: 20, cursor: "pointer" }}>−</motion.button>
                <div style={{ overflow: "hidden", width: 30, textAlign: "center" }}>
                  <AnimatePresence mode="wait" custom={direction}>
                    <motion.span key={aantal} custom={direction}
                      initial={{ y: direction * 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: direction * -20, opacity: 0 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      style={{ display: "block", fontSize: 20, fontWeight: 700 }}>
                      {aantal}
                    </motion.span>
                  </AnimatePresence>
                </div>
                <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.8 }}
                  onClick={() => { setDirection(1); setAantal(aantal + 1); }}
                  style={{ width: 40, height: 40, borderRadius: 12, border: "1px solid #E8E6E0", background: "#fff", fontSize: 20, cursor: "pointer" }}>+</motion.button>
              </div>
            </motion.div>

            {/* Custom varianten */}
            {productVariants && productVariants.map((variant) => {
              const missing = missingVariants.includes(variant.name);
              return (
              <motion.div key={variant.name} variants={fadeUp} style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: missing ? "#DC2626" : "#0F0E0C", marginBottom: 10 }}>
                  {variant.name}
                  {missing && <span style={{ color: "#DC2626", fontWeight: 700, marginLeft: 8 }}>· Choose an option</span>}
                </div>
                <motion.div animate={missing ? { x: [0, -8, 8, -6, 6, 0] } : { x: 0 }} transition={{ duration: 0.4 }} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {variant.options.map(opt => (
                    <motion.button key={opt}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.85 }}
                      animate={{ scale: selectedVariants[variant.name] === opt ? [1, 1.15, 1] : 1 }}
                      transition={{ duration: 0.3, type: "spring", stiffness: 300 }}
                      onClick={() => { setSelectedVariants({ ...selectedVariants, [variant.name]: opt }); setMissingVariants(m => m.filter(n => n !== variant.name)); }}
                      style={{ padding: "10px 18px", borderRadius: 12, border: `1.5px solid ${selectedVariants[variant.name] === opt ? "#0F0E0C" : missing ? "#FCA5A5" : "#E8E6E0"}`, background: selectedVariants[variant.name] === opt ? "#0F0E0C" : "#fff", color: selectedVariants[variant.name] === opt ? "#fff" : "#555", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      {opt}
                    </motion.button>
                  ))}
                </motion.div>
              </motion.div>
              );
            })}

            

            {(product.size_chart?.measures?.length > 0 || product.size_chart?.image) && (
              <motion.button variants={fadeUp} type="button" onClick={() => setShowSizeGuide(true)}
                style={{ width: "100%", marginBottom: 16, background: "#F8F7F4", color: "#111", border: "1px solid #E8E6E0", borderRadius: 12, padding: "12px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                📐 Size guide
              </motion.button>
            )}

            {error && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                style={{ background: "#FEE2E2", color: "#DC2626", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>
                {error}
              </motion.div>
            )}

            <motion.div variants={fadeUp}
              style={{ background: "#F8F7F4", borderRadius: 10, padding: "10px 14px", marginBottom: 10, fontSize: 12, color: "#888" }}>
              💡 A service fee (8%, min €5) is added at checkout — shared across your whole cart, so bundling makes it cheaper per item. International shipping is paid later, per parcel — so bundling keeps that cheap too.
            </motion.div>

            {/* Vos-tip: aanvragen bundelen = één service fee i.p.v. één per aanvraag */}
            <motion.div variants={fadeUp}
              style={{ display: "flex", alignItems: "center", gap: 10, background: "#111111", borderRadius: 12, padding: "10px 14px", marginBottom: 16 }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>🦊</span>
              <span style={{ fontSize: 12, color: "#C9C6C1", lineHeight: 1.5 }}>
                <b style={{ color: "#FF5C00" }}>Tip:</b> want more items? Add them to your cart and buy everything at once — separate orders each get their own service fee.
              </span>
            </motion.div>

            {activeGroup && (
              <>
                <motion.div variants={fadeUp} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,92,0,0.1)", border: "1px solid rgba(255,92,0,0.3)", borderRadius: 12, padding: "10px 13px", marginBottom: 10, fontSize: 12.5, color: "#B45309" }}>
                  🦊 Shopping for <b style={{ marginLeft: 2 }}>{activeGroup.name}</b>
                </motion.div>
                <motion.button variants={fadeUp} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }}
                  onClick={handleAddToGroup} disabled={loading || addedToGroup}
                  style={{ width: "100%", marginBottom: 8, background: addedToGroup ? "#16A34A" : "#FF5C00", color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontSize: 15, fontWeight: 700, cursor: loading ? "default" : "pointer" }}>
                  {addedToGroup ? `✓ Added to ${activeGroup.name}` : loading ? "Adding…" : `+ Add to ${activeGroup.name}`}
                </motion.button>
                <motion.button variants={fadeUp} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }}
                  onClick={handleShareToGroup} disabled={loading}
                  style={{ width: "100%", background: sharedToGroup ? "rgba(52,209,123,0.15)" : "rgba(255,92,0,0.08)", color: sharedToGroup ? "#16A34A" : "#FF5C00", border: `1.5px solid ${sharedToGroup ? "rgba(52,209,123,0.4)" : "rgba(255,92,0,0.35)"}`, borderRadius: 14, padding: "13px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                  {sharedToGroup ? "✓ Shared to the group" : "↗ Share to group"}
                </motion.button>
              </>
            )}
            {onAddToList && !activeGroup && (
              <motion.button
                variants={fadeUp}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }}
                onClick={handleAddToList}
                disabled={loading}
                style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
              >
                + Add to cart{listCount > 0 ? ` (${listCount})` : ""}
              </motion.button>
            )}
            <motion.button variants={fadeUp} whileTap={{ scale: 0.95 }}
              onClick={() => onToggleFavorite?.()}
              style={{ width: "100%", marginTop: 8, background: "transparent", color: isFavorite ? "#FF5C00" : "#8A8780", border: "none", padding: "11px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              {isFavorite ? "★ Remove from favorites" : "☆ Add to favorites"}
            </motion.button>
          </motion.div>
        </motion.div>
      </div>
    </AnimatePresence>

    {showSizeGuide && product.size_chart && (() => {
      const sc = product.size_chart;
      const C = ["#E24B4A", "#2FA56E", "#E0A500", "#378ADD", "#FF7A1A", "#7F77DD", "#D4537E"];
      return (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowSizeGuide(false)}
            style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }} />
          <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} transition={{ type: "spring", stiffness: 320, damping: 34 }}
            style={{ position: "fixed", bottom: 0, left: 0, right: 0, margin: "0 auto", width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#fff", borderRadius: "24px 24px 0 0", zIndex: 201, maxHeight: "88vh", overflowY: "auto", padding: "20px 20px 40px" }}>
            <div style={{ width: 36, height: 4, background: "#E8E6E0", borderRadius: 2, margin: "0 auto 16px" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#0F0E0C" }}>Size guide</div>
              <button onClick={() => setShowSizeGuide(false)} style={{ background: "#F3F1ED", border: "none", borderRadius: 999, width: 30, height: 30, fontSize: 15, color: "#777", cursor: "pointer" }}>✕</button>
            </div>
            {sc.image && (
              <img src={sc.image} referrerPolicy="no-referrer" alt="size chart" style={{ width: "100%", borderRadius: 12, display: "block", marginBottom: sc.measures?.length > 0 ? 16 : 0 }} />
            )}
            {sc.measures?.length > 0 && (
              <>
                <div style={{ fontSize: 12, color: "#8A8780", marginBottom: 12 }}>Measurements in cm — the colors match the sketch below.</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr>
                    <th style={{ textAlign: "left", padding: "7px 4px", color: "#888", fontWeight: 600, borderBottom: "1px solid #ECEAE5" }}>Size</th>
                    {sc.measures.map((m, i) => <th key={m} style={{ textAlign: "right", padding: "7px 4px", color: C[i % C.length], fontWeight: 700, borderBottom: "1px solid #ECEAE5", whiteSpace: "nowrap" }}>{m}</th>)}
                  </tr></thead>
                  <tbody>
                    {sc.sizes.map((sz) => (
                      <tr key={sz}>
                        <td style={{ padding: "8px 4px", fontWeight: 700, color: "#111", borderBottom: "1px solid #F4F2EE" }}>{sz}</td>
                        {sc.measures.map((m, i) => <td key={m} style={{ textAlign: "right", padding: "8px 4px", fontWeight: 700, color: C[i % C.length], borderBottom: "1px solid #F4F2EE" }}>{(sc.rows?.[sz] || [])[i] ?? "–"}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sc.sketch && (
                  <div style={{ marginTop: 16, background: "#fff", border: "1px solid #F0EEE8", borderRadius: 16, padding: 12, maxWidth: 300, margin: "16px auto 0", aspectRatio: "1" }}>
                    <img src={sc.sketch} referrerPolicy="no-referrer" alt="size sketch" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  </div>
                )}
              </>
            )}
          </motion.div>
        </>
      );
    })()}
    </>
  );
}