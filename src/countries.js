// EU-27 — de landen waar Flowva naartoe verkoopt/verzendt.
// De waarde = de Engelse landnaam, die exact matcht met de countryCodeFor-map in de
// edge functions (supabase/functions/haul-shipping + place-bucky-order), zodat de
// dropdown-keuze 1-op-1 aansluit op de verzendlogica. Nederland staat eerst (default).
// VK, Zwitserland en Noorwegen staan er bewust NIET in: niet-EU, eigen VAT/douane
// (geen IOSS / niet de €3-EU-regeling) — aparte afhandeling, later toe te voegen.
export const EU_COUNTRIES = [
  "Netherlands", "Belgium", "Germany", "France", "Luxembourg", "Ireland",
  "Austria", "Bulgaria", "Croatia", "Cyprus", "Czech Republic", "Denmark",
  "Estonia", "Finland", "Greece", "Hungary", "Italy", "Latvia", "Lithuania",
  "Malta", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Sweden",
];
