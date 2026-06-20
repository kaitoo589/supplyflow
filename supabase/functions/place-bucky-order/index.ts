// Flowva — plaatst automatisch een BuckyDrop-bestelling zodra een klant betaalt.
// Getriggerd door een pg_net-trigger op orders (status → 'quote_accepted').
// Beschermd met x-webhook-secret; houdt de APPsecret server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_CODE = Deno.env.get("BUCKY_APP_CODE")!;
const APP_SECRET = Deno.env.get("BUCKY_APP_SECRET")!;
const BUCKY_DOMAIN = Deno.env.get("BUCKY_DOMAIN") ?? "https://dev.buckydrop.com";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// Landnaam → 2-letter IATA-code die BuckyDrop verwacht (default NL).
const COUNTRY_CODES: Record<string, string> = {
  netherlands: "NL", nederland: "NL", holland: "NL",
  belgium: "BE", "belgië": "BE", belgie: "BE",
  germany: "DE", duitsland: "DE", deutschland: "DE",
  france: "FR", frankrijk: "FR",
  "united kingdom": "GB", uk: "GB", "great britain": "GB", engeland: "GB",
  spain: "ES", spanje: "ES", italy: "IT", "italië": "IT", italie: "IT",
  austria: "AT", oostenrijk: "AT", luxembourg: "LU", luxemburg: "LU",
  ireland: "IE", ierland: "IE", portugal: "PT",
  denmark: "DK", denemarken: "DK", sweden: "SE", zweden: "SE",
};
const countryCodeFor = (name: string) =>
  COUNTRY_CODES[(name || "").trim().toLowerCase()] ?? "NL";

const md5Hex = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

async function buckyPost(path: string, bodyObj: unknown) {
  const body = JSON.stringify(bodyObj ?? {});
  const ts = Date.now().toString();
  const sign = md5Hex(APP_CODE + body + ts + APP_SECRET);
  const url = `${BUCKY_DOMAIN}${path}?appCode=${APP_CODE}&timestamp=${ts}&sign=${sign}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", lang: "en" },
    body,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { success: false, info: text || `HTTP ${res.status}` }; }
}

// "Size: M, Color: Blue" → { Size: "M", Color: "Blue" }
function parseKleur(kleur: string) {
  const map: Record<string, string> = {};
  (kleur || "").split(",").forEach((part) => {
    const idx = part.indexOf(":");
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k && v) map[k] = v;
    }
  });
  return map;
}

// Kies de juiste BuckyDrop-SKU op basis van de gekozen variant.
function pickSku(bdSkus: any[], kleur: string) {
  if (!Array.isArray(bdSkus) || bdSkus.length === 0) return null;
  if (bdSkus.length === 1) return bdSkus[0];
  const want = parseKleur(kleur);
  return (
    bdSkus.find(
      (s) =>
        Array.isArray(s.props) &&
        s.props.length > 0 &&
        s.props.every((p: any) => want[p.name] === p.value),
    ) ?? null
  );
}

async function fail(orderId: string, msg: string) {
  await admin.from("orders").update({ bd_error: msg }).eq("id", orderId);
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  const order = payload?.record;
  if (!order?.id) return new Response("no order", { status: 200 });
  if (order.shop_order_no) return new Response("already placed", { status: 200 }); // idempotent
  if (order.status !== "quote_accepted") return new Response("not payable", { status: 200 });

  // Product koppelen via source_url (staat zowel op de order als op het product).
  const { data: products } = await admin
    .from("products")
    .select("spu_code, bd_platform, bd_skus, title, source_url, image, price")
    .eq("source_url", order.source_url || "___none___")
    .limit(5);
  const product =
    (products ?? []).find((p) => p.spu_code && Array.isArray(p.bd_skus) && p.bd_skus.length > 0) ??
    (products ?? [])[0] ??
    null;

  if (!product) return await fail(order.id, "Geen gekoppeld product gevonden voor automatische bestelling.");
  if (!product.spu_code || !Array.isArray(product.bd_skus) || product.bd_skus.length === 0) {
    return await fail(order.id, "Product heeft geen BuckyDrop-koppeling (geen spuCode/sku's).");
  }

  const sku = pickSku(product.bd_skus, order.kleur || "");
  if (!sku?.skuCode) return await fail(order.id, `Kon variant niet matchen: "${order.kleur}".`);
  const price = sku.priceYuan;
  if (price == null) return await fail(order.id, "Geen ¥-prijs bekend voor deze variant.");

  // Klantadres uit user_metadata (auth.users). Bij een Flowva Friends-groeps-order
  // gaat het pakket naar de HOST (host_user_id), niet naar het individuele lid.
  const addressUserId = order.host_user_id || order.user_id;
  const { data: userRes } = await admin.auth.admin.getUserById(addressUserId);
  const m = (userRes?.user?.user_metadata ?? {}) as Record<string, string>;
  const land = m.land || "Netherlands";

  const orderBody = {
    partnerOrderNo: order.id,
    country: land,
    countryCode: countryCodeFor(land),
    province: m.stad || "-",
    city: m.stad || "-",
    detailAddress: m.adres || "-",
    postCode: m.postcode || "",
    contactName: `${m.voornaam || ""} ${m.achternaam || ""}`.trim() || "Customer",
    contactPhone: m.telefoon || "",
    email: userRes?.user?.email || "",
    orderRemark: order.opmerking || "",
    productList: [
      {
        platform: product.bd_platform || sku.platform || "TB",
        productCount: order.qty || 1,
        skuCode: sku.skuCode,
        spuCode: product.spu_code,
        productPrice: price,
        productName: order.product_title || product.title || "",
        productLink: order.source_url || product.source_url || "",
        productImage: product.image?.startsWith("http") ? product.image : sku.img || "",
      },
    ],
  };

  const res = await buckyPost("/api/rest/v2/adapt/adaptation/order/shop-order/create", orderBody);
  if (res?.success !== true || !res?.data?.shopOrderNo) {
    // BuckyDrop bereikt + gestructureerd afgewezen (numerieke code, bijv. uitverkocht)
    // → klant automatisch terugbetalen en order annuleren.
    if (typeof res?.code === "number") {
      await admin.rpc("refund_order", {
        p_order_id: order.id,
        p_reason: `BuckyDrop rejected: ${res?.info || "order could not be placed"}`,
      });
      return new Response(JSON.stringify({ ok: false, refunded: true, reason: res?.info }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Geen code = tijdelijke/netwerkfout → flaggen voor herproberen, NIET terugbetalen.
    return await fail(order.id, `Temporary error placing order: ${res?.info || "unknown"}`);
  }

  // Gelukt: ordernummer opslaan en status → purchased (triggert ook de "Gekocht"-push).
  await admin
    .from("orders")
    .update({ shop_order_no: res.data.shopOrderNo, bd_error: null, status: "purchased" })
    .eq("id", order.id);

  return new Response(JSON.stringify({ ok: true, shopOrderNo: res.data.shopOrderNo }), {
    headers: { "Content-Type": "application/json" },
  });
});
