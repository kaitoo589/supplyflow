// Flowva Friends — client-helpers rond de SECURITY DEFINER-RPC's (Fase 1-fundament).
// Alle mutaties lopen via rpc(); lezen van leden/items mag direct (RLS staat het toe
// voor leden van de groep). Bestandsnaam ffApi (niet "friends.js") om een hoofdletter-
// ongevoelige botsing met Friends.jsx op Windows te vermijden.
import { supabase } from "./supabase";

const rpc = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args || {});
  if (error) return { ok: false, error: error.message };
  return data || { ok: false, error: "No response" };
};

export const ffMyGroups       = () => rpc("ff_my_groups");
export const ffPreview        = (code) => rpc("ff_group_preview", { p_invite_code: code });
export const ffCreateGroup    = (name, maxSize) => rpc("ff_create_group", { p_name: name, p_max_size: maxSize, p_join_mode: "open" });
export const ffJoinGroup      = (code) => rpc("ff_join_group", { p_invite_code: code });
export const ffLeaveGroup     = (id) => rpc("ff_leave_group", { p_group_id: id });
export const ffKickMember     = (id, uid) => rpc("ff_kick_member", { p_group_id: id, p_user_id: uid });
export const ffSetHost        = (id, uid) => rpc("ff_set_host", { p_group_id: id, p_user_id: uid });
export const ffUpdateSettings = (id, { name, maxSize, orderWindowDays }) =>
  rpc("ff_update_settings", { p_group_id: id, p_name: name ?? null, p_max_size: maxSize ?? null, p_join_mode: null, p_order_window_days: orderWindowDays ?? null });
export const ffAddItem        = (id, item) => rpc("ff_add_item", { p_group_id: id, p_item: item });
export const ffRemoveItem     = (itemId) => rpc("ff_remove_item", { p_item_id: itemId });
export const ffSyncProfile    = () => rpc("ff_sync_profile");
export const ffSetAdmin       = (id, uid) => rpc("ff_set_admin", { p_group_id: id, p_user_id: uid });
export const ffSetPrivate     = (id, priv) => rpc("ff_set_private", { p_group_id: id, p_private: priv });
export const ffShareProduct   = (id, product) => rpc("ff_share_product", { p_group_id: id, p_product: product });

// Fase 3 — ready-up + betaling.
export const ffSetReady       = (id) => rpc("ff_set_ready", { p_group_id: id });
export const ffUnready        = (id) => rpc("ff_unready",   { p_group_id: id });

// Price-guard vóór ready: dezelfde edge function als de solo-checkout. Geeft de
// gewijzigde source_urls terug zodat de lobby die items "on hold" kan tonen.
// Onbereikbaar → fail-open (ff_set_ready + Fase-5 vangen het alsnog af).
export async function checkGroupPrices(items) {
  try {
    const { data } = await supabase.functions.invoke("check-cart-prices", {
      body: { items: (items || []).map((it) => ({ source_url: it.source_url, kleur: it.kleur })) },
    });
    if (data?.anyChanged) {
      return { changed: true, urls: (data.items || []).filter((x) => x.changed).map((x) => x.source_url) };
    }
  } catch { /* fail-open */ }
  return { changed: false, urls: [] };
}

// Spiegelt public.ff_member_fee — ALLEEN voor weergave; de echte fee komt server-side.
// Houd in sync met flowva-friends-money.sql.
export function estimateMemberFee(size, total) {
  const t = Number(total) || 0;
  const tiers = { 2: [0.070, 4.5], 3: [0.060, 4.5], 4: [0.055, 4.0], 5: [0.050, 4.0], 6: [0.045, 4.0], 7: [0.040, 3.5] };
  const [pct, min] = tiers[Math.min(Math.max(Number(size) || 1, 1), 7)] || [0.08, 5.0];
  return Math.max(Math.round(t * pct * 100) / 100, min);
}

// ── Fase 4 — social/realtime ────────────────────────────────────────────────
export const ffPostMessage = (id, body) => rpc("ff_post_message", { p_group_id: id, p_body: body });
export const ffShareItem   = (id, itemId) => rpc("ff_share_item", { p_group_id: id, p_item_id: itemId });
export const ffReact       = (msgId, emoji) => rpc("ff_react", { p_message_id: msgId, p_emoji: emoji });

export async function ffNudge(groupId, targetUserId) {
  try {
    const { data, error } = await supabase.functions.invoke("ff-nudge", { body: { groupId, targetUserId } });
    if (error) return { ok: false, error: error.message };
    return data || { ok: false, error: "No response" };
  } catch (e) { return { ok: false, error: e?.message || "Nudge failed" }; }
}

export async function ffFetchMessages(groupId) {
  const { data } = await supabase
    .from("flowva_group_messages").select("*").eq("group_id", groupId).order("created_at");
  return data || [];
}

// Eén realtime-kanaal dat álle FF-tabellen voor deze groep volgt → cb(table) bij wijziging.
export function subscribeGroup(groupId, cb) {
  const ch = supabase.channel(`ff-group-${groupId}`);
  ["flowva_groups", "flowva_group_members", "flowva_group_items", "flowva_group_messages"].forEach((table) => {
    const filter = table === "flowva_groups" ? `id=eq.${groupId}` : `group_id=eq.${groupId}`;
    ch.on("postgres_changes", { event: "*", schema: "public", table, filter }, () => cb(table));
  });
  ch.subscribe();
  return () => { try { supabase.removeChannel(ch); } catch { /* ignore */ } };
}

// Geschatte besparing van samen bestellen vs. ieder solo (indicatief/marketing).
// Fee: solo 8%/€5 vs groeps-tier per persoon. Verzending: solo betaalt ieder een eigen
// first-weight-blok (~€9); samen deel je er één → ruwe schat (N-1)×€9.
export function groupSavings(members, items) {
  const SHIP_FIRST_EUR = 9;
  const byOwner = {};
  (items || []).forEach((it) => {
    byOwner[it.owner_id] = (byOwner[it.owner_id] || 0) + (Number(it.price) || 0) * Math.max(Number(it.qty) || 1, 1);
  });
  const n = (members || []).length;
  let feeSaved = 0;
  (members || []).forEach((m) => {
    const t = byOwner[m.user_id] || 0;
    if (t > 0) feeSaved += Math.max(estimateMemberFee(1, t) - estimateMemberFee(n, t), 0);
  });
  // Alleen leden die ÉCHT items hebben besparen verzending (een leeg lid verstuurt niets).
  const ownersWithItems = Object.keys(byOwner).filter((k) => byOwner[k] > 0).length;
  const shipSaved = Math.max(ownersWithItems - 1, 0) * SHIP_FIRST_EUR;
  return Math.round((feeSaved + shipSaved) * 100) / 100;
}

// Volledige groep ophalen: groep + leden + gedeelde mand (RLS staat lezen toe voor leden).
export async function ffFetchGroup(groupId) {
  const [g, members, items] = await Promise.all([
    supabase.from("flowva_groups").select("*").eq("id", groupId).single(),
    supabase.rpc("ff_group_members", { p_group_id: groupId }),   // live naam + foto, geen verouderde momentopname
    supabase.from("flowva_group_items").select("*").eq("group_id", groupId).order("created_at"),
  ]);
  return {
    group: g.data || null,
    members: members.data?.members || [],
    items: items.data || [],
    error: g.error?.message || members.error?.message || items.error?.message || null,
  };
}

export function inviteLink(code) {
  const base = typeof window !== "undefined" ? window.location.origin : "https://flowva.app";
  return `${base}/?join=${encodeURIComponent(code)}`;
}

export function whatsappShare(code, groupName) {
  const text = `Join my Flowva group "${groupName || "Squad"}" — we order together so shipping + fees are way cheaper! ${inviteLink(code)}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
