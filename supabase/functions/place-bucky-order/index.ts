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
  netherlands: "NL", nederland: "NL", holland: "NL", nl: "NL",
  belgium: "BE", "belgië": "BE", belgie: "BE", be: "BE",
  germany: "DE", duitsland: "DE", deutschland: "DE", de: "DE",
  france: "FR", frankrijk: "FR", fr: "FR",
  luxembourg: "LU", luxemburg: "LU", lu: "LU",
  ireland: "IE", ierland: "IE", ie: "IE",
  "united kingdom": "GB", uk: "GB", "great britain": "GB", engeland: "GB", gb: "GB",
  spain: "ES", spanje: "ES", es: "ES",
  portugal: "PT", pt: "PT",
  italy: "IT", "italië": "IT", italie: "IT", it: "IT",
  austria: "AT", oostenrijk: "AT", at: "AT",
  denmark: "DK", denemarken: "DK", dk: "DK",
  sweden: "SE", zweden: "SE", se: "SE",
  finland: "FI", fi: "FI",
  poland: "PL", polen: "PL", pl: "PL",
  "czech republic": "CZ", czechia: "CZ", "tsjechië": "CZ", tsjechie: "CZ", cz: "CZ",
  slovakia: "SK", slowakije: "SK", sk: "SK",
  slovenia: "SI", "slovenië": "SI", slovenie: "SI", si: "SI",
  hungary: "HU", hongarije: "HU", hu: "HU",
  romania: "RO", "roemenië": "RO", roemenie: "RO", ro: "RO",
  bulgaria: "BG", bulgarije: "BG", bg: "BG",
  greece: "GR", griekenland: "GR", gr: "GR",
  croatia: "HR", "kroatië": "HR", kroatie: "HR", hr: "HR",
  estonia: "EE", estland: "EE", ee: "EE",
  latvia: "LV", letland: "LV", lv: "LV",
  lithuania: "LT", litouwen: "LT", lt: "LT",
  cyprus: "CY", cy: "CY", malta: "MT", mt: "MT",
};
const countryCodeFor = (name: string) =>
  COUNTRY_CODES[(name || "").trim().toLowerCase()] ?? "NL";

// BuckyDrop-foutcodes die een DEFINITIEVE "item niet beschikbaar"-afwijzing betekenen
// (uitverkocht / geen sku). 70010106 = "No product sku or stock is 0".
// Breid uit zodra je in productie andere voorraad-codes tegenkomt (zie bucky_notifications).
const OUT_OF_STOCK_CODES = new Set<number>([70010106]);

// Trefwoorden (EN + ZH) in res.info die op een onbeschikbaar/uitverkocht product wijzen.
// Een wallet-tekort (bv. 余额不足 / insufficient balance) matcht hier bewust NIET,
// zodat dat NIET als out-of-stock wordt afgehandeld en de klant niet onterecht refund krijgt.
const UNAVAILABLE_RE =
  /stock|sold\s*out|no product sku|not available|unavailable|out[\s-]?of[\s-]?stock|discontinued|delisted|无货|缺货|售罄|下架|库存/i;

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
  // bd_claimed_at terugzetten op null zodat een herpoging deze order opnieuw mag claimen (#10).
  await admin.from("orders").update({ bd_error: msg, bd_claimed_at: null }).eq("id", orderId);
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

  // Bezorgadres: gebruik bij voorkeur de op de order BEVROREN snapshot (gezet door
  // pay_cart bij checkout) — anti-fraude/bewijs van wat de klant opgaf, en verandert
  // niet meer als de klant later z'n profiel aanpast. Ontbreekt de snapshot (bv. een
  // Flowva Friends-groeps-order die naar de HOST gaat, of een oude order), val dan
  // terug op de live user_metadata van de ontvanger.
  const addressUserId = order.host_user_id || order.user_id;
  const { data: userRes } = await admin.auth.admin.getUserById(addressUserId);
  const m = (userRes?.user?.user_metadata ?? {}) as Record<string, string>;
  const frozen = !!order.ship_address;
  const land = frozen ? (order.ship_country || "Netherlands") : (m.land || "Netherlands");

  const orderBody = {
    partnerOrderNo: order.id,
    country: land,
    countryCode: countryCodeFor(land),
    province: (frozen ? order.ship_city : m.stad) || "-",
    city: (frozen ? order.ship_city : m.stad) || "-",
    detailAddress: (frozen ? order.ship_address : m.adres) || "-",
    postCode: (frozen ? order.ship_postcode : m.postcode) || "",
    contactName: (frozen ? order.ship_name : `${m.voornaam || ""} ${m.achternaam || ""}`.trim()) || "Customer",
    contactPhone: (frozen ? order.ship_phone : m.telefoon) || "",
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

  // #10 — ATOMAIRE CLAIM vóór de echte BuckyDrop-call. Deze UPDATE slaagt voor precies ÉÉN
  // invocatie (bd_claimed_at was null); een gelijktijdige pg_net-retry in het venster vóór
  // shop_order_no is opgeslagen krijgt 0 rijen terug en plaatst NIETS → geen dubbele
  // fabrieksbestelling. Bij een tijdelijke fout zet fail() bd_claimed_at weer op null.
  const { data: claimRows, error: claimErr } = await admin
    .from("orders")
    .update({ bd_claimed_at: new Date().toISOString() })
    .eq("id", order.id)
    .is("bd_claimed_at", null)
    .is("shop_order_no", null)
    .select("id");
  if (claimErr) return await fail(order.id, `Kon order niet claimen: ${claimErr.message}`);
  if (!claimRows || claimRows.length === 0) {
    return new Response(
      JSON.stringify({ ok: false, error: "already being placed (claimed by another run)" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const res = await buckyPost("/api/rest/v2/adapt/adaptation/order/shop-order/create", orderBody);
  if (res?.success !== true || !res?.data?.shopOrderNo) {
    const code = typeof res?.code === "number" ? res.code : null;
    const info = (res?.info ?? "").toString();

    // Is dit een DEFINITIEVE "item niet beschikbaar"-afwijzing (uitverkocht / geen sku /
    // uit de handel)? Alleen dán de klant terugbetalen. Omdat elke mand-regel een EIGEN
    // order + eigen BuckyDrop-shop-order is, raakt dit ALLEEN dit item — de rest van de
    // bestelling (andere order-rijen) loopt gewoon door.
    const isUnavailable =
      (code !== null && OUT_OF_STOCK_CODES.has(code)) || UNAVAILABLE_RE.test(info);

    if (isUnavailable) {
      await admin.rpc("refund_order", {
        p_order_id: order.id,
        p_reason: `Out of stock / unavailable: ${info || "item no longer available"}`,
      });
      return new Response(
        JSON.stringify({ ok: false, refunded: true, outOfStock: true, reason: info }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Andere fout (bijv. wallet-tekort, systeemfout, of onbekende code): NIET auto-refunden
    // — dat kan een probleem aan ONZE kant zijn, niet de schuld van de klant. Flaggen voor
    // admin (handmatig herproberen of terugbetalen). Status blijft 'quote_accepted'.
    return await fail(
      order.id,
      code !== null
        ? `Order rejected (code ${code}): ${info || "unknown"} — needs admin review`
        : `Temporary error placing order: ${info || "unknown"}`,
    );
  }

  // Gelukt: ordernummer opslaan en status → purchased (triggert ook de "Gekocht"-push).
  // NIET fire-and-forget: de fabrieksbestelling bestaat nu echt (shopOrderNo), dus als deze
  // schrijf faalt moeten we shop_order_no tóch vastleggen (anti dubbele plaatsing) + flaggen.
  // We leggen ook de ¥-kost vast (inkoop × aantal + ¥9,9 fulfilment) zodat de admin-wallet
  // automatisch kan aftellen wat er van de BuckyDrop-wallet af ging.
  const costCny = (Number(price) || 0) * (order.qty || 1) + 9.9;
  const chargedAt = new Date().toISOString();
  const { error: finalErr } = await admin
    .from("orders")
    .update({ shop_order_no: res.data.shopOrderNo, bd_error: null, status: "purchased", cost_cny: costCny, cost_charged_at: chargedAt })
    .eq("id", order.id);
  if (finalErr) {
    // bd_claimed_at NIET resetten (de order is al ingekocht — nooit opnieuw plaatsen). Wel
    // shop_order_no vastleggen zodat een toekomstige run bij 'already placed' afbreekt, plus
    // bd_error voor handmatige afstemming door een admin.
    await admin
      .from("orders")
      .update({
        shop_order_no: res.data.shopOrderNo,
        bd_error: `Geplaatst (${res.data.shopOrderNo}) maar status-update faalde: ${finalErr.message} — admin nakijken`,
        cost_cny: costCny,
        cost_charged_at: chargedAt,
      })
      .eq("id", order.id);
    console.error(`place-bucky-order: status-update faalde voor ${order.id} (al geplaatst ${res.data.shopOrderNo}): ${finalErr.message}`);
  }

  return new Response(JSON.stringify({ ok: true, shopOrderNo: res.data.shopOrderNo }), {
    headers: { "Content-Type": "application/json" },
  });
});
