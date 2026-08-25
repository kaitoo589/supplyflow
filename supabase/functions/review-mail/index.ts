// Flowva — Trustpilot-review-mail (25-08): één automatische mail per BEZORGD pakket.
// Draait via pg_cron (elk uur, zie supabase/review-mail.sql): pakt hauls met
// trace_status 3 (delivered) die nog geen mail kregen, mailt de klant via Resend
// (neutraal geformuleerd — "good or bad" — conform de Trustpilot-regels: nooit een
// beloning, iederéén vragen), en stempelt review_mailed_at zodat het één keer blijft.
// Interne accounts (profiles.is_intern) krijgen géén mail, alleen de stempel.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Flowva <noreply@flowva.app>";
const TRUSTPILOT_URL = "https://www.trustpilot.com/evaluate/flowva.app";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

// Zelfde timing-safe vergelijking als notify-order.
function timingSafeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function sendReviewMail(to: string, name: string) {
  const html = `
  <div style="font-family:-apple-system,'Segoe UI',Inter,sans-serif;max-width:520px;margin:0 auto;color:#0F0E0C;">
    <p style="font-size:15px;">Hi ${esc(name) || "there"},</p>
    <p style="font-size:15px;line-height:1.6;">Your Flowva parcel has been delivered — we hope you love what's inside! 🎉</p>
    <p style="font-size:15px;line-height:1.6;">Would you take a minute to share your experience on Trustpilot? <b>Good or bad</b> — we read every review, and it helps other shoppers know what to expect.</p>
    <p style="margin:26px 0;">
      <a href="${TRUSTPILOT_URL}" style="background:#00B67A;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:12px;display:inline-block;">★ Review Flowva on Trustpilot</a>
    </p>
    <p style="font-size:12px;color:#8A8780;line-height:1.6;">You'll only receive this email once per delivered parcel. Questions about your order? Just reply to Flowva support in the app.</p>
    <p style="font-size:14px;">— Flowva 🦊</p>
  </div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject: "Your Flowva parcel has arrived 🎉", html }),
  });
  // Foutdetail teruggeven (zonder adressen te lekken) zodat de cron-log vertelt
  // wat Resend dwarszit — bv. ongeldige key of niet-geverifieerd afzenderdomein.
  if (!res.ok) return { ok: false, detail: `${res.status}: ${(await res.text().catch(() => "")).slice(0, 180)}` };
  return { ok: true, detail: "" };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!WEBHOOK_SECRET || !timingSafeEq(req.headers.get("x-webhook-secret") ?? "", WEBHOOK_SECRET)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  if (!RESEND_API_KEY) return json({ ok: false, error: "RESEND_API_KEY ontbreekt" }, 500);

  const { data: hauls, error } = await admin
    .from("hauls")
    .select("id, user_id")
    .eq("trace_status", 3)
    .is("review_mailed_at", null)
    .limit(20);
  if (error) return json({ ok: false, error: error.message }, 500);

  let sent = 0, skipped = 0, laatsteFout = "";
  for (const h of hauls ?? []) {
    // Eerst stempelen (claim): een dubbele cron-run mailt dan nooit twee keer.
    const { data: claimed } = await admin.from("hauls")
      .update({ review_mailed_at: new Date().toISOString() })
      .eq("id", h.id).is("review_mailed_at", null).select("id");
    if (!claimed || claimed.length === 0) continue;

    const { data: prof } = await admin.from("profiles").select("is_intern").eq("id", h.user_id).single();
    if (prof?.is_intern) { skipped++; continue; }

    const { data: userRes } = await admin.auth.admin.getUserById(h.user_id);
    const email = userRes?.user?.email;
    const naam = (userRes?.user?.user_metadata?.voornaam as string) || "";
    if (!email) { skipped++; continue; }

    const uitkomst = await sendReviewMail(email, naam);
    if (uitkomst.ok) sent++;
    else {
      laatsteFout = uitkomst.detail;
      // Mislukt (Resend-storing): stempel terugdraaien zodat de volgende run het opnieuw probeert.
      await admin.from("hauls").update({ review_mailed_at: null }).eq("id", h.id);
    }
  }
  return json({ ok: true, sent, skipped, scanned: (hauls ?? []).length, lastError: laatsteFout || undefined });
});
