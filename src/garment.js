// Leidt het kledingtype (≈ één 6-cijferige HS-douanecategorie) af uit de producttitel.
// Gratis keyword-classificatie, GEEN AI. Elk type ≈ één HS6 → de eenheid waarop de nieuwe
// EU-douaneheffing van €3 wordt geteld (per 1 juli 2026: €3 per distinct HS6 in een pakket).
// Wordt ALLEEN gebruikt voor visualisatie/transparantie: de €3 zit al in de DDP-verzendprijs
// die BuckyDrop berekent — we tellen 'm niet bovenop. Volgorde telt: specifiek vóór generiek
// (t-shirt vóór shirt, hoodie/sweatshirt vóór shirt en vóór top).
export const GARMENT_RULES = [
  [/(t-?shirt|\btee\b|tank ?top|singlet)/i, "T-shirt"],
  [/(hoodie|sweatshirt|sweater|jumper|pullover|cardigan|\bknit|gilet)/i, "Sweater / hoodie"],
  [/(polo|button[- ]?up|dress shirt|overhemd|blouse|\bshirt)/i, "Shirt / blouse"],
  [/(jeans|denim|trouser|\bpants\b|chino|cargo|legging|jogger|sweatpant)/i, "Trousers / jeans"],
  [/(shorts|bermuda)/i, "Shorts"],
  [/(dress|gown|jumpsuit|romper|playsuit)/i, "Dress"],
  [/(skirt|skort)/i, "Skirt"],
  [/(jacket|\bcoat\b|blazer|parka|windbreaker|puffer|trench|bomber)/i, "Jacket / coat"],
  [/(lingerie|underwear|panties|\bpanty\b|\bbra\b|boxer|briefs?|thong)/i, "Underwear"],
  [/(\bsocks?\b)/i, "Socks"],
  [/(\bhat\b|\bcap\b|beanie|scarf|glove|\bbelt\b|handbag|\bbag\b|tote|wallet)/i, "Accessory"],
  [/(camisole|\bcami\b|crop|\btop\b|vest)/i, "Top"],
];

export function garmentType(title) {
  const t = (title || "").toLowerCase();
  for (const [re, name] of GARMENT_RULES) if (re.test(t)) return name;
  return "Other clothing";
}

// Aantal verschillende douane-categorieën (HS6-benadering) in een set titels.
export function customsCategoryCount(titles) {
  return new Set((titles || []).map(garmentType)).size;
}
