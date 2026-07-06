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

// Lokale/oude spellingen → de Engelse EU-naam. Oudere accounts hebben soms de Nederlandse
// landnaam opgeslagen ("Nederland"); BuckyDrop's vrachtberekening (channel-carriage-list)
// kent ALLEEN de Engelse naam en geeft anders 0 routes terug → daarom normaliseren we het
// land bij het bewerken van het adres (de edge functions mappen 't nog eens server-side).
export const COUNTRY_ALIASES = {
  nederland: "Netherlands", holland: "Netherlands",
  "belgië": "Belgium", belgie: "Belgium",
  duitsland: "Germany", deutschland: "Germany",
  frankrijk: "France", luxemburg: "Luxembourg", ierland: "Ireland",
  oostenrijk: "Austria", bulgarije: "Bulgaria",
  "kroatië": "Croatia", kroatie: "Croatia",
  "tsjechië": "Czech Republic", tsjechie: "Czech Republic",
  denemarken: "Denmark", estland: "Estonia",
  griekenland: "Greece", hongarije: "Hungary",
  "italië": "Italy", italie: "Italy",
  letland: "Latvia", litouwen: "Lithuania",
  polen: "Poland", "roemenië": "Romania", roemenie: "Romania",
  slowakije: "Slovakia", "slovenië": "Slovenia", slovenie: "Slovenia",
  spanje: "Spain", zweden: "Sweden",
};

// Geef de Engelse EU-naam terug; laat onbekende (niet-EU) waarden ongemoeid.
export function normalizeCountry(name) {
  if (!name) return "";
  if (EU_COUNTRIES.includes(name)) return name;
  return COUNTRY_ALIASES[String(name).trim().toLowerCase()] || name;
}

// Provincies/regio's per EU-land (top-niveau ISO 3166-2), voor de provincie-dropdown in het
// adresformulier. BuckyDrop heeft een ECHTE provincie/regio nodig voor een exact vrachttarief
// (een stad als provincie is onnauwkeurig → onnauwkeurige of ontbrekende routes). Namen: gangbare
// Engelse exoniemen, NL in NL-spelling (BuckyDrop accepteert "Zuid-Holland" e.d., geverifieerd).
// Een land zonder lijst hier → het formulier toont een vrij tekstveld.
export const EU_PROVINCES = {
  "Netherlands": ["Drenthe", "Flevoland", "Friesland", "Gelderland", "Groningen", "Limburg", "Noord-Brabant", "Noord-Holland", "Overijssel", "Utrecht", "Zeeland", "Zuid-Holland"],
  "Belgium": ["Antwerp", "Brussels", "East Flanders", "Flemish Brabant", "Hainaut", "Liège", "Limburg", "Luxembourg", "Namur", "Walloon Brabant", "West Flanders"],
  "Germany": ["Baden-Württemberg", "Bavaria", "Berlin", "Brandenburg", "Bremen", "Hamburg", "Hesse", "Lower Saxony", "Mecklenburg-Vorpommern", "North Rhine-Westphalia", "Rhineland-Palatinate", "Saarland", "Saxony", "Saxony-Anhalt", "Schleswig-Holstein", "Thuringia"],
  "France": ["Auvergne-Rhône-Alpes", "Bourgogne-Franche-Comté", "Brittany", "Centre-Val de Loire", "Corsica", "Grand Est", "Hauts-de-France", "Île-de-France", "Normandy", "Nouvelle-Aquitaine", "Occitanie", "Pays de la Loire", "Provence-Alpes-Côte d'Azur"],
  "Luxembourg": ["Capellen", "Clervaux", "Diekirch", "Echternach", "Esch-sur-Alzette", "Grevenmacher", "Luxembourg", "Mersch", "Redange", "Remich", "Vianden", "Wiltz"],
  "Ireland": ["Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin", "Galway", "Kerry", "Kildare", "Kilkenny", "Laois", "Leitrim", "Limerick", "Longford", "Louth", "Mayo", "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary", "Waterford", "Westmeath", "Wexford", "Wicklow"],
  "Austria": ["Burgenland", "Carinthia", "Lower Austria", "Salzburg", "Styria", "Tyrol", "Upper Austria", "Vienna", "Vorarlberg"],
  "Bulgaria": ["Blagoevgrad", "Burgas", "Dobrich", "Gabrovo", "Haskovo", "Kardzhali", "Kyustendil", "Lovech", "Montana", "Pazardzhik", "Pernik", "Pleven", "Plovdiv", "Razgrad", "Ruse", "Shumen", "Silistra", "Sliven", "Smolyan", "Sofia", "Sofia City", "Stara Zagora", "Targovishte", "Varna", "Veliko Tarnovo", "Vidin", "Vratsa", "Yambol"],
  "Croatia": ["Bjelovar-Bilogora", "Brod-Posavina", "City of Zagreb", "Dubrovnik-Neretva", "Istria", "Karlovac", "Koprivnica-Križevci", "Krapina-Zagorje", "Lika-Senj", "Međimurje", "Osijek-Baranja", "Požega-Slavonia", "Primorje-Gorski Kotar", "Sisak-Moslavina", "Split-Dalmatia", "Šibenik-Knin", "Varaždin", "Virovitica-Podravina", "Vukovar-Syrmia", "Zadar", "Zagreb County"],
  "Cyprus": ["Famagusta", "Kyrenia", "Larnaca", "Limassol", "Nicosia", "Paphos"],
  "Czech Republic": ["Central Bohemian", "Hradec Králové", "Karlovy Vary", "Liberec", "Moravian-Silesian", "Olomouc", "Pardubice", "Plzeň", "Prague", "South Bohemian", "South Moravian", "Ústí nad Labem", "Vysočina", "Zlín"],
  "Denmark": ["Capital Region", "Central Denmark", "North Denmark", "Southern Denmark", "Zealand"],
  "Estonia": ["Harju", "Hiiu", "Ida-Viru", "Järva", "Jõgeva", "Lääne", "Lääne-Viru", "Pärnu", "Põlva", "Rapla", "Saare", "Tartu", "Valga", "Viljandi", "Võru"],
  "Finland": ["Central Finland", "Central Ostrobothnia", "Kainuu", "Kanta-Häme", "Kymenlaakso", "Lapland", "North Karelia", "North Ostrobothnia", "North Savo", "Ostrobothnia", "Pirkanmaa", "Päijänne Tavastia", "Satakunta", "South Karelia", "South Ostrobothnia", "South Savo", "Southwest Finland", "Uusimaa", "Åland"],
  "Greece": ["Attica", "Central Greece", "Central Macedonia", "Crete", "Eastern Macedonia and Thrace", "Epirus", "Ionian Islands", "North Aegean", "Peloponnese", "South Aegean", "Thessaly", "Western Greece", "Western Macedonia"],
  "Hungary": ["Bács-Kiskun", "Baranya", "Budapest", "Békés", "Borsod-Abaúj-Zemplén", "Csongrád-Csanád", "Fejér", "Győr-Moson-Sopron", "Hajdú-Bihar", "Heves", "Jász-Nagykun-Szolnok", "Komárom-Esztergom", "Nógrád", "Pest", "Somogy", "Szabolcs-Szatmár-Bereg", "Tolna", "Vas", "Veszprém", "Zala"],
  "Italy": ["Abruzzo", "Aosta Valley", "Apulia", "Basilicata", "Calabria", "Campania", "Emilia-Romagna", "Friuli-Venezia Giulia", "Lazio", "Liguria", "Lombardy", "Marche", "Molise", "Piedmont", "Sardinia", "Sicily", "Trentino-South Tyrol", "Tuscany", "Umbria", "Veneto"],
  "Latvia": ["Kurzeme", "Latgale", "Riga", "Vidzeme", "Zemgale"],
  "Lithuania": ["Alytus", "Kaunas", "Klaipėda", "Marijampolė", "Panevėžys", "Šiauliai", "Tauragė", "Telšiai", "Utena", "Vilnius"],
  "Malta": ["Gozo and Comino", "Northern", "Northern Harbour", "South Eastern", "Southern Harbour", "Western"],
  "Poland": ["Greater Poland", "Holy Cross", "Kuyavian-Pomeranian", "Lesser Poland", "Lower Silesian", "Lublin", "Lubusz", "Łódź", "Masovian", "Opole", "Podlaskie", "Pomeranian", "Silesian", "Subcarpathian", "Warmian-Masurian", "West Pomeranian"],
  "Portugal": ["Aveiro", "Azores", "Beja", "Braga", "Bragança", "Castelo Branco", "Coimbra", "Évora", "Faro", "Guarda", "Leiria", "Lisbon", "Madeira", "Portalegre", "Porto", "Santarém", "Setúbal", "Viana do Castelo", "Vila Real", "Viseu"],
  "Romania": ["Alba", "Arad", "Argeș", "Bacău", "Bihor", "Bistrița-Năsăud", "Botoșani", "Brăila", "Brașov", "Bucharest", "Buzău", "Caraș-Severin", "Călărași", "Cluj", "Constanța", "Covasna", "Dâmbovița", "Dolj", "Galați", "Giurgiu", "Gorj", "Harghita", "Hunedoara", "Ialomița", "Iași", "Ilfov", "Maramureș", "Mehedinți", "Mureș", "Neamț", "Olt", "Prahova", "Sălaj", "Satu Mare", "Sibiu", "Suceava", "Teleorman", "Timiș", "Tulcea", "Vâlcea", "Vaslui", "Vrancea"],
  "Slovakia": ["Banská Bystrica", "Bratislava", "Košice", "Nitra", "Prešov", "Trenčín", "Trnava", "Žilina"],
  "Slovenia": ["Carinthia", "Central Sava", "Central Slovenia", "Coastal–Karst", "Drava", "Gorizia", "Littoral–Inner Carniola", "Lower Sava", "Mura", "Savinja", "Southeast Slovenia", "Upper Carniola"],
  "Spain": ["Andalusia", "Aragon", "Asturias", "Balearic Islands", "Basque Country", "Canary Islands", "Cantabria", "Castile and León", "Castilla-La Mancha", "Catalonia", "Community of Madrid", "Extremadura", "Galicia", "La Rioja", "Navarre", "Region of Murcia", "Valencian Community"],
  "Sweden": ["Blekinge", "Dalarna", "Gotland", "Gävleborg", "Halland", "Jämtland", "Jönköping", "Kalmar", "Kronoberg", "Norrbotten", "Skåne", "Stockholm", "Södermanland", "Uppsala", "Värmland", "Västerbotten", "Västernorrland", "Västmanland", "Västra Götaland", "Örebro", "Östergötland"],
};

// Postcode-formaat per land (SOEPEL: optionele spaties/prefix, hoofdletter-ongevoelig). Doel:
// overduidelijke onzin/typefouten vangen zonder echte klanten te blokkeren. Landen met een losse
// of complexe/optionele postcode (Ierland, Malta) staan er bewust NIET in → geen formaat-check.
export const POSTCODE_FORMATS = {
  "Netherlands": /^\d{4}\s?[A-Za-z]{2}$/, "Belgium": /^\d{4}$/, "Germany": /^\d{5}$/,
  "France": /^\d{5}$/, "Luxembourg": /^(L-?\s?)?\d{4}$/i, "Austria": /^\d{4}$/,
  "Bulgaria": /^\d{4}$/, "Croatia": /^\d{5}$/, "Cyprus": /^\d{4}$/,
  "Czech Republic": /^\d{3}\s?\d{2}$/, "Denmark": /^\d{4}$/, "Estonia": /^\d{5}$/,
  "Finland": /^\d{5}$/, "Greece": /^\d{3}\s?\d{2}$/, "Hungary": /^\d{4}$/,
  "Italy": /^\d{5}$/, "Latvia": /^(LV-?\s?)?\d{4}$/i, "Lithuania": /^(LT-?\s?)?\d{5}$/i,
  "Poland": /^\d{2}-?\s?\d{3}$/, "Portugal": /^\d{4}-?\s?\d{3}$/, "Romania": /^\d{6}$/,
  "Slovakia": /^\d{3}\s?\d{2}$/, "Slovenia": /^(SI-?\s?)?\d{4}$/i, "Spain": /^\d{5}$/,
  "Sweden": /^\d{3}\s?\d{2}$/,
};

// Voorbeeld-postcode per land, voor de foutmelding in het adresformulier.
export const POSTCODE_EXAMPLE = {
  "Netherlands": "1234 AB", "Belgium": "1000", "Germany": "10115", "France": "75001",
  "Luxembourg": "1234", "Austria": "1010", "Bulgaria": "1000", "Croatia": "10000",
  "Cyprus": "1010", "Czech Republic": "110 00", "Denmark": "1050", "Estonia": "10111",
  "Finland": "00100", "Greece": "104 31", "Hungary": "1051", "Italy": "00100",
  "Latvia": "LV-1050", "Lithuania": "LT-01100", "Poland": "00-001", "Portugal": "1000-001",
  "Romania": "010011", "Slovakia": "811 01", "Slovenia": "1000", "Spain": "28001", "Sweden": "111 20",
};

// Klopt het postcode-formaat voor dit land? Leeg → true (de verplicht-check regelt leegheid apart);
// land zonder patroon → true (soepel). Alleen een NIET-lege, fout-geformatteerde postcode → false.
export function isValidPostcode(country, postcode) {
  const pc = String(postcode || "").trim();
  if (!pc) return true;
  const re = POSTCODE_FORMATS[country];
  return re ? re.test(pc) : true;
}
