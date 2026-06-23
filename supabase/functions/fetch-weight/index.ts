// Flowva — haalt het ECHTE gewicht (skuWeight) + afmetingen (skuLong/Wide/Height) uit BuckyDrop
// order-detail zodra een item in het magazijn aankomt (status -> qc_pending), en schrijft ze naar
// orders.weight_grams + length_cm/width_cm/height_cm — voor een nauwkeurige verzendquote.
// Zo hoeft de admin het gewicht niet meer met de hand in te typen en kan de klant meteen
// verzending afrekenen. Getriggerd door een pg_net-trigger; beschermd met x-webhook-secret.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_CODE = Deno.env.get("BUCKY_APP_CODE")!;
const APP_SECRET = Deno.env.get("BUCKY_APP_SECRET")!;
const BUCKY_DOMAIN = Deno.env.get("BUCKY_DOMAIN") ?? "https://dev.buckydrop.com";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const md5Hex = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

async function buckyPost(path: string, bodyObj: unknown) {
  const body = JSON.stringify(bodyObj ?? {});
  const ts = Date.now().toString();
  const sign = md5Hex(APP_CODE + body + ts + APP_SECRET);
  const url = `${BUCKY_DOMAIN}${path}?appCode=${APP_CODE}&timestamp=${ts}&sign=${sign}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", lang: "en" }, body });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { success: false, info: text || `HTTP ${res.status}` }; }
}

// Zoek het eerste item met een echt skuWeight + pak meteen de afmetingen van datzelfde item
// (skuLong/skuWide/skuHeight, cm) — die staan in dezelfde order-detail-respons.
function findPhysical(node: any): { weight: number; long: number | null; wide: number | null; height: number | null } | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findPhysical(n); if (r) return r; } return null; }
  if (node.skuWeight != null && Number(node.skuWeight) > 0) {
    return {
      weight: Number(node.skuWeight),
      long: Number(node.skuLong) > 0 ? Number(node.skuLong) : null,
      wide: Number(node.skuWide) > 0 ? Number(node.skuWide) : null,
      height: Number(node.skuHeight) > 0 ? Number(node.skuHeight) : null,
    };
  }
  for (const k of Object.keys(node)) { const r = findPhysical(node[k]); if (r) return r; }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) return new Response("Unauthorized", { status: 401 });

  const order = (await req.json().catch(() => null))?.record;
  if (!order?.id) return new Response("no order", { status: 200 });
  if (order.weight_grams) return new Response("already has weight", { status: 200 }); // idempotent
  if (!order.shop_order_no) return new Response("not placed", { status: 200 });

  const detail = await buckyPost("/api/rest/v2/adapt/adaptation/order/detail", { shopOrderNo: order.shop_order_no });
  const phys = findPhysical(detail?.data ?? detail);
  if (!phys) return new Response("no weight in detail yet", { status: 200 });

  const update: Record<string, unknown> = { weight_grams: Math.round(phys.weight) };
  if (phys.long) update.length_cm = phys.long;
  if (phys.wide) update.width_cm = phys.wide;
  if (phys.height) update.height_cm = phys.height;
  await admin.from("orders").update(update).eq("id", order.id);
  return new Response(JSON.stringify({ ok: true, ...update }), { headers: { "Content-Type": "application/json" } });
});
