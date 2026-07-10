// Flowva — QC-sync: haalt uit BuckyDrop order-detail (met queryPoServiceResult=true) het ECHTE
// gewicht (skuWeight) + afmetingen (skuLong/Wide/Height) ÉN de magazijn-serviceresultaten op:
// QC-/productfoto's (operationPhotoList), meetfoto's (Garment Measurement Service) en de
// inspectie-status. Schrijft naar orders.weight_grams + length/width/height_cm + qc_images +
// measurement_images, zet de order-status vooruit (PO-status 5/6/9/11/12, forward-only) en
// flagt een defect (dispute_status='bucky_flagged') als een service-resultaat faalt.
// Foto's worden GEREHOST naar eigen storage (BuckyDrop-WMS-links kunnen verlopen).
//
// Aanroepbaar op drie manieren (alle met x-webhook-secret):
//   { record: <order-rij> }  — de bestaande pg_net-trigger (status -> qc_pending)
//   { order_id: "SF-..." }   — één order syncen (admin/test); + { debug:true } geeft de ruwe respons
//   { sweep: true }          — alle actieve geplaatste orders bijwerken (pg_cron, elk kwartier)
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

// Zoek het eerste item met een echt skuWeight + pak meteen de afmetingen van datzelfde item.
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

// Vind het PO-object (orderCode + numerieke orderStatus) — zelfde vorm als in de webhook.
function findPO(node: any): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findPO(n); if (r) return r; } return null; }
  if ("orderCode" in node && "orderStatus" in node && !isNaN(Number(node.orderStatus))) return node;
  for (const k of Object.keys(node)) { const r = findPO(node[k]); if (r) return r; }
  return null;
}

// Verzamel alle service-resultaten (Basic Product Inspection / Standard Product Photos /
// Garment Measurement Service …) waar ook in de respons.
function collectServices(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const n of node) collectServices(n, out); return out; }
  if (node.assembleName != null || Array.isArray(node.operationPhotoList)) out.push(node);
  for (const k of Object.keys(node)) collectServices(node[k], out);
  return out;
}

// BuckyDrop PO orderStatus → app-status + rang om alleen vooruit te bewegen (als de webhook).
const PO_STATUS_MAP: Record<number, string> = { 5: "bought", 6: "shipped_local", 9: "qc_pending", 11: "shipped_international", 12: "delivered" };
const RANK: Record<string, number> = {
  requested: 0, quote_sent: 0, quote_accepted: 0, purchased: 1,
  bought: 2, shipped_local: 3, qc_pending: 4, shipped_international: 5, delivered: 6,
};

const isHttp = (u: unknown): u is string => typeof u === "string" && u.startsWith("http");
const onOwnStorage = (u: string) => u.includes(`${new URL(SUPABASE_URL).host}/storage/`);
// LET OP (uit echte data): een geannuleerde service-taak (bv. QC vervalt door een retour) komt
// binnen als itemStatus CANCEL + orderStatus REJECT — dat is GEEN defect. Alleen expliciete
// fail-statussen tellen, en alleen mét bewijsfoto's (of het PO-defect-signaal confirmType).
const FAIL_RE = /FAIL|ABNORMAL|EXCEPTION|DEFECT|UNQUALIFIED|\bNG\b/i;
const CANCEL_RE = /CANCEL/i;

// Rehost een externe foto naar eigen storage (WMS-links verlopen); bij mislukken → originele URL.
async function rehost(url: string, orderId: string): Promise<string> {
  if (!isHttp(url)) return url;
  if (onOwnStorage(url)) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const type = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    if (!type.startsWith("image/")) return url;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) return url;
    const ext = (type.split("/")[1] || "jpg").replace("jpeg", "jpg");
    const path = `qc/${orderId}/${md5Hex(url).slice(0, 16)}.${ext}`; // hash van bron-URL = idempotent (geen dubbels)
    const { error } = await admin.storage.from("product-images").upload(path, bytes, { contentType: type, upsert: true });
    if (error) return url;
    return admin.storage.from("product-images").getPublicUrl(path).data.publicUrl;
  } catch { return url; }
}

type OrderRow = {
  id: string; shop_order_no: string | null; status: string | null;
  weight_grams: number | null; qc_images: unknown; measurement_images: unknown;
  dispute_status: string | null; arrived_at: string | null;
};

async function syncOrder(order: OrderRow, debug = false) {
  const out: Record<string, unknown> = { id: order.id };
  if (!order.shop_order_no) { out.skip = "not placed"; return out; }

  const detail = await buckyPost("/api/rest/v2/adapt/adaptation/order/detail", {
    shopOrderNo: order.shop_order_no,
    queryPoServiceResult: true,
  });
  const data = detail?.data ?? detail;
  if (debug) out.raw = detail;
  if (!data || detail?.success === false) { out.skip = detail?.info || "no data"; return out; }

  const update: Record<string, unknown> = {};

  // 1) Gewicht + afmetingen (alleen invullen als ze nog missen).
  const phys = findPhysical(data);
  if (phys && !order.weight_grams) {
    update.weight_grams = Math.round(phys.weight);
    if (phys.long) update.length_cm = phys.long;
    if (phys.wide) update.width_cm = phys.wide;
    if (phys.height) update.height_cm = phys.height;
  }

  // 2) Service-resultaten → foto's splitsen: meetservice → measurement_images, rest → qc_images.
  const services = collectServices(data);
  const qcUrls: string[] = [];
  const measUrls: string[] = [];
  const defectUrls: string[] = [];
  let defect = false;
  let defectLabel = "";
  for (const s of services) {
    const name = String(s.assembleName ?? "").toLowerCase();
    const item = String(s.itemStatus ?? "");
    const ord = String(s.orderStatus ?? "");
    // Geannuleerde taken (retour/omruil onderweg) volledig overslaan — geen defect, geen foto's.
    if (CANCEL_RE.test(item) || CANCEL_RE.test(ord)) continue;
    const photos = (Array.isArray(s.operationPhotoList) ? s.operationPhotoList : []).filter(isHttp);
    const failed = FAIL_RE.test(item) || FAIL_RE.test(ord);
    // Alleen een defect melden als er ook bewijsfoto's bij zitten (anders: stil laten — het
    // PO-niveau-signaal confirmType hieronder vangt échte defecten alsnog af).
    if (failed && photos.length) { defect = true; defectLabel = s.assembleName || defectLabel; defectUrls.push(...photos); }
    if (name.includes("measure")) measUrls.push(...photos);
    else qcUrls.push(...photos);
  }
  // PO-niveau defect (zelfde signaal als de webhook gebruikt).
  const po = findPO(data);
  if (po?.confirmType) { defect = true; defectLabel = defectLabel || String(po.confirmType); }

  // Bestaande EXTERNE qc-foto's (via de webhook binnengekomen WMS-links) nemen we mee in de
  // rehost zodat ze niet stukgaan; velden die al gevuld zijn met eigen-storage-foto's laten we staan.
  const existingQc = (Array.isArray(order.qc_images) ? order.qc_images : []).filter(isHttp);
  const existingMeas = (Array.isArray(order.measurement_images) ? order.measurement_images : []).filter(isHttp);
  const qcAllExternal = existingQc.length > 0 && existingQc.every((u) => !onOwnStorage(u));

  const dedupe = (arr: string[]) => [...new Set(arr)];
  if ((existingQc.length === 0 && qcUrls.length) || qcAllExternal) {
    const src = dedupe([...existingQc, ...qcUrls]);
    const hosted = dedupe(await Promise.all(src.map((u) => rehost(u, order.id))));
    if (hosted.length) update.qc_images = hosted;
  }
  if (existingMeas.length === 0 && measUrls.length) {
    const hosted = dedupe(await Promise.all(dedupe(measUrls).map((u) => rehost(u, order.id))));
    if (hosted.length) update.measurement_images = hosted;
  }

  // 3) Defect → zelfde vlag als de webhook zet: klant kiest retour/accepteren in de app.
  //    Nooit een bestaande dispute-afhandeling overschrijven.
  if (defect && !order.dispute_status) {
    update.dispute_status = "bucky_flagged";
    update.problem_type = defectLabel || "defect";
    if (defectUrls.length) {
      update.agent_defect_images = dedupe(await Promise.all(dedupe(defectUrls).map((u) => rehost(u, order.id))));
    }
  }

  // 4) Status vooruit zetten op basis van de PO-status (forward-only; cancelled nooit aanraken).
  const poStatus = po ? Number(po.orderStatus) : null;
  const mapped = poStatus != null ? PO_STATUS_MAP[poStatus] : null;
  if (mapped && order.status !== "cancelled" && (RANK[mapped] ?? 0) > (RANK[order.status ?? ""] ?? 0)) {
    update.status = mapped;
    if (mapped === "qc_pending" && !order.arrived_at) update.arrived_at = new Date().toISOString();
  }

  if (Object.keys(update).length === 0) { out.skip = "up-to-date"; return out; }
  const { error } = await admin.from("orders").update(update).eq("id", order.id);
  if (error) { out.error = error.message; return out; }
  out.updated = Object.keys(update);
  out.poStatus = poStatus;
  return out;
}

const ORDER_COLS = "id, shop_order_no, status, weight_grams, qc_images, measurement_images, dispute_status, arrived_at";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });

  // Sweep-modus (pg_cron): alle actieve geplaatste orders die nog iets missen.
  if (body?.sweep) {
    const { data: rows } = await admin.from("orders").select(ORDER_COLS)
      .not("shop_order_no", "is", null)
      .in("status", ["purchased", "bought", "shipped_local", "qc_pending"])
      .order("created_at", { ascending: false })
      .limit(60);
    const needsSync = (o: OrderRow) => {
      const qc = Array.isArray(o.qc_images) ? o.qc_images.filter(isHttp) : [];
      const missingPhotos = qc.length === 0 || qc.every((u) => !onOwnStorage(u));
      return !o.weight_grams || missingPhotos || o.status !== "qc_pending";
    };
    const todo = (rows ?? []).filter(needsSync).slice(0, 25) as OrderRow[];
    const results = [];
    for (const o of todo) results.push(await syncOrder(o));
    return json({ ok: true, checked: rows?.length ?? 0, synced: results });
  }

  // Eén order: via de pg_net-trigger ({record}) of handmatig ({order_id}).
  const id = body?.record?.id ?? body?.order_id;
  if (!id) return json({ ok: false, error: "no order" });
  const { data: order } = await admin.from("orders").select(ORDER_COLS).eq("id", id).maybeSingle();
  if (!order) return json({ ok: false, error: "order not found" });
  const result = await syncOrder(order as OrderRow, !!body?.debug);
  return json({ ok: true, ...result });
});
