// Flowva Friends — stuurt een "je squad wacht op je"-push naar één groepslid.
// De client roept dit aan met de eigen JWT; we verifiëren dat de BELLER lid is van
// de groep en dat het DOEL ook in die groep zit, en sturen dan een web-push.
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:contact@lithra.store";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ ok: false, error: "unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  const groupId = body?.groupId;
  const target = body?.targetUserId;
  if (!groupId || !target) return json({ ok: false, error: "bad request" }, 400);

  // Beller-context (RLS): wie ben je + ben je lid van deze groep?
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: who } = await asUser.auth.getUser();
  const caller = who?.user;
  if (!caller) return json({ ok: false, error: "unauthorized" }, 401);
  if (caller.id === target) return json({ ok: false, error: "cannot nudge yourself" }, 400);
  const { data: isMem } = await asUser.rpc("ff_is_member", { p_group: groupId });
  if (isMem !== true) return json({ ok: false, error: "not a member" }, 403);

  // Service role: het doel moet in dezelfde groep zitten; laad z'n push-abonnementen.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: tm } = await admin.from("flowva_group_members")
    .select("user_id").eq("group_id", groupId).eq("user_id", target).maybeSingle();
  if (!tm) return json({ ok: false, error: "target not in group" }, 400);

  // Server-side cooldown tegen push-spam: max één nudge per (beller → doel → groep) per 60s.
  const sinceIso = new Date(Date.now() - 60_000).toISOString();
  const { data: recent } = await admin.from("ff_nudge_log").select("id")
    .eq("caller_id", caller.id).eq("target_id", target).eq("group_id", groupId)
    .gte("created_at", sinceIso).limit(1);
  if (recent && recent.length > 0) {
    return json({ ok: false, error: "You just nudged them — give it a minute." }, 429);
  }
  await admin.from("ff_nudge_log").insert({ caller_id: caller.id, target_id: target, group_id: groupId });

  const { data: g } = await admin.from("flowva_groups").select("name").eq("id", groupId).maybeSingle();
  const { data: subs } = await admin.from("push_subscriptions")
    .select("endpoint, p256dh, auth").eq("user_id", target);

  const payload = JSON.stringify({
    title: "🦊 Your squad is waiting!",
    body: `Everyone's ready in "${g?.name || "your group"}" — tap to confirm your items.`,
    url: "/",
    tag: `ff-nudge-${groupId}`,
  });

  let sent = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
    }
  }));

  return json({ ok: true, sent });
});
