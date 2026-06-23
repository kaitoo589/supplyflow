// Flowva — haalt het ECHTE gewicht (skuWeight) uit BuckyDrop order-detail zodra een item
// in het magazijn aankomt (status -> qc_pending), en schrijft het naar orders.weight_grams.
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

// Zoek het eerste bruikbare skuWeight (gram) ergens in de order-detail-respons.
function findWeight(node: any): number | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findWeight(n); if (r) return r; } return null; }
  if (node.skuWeight != null && Number(node.skuWeight) > 0) return Number(node.skuWeight);
  for (const k of Object.keys(node)) { const r = findWeight(node[k]); if (r) return r; }
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
  const grams = findWeight(detail?.data ?? detail);
  if (!grams) return new Response("no weight in detail yet", { status: 200 });

  await admin.from("orders").update({ weight_grams: Math.round(grams) }).eq("id", order.id);
  return new Response(JSON.stringify({ ok: true, weight_grams: Math.round(grams) }), {
    headers: { "Content-Type": "application/json" },
  });
});
