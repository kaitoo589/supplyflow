// Flowva — EU-herroepingsknop: neemt een herroepings-/annuleringsverzoek aan
// ZONDER login (verify_jwt=false), logt het, en stuurt (indien geconfigureerd via
// RESEND_API_KEY) een automatische bevestigingsmail naar de klant.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Flowva <onboarding@resend.dev>";
const RETURN_ADDRESS = Deno.env.get("FLOWVA_RETURN_ADDRESS") ?? "Flowva Returns, the Netherlands";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Automatische bevestiging via Resend (alleen als de key is gezet — anders overslaan).
async function sendConfirmation(to: string, name: string, orderNumber: string) {
  if (!RESEND_API_KEY) return;
  const html = `
    <p>Hi ${name || "there"},</p>
    <p>We've received your withdrawal / cancellation request for order <b>${orderNumber}</b>.</p>
    <p>If your item has already shipped, please return it within 14 days to:<br><b>${RETURN_ADDRESS}</b></p>
    <p>Once we receive and check the item, we refund the product price to your Flowva balance. Return shipping is paid by you unless the item was faulty.</p>
    <p>— Flowva</p>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject: "We received your withdrawal request — Flowva", html }),
  }).then(() => {}, () => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const p = await req.json().catch(() => null);
  const name = String(p?.name ?? "").trim().slice(0, 200);
  const orderNumber = String(p?.orderNumber ?? "").trim().slice(0, 100);
  const email = String(p?.email ?? "").trim().slice(0, 200);
  const message = String(p?.message ?? "").trim().slice(0, 2000);
  if (!name || !orderNumber || !/.+@.+\..+/.test(email)) {
    return json({ ok: false, error: "Please fill in your name, order number and a valid email." }, 400);
  }

  await admin.from("withdrawal_requests").insert({ name, order_number: orderNumber, email, message });
  await sendConfirmation(email, name, orderNumber);
  return json({ ok: true });
});
