// Flowva — track-haul: pollt BuckyDrop logistics/query-info voor verzonden
// pakketten en slaat de tracking-tijdlijn op het pakket (haul) op.
// Door een cron (elke 6u) aangeroepen; beveiligd met x-webhook-secret.
// De klant belt NOOIT zelf BuckyDrop — die leest het resultaat uit de DB.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_CODE = Deno.env.get("BUCKY_APP_CODE")!;
const APP_SECRET = Deno.env.get("BUCKY_APP_SECRET")!;
const BUCKY_DOMAIN = Deno.env.get("BUCKY_DOMAIN") ?? "https://dev.buckydrop.com";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const md5Hex = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

async function buckyPost(path: string, bodyObj: unknown) {
  const body = JSON.stringify(bodyObj ?? {});
  const ts = Date.now().toString();
  const sign = md5Hex(APP_CODE + body + ts + APP_SECRET);
  const url = `${BUCKY_DOMAIN}${path}?appCode=${APP_CODE}&timestamp=${ts}&sign=${sign}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", lang: "en" }, body });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { success: false, info: text }; }
}

// Trace-nodes uit origin + destination samenvoegen → één tijdlijn (nieuwste eerst).
function mergeNodes(data: any) {
  const out: { time: string | null; place: string | null; desc: string | null }[] = [];
  for (const branch of [data?.destinationTraceInfo, data?.originTraceInfo]) {
    const nodes = Array.isArray(branch?.traceNodes) ? branch.traceNodes : [];
    for (const n of nodes) {
      out.push({ time: n?.recordTime ?? null, place: n?.pos ?? null, desc: n?.description ?? null });
    }
  }
  out.sort((a, b) => String(b.time ?? "").localeCompare(String(a.time ?? "")));
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if ((req.headers.get("x-webhook-secret") ?? "") !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  // Pakketten met een packageCode (de cron pollt alleen die met een code).
  const { data: hauls } = await admin.from("hauls")
    .select("id, package_code, trace_status")
    .not("package_code", "is", null);

  let polled = 0, updated = 0;
  for (const h of hauls ?? []) {
    // Afgeleverd (3) of retour-afgerond (7) = klaar, niet meer pollen.
    if (h.trace_status === 3 || h.trace_status === 7) continue;
    polled++;
    const res = await buckyPost("/api/rest/v2/adapt/adaptation/logistics/query-info", { packageCode: h.package_code });
    const d = res?.data;
    if (!res?.success || !d) continue;
    const dest = d.destinationTraceInfo ?? {};
    const orig = d.originTraceInfo ?? {};
    const patch = {
      trace_status: Number(d.traceStatus) || null,
      tracking_no: d.carrierTraceNo ?? d.traceNo ?? null,
      carrier_name: dest.carrierName ?? orig.carrierName ?? null,
      carrier_link: dest.carrierLink ?? orig.carrierLink ?? null,
      trace_nodes: mergeNodes(d),
      tracking_updated_at: new Date().toISOString(),
    };
    const { error } = await admin.from("hauls").update(patch).eq("id", h.id);
    if (!error) updated++;
  }

  return new Response(JSON.stringify({ ok: true, polled, updated }), { headers: { "Content-Type": "application/json" } });
});
