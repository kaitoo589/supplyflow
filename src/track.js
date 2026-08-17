// Bezoek-trechter (2026-08-16) — meet waar bezoekers afhaken.
// Bewust minimaal: één willekeurige sleutel per browsersessie (geen cookie, geen
// persoonsgegevens, verdwijnt als het tabblad sluit), en verder alleen "ik ben er",
// "product geopend" en "in mandje gelegd". Alles gaat via één database-functie;
// mislukt die, dan merkt de klant er niets van — meten mag nooit de app breken.
import { supabase } from "./supabase";

const KEY = "flowva_visit_key";
const VISITOR_KEY = "flowva_visitor";   // blijvend anoniem nummer → nieuw vs. terugkerend

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

// Bezoekersnummer (fase 2, 2026-08-19): blijft op het toestel staan zodat we nieuw
// van terugkerend kunnen onderscheiden. Willekeurig nummer, zegt niets over wie je
// bent; staat zo beschreven in de privacyverklaring (2.8).
function visitorKey() {
  try {
    let k = localStorage.getItem(VISITOR_KEY);
    if (!k) {
      k = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now());
      localStorage.setItem(VISITOR_KEY, k);
    }
    return k;
  } catch { return null; }
}

let lastPing = 0;

// action: "visit" (ook hartslag) | "product" | "cart" | "checkout" | "topup" |
// "topup_done" | "paid" — mijlpalen per bezoek, volgorde maakt niet uit.
export function track(action, productId = null, lang = null) {
  const key = sessionKey();
  if (!key) return;
  // Hartslag hooguit elke 25s, anders zouden we onnodig verkeer maken.
  if (action === "visit") {
    const now = Date.now();
    if (lastPing && now - lastPing < 25000) return;
    lastPing = now;
  }
  // Taal bij ELKE ping meelezen (2026-08-18): een nieuwe bezoeker heeft bij de eerste
  // ping nog geen taal gekozen — door 'm hier steeds mee te sturen vult de database
  // 'm alsnog in zodra er gekozen is. "?" betekent dan écht "vertrok vóór de taalkeuze".
  let taal = lang;
  if (!taal) { try { taal = localStorage.getItem("flowva_lang"); } catch { /* privémodus */ } }
  supabase.rpc("track_visit", {
    p_key: key,
    p_action: action,
    p_product_id: productId != null ? Number(productId) : null,
    p_lang: taal || null,
    p_visitor: visitorKey(),
  }).then(() => {}, () => {});   // stil falen: nooit de app ophouden
}
