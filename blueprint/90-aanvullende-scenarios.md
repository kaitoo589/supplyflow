# Aanvullende scenarios — completeness-review deel 1

> Door de completeness-critics gevonden ONTBREKENDE scenarios, uitputtend uitgeschreven met dezelfde rigor als de hoofdsecties.
> Per scenario: **Trigger → Flow → Wie betaalt wat → Wat als het faalt → System action.** Elke bewering getagd `[CONFIRMED]` / `[ASSUMED]` / `[TO-VERIFY]`.
>
> Bronnen geverifieerd op 2026-06-22 tegen `C:/Users/Kaito/supplyflow/...` en `C:/Users/Kaito/Downloads/api buckydrop/...`.
> Gedupliceerd waar de critic-lijst overlapte (adres-snapshot, refund-naar-Stripe, dubbele PO/fees).

---

## Index

| # | Scenario | Domein |
|---|----------|--------|
| A1 | Adres bewerken na betaling — geen adres-snapshot op de order | 02 / 07 |
| A2 | Klant ziet zelf een defect op de QC-foto maar BD meldde niets | 06 |
| A3 | Afgebroken / verlopen Stripe top-up (`checkout.session.expired`) | 03 |
| A4 | Product de-publiceren/verwijderen met open klantorders | 01 |
| A5 | Dezelfde `source_url` 2× als losse cart-regels → dubbele PO/fees | 02 / 04 |
| A6 | Account verwijderen / data-export (AVG art. 15/17) | 13 |
| A7 | Restsaldo cash-out on-demand (zonder retour) | 03 |
| A8 | Price-guard fail-open + stale price → supplement-naheffing | 02 |
| A9 | Niet-ondersteund land → stille `NL`-fallback voor het adres | 02 |
| A10 | Variant-wissel / annulering vóór inkoop zonder gemeld probleem | 02 |
| A11 | localStorage geblokkeerd → cart verdwijnt stil | 02 |
| A12 | Dubbele submit / twee tabs → dubbele afschrijving | 02 |
| A13 | Klant reageert NIET op gemeld probleem (pre-inkoop timeout) | 04 |
| A14 | iDEAL-storno/chargeback ná uitgegeven saldo (fraudevariant) | 02 / 03 |
| A15 | Onvolledig adres dat tóch `hasAddress=true` geeft | 02 |
| A16 | Multi-device cart-desync | 02 |
| A17 | Top-up zonder bovengrens / niet-ronde bedragen (AML) | 03 |
| A18 | Hardcoded DHL-trackinglink bij niet-DHL-carrier | 08 |
| A19 | Cadeau / afwijkend afleveradres per order | 02 |
| A20 | Friends-host zonder geldig adres terwijl leden al gehold zijn | 15 |
| A21 | Voorraad-vs-verse-inkoop: klant-zichtbare levertijd klopt niet | 10 |
| A22 | Taal/toegankelijkheid van klantcommunicatie (WCAG/EAA) | 08 |
| A23 | Granulaire notificatie-consent (transactioneel vs marketing) | 14 |
| A24 | Klant eist refund naar bank/kaart i.p.v. saldo | 09 |
| A25 | Partial stock: minder stuks geleverd binnen één SKU | 04 |
| A26 | `orderStatus 10` (stock-out/outbound) niet gemapt | 05 |
| A27 | `resultStatus=0` parcel auto-submission failure | 05 |
| A28 | `failureType` 1=System vs 2=Business (retry vs refund) | 04 |
| A29 | Multi-product mand → N losse PO's, asynchrone split inbound | 04 |
| A30 | Seller→magazijn transit-verlies (status blijft 6, nooit 9) | 05 |
| A31 | "Not as described" maar maat OK en niet defect | 05 |
| A32 | `currency`-veld per order → FX-mismatch op inkoopniveau | 04 |
| A33 | Seller-retourvenster verloopt tijdens BD-opslag | 05 |
| A34 | Partiële `quantity` binnen één SKU bij apply-return | 04 |
| A35 | Seller-rang/kwaliteitssignaal vóór auto-inkoop | 04 |
| A36 | MOQ/`beginCount` blijkt pas bij plaatsing (post-pay) | 04 |
| A37 | `orderStatus 7` (received/signed) niet gemapt | 05 |
| A38 | Seller weigert seller-side retour → CN dead stock | 04 |
| A39 | Out-of-order defect-webhook ná `shipped_international` | 05 |
| A40 | Variant-string-match breekt (seller wijzigt `productProps`) | 04 |
| A41 | Item niet veilig internationaal verzendbaar zoals geleverd | 05 |
| A42 | Dubbele `source_url` → verkeerde product-rij gekozen bij inkoop | 04 |
| A43 | Supplement (orderStatus 4) zonder confirm/pay-endpoint → gestrande PO | 05 |
| A44 | Adres-desync tussen PO-create en haul-quote (cross-moment) | 07 |

---

## A1 — Adres bewerken na betaling (geen adres-snapshot op de order)

**Domein:** 02-checkout-klant / 07-internationale-verzending

**Trigger:** Klant betaalt de mand → opent profiel → tikt "Edit" in `EditProfileSheet` → wijzigt adres, postcode of land. De order staat nog op `quote_accepted` of `purchased` (BuckyDrop-plaatsing async/geretryd).

**Flow:**
1. `pay_cart` slaat GEEN bezorgadres op de order-rij op `[CONFIRMED — pay-cart.sql INSERT (r.103-119) bevat geen adresvelden]`.
2. `place-bucky-order` leest het adres LIVE uit `user_metadata` op het plaatsingsmoment `[CONFIRMED — index.ts r.119-134: getUserById → m.adres/m.stad/m.land/m.postcode]`.
3. Wijzigt de klant zijn adres vóórdat de trigger/retry feuert, dan reist het pakket naar het NIEUWE (of half-ingetypte) adres.
4. Bij landwijziging verandert ook `countryCode` (r.127) → andere douane-/DDP-route onder een al-betaalde order.

**Wie betaalt wat:**
- Verkeerde levering → her-verzending/retour kost; bij DDP-landwissel klopt de geïnde 21%-BTW-aanname niet meer `[ASSUMED]`.
- Bij een al verzonden pakket draagt **Flowva** het mis-ship-verlies (klant gaf "correct" adres op moment van wijzigen) `[ASSUMED]`.

**Wat als het faalt:**
- Half-bewerkt adres (klant slaat op met leeg huisnummer) → carrier-weigering (zie A15).
- Land buiten de 26-map → stille `NL`-fallback (zie A9).
- Adres wijzigt ná PO-create maar vóór haul-quote → PO draagt oud adres, quote gebruikt nieuw (zie A44).

**System action:**
- **Bevries het volledige bezorgadres als snapshot-kolommen op de order in `pay_cart`** (country/countryCode/province/city/detailAddress/postCode/contactName/phone/email), net zoals Friends het adres bij plaatsing bevriest. `place-bucky-order` moet daarna UIT de order lezen, niet uit `user_metadata`.
- UI: bij "Edit address" met open orders → waarschuwing "wijziging geldt alleen voor toekomstige bestellingen".
- `[TO-VERIFY]` of er een BD-endpoint is om het eindadres van een bestaande PO te updaten — `order/delivery/update` doet dat NIET, die wijzigt alleen domestic inbound-tracking `[CONFIRMED — logistics doc "Supplement Domestic Logistics": deliveryCode/deliveryName/deliveryNo]`.

---

## A2 — Klant ziet zelf een defect op de QC-foto, BD meldde niets

**Domein:** 06-qc-goedkeuringspoort

**Trigger:** Order staat op `qc_pending`, `qc_images` zijn geladen, maar BuckyDrop's auto-inspectie stuurde GEEN "Notify Po Pending" (geen `confirmType`). De klant ziet zelf verkeerde kleur/print/defect op de foto.

**Flow:**
1. De enige knop in de QC-weergave is "🏭 Add to parcel →" `[CONFIRMED — supplyflow-app.jsx r.1682-1684]`.
2. Er is GEEN "Ik zie een probleem / afkeuren"-actie aan de QC-poort.
3. Klant kan alleen via los chat-bericht (`CustomerChat`, r.1695) reageren → geen status-hold, geen `dispute_status`, geen gestructureerde reject.

**Wie betaalt wat:**
- Als de klant niet kan afkeuren en het item verzonden raakt, draait hij op tegen een retour ná internationale verzending (duurste retour) `[ASSUMED]`.
- Een tijdige klant-reject vóór outbound bespaart internationale verzendkosten voor beide partijen.

**Wat als het faalt:**
- Klant keurt af op basis van een misleidende/lage-resolutie foto die feitelijk in orde is → onnodige hold → seller-dispute zonder grond (zie A31 voor de "not as described"-classificatie).
- Reject-signaal arriveert nadat het item al `shipped_international` is (out-of-order, zie A39).

**System action:**
- **Voeg een klant-reject-actie toe aan de QC-poort** die `dispute_status='customer_rejected'` + een reden zet en de order vasthoudt vóór `Add to parcel`/outbound.
- Backend moet bij customer-reject een hold leggen die `place`/haul blokkeert tot een agent beslist (seller-return via `order/return/get` + `order/return` apply, of doorlaten).
- `[TO-VERIFY]` of BD een "request re-inspection"-endpoint heeft; staat NIET in de gelezen docs.

---

## A3 — Afgebroken / verlopen Stripe top-up

**Domein:** 03-treasury-wallet

**Trigger:** Klant start top-up → `create-checkout` → `window.location.href = data.url` `[CONFIRMED — supplyflow-app.jsx r.1275-1279]` → iDEAL-redirect wordt afgebroken (tabblad dicht, bankapp-redirect mislukt, "terug"). Er komt nooit een `checkout.session.completed`-webhook.

**Flow:**
1. Geen saldo-ophoging, geen pending-state, geen herinnering.
2. Klant denkt mogelijk dat hij betaald heeft → "waar is mijn geld?"
3. De idempotente webhook dekt DUBBELE events, maar NIET de afgebroken sessie `[CONFIRMED — finance-hardening.sql/stripe-webhook behandelen completed/idempotentie, geen expired]`.

**Wie betaalt wat:** Niemand wordt belast (geen completed event) — het probleem is verwarring + support-last, geen geldverlies `[ASSUMED]`.

**Wat als het faalt:**
- Klant probeert opnieuw → 2 sessies; als één later alsnog completet → onverwachte dubbele top-up (idempotentie op `session.id` vangt dezelfde sessie, niet twee verschillende sessies) `[ASSUMED]`.
- Async iDEAL betaalt later tóch (`checkout.session.async_payment_succeeded`) → top-up komt vertraagd binnen zonder dat de UI dat toonde.

**System action:**
- Abonneer op `checkout.session.expired` en `checkout.session.async_payment_failed` → log + optioneel push "je top-up is niet voltooid, probeer opnieuw".
- Toon een pending-top-up-status in de wallet tot completed/expired binnen is.
- `[TO-VERIFY]` welke Stripe-events `stripe-webhook` nu daadwerkelijk afhandelt (alleen completed zichtbaar in memory; verifieer de switch in `functions/stripe-webhook`).

---

## A4 — Product de-publiceren/verwijderen met open klantorders

**Domein:** 01-product-curatie

**Trigger:** Admin/agent verwijdert of de-publiceert een product (of wijzigt `source_url`) terwijl een order in `qc_pending`/transit zit.

**Flow:**
1. `cancel_paid_order`/`refund_order` leunen op `order.price`/`quoted_total` (ok, geen productkoppeling nodig) `[CONFIRMED — refund-order.sql r.30; cancel r.40]`.
2. Maar elders matcht de app op `products.title` / `source_url`:
   - QC-foto-fallback zoekt `products.find(p => p.title === order.product_title)` `[CONFIRMED — supplyflow-app.jsx r.1657]`.
   - `place-bucky-order` zoekt het product via `.eq('source_url', order.source_url)` `[CONFIRMED — index.ts r.97-99]`.
   - `check-cart-prices`/price-guard re-checken op `source_url` `[CONFIRMED — pay-cart.sql r.64-71, check-cart-prices]`.
3. Product weg → fallback-foto verdwijnt, re-inkoop bij retour vindt `source_url` niet meer, price-guard kan niet re-checken.

**Wie betaalt wat:** Geen directe geldstroom, maar verlies van koppeling kan een retour-herinkoop blokkeren → Flowva moet handmatig fixen `[ASSUMED]`.

**Wat als het faalt:** Order in `quote_accepted` waarvan `place-bucky-order` nog moet feuern → `product` is leeg → "Geen gekoppeld product gevonden" → `bd_error` → order blijft hangen `[CONFIRMED — index.ts r.107]`.

**System action:**
- **Soft-delete / blokkeer hard-delete zolang er open orders aan een `source_url` hangen.** `lock-products.sql` bestaat al — verifieer of het delete bij open orders tegenhoudt.
- Bewaar productkoppeling (titel/image/source_url) als snapshot op de order (overlapt met A1-snapshot-aanpak).

---

## A5 — Dezelfde `source_url` 2× als losse cart-regels (dubbele PO/fees)

**Domein:** 02-checkout-klant / 04-inkoop-leverancier

**Trigger:** Klant tikt 2× "add to cart" op hetzelfde item i.p.v. de qty te verhogen.

**Flow:**
1. Cart dedupt niet; `pay_cart` maakt N losse orders met N losse SF-id's voor exact hetzelfde product+variant `[CONFIRMED — pay-cart.sql loop r.93-123: één INSERT per array-element]`.
2. `place-bucky-order` plaatst per order een aparte shop-order `[CONFIRMED — idempotent per order.id, geen samenvoeging op source_url]`.
3. → N losse BuckyDrop shop-orders i.p.v. één order met `productCount=N`.

**Wie betaalt wat:**
- **Flowva** betaalt dubbele fulfilment-fee: ¥9,9/parcel ontstaat per losse order-flow + ¥2/item boven 5 `[ASSUMED — fee-model uit briefing; per-order parcel-vorming]`.
- Klant betaalt één service fee over de hele mand (8%, min €5) `[CONFIRMED — pay-cart.sql r.80, één fee]`, dus de extra fulfilment-kost komt volledig bij Flowva.

**Wat als het faalt:** Verwarrende dubbele order-kaarten in de app; klant denkt aan een bug.

**System action:**
- **Cart-dedup: identieke `source_url`+`kleur`-regels samenvoegen tot één regel met `qty += 1`** vóór `pay_cart`.
- Server-side defensief: `pay_cart` kan identieke (source_url,kleur) binnen één mand mergen tot één order met opgetelde qty `[ASSUMED — ontwerpbeslissing]`.

---

## A6 — Account verwijderen / data-export (AVG art. 15/17)

**Domein:** 13-juridisch-compliance

**Trigger:** Klant verzoekt "verwijder mijn account" of "exporteer mijn gegevens".

**Flow:**
1. Er is GEEN delete-account- of data-export-flow in de klant-app `[CONFIRMED — grep src: enige "delete"-treffer is review-verwijdering in ReviewPage.jsx; geen account/gdpr-flow]`.
2. `user_metadata` bevat NAW + telefoon; orders bevatten adresgebruik en transacties.
3. Verwijdering nu handmatig/onmogelijk.

**Wie betaalt wat:** N.v.t. (compliance), maar restsaldo bij verwijdering moet terug naar de klant (zie A7) `[CONFIRMED — wettelijk]`.

**Wat als het faalt:**
- Verwijderen met open orders/lopende verzending → wie ontvangt het pakket, wat met restsaldo?
- Juridische bewaarplicht facturen (NL: 7 jaar) botst met "recht op vergetelheid" → financiële records moeten bewaard (geanonimiseerd waar kan), niet hard verwijderd `[CONFIRMED — wettelijke bewaarplicht]`.

**System action:**
- Bouw een **data-export** (JSON/PDF van profiel + orders + transacties) en een **account-delete-flow** met poort: alleen toestaan als er geen open orders/verzendingen zijn EN restsaldo eerst is uitbetaald (A7).
- Anonimiseer (niet hard-delete) financiële records die onder bewaarplicht vallen.
- `[TO-VERIFY]` of Supabase `auth.admin.deleteUser` + cascade op orders gewenst is, of alleen anonimiseren.

---

## A7 — Restsaldo cash-out on-demand (zonder retour)

**Domein:** 03-treasury-wallet

**Trigger:** Klant laadde €50 op, kocht voor €20, wil de resterende €30 terug naar zijn bank — los van enige order/retour.

**Flow:**
1. `/withdraw` is gebouwd voor **EU-herroeping van een order** `[CONFIRMED — WithdrawalPage.jsx + withdrawal-request function]`, niet voor "geef mijn opgeladen geld terug".
2. Refund-RPC's storten naar `balance`, niet naar de bank `[CONFIRMED — refund-order.sql r.34, cancel_paid_order r.43]`.
3. Onduidelijk of pure saldo-uitbetaling kan.

**Wie betaalt wat:** Flowva betaalt het restsaldo terug; transactiekosten van de terugboeking (Wise/Stripe-refund) draagt Flowva `[ASSUMED]`.

**Wat als het faalt:**
- Saldo opgeladen maar nooit besteed = "opslag van geld" → kan onder e-money/PSD2-achtige regels vallen `[TO-VERIFY — juridisch advies nodig]`.
- Cash-out van saldo dat via iDEAL-storno kan worden teruggeboekt → fraude-route (A14).

**System action:**
- **Bouw een expliciete "saldo terugbetalen naar bank"-flow** (refund naar de originele top-up-betaalmethode via Stripe, niet naar een willekeurige IBAN — voorkomt witwas-route).
- Beperk cash-out tot het bedrag dat via Stripe is opgeladen en nog niet is uitgegeven `[ASSUMED]`.
- Win juridisch advies in over e-money-kwalificatie van een herlaadbare wallet.

---

## A8 — Price-guard fail-open + stale price → supplement-naheffing

**Domein:** 02-checkout-klant

**Trigger:** `check-cart-prices` is onbereikbaar (function down) én `products.price` is verouderd t.o.v. de echte ¥-prijs bij de seller.

**Flow:**
1. `submitRequestList` vangt de check-fout met fail-open `[CONFIRMED — supplyflow-app.jsx r.1187: catch { /* check onbereikbaar → fail-open */ }]`.
2. `pay_cart` trekt de OUDE (lagere) `products.price` server-side → order geplaatst, klant betaalde te weinig `[CONFIRMED — pay-cart.sql r.98]`.
3. `place-bucky-order` stuurt de variant-prijs uit `sku.priceYuan` `[CONFIRMED — index.ts r.114]`; als de seller duurder is, komt de PO terug als `orderStatus 4` (to be confirmed incl. supplementary payment) `[CONFIRMED — order-detail doc: 4 = to be confirmed (including supplementary payment)]`.

**Wie betaalt wat:**
- Het prijsgat (supplement) moet ergens vandaan; uit de wallet bijbetalen = **extra afschrijving van de klant ná betaling**, wat NIET expliciet is toegestaan/gecommuniceerd `[CONFIRMED — geen consent-flow voor naheffing]`.
- Anders draagt Flowva het gat (en de order strandt op 4, zie A43).

**Wat als het faalt:** Geen confirm/pay-supplement-endpoint in de docs → PO blijft op 4 hangen, opslagklok tikt door, gedwongen refund (A43).

**System action:**
- **Geen stille naheffing.** Bij `orderStatus 4` → meld de klant het supplement en vraag expliciet toestemming vóór extra afschrijving (of bied annuleren+refund).
- Overweeg fail-CLOSED bij de price-check voor items boven een drempelbedrag `[ASSUMED]`.
- Houd `products.price` actueel via de price-guard-job.

---

## A9 — Niet-ondersteund land → stille `NL`-fallback voor het adres

**Domein:** 02-checkout-klant

**Trigger:** Klant in Polen/Tsjechië/buiten EU vult een land in dat niet in de 26-entry `COUNTRY_CODES`-map staat.

**Flow:**
1. `EditProfileSheet` heeft een vrij tekstveld voor land (geen validatie) `[CONFIRMED — supplyflow-app.jsx ~r.935 land-veld; geen dropdown]`.
2. `countryCodeFor()` valt stil terug op `"NL"` bij onbekend land `[CONFIRMED — index.ts r.28-29: ?? "NL"]`; `land` default `"Netherlands"` (r.122).
3. BuckyDrop krijgt `countryCode:"NL"` terwijl het pakket naar Polen moet → verkeerde douane/route/DDP.
4. Dezelfde NL-fallback zit óók in `haul-shipping` (hardcoded `countryCode:"NL"`, r.47) → de verzend-quote/zone is voor IEDERE klant NL, niet alleen onbekende landen (zie A44) `[CONFIRMED — haul-shipping/index.ts r.47]`.

**Wie betaalt wat:** Mis-routing/terugzending → **Flowva** draagt de kost (systeemfout, niet klantfout) `[ASSUMED]`.

**Wat als het faalt:** `country:"Netherlands"` + `countryCode:"NL"` + buitenlandse postcode → carrier weigert of stuurt naar NL `[ASSUMED]`.

**System action:**
- **Vervang het vrije land-veld door een gevalideerde dropdown** beperkt tot de ondersteunde landen.
- `countryCodeFor()` mag NIET stil naar NL vallen — bij onbekend land → checkout blokkeren met "we leveren nog niet naar dit land".
- Breid de `COUNTRY_CODES`-map uit naar alle EU-landen waar Flowva levert `[TO-VERIFY — welke landen exact gesupporteerd]`.

---

## A10 — Variant-wissel / annulering vóór inkoop zonder gemeld probleem

**Domein:** 02-checkout-klant

**Trigger:** Klant koos M, wil L; order staat op `quote_accepted`/`purchased`, geen probleem gemeld.

**Flow:**
1. `cancel_paid_order` vereist een door de agent gemeld `problem_type` `[CONFIRMED — refund-order.sql r.36-38]`.
2. Zonder probleem kan de klant niet annuleren én niet wisselen.
3. Geen variant-wijzig-pad in de UI.

**Wie betaalt wat:** Bij legitieme annulering vóór inkoop hoort 100% refund (productprijs; service fee bij hele-groep-annulering) `[CONFIRMED — refund-order.sql fee-refund r.42-60]`.

**Wat als het faalt:** Klant zit vast → moet doorzetten met de verkeerde variant of een dispute forceren = frustratie + mogelijk non-compliant (wettelijk annuleren vóór verzending mag).

**System action:**
- **Sta klant-geïnitieerde annulering toe in de pre-inkoop-fase (`quote_accepted`, en `purchased` zolang BD-cancel kan)** zonder gemeld probleem.
- BD-cancel-endpoint bestaat: `order/shop-order/cancel` (partnerOrderNo of shopOrderNo) `[CONFIRMED — order doc "API-Cancel Shop Order"]` en `API-Cancel Purchase Order` voor de PO.
- Variant-wissel = annuleren + nieuwe order, of een BD-exchange (`applyType=2`) `[CONFIRMED — Return Application applyType 2=Product Exchange]` zodra ingekocht.

---

## A11 — localStorage geblokkeerd → cart verdwijnt stil

**Domein:** 02-checkout-klant

**Trigger:** Klant in Safari-privémodus / iOS Lockdown / storage-quota vol / cookies geweigerd.

**Flow:**
1. Cart, favorites, haul en active_group leven volledig in localStorage `[CONFIRMED — supplyflow-app.jsx r.1035-1062]`.
2. Lezers vangen fouten met `catch { return []; }` `[CONFIRMED — r.1037/1049/1061]`, maar de schrijver `localStorage.setItem("supplyflow_haul", ...)` (r.1041) is NIET in try/catch en kan throwen `[CONFIRMED]`.
3. Cart leegt zichzelf bij refresh; "add to cart" lijkt te werken maar verdwijnt; geen waarschuwing.

**Wie betaalt wat:** N.v.t. (conversieverlies, geen geldstroom).

**Wat als het faalt:** Een setState-throw in een effect kan een render-crash veroorzaken (witte PWA) `[ASSUMED]`.

**System action:**
- Wrap ALLE `setItem`-calls in try/catch (ook r.1041).
- Detecteer geblokkeerde storage bij opstart → toon een banner "je browser blokkeert opslag; je mand wordt niet bewaard tussen sessies".
- Overweeg server-side cart-persistentie voor ingelogde klanten (overlapt A16).

---

## A12 — Dubbele submit / twee tabs → dubbele afschrijving

**Domein:** 02-checkout-klant

**Trigger:** Klant tikt snel meerdere keren op "Confirm & pay", of stuurt `pay_cart` parallel vanuit twee tabbladen.

**Flow:**
1. UI disabled de knop via `sendingList` `[CONFIRMED — r.1171-1172, 1052]`, maar dat beschermt niet tegen twee tabs/herstuur.
2. `pay_cart` heeft GEEN idempotency-key `[CONFIRMED — pay-cart.sql: geen idempotentie-parameter]`.
3. `select balance ... for update` (r.84) serialiseert op saldo-niveau, maar als beide calls door de balans-check raken vóór de eerste commit, of bij genoeg saldo voor beide, ontstaan twee order-groepen met dubbele afschrijving `[ASSUMED — FOR UPDATE voorkomt lost-update op balance, niet dubbele order-INSERT]`.

**Wie betaalt wat:** **Klant** wordt 2× afgeschreven = ergste vertrouwensincident in betalingen.

**Wat als het faalt:** Twee BD-orders voor dezelfde mand → dubbele fulfilment (A5-achtig) bovenop de dubbele charge.

**System action:**
- **Idempotency-key per checkout-poging** (client genereert een UUID, `pay_cart` weigert een tweede call met dezelfde key binnen een venster).
- Of: unieke constraint op (user_id, request_group_id-seed) per poging.

---

## A13 — Klant reageert NIET op een gemeld probleem (pre-inkoop timeout)

**Domein:** 04-inkoop-leverancier

**Trigger:** Agent meldt `out_of_stock`/probleem (`problem_type` gezet, order op `quote_accepted`); klant opent de app nooit meer.

**Flow:**
1. `acknowledgeProblem` en `cancelRequest` zijn beide klant-geïnitieerd `[CONFIRMED — supplyflow-app.jsx r.1241-1254]`.
2. Geen timeout/auto-cancel/auto-refund als de klant verdwijnt.
3. Het betaalde geld blijft hangen als order die nooit gekocht én nooit gerefund wordt.

**Wie betaalt wat:** Geld van de klant zit vast; wettelijk moet een niet-uitgevoerde betaalde order binnen redelijke termijn terug `[CONFIRMED — consumentenrecht]`.

**Wat als het faalt:** Zonder reminder/vervaltermijn blijft het saldo onbeperkt geblokkeerd in een order-rij.

**System action:**
- **Reminder-cadans (push/e-mail) + auto-refund na X dagen** in de pre-inkoop probleemfase. `auto-refund.sql` levert de RPC; voeg een scheduled job toe die `quote_accepted`-orders met `problem_type` ouder dan X dagen automatisch refundt.
- `[TO-VERIFY]` redelijke termijn X (juridisch: 14 dagen na annulering is gangbaar voor refund).

---

## A14 — iDEAL-storno/chargeback ná uitgegeven saldo (fraudevariant)

**Domein:** 02-checkout-klant / 03-treasury-wallet

**Trigger:** Top-up wordt teruggeboekt (storno/chargeback) nadat het saldo al aan een order is uitgegeven en de BD-inkoop loopt. Misbruikvariant: opladen → snel bestellen → storneren.

**Flow:**
1. Saldo opgehoogd (top-up completed) → klant bestelt → saldo afgeschreven → BD-order geplaatst.
2. Later komt `charge.dispute.created`/storno → Stripe trekt het geld terug.
3. Wallet kan niet meer terug; het ingekochte item is al onderweg.

**Wie betaalt wat:** **Flowva** draagt het volledige verlies (product + fees), tenzij teruggevorderd `[ASSUMED]`.

**Wat als het faalt:**
- Geen "saldo kan negatief"-beleid → de afschrijving die de order veroorzaakte staat los van de teruggeboekte top-up; saldo blijft kunstmatig positief of de boekhouding klopt niet `[ASSUMED]`.
- Geen account-flagging → herhaalmisbruik.

**System action:**
- **Saldo-kan-negatief-beleid**: bij chargeback boek de top-up terug (saldo kan negatief worden) + flag het account.
- BD-order intrekken indien nog mogelijk (`order/shop-order/cancel`).
- Account-flag → blokkeer verdere bestellingen tot het saldo is aangezuiverd.
- `stripe-disputes.sql` bestaat al — verifieer of die de wallet correct terugboekt en het account flagt.

---

## A15 — Onvolledig adres dat tóch `hasAddress=true` geeft

**Domein:** 02-checkout-klant

**Trigger:** Klant vult `adres='Hoofdstraat'` (geen huisnummer) + `stad` in, laat postcode/telefoon leeg.

**Flow:**
1. `hasAddress` checkt alleen `(m.adres && m.stad)` `[CONFIRMED — supplyflow-app.jsx r.507]`; postcode, huisnummer, telefoon en land worden niet gevalideerd.
2. Checkout-knop activeert, order plaatst, BD krijgt `postCode:''` `[CONFIRMED — index.ts r.131: m.postcode || ""]` en `contactPhone:''` (r.133).
3. Carrier weigert of pakket onbestelbaar.

**Wie betaalt wat:** Faalt ná betaling én ná inkoop = duurste plek → **Flowva** draagt retour/herverzend-kost `[ASSUMED]`.

**Wat als het faalt:** Leeg telefoon-veld blokkeert douane/last-mile in sommige landen `[ASSUMED]`.

**System action:**
- **Veld-voor-veld validatie vóór de pay-knop**: huisnummer aanwezig, postcode-formaat per land (regex), telefoon verplicht, land uit dropdown (A9).
- `hasAddress` uitbreiden naar alle minimaal-vereiste velden.

---

## A16 — Multi-device cart-desync

**Domein:** 02-checkout-klant

**Trigger:** Klant voegt op telefoon items toe, checkout op laptop met lege cart; of host+lid op één apparaat.

**Flow:**
1. localStorage-cart is per-browser, niet gesynct met de server `[CONFIRMED — r.1045-1050]`; `balance` is wel server-side.
2. Inconsistente cart-staat tussen devices; mogelijk dubbele bestelling als beide checkouten.

**Wie betaalt wat:** Bij dubbele checkout: dubbele afschrijving (overlapt A12) `[ASSUMED]`.

**Wat als het faalt:** Verloren mand op het ene device → conversieverlies; verwarrende dubbele orders.

**System action:**
- **Server-side cart-persistentie per ingelogde gebruiker** (cart-tabel), localStorage alleen als cache/offline-buffer.
- Idempotency-key (A12) voorkomt dat twee devices dezelfde mand dubbel afrekenen.

---

## A17 — Top-up zonder bovengrens / niet-ronde bedragen (AML)

**Domein:** 03-treasury-wallet

**Trigger:** Klant typt 99999 of 5,999 als top-up-bedrag.

**Flow:**
1. `handleTopup` checkt alleen de ondergrens `>= 5` `[CONFIRMED — supplyflow-app.jsx r.1272]` en doet `Math.round(amount*100)` (r.1276).
2. Geen bovengrens, geen step → enorme Stripe-charge mogelijk, of afrondingsruis.
3. (Negatieve/0-qty wordt server-side wél geklemd in `pay_cart` via `greatest(...,1)` `[CONFIRMED — pay-cart.sql r.96]`, maar dat dekt geen top-up-grens.)

**Wie betaalt wat:** Per ongeluk te veel opgeladen → klant eist refund (A7); witwas-risico via de wallet.

**Wat als het faalt:** Onbegrensde herlaadbare wallet trekt toezichthouders-aandacht (AML) `[CONFIRMED — algemene AML-principes]`.

**System action:**
- **Bovengrens + sanity-check** op top-up (bijv. max €X per transactie/dag, hele euro's of nette stappen).
- Server-side validatie in `create-checkout` (niet alleen client) `[ASSUMED — nu enkel client-check zichtbaar]`.

---

## A18 — Hardcoded DHL-trackinglink bij niet-DHL-carrier

**Domein:** 08-levering-post

**Trigger:** BuckyDrop verzendt internationaal via 4PX/YunExpress/PostNL/ander kanaal i.p.v. DHL.

**Flow:**
1. De UI hardcodeert "DHL Express" + een DHL-tracking-URL voor elk `shipped_international`-order met `tracking_number` `[CONFIRMED — supplyflow-app.jsx r.1689 "DHL Express", r.1691 DHL-URL]`, ongeacht het werkelijke kanaal.
2. Trackinglink wijst naar het verkeerde carrier-portal → "mijn pakket is zoek".

**Wie betaalt wat:** N.v.t. (UI-bug), maar genereert support-load.

**Wat als het faalt:** Klant denkt dat de zending kwijt is, opent dispute/chargeback (raakt A14).

**System action:**
- **Sla het werkelijke kanaal/koerier + tracking-URL op uit de BD-parcel-data** en toon die i.p.v. hardcoded DHL.
- `[TO-VERIFY]` welk veld BD teruggeeft voor carrier/kanaal en tracking-URL (parcel details query: `packageCode` + logistics-velden — verifieer `channel`/`logisticsName`).

---

## A19 — Cadeau / afwijkend afleveradres per order

**Domein:** 02-checkout-klant

**Trigger:** Klant bestelt iets voor een vriend / naar werk; afleveradres ≠ profieladres.

**Flow:**
1. Het systeem kent maar één adres in `user_metadata`; geen per-order afleveradres in de checkout `[CONFIRMED — place-bucky-order leest alleen user_metadata; pay_cart slaat geen adres op]`.
2. Enige workaround = profiel bewerken → raakt alle lopende orders (A1).

**Wie betaalt wat:** N.v.t. direct; mis-ship-risico via de A1-bug.

**Wat als het faalt:** Klant overschrijft zijn adres voor één cadeau → lopende orders gaan naar het cadeau-adres (A1).

**System action:**
- **Per-order afleveradres-keuze in de checkout** (opslaan op de order-snapshot, A1).
- Adresboek met meerdere opgeslagen adressen `[ASSUMED — productbeslissing]`.

---

## A20 — Friends-host zonder geldig adres terwijl leden al gehold zijn

**Domein:** 15-flowva-friends

**Trigger:** Host heeft geen/ongeldig adres ingevuld, of wijzigt zijn adres ná `ready` maar vóór self-placement, terwijl leden al `ready` zijn en `held_amount` is afgeschreven.

**Flow:**
1. Pakket gaat naar de HOST `[CONFIRMED — place-bucky-order r.118-119: addressUserId = order.host_user_id || order.user_id]`.
2. Adres wordt pas bij plaatsing bevroren `[CONFIRMED — leest user_metadata bij plaatsing]`.
3. Leden hebben betaald (held), maar er is geen bestelbaar adres → groep hangt of gaat naar een fout adres.

**Wie betaalt wat:** Groepsgeld (`held_amount`) zit vast; bij fout adres draagt Flowva het mis-ship-verlies `[ASSUMED]`.

**Wat als het faalt:** Host zonder geldig adres + leden gehold → niet-leverbare groep, gefrustreerde leden, refund-druk op alle leden.

**System action:**
- **Host-adres-validatiepoort vóórdat leden kunnen `ready`-en/`hold`-en** (zelfde veld-validatie als A15).
- Bevries het host-adres op het Friends-order op het moment dat de groep `ready` wordt (snapshot, A1).
- Bij host-overdracht: her-valideer het adres van de nieuwe host.

---

## A21 — Voorraad-vs-verse-inkoop: klant-zichtbare levertijd klopt niet

**Domein:** 10-voorraad-doorstroom

**Trigger:** Een hero-item ligt als teruggehouden voorraad in het CN-magazijn; de klant bestelt het.

**Flow:**
1. `place-bucky-order` plaatst ALTIJD een nieuwe shop-order `[CONFIRMED — index.ts: geen voorraad-check, altijd create]`.
2. Geen klant-zichtbaar "op voorraad, sneller leverbaar"-signaal.
3. Onnodige her-inkoop + langere levertijd terwijl voorraad direct verzendbaar was.

**Wie betaalt wat:** Dubbele inkoop = extra productkost voor **Flowva** als de voorraad niet wordt verzilverd `[ASSUMED]`.

**Wat als het faalt:** Klant ziet een levertijd-belofte die niet strookt met de fulfill-from-stock-beslissing → verwachtingsmismatch.

**System action:**
- **Maak de fulfill-from-stock-beslissing klant-zichtbaar** (levertijd reflecteert voorraad vs verse inkoop).
- Ops-laag (domein 10) moet vóór `place-bucky-order` checken of er matchende voorraad ligt; zo ja → forward/stock-out i.p.v. nieuwe PO.
- `[TO-VERIFY]` welke BD-flow voorraad-uitgifte doet (orderType 4 = Inventory/Stock Order; orderStatus 10 = outbound — zie A26).

---

## A22 — Taal/toegankelijkheid van klantcommunicatie (WCAG/EAA)

**Domein:** 08-levering-post

**Trigger:** Niet-Engelstalige EU-klant of klant met schermlezer.

**Flow:**
1. De klant-app is volledig Engels `[CONFIRMED — memory app-language]`; `problemTypes`-berichten, push en QC-communicatie ook.
2. Status via emoji + kleur als enige indicator (bijv. on-hold = oranje) `[CONFIRMED — supplyflow-app.jsx kleur-/emoji-gebaseerde status]`.
3. QC-foto's hebben `alt=""` `[CONFIRMED — r.1672]`.

**Wie betaalt wat:** N.v.t.; compliance-/toegankelijkheidsrisico.

**Wat als het faalt:** Schermlezer leest niets bij de QC-foto's; kleurenblinde mist de hold-status (WCAG-faal: kleur als enige signaal).

**System action:**
- **Betekenisvolle `alt`-teksten** op QC-/orderfoto's.
- Status niet alleen via kleur/emoji maar ook via tekstlabel.
- `[TO-VERIFY]` EU-taaleisen (precontractuele info begrijpelijk); EAA/toegankelijkheid 2025+ voor webwinkels.

---

## A23 — Granulaire notificatie-consent (transactioneel vs marketing)

**Domein:** 14-state-machine-notificaties

**Trigger:** Klant wil verzendupdates wél, marketing niet; of wil alles uit.

**Flow:**
1. `PushToggle` bestaat `[CONFIRMED — PushToggle.jsx, r.1767]`, maar is alles-of-niets.
2. Geen voorkeuren-opslag per type/kanaal; geen unsubscribe-spoor voor `notify-order`-e-mails.

**Wie betaalt wat:** N.v.t.; AVG/e-Privacy-risico (spam-klachten).

**Wat als het faalt:** Klant zet alles uit en mist essentiële order-status, of krijgt ongewenste marketing.

**System action:**
- **Per-kanaal/per-type consent** (transactioneel vs marketing) opslaan; transactioneel altijd toegestaan, marketing opt-in.
- Unsubscribe-link in e-mails.

---

## A24 — Klant eist refund naar bank/kaart i.p.v. saldo

**Domein:** 09-retouren-refunds

**Trigger:** Bij refund zag de klant dat het geld naar zijn in-app SALDO ging; hij eist terugbetaling op de originele kaart/bankrekening.

**Flow:**
1. Alle refund-RPC's storten structureel naar `balance` `[CONFIRMED — refund-order.sql r.34, cancel_paid_order r.43]`.
2. Geen knop/flow waar de klant "betaal terug naar mijn bank" kan kiezen; `/withdraw` bestaat los daarvan (EU-herroeping).

**Wie betaalt wat:** Flowva draagt de Stripe-refund-kost; wettelijk MOET refund naar de originele betaalmethode tenzij de klant uitdrukkelijk instemt met tegoed `[CONFIRMED — consumentenrecht]`.

**Wat als het faalt:** Saldo als stille default zonder klant-keuze = directe non-compliance bij elke refund.

**System action:**
- **Refund-keuze in de UI**: standaard naar originele Stripe-betaalmethode; "tegoed" alleen na expliciete klant-instemming.
- Koppel saldo-refund → optie "vraag uitbetaling naar bank" (verbindt A7 en `/withdraw`).
- `[TO-VERIFY]` Stripe refund op de originele charge (tot 180 dagen) vs aparte payout.

---

## A25 — Partial stock: minder stuks geleverd binnen één SKU

**Domein:** 04-inkoop-leverancier

**Trigger:** Klant bestelt qty 5 van één SKU; de seller levert er 3 (niet sold-out, partial).

**Flow:**
1. `order/detail` toont `poOrderDetails[].originalQuantity` (5) vs `packageQuantity` (3) `[CONFIRMED — order-detail doc: originalQuantity "Original quantity to be ordered" (Required), packageQuantity "Number of submitted parcels" (Required)]`.
2. De code kent geen "partial quantity"-status: `place-bucky-order` ziet `success=true` en zet door op `purchased` `[CONFIRMED — index.ts r.151,169-171]`.
3. Het ontbrekende deel wordt nergens gedetecteerd of (gedeeltelijk) gerefund.

**Wie betaalt wat:** Klant betaalde 5, krijgt 3 → **2 stuks moeten proportioneel terug** naar zijn saldo/bank `[CONFIRMED — wettelijk]`. Bij multi-qty LITHRA-bundels is dit een reëel geld-lek als het niet gebeurt.

**Wat als het faalt:** Geen detectie → klant betaalt te veel, ontvangt te weinig, merkt het pas bij ontvangst.

**System action:**
- **Vergelijk `originalQuantity` vs `packageQuantity` bij order-detail-poll/webhook**; bij verschil → proportionele partial-refund (`refund_order` met aangepast bedrag, of een nieuwe partial-refund-RPC) + meld de klant.
- `[TO-VERIFY]` of `packageQuantity` semantisch "ontvangen stuks" is dan wel "aantal parcels" — de doc-note zegt "Number of submitted parcels", dus de feitelijke geleverde stuks komen mogelijk uit een ander veld (verifieer tegen een echte order-detail-respons).

---

## A26 — `orderStatus 10` (stock-out/outbound) niet gemapt

**Domein:** 05-domestic-china-qc

**Trigger:** Item verlaat fysiek het magazijn (BD `orderStatus 10` = stock-out/outbound).

**Flow:**
1. `PO_STATUS_MAP` springt van `9→qc_pending` direct naar `11→shipped_international` `[CONFIRMED — buckydrop-webhook/index.ts r.32-38: 5,6,9,11,12 gemapt; 10 ontbreekt]`.
2. De outbound-gebeurtenis wordt stil genegeerd (`po 10 (no map)`).
3. Gat tussen QC-goedkeuring en internationaal-onderweg; geen "outbound bevestigd"-toestand.

**Wie betaalt wat:** N.v.t.; audit-trail-gat.

**Wat als het faalt:** Een item dat outbound ging zonder via onze haul-flow te lopen wordt niet gedetecteerd → blinde vlek.

**System action:**
- **Map `orderStatus 10`** naar een eigen tussentoestand (bijv. `outbound`/`leaving_warehouse`) of log+push.
- Detecteer outbound zonder bijbehorende haul-actie als anomalie.

---

## A27 — `resultStatus=0` parcel auto-submission failure

**Domein:** 05-domestic-china-qc

**Trigger:** BuckyDrop dient een parcel automatisch in namens de partner, maar de auto-submit faalt (`resultStatus=0`) zonder dat wij een eigen haul-flow startten.

**Flow:**
1. `resultStatus` = "Parcel auto-submission status 1: success 0: failure" `[CONFIRMED — order-detail doc resultStatus]`.
2. Komt in geen enkel blueprint-scenario voor; de webhook leest `resultStatus` niet.
3. Bij failure hangt de zending zonder dat Flowva het merkt.

**Wie betaalt wat:** Vertraging; opslagklok tikt door → opslagkost voor Flowva `[ASSUMED]`.

**Wat als het faalt:** Order strandt stil tussen domestic en internationaal; klant ziet `qc_pending` blijven hangen.

**System action:**
- **Poll/lees `resultStatus`** bij order-detail; bij `0` → flag voor handmatige haul-indiening + alert.
- `[TO-VERIFY]` of er ook een webhook is die auto-submit-failure pusht, of dat alleen polling dit oppikt.

---

## A28 — `failureType` 1=System vs 2=Business (retry vs refund)

**Domein:** 04-inkoop-leverancier

**Trigger:** BD wijst een create af met een `failureReasonList`.

**Flow:**
1. `failureReasonList[].failureType` = "1.System 2.Business" + `failureContent` `[CONFIRMED — order-detail doc]`.
2. `place-bucky-order` beslist grof: bij `typeof res.code === "number"` → refund; anders → flag-en-retry `[CONFIRMED — index.ts r.151-165]`. Het maakt GEEN onderscheid tussen system- en business-failure.
3. Een tijdelijke SYSTEM-failure kan ten onrechte als definitieve afwijzing + refund worden behandeld (of andersom: een business-failure als retry blijven hangen).

**Wie betaalt wat:** Onterechte refund bij een tijdelijke system-fout = annulering van een order die had kunnen slagen → omzetverlies/klantfrustratie `[ASSUMED]`.

**Wat als het faalt:** Eindeloze retry op een business-failure (seller uitverkocht) zonder refund → order hangt.

**System action:**
- **Onderscheid in de afhandel-beslissing**: `failureType=1` (System) → retry/escalatie met backoff; `failureType=2` (Business, bv. uitverkocht/prijs) → refund + cancel.
- Lees `failureReasonList` uit de order-detail-respons; verfijn de huidige `typeof res.code === number`-heuristiek.

---

## A29 — Multi-product mand → N losse PO's, asynchrone split inbound

**Domein:** 04-inkoop-leverancier

**Trigger:** Eén mand met meerdere verschillende producten van verschillende sellers.

**Flow:**
1. `pay_cart` maakt één order-rij per cart-item `[CONFIRMED — pay-cart.sql loop]`; ze delen wel `request_group_id` (r.91-117).
2. `place-bucky-order` plaatst per order een aparte shop-order → N losse PO's `[CONFIRMED]`.
3. Geen mechanisme dat orders met dezelfde `request_group_id` bij de seller/magazijn als één inbound consolideert vóór QC; ze komen op verschillende dagen binnen.

**Wie betaalt wat:** N losse parcel-fulfilment-fees mogelijk i.p.v. één geconsolideerd pakket → fee-stapeling voor **Flowva** (overlapt A5) `[ASSUMED]`.

**Wat als het faalt:** Split inbound → deel-QC, deels op voorraad wachtend → langere doorlooptijd, partiële levering.

**System action:**
- **Consolideer op `request_group_id`** in de haul-/parcel-flow: wacht tot alle PO's van de groep stock-in (`9`) zijn vóór één internationale parcel.
- Toon de klant een verwachte consolidatie-datum.
- `[TO-VERIFY]` of BD parcels van meerdere PO's binnen één partner kan bundelen tot één internationale zending.

---

## A30 — Seller→magazijn transit-verlies (status blijft 6, nooit 9)

**Domein:** 05-domestic-china-qc

**Trigger:** Seller verzendt naar het magazijn, maar het pakket komt nooit aan (verlies in domestic transit vóór stock-in).

**Flow:**
1. PO blijft op `orderStatus 5/6` (ordered/shipped out) zonder ooit `9` (stock-in) te bereiken `[CONFIRMED — PO orderStatus enum; webhook mapt 6→shipped_local, 9→qc_pending]`.
2. Geen timeout-watchdog die "`shipped_local` maar nooit `qc_pending` na X dagen" detecteert.

**Wie betaalt wat:** **Seller** draagt het domestic-freight-verlies (seller verzond niet aantoonbaar correct) `[ASSUMED]`; Flowva claimt bij de seller via BD-dispute. Klant moet uiteindelijk gerefund of opnieuw ingekocht worden.

**Wat als het faalt:** Zonder watchdog blijft de order stil op `shipped_local` hangen; klant ziet geen progressie.

**System action:**
- **Watchdog/scheduled job**: PO's langer dan X dagen op `shipped_local` zonder `qc_pending` → alert + seller-claim + klant-update.
- Onderscheid van "zoek IN het magazijn na ontvangst" (andere kostenallocatie — daar draagt BD/Flowva).

---

## A31 — "Not as described" maar maat OK en niet defect

**Domein:** 05-domestic-china-qc

**Trigger:** Seller levert het juiste item qua maat, niet defect, maar fysiek afwijkend van foto/omschrijving (kleurverschil, ander materiaal/samenstelling, andere print).

**Flow:**
1. Garment Measurement vangt dit niet (maat klopt); `confirmType='defective'` dekt het niet.
2. Geen QC-classificatie voor "conform maat, niet conform omschrijving/materiaal".

**Wie betaalt wat:** Kernbelofte-risico (transparantie/material-veld); seller-retour of refund nodig, kost-allocatie afhankelijk van wie "fout" is (seller bij not-as-described) `[ASSUMED]`.

**Wat als het faalt:** Item wordt verzonden omdat geen enkele check het ving → klant ontvangt verkeerd materiaal → dispute/chargeback (A14).

**System action:**
- **Derde QC-classificatie "not as described"** (kleur/materiaal/print) naast defect en maatafwijking, met klant-reject (A2) en seller-return (`applyType=1`) als gevolg.
- `[TO-VERIFY]` of `confirmType` méér waarden kent dan "defective" — de doc beschrijft het uitsluitend als "the product is defective" `[CONFIRMED — Notify Po Pending doc: confirmType note = "the product is defective"]`, dus extra waarden zijn niet bevestigd.

---

## A32 — `currency`-veld per order → FX-mismatch op inkoopniveau

**Domein:** 04-inkoop-leverancier

**Trigger:** BD boekt een order in een andere valuta dan CNY.

**Flow:**
1. `order/detail` geeft per order een `currency`-veld terug `[CONFIRMED — order-detail doc: currency "Order Currency"]`.
2. Bij inkoop stuurt `place-bucky-order` `productPrice` in ¥ mee `[CONFIRMED — index.ts r.114,142]`, maar er is geen verificatie dat de PO daadwerkelijk in CNY uit de wallet werd afgerekend.
3. Andere currency → onopgemerkte FX-mismatch op inkoopniveau (los van de bekende verzend-FX-vraag).

**Wie betaalt wat:** FX-verschil komt onbewust bij **Flowva** terecht; reconciliatie wallet↔PO is onmogelijk zonder per-order currency-snapshot `[ASSUMED]`.

**Wat als het faalt:** Boekhouding klopt niet; wallet-saldo (CNY) en PO-bedrag lopen uiteen.

**System action:**
- **Snapshot `currency` + `actualAmount` per PO** bij order-detail; reconcileer tegen de CNY-wallet-afschrijving.
- Alarmeer als `currency != CNY`.

---

## A33 — Seller-retourvenster verloopt tijdens BD-opslag

**Domein:** 05-domestic-china-qc

**Trigger:** Item ligt na stock-in te lang in BD-opslag (op consolidatie/Friends-groep) en de Taobao/1688-retourtermijn verstrijkt; later blijkt bij QC/levering een defect.

**Flow:**
1. BD-opslagkosten (≈30 dagen gratis) lopen los van het onafhankelijk doorlopende SELLER-retourvenster `[ASSUMED — opslagtermijn uit briefing; seller-venster platform-afhankelijk]`.
2. Verstrijkt het seller-venster tijdens opslag, dan is `order/return` (apply-return naar de leverancier) niet meer mogelijk.

**Wie betaalt wat:** Flowva kan het verlies niet meer bij de bron terughalen → **afschrijven**. Bepaalt of het verlies recupereerbaar is `[ASSUMED]`.

**Wat als het faalt:** Dead stock + onverhaalbaar verlies + doorlopende opslagkosten.

**System action:**
- **Bewaak het seller-retourvenster per PO** (start = aankoopdatum); waarschuw vóór het venster sluit als een item nog in opslag wacht → forceer QC/beslissing.
- `[TO-VERIFY]` of BD het seller-retourvenster exposet; mogelijk handmatig per platform inschatten.

---

## A34 — Partiële `quantity` binnen één SKU bij apply-return

**Domein:** 04-inkoop-leverancier

**Trigger:** Multi-qty SKU (5 stuks van één maat), waarvan er 2 defect zijn (3 goed) volgens Notify Po Pending.

**Flow:**
1. `order/return` (apply-return) `skuList[].quantity` laat partieel retourneren toe `[CONFIRMED — Return Application doc: skuList[].skuCode + quantity, beide Required, "quantity of product to be returned"]`.
2. Maar het defect-pad zet alleen `dispute_status='pending'` op de HELE order `[CONFIRMED — buckydrop-webhook r.116-118]`; geen vertaling naar een apply-return met de juiste quantity + proportionele refund.

**Wie betaalt wat:** 2 defecte stuks → seller-return van 2 + proportionele refund van 2 naar de klant; 3 goede stuks gaan door `[CONFIRMED — wettelijk proportioneel]`.

**Wat als het faalt:** Hele order op hold terwijl 3 stuks prima zijn → onnodige vertraging; of geen partial-refund → klant betaalt voor 2 defecte stuks.

**System action:**
- **Partial-return-flow**: bij partieel defect → `order/return` met `skuList[].quantity` = aantal defect + proportionele partial-refund + laat de goede stuks doorlopen.
- Concreet relevant bij LITHRA-bundels met meerdere stuks van één maat.

---

## A35 — Seller-rang/kwaliteitssignaal vóór auto-inkoop

**Domein:** 04-inkoop-leverancier

**Trigger:** Een lage-rang Taobao-marktplaatsseller (hoog annulerings-/namaakrisico) wordt automatisch ingekocht.

**Flow:**
1. `place-bucky-order` koopt blind elke gekoppelde SKU `[CONFIRMED — index.ts: geen seller-rang-check]`.
2. Geen proactieve poort die betrouwbaarheid meeweegt (top-rang Tmall/1688-gecertificeerd vs lage-rang).

**Wie betaalt wat:** Hoger annulering-/defect-risico → meer refunds/disputes → indirect kost voor **Flowva** `[ASSUMED]`.

**Wat als het faalt:** Lage-rang seller annuleert/levert namaak → reputatieschade + retourkost.

**System action:**
- **Risico-poort vóór auto-inkoop**: bij lage-rang seller → niet blind auto-kopen / extra QC (reinforcement, extra foto's) afdwingen / handmatige review.
- `[TO-VERIFY]` welk BD/product-veld seller-rang signaleert (verifieer product-detail-velden; staat niet vast in de gelezen code).

---

## A36 — MOQ/`beginCount` blijkt pas bij plaatsing (post-pay)

**Domein:** 04-inkoop-leverancier

**Trigger:** Seller hanteert een minimum-bestelhoeveelheid die pas BLIJKT bij plaatsing; klant betaalde voor 1 stuk.

**Flow:**
1. Create faalt of komt terug als `orderStatus 4` omdat de bestelde qty onder het seller-minimum ligt `[ASSUMED — geen MOQ-specifieke code; blueprint [04] markeert MOQ als TO-VERIFY]`.
2. Geen detectie dat dit MOQ is (versus gewone sold-out), en geen flow die de klant refundt of bijbestelt.

**Wie betaalt wat:** Of de klant wordt gerefund (1 stuk te weinig om MOQ te halen), of Flowva koopt de MOQ in en houdt de rest als voorraad (kapitaal-/voorraadrisico) `[ASSUMED]`. Relevant juist voor losse goedkope items.

**Wat als het faalt:** Order strandt op 4 (A43) zonder MOQ-classificatie → permanent gestrand.

**System action:**
- **Detecteer MOQ-failure** (uit `failureContent`/`failureReasonList`) en bied de keuze refund-vs-stock-buy.
- Curatie-tijd: lees MOQ/`beginCount` uit product-detail en blokkeer qty < MOQ vóór checkout.
- `[TO-VERIFY]` of een MOQ-/beginCount-veld in de product-API zit.

---

## A37 — `orderStatus 7` (received/signed) niet gemapt

**Domein:** 05-domestic-china-qc

**Trigger:** PO bereikt `orderStatus 7` (received/signed, met `signTime`) — pakket getekend voor ontvangst maar nog niet stock-in.

**Flow:**
1. De webhook mapt puur op `orderStatus`-getal en negeert `notifyType` `[CONFIRMED — buckydrop-webhook leest poStatus, niet notifyType]`.
2. `7` staat NIET in `PO_STATUS_MAP` (alleen 5,6,9,11,12) `[CONFIRMED — index.ts r.32-38]` → geen app-actie.
3. Geen tussentoestand "received maar nog niet stock-in" (7 vs 9).

**Wie betaalt wat:** N.v.t.; audit-trail-gat tussen aankomst en QC.

**Wat als het faalt:** Klant ziet geen "aangekomen bij magazijn"-moment; gat in de domestic-keten.

**System action:**
- **Map `orderStatus 7`** naar een tussentoestand (bijv. `received_warehouse`) of log+push.
- `[TO-VERIFY]` betekenis van `notifyType` (doc zegt alleen "1-PO arrives at warehouse" — meer waarden niet bevestigd) en of het naast `orderStatus` extra signaal geeft.

---

## A38 — Seller weigert seller-side retour → CN dead stock

**Domein:** 04-inkoop-leverancier

**Trigger:** Een lage-rang seller accepteert geen retour terwijl Flowva het item al heeft afgekeurd; item blijft fysiek in het CN-magazijn.

**Flow:**
1. `order/return` apply geweigerd (return-status of refund fails) `[CONFIRMED — Return Details Query: status 1=cancelled, refundStatus 4=refund fails]`.
2. Geen beslisflow "seller weigert → afschrijven vs lokaal doorverkopen/vernietigen vs alsnog naar klant".
3. BD-opslagklok tikt door op niet-recupereerbare voorraad.

**Wie betaalt wat:** **Flowva** schrijft af (seller-verlies niet verhaalbaar) + draagt opslagkosten tot beslissing `[ASSUMED]`.

**Wat als het faalt:** Dead stock stapelt op + opslagkosten lopen op.

**System action:**
- **Dead-stock-beslisflow** bij seller-weigering: write-off / lokaal doorverkopen / vernietigen / alsnog naar klant sturen — met opslagklok-deadline.
- Koppel aan A33 (retourvenster) en A35 (seller-rang als oorzaak).

---

## A39 — Out-of-order defect-webhook ná `shipped_international`

**Domein:** 05-domestic-china-qc

**Trigger:** Een vertraagde "Notify Po Pending" (defect) arriveert nadat de order al `shipped_international` is.

**Flow:**
1. De RANK-guard beschermt alleen de status-velden tegen terugzetten `[CONFIRMED — buckydrop-webhook r.47-56: RANK op status]`.
2. `dispute_status='pending'` + `problem_type` worden ZONDER rank-guard gezet `[CONFIRMED — r.116-119: directe update, geen status-rank-check]`.
3. → defect-hold op een al-verzonden order die niemand meer kan stoppen (dode hold).

**Wie betaalt wat:** Item is al onderweg; retour ná internationale verzending = duurste retour `[ASSUMED]`.

**Wat als het faalt:** Inconsistente staat: defect-hold op iets dat het magazijn al verliet → verwarrende order-kaart.

**System action:**
- **Rank-guard ook op `dispute_status`**: een defect-melding op een order die al ≥ `shipped_international` is, mag geen pre-shipment hold leggen maar een POST-shipment retour-pad openen.
- Detecteer en route out-of-order defect-signalen naar de retour-flow i.p.v. de QC-hold.

---

## A40 — Variant-string-match breekt (seller wijzigt `productProps`)

**Domein:** 04-inkoop-leverancier

**Trigger:** Seller wijzigt de prop-naam/structuur sinds curatie, of er is een accent-/spatie-/hoofdletterverschil.

**Flow:**
1. `pickSku` matcht via exacte string-gelijkheid: `s.props.every(p => want[p.name] === p.value)` `[CONFIRMED — index.ts r.62-73]`.
2. Geen match → `place-bucky-order` faalt met `Kon variant niet matchen: "${order.kleur}"` NÁ betaling `[CONFIRMED — index.ts r.113]`.
3. Geen fallback en geen detectie dat de seller de variant-structuur veranderde.

**Wie betaalt wat:** Order ligt dood op `bd_error`; klant betaalde al → moet gerefund of handmatig opgelost `[ASSUMED]`.

**Wat als het faalt:** Stille stilstand op `bd_error` tot een mens ingrijpt.

**System action:**
- **Robuustere variant-match**: trim/lowercase/accent-normalisatie; fallback op skuCode/positie; bij geen match → flag voor handmatige koppeling i.p.v. harde fail.
- Variant-change-guard (analoog aan price-change-guard) die seller-`productProps`-wijzigingen detecteert bij checkout.

---

## A41 — Item niet veilig internationaal verzendbaar zoals geleverd

**Domein:** 05-domestic-china-qc

**Trigger:** Seller levert het juiste item maar in verkeerde/ontbrekende transport-verpakking (glas/vloeistof/parfum zonder transport-proof packaging), blijkt pas bij outbound/QC.

**Flow:**
1. Reinforcement (versterkte verpakking) is een value-added KEUZE, geen risico-getriggerde verplichting `[ASSUMED — reinforcement uit briefing als optie]`.
2. Geen detectie/beslisflow die bepaalt wanneer reinforcement VERPLICHT is op basis van producttype, of wat te doen als het item niet veilig verzendbaar is.

**Wie betaalt wat:** Reinforcement-kost (≈value-added service) bovenop de order; wie draagt dat — Flowva als ops-keuze, of doorbelast `[ASSUMED]`. Bij niet-verzendbaar → refund/annulering.

**Wat als het faalt:** Item breekt/lekt in transit → totaalverlies + mogelijk carrier-/douaneprobleem.

**System action:**
- **Producttype-getriggerde reinforcement-verplichting** (categorie "breekbaar/vloeistof" → reinforcement aan via My Services / Service Preselection).
- Beslisflow "niet veilig verzendbaar zoals geleverd" → reinforcement of refund.
- Relevant voor LITHRA-uitbreiding buiten apparel.

---

## A42 — Dubbele `source_url` → verkeerde product-rij gekozen bij inkoop

**Domein:** 04-inkoop-leverancier

**Trigger:** Twee verschillende Flowva-producten delen dezelfde `source_url`.

**Flow:**
1. `place-bucky-order` selecteert via `.eq('source_url', ...).limit(5)` en kiest met heuristiek: eerst een rij mét `spu_code` + niet-lege `bd_skus`, anders `[0]` `[CONFIRMED — index.ts r.97-105]`.
2. Bij dubbele `source_url` kan de VERKEERDE rij (verkeerde spu_code/bd_skus/prijs) gekozen worden → seller-order met afwijkende SKU/prijs dan wat de klant kocht.

**Wie betaalt wat:** Verkeerd item ingekocht/verzonden → retour + her-inkoop kost (Flowva-systeemfout) `[ASSUMED]`.

**Wat als het faalt:** Klant ontvangt het verkeerde product → dispute (A14).

**System action:**
- **Unieke `source_url` afdwingen** (DB-constraint) of de order direct aan een `product_id`/`spu_code` koppelen i.p.v. via `source_url` te zoeken (snapshot, A1/A4).
- Bij curatie: blokkeer een tweede product met een bestaande `source_url`.

---

## A43 — Supplement (orderStatus 4) zonder confirm/pay-endpoint → gestrande PO

**Domein:** 05-domestic-china-qc

**Trigger:** PO komt terug als `orderStatus 4` (to be confirmed incl. supplementary payment), bijv. door zwaarder pakket of hogere seller-prijs (A8).

**Flow:**
1. `4` = "to be confirmed (including supplementary payment)" `[CONFIRMED — order-detail doc]`.
2. Er is GEEN confirm/supplement-betaal-endpoint in de gelezen docs: de Order-sectie kent alleen Create, Details Query, Cancel Shop Order, Cancel Purchase Order, Return Application, Return Details Query `[CONFIRMED — order folder index]`; geen "confirm" of "pay supplement".
3. Zelfs als Flowva het supplement uit de wallet wil betalen, is onbekend HOE de PO ontgrendeld wordt.

**Wie betaalt wat:** Supplement zou uit de CNY-wallet komen, maar zonder endpoint kan het niet via API → PO blijft op 4, opslagklok tikt door, uiteindelijk gedwongen annulering (`order/shop-order/cancel`) + refund naar de klant.

**Wat als het faalt:** Meest concrete stille-stilstand-faalmodus: permanent gestrande PO + doorlopende opslagkosten + gedwongen refund.

**System action:**
- **`[TO-VERIFY]` — vind het confirm/supplement-pay-endpoint** (mogelijk alleen via het BuckyDrop-dashboard, niet via Solution API). Verifieer bij agent Vera / in het dashboard.
- Tot dat helder is: detecteer `orderStatus 4` → alert ops + meld de klant + bied annuleren+refund als het supplement niet betaalbaar is via API.
- Verbind met A8 (oorzaak prijs) en A44/verzending (oorzaak gewicht).

---

## A44 — Adres-desync tussen PO-create en haul-quote (cross-moment)

**Domein:** 07-internationale-verzending

**Trigger:** Klant wijzigt zijn adres tussen het koopmoment (PO-create) en het verzendmoment (haul-quote, weken later).

**Flow:**
1. `place-bucky-order` bevriest het VOLLEDIGE bezorgadres in de shop-order-create-body op het koopmoment `[CONFIRMED — index.ts r.124-148: country/province/city/detailAddress/postCode/contactName/contactPhone uit user_metadata op dat moment]`.
2. De internationale verzending wordt pas later in `haul-shipping` ge-quote't tegen het ACTUELE `user_metadata`-adres `[CONFIRMED — haul-shipping/index.ts r.116: addressOf(user.user_metadata), leest live, niet uit de order]`.
3. Wijzigt de klant het adres ertussenin, dan draagt de PB-PO nog het OUDE adres terwijl de quote/zone op het NIEUWE adres is gebaseerd.
4. **Extra bug**: `haul-shipping` hardcodeert bovendien `countryCode: "NL"` in de quote-body `[CONFIRMED — haul-shipping/index.ts r.47]` → de verzendzone wordt ALTIJD als NL berekend, ongeacht het werkelijke land (zelfde klasse als de NL-fallback in A9, maar nu in de verzend-quote).
5. Er is GEEN BD-API om het eindadres van een bestaande PO te updaten — `order/delivery/update` wijzigt alleen domestic inbound-tracking, niet de eindbestemming `[CONFIRMED — logistics "Supplement Domestic Logistics" doc: deliveryCode/deliveryName/deliveryNo]`.

**Wie betaalt wat:** Pakket gaat naar het oude adres → her-verzending (Flowva), of de betaalde verzendzone klopt niet met de werkelijke bestemming → verzend-supplement/refund-mismatch. Door de hardcoded `NL`-zone (stap 4) betaalt elke niet-NL-klant sowieso een NL-zone-quote i.p.v. zijn echte zone `[CONFIRMED — haul-shipping r.47]`.

**Wat als het faalt:** Twee gescheiden geldmomenten met onafhankelijke adresbronnen = structureel bezorgrisico; raakt A1 (zelfde root cause: geen adres-snapshot-invariant over de hele order-levensduur).

**System action:**
- **Eén adres-snapshot voor de hele order-levensduur** (zelfde kolommen voor PO-create én haul-quote), bevroren in `pay_cart` (A1). Haul-quote MOET het order-snapshot-adres gebruiken, niet het live `user_metadata`-adres.
- Bij adreswijziging op een order die al een PO heeft maar nog niet verzonden is: ops-flow om de PO te annuleren+herplaatsen of (indien mogelijk) het adres te corrigeren — `[TO-VERIFY]` of dat überhaupt kan vóór outbound.

---

## Samenvattende open vragen (geconsolideerd, [TO-VERIFY])

1. **Adres-snapshot-invariant** (A1/A19/A20/A44): bevries het bezorgadres in `pay_cart`; laat zowel `place-bucky-order` als `haul-shipping` uit de order lezen, niet uit `user_metadata`.
2. **Supplement/confirm-endpoint** (A8/A43): bestaat er een API om `orderStatus 4` te confirmen/betalen, of alleen via het dashboard? Verifieer bij agent Vera.
3. **Stripe-events** (A3/A14/A24): welke events handelt `stripe-webhook` af (expired/async_failed/dispute/refund)? Verifieer de switch.
4. **Carrier/kanaal-veld** (A18): welk BD-parcel-veld geeft de echte koerier + tracking-URL?
5. **`packageQuantity`-semantiek** (A25): is dat "ontvangen stuks" of "aantal parcels"? Welk veld geeft feitelijk geleverde stuks?
6. **`confirmType`-enum** (A2/A31): kent het méér waarden dan "defective"?
7. **`notifyType`-waarden** (A37): meer dan "1-PO arrives at warehouse"?
8. **Seller-rang-/MOQ-velden** (A35/A36): exposet de product-API rang of `beginCount`/MOQ?
9. **e-money-kwalificatie** van de herlaadbare wallet (A7/A17): juridisch advies nodig.
