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

// The message the customer sees for each order status.
const MESSAGES: Record<string, { title: string; body: string }> = {
  purchased: { title: "🛒 Order placed", body: "We're buying your item for you right now." },
  bought: { title: "✅ Item bought!", body: "Your item is paid for and heading to our warehouse." },
  shipped_local: { title: "🚚 On its way to our warehouse", body: "Your item is in transit in China." },
  qc_pending: { title: "📸 QC photos are ready!", body: "View your item and add it to a parcel in the app." },
  shipped_international: { title: "✈️ Shipped to you", body: "Your parcel is on its way to you!" },
  delivered: { title: "🎉 Delivered!", body: "Your order has arrived. Enjoy!" },
  cancelled: { title: "↩️ Order refunded", body: "An item was unavailable, so we've refunded it to your balance." },
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
