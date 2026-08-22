// Opwaarderen — één gedeelde plek voor alle betaalschermen.
//
// De klant heeft twee routes naar een hoger saldo:
//   1. vrij bedrag op het profiel ("+ Add €25 via iDEAL")
//   2. EXACT het tekort, midden in een betaling — mand, Friends-mand of
//      internationale verzending. Dat is deze module.
//
// Waarom gedeeld: die drie schermen rekenden allemaal hun eigen "je komt €X
// tekort" uit maar boden geen uitweg; nu gebruiken ze dezelfde rekenregel én
// dezelfde redirect, zodat het bedrag overal op dezelfde manier klopt.
import { invokeAsUser, functionErrorMessage } from "./supabase";

// create-checkout (edge function) weigert alles onder €10 — harde ondergrens (22-08: 5→10).
export const TOPUP_MIN = 10;

// Precies het tekort, naar boven afgerond op hele centen (nooit één cent te
// weinig), maar minstens het Stripe-minimum.
//
// Let op de volgorde: eerst de float-ruis wegpoetsen, DAARNA omhoog afronden.
// 20.12 - 10.00 geeft in JS 10.120000000000001; direct Math.ceil() op de centen
// maakte daar €10,13 van — een hele cent te veel voor een tekort dat gewoon
// €10,12 is. Daarom eerst op centen ronden (op 4 decimalen nauwkeurig), dan ceil.
export function exactTopUp(shortfall) {
  const s = Math.max(0, Number(shortfall) || 0);
  const cents = Math.ceil(Math.round(s * 1e6) / 1e4);
  return Math.max(TOPUP_MIN, cents / 100);
}

// Stripe stuurt na het betalen altijd naar /payment-success. Deze marker vertelt
// die pagina waar "terug naar Flowva" heen moet, zodat de klant weer uitkomt op
// het scherm waar hij zat i.p.v. op de feed. localStorage (niet session) zodat
// het ook een nieuw tabblad/PWA-venster overleeft; ouder dan een uur = vergeten.
const RETURN_KEY = "flowva_topup_return";
const RETURN_TTL = 60 * 60 * 1000;

export function rememberReturn(to) {
  try { localStorage.setItem(RETURN_KEY, JSON.stringify({ to, at: Date.now() })); } catch { /* ignore */ }
}

// Leest de marker en wist 'm meteen (eenmalig gebruik).
export function takeReturn() {
  try {
    const raw = localStorage.getItem(RETURN_KEY);
    localStorage.removeItem(RETURN_KEY);
    if (!raw) return null;
    const { to, at } = JSON.parse(raw);
    return to && Date.now() - at < RETURN_TTL ? to : null;
  } catch { return null; }
}

// Opent Stripe-checkout voor een vast bedrag en stuurt de klant erheen.
// Gooit bij een fout — de aanroeper toont de melding zelf, zodat elk scherm
// z'n eigen foutstijl houdt.
export async function startTopUp(amountEur, returnTo) {
  const cents = Math.round((Number(amountEur) || 0) * 100);
  if (cents < TOPUP_MIN * 100) throw new Error(`Minimum top-up is €${TOPUP_MIN}`);
  if (returnTo) rememberReturn(returnTo);
  // Alleen het bedrag: create-checkout haalt de gebruiker uit de sessie-JWT en
  // negeert bewust alles wat de client over identiteit meestuurt (audit #11).
  // invokeAsUser ververst een (bijna) verlopen sessie eerst — anders krijg je
  // "Not authenticated" terwijl de app nog gewoon je saldo laat zien.
  const { data, error } = await invokeAsUser("create-checkout", { amount: cents });
  if (error) throw new Error(await functionErrorMessage(error));
  if (!data?.url) throw new Error(data?.error || "Could not start the payment");
  window.location.href = data.url;
}
