# 01 — Productontdekking & curatie (admin)

Hoe een admin een China-bron-link (1688 / Taobao / Tmall / Weidian) omzet naar een
gecureerd, verkoopbaar Flowva-product: link plakken → BuckyDrop `product/detail`
ophalen → spuCode / skuCode / varianten / fabrieksprijs(¥) → € + fee → categorie /
subcategorie / materiaal / doelgroep → foto's → opslaan in `public.products`. Dit
document dekt de happy path én elke faal-/edge-laag: niet-beschikbaar, verborgen,
prijswijziging, ontbrekende varianten/voorraad, MOQ, meerdere bronnen, foute/ontbrekende
sku/spu-codes, image-rechten en vertaling/watermerk.

**Vaststaande grounding (gelezen in docs + code):**
- BuckyDrop-endpoint dat de admin gebruikt = `POST /api/rest/v2/adapt/openapi/product/detail`, body `{ "productLink": "<url>" }`, optioneel `lang` (header > body). [CONFIRMED — `product/Schermafbeelding …135347/135351`, `buckydrop/index.ts` ACTIONS]
- De call gaat via de beveiligde edge-function `buckydrop` (action `product-detail`); APPsecret blijft server-side; alleen `profiles.role = 'admin'` mag aanroepen. [CONFIRMED — `supabase/functions/buckydrop/index.ts`]
- Detail-respons levert: `spuCode`, `productName`, `productLink`, `price`/`proPrice` (`price` in ¥ / `priceCent` in fen), `freight`, `platform`, `categoryCode`, `picUrl`, `productImageList[]`, `productProps[]` (`propId/propName/valueId/valueName`), `skuList[]` (`skuCode`, `quantity`, `price`/`proPrice`, `props[]`, `imgUrl`), `shop` (`shopId/shopName`), `soldOutTag` (1 = te koop), `beginCount` (MOQ), `productDetailHtml`, `currentTime`. [CONFIRMED — `product/Schermafbeelding …135355→135423`]
- De admin-mapper (`productFormModal.js` + `systems/products.js`) leest hieruit: naam, ¥-prijs (`proPrice.price ?? price.price`), `picUrl`, `productImageList` → galerij, `productProps` → varianten, `skuList` → `bd_skus` (`{skuCode, priceYuan, stock, img, props[]}`), `spuCode` → `spu_code`, `platform` → `bd_platform`. [CONFIRMED — `ui/productFormModal.js` regels 208-264]
- Opslag-doel `public.products` met o.a. `spu_code`, `bd_platform`, `bd_skus(jsonb)`, `price(€)`, `moq`, `platform`, `source_url`, `category`, `subcategory`, `material`, `gallery`, `gender`, `hidden`, `price_alert/alert_reason/price_alert_at`, `size_chart`, `factory_stats`, `supplier`, `preview_images`, `variant_images`. [CONFIRMED — `buckydrop-products.sql`, `product-*.sql`, `price-guard.sql`, `lock-products.sql`]
- **Prijs-bron-van-waarheid bij betalen = de €-`price` in `public.products`, server-side gematcht op `source_url`** (`pay_cart`). Curatie zet dus zowel de juiste `source_url` als de juiste `price`; zonder correcte koppeling kan checkout niet veilig afrekenen. [CONFIRMED — `pay-cart.sql` regels 64-98]
- **Price-guard bij checkout** = edge-function `check-cart-prices`: matcht product op `source_url`, kiest dezelfde SKU als `place-bucky-order`, haalt live `product/detail` op, vergelijkt live ¥ vs opgeslagen `bd_skus[].priceYuan`; bij > 5 % stijging of niet-vindbare variant → `price_alert=true, hidden=true` en item "on hold". Fail-open per item. [CONFIRMED — `functions/check-cart-prices/index.ts`]
- `categoryCode` komt mee in detail-respons, maar wordt **niet** opgeslagen; de admin kiest zelf een Flowva-categorie (`Clothes`/`Tech` + vrije subcategorie). [CONFIRMED — `catalog.js`, geen `category_code` kolom]
- `beginCount` (MOQ) wordt **niet** auto-overgenomen; het `moq`-veld defaultet naar 1 en de admin vult het handmatig. [CONFIRMED — `productFormModal.js` regel 80, geen mapping van `beginCount`]
- Er is **geen** keyword-`search`- of `category/list-tree`-aanroep in de Flowva-code; alleen `product/detail`. Search/category/`product/create` bestaan in de docs maar zijn ongebruikt. [CONFIRMED — docs `product/search`, `product/category/list-tree`, `product/create`; afwezig in code]

---

## Scenario A — Happy path: link → gecureerd product

**Trigger.** Admin opent "NIEUW PRODUCT" in de admin (ai-ops-hud Producten-tab), plakt een
1688/Taobao/Tmall/Weidian-link in `pf-url` en klikt **⤓ ophalen**.

**Flow.**
1. `fetchBuckyProduct(link)` → `supabase.functions.invoke('buckydrop', { action:'product-detail', productLink })`. [CONFIRMED]
2. Edge-function valideert admin-JWT, tekent `MD5(appCode + body + ts + appSecret)`, POST naar `…/product/detail`. [CONFIRMED]
3. Bij `data.data` aanwezig: mapper vult naam (alleen als leeg), ¥-prijs → `pf-yuan`, en via gratis koers (`open.er-api.com/v6/latest/CNY`) → € in `pf-eur`. [CONFIRMED — regels 110-120, 208-216]
4. `spuCode`, `platform` (→ `PLATFORM_MAP` TB/TMALL→Taobao, ALIBABA→1688, WEIDIAN→Weidian) gezet; `picUrl` → hoofdfoto; `productImageList` → galerij; `productProps` → varianten; `skuList` → `bd_skus`. [CONFIRMED — regels 217-264]
5. Admin vult/controleert handmatig: € (marge!), MOQ, categorie + subcategorie, materiaal, doelgroep, beschrijving, factory-stats, eigen QC-preview-foto's, maattabel.
6. **OPSLAAN** → `saveProduct(payload, id)` → `insert/update public.products` met o.a. `price(€)`, `source_url`, `spu_code`, `bd_platform`, `bd_skus`, `gallery`. [CONFIRMED — regels 601-625]

**Wie betaalt wat.** Het ophalen kost mogelijk een piepkleine per-call BuckyDrop API-fee
[TO-VERIFY — geen fee vermeld op `product/detail`-doc; check facturatie/console bij agent Vera].
Geen wallet-/procurement-kosten in deze fase; pas bij bestellen (F3) loopt geld.

**Wat als het faalt.** Zie scenario's B–N hieronder; de happy path is alleen "groen" als
`spu_code` én een niet-lege `bd_skus` aanwezig zijn (anders kan de price-guard later
niet checken — scenario K).

**System action.** `buckydrop`-edge → `product/detail`; client-mapper; `public.products` insert/update.
**Tag:** [CONFIRMED]

---

## Scenario B — Bron-link onbruikbaar / niet-ondersteund platform

**Trigger.** Admin plakt een link die geen product-detail oplevert: gewone webshop, social-post,
verkorte/redirect-URL, app-deeplink, of een platform dat BuckyDrop niet ondersteunt.

**Flow & wat-als.**
- Leeg veld → mapper toont meteen `✖ plak eerst een productlink` (geen call). [CONFIRMED — regel 198-200]
- `success:false` of geen `data` → `fetchBuckyProduct` gooit (`data.info` of "geen productdata ontvangen"); status toont `✖ <reden>`. [CONFIRMED — regels 102-105]
- Niet-JSON / HTTP-fout van BuckyDrop → edge-function geeft `{success:false, info:text, httpStatus}` terug → zelfde foutpad. [CONFIRMED — `buckydrop/index.ts` regels 46-50]
- **Volgende laag:** een link die *wel* 200 + `data` geeft maar van het verkeerde item (redirect naar een ander product) → admin moet visueel verifiëren (naam/foto) vóór opslaan; geen automatische check. [ASSUMED]

**Wie betaalt wat.** Niets; mislukte fetch = geen order.

**System action.** `product/detail` → `success:false`/throw → status-melding; geen DB-schrijf.
**Tag:** [CONFIRMED] (foutafhandeling) / [TO-VERIFY] (exacte lijst ondersteunde platforms bij BuckyDrop)

---

## Scenario C — Product niet meer beschikbaar of verkocht (`soldOutTag`)

**Trigger.** Bron is uit de handel of uitverkocht op het moment van ophalen.

**Flow & wat-als.**
- Doc: `soldOutTag` = 1 betekent "ready to sell and available"; andere waarden = sold out. [CONFIRMED — `product/Schermafbeelding …135423`]
- **De Flowva-mapper leest `soldOutTag` NIET** → een uitverkocht product kan tóch opgehaald en opgeslagen worden zonder waarschuwing. [CONFIRMED — geen `soldOutTag` in `productFormModal.js`] → **gap.** [TO-VERIFY: voeg een check toe die bij `soldOutTag !== 1` een rode status toont en opslaan ontmoedigt.]
- Vangnet downstream: bij checkout vangt de price-guard "niet vindbaar" af → `liveYuan == null` → `reason="Currently unavailable at the supplier"`, `price_alert=true`, `hidden=true`. [CONFIRMED — `check-cart-prices` regels 121-138]

**Wie betaalt wat.** Niets in curatie; klant wordt nooit afgeschreven als de guard slaat (item "on hold").

**System action.** (gewenst) status-flag bij `soldOutTag !== 1`; (bestaand) price-guard → `products.price_alert/hidden`.
**Tag:** [CONFIRMED] (downstream-vangnet) / [TO-VERIFY] (ontbrekende `soldOutTag`-gate in de admin)

---

## Scenario D — Fabrieksprijs(¥) → € + service fee

**Trigger.** Na ophalen óf bij handmatig invoeren stelt de admin de verkoop-€ vast.

**Flow.**
- ¥ uit detail = `proPrice.price ?? price.price` (proPrice = actuele verkoopprijs, price = doorgestreepte/originele prijs). [CONFIRMED — doc + regel 212]
- Live ¥→€ via gratis koers; admin kan € overschrijven (marge bepalen). Koers kan `null` zijn → hint "vul € handmatig". [CONFIRMED — regels 184-191]
- Opgeslagen `price` = € (de prijs die de klant ziet/betaalt). Service fee 8 % (min €5) wordt **niet** in `price` verwerkt: die rekent `pay_cart`/`service_fee_for` apart over de hele mand. [CONFIRMED — `fees.js`, `pay-cart.sql` regels 27-30, 80]

**Wie betaalt wat.** Klant betaalt later `price` × qty + één service fee over de mand. De
inkoop-¥ (factory) + BuckyDrop-fees + QC ¥6 worden uit die marge gedekt; bij goedkope losse
items kan dat verliesgevend zijn (mik €20-40/bundel). [CONFIRMED — fee-model in memory/projectcontext]

**Wat als het faalt.**
- Koers-API down → € blijft leeg → admin moet handmatig; risico op typefout/te lage marge. [CONFIRMED]
- `proPrice` ontbreekt, alleen `price` (doorgestreept) → mapper valt terug op `price.price`; dat kán de hogere "van"-prijs zijn → te hoge ¥ → te hoge € (eerder veilig dan te laag). [ASSUMED — volgorde `proPrice ?? price`]
- ¥ uit `priceCent`/fen niet gebruikt door de admin-mapper (alleen `.price` in yuan); guard heeft wel een `priceCent/100`-fallback. [CONFIRMED — regels 212/255 vs `check-cart-prices` regel 83]
- **Volgende laag:** prijs verandert ná curatie → scenario H (price-guard).

**System action.** koers-fetch (extern) + `pay_cart`/`service_fee_for` (DB).
**Tag:** [CONFIRMED]

---

## Scenario E — Varianten / `productProps` → variant-keuzes

**Trigger.** Product heeft Size/Color/Material-opties.

**Flow.**
- `productProps[]` (`propName`+`valueName`) → gegroepeerd per `propName` → `variants[{name, options[]}]` (UI-keuzes voor de klant). [CONFIRMED — regels 241-251]
- `skuList[]` → `bd_skus[{skuCode, priceYuan, stock, img, props:[{name,value}]}]` (de koopbare combinaties voor F3/place-order + price-guard). [CONFIRMED — regels 256-262]

**Wat als het faalt.**
- **Geen `productProps` maar wél `skuList`** (alleen kleur varieert, props leeg) → geen UI-varianten, maar `bd_skus` gevuld; price-guard/`pickSku` valt terug op de enige SKU (`length === 1`). [CONFIRMED — `check-cart-prices` regel 58]
- **`productProps` zonder `skuList`** → klant ziet keuzes maar er is geen skuCode om te bestellen → F3 kan de variant niet koppelen. [ASSUMED] **gap** [TO-VERIFY: blokkeer opslaan of waarschuw als `bd_skus` leeg is terwijl er varianten zijn.]
- **Meerdere props (Size×Color)** → `pickSku` matcht alleen als élke prop exact overeenkomt (`props.every`); afwijkende naamgeving (vertaald "Size" vs "尺码") breekt de match → guard kan variant niet vinden → fail-open (laat door). [CONFIRMED — `check-cart-prices` regels 60-61, 70-76]
- **SKU zonder eigen prijs** → `priceYuan` valt terug op productniveau (`fallbackYuan`). [CONFIRMED — regels 255-258]

**Wie betaalt wat.** N.v.t. in curatie.

**System action.** mapper → `variants` (UI) + `bd_skus` (orders/guard).
**Tag:** [CONFIRMED]

---

## Scenario F — Voorraad / `quantity` ontbreekt of is 0

**Trigger.** `skuList[].quantity` is `null` of 0.

**Flow & wat-als.**
- `stock` = `s.quantity ?? null` opgeslagen in `bd_skus`. [CONFIRMED — regel 259]
- Flowva **blokkeert opslaan niet** op stock; `stock:null`/0 wordt gewoon bewaard. [CONFIRMED]
- Downstream: voorraad-uitputting wordt pas zichtbaar bij checkout (price-guard "unavailable") of bij F3/place-order (BuckyDrop weigert / PO komt op `to be confirmed`). [CONFIRMED guard / ASSUMED order-laag]
- **Volgende laag:** voorraad fluctueert tussen curatie en eerste verkoop → geen periodieke re-sync in de code → eerste klant draagt het risico, opgevangen door price-guard + post-pay refund. [CONFIRMED vangnet / [TO-VERIFY] of een nightly re-fetch wenselijk is.]

**Wie betaalt wat.** Geen kosten in curatie.

**System action.** `bd_skus[].stock`; geen gate.
**Tag:** [CONFIRMED] (gedrag) / [ASSUMED] (order-laag-gevolg)

---

## Scenario G — MOQ (`beginCount`) / minimum-afname

**Trigger.** Bron vereist minimum-afname (`beginCount` > 1; bulk/wholesale, typisch 1688).

**Flow & wat-als.**
- Doc: `beginCount` = minimum order quantity. [CONFIRMED — `product/Schermafbeelding …135423`]
- **Mapper neemt `beginCount` NIET over**; `moq`-veld defaultet naar 1 en is handmatig. [CONFIRMED — regel 80] → admin moet de MOQ zelf van de bronpagina overtypen. **gap** [TO-VERIFY: map `d.beginCount` → `pf-moq` bij ophalen.]
- Gevolg als gemist: klant kan qty < MOQ bestellen → BuckyDrop/seller weigert of vraagt bijbetaling → PO `orderStatus 4` (to be confirmed / supplementary payment). [ASSUMED — orderstatus-semantiek uit projectcontext]
- `moq` wordt wel opgeslagen en (aangenomen) in de feed/checkout gehandhaafd. [CONFIRMED opslag / [TO-VERIFY] handhaving in client-checkout]

**Wie betaalt wat.** Bij MOQ-mismatch downstream: supplement = `orderStatus 4`, bijbetaling door Flowva-wallet, doorbelast aan klant. [ASSUMED]

**System action.** (gewenst) `beginCount → moq`; (bestaand) handmatige `moq`.
**Tag:** [CONFIRMED] (doc + gap) / [ASSUMED] (downstream)

---

## Scenario H — Prijs veranderd ná curatie (price-guard)

**Trigger.** Tussen curatie en checkout stijgt de fabrieksprijs (of variant verdwijnt).

**Flow.**
1. Klant klikt "Confirm & pay" → client roept `check-cart-prices` met `{source_url, kleur}` per item. [CONFIRMED — `supplyflow-app.jsx` 1177-1179, `Friends.jsx` 279]
2. Function matcht product op `source_url`, kiest SKU (`pickSku`), haalt live `product/detail`, leest live ¥ (`liveYuanFor`: skuCode-match → props-match → product-fallback). [CONFIRMED — regels 88-129]
3. `(liveYuan − storedYuan)/storedYuan > 0.05` → `reason="Supplier price increased (+x%)"`; `liveYuan == null` → "Currently unavailable". [CONFIRMED — regels 122-129]
4. Bij `reason`: `products.update {price_alert:true, alert_reason, hidden:true, price_alert_at}` → item "on hold", checkout geblokkeerd, **klant niet afgeschreven**. [CONFIRMED — regels 131-138]
5. Al-gevlagd (`price_alert=true`) → meteen `changed` zonder nieuwe BuckyDrop-call. [CONFIRMED — regel 104]

**Wie betaalt wat.** Niemand: de transactie wordt vóór `pay_cart` gestopt. Prijsdaling deert
de klant niet (alleen > +5 % vlaggen; rounding-ruis vermeden). [CONFIRMED — regel 28-30]

**Wat als het faalt.**
- BuckyDrop onbereikbaar / geen `data` / variant niet te matchen → **fail-open** (laat door); vangnet = `pay_cart` + post-pay refund. [CONFIRMED — regels 116-119, 111, 1187]
- `price-guard.sql` niet gedraaid (kolommen ontbreken) → update faalt, gelogd; guard degradeert naar fail-open. [CONFIRMED — regels 98, 137; **memory: price-guard.sql nog te draaien**]
- Product niet gekoppeld (`spu_code`/`bd_skus` leeg) → niet te checken → laat door. [CONFIRMED — regels 101, 107]

**System action.** `check-cart-prices` → `product/detail` → `products.price_alert/hidden`.
**Tag:** [CONFIRMED]

---

## Scenario I — Prijs-alert oplossen: re-fetch & reactivate

**Trigger.** Admin ziet een gevlagd (rood/verborgen) product en wil het weer live zetten.

**Flow.**
- `reactivateProduct(prod)` → `fetchBuckyProduct(source_url)` → hermapt `spu_code`, `bd_platform`, `bd_skus` (verse ¥/SKU's) → `update {…, price_alert:false, alert_reason:null, hidden:false}`. [CONFIRMED — `systems/products.js` 60-85]
- **De €-`price` blijft bewust staan** — admin past die los aan via "bewerk" als inkoop omhoogging (anders krimpt de marge). [CONFIRMED — comment regels 57-59]
- Handmatig vlaggen (test/twijfel): `setProductPriceAlert(id, reason)` → `price_alert+hidden`. [CONFIRMED — regels 50-55]

**Wie betaalt wat.** N.v.t.; pas bij nieuwe checkout loopt geld tegen de (eventueel
aangepaste) €-prijs.

**Wat als het faalt.**
- `source_url` ontbreekt → "geen bron-link om opnieuw op te halen". [CONFIRMED — regel 61]
- Re-fetch mislukt (BuckyDrop down / product weg) → "opnieuw ophalen mislukt: …"; product blijft verborgen. [CONFIRMED — regels 78-80]
- **Valkuil:** admin reactiveert maar vergeet de €-prijs te verhogen terwijl ¥ steeg → marge weg; geen automatische guard hierop. [ASSUMED]

**System action.** `reactivateProduct` → `product/detail` + `products.update`.
**Tag:** [CONFIRMED]

---

## Scenario J — Categorie & subcategorie (Flowva-eigen, niet `categoryCode`)

**Trigger.** Admin classificeert het product.

**Flow.**
- Hoofdcategorie = vrij invulbaar (combobox), suggesties uit `adminCategories` (`Clothes`,`Tech`) + bestaande producten; subcategorie idem, suggesties per categorie + `clothesSubcategories`. [CONFIRMED — regels 44-51, 89-98, 275-281; `catalog.js`/`categories.js`]
- BuckyDrop `categoryCode` uit de detail-respons wordt **genegeerd**; Flowva voert een eigen taxonomie. [CONFIRMED]
- De `category/list-tree`-API (officiële BuckyDrop-categorieboom) is **ongebruikt**. [CONFIRMED — doc bestaat, geen code]

**Wie betaalt wat.** N.v.t.

**Wat als het faalt.**
- Lege categorie → opslaan defaultet naar `Clothes` (+ icoon 👕). [CONFIRMED — regels 576-577]
- Typefout/duplicaat ("Clothing" vs "Clothes") → versplinterde feed-categorieën; geen normalisatie. [ASSUMED] [TO-VERIFY: wil je een vaste enum afdwingen?]
- Lege categorieën worden in de feed automatisch verborgen. [CONFIRMED — `categories.js` comment]

**System action.** `products.category/subcategory` (vrije tekst).
**Tag:** [CONFIRMED]

---

## Scenario K — Foute / ontbrekende `skuCode` of `spuCode`

**Trigger.** Detail-respons mist `spuCode`, of `skuList` is leeg / SKU's missen `skuCode`.

**Flow & wat-als.**
- `spuCode` ontbreekt → `spu_code:null` opgeslagen; bij reactivate fallback op bestaande `prod.spu_code`. [CONFIRMED — `systems/products.js` 74]
- Leeg `skuList` → `bd_skus:[]`. **Gevolg:** price-guard kan niet checken (`spu_code`/`bd_skus` leeg → fail-open) → het product passeert checkout zonder live prijs-validatie. [CONFIRMED — `check-cart-prices` regels 100, 107]
- SKU zonder `skuCode` → guard valt terug op props-match, anders product-fallbackprijs; F3/place-order kan zonder skuCode de juiste variant mogelijk niet bestellen → BuckyDrop-fout / `orderStatus 4`. [CONFIRMED guard / ASSUMED order]
- **Geen validatie in de admin** die opslaan blokkeert bij ontbrekende `spu_code`/`bd_skus`. [CONFIRMED — `productFormModal.js` save heeft alleen titel-check, regel 565-568] **gap** [TO-VERIFY: waarschuw/blokkeer wanneer een via-link-opgehaald product geen `spu_code` of lege `bd_skus` heeft.]

**Wie betaalt wat.** Risico verschuift naar F3: mislukte order → annulering (`orderStatus 8`) / refund.

**System action.** `bd_skus`/`spu_code` opslag; geen gate.
**Tag:** [CONFIRMED] (gedrag + gap)

---

## Scenario L — Meerdere bronnen voor hetzelfde product (dubbele `source_url`)

**Trigger.** Hetzelfde artikel wordt via meerdere links/varianten van bronnen gecureerd, of
twee admin-producten delen één `source_url`.

**Flow & wat-als.**
- `pay_cart` matcht prijs op `source_url` met `limit 1` → bij dubbele rijen pakt het er één (niet-deterministisch). [CONFIRMED — `pay-cart.sql` regel 66/98]
- `check-cart-prices` haalt tot 5 rijen en kiest bij voorkeur de rij mét `spu_code` + niet-lege `bd_skus`, anders de eerste. [CONFIRMED — `check-cart-prices` regels 93-100]
- **Risico:** twee rijen met verschillende €-prijzen op dezelfde `source_url` → klant kan de goedkoopste/willekeurige raken; de guard checkt mogelijk een andere rij dan `pay_cart` afrekent. [CONFIRMED — verschillende selectie-logica] **gap** [TO-VERIFY: dwing uniciteit op `source_url` af (unieke index) of dedupe in curatie.]
- Geen unieke constraint op `source_url` aangetroffen. [CONFIRMED — niet in SQL-bestanden]

**Wie betaalt wat.** Mogelijk verkeerde (te lage) prijs afgeschreven → margeverlies voor Flowva.

**System action.** geen; aanbeveling = unieke index op `products.source_url`.
**Tag:** [CONFIRMED] (gedrag/gap)

---

## Scenario M — Foto's: galerij, QC-preview & image-rechten

**Trigger.** Foto's worden gevuld bij ophalen en/of handmatig.

**Flow.**
- `picUrl` → hoofdfoto; `productImageList` → `gallery` (klant swipet); admin's eigen QC-foto's → `preview_images`; per-variant `imgUrl`/upload → `variant_images`. [CONFIRMED — regels 226-239, 322-369, 440-443]
- Externe (seller-)foto's worden als hot-link URL bewaard; eigen uploads gaan naar Supabase Storage `product-images`. `<img referrerpolicy="no-referrer">` overal. [CONFIRMED — regels 87-92, 126, 349]

**Wie betaalt wat.** N.v.t.; Storage-kosten verwaarloosbaar.

**Wat als het faalt.**
- **Hot-link breekt** (1688/Taobao-CDN blokkeert hotlinking / verwijdert de afbeelding) → galerij toont kapotte foto's; geen rehosting. [ASSUMED] [TO-VERIFY: rehost `productImageList` naar Storage bij ophalen.]
- **Image-rechten / watermerk:** seller-foto's kunnen watermerk/merknaam/model-rechten bevatten → niet zomaar geschikt voor de Flowva-feed; de QC-pakket-foto's (eigen ¥6-fotoset) zijn de rechtenveilige vervanging. [CONFIRMED concept (QC-pakket in projectcontext) / [TO-VERIFY] juridische review per merk (LITHRA).]
- Lege galerij → hoofdfoto valt terug op `galleryImages[0]` of categorie-emoji. [CONFIRMED — regels 578-580]

**System action.** `products.gallery/preview_images/variant_images/image`; Storage-upload.
**Tag:** [CONFIRMED] (mapping) / [TO-VERIFY] (rehosting + rechten)

---

## Scenario N — Vertaling / taal (`lang`) en watermerk-tekst

**Trigger.** Bron-content is Chinees (`productName`, `props`, `productDetailHtml`).

**Flow & wat-als.**
- Edge-function stuurt `lang: "en"` header → BuckyDrop kan Engelse velden teruggeven (header > body-`lang`). [CONFIRMED — `buckydrop/index.ts` regel 42; doc regel `lang` header priority]
- `productDetailHtml` wordt **niet** opgeslagen/getoond; de admin schrijft een eigen Engelse `description`. [CONFIRMED — geen mapping van `productDetailHtml`; app = Engels per memory]
- **Volgende laag:** machinevertaling kan rommelig zijn → admin redigeert handmatig; variant-namen (`propName` "尺码"/"Size") inconsistent vertaald breken later de price-guard props-match. [CONFIRMED prop-match-risico — scenario E] [ASSUMED vertaalkwaliteit]
- Watermerk/merkteksten in `picUrl`/`productImageList` → zelfde rechten-/QC-aanpak als scenario M.

**Wie betaalt wat.** N.v.t.

**System action.** `lang:en` op de call; handmatige `description`.
**Tag:** [CONFIRMED] (lang-header) / [ASSUMED] (vertaalkwaliteit)

---

## Scenario O — Beveiliging & autorisatie van het ophalen

**Trigger.** Wie mag `product/detail` aanroepen en de DB schrijven?

**Flow.**
- `buckydrop`-function eist een geldige JWT + `profiles.role='admin'`; anders 401/403; APPsecret blijft server-side. [CONFIRMED — `buckydrop/index.ts` 65-74]
- `public.products` RLS: iedereen leest, alleen `is_admin()` mag insert/update/delete. [CONFIRMED — `lock-products.sql`]
- Witte lijst van acties in de gateway (`product-detail`, `order-detail`) — onbekende actie = 400. [CONFIRMED — regels 54-59, 78-79]
- `check-cart-prices` draait met SERVICE_ROLE maar eist een ingelogde klant en geeft **nooit** rauwe ¥/skuCode/spuCode terug (alleen `changed/available`). [CONFIRMED — regels 8, 146-151]

**Wie betaalt wat.** N.v.t.

**Wat als het faalt.**
- Niet-admin probeert te schrijven → RLS weigert ("row-level security policy"). [CONFIRMED]
- Secrets niet gezet (`BUCKY_APP_CODE/SECRET/DOMAIN`) → call faalt; fetch-status toont fout. [CONFIRMED — env-gebruik]
- `BUCKY_DOMAIN` default = `dev.buckydrop.com` → in productie moet `bdopenapi.buckydrop.com` gezet zijn, anders haal je dev-data op. [CONFIRMED — regel 15; **default = dev**] [TO-VERIFY: prod-domein als secret gezet.]

**System action.** edge-auth + RLS.
**Tag:** [CONFIRMED]

---

## Scenario P — `freight` (China-binnenlandse verzendkosten) bij curatie

**Trigger.** Detail-respons bevat `freight` (binnenlandse CN-verzendkosten van seller naar BuckyDrop-magazijn).

**Flow & wat-als.**
- `freight` (`price`/`priceCent` in ¥) staat in de respons maar wordt **niet** gelezen/opgeslagen door de admin-mapper. [CONFIRMED — doc `…135405`; geen mapping]
- Gevolg: de eerste-mijl China-verzendkost is niet zichtbaar in de marge-berekening bij curatie → kan de echte inkoopkost onderschatten (relevant voor de "goedkope losse items verliesgevend"-economie). [ASSUMED]
- De internationale verzending + DDP-BTW lopen via een aparte flow (channel-carriage-list / haul-shipping), niet via curatie. [CONFIRMED — projectcontext, buiten scope dit document]

**Wie betaalt wat.** `freight` valt onder de inkoopkost die uit de marge moet komen; nu niet
expliciet meegenomen in de €-prijsbepaling. [ASSUMED]

**System action.** geen; aanbeveling = toon `freight` bij ophalen als marge-hint.
**Tag:** [CONFIRMED] (veld bestaat, ongebruikt) / [ASSUMED] (marge-impact)

---

## Scenario Q — `product/create` (custom product op BuckyDrop) — ongebruikt

**Trigger.** Een artikel zonder bruikbare bron-link handmatig als BuckyDrop-product registreren.

**Flow & wat-als.**
- Doc: `POST /api/rest/v2/adapt/adaptation/product/create` met `goodsName`, `categoryCode`, `mainItemImgs[]`, `skuList[]` (`price`,`quantity`,`weight`,`imgUrl`,`productProps`), `productProps[]` → retourneert `goodsId`, `spuCode`, per-SKU `skuCode`. [CONFIRMED — `product/Schermafbeelding …135449→135514`]
- **Niet geïmplementeerd** in Flowva; de admin koppelt uitsluitend via bestaande bron-links (`product/detail`). [CONFIRMED — geen `product/create` in code]
- Zou nodig zijn als een seller geen indexeerbare link heeft of voor een eigen LITHRA-SKU. [ASSUMED — use-case]

**Wie betaalt wat.** N.v.t. (niet gebouwd).

**System action.** (toekomstig) `product/create` → `spuCode`/`skuCode` → `products`.
**Tag:** [CONFIRMED] (doc) / [TO-VERIFY] (bouwen ja/nee)

---

## Scenario R — Keyword-/categorie-search om producten te ONTDEKKEN — ongebruikt

**Trigger.** Admin wil binnen BuckyDrop zoeken (`keyword`, `platform`, `startPrice/endPrice`) i.p.v. een link plakken.

**Flow & wat-als.**
- Doc: `POST /api/rest/v2/adapt/openapi/product/search`, body `{current, size, item:{keyword, platform(TB/ALIBABA), startPrice, endPrice}}` → paginatie + `records[]` met `spuCode, productName, productLink, price/proPrice, picUrl`. [CONFIRMED — `product/Schermafbeelding …135314→135339`]
- `product/category/list-tree` levert de categorieboom (`categoryName/categoryCode/childList`). [CONFIRMED — `…135432`]
- **Beide ongebruikt** in Flowva; ontdekking gebeurt nu buiten de app (admin vindt links zelf) en curatie start bij `product/detail`. [CONFIRMED]
- `search` geeft géén `skuList`/varianten → na vinden alsnog `product/detail` nodig om te curaten. [CONFIRMED — search-respons mist skuList]

**Wie betaalt wat.** N.v.t. (niet gebouwd); mogelijke per-call API-fee bij gebruik. [TO-VERIFY]

**System action.** (toekomstig) `product/search` → kies record → `product/detail` → curatie.
**Tag:** [CONFIRMED] (doc) / [TO-VERIFY] (bouwen + fee)

---

## Openstaande punten (samengevat)
1. `soldOutTag`-gate bij opslaan (scenario C) — nu genegeerd. [TO-VERIFY/bouwen]
2. `beginCount` → `moq` auto-mappen (scenario G) — nu handmatig. [TO-VERIFY/bouwen]
3. Validatie "geen `spu_code` / lege `bd_skus`" blokkeert/waarschuwt bij opslaan (scenario E/K). [TO-VERIFY/bouwen]
4. Unieke index op `products.source_url` (scenario L) — voorkomt prijs-mismatch tussen `pay_cart` en guard. [TO-VERIFY/bouwen]
5. `price-guard.sql` daadwerkelijk gedraaid in prod (scenario H) — anders degradeert de guard. [TO-VERIFY — memory zegt: nog draaien]
6. `BUCKY_DOMAIN` secret = `bdopenapi.buckydrop.com` in prod (default is dev) (scenario O). [TO-VERIFY]
7. Image-rehosting + rechten/watermerk-review (scenario M/N). [TO-VERIFY]
8. `freight` tonen als marge-hint (scenario P). [ASSUMED-impact / TO-VERIFY]
9. Per-call API-fee op `product/detail`/`search` bevestigen bij agent Vera (scenario A/R). [TO-VERIFY]
