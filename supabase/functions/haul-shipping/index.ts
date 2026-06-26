// Flowva — haul-shipping: echte BuckyDrop-verzendtarieven voor het klant-pakket.
// Twee acties (klant-JWT vereist):
//   quote → haalt de echte verzendkanalen op (channel-carriage-list) voor de items
//           in het pakket, vertaald naar EUR + levertijd. PRIJS KOMT SERVER-SIDE.
//   pay   → her-quote't server-side, pakt het gekozen kanaal (de quote is een SCHATTING —
//           BuckyDrop heeft geen freight-API), en rekent af via de service-role RPC
//           pay_shipping_buffered (×1,25 buffer; de admin verrekent ~1 week later het verschil).
// De client stuurt NOOIT een prijs mee — zelfde les als de pay_cart-fix.
//
// Sandbox (dev.buckydrop.com) geeft NEP test-kanalen → we geven isSandbox=true terug
// zodat de app netjes terugvalt op de schatting tot de productie-cutover.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_CODE = Deno.env.get("BUCKY_APP_CODE")!;
const APP_SECRET = Deno.env.get("BUCKY_APP_SECRET")!;
const BUCKY_DOMAIN = Deno.env.get("BUCKY_DOMAIN") ?? "https://dev.buckydrop.com";
const IS_SANDBOX = BUCKY_DOMAIN.includes("dev.");
// channel-carriage-list rekent in CNY (zoals de dashboard-calculator). Omrekenen naar EUR.
// TODO cutover: bevestig de currency van totalPrice + overweeg een currency-param.
const CNY_PER_EUR = Number(Deno.env.get("BUCKY_CNY_PER_EUR") ?? "7.7");
const FX_MARGIN = 1.03; // kleine marge tegen koersschommeling

const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const md5Hex = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const round2 = (x: number) => Math.round(x * 100) / 100;

async function buckyPost(path: string, bodyObj: unknown) {
  const body = JSON.stringify(bodyObj ?? {});
  const ts = Date.now().toString();
  const sign = md5Hex(APP_CODE + body + ts + APP_SECRET);
  const url = `${BUCKY_DOMAIN}${path}?appCode=${APP_CODE}&timestamp=${ts}&sign=${sign}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", lang: "en" }, body });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { success: false, info: text }; }
}

// Landnaam (EN/NL) of 2-letter code → IATA 2-letter code. Dekt de EU/EEA + GB.
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
  COUNTRY_CODES[(name || "").trim().toLowerCase()] ?? null;

// Bezorgadres uit user_metadata → channel-carriage-list-velden. Leest nu het
// ECHTE land (geen NL-hardcode meer). Onbekend land → null → quote weigeren.
// TODO cutover: provincie/provinceCode netjes verzamelen bij signup (nu val ik terug op de stad/land).
function addressOf(meta: Record<string, any>) {
  const land = meta?.land || "Netherlands";
  const cc = countryCodeFor(land);
  return {
    country: land,
    countryCode: cc,
    province: meta?.provincie || meta?.stad || land,
    provinceCode: meta?.provincieCode || cc || "NL",
    detailAddress: meta?.adres || "NA",
    postCode: (meta?.postcode || "0000AA").toString().replace(/\s/g, ""),
  };
}

function quoteBody(orders: any[], addr: ReturnType<typeof addressOf>) {
  const productList = orders.map((o) => ({
    // Echte afmetingen uit BuckyDrop (gevuld door fetch-weight); val terug op een standaarddoos
    // als BuckyDrop ze (nog) niet teruggaf.
    length: Number(o.length_cm) > 0 ? Number(o.length_cm) : 20,
    width: Number(o.width_cm) > 0 ? Number(o.width_cm) : 20,
    height: Number(o.height_cm) > 0 ? Number(o.height_cm) : 10,
    weight: Math.max((Number(o.weight_grams) || 0) / 1000, 0.01), // kg
    count: Number(o.qty) || 1,
    categoryCode: o.bd_category_code || "1", // TODO cutover: echte Cat-Level-III-code opslaan
  }));
  return { item: { lang: "en", ...addr, productList } };
}

// Rauwe channel-carriage-list-records → nette EUR-kanalen.
function parseChannels(res: any) {
  const recs = res?.data?.records || [];
  return recs
    .map((r: any) => {
      const priceCny = Number(r.totalPrice ?? r.carriageDetail?.totalPrice ?? 0);
      const taxInclusive = Number(r.isTariffCover) === 1 || Number(r.vatDetail?.isVat) === 1;
      return {
        serviceCode: String(r.serviceCode ?? ""),
        name: String(r.serviceName ?? "Shipping"),
        priceEur: round2((priceCny / CNY_PER_EUR) * FX_MARGIN),
        minDays: Number(r.minTimeInTransit ?? 0),
        maxDays: Number(r.maxTimeInTransit ?? 0),
        taxInclusive,
        logo: r.logo || null,
        available: r.available !== false && priceCny > 0,
      };
    })
    .filter((c: any) => c.available && c.serviceCode)
    .sort((a: any, b: any) => a.priceEur - b.priceEur);
}

// Haal de pakket-orders op (alleen die van de gebruiker + klaar voor verzending).
async function loadOrders(uid: string, orderIds: string[]) {
  const { data } = await admin.from("orders").select("id,qty,weight_grams,length_cm,width_cm,height_cm,bd_category_code,status,user_id")
    .in("id", orderIds).eq("user_id", uid);
  return data || [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  // Klant-auth: valideer de JWT, haal uid + adres uit het profiel.
  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await asUser.auth.getUser();
  const user = u?.user;
  if (!user) return json({ ok: false, error: "Not logged in" }, 401);

  const payload = await req.json().catch(() => ({}));
  const action = payload?.action;
  const orderIds: string[] = Array.isArray(payload?.orderIds) ? payload.orderIds.map(String) : [];
  if (!orderIds.length) return json({ ok: false, error: "No items" }, 400);

  const orders = await loadOrders(user.id, orderIds);
  if (orders.length !== orderIds.length) return json({ ok: false, error: "Items not found" }, 400);
  if (orders.some((o) => o.status !== "qc_pending")) return json({ ok: false, error: "Items not ready to ship" }, 400);
  if (orders.some((o) => !Number(o.weight_grams))) return json({ ok: false, error: "Some items have no weight yet", needWeight: true }, 200);

  const addr = addressOf(user.user_metadata || {});
  if (!addr.countryCode) {
    return json({ ok: false, error: "We don't ship to your country yet — please contact support." }, 400);
  }
  const res = await buckyPost("/api/rest/v2/adapt/adaptation/logistics/channel-carriage-list", quoteBody(orders, addr));
  const channels = res?.success ? parseChannels(res) : [];
  const totalWeightG = orders.reduce((s, o) => s + (Number(o.weight_grams) || 0), 0);

  if (action === "quote") {
    return json({ ok: true, isSandbox: IS_SANDBOX, channels, totalWeightG, raw: res?.success ? undefined : res });
  }

  if (action === "pay") {
    const serviceCode = String(payload?.serviceCode ?? "");
    const ch = channels.find((c: any) => c.serviceCode === serviceCode);
    if (!ch) return json({ ok: false, error: "Chosen shipping option is no longer available" }, 400);
    // Alleen DDP/duty-paid lijnen — dan klopt de "duties included"-belofte en is er geen losse BTW.
    if (!ch.taxInclusive) return json({ ok: false, error: "Only duty-paid (DDP) shipping is supported" }, 400);
    // De RAW live-quote is een SCHATTING — de echte prijs komt ~1 week later (geen API).
    // pay_shipping_buffered zet de ×1,25-buffer erop; de admin verrekent later het verschil.
    // VAT: tax-inclusive (DDP) lijnen hebben de BTW al in de prijs → niets bovenop. Anders 21%.
    const vat = ch.taxInclusive ? 0 : round2(ch.priceEur * 0.21);
    const { data, error } = await admin.rpc("pay_shipping_buffered", {
      p_uid: user.id, p_order_ids: orderIds, p_estimate: ch.priceEur,
      p_vat: vat, p_service_code: ch.serviceCode, p_service_name: ch.name,
    });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json(data);
  }

  return json({ ok: false, error: "Unknown action" }, 400);
});
