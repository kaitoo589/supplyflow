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
export const ffUpdateSettings = (id, { name, maxSize }) =>
  rpc("ff_update_settings", { p_group_id: id, p_name: name ?? null, p_max_size: maxSize ?? null, p_join_mode: null });
export const ffAddItem        = (id, item) => rpc("ff_add_item", { p_group_id: id, p_item: item });
export const ffRemoveItem     = (itemId) => rpc("ff_remove_item", { p_item_id: itemId });

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
  const tiers = { 2: [0.050, 4.0], 3: [0.040, 3.5], 4: [0.035, 3.0], 5: [0.030, 3.0], 6: [0.030, 2.5], 7: [0.025, 2.5] };
  const [pct, min] = tiers[Math.min(Math.max(Number(size) || 1, 1), 7)] || [0.08, 5.0];
  return Math.max(Math.round(t * pct * 100) / 100, min);
}

// Volledige groep ophalen: groep + leden + gedeelde mand (RLS staat lezen toe voor leden).
export async function ffFetchGroup(groupId) {
  const [g, members, items] = await Promise.all([
    supabase.from("flowva_groups").select("*").eq("id", groupId).single(),
    supabase.from("flowva_group_members").select("*").eq("group_id", groupId).order("joined_at"),
    supabase.from("flowva_group_items").select("*").eq("group_id", groupId).order("created_at"),
  ]);
  return {
    group: g.data || null,
    members: members.data || [],
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
