import { useState } from "react";
import { supabase } from "./supabase";
import { motion, AnimatePresence } from "framer-motion";
import { springMorph } from "./motion";

const spring = springMorph;

export default function OrderRequest({ product, session, onClose, onSuccess, onAddToList, listCount = 0 }) {
  const [selectedVariants, setSelectedVariants] = useState({});
  const [aantal, setAantal] = useState(1);
  const [opmerking, setOpmerking] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [direction, setDirection] = useState(0);
  const [missingVariants, setMissingVariants] = useState([]);

  const productVariants = product.sizes?.length > 0 ? product.sizes : null;

  // Foto die hoort bij de laatst gekozen optie (bijv. "Wit" → witte foto),
  // anders de standaard productfoto.
  const variantImage = Object.values(selectedVariants).map(opt => product.variant_images?.[opt]).filter(Boolean).pop();
  const displayImage = variantImage || (product.image?.startsWith("http") ? product.image : null);

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
    // Instant checkout: koop dit item direct af (server-side pay_cart).
    const { data, error } = await supabase.rpc("pay_cart", { p_items: [item] });
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

  const stagger = { animate: { transition: { staggerChildren: 0.06 } } };
  const fadeUp = {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0, transition: spring },
  };

  return (
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
                  {product.platform} · €{Number(product.price).toFixed(2)}
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

            {/* Beschrijving */}
            {product.description && (
              <motion.div variants={fadeUp} style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 6 }}>Description</div>
                <div style={{ fontSize: 13, color: "#555", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{product.description}</div>
              </motion.div>
            )}

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

            

            {error && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                style={{ background: "#FEE2E2", color: "#DC2626", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>
                {error}
              </motion.div>
            )}

            <motion.div variants={fadeUp}
              style={{ background: "#F8F7F4", borderRadius: 10, padding: "10px 14px", marginBottom: 10, fontSize: 12, color: "#888" }}>
              💡 A service fee (8%, min €5) is added at checkout — shared across your whole cart, so bundling makes it cheaper per item. International shipping is paid later, by weight.
            </motion.div>

            {/* Vos-tip: aanvragen bundelen = één service fee i.p.v. één per aanvraag */}
            <motion.div variants={fadeUp}
              style={{ display: "flex", alignItems: "center", gap: 10, background: "#111111", borderRadius: 12, padding: "10px 14px", marginBottom: 16 }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>🦊</span>
              <span style={{ fontSize: 12, color: "#C9C6C1", lineHeight: 1.5 }}>
                <b style={{ color: "#FF5C00" }}>Tip:</b> want more items? Add them to your cart and buy everything at once — separate orders each get their own service fee.
              </span>
            </motion.div>

            <motion.button
              variants={fadeUp}
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }}
              onClick={handleSubmit}
              disabled={loading}
              style={{ width: "100%", background: loading ? "#E8E6E0" : "#FF5C00", color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontSize: 15, fontWeight: 700, cursor: loading ? "default" : "pointer" }}
            >
              {loading ? "Processing..." : "Buy now →"}
            </motion.button>

            {onAddToList && (
              <motion.button
                variants={fadeUp}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }}
                onClick={handleAddToList}
                disabled={loading}
                style={{ width: "100%", marginTop: 8, background: "#fff", color: "#111111", border: "1.5px solid #111111", borderRadius: 14, padding: "14px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
              >
                + Add to cart{listCount > 0 ? ` (${listCount})` : ""}
              </motion.button>
            )}
          </motion.div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}