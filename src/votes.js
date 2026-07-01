import { supabase } from "./supabase";

// Gast-stemtoken: 1 per browser (zachte dedupe, GEEN harde apparaat-lock — een gast mag
// stemmen, we voorkomen alleen per ongeluk dubbel tikken). Ingelogd = 1 stem per account.
export function guestVoteToken() {
  try {
    let t = localStorage.getItem("flowva_vote_token");
    if (!t) {
      t = globalThis.crypto?.randomUUID?.() || `g-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("flowva_vote_token", t);
    }
    return t;
  } catch {
    return `g-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

// Stem uitbrengen/wijzigen op een demo-product. reaction ∈ no | nice | yes | notify.
export async function castVote(productId, reaction, hasSession) {
  const token = hasSession ? null : guestVoteToken();
  return supabase.rpc("cast_vote", { p_product_id: productId, p_reaction: reaction, p_guest_token: token });
}

// Geaggregeerde tellingen per product (id -> {total,yes,nice,no,notify,accounts,guests}).
export async function getVoteStats(ids) {
  const list = (ids || []).filter((x) => x != null);
  if (!list.length) return {};
  const { data } = await supabase.rpc("get_vote_stats", { p_product_ids: list });
  const map = {};
  (data || []).forEach((r) => { map[r.product_id] = r; });
  return map;
}

// Mijn eigen stem per product (voor de gekozen-staat in de UI).
export async function getMyVotes(ids, hasSession) {
  const list = (ids || []).filter((x) => x != null);
  if (!list.length) return {};
  const token = hasSession ? null : guestVoteToken();
  const { data } = await supabase.rpc("get_my_votes", { p_product_ids: list, p_guest_token: token });
  const map = {};
  (data || []).forEach((r) => { map[r.product_id] = r.reaction; });
  return map;
}
