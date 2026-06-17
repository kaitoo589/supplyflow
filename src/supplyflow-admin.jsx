import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { adminCategories, clothesCategories } from "./categories";

const platforms = ["1688", "Taobao", "Weidian", "Alibaba"];
const categories = adminCategories;
const emptyProduct = { title: "", price: "", moq: "", platform: "1688", source_url: "", category: "Accessories", variants: [] };

function ProductForm({ product, onSave, onCancel, eurRate, title, saveLabel }) {
  const [form, setForm] = useState({
    title: product.title || "",
    price: product.price ? `€${parseFloat(product.price).toFixed(2)}` : "",
    moq: product.moq || "",
    platform: product.platform || "1688",
    source_url: product.source_url || "",
    category: product.category || "Accessories",
    subcategory: product.subcategory || "",
    supplier: (product.supplier && !platforms.includes(product.supplier)) ? product.supplier : "",
    description: product.description || "",
    variants: product.sizes || [],
  });
  const [variantImages, setVariantImages] = useState(product.variant_images || {});
  const [uploadingOption, setUploadingOption] = useState(null);
  const [yuanPrice, setYuanPrice] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(product.image?.startsWith("http") ? product.image : null);
  const [previewImages, setPreviewImages] = useState(product.preview_images || []);
  const [uploadingPreview, setUploadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [newVariantName, setNewVariantName] = useState("");
  const [newOptionInputs, setNewOptionInputs] = useState({});

  const addVariant = () => {
    if (!newVariantName.trim()) return;
    setForm({ ...form, variants: [...form.variants, { name: newVariantName.trim(), options: [] }] });
    setNewVariantName("");
  };

  const removeVariant = (i) => {
    setForm({ ...form, variants: form.variants.filter((_, idx) => idx !== i) });
  };

  const addOption = (vi) => {
    const val = (newOptionInputs[vi] || "").trim();
    if (!val) return;
    const variants = form.variants.map((v, i) => i === vi ? { ...v, options: [...v.options, val] } : v);
    setForm({ ...form, variants });
    setNewOptionInputs({ ...newOptionInputs, [vi]: "" });
  };

  const removeOption = (vi, oi) => {
    const variants = form.variants.map((v, i) => i === vi ? { ...v, options: v.options.filter((_, idx) => idx !== oi) } : v);
    setForm({ ...form, variants });
  };

  // Koppel een foto aan een specifieke optie (bijv. "Wit" → foto van het witte shirt).
  const uploadOptionImage = async (opt, file) => {
    if (!file) return;
    setUploadingOption(opt);
    const ext = file.name.split(".").pop();
    const fileName = `variant-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(fileName, file);
    setUploadingOption(null);
    if (error) { alert("Upload mislukt: " + error.message); return; }
    const { data } = supabase.storage.from("product-images").getPublicUrl(fileName);
    setVariantImages(prev => ({ ...prev, [opt]: data.publicUrl }));
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const uploadImage = async () => {
    if (!imageFile) return null;
    setUploadingImage(true);
    const ext = imageFile.name.split(".").pop();
    const fileName = `${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(fileName, imageFile);
    setUploadingImage(false);
    if (error) { alert("Upload mislukt: " + error.message); return null; }
    const { data } = supabase.storage.from("product-images").getPublicUrl(fileName);
    return data.publicUrl;
  };

  const handlePreviewUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploadingPreview(true);
    const urls = [];
    for (const file of files) {
      const ext = file.name.split(".").pop();
      const fileName = `preview-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(fileName, file);
      if (!error) {
        const { data } = supabase.storage.from("product-images").getPublicUrl(fileName);
        urls.push(data.publicUrl);
      }
    }
    setPreviewImages([...previewImages, ...urls]);
    setUploadingPreview(false);
  };

  const removePreviewImage = (i) => {
    setPreviewImages(previewImages.filter((_, idx) => idx !== i));
  };

  const handleSave = async () => {
    if (!form.title) return;
    setSaving(true);
    const icons = { Clothes: "👕", Accessories: "👜", Home: "🏠", Tech: "💻", Sports: "⚽" };
    const priceValue = parseFloat(String(form.price).replace("~€", "").replace("€", "")) || 0;

    let imageValue = product.image || icons[form.category] || "📦";
    if (imageFile) {
      const url = await uploadImage();
      if (url) imageValue = url;
    } else if (imagePreview && imagePreview.startsWith("http")) {
      imageValue = imagePreview;
    }

    await onSave({
      title: form.title,
      price: priceValue,
      moq: parseInt(form.moq) || 1,
      platform: form.platform,
      source_url: form.source_url,
      category: form.category,
      subcategory: form.category === "Clothes" ? (form.subcategory || null) : null,
      image: imageValue,
      colors: [],
      sizes: form.variants,
      supplier: form.supplier.trim() || form.platform,
      description: form.description,
      variant_images: variantImages,
      preview_images: previewImages,
    });
    setSaving(false);
  };

  return (
    <div style={{ background: "#fff", border: "1.5px solid #FF5C00", borderRadius: 14, padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#0F0E0C", marginBottom: 12 }}>{title}</div>

      <input placeholder="Productnaam" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
        style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 8, boxSizing: "border-box", background: "#F8F7F4" }} />

      <input placeholder="1688 / Taobao / Weidian link" value={form.source_url} onChange={e => setForm({ ...form, source_url: e.target.value })}
        style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 8, boxSizing: "border-box", background: "#F8F7F4" }} />

      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <input type="number" placeholder="Prijs in ¥ Yuan" value={yuanPrice}
          onChange={e => {
            setYuanPrice(e.target.value);
            if (eurRate && e.target.value) {
              const eur = (parseFloat(e.target.value) * eurRate).toFixed(2);
              setForm(p => ({ ...p, price: `~€${eur}` }));
            } else {
              setForm(p => ({ ...p, price: "" }));
            }
          }}
          style={{ flex: 1, border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, background: "#F8F7F4" }} />
        {yuanPrice && eurRate && (
          <div style={{ fontSize: 13, color: "#10B981", fontWeight: 700, whiteSpace: "nowrap" }}>
            ≈ €{(parseFloat(yuanPrice) * eurRate).toFixed(2)}
          </div>
        )}
      </div>

      <input placeholder="Of typ prijs handmatig (bijv. ~€12.50)" value={form.price}
        onChange={e => { setForm({ ...form, price: e.target.value }); setYuanPrice(""); }}
        style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 8, boxSizing: "border-box", background: "#F8F7F4" }} />

      <input type="number" placeholder="Minimum aantal (MOQ)" value={form.moq} onChange={e => setForm({ ...form, moq: e.target.value })}
        style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 8, boxSizing: "border-box", background: "#F8F7F4" }} />

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })}
          style={{ flex: 1, border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, background: "#F8F7F4" }}>
          {platforms.map(p => <option key={p}>{p}</option>)}
        </select>
        <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value, subcategory: "" })}
          style={{ flex: 1, border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, background: "#F8F7F4" }}>
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      {/* Subcategorie (alleen bij Clothes) */}
      {form.category === "Clothes" && (
        <select value={form.subcategory} onChange={e => setForm({ ...form, subcategory: e.target.value })}
          style={{ width: "100%", border: "1.5px solid " + (form.subcategory ? "#E8E6E0" : "#FF5C00"), borderRadius: 8, padding: "10px 12px", fontSize: 13, background: "#F8F7F4", marginBottom: 12, boxSizing: "border-box" }}>
          <option value="">— Kies een subcategorie —</option>
          {clothesCategories.map(grp => (
            <optgroup key={grp.group} label={grp.group}>
              {grp.items.map(it => <option key={grp.group + it} value={it}>{it}</option>)}
            </optgroup>
          ))}
        </select>
      )}

      <input placeholder="Leverancier / factory naam (bijv. Guangzhou Leathercraft Co.)" value={form.supplier}
        onChange={e => setForm({ ...form, supplier: e.target.value })}
        style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 8, boxSizing: "border-box", background: "#F8F7F4" }} />

      <textarea placeholder="Productbeschrijving — klanten zien dit op de aanvraagpagina" value={form.description}
        onChange={e => setForm({ ...form, description: e.target.value })} rows={3}
        style={{ width: "100%", border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 12, boxSizing: "border-box", background: "#F8F7F4", fontFamily: "inherit", resize: "vertical" }} />

      {/* Productafbeelding */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 8 }}>Productafbeelding <span style={{ color: "#aaa", fontWeight: 400 }}>(optioneel)</span></div>
        <label style={{ display: "block", border: "1.5px dashed #E8E6E0", borderRadius: 10, padding: 16, textAlign: "center", cursor: "pointer", background: imagePreview ? "#F0FDF4" : "#F8F7F4" }}>
          {imagePreview ? (
            <img src={imagePreview} alt="preview" style={{ maxHeight: 120, maxWidth: "100%", borderRadius: 8, objectFit: "contain" }} />
          ) : (
            <div>
              <div style={{ fontSize: 24, marginBottom: 6 }}>📷</div>
              <div style={{ fontSize: 12, color: "#aaa" }}>Klik om afbeelding te kiezen</div>
            </div>
          )}
          <input type="file" accept="image/*" onChange={handleImageChange} style={{ display: "none" }} />
        </label>
        {imagePreview && (
          <button onClick={() => { setImageFile(null); setImagePreview(null); }} style={{ marginTop: 6, background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>
            Afbeelding verwijderen
          </button>
        )}
      </div>

      {/* Product preview foto's */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 4 }}>Product preview foto's</div>
        <div style={{ fontSize: 12, color: "#aaa", marginBottom: 8 }}>Foto's die klanten zien als ze op "Product preview" klikken</div>
        {previewImages.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
            {previewImages.map((url, i) => (
              <div key={i} style={{ position: "relative", borderRadius: 8, overflow: "hidden", aspectRatio: "1" }}>
                <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <button onClick={() => removePreviewImage(i)} style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: 6, width: 22, height: 22, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
              </div>
            ))}
          </div>
        )}
        <label style={{ display: "block", border: "1.5px dashed #E8E6E0", borderRadius: 10, padding: 12, textAlign: "center", cursor: "pointer", background: "#F8F7F4" }}>
          <div style={{ fontSize: 20, marginBottom: 4 }}>🖼️</div>
          <div style={{ fontSize: 12, color: "#aaa" }}>{uploadingPreview ? "Uploaden..." : "Klik om foto's toe te voegen (meerdere mogelijk)"}</div>
          <input type="file" accept="image/*" multiple onChange={handlePreviewUpload} style={{ display: "none" }} disabled={uploadingPreview} />
        </label>
      </div>

      {/* Varianten */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 8 }}>Varianten <span style={{ color: "#aaa", fontWeight: 400 }}>(bijv. Kleur, Size, Voltage)</span></div>
        {form.variants.map((variant, vi) => (
          <div key={vi} style={{ background: "#F8F7F4", borderRadius: 10, padding: 12, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C" }}>{variant.name}</span>
              <button onClick={() => removeVariant(vi)} style={{ background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 12, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {variant.options.map((opt, oi) => (
                <span key={oi} style={{ display: "flex", alignItems: "center", gap: 4, background: "#0F0E0C", color: "#FF5C00", fontSize: 12, padding: "4px 10px", borderRadius: 8 }}>
                  {opt}
                  <button onClick={() => removeOption(vi, oi)} style={{ background: "none", border: "none", color: "#FF5C00", cursor: "pointer", fontSize: 12, padding: 0 }}>✕</button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input placeholder="Optie toevoegen..." value={newOptionInputs[vi] || ""}
                onChange={e => setNewOptionInputs({ ...newOptionInputs, [vi]: e.target.value })}
                onKeyDown={e => e.key === "Enter" && addOption(vi)}
                style={{ flex: 1, border: "1px solid #E8E6E0", borderRadius: 8, padding: "8px 10px", fontSize: 12, background: "#fff" }} />
              <button onClick={() => addOption(vi)} style={{ background: "#0F0E0C", color: "#FF5C00", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 14, cursor: "pointer" }}>+</button>
            </div>

            {/* Foto per optie: klant ziet deze foto als hij de optie kiest */}
            {variant.options.length > 0 && (
              <div style={{ marginTop: 10, borderTop: "1px solid #E8E6E0", paddingTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 6 }}>📷 Foto per optie <span style={{ fontWeight: 400 }}>(optioneel — klant ziet deze foto bij het kiezen)</span></div>
                {variant.options.map((opt) => (
                  <div key={opt} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 8, background: "#fff", border: "1px solid #E8E6E0", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                      {variantImages[opt] ? <img src={variantImages[opt]} alt={opt} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "🖼️"}
                    </div>
                    <span style={{ fontSize: 12, color: "#0F0E0C", fontWeight: 600, flex: 1 }}>{opt}</span>
                    <label style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: "#6366F1", cursor: "pointer" }}>
                      {uploadingOption === opt ? "Uploaden..." : variantImages[opt] ? "Wijzigen" : "Foto kiezen"}
                      <input type="file" accept="image/*" style={{ display: "none" }} disabled={uploadingOption === opt}
                        onChange={e => uploadOptionImage(opt, e.target.files[0])} />
                    </label>
                    {variantImages[opt] && (
                      <button onClick={() => setVariantImages(prev => { const n = { ...prev }; delete n[opt]; return n; })}
                        style={{ background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 6, padding: "5px 8px", fontSize: 11, cursor: "pointer" }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div style={{ display: "flex", gap: 6 }}>
          <input placeholder="Naam variant (bijv. Kleur, Size)" value={newVariantName}
            onChange={e => setNewVariantName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addVariant()}
            style={{ flex: 1, border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, background: "#F8F7F4" }} />
          <button onClick={addVariant} style={{ background: "#0F0E0C", color: "#FF5C00", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 16, cursor: "pointer" }}>+</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onCancel} style={{ flex: 1, background: "#F8F7F4", color: "#666", border: "1px solid #E8E6E0", borderRadius: 8, padding: "12px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          Annuleren
        </button>
        <button onClick={handleSave} disabled={saving || uploadingImage || uploadingPreview} style={{ flex: 2, background: saving || uploadingImage || uploadingPreview ? "#E8E6E0" : "#0F0E0C", color: "#FF5C00", border: "none", borderRadius: 8, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          {uploadingPreview ? "Foto's uploaden..." : uploadingImage ? "Uploaden..." : saving ? "Opslaan..." : saveLabel}
        </button>
      </div>
    </div>
  );
}

const txTypeLabels = {
  top_up: "Stortingen (iDEAL)",
  order: "Bestellingen",
  shipping: "Verzendkosten",
  refund: "Refunds",
  buffer_return: "Buffer teruggave",
};

function FinanceTab() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bufferInput, setBufferInput] = useState("");
  const [savingBuffer, setSavingBuffer] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_finance_overview");
    if (error || data?.ok === false) {
      setError(error?.message || data?.error);
    } else {
      setOverview(data);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const saveBuffer = async () => {
    const value = parseFloat(String(bufferInput).replace(",", "."));
    if (isNaN(value) || value < 0) return;
    setSavingBuffer(true);
    const { data, error } = await supabase.rpc("admin_set_wise_buffer", { p_balance: value });
    setSavingBuffer(false);
    if (error || data?.ok === false) { alert("Opslaan mislukt: " + (error?.message || data?.error)); return; }
    setBufferInput("");
    load();
  };

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#999" }}>Laden...</div>;

  if (error) return (
    <div style={{ background: "#FEE2E2", border: "1px solid #FECACA", borderRadius: 14, padding: 16, color: "#DC2626", fontSize: 13 }}>
      Overzicht laden mislukt: {error}
      <div style={{ marginTop: 8, color: "#991B1B", fontSize: 12 }}>
        Heb je <b>finance-hardening.sql</b> al uitgevoerd in de Supabase SQL Editor?
      </div>
    </div>
  );

  const buffer = overview.buffer_eur ?? 0;
  const bufferTone = buffer < 200
    ? { bg: "#FEE2E2", color: "#DC2626", label: "⚠️ Onder de €200 — transfers naar je agent kunnen mislukken. Vul de buffer aan via je bank → Wise (SEPA)." }
    : buffer < 500
      ? { bg: "#FEF3C7", color: "#B45309", label: "Buffer raakt laag — plan je wekelijkse aanvulling." }
      : { bg: "#F0FDF4", color: "#10B981", label: "Buffer is gezond." };

  const mismatchOk = Math.abs(overview.mismatch ?? 0) < 0.005;

  return (
    <div>
      {/* Wise buffer */}
      <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 2 }}>Wise buffer</div>
        <div style={{ fontSize: 11, color: "#aaa", marginBottom: 10 }}>
          Werkkapitaal waarmee transfers naar je agent betaald worden
          {overview.buffer_updated_at && ` · laatst bijgewerkt ${new Date(overview.buffer_updated_at).toLocaleDateString("nl-NL")}`}
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, color: "#0F0E0C", marginBottom: 8 }}>€{Number(buffer).toFixed(2)}</div>
        <div style={{ background: bufferTone.bg, color: bufferTone.color, borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 600, marginBottom: 12 }}>
          {bufferTone.label}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="number" placeholder="Nieuwe stand in € (na je Wise-overboeking)" value={bufferInput}
            onChange={e => setBufferInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && saveBuffer()}
            style={{ flex: 1, border: "1px solid #E8E6E0", borderRadius: 8, padding: "10px 12px", fontSize: 13, background: "#F8F7F4" }} />
          <button onClick={saveBuffer} disabled={savingBuffer || !bufferInput}
            style={{ background: savingBuffer || !bufferInput ? "#E8E6E0" : "#0F0E0C", color: "#FF5C00", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {savingBuffer ? "..." : "Bijwerken"}
          </button>
        </div>
      </div>

      {/* Reconciliatie */}
      <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 2 }}>Reconciliatie</div>
        <div style={{ fontSize: 11, color: "#aaa", marginBottom: 12 }}>
          De som van alle klantbalances moet exact gelijk zijn aan de som van alle transacties
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #F0EEE8" }}>
          <span style={{ fontSize: 13, color: "#666" }}>Klantbalances ({overview.customers} accounts)</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C" }}>€{Number(overview.sum_balances).toFixed(2)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #F0EEE8" }}>
          <span style={{ fontSize: 13, color: "#666" }}>Som van transacties</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C" }}>€{Number(overview.sum_transactions).toFixed(2)}</span>
        </div>

        <div style={{ background: mismatchOk ? "#F0FDF4" : "#FEE2E2", color: mismatchOk ? "#10B981" : "#DC2626", borderRadius: 8, padding: "10px 12px", fontSize: 12, fontWeight: 700, marginTop: 12 }}>
          {mismatchOk
            ? "✓ Alles klopt — geen verschil"
            : `⚠️ Verschil van €${Number(overview.mismatch).toFixed(2)} — er is balance gewijzigd zonder transactie-log (of andersom)`}
        </div>
      </div>

      {/* Per type */}
      <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C", marginBottom: 10 }}>Geldstromen per type</div>
        {Object.keys(overview.per_type || {}).length === 0 && (
          <div style={{ fontSize: 12, color: "#aaa" }}>Nog geen transacties</div>
        )}
        {Object.entries(overview.per_type || {}).map(([type, total]) => (
          <div key={type} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #F0EEE8" }}>
            <span style={{ fontSize: 13, color: "#666" }}>{txTypeLabels[type] || type}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: Number(total) < 0 ? "#DC2626" : "#10B981" }}>
              {Number(total) < 0 ? "−" : "+"}€{Math.abs(Number(total)).toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      <button onClick={load} style={{ width: "100%", background: "#F8F7F4", color: "#666", border: "1px solid #E8E6E0", borderRadius: 10, padding: "11px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
        ↻ Vernieuwen
      </button>
    </div>
  );
}

export default function SupplyFlowAdmin({ session }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [eurRate, setEurRate] = useState(null);
  const [tab, setTab] = useState("products");

  useEffect(() => {
    fetchProducts();
    fetch(`https://v6.exchangerate-api.com/v6/${import.meta.env.VITE_EXCHANGE_API_KEY}/latest/CNY`)
      .then(r => r.json())
      .then(d => setEurRate(d.conversion_rates?.EUR));
  }, []);

  const fetchProducts = async () => {
    const { data } = await supabase.from("products").select("*").order("id");
    setProducts(data || []);
    setLoading(false);
  };

  const addProduct = async (data) => {
    const { error } = await supabase.from("products").insert({ ...data, rating: 0 });
    if (!error) { setShowAddProduct(false); fetchProducts(); }
  };

  const updateProduct = async (id, data) => {
    const { error } = await supabase.from("products").update(data).eq("id", id);
    if (!error) { setEditingId(null); fetchProducts(); }
  };

  const removeProduct = async (id) => {
    await supabase.from("products").delete().eq("id", id);
    fetchProducts();
  };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#F8F7F4", minHeight: "100vh", maxWidth: 480, margin: "0 auto" }}>
      <div style={{ background: "#0F0E0C", padding: "20px 20px 16px" }}>
        <div style={{ color: "#FF5C00", fontSize: 11, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", marginBottom: 2 }}>SupplyFlow</div>
        <div style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>Admin panel</div>
        <div style={{ color: "#666", fontSize: 13, marginTop: 2 }}>{products.length} producten in de feed</div>

        {/* Tabbladen */}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          {[["products", "Producten"], ["finance", "Financiën"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              style={{
                background: tab === id ? "#FF5C00" : "rgba(255,255,255,0.08)",
                color: tab === id ? "#fff" : "#999",
                border: "none", borderRadius: 10, padding: "8px 16px",
                fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "finance" && (
        <div style={{ padding: "16px 20px 32px" }}>
          <FinanceTab />
        </div>
      )}

      {tab === "products" && (
      <div style={{ padding: "16px 20px 32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0F0E0C" }}>Producten</div>
          <button onClick={() => { setShowAddProduct(!showAddProduct); setEditingId(null); }} style={{ background: "#FF5C00", color: "#fff", border: "none", borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {showAddProduct ? "Annuleren" : "+ Product toevoegen"}
          </button>
        </div>

        {showAddProduct && (
          <ProductForm
            product={emptyProduct}
            onSave={addProduct}
            onCancel={() => setShowAddProduct(false)}
            eurRate={eurRate}
            title="Nieuw product"
            saveLabel="Product toevoegen →"
          />
        )}

        {loading && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>Laden...</div>}

        {products.map(product => (
          <div key={product.id}>
            {editingId === product.id ? (
              <ProductForm
                product={product}
                onSave={(data) => updateProduct(product.id, data)}
                onCancel={() => setEditingId(null)}
                eurRate={eurRate}
                title="Product bewerken"
                saveLabel="Opslaan →"
              />
            ) : (
              <div style={{ background: "#fff", border: "1px solid #E8E6E0", borderRadius: 14, padding: "14px 16px", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: "#F0EEE8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0, overflow: "hidden" }}>
                    {product.image?.startsWith("http") ? (
                      <img src={product.image} alt={product.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : product.image}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0F0E0C", marginBottom: 2 }}>{product.title}</div>
                    <div style={{ fontSize: 11, color: "#aaa", marginBottom: 4 }}>{product.platform} · {product.category}{product.subcategory ? ` · ${product.subcategory}` : ""}{product.supplier && !platforms.includes(product.supplier) ? ` · 🏭 ${product.supplier}` : ""}</div>
                    <div style={{ display: "flex", gap: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#0F0E0C" }}>€{parseFloat(product.price).toFixed(2)}</span>
                      <span style={{ fontSize: 12, color: "#aaa" }}>MOQ {product.moq}</span>
                    </div>
                    {product.sizes?.length > 0 && <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Varianten: {product.sizes.map(v => v.name).join(", ")}</div>}
                    {product.preview_images?.length > 0 && <div style={{ fontSize: 11, color: "#10B981", marginTop: 2 }}>✓ {product.preview_images.length} preview foto's</div>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <button onClick={() => { setEditingId(product.id); setShowAddProduct(false); }} style={{ background: "#EDE9FE", color: "#6366F1", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>✏️</button>
                    <button onClick={() => removeProduct(product.id)} style={{ background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>✕</button>
                  </div>
                </div>
                {product.source_url && (
                  <div style={{ marginTop: 10, background: "#F8F7F4", borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 11, color: "#aaa", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{product.source_url}</div>
                    <a href={product.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 600, color: "#6366F1", marginLeft: 8, textDecoration: "none" }}>Open →</a>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}