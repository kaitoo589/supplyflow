// Flowva — vraagt een RETURN aan bij de fabriek (BuckyDrop apply-return) wanneer
// na QC blijkt dat een item defect/fout/niet-als-beschreven is.
// Getriggerd door pg_net zodra orders.return_status → 'requested'.
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
// Kies de juiste BuckyDrop-SKU op basis van de gekozen variant (zelfde als bij plaatsen).
function pickSku(bdSkus: any[], kleur: string) {
  if (!Array.isArray(bdSkus) || bdSkus.length === 0) return null;
  if (bdSkus.length === 1) return bdSkus[0];
  const want = parseKleur(kleur);
  return bdSkus.find((s) =>
    Array.isArray(s.props) && s.props.length > 0 &&
    s.props.every((p: any) => want[p.name] === p.value)) ?? null;
}

// Vind het PO-object (heeft orderCode + orderStatus) ergens in de order-detail body.
function findPO(node: any): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findPO(n); if (r) return r; } return null; }
  if ("orderCode" in node && "orderStatus" in node) return node;
  for (const k of Object.keys(node)) { const r = findPO(node[k]); if (r) return r; }
  return null;
}

async function flag(orderId: string, status: string, msg: string) {
  await admin.from("orders").update({ return_status: status, bd_error: msg }).eq("id", orderId);
  return new Response(JSON.stringify({ ok: false, return_status: status, error: msg }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const order = (await req.json().catch(() => null))?.record;
  if (!order?.id) return new Response("no order", { status: 200 });
  if (order.return_status !== "requested") return new Response("not requested", { status: 200 });
  if (order.return_flow_code) return new Response("already returned", { status: 200 }); // idempotent
  if (!order.shop_order_no) {
    return await flag(order.id, "failed", "Geen shop_order_no — niet bij BuckyDrop geplaatst.");
  }

  // 1) PO-orderCode ophalen via order-detail (apply-return draait op de PO-code, niet shopOrderNo).
  const detail = await buckyPost("/api/rest/v2/adapt/adaptation/order/detail", { shopOrderNo: order.shop_order_no });
  const po = findPO(detail?.data ?? detail);
  const orderCode = po?.orderCode ? String(po.orderCode) : null;
  if (!orderCode) {
    return await flag(order.id, "failed", "Kon PO-orderCode niet vinden in order-detail (mogelijk tijdelijk).");
  }

  // 2) De juiste SKU bepalen (zelfde variant-matching als bij het plaatsen).
  const { data: products } = await admin
    .from("products").select("bd_skus, source_url")
    .eq("source_url", order.source_url || "___none___").limit(5);
  const product = (products ?? []).find((p) => Array.isArray(p.bd_skus) && p.bd_skus.length) ?? (products ?? [])[0] ?? null;
  const sku = pickSku(product?.bd_skus ?? [], order.kleur || "");
  if (!sku?.skuCode) {
    return await flag(order.id, "failed", `Kon variant niet matchen voor return: "${order.kleur}".`);
  }

  // 3) Return aanvragen bij de fabriek.
  // applySource: 1 (partner-initiated). NB: docs noemen alleen "3 = BuckyDrop"; het
  // voorbeeld-body gebruikt 1 → [TO-VERIFY] of dit de juiste waarde is voor de partner.
  const res = await buckyPost("/api/rest/v2/adapt/adaptation/order/apply-return", {
    applySource: 1,
    orderCode,
    applyType: 1, // 1 = Product Return
    applyContent: String(order.return_reason || "Item defective / not as described").slice(0, 512),
    skuList: [{ skuCode: sku.skuCode, quantity: order.qty || 1 }],
  });

  const returnFlowCode =
    (Array.isArray(res?.data) ? res.data[0]?.returnFlowCode : res?.data?.returnFlowCode) || null;

  // Defect = niet de schuld van de klant → we betalen sowieso terug (refund_order is
  // idempotent). Bij een geslaagde aanvraag slaan we ook de returnFlowCode op.
  if (res?.success === true && returnFlowCode) {
    await admin.from("orders")
      .update({ return_flow_code: returnFlowCode, return_status: "submitted", bd_error: null })
      .eq("id", order.id);
    await admin.rpc("refund_order", {
      p_order_id: order.id,
      p_reason: `Defect/return — ${order.return_reason || "item not as described"} (returnFlowCode ${returnFlowCode})`,
    });
    return new Response(JSON.stringify({ ok: true, returnFlowCode }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Return-aanvraag mislukt → klant tóch terugbetalen (bevestigd defect), en flaggen
  // zodat een admin de return handmatig bij de fabriek regelt.
  await admin.rpc("refund_order", {
    p_order_id: order.id,
    p_reason: `Defect — refunded; apply-return failed (${res?.info || "unknown"}) → handle return manually.`,
  });
  return await flag(order.id, "failed", `apply-return faalde: ${res?.info || "unknown"} — klant terugbetaald, return handmatig afhandelen.`);
});
