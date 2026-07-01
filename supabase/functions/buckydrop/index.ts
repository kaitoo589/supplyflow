// Flowva — BuckyDrop API-gateway.
// Houdt de APPsecret server-side (nooit in de browser) en tekent elk verzoek.
// Alleen ingelogde admins mogen deze function aanroepen.
//
// Secrets (via `npx supabase secrets set …`):
//   BUCKY_APP_CODE, BUCKY_APP_SECRET, BUCKY_DOMAIN  (productie — gedeeld met place-bucky-order)
// OPTIONEEL apart FETCH-account voor het OPHALEN (product/detail):
//   BUCKY_FETCH_APP_CODE, BUCKY_FETCH_APP_SECRET, BUCKY_FETCH_DOMAIN
//   Reden: het `openapi/product/detail`-endpoint wordt op het productie-account
//   geweigerd ("Permission denied"), maar werkt op het sandbox/dev-account. Zet deze
//   drie op je dev-credentials → ophalen gebruikt het dev-account, bestellen blijft
//   productie (place-bucky-order). Zet je ze NIET, dan valt alles terug op de
//   productie-secrets (= huidig gedrag, geen wijziging).
// (SUPABASE_URL en SUPABASE_ANON_KEY worden automatisch geïnjecteerd.)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_CODE = Deno.env.get("BUCKY_FETCH_APP_CODE") ?? Deno.env.get("BUCKY_APP_CODE")!;
const APP_SECRET = Deno.env.get("BUCKY_FETCH_APP_SECRET") ?? Deno.env.get("BUCKY_APP_SECRET")!;
const BUCKY_DOMAIN = Deno.env.get("BUCKY_FETCH_DOMAIN") ?? Deno.env.get("BUCKY_DOMAIN") ?? "https://dev.buckydrop.com";

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
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* niet-JSON respons */ }
  // Bij een HTTP-fout (of niet-JSON respons) geven we een diagnostische melding
  // mét het BuckyDrop-adres en de status terug, zodat een dev/prod-domein- of
  // permissie-mismatch meteen zichtbaar is. Het appCode/secret lekken we nooit.
  if (!res.ok || !parsed) {
    const host = (() => { try { return new URL(BUCKY_DOMAIN).host; } catch { return BUCKY_DOMAIN; } })();
    const msg = parsed && typeof parsed === "object"
      ? (parsed.message || parsed.msg || parsed.info || JSON.stringify(parsed).slice(0, 160))
      : (text || "lege respons").slice(0, 160);
    return { success: false, httpStatus: res.status, info: `BuckyDrop ${host} → HTTP ${res.status}: ${msg}` };
  }
  return parsed;
}

// Witte lijst van toegestane acties → BuckyDrop-endpoints.
const ACTIONS: Record<string, (p: Record<string, unknown>) => Promise<unknown>> = {
  "product-detail": (p) =>
    buckyPost("/api/rest/v2/adapt/openapi/product/detail", { productLink: p.productLink }),
  "order-detail": (p) =>
    buckyPost("/api/rest/v2/adapt/adaptation/order/detail", { shopOrderNo: p.shopOrderNo }),
  "return-get": (p) =>
    buckyPost("/api/rest/v2/adapt/adaptation/order/return/get", { returnFlowCode: p.returnFlowCode }),
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Admin-check: valideer het user-JWT en eis role = admin.
  // We valideren het token RECHTSTREEKS tegen GoTrue (/auth/v1/user) i.p.v. via
  // supabase-js getUser(): die wierp in de esm.sh-build "Auth session missing!"
  // (nam het token-argument niet) ook al stuurde de client een geldig token mee.
  // Een directe fetch is versie-onafhankelijk en toont de exacte HTTP-reden.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Niet ingelogd (geen token meegestuurd)" }, 401);
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) {
    const body = await userRes.text().catch(() => "");
    return json({ error: `Niet ingelogd — GoTrue ${userRes.status}: ${body.slice(0, 200)}` }, 401);
  }
  const user = await userRes.json().catch(() => null);
  if (!user?.id) return json({ error: "Niet ingelogd (geen gebruiker uit token)" }, 401);
  // Rol-check met service role (omzeilt RLS; de gebruiker is hierboven al geverifieerd).
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: profile, error: profErr } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return json({ error: `Alleen admins${profErr ? ` — ${profErr.message}` : ""}` }, 403);

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
