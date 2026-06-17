// Flowva — verstuurt push-meldingen bij een orderstatus-wijziging.
// Wordt aangeroepen door een Supabase Database Webhook op de orders-tabel.
// Beschermd met een gedeeld geheim (header x-webhook-secret).
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:contact@vable.store";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

// Per orderstatus de melding die de klant ziet.
const MESSAGES: Record<string, { title: string; body: string }> = {
  quote_sent: { title: "📋 Je offerte staat klaar!", body: "Bekijk de prijs en betaal vanuit je saldo." },
  quote_accepted: { title: "💰 Betaling ontvangen", body: "Je agent koopt je product nu in." },
  purchased: { title: "✅ Gekocht!", body: "Je product is gekocht en gaat naar het warehouse." },
  shipped_local: { title: "🚚 Onderweg in China", body: "Je product is onderweg naar ons warehouse." },
  qc_pending: { title: "📸 QC-foto's staan klaar!", body: "Bekijk je product en keur het goed in de app." },
  shipped_international: { title: "✈️ Internationaal verzonden", body: "Je pakket is onderweg naar je toe!" },
  delivered: { title: "🎉 Bezorgd!", body: "Je bestelling is bezorgd. Veel plezier!" },
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  const record = payload?.record;
  const old = payload?.old_record;
  if (!record || payload?.type !== "UPDATE") return new Response("ignored", { status: 200 });
  if (record.status === old?.status) return new Response("no status change", { status: 200 });

  const msg = MESSAGES[record.status as string];
  if (!msg) return new Response("no message for status", { status: 200 });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", record.user_id);

  const body = JSON.stringify({ title: msg.title, body: msg.body, url: "/", tag: `order-${record.id}` });

  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
      } catch (e) {
        // Verlopen/ongeldig abonnement → opruimen.
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
      }
    }),
  );

  return new Response(JSON.stringify({ sent: subs?.length ?? 0 }), {
    headers: { "Content-Type": "application/json" },
  });
});
