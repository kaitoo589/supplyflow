// Flowva — lichte i18n-motor (geen library). Context + hooks + woordenboek.
// De KLANT kiest z'n taal in de intro-tour; de keuze staat in localStorage en geldt
// app-breed. Product-namen/beschrijvingen blijven Engels (komen zo van de fabriek);
// alleen de app-teksten worden vertaald. Admin/agent-panel blijft Engels.
//
// PATROON: de Engelse tekst blijft INLINE in de code (bron van waarheid) en wordt via
//   tr("sleutel", "Engelse tekst")  door de vertaling overlaid zodra er een taal ≠ en
// gekozen is. Zo kan de Engelse copy vrij aangepast worden zonder dat i18n "verdrift":
// een ontbrekende vertaling valt gewoon terug op de inline-Engelse tekst.
import { useReducer, useEffect } from "react";
import CORE from "./translations-core.js";   // auto-gegenereerde kernscherm-vertalingen (fase 2)

// De 8 gecureerde EU-talen (dekt ~90% van de markt). Native labels + herkenbare vlag.
export const LANGS = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "nl", label: "Nederlands", flag: "🇳🇱" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "pl", label: "Polski", flag: "🇵🇱" },
  { code: "pt", label: "Português", flag: "🇵🇹" },
];
const CODES = LANGS.map((l) => l.code);
const LS_KEY = "flowva_lang";

export function getStoredLang() {
  try { const v = localStorage.getItem(LS_KEY); return v && CODES.includes(v) ? v : null; } catch { return null; }
}
export function hasChosenLang() { return !!getStoredLang(); }

// Vertalingen per taal (GEEN 'en' — Engels is de inline-fallback via tr()). Ontbreekt een
// sleutel in een taal → valt terug op de meegegeven Engelse tekst. Dit blok = de tour;
// de kernscherm-vertalingen komen uit translations-core.js en worden hieronder samengevoegd.
const TOUR = {
  nl: {
    "tour.greeting": "Hé, laten we Flowva samen ontdekken!",
    "tour.factory.title": "Fabrieksprijs",
    "tour.factory.sub": "wat het in China kost",
    "tour.factory.say": "Je shopt tegen de echte fabrieksprijs — geen opslag.",
    "tour.buy.title": "Wij kopen het voor je",
    "tour.buy.sub": "geen fee bij bestellen",
    "tour.buy.say": "Ik regel het hele inkoopproces voor je.",
    "tour.warehouse.title": "Opgeslagen in ons magazijn",
    "tour.warehouse.sub": "30 dagen gratis — blijf toevoegen",
    "tour.warehouse.say": "Je items liggen veilig in ons magazijn — 30 dagen gratis.",
    "tour.photos.title": "Eerst echte foto's",
    "tour.photos.sub": "zie je échte item",
    "tour.photos.say": "Voordat er iets verzonden wordt, krijg je foto's en maten van je échte item.",
    "tour.parcel.title": "Eén pakket — belasting betaald",
    "tour.parcel.sub": "bundelen = goedkoper per stuk",
    "tour.parcel.say": "Alles gaat samen in één pakket — belasting en invoerrechten zitten erin.",
    "tour.value.title": "Geen tussenpersoon",
    "tour.value.sub": "Geen winkelopslag.",
    "tour.value.say": "Kleding voor prijzen die je nergens anders vindt.",
    "tour.golden": "Gouden regel: bundel alles in één doos — goedkoper per stuk, op zowel de fee als de verzending. 🪙",
    "tour.friendsTitle": "Goedkoper met Flowva Friends",
    "tour.friendsBody": "Deel één pakket, splits de verzendkosten, en bespaar meer met elke vriend die je uitnodigt.",
    "tour.recommended": "Tot 50% goedkoper",
    "tour.cta": "Begin met shoppen",
    "tour.tap": "tik om verder te gaan",
  },
  de: {
    "tour.greeting": "Hey, lass uns Flowva zusammen entdecken!",
    "tour.factory.title": "Fabrikpreis",
    "tour.factory.sub": "was es in China kostet",
    "tour.factory.say": "Du kaufst zum echten Fabrikpreis — ohne Aufschlag.",
    "tour.buy.title": "Wir kaufen es für dich",
    "tour.buy.sub": "keine Gebühr bei der Bestellung",
    "tour.buy.say": "Ich übernehme den gesamten Einkauf für dich.",
    "tour.warehouse.title": "In unserem Lager gelagert",
    "tour.warehouse.sub": "30 Tage gratis — weiter sammeln",
    "tour.warehouse.say": "Deine Artikel liegen sicher in unserem Lager — 30 Tage gratis.",
    "tour.photos.title": "Zuerst echte Fotos",
    "tour.photos.sub": "sieh deinen echten Artikel",
    "tour.photos.say": "Bevor etwas verschickt wird, bekommst du Fotos und Maße deines echten Artikels.",
    "tour.parcel.title": "Ein Paket — Steuern bezahlt",
    "tour.parcel.sub": "bündeln = günstiger pro Stück",
    "tour.parcel.say": "Alles kommt zusammen in einem Paket — Steuern und Einfuhrgebühren sind inklusive.",
    "tour.value.title": "Ohne Zwischenhändler",
    "tour.value.sub": "Keine Handelsaufschläge.",
    "tour.value.say": "Kleidung zu Preisen, die du sonst nirgends findest.",
    "tour.golden": "Goldene Regel: Bündle alles in eine Box — günstiger pro Stück, bei Gebühr und Versand. 🪙",
    "tour.friendsTitle": "Günstiger mit Flowva Friends",
    "tour.friendsBody": "Teilt euch ein Paket, teilt die Versandkosten, und spart mehr mit jedem Freund, den du einlädst.",
    "tour.recommended": "Bis zu 50% günstiger",
    "tour.cta": "Jetzt shoppen",
    "tour.tap": "tippen zum Fortfahren",
  },
  fr: {
    "tour.greeting": "Hé, découvrons Flowva ensemble !",
    "tour.factory.title": "Prix d'usine",
    "tour.factory.sub": "ce que ça coûte en Chine",
    "tour.factory.say": "Tu achètes au vrai prix d'usine — sans marge.",
    "tour.buy.title": "On l'achète pour toi",
    "tour.buy.sub": "aucun frais à la commande",
    "tour.buy.say": "Je m'occupe de tout l'achat pour toi.",
    "tour.warehouse.title": "Stocké dans notre entrepôt",
    "tour.warehouse.sub": "30 jours gratuits — continue d'ajouter",
    "tour.warehouse.say": "Tes articles restent en sécurité dans notre entrepôt — 30 jours gratuits.",
    "tour.photos.title": "De vraies photos d'abord",
    "tour.photos.sub": "vois ton article réel",
    "tour.photos.say": "Avant tout envoi, tu reçois des photos et les mesures de ton article réel.",
    "tour.parcel.title": "Un colis — taxes payées",
    "tour.parcel.sub": "grouper = moins cher par article",
    "tour.parcel.say": "Tout part ensemble en un colis — taxes et frais d'importation inclus.",
    "tour.value.title": "Sans intermédiaire",
    "tour.value.sub": "Aucune marge de détail.",
    "tour.value.say": "Des vêtements à des prix introuvables ailleurs.",
    "tour.golden": "Règle d'or : regroupe tout dans un colis — moins cher par article, sur les frais comme sur le transport. 🪙",
    "tour.friendsTitle": "Moins cher avec Flowva Friends",
    "tour.friendsBody": "Partagez un colis, divisez les frais de transport, et économisez plus à chaque ami invité.",
    "tour.recommended": "Jusqu'à 50% moins cher",
    "tour.cta": "Commencer mes achats",
    "tour.tap": "touchez pour continuer",
  },
  es: {
    "tour.greeting": "¡Hey, exploremos Flowva juntos!",
    "tour.factory.title": "Precio de fábrica",
    "tour.factory.sub": "lo que cuesta en China",
    "tour.factory.say": "Compras al precio real de fábrica — sin recargo.",
    "tour.buy.title": "Lo compramos por ti",
    "tour.buy.sub": "sin comisión al pedir",
    "tour.buy.say": "Yo me encargo de toda la compra por ti.",
    "tour.warehouse.title": "Guardado en nuestro almacén",
    "tour.warehouse.sub": "30 días gratis — sigue añadiendo",
    "tour.warehouse.say": "Tus artículos se guardan a salvo en nuestro almacén — 30 días gratis.",
    "tour.photos.title": "Primero fotos reales",
    "tour.photos.sub": "ve tu artículo real",
    "tour.photos.say": "Antes de enviar nada, recibes fotos y medidas de tu artículo real.",
    "tour.parcel.title": "Un paquete — impuestos pagados",
    "tour.parcel.sub": "agrupar = más barato por artículo",
    "tour.parcel.say": "Todo se envía junto en un paquete — impuestos y aranceles incluidos.",
    "tour.value.title": "Sin intermediarios",
    "tour.value.sub": "Sin recargos de tienda.",
    "tour.value.say": "Ropa a precios que no encontrarás en otro sitio.",
    "tour.golden": "Regla de oro: júntalo todo en una caja — más barato por artículo, tanto en la comisión como en el envío. 🪙",
    "tour.friendsTitle": "Más barato con Flowva Friends",
    "tour.friendsBody": "Comparte un paquete, divide los gastos de envío, y ahorra más con cada amigo que invites.",
    "tour.recommended": "Hasta un 50% más barato",
    "tour.cta": "Empezar a comprar",
    "tour.tap": "toca para continuar",
  },
  it: {
    "tour.greeting": "Ehi, esploriamo Flowva insieme!",
    "tour.factory.title": "Prezzo di fabbrica",
    "tour.factory.sub": "quanto costa in Cina",
    "tour.factory.say": "Compri al vero prezzo di fabbrica — senza ricarico.",
    "tour.buy.title": "Lo compriamo per te",
    "tour.buy.sub": "nessuna commissione all'ordine",
    "tour.buy.say": "Mi occupo io di tutto l'acquisto per te.",
    "tour.warehouse.title": "Conservato nel nostro magazzino",
    "tour.warehouse.sub": "30 giorni gratis — continua ad aggiungere",
    "tour.warehouse.say": "I tuoi articoli restano al sicuro nel nostro magazzino — 30 giorni gratis.",
    "tour.photos.title": "Prima foto reali",
    "tour.photos.sub": "vedi il tuo articolo vero",
    "tour.photos.say": "Prima di spedire, ricevi foto e misure del tuo articolo reale.",
    "tour.parcel.title": "Un pacco — tasse pagate",
    "tour.parcel.sub": "raggruppare = più economico a pezzo",
    "tour.parcel.say": "Tutto parte insieme in un pacco — tasse e dazi d'importazione inclusi.",
    "tour.value.title": "Nessun intermediario",
    "tour.value.sub": "Nessun ricarico al dettaglio.",
    "tour.value.say": "Vestiti a prezzi che non trovi altrove.",
    "tour.golden": "Regola d'oro: raggruppa tutto in una scatola — più economico a pezzo, sia sulla commissione che sulla spedizione. 🪙",
    "tour.friendsTitle": "Più conveniente con Flowva Friends",
    "tour.friendsBody": "Condividete un pacco, dividete le spese di spedizione, e risparmiate di più con ogni amico che inviti.",
    "tour.recommended": "Fino al 50% in meno",
    "tour.cta": "Inizia a comprare",
    "tour.tap": "tocca per continuare",
  },
  pl: {
    "tour.greeting": "Hej, odkryjmy Flowva razem!",
    "tour.factory.title": "Cena fabryczna",
    "tour.factory.sub": "ile kosztuje w Chinach",
    "tour.factory.say": "Kupujesz w prawdziwej cenie fabrycznej — bez narzutu.",
    "tour.buy.title": "Kupujemy to za Ciebie",
    "tour.buy.sub": "bez opłaty przy zamówieniu",
    "tour.buy.say": "Zajmuję się całym procesem zakupu za Ciebie.",
    "tour.warehouse.title": "Przechowywane w naszym magazynie",
    "tour.warehouse.sub": "30 dni gratis — dodawaj dalej",
    "tour.warehouse.say": "Twoje rzeczy są bezpiecznie przechowywane w naszym magazynie — 30 dni za darmo.",
    "tour.photos.title": "Najpierw prawdziwe zdjęcia",
    "tour.photos.sub": "zobacz swój prawdziwy produkt",
    "tour.photos.say": "Zanim cokolwiek wyślemy, dostajesz zdjęcia i wymiary swojego prawdziwego produktu.",
    "tour.parcel.title": "Jedna paczka — podatki opłacone",
    "tour.parcel.sub": "łączenie = taniej za sztukę",
    "tour.parcel.say": "Wszystko wysyłane razem w jednej paczce — podatki i cło w cenie.",
    "tour.value.title": "Bez pośredników",
    "tour.value.sub": "Bez marż sklepowych.",
    "tour.value.say": "Ubrania w cenach, których nie znajdziesz gdzie indziej.",
    "tour.golden": "Złota zasada: spakuj wszystko do jednego pudełka — taniej za sztukę, i na opłacie, i na wysyłce. 🪙",
    "tour.friendsTitle": "Taniej z Flowva Friends",
    "tour.friendsBody": "Dzielcie jedną paczkę, dzielcie koszty wysyłki i oszczędzajcie więcej z każdym zaproszonym znajomym.",
    "tour.recommended": "Nawet 50% taniej",
    "tour.cta": "Zacznij zakupy",
    "tour.tap": "dotknij, aby kontynuować",
  },
  pt: {
    "tour.greeting": "Olá, vamos explorar a Flowva juntos!",
    "tour.factory.title": "Preço de fábrica",
    "tour.factory.sub": "o que custa na China",
    "tour.factory.say": "Compras ao preço real de fábrica — sem margem.",
    "tour.buy.title": "Compramos por ti",
    "tour.buy.sub": "sem taxa ao encomendar",
    "tour.buy.say": "Eu trato de toda a compra por ti.",
    "tour.warehouse.title": "Guardado no nosso armazém",
    "tour.warehouse.sub": "30 dias grátis — continua a juntar",
    "tour.warehouse.say": "Os teus artigos ficam guardados em segurança no nosso armazém — 30 dias grátis.",
    "tour.photos.title": "Primeiro fotos reais",
    "tour.photos.sub": "vê o teu artigo real",
    "tour.photos.say": "Antes de enviar seja o que for, recebes fotos e medidas do teu artigo real.",
    "tour.parcel.title": "Uma encomenda — impostos pagos",
    "tour.parcel.sub": "juntar = mais barato por artigo",
    "tour.parcel.say": "Vai tudo junto numa encomenda — impostos e taxas de importação incluídos.",
    "tour.value.title": "Sem intermediários",
    "tour.value.sub": "Sem margens de loja.",
    "tour.value.say": "Roupa a preços que não encontras noutro lado.",
    "tour.golden": "Regra de ouro: junta tudo numa caixa — mais barato por artigo, tanto na taxa como no envio. 🪙",
    "tour.friendsTitle": "Mais barato com Flowva Friends",
    "tour.friendsBody": "Partilhem uma encomenda, dividam os custos de envio, e poupem mais com cada amigo que convidas.",
    "tour.recommended": "Até 50% mais barato",
    "tour.cta": "Começar a comprar",
    "tour.tap": "toca para continuar",
  },
};

// Tour-vertalingen + auto-gegenereerde kernscherm-vertalingen samenvoegen per taal.
const T = {};
for (const c of CODES) if (c !== "en") T[c] = { ...(TOUR[c] || {}), ...(CORE[c] || {}) };

// ——— Module-level taalstatus + tr() ————————————————————————————————————————
// Zo hoeft niet elke component een hook te threaden: overal `import { tr } from "./i18n"`
// en `tr("key","English")`. De taal wordt één keer in de intro gekozen (daarna vast voor de
// sessie); componenten die mid-sessie moeten meeveranderen (de tour) gebruiken useLangVersion().
let _lang = getStoredLang() || "en";
const _subs = new Set();
function notify() { _subs.forEach((f) => f()); }

export function currentLang() { return _lang; }

export function setLang(code) {
  if (!CODES.includes(code) || code === _lang) return;
  _lang = code;
  try { localStorage.setItem(LS_KEY, code); } catch { /* private mode */ }
  notify();
}

// tr(sleutel, engelseTekst[, vars]) — Engels blijft de inline-bron; vertaling overlaid.
// vars vervangt {naam}-placeholders (bv. tr("cart.title","{n} items",{n:3})).
export function tr(key, fallback, vars) {
  let s = _lang === "en" ? fallback : (T[_lang] && T[_lang][key]) ?? fallback;
  if (vars) for (const k of Object.keys(vars)) s = String(s).split(`{${k}}`).join(String(vars[k]));
  return s;
}
export function t(key, vars) { return tr(key, key, vars); }

// Re-render op taalwissel (voor componenten die mid-sessie moeten meeveranderen, bv. de tour).
export function useLangVersion() {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => { _subs.add(force); return () => { _subs.delete(force); }; }, []);
}

// Hooks (reactief) — de intro-tour gebruikt deze; overige schermen kunnen gewoon tr() importeren.
export function useTr() { useLangVersion(); return tr; }
export function useLang() { useLangVersion(); return { lang: _lang, setLang, tr }; }
export function useT() { useLangVersion(); return t; }

// LangProvider is nu een simpele passthrough (taalstatus is module-level, geen context nodig).
export function LangProvider({ children }) { return children; }
