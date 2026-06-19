// Flowva — haul-shipping: echte BuckyDrop-verzendtarieven voor het klant-pakket.
// Twee acties (klant-JWT vereist):
//   quote → haalt de echte verzendkanalen op (channel-carriage-list) voor de items
//           in het pakket, vertaald naar EUR + levertijd. PRIJS KOMT SERVER-SIDE.
//   pay   → her-quote't server-side, pakt het gekozen kanaal, en rekent EXACT af via
//           de service-role RPC pay_shipping_exact (geen buffer, geen na-refund).
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

// Bezorgadres uit user_metadata → channel-carriage-list-velden.
// TODO cutover: provincie verzamelen bij signup (nu val ik terug op de stad).
function addressOf(meta: Record<string, any>) {
  return {
    country: "Netherlands",
    countryCode: "NL",
    province: meta?.provincie || meta?.stad || "Netherlands",
    provinceCode: meta?.provincieCode || "NL",
    detailAddress: meta?.adres || "NA",
    postCode: (meta?.postcode || "0000AA").toString().replace(/\s/g, ""),
  };
}

function quoteBody(orders: any[], addr: ReturnType<typeof addressOf>) {
  const productList = orders.map((o) => ({
    // We slaan productafmetingen nog niet op → standaarddoos. TODO cutover: dims bij curatie opslaan.
    length: 20, width: 20, height: 10,
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
  const { data } = await admin.from("orders").select("id,qty,weight_grams,bd_category_code,status,user_id")
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
    // VAT: tax-inclusive lijnen hebben de BTW al in de prijs → niets bovenop. Anders 21%.
    const shipping = ch.priceEur;
    const vat = ch.taxInclusive ? 0 : round2(shipping * 0.21);
    const amount = round2(shipping + vat);
    const { data, error } = await admin.rpc("pay_shipping_exact", {
      p_uid: user.id, p_order_ids: orderIds, p_amount: amount,
      p_shipping: shipping, p_vat: vat, p_service_code: ch.serviceCode, p_service_name: ch.name,
    });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json(data);
  }

  return json({ ok: false, error: "Unknown action" }, 400);
});
