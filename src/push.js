import { supabase } from "./supabase";

// Publieke VAPID-sleutel — veilig voor de browser (de privé-sleutel zit alleen
// server-side in de edge function). Hoort bij het paar dat is gegenereerd.
const VAPID_PUBLIC_KEY =
  "BNNZ7qxywezu_W7Rr65gaGuDglmNJQPDddQ05MZt67oy1MBqlXw96uA_OajJwZhRSP-Dja8J6k8WnLFT6diQOXg";

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

export function isiOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Huidige status: 'on' (geabonneerd), 'off' (kan aangezet worden),
// 'denied' (toestemming geweigerd), 'unsupported', of 'needs-install' (iOS, nog niet geïnstalleerd).
export async function pushStatus() {
  if (!pushSupported()) return "unsupported";
  if (isiOS() && !isStandalone()) return "needs-install";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? "on" : "off";
}

export async function enablePush(session) {
  if (!pushSupported()) throw new Error("Notifications aren't supported on this device.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const json = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: session.user.id,
      endpoint: sub.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: "endpoint" }
  );
  if (error) throw new Error(error.message);
  return true;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
  return true;
}
