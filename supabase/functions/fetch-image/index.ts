// Flowva — fetch-image: haalt een externe afbeelding SERVER-SIDE op (omzeilt
// hotlink-/referer-bescherming van alicdn/1688) en stuurt de bytes terug mét CORS,
// zodat de admin-cropper ze same-origin kan laden en bijsnijden (geen canvas-taint).
// Alleen afbeeldingen, met SSRF-guard + size-cap. Gebruikt door de admin storefront-cropper.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const errJson = (msg: string, status = 400) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return errJson("Method not allowed", 405);
  try {
    const { url } = await req.json().catch(() => ({}));
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) return errJson("Invalid url");

    let host = "";
    try { host = new URL(url).hostname; } catch { return errJson("Invalid url"); }
    // SSRF-guard: geen interne/private hosts.
    if (/^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|\[)/i.test(host) || /\.(local|internal)$/i.test(host)) {
      return errJson("Blocked host");
    }

    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "" }, redirect: "follow" });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) return errJson(`Source returned ${res.status}`);
    if (!ct.startsWith("image/")) return errJson(`Not an image (${ct || "unknown"})`);

    const buf = await res.arrayBuffer();
    if (buf.byteLength > 12_000_000) return errJson("Image too large");
    return new Response(buf, { headers: { ...cors, "Content-Type": ct, "Cache-Control": "no-store" } });
  } catch (e) {
    return errJson(String((e as Error)?.message || e), 500);
  }
});
