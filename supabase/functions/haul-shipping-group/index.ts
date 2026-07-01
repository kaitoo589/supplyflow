// Flowva — haul-shipping-group: ÉÉN gecombineerde BuckyDrop-verzendquote voor een
// hele Flowva Friends-groep, naar het HOST-adres. Alleen de HOST mag dit (host-JWT).
//
// Verschil met de solo haul-shipping: die laadt orders met .eq(user_id) en quote't naar
// de caller. Hier laden we via service-role ALLE meetellende groep-orders (.eq ff_group_id,
// qc_pending, niet-geretourneerd, gestaged) en quoten naar het host-adres → één gecombineerde
// EUR-prijs + totaalgewicht. De SPLIT per lid gebeurt server-side in ff_pay_group_shipping.
//
// Twee acties:
//   quote → de echte kanalen voor het gecombineerde pakket (host kiest er één).
//   lock  → bevriest de gekozen quote via ff_lock_group_shipping_quote (service-role RPC).
//           Vanaf dat moment betaalt elk lid z'n gewichtsaandeel via ff_pay_group_shipping.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_CODE = Deno.env.get("BUCKY_APP_CODE")!;
const APP_SECRET = Deno.env.get("BUCKY_APP_SECRET")!;
const BUCKY_DOMAIN = Deno.env.get("BUCKY_DOMAIN") ?? "https://dev.buckydrop.com";
const IS_SANDBOX = BUCKY_DOMAIN.includes("dev.");
const CNY_PER_EUR = Number(Deno.env.get("BUCKY_CNY_PER_EUR") ?? "7.7");
const FX_MARGIN = 1.03;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const md5Hex = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const round2 = (x: number) => Math.round(x * 100) / 100;

// Gewicht-schatting — TERUGVAL als BuckyDrop geen live vrachttarief geeft (permissie op
// channel-carriage-list nog niet aan / sandbox / geen route). IDENTIEK aan solo haul-shipping
// + WarehouseAndHaul.jsx. DDP = duties in de prijs. ff_pay_group_shipping zet ×1,25 + split erop.
const SHIP_FIRST_KG = 0.5, SHIP_FIRST_EUR = 9.0, SHIP_PER_KG = 8.5;
const shippingEstimateEur = (kg: number) => round2(SHIP_FIRST_EUR + Math.max(0, kg - SHIP_FIRST_KG) * SHIP_PER_KG);

async function buckyPost(path: string, bodyObj: unknown) {
  const body = JSON.stringify(bodyObj ?? {});
  const ts = Date.now().toString();
  const sign = md5Hex(APP_CODE + body + ts + APP_SECRET);
  const url = `${BUCKY_DOMAIN}${path}?appCode=${APP_CODE}&timestamp=${ts}&sign=${sign}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", lang: "en" }, body });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { success: false, info: text }; }
}

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
const countryCodeFor = (name: string) => COUNTRY_CODES[(name || "").trim().toLowerCase()] ?? null;

function addressOf(meta: Record<string, any>) {
  const land = meta?.land || "Netherlands";
  const cc = countryCodeFor(land);
  return {
    country: land, countryCode: cc,
    province: meta?.provincie || meta?.stad || land,
    provinceCode: meta?.provincieCode || cc || "NL",
    detailAddress: meta?.adres || "NA",
    postCode: (meta?.postcode || "0000AA").toString().replace(/\s/g, "").toUpperCase(),
  };
}

function quoteBody(orders: any[], addr: ReturnType<typeof addressOf>) {
  const productList = orders.map((o) => ({
    length: Number(o.length_cm) > 0 ? Number(o.length_cm) : 20,
    width: Number(o.width_cm) > 0 ? Number(o.width_cm) : 20,
    height: Number(o.height_cm) > 0 ? Number(o.height_cm) : 10,
    weight: Math.max((Number(o.weight_grams) || 0) / 1000, 0.01),
    count: Number(o.qty) || 1,
    categoryCode: o.bd_category_code || "1",
  }));
  return { item: { lang: "en", ...addr, productList } };
}

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
        taxInclusive, logo: r.logo || null,
        available: r.available !== false && priceCny > 0,
      };
    })
    .filter((c: any) => c.available && c.serviceCode)
    .sort((a: any, b: any) => a.priceEur - b.priceEur);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  // Host-auth: valideer JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await asUser.auth.getUser();
  const user = u?.user;
  if (!user) return json({ ok: false, error: "Not logged in" }, 401);

  const payload = await req.json().catch(() => ({}));
  const action = payload?.action;
  const groupId = String(payload?.groupId ?? "");
  if (!groupId) return json({ ok: false, error: "No group" }, 400);

  // Alleen de HOST mag quoten/locken.
  const { data: group } = await admin.from("flowva_groups").select("id,host_id").eq("id", groupId).maybeSingle();
  if (!group) return json({ ok: false, error: "Group not found" }, 404);
  if (group.host_id !== user.id) return json({ ok: false, error: "Only the host can arrange shipping" }, 403);

  // ALLE meetellende groep-orders via service-role (NIET .eq user_id) — gestaged, gewogen, niet-geretourneerd.
  const { data: orders } = await admin.from("orders")
    .select("id,qty,weight_grams,length_cm,width_cm,height_cm,bd_category_code,status,return_status,box_staged_at")
    .eq("ff_group_id", groupId).eq("status", "qc_pending");
  const counting = (orders || []).filter((o) => !o.return_status);
  if (!counting.length) return json({ ok: false, error: "No items ready to ship in this group" }, 400);
  if (counting.some((o) => !o.box_staged_at)) return json({ ok: false, error: "Everyone must add their items to the box first", needStaging: true }, 200);
  if (counting.some((o) => !Number(o.weight_grams))) return json({ ok: false, error: "Some items have no weight yet", needWeight: true }, 200);

  // Bezorgadres = de host (= de caller).
  const addr = addressOf(user.user_metadata || {});
  if (!addr.countryCode) return json({ ok: false, error: "We don't ship to the host's country yet — contact support." }, 400);
  // De host is de bezorgontvanger → een volledig adres is vereist (anders kan BuckyDrop niet quoten).
  const hmeta = user.user_metadata || {};
  const addrComplete = String(hmeta.postcode || "").trim() && String(hmeta.adres || "").trim() && String(hmeta.stad || hmeta.provincie || "").trim();
  if (!addrComplete) return json({ ok: false, error: "The host needs a complete delivery address (street, city, postcode) before shipping. Add it in Profile, then try again.", needHostAddress: true }, 200);

  const res = await buckyPost("/api/rest/v2/adapt/adaptation/logistics/channel-carriage-list", quoteBody(counting, addr));
  const channels = res?.success ? parseChannels(res) : [];
  const totalWeightG = counting.reduce((s, o) => s + (Number(o.weight_grams) || 0), 0);
  if (!channels.length) console.error("GROUP_QUOTE_EMPTY", JSON.stringify({ success: res?.success, code: res?.code, msg: res?.message ?? res?.info, postCode: addr.postCode, province: addr.province }));

  if (action === "quote") {
    if (!channels.length) {
      // Geen live vrachttarief (permissie nog niet aan / sandbox / geen route) → TERUGVAL:
      // bied de host één synthetische DDP-schatting aan zodat de groep tóch kan verzenden.
      // De ECHTE prijs bevriest server-side in "lock"; ff_pay_group_shipping splitst per gewicht.
      const estFreight = shippingEstimateEur(totalWeightG / 1000);
      if (estFreight <= 0) return json({ ok: false, error: "Could not estimate shipping" }, 400);
      return json({
        ok: true, isSandbox: IS_SANDBOX, totalWeightG, isEstimate: true,
        channels: [{ serviceCode: "ESTIMATE", name: "Estimated shipping", priceEur: estFreight, minDays: 0, maxDays: 0, taxInclusive: true, available: true }],
      });
    }
    return json({ ok: true, isSandbox: IS_SANDBOX, channels, totalWeightG });
  }

  if (action === "lock") {
    // TERUGVAL: geen live vrachttarief → bevries de gewicht-schatting (DDP). Prijs komt
    // 100% SERVER-SIDE uit het groep-gewicht; de host stuurt nooit een bedrag mee.
    if (IS_SANDBOX || channels.length === 0) {
      const estFreight = shippingEstimateEur(totalWeightG / 1000);
      if (estFreight <= 0) return json({ ok: false, error: "Could not estimate shipping" }, 400);
      const { data, error } = await admin.rpc("ff_lock_group_shipping_quote", {
        p_group_id: groupId, p_estimate: estFreight, p_total_weight_g: totalWeightG,
        p_service_code: "ESTIMATE", p_service_name: "Estimated shipping (weight-based)", p_tax_inclusive: true,
      });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json(data);
    }
    const serviceCode = String(payload?.serviceCode ?? "");
    const ch = channels.find((c: any) => c.serviceCode === serviceCode);
    if (!ch) return json({ ok: false, error: "Chosen shipping option is no longer available" }, 400);
    // Alleen DDP/duty-paid lijnen — dan klopt de "duties included"-belofte en is er geen losse BTW.
    if (!ch.taxInclusive) return json({ ok: false, error: "Only duty-paid (DDP) shipping is supported" }, 400);
    // Bevries de RAW quote (zonder buffer); ff_pay_group_shipping zet ×1,25 + split erop.
    const { data, error } = await admin.rpc("ff_lock_group_shipping_quote", {
      p_group_id: groupId, p_estimate: ch.priceEur, p_total_weight_g: totalWeightG,
      p_service_code: ch.serviceCode, p_service_name: ch.name, p_tax_inclusive: ch.taxInclusive,
    });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json(data);
  }

  return json({ ok: false, error: "Unknown action" }, 400);
});
