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
  // arrived_at = "in-warehouse sinds" — basis voor de 30-dagen gratis opslag + verbeuring.
  const patch: Record<string, unknown> = { status: newStatus };
  if (newStatus === "qc_pending") patch.arrived_at = new Date().toISOString();
  await admin.from("orders").update(patch).eq("id", orderId);
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
// Verzamel defect-meldingen ergens in de body. HARDE LES (2026-07-12, order
// FF-1783288701233): een écht magazijn-defect ("Wrong color") kwam binnen met
// confirmType:null — het signaal zat in poOrderDetails[].defectTypeList[]
// (defectsType + defectsInstructionsEn/Cn). Alleen op confirmType checken mist dus
// echte defecten; deze helper vangt beide.
function findDefectList(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const n of node) findDefectList(n, out); return out; }
  if (Array.isArray(node.defectTypeList)) out.push(...node.defectTypeList.filter(Boolean));
  for (const k of Object.keys(node)) findDefectList(node[k], out);
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const payload = await req.json().catch(() => null);
  const header = (payload?.notifyHeader ?? {}) as Record<string, any>;
  const body = (payload?.notifyBody ?? {}) as Record<string, any>;

  const signOk = !!payload && verifySign(header) && (!header.appCode || String(header.appCode) === APP_CODE);
  // Replay-begrenzing (audit 2026-07-12): negeer een (geldig ondertekende) melding die
  // ouder is dan 7 dagen of >2u in de toekomst ligt. Echte webhooks komen binnen seconden
  // binnen → dit weigert nooit een legitieme melding, maar kapt oud-replay af.
  // Geen timestamp aanwezig → niet blokkeren (BuckyDrop stuurt 'm normaal wel mee).
  const ts = Number(header?.timestamp);
  const fresh = !ts || (Date.now() - ts < 7 * 864e5 && ts - Date.now() < 2 * 36e5);
  let matched = "";
  let action = signOk && !fresh ? "stale (ignored)" : "ignored";

  if (payload && signOk && fresh) {
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
        // Defect-signaal: defectTypeList (het échte kanaal, zie helper) óf confirmType.
        // Label = de Engelse omschrijving ("Wrong color") — dat ziet de klant.
        const defects = findDefectList(body);
        const defectLabel = defects.length
          ? String(defects[0]?.defectsInstructionsEn || defects[0]?.defectsInstructionsCn || "defect")
          : (body.confirmType || po?.confirmType) ? String(body.confirmType ?? po?.confirmType) : "";
        if (pics || defectLabel) {
          // Huidige staat éérst lezen: (a) nooit een lopende dispute-afhandeling
          // overschrijven (zelfde regel als fetch-weight), (b) al-gerehoste foto's op
          // eigen storage niet terugzetten naar verlopende WMS-links.
          const { data: cur } = await admin.from("orders").select("dispute_status, qc_images").eq("id", partnerOrderNo).maybeSingle();
          if (cur) {
            const update: Record<string, unknown> = {};
            const curQc = Array.isArray(cur.qc_images) ? cur.qc_images.filter((u: unknown) => typeof u === "string") : [];
            const hasOwnStorage = curQc.some((u: string) => u.includes(`${new URL(SUPABASE_URL).host}/storage/`));
            if (pics && !hasOwnStorage) update.qc_images = pics;
            if (defectLabel && !cur.dispute_status) {
              update.dispute_status = "bucky_flagged";
              update.problem_type = defectLabel;
              // Defect-cockpit (2026-07-21): blijvend detectie-stempel → admin-lijst + stopwatch.
              update.defect_detected_at = new Date().toISOString();
            }
            if (Object.keys(update).length) await admin.from("orders").update(update).eq("id", partnerOrderNo);
          }
          action = `${pics ? `photos (${pics.length})` : ""}${pics && defectLabel ? " + " : ""}${defectLabel ? `defect: ${defectLabel}` : ""}`;
        }
        // FOTO-GEDREVEN "In warehouse" (user-keuze 2026-07-13): QC-foto's binnen = aangekomen,
        // ook als de PO-status nog op inbound (7) staat i.p.v. stock-in (9). setOrderStatus is
        // forward-only en zet arrived_at, dus dit loopt nooit terug of dubbel.
        if (pics) { const r = await setOrderStatus(partnerOrderNo, "qc_pending"); if (action.startsWith("photos")) action += ` (${r})`; }
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

  // Loggen. Bij een GELDIGE sign de volledige payload (voor debug/structuur); bij een
  // ONGELDIGE sign GEEN rauwe attacker-payload opslaan (anti-bloat + geen opgeslagen
  // vreemde inhoud) — alleen een marker zodat je ziet dát er een afgewezen call was.
  await admin.from("bucky_notifications").insert({
    notify_type: String(header?.notifyType ?? ""),
    matched, action, sign_ok: signOk,
    payload: signOk ? payload : { suppressed: true, notifyType: header?.notifyType ?? null },
  }).then(() => {}, () => {});

  // BuckyDrop verwacht (vermoedelijk) een 200 met success. Bij ongeldige sign: 401.
  if (!signOk) return new Response(JSON.stringify({ success: false, error: "invalid sign" }), { status: 401, headers: { "Content-Type": "application/json" } });
  return new Response(JSON.stringify({ success: true, action }), { headers: { "Content-Type": "application/json" } });
});
