// Flowva — live BuckyDrop-prijscheck bij checkout (vóór afschrijven).
// Vergelijkt de opgeslagen ¥-prijs per cart-item met de actuele BuckyDrop-prijs.
// Bij een te grote stijging (of al gevlagd / uitverkocht) wordt het product gevlagd
// (price_alert + hidden) en als "changed" teruggegeven, zodat de checkout het item
// blokkeert vóór betaling. READ-ONLY t.o.v. orders; muteert alleen de product-vlag.
//
// verify_jwt=false; alleen ingelogde klanten; gebruikt SERVICE_ROLE (de klant heeft
// geen admin-rol) + de BUCKY-secrets server-side. Geeft NOOIT rauwe ¥/skuCode/spuCode terug.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_CODE = Deno.env.get("BUCKY_APP_CODE")!;
const APP_SECRET = Deno.env.get("BUCKY_APP_SECRET")!;
const BUCKY_DOMAIN = Deno.env.get("BUCKY_DOMAIN") ?? "https://dev.buckydrop.com";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Vlaggen bij >1% stijging; een prijsdaling deert de klant niet en een kleine marge
// vangt ¥-rounding op (anders valse alarmen).
const THRESHOLD = 0.01;

const md5Hex = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

// Zelfde signing als place-bucky-order: sign = MD5(appCode + body + ts + appSecret).
async function buckyPost(path: string, bodyObj: unknown) {
  const body = JSON.stringify(bodyObj ?? {});
  const ts = Date.now().toString();
  const sign = md5Hex(APP_CODE + body + ts + APP_SECRET);
  const url = `${BUCKY_DOMAIN}${path}?appCode=${APP_CODE}&timestamp=${ts}&sign=${sign}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", lang: "en" }, body });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { success: false, info: text || `HTTP ${res.status}` }; }
}

// "Size: M, Color: Blue" → { Size: "M", Color: "Blue" } — identiek aan place-bucky-order.
function parseKleur(kleur: string) {
  const map: Record<string, string> = {};
  (kleur || "").split(",").forEach((part) => {
    const idx = part.indexOf(":");
    if (idx > 0) { const k = part.slice(0, idx).trim(); const v = part.slice(idx + 1).trim(); if (k && v) map[k] = v; }
  });
  return map;
}

// Kies dezelfde SKU als place-bucky-order zou kopen, zodat we de juiste prijs vergelijken.
function pickSku(bdSkus: any[], kleur: string) {
  if (!Array.isArray(bdSkus) || bdSkus.length === 0) return null;
  if (bdSkus.length === 1) return bdSkus[0];
  const want = parseKleur(kleur);
  return bdSkus.find((s) =>
    Array.isArray(s.props) && s.props.length > 0 && s.props.every((p: any) => want[p.name] === p.value)) ?? null;
}

// Zoek precies de gekochte variant terug in de live product/detail-respons.
// hasList = of er überhaupt een SKU-lijst is (zo scheiden we "deze variant weg" van
// "het hele product weg").
function findLiveSku(detail: any, storedSku: any): { live: any; hasList: boolean } {
  const list = Array.isArray(detail?.skuList) ? detail.skuList : [];
  // 1) match op skuCode (meest betrouwbaar)
  let live = list.find((s: any) => s.skuCode && storedSku?.skuCode && s.skuCode === storedSku.skuCode);
  // 2) anders op props (stored = {name,value}, live = {propName,valueName})
  if (!live && Array.isArray(storedSku?.props) && storedSku.props.length) {
    const want: Record<string, string> = {};
    for (const p of storedSku.props) want[p.name] = p.value;
    live = list.find((s: any) =>
      Array.isArray(s.props) && s.props.length > 0 &&
      s.props.every((p: any) => want[p.propName ?? p.name] === (p.valueName ?? p.value)));
  }
  return { live: live ?? null, hasList: list.length > 0 };
}

// Lees de ¥-prijs nested (proPrice.price / price.price) — de bewezen vorm uit de
// admin-mapper — met een platte-getal/priceCent-fallback voor de zekerheid.
function skuYuan(o: any): number | null {
  if (o == null) return null;
  const v = o.proPrice?.price ?? o.price?.price
    ?? (typeof o.price === "number" ? o.price : null)
    ?? (o.priceCent != null ? Number(o.priceCent) / 100 : null);
  return v == null ? null : Number(v);
}

async function checkItem(item: { source_url?: string; kleur?: string }) {
  const source_url = (item?.source_url || "").trim();
  const out = { source_url, changed: false, available: true, reason: null as string | null, code: null as string | null };
  if (!source_url) return out; // onbekend item → pay_cart vangt "no longer available" af

  const { data: rows, error: selErr } = await admin
    .from("products")
    .select("id, spu_code, bd_skus, price_alert, alert_reason")
    .eq("source_url", source_url)
    .limit(5);
  if (selErr) console.error("check-cart-prices select error (price-guard.sql gedraaid?):", selErr.message);
  const product =
    (rows ?? []).find((p) => p.spu_code && Array.isArray(p.bd_skus) && p.bd_skus.length > 0) ?? (rows ?? [])[0];
  if (!product) return out; // niet gekoppeld → laat pay_cart beslissen

  // Al gevlagd (door een eerdere klant of de admin)? Dan sowieso "changed" — geen
  // BuckyDrop-call nodig (gratis vangst voor alle klanten ná de eerste).
  if (product.price_alert) {
    out.changed = true;
    out.available = false;
    out.reason = product.alert_reason || "Currently on hold";
    out.code = "flagged";
    return out;
  }

  // Geen BuckyDrop-koppeling → niet te checken; laat door (fail-open).
  if (!product.spu_code || !Array.isArray(product.bd_skus) || product.bd_skus.length === 0) return out;

  const sku = pickSku(product.bd_skus, item?.kleur || "");
  const storedYuan = sku?.priceYuan;
  if (sku == null || storedYuan == null) return out; // variant niet te matchen → niet blokkeren

  let detail: any;
  try {
    detail = await buckyPost("/api/rest/v2/adapt/openapi/product/detail", { productLink: source_url });
  } catch {
    return out; // BuckyDrop onbereikbaar → fail-open (post-pay refund is het vangnet)
  }
  if (detail?.success === false || !detail?.data) return out; // geen bruikbare data → fail-open

  // Bepaal de live status van precies de gekochte variant.
  const { live, hasList } = findLiveSku(detail.data, sku);
  let reason: string | null = null;
  let code: string | null = null;

  if (!live) {
    // Variant niet meer in de live SKU-lijst → deze variant weg (lijst bestaat nog) of
    // het hele product is verdwenen/uit de handel (geen lijst).
    reason = hasList ? "This option is no longer available at the factory"
                     : "No longer available at the factory";
    code = hasList ? "variant_gone" : "unavailable";
    out.available = false;
  } else if (
    detail.data?.soldOutTag === true ||
    live.soldOutTag === true || live.quantity === 0 || live.quantity === "0" || live.stock === 0
  ) {
    // Variant bestaat nog maar voorraad = 0.
    reason = "Sold out at the factory";
    code = "sold_out";
    out.available = false;
  } else {
    // Variant beschikbaar → alleen nog de prijs vergelijken.
    const liveYuan = skuYuan(live) ?? skuYuan(detail.data);
    if (liveYuan == null) {
      reason = "No longer available at the factory";
      code = "unavailable";
      out.available = false;
    } else if ((liveYuan - Number(storedYuan)) / Number(storedYuan) > THRESHOLD) {
      const pct = Math.round(((liveYuan - Number(storedYuan)) / Number(storedYuan)) * 100);
      reason = `Factory price increased (+${pct}%)`;
      code = "price_up";
    }
  }

  if (reason) {
    out.changed = true;
    out.reason = reason;
    out.code = code;
    // Vlag precies dit product (alert_reason = de klant-reden, prima ook voor de admin).
    const { error: updErr } = await admin
      .from("products")
      .update({ price_alert: true, alert_reason: reason, hidden: true, price_alert_at: new Date().toISOString() })
      .eq("id", product.id);
    if (updErr) console.error("check-cart-prices flag-update error (price-guard.sql gedraaid?):", updErr.message);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Alleen ingelogde klanten (voorkomt anonieme BuckyDrop-probes).
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: u } = await authClient.auth.getUser();
  if (!u?.user) return json({ error: "Niet ingelogd" }, 401);

  const body = await req.json().catch(() => ({}));
  const items = Array.isArray((body as { items?: unknown }).items) ? (body as { items: any[] }).items : [];
  if (!items.length) return json({ anyChanged: false, items: [] });

  // Per item parallel + fail-open per item, zodat één fout de hele checkout niet blokkeert.
  const results = await Promise.all(
    items.map((it: any) =>
      checkItem(it).catch(() => ({ source_url: (it?.source_url || "").trim(), changed: false, available: true }))),
  );
  return json({ anyChanged: results.some((r) => r.changed), items: results });
});
