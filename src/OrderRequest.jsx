import { useState, useRef, useEffect } from "react";

// #12 — idempotentie-token voor de instant-buy pay_cart (module-scope). Zie supplyflow-app.jsx.
let _buyPayToken = null;
const buyPayToken = () => (_buyPayToken ||= (globalThis.crypto?.randomUUID?.() || `bp-${Date.now()}-${Math.random().toString(36).slice(2)}`));
const rotateBuyPayToken = () => { _buyPayToken = null; };
import { supabase } from "./supabase";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { springMorph } from "./motion";
import { ffAddItem, ffShareProduct } from "./ffApi";
import Fox from "./Fox";
import PhotoZoom from "./PhotoZoom";
import { useBodyScrollLock } from "./DelightBits";
import { tr } from "./i18n";

const spring = springMorph;

export default function OrderRequest({ product, session, onRequireAuth, onClose, onSuccess, onAddToList, listCount = 0, isFavorite = false, onToggleFavorite, activeGroup = null, onActiveGroupGone, groupLocked = false }) {
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
  const [zoomOpen, setZoomOpen] = useState(false);
  const imgRef = useRef(null);            // bron-rect voor de "foto vliegt naar de mand"-animatie
  const dragControls = useDragControls(); // rubber-band: sheet omlaag trekken om te sluiten
  useBodyScrollLock(true);                // feed erachter niet mee laten scrollen
  // "settled": pas ná de open-morph laden we de zware sheet-inhoud (galerij, prijs,
  // varianten, knoppen — ~30 motion-nodes + foto-decodes). Tijdens de morph draait
  // dus alleen header + hero, net als de fabriek-ghost pas ná de eerste paint vertrekt →
  // de morph loopt over een vrijwel lege main thread = zelfde gladheid.
  const [settled, setSettled] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSettled(true), 620); return () => clearTimeout(t); }, []);

  const productVariants = product.sizes?.length > 0 ? product.sizes : null;
  // Door admin handmatig uitverkocht gemelde varianten (per groep+optie) — klant kan ze niet kiezen.
  const oosVariants = Array.isArray(product.oos_variants) ? product.oos_variants : [];
  const isOos = (name, opt) => oosVariants.some(o => o && o.name === name && o.value === opt);
  // Combinatie-uitverkocht (auto-geleerd van een BuckyDrop-afwijzing): alleen déze
  // combinatie (bijv. white + M) is op — losse opties blijven gewoon kiesbaar.
  const comboOos = productVariants
    ? oosVariants.some(o => Array.isArray(o?.combo) && o.combo.length > 0
        && o.combo.every(c => selectedVariants[c.name] === c.value))
    : false;

  // Foto die hoort bij de laatst gekozen optie (bijv. "Wit" → witte foto).
  // Alleen nog gebruikt voor de order-thumbnail; de hoofdfoto wordt gestuurd door de galerij.
  const variantImage = Object.values(selectedVariants).map(opt => product.variant_images?.[opt]).filter(Boolean).pop();
  // Hoofdfoto-galerij: álle officiële foto's + de per-variant toegewezen foto's, zodat een
  // kleurfoto altijd gewoon ín de galerij staat (doorswipen blijft werken, ook ná een keuze).
  const variantPhotos = Object.values(product.variant_images || {}).filter(u => typeof u === "string" && u.startsWith("http"));
  // AUTOMATISCHE FOTOVOLGORDE (geen per-product-instelling nodig). De strip bouwt op uit de
  // kleur/variant-foto's + de galerij. De hoofdfoto (product.image) is vaak een ANDER opgeslagen
  // bestand dan dezelfde foto in die set (andere rehost-URL) → string-dedupe ziet 'm niet als
  // dubbel. Daarom: neem de hoofdfoto alléén vooraan mee als z'n URL ÉCHT al in de set zit
  // (veilig, geen duplicaat); zit 'ie er niet in, dan is 't vrijwel altijd zo'n niet-matchbaar
  // duplicaat → laat 'm weg (de kleur/galerij dekt 'm al). Zo nooit een dubbele foto — op elk
  // product, zonder iets in te stellen.
  const setPhotos = [...variantPhotos, ...(product.gallery || [])].filter(u => typeof u === "string" && u.startsWith("http"));
  const mainHttp = product.image?.startsWith("http") ? product.image : null;
  const ordered = (mainHttp && setPhotos.includes(mainHttp)) ? [mainHttp, ...setPhotos] : setPhotos;
  const deduped = [...new Set(ordered)];
  // Vangnet: geen kleur/galerij-foto's → toon dan de hoofdfoto zodat er altijd íets te zien is.
  const photos = deduped.length ? deduped : (mainHttp ? [mainHttp] : []);
  // Hero opent op de HOOFDFOTO (het feed-kaart-beeld, al gedecodeerd) → naadloze open-morph
  // ZONDER flits. Cruciaal: opent 'ie op een ander beeld dan de kaart, dan fade-in't dat er
  // overheen tijdens de morph = zichtbare glitch (vooral op telefoon). De strip zelf blijft
  // [kleur/variant + galerij] zónder losse hoofdfoto (geen dubbel); zit de hoofdfoto niet in
  // die set, dan is 'ie wél de hero maar geen strip-thumb — prima, een keuze/swipe springt
  // daarna naar een strip-foto.
  const heroStart = mainHttp || photos[0] || null;
  const [galleryPhoto, setGalleryPhoto] = useState(heroStart);
  // Eén bron voor de hoofdfoto = de galerij. Een kleurkeuze springt de galerij naar de
  // bijbehorende foto (zie de variant-knop) i.p.v. de hero vast te zetten — zo blijft de
  // galerij altijd bedienbaar en krijgt de gekozen foto gewoon de oranje omlijning.
  const displayImage = galleryPhoto || (product.image?.startsWith("http") ? product.image : null);

  // Valideert varianten en bouwt het order-item (zonder id/status) —
  // gedeeld door "direct versturen" en "toevoegen aan aanvraaglijst".
  const buildItem = () => {
    if (productVariants) {
      const missing = productVariants.filter(v => !selectedVariants[v.name]).map(v => v.name);
      if (missing.length) { setMissingVariants(missing); return null; }
      if (comboOos) { setError(tr("product.comboSoldOut","This combination is sold out at the factory — try a different option.")); return null; }
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
      variant_image: variantImage || displayImage,
      opmerking,
    };
  };

  const handleSubmit = async () => {
    if (!session) { onRequireAuth?.(); return; }   // gast → auth-overlay i.p.v. "Not logged in"
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
        setError(tr("product.priceChangedOnHold","This item's supplier price just changed, so it's temporarily on hold. We're updating it — please check back soon."));
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
          ? tr("product.insufficientBalanceTopUp","Insufficient balance — top up to complete your order.")
          : data?.error || tr("common.somethingWentWrong","Something went wrong. Please try again.")
      );
      return;
    }
    onSuccess();
  };

  const handleAddToList = () => {
    const item = buildItem();
    if (!item) return;
    // Bron-rect van de productfoto meemeten → de app laat 'm naar de mand-balk vliegen.
    // product.id gaat mee zodat de app de FEED-KAART van dit item kan vinden: de vlucht
    // start ná het dichtklappen van de sheet vanaf de kaart zelf (leest veel duidelijker).
    const rect = imgRef.current?.getBoundingClientRect() || null;
    onAddToList(item, rect, product.id);
  };

  // Flowva Friends: koop dit item DIRECT in de actieve groep (fee valt pas bij verzenden).
  const handleAddToGroup = async () => {
    if (!activeGroup) return;
    const item = buildItem();
    if (!item) return;
    setLoading(true); setError(null);
    const r = await ffAddItem(activeGroup.id, item);
    setLoading(false);
    if (!r.ok) {
      setError(r.error === "Insufficient balance"
        ? tr("product.insufficientBalanceNeeded","Insufficient balance — you need €{amount}. Top up first.",{ amount: Number(r.needed || 0).toFixed(2) })
        : (r.error || tr("product.couldNotBuyForGroup","Could not buy for the group")));
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
      setError(r.error || tr("product.couldNotShareToGroup","Could not share to the group"));
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
          // Blur pas ná de morph — een in-fadende backdrop-blur is compositor-zwaar en
          // liet de vlucht haperen; tijdens de morph alleen de donkere scrim.
          backdropFilter: settled ? "blur(12px)" : "none",
          WebkitBackdropFilter: settled ? "blur(12px)" : "none",
          transition: "backdrop-filter .25s ease",
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
          onLayoutAnimationComplete={() => setSettled(true)}
          drag="y" dragControls={dragControls} dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.55 }}
          onDragEnd={(e, info) => { if (info.offset.y > 110 || info.velocity.y > 650) onClose(); }}
          style={{
            width: "100%", maxWidth: 430,
            // Transparant: de scroll-overscroll (rubber-band omlaag) laat zo de wazige
            // backdrop erachter zien i.p.v. wit. De zwarte header + witte body eronder
            // (elk met eigen achtergrond) dekken de sheet in normale weergave volledig.
            background: "transparent",
            borderRadius: "24px 24px 0 0",
            maxHeight: "92vh", overflowY: "auto", overscrollBehaviorY: "contain",
            boxShadow: "0 -4px 60px rgba(0,0,0,0.15)",
            pointerEvents: "all",
          }}
        >
          <div
            style={{ background: "#0F0E0C", padding: "20px 20px 24px", borderRadius: "24px 24px 0 0" }}
          >
            <div onPointerDown={(e) => dragControls.start(e)} style={{ padding: "6px 0 12px", margin: "-6px 0 4px", cursor: "grab", touchAction: "none" }}>
              <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, margin: "0 auto" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>
                  {product.title}
                </div>
                <div style={{ fontSize: 12.5, color: "#888", marginTop: 4 }}>
                  {product.platform}{product.source_url ? <> · {tr("product.rawLinkLabel","raw link: ")}<a href={product.source_url} target="_blank" rel="noreferrer" style={{ color: "#FF7A1A", wordBreak: "break-all" }}>{product.source_url}</a></> : null}
                </div>
              </div>
              <motion.button
                whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.85 }}
                onClick={onClose}
                style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 10, padding: "8px 12px", cursor: "pointer", fontSize: 16, color: "#fff" }}
              >✕</motion.button>
            </div>
          </div>

          <motion.div variants={stagger} initial="initial" animate="animate" style={{ background: "#fff", padding: "24px 20px 40px" }}>

            {/* Productafbeelding — morpht vanuit de feed-kaart, wisselt mee met de gekozen optie */}
            {displayImage && (
              <motion.div layoutId={`pimg-${product.id}`} transition={spring} onClick={() => photos.length && setZoomOpen(true)} style={{ marginBottom: product.description ? 16 : 24, borderRadius: 16, overflow: "hidden", aspectRatio: "4 / 5", background: "#fff", position: "relative", cursor: photos.length ? "zoom-in" : "default" }}>
                {photos.length > 0 && <div style={{ position: "absolute", bottom: 10, right: 10, zIndex: 2, background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 10.5, padding: "3px 8px", borderRadius: 8, pointerEvents: "none" }}>{tr("product.tapToZoom","tap to zoom")}</div>}
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.img key={displayImage} ref={imgRef} src={displayImage} alt={product.title} decoding="async" fetchPriority="high"
                    initial={{ opacity: 0, scale: 1.04 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </AnimatePresence>
              </motion.div>
            )}
            {/* Zware inhoud (galerij t/m knoppen) laadt pas ná de morph. De spacer houdt de
                sheet zolang op ~eindhoogte, zodat de morph meteen op de juiste rect landt en
                de sheet niet nagroeit als de content erin valt. */}
            {!settled && <div style={{ height: "40vh" }} />}
            {settled && (<>
            {photos.length > 1 && (
              <motion.div variants={fadeUp} style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: product.description ? 16 : 24, paddingBottom: 2 }}>
                {photos.map((url) => {
                  const active = displayImage === url;
                  return (
                    <button key={url} onClick={() => setGalleryPhoto(url)}
                      style={{ flexShrink: 0, width: 54, height: 54, borderRadius: 10, overflow: "hidden", border: `2px solid ${active ? "#FF5C00" : "#E8E6E0"}`, background: "#fff", padding: 0, cursor: "pointer" }}>
                      <img src={url} referrerPolicy="no-referrer" alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </button>
                  );
                })}
              </motion.div>
            )}

            {/* Kleur/size-keuze bovenaan: zo ziet de klant direct hoe elke kleur eruitziet
                (de gekozen optie wisselt de hoofdfoto). Rest van de volgorde blijft gelijk. */}
            {productVariants && productVariants.map((variant) => {
              const missing = missingVariants.includes(variant.name);
              return (
              <motion.div key={variant.name} variants={fadeUp} style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: missing ? "#DC2626" : "#0F0E0C", marginBottom: 10 }}>
                  {variant.name}
                  {missing && <span style={{ color: "#DC2626", fontWeight: 700, marginLeft: 8 }}>{tr("product.chooseOption","· Choose an option")}</span>}
                </div>
                <motion.div animate={missing ? { x: [0, -8, 8, -6, 6, 0] } : { x: 0 }} transition={{ duration: 0.4 }} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {variant.options.map(opt => {
                    const oos = isOos(variant.name, opt);
                    return (
                    <motion.button key={opt}
                      whileHover={oos ? {} : { scale: 1.05 }}
                      whileTap={oos ? {} : { scale: 0.85 }}
                      animate={{ scale: !oos && selectedVariants[variant.name] === opt ? [1, 1.15, 1] : 1 }}
                      transition={{ duration: 0.3, type: "spring", stiffness: 300 }}
                      onClick={() => { if (oos) return; setSelectedVariants({ ...selectedVariants, [variant.name]: opt }); setMissingVariants(m => m.filter(n => n !== variant.name)); const vimg = product.variant_images?.[opt]; if (vimg && vimg.startsWith("http")) setGalleryPhoto(vimg); }}
                      style={{ position: "relative", padding: "10px 18px", borderRadius: 12, border: `1.5px solid ${oos ? "#EAE7E0" : selectedVariants[variant.name] === opt ? "#0F0E0C" : missing ? "#FCA5A5" : "#E8E6E0"}`, background: oos ? "#F3F1EC" : selectedVariants[variant.name] === opt ? "#0F0E0C" : "#fff", color: oos ? "#B6B2AB" : selectedVariants[variant.name] === opt ? "#fff" : "#555", fontSize: 13, fontWeight: 600, cursor: oos ? "not-allowed" : "pointer" }}>
                      {!oos && selectedVariants[variant.name] === opt && (
                        <motion.svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ marginRight: 6, verticalAlign: "-1px" }}>
                          <motion.path d="M4 12.5L9.5 18L20 6.5" stroke="#FF5C00" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
                            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.22, ease: "easeOut" }} />
                        </motion.svg>
                      )}
                      <span style={{ textDecoration: oos ? "line-through" : "none" }}>{opt}</span>
                      {oos && <span style={{ display: "block", fontSize: 9, fontWeight: 700, color: "#DC2626", letterSpacing: 0.3, marginTop: 1 }}>{tr("product.outOfStock","OUT OF STOCK")}</span>}
                    </motion.button>
                    );
                  })}
                </motion.div>
              </motion.div>
              );
            })}

            {comboOos && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                style={{ marginTop: -10, marginBottom: 20, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "9px 12px", fontSize: 12, fontWeight: 600, color: "#DC2626" }}>
                ✕ {tr("product.comboSoldOut","This combination is sold out at the factory — try a different option.")}
              </motion.div>
            )}

            {/* Beschrijving */}
            {product.description && (
              <motion.div variants={fadeUp} style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 6 }}>{tr("product.descriptionHeading","Description")}</div>
                <div style={{ fontSize: 13, color: "#555", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{product.description}</div>
              </motion.div>
            )}

            {product.material?.length > 0 && (
              <motion.div variants={fadeUp} style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 8 }}>{tr("product.materialsHeading","Materials")}</div>
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

            {/* Prijs — duidelijk boven Quantity, in euro én yuan, plus de China-verzending. */}
            {(() => {
              const KOERS = 7.8;
              const priceEur = Number(product.price) || 0;
              const shipCny = 5;
              return (
                <motion.div variants={fadeUp} style={{ background: "#F8F7F4", borderRadius: 14, padding: "14px 16px", marginBottom: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 13, color: "#6B6862", fontWeight: 600 }}>{tr("product.factoryPrice","Factory price")}</span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: "#111" }}>
                      {/* prijs-stempel: de échte fabrieksprijs wordt "gestempeld" */}
                      <motion.span initial={{ scale: 1.7, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }}
                        transition={{ type: "spring", stiffness: 480, damping: 20, delay: 0.18 }}
                        style={{ display: "inline-block" }}>€{priceEur.toFixed(2)}</motion.span>
                      {" "}<span style={{ fontSize: 13, color: "#A8A5A0", fontWeight: 600 }}>· ¥{(priceEur * KOERS).toFixed(2)}</span>
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 7 }}>
                    <span style={{ fontSize: 12.5, color: "#8A8780" }}>{tr("product.chinaShipping","China shipping")}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: "#111" }}>€{(shipCny / KOERS).toFixed(2)} <span style={{ fontSize: 12, color: "#A8A5A0", fontWeight: 600 }}>· ¥{shipCny}</span></span>
                  </div>
                </motion.div>
              );
            })()}

            {/* Aantal */}
            <motion.div variants={fadeUp} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 10 }}>{tr("product.quantity","Quantity")}</div>
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

            {(product.size_chart?.measures?.length > 0 || product.size_chart?.image) && (
              <motion.button variants={fadeUp} type="button" onClick={() => setShowSizeGuide(true)}
                style={{ width: "100%", marginBottom: 16, background: "#F8F7F4", color: "#111", border: "1px solid #E8E6E0", borderRadius: 12, padding: "12px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {tr("product.sizeGuideButton","📐 Size guide")}
              </motion.button>
            )}

            {error && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                style={{ background: "#FEE2E2", color: "#DC2626", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>
                {error}
              </motion.div>
            )}

            {activeGroup && (
              <>
                <motion.div variants={fadeUp} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,92,0,0.1)", border: "1px solid rgba(255,92,0,0.3)", borderRadius: 12, padding: "10px 13px", marginBottom: 10, fontSize: 12.5, color: "#B45309" }}>
                  <Fox /> {tr("product.shoppingForGroup", "Shopping for {group} · bought into the group now, one fee at shipping", { group: activeGroup.name })}
                </motion.div>
                <motion.button variants={fadeUp} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }}
                  onClick={handleAddToGroup} disabled={loading || addedToGroup}
                  style={{ width: "100%", marginBottom: 8, background: addedToGroup ? "#16A34A" : "#FF5C00", color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontSize: 15, fontWeight: 700, cursor: loading ? "default" : "pointer" }}>
                  {addedToGroup ? tr("product.boughtForGroup","✓ Bought for {group}",{ group: activeGroup.name }) : loading ? tr("product.buying","Buying…") : tr("product.buyForGroup","+ Buy for {group}",{ group: activeGroup.name })}
                </motion.button>
                <motion.button variants={fadeUp} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }}
                  onClick={handleShareToGroup} disabled={loading}
                  style={{ width: "100%", background: sharedToGroup ? "rgba(52,209,123,0.15)" : "rgba(255,92,0,0.08)", color: sharedToGroup ? "#16A34A" : "#FF5C00", border: `1.5px solid ${sharedToGroup ? "rgba(52,209,123,0.4)" : "rgba(255,92,0,0.35)"}`, borderRadius: 14, padding: "13px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                  {sharedToGroup ? tr("product.sharedToGroup","✓ Shared to the group") : tr("product.shareToGroup","↗ Share to group")}
                </motion.button>
              </>
            )}
            {onAddToList && !activeGroup && (groupLocked ? (
              <div style={{ width: "100%", background: "#F1EFEA", color: "#9C9893", borderRadius: 14, padding: "16px", fontSize: 15, fontWeight: 700, textAlign: "center" }}>
                {tr("product.groupLocked","🔒 Group locked")}
              </div>
            ) : (
              <motion.button
                variants={fadeUp}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }}
                onClick={handleAddToList}
                disabled={loading}
                style={{ width: "100%", background: "#FF5C00", color: "#fff", border: "none", borderRadius: 14, padding: "16px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
              >
                {tr("product.addToCart","+ Add to cart{count}",{ count: listCount > 0 ? ` (${listCount})` : "" })}
              </motion.button>
            ))}
            <motion.button variants={fadeUp} whileTap={{ scale: 0.95 }}
              onClick={() => onToggleFavorite?.()}
              style={{ width: "100%", marginTop: 8, background: "transparent", color: isFavorite ? "#FF5C00" : "#8A8780", border: "none", padding: "11px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              {isFavorite ? tr("product.removeFromFavorites","★ Remove from favorites") : tr("product.addToFavorites","☆ Add to favorites")}
            </motion.button>
            </>)}
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
              <div style={{ fontSize: 18, fontWeight: 700, color: "#0F0E0C" }}>{tr("product.sizeGuideTitle","Size guide")}</div>
              <button onClick={() => setShowSizeGuide(false)} style={{ background: "#F3F1ED", border: "none", borderRadius: 999, width: 30, height: 30, fontSize: 15, color: "#777", cursor: "pointer" }}>✕</button>
            </div>
            {sc.image && (
              <img src={sc.image} referrerPolicy="no-referrer" alt="size chart" style={{ width: "100%", borderRadius: 12, display: "block", marginBottom: sc.measures?.length > 0 ? 16 : 0 }} />
            )}
            {sc.measures?.length > 0 && (
              <>
                <div style={{ fontSize: 12, color: "#8A8780", marginBottom: 12 }}>{tr("product.sizeGuideMeasurementsHint","Measurements in cm — the colors match the sketch below.")}</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr>
                    <th style={{ textAlign: "left", padding: "7px 4px", color: "#888", fontWeight: 600, borderBottom: "1px solid #ECEAE5" }}>{tr("product.sizeColumnHeader","Size")}</th>
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
    {zoomOpen && <PhotoZoom photos={photos} index={Math.max(0, photos.indexOf(displayImage))} onClose={() => setZoomOpen(false)} />}
    </>
  );
}