// Bezoek-trechter (2026-08-16) — meet waar bezoekers afhaken.
// Bewust minimaal: één willekeurige sleutel per browsersessie (geen cookie, geen
// persoonsgegevens, verdwijnt als het tabblad sluit), en verder alleen "ik ben er",
// "product geopend" en "in mandje gelegd". Alles gaat via één database-functie;
// mislukt die, dan merkt de klant er niets van — meten mag nooit de app breken.
import { supabase } from "./supabase";

const KEY = "flowva_visit_key";

function sessionKey() {
  try {
    let k = sessionStorage.getItem(KEY);
    if (!k) {
      k = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now());
      sessionStorage.setItem(KEY, k);
    }
    return k;
  } catch { return null; }   // privémodus e.d. → gewoon niet meten
}

let lastPing = 0;

// action: "visit" (ook als hartslag) | "product" | "cart"
export function track(action, productId = null, lang = null) {
  const key = sessionKey();
  if (!key) return;
  // Hartslag hooguit elke 25s, anders zouden we onnodig verkeer maken.
  if (action === "visit") {
    const now = Date.now();
    if (lastPing && now - lastPing < 25000) return;
    lastPing = now;
  }
  supabase.rpc("track_visit", {
    p_key: key,
    p_action: action,
    p_product_id: productId != null ? Number(productId) : null,
    p_lang: lang || null,
  }).then(() => {}, () => {});   // stil falen: nooit de app ophouden
}
