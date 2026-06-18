// Flowva — BuckyDrop API-gateway.
// Houdt de APPsecret server-side (nooit in de browser) en tekent elk verzoek.
// Alleen ingelogde admins mogen deze function aanroepen.
//
// Secrets (via `npx supabase secrets set …`):
//   BUCKY_APP_CODE, BUCKY_APP_SECRET, BUCKY_DOMAIN
// (SUPABASE_URL en SUPABASE_ANON_KEY worden automatisch geïnjecteerd.)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_CODE = Deno.env.get("BUCKY_APP_CODE")!;
const APP_SECRET = Deno.env.get("BUCKY_APP_SECRET")!;
const BUCKY_DOMAIN = Deno.env.get("BUCKY_DOMAIN") ?? "https://dev.buckydrop.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function md5Hex(s: string): string {
  return createHash("md5").update(s, "utf8").digest("hex");
}

// POST-ondertekening: sign = MD5(appCode + jsonParams + timestamp + appSecret).
// jsonParams = exact dezelfde body-string die we versturen.
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
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, info: text || `HTTP ${res.status}`, httpStatus: res.status };
  }
}

// Witte lijst van toegestane acties → BuckyDrop-endpoints.
const ACTIONS: Record<string, (p: Record<string, unknown>) => Promise<unknown>> = {
  "product-detail": (p) =>
    buckyPost("/api/rest/v2/adapt/openapi/product/detail", { productLink: p.productLink }),
  "order-detail": (p) =>
    buckyPost("/api/rest/v2/adapt/adaptation/order/detail", { shopOrderNo: p.shopOrderNo }),
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Admin-check: valideer de JWT van de aanroeper en eis role = admin.
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "Niet ingelogd" }, 401);
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return json({ error: "Alleen admins" }, 403);

  const payload = await req.json().catch(() => ({}));
  const { action, ...params } = payload ?? {};
  const fn = ACTIONS[action as string];
  if (!fn) return json({ error: `Onbekende actie: ${action}` }, 400);

  try {
    const result = await fn(params);
    return json(result, 200);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
