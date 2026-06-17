// Gedeelde categorie-data voor feed én admin.
// Bewust klein gehouden (besluit 2026-06-12): hoofdcategorieën Clothes + Tech,
// subs onder Clothes = kledingtype (één dimensie). Stijlen (Y2K, streetwear)
// worden later tags op een product; man/vrouw wordt later een filterknop.
// Lege categorieën worden in de feed automatisch verborgen, dus een categorie
// toevoegen = hier één regel bijzetten zodra je 'm echt gaat gebruiken.

export const topCategories = ["All", "Clothes", "Tech"];

// Categorieën die de admin per product kan kiezen.
export const adminCategories = ["Clothes", "Tech"];

// Subcategorieën onder "Clothes" — één dimensie: het kledingtype.
export const clothesSubcategories = [
  "T-Shirts",
  "Hoodies & Sweaters",
  "Jackets & Coats",
  "Pants & Jeans",
  "Shorts",
  "Dresses & Skirts",
  "Activewear",
];

// Compat met de oude gegroepeerde vorm (feed-picker en oude admin lezen dit).
export const clothesCategories = [{ group: "Type", items: clothesSubcategories }];
