// Flowva — F4: ontvangt status-notificaties van BuckyDrop (webhook).
// BuckyDrop POST't {notifyHeader, notifyBody} hierheen. We verifiëren de
// handtekening, vertalen de status naar onze app-status, werken de order bij
// (wat de push-melding triggert) en zetten QC-/defect-foto's op de bestelling.
// Publiek endpoint (verify_jwt=false) — beveiliging = de BuckyDrop-handtekening.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_CODE = Deno.env.get("BUCKY_APP_CODE")!;
const APP_SECRET = Deno.env.get("BUCKY_APP_SECRET")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const md5Hex = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

// Inkomende handtekening (bewezen tegen hun voorbeeld):
// MD5(alfabetisch-gesorteerde niet-lege notifyHeader-params (key=value&...) + "&appSecret=" + appSecret)
function verifySign(header: Record<string, unknown>): boolean {
  const sign = header?.sign;
  if (!sign) return false;
  const params = Object.entries(header)
    .filter(([k, v]) => k !== "sign" && v !== null && v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return md5Hex(`${params}&appSecret=${APP_SECRET}`).toLowerCase() === String(sign).toLowerCase();
}

// BuckyDrop PO orderStatus (1-12) → app-status.
const PO_STATUS_MAP: Record<number, string> = {
  5: "bought",                 // ordered
  6: "shipped_local",          // shipped out (richting magazijn)
  9: "qc_pending",             // stock-in (in magazijn → QC)
  11: "shipped_international",  // international delivered
  12: "delivered",             // fulfilled
};
// Parcel pkgNormalStatus (1-5) → app-status.
const PKG_STATUS_MAP: Record<number, string> = {
  2: "shipped_international",   // shipped out
  3: "shipped_international",   // to be delivered
  4: "delivered",              // delivered
};

// Rang om alleen vooruit te bewegen (geen out-of-order webhooks die terugzetten).
const RANK: Record<string, number> = {
  requested: 0, quote_sent: 0, quote_accepted: 0, purchased: 1,
  bought: 2, shipped_local: 3, qc_pending: 4, shipped_international: 5, delivered: 6,
};

async function setOrderStatus(orderId: string, newStatus: string): Promise<string> {
  const { data: o } = await admin.from("orders").select("status").eq("id", orderId).maybeSingle();
  if (!o) return "not found";
  if (o.status === "cancelled") return "cancelled";
  if ((RANK[newStatus] ?? 0) <= (RANK[o.status] ?? 0)) return "no forward";
  await admin.from("orders").update({ status: newStatus }).eq("id", orderId);
  return `→ ${newStatus}`;
}

// Vind het PO-object (heeft orderCode + orderStatus 1-12) ergens in de body.
function findPO(node: any): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findPO(n); if (r) return r; } return null; }
  if ("orderCode" in node && "orderStatus" in node) return node;
  for (const k of Object.keys(node)) { const r = findPO(node[k]); if (r) return r; }
  return null;
}
// Vind een foto-lijst (defect-/QC-foto's) ergens in de body.
function findPics(node: any): string[] | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node.picList) && node.picList.length) return node.picList;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (typeof v === "object") { const r = findPics(v); if (r) return r; }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const payload = await req.json().catch(() => null);
  const header = (payload?.notifyHeader ?? {}) as Record<string, any>;
  const body = (payload?.notifyBody ?? {}) as Record<string, any>;

  const signOk = !!payload && verifySign(header) && (!header.appCode || String(header.appCode) === APP_CODE);
  let matched = "";
  let action = "ignored";

  if (payload && signOk) {
    const isParcel = body.packageCode != null || header.packageCode != null || body.pkgNormalStatus != null;
    if (isParcel) {
      const mapped = PKG_STATUS_MAP[Number(body.pkgNormalStatus)];
      const ids = Array.isArray(body.partnerOrderNoList) ? body.partnerOrderNoList.map(String) : [];
      if (mapped && ids.length) {
        for (const oid of ids) await setOrderStatus(oid, mapped);
        matched = ids.join(",");
        action = `parcel ${body.pkgNormalStatus} → ${mapped}`;
      } else action = `parcel ${body.pkgNormalStatus} (no map/ids)`;
    } else {
      const partnerOrderNo = String(header.partnerOrderNo ?? body?.shopOrderInfo?.partnerOrderNo ?? "");
      const po = findPO(body);
      const poStatus = po ? Number(po.orderStatus) : null;
      const pics = findPics(body);
      if (partnerOrderNo) {
        matched = partnerOrderNo;
        // Defect-/inspectiefoto's → op de bestelling + probleem markeren.
        if (pics) {
          await admin.from("orders").update({
            qc_images: pics,
            ...(body.confirmType || po?.confirmType ? { dispute_status: "pending", problem_type: String(body.confirmType ?? po?.confirmType ?? "defect") } : {}),
          }).eq("id", partnerOrderNo);
          action = `photos (${pics.length})`;
        }
        if (poStatus === 8) {
          await admin.rpc("refund_order", { p_order_id: partnerOrderNo, p_reason: "BuckyDrop cancelled the order" });
          action = "cancelled + refund";
        } else {
          const mapped = poStatus != null ? PO_STATUS_MAP[poStatus] : null;
          if (mapped) action = `po ${poStatus} ${await setOrderStatus(partnerOrderNo, mapped)}`;
          else if (action === "ignored") action = `po ${poStatus} (no map)`;
        }
      }
    }
  }

  // Altijd rauw loggen (ook bij ongeldige handtekening) — om de echte structuur te zien.
  await admin.from("bucky_notifications").insert({
    notify_type: String(header?.notifyType ?? ""),
    matched, action, sign_ok: signOk, payload,
  }).then(() => {}, () => {});

  // BuckyDrop verwacht (vermoedelijk) een 200 met success. Bij ongeldige sign: 401.
  if (!signOk) return new Response(JSON.stringify({ success: false, error: "invalid sign" }), { status: 401, headers: { "Content-Type": "application/json" } });
  return new Response(JSON.stringify({ success: true, action }), { headers: { "Content-Type": "application/json" } });
});
