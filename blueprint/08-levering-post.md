# 08 — Levering en post-levering

Deze sectie dekt UITPUTTEND de laatste fase van de keten: vanaf het moment dat het internationale pakket de klant nadert tot lang na bezorging (claims, herroeping, garantie, fraude). Per scenario: trigger, stap-voor-stap-flow, wie betaalt wat, de volgende laag edge-cases ("wat als het faalt"), en de concrete system action (BuckyDrop API-call, app-status/RPC). Elke bewering is getagd: **[CONFIRMED]** (uit docs/code/wet), **[ASSUMED]** (redelijke aanname), **[TO-VERIFY]** (moet gecheckt — met HOE/waar).

## 0. Statusfundament (waarop alles hieronder rust)

- **App-statussen levering:** `shipped_international` → `delivered`. Eindstatus `delivered` wordt gezet door twee paden in `buckydrop-webhook/index.ts`: PO `orderStatus 12` (fulfilled) en parcel `pkgNormalStatus 4` (delivered). [CONFIRMED — code regels 32-44]
- **Parcel `packageStatus` (1-10):** 6=Delivered, 7=To be confirmed received, 8=Domestic returned, 9=Foreign returned, 10=Cancelled. [CONFIRMED — parcel detail doc]
- **Parcel `pkgNormalStatus` (1-5):** 1=to be shipped, 2=shipped out, 3=to be delivered, 4=delivered, 5=cancelled. [CONFIRMED — parcel detail + Notify Parcel Status doc]
- **Parcel `pkgAbnormalStatus` (0-3):** 0=Normal, 1=To be returned, 2=Returned, 3=Cancelled — dit is het kanaal voor afwijkende pakketten (return/abnormaal). [CONFIRMED — parcel detail doc]
- **Proof of delivery (POD):** parcel detail levert `signStatus` (1=Not signed, 2=Signed), `signTime`, `finishTime` (delivered), `deliveryTime` (handoff aan koerier), `channelName` (vervoerder), `turnOrder` (forwarding/tracking-nummer). Dit is het bewijsmateriaal bij elk niet-ontvangen-dispuut. [CONFIRMED — parcel detail doc]
- **Webhooks:** Notify Po Status (`notifyType`/PO `orderStatus`), Notify Parcel Status (`pkgNormalStatus`/`packageStatus`/`outboundTime`/`deliveryTime`/`partnerOrderNoList`), Notify Po Pending (`confirmType`=defect + `picList`=inspectiefoto's, beide Required → bij defect komt de foto gegarandeerd mee). Alle MD5-signed. [CONFIRMED — notification docs + webhook code regels 19-29]
- **Refund-RPC's:** `refund_order(p_order_id,p_reason)` (alleen service_role) en `cancel_paid_order(p_order_id)` (alleen owner, alleen fase `quote_accepted`). **Beide refunden naar `profiles.balance` (in-app saldo), NIET naar Stripe.** [CONFIRMED — refund-order.sql r.34, auto-refund.sql r.43] → **wettelijk lek, zie §13.**
- **Bekende lacune in webhook:** `buckydrop-webhook` mapt GEEN parcel `packageStatus` 7/8/9 en geen `pkgAbnormalStatus`. Retour-/abnormaal-events worden NIET automatisch verwerkt; ze belanden alleen rauw in `bucky_notifications`. [CONFIRMED — code: PKG_STATUS_MAP dekt enkel pkgNormalStatus 2/3/4]

---

## 1. Geleverd OK (happy path)

**Trigger:** Vervoerder bezorgt; BuckyDrop stuurt Notify Parcel Status met `pkgNormalStatus 4` (delivered) en/of PO `orderStatus 11→12`; parcel detail krijgt `signStatus 2` + `signTime` + `finishTime`. [CONFIRMED]

**Flow:**
1. Webhook ontvangt event, verifieert MD5-sign, mapt `pkgNormalStatus 4` → app-status `delivered` voor elke `partnerOrderNoList`-id. [CONFIRMED — code r.93-98]
2. `setOrderStatus` zet alleen vooruit (RANK-guard, `delivered`=6), nooit terug; geannuleerde orders blijven `cancelled`. [CONFIRMED — code r.52-59]
3. Order-update triggert push-notificatie "Delivered" naar de klant (PWA Web Push). [ASSUMED — notify-order/push gekoppeld aan status-wijziging; exacte trigger TO-VERIFY in notify-order]
4. De 14-dagen-herroepingstermijn start NU (dag van ontvangst, niet besteldag). [CONFIRMED — wet + ReturnsPage §2]

**Wie betaalt wat:** Niets extra. Productprijs + 8% fee (min €5) + verzending (DDP, BTW inbegrepen) zijn al bij checkout betaald. QC-pakket (~¥6) zat in de orderkosten. [CONFIRMED — kernmodel]

**Wat als het faalt:**
- Webhook komt niet binnen (BuckyDrop down / sign-mismatch) → order blijft hangen op `shipped_international`. Mitigatie: periodieke poll van parcel detail (`signStatus`/`finishTime`) als fallback. [ASSUMED] → polling-cron is [TO-VERIFY: bestaat nog niet in code].
- Out-of-order webhook (delivered vóór shipped) → RANK-guard voorkomt status-terugval, maar een te late "delivered" wordt nog steeds correct gezet. [CONFIRMED — RANK r.47-50]
- Dubbele webhook (idempotentie) → `setOrderStatus` geeft "no forward" als status al ≥ doel; veilig. [CONFIRMED — r.56]

**System action:** webhook → `setOrderStatus(oid,'delivered')`; geen API-call nodig. POD opvraagbaar via parcel detail `api/rest/v2/adapt/adaptation/pkg/detail`. [CONFIRMED]

---

## 2. NIET geleverd — pakket kwijt onderweg (carrier-claim)

**Trigger:** Tracking blijft hangen (geen `pkgNormalStatus 4`, geen `signTime`) ruim voorbij de geschatte levertijd; of vervoerder markeert "lost". Klant meldt niet-ontvangen via support of `/withdraw`. [ASSUMED]

**Flow:**
1. Support haalt parcel detail op: `signStatus`, `finishTime`, `channelName`, `turnOrder`, `packageStatus`. Als `signStatus`≠2 en geen `finishTime` → pakket niet bezorgd. [CONFIRMED — velden bestaan]
2. Flowva opent een vervoerders-claim via BuckyDrop (de partij met de carrier-relatie). [ASSUMED — geen "lost parcel claim"-endpoint in de gelezen docs] → [TO-VERIFY: bestaat er een claim/after-sales-API? Checken in volledige BuckyDrop-docs of via agent Vera; nu vermoedelijk handmatig in BuckyDrop-portaal.]
3. Tot uitkomst claim: order op `dispute_status='pending'`, klant geïnformeerd over onderzoekstermijn. [ASSUMED]
4. Bevestigd kwijt → herzending OF refund.

**Wie betaalt wat:** Pakket kwijt = vervoerdersrisico vóór bezorging; **Flowva draagt het risico richting de klant** (klant heeft niets ontvangen → recht op nakoming of refund). Flowva verhaalt op de vervoerder/BuckyDrop-verzekering. Klant betaalt niets. [CONFIRMED — wet: risico ligt bij verkoper tot bezorging] 

**Wat als het faalt:**
- Carrier wijst claim af (geen bewijs) → Flowva neemt verlies, refundt/herzendt klant toch (klantrelatie + wet). [ASSUMED]
- Geschil "echt kwijt vs. tracking zegt delivered" → zie §10 (delivered-maar-klant-claimt-niet-ontvangen).
- Herzending faalt opnieuw → over op volledige refund.

**System action:** parcel detail query (POD-check); refund via `refund_order` RPC (→ saldo; **moet Stripe worden, §13**); herzending = nieuwe `place-bucky-order`. Carrier-claim zelf = [TO-VERIFY] endpoint/portaal. [CONFIRMED RPC / TO-VERIFY claim-API]

---

## 3. Geleverd MAAR beschadigd (transportschade, zichtbaar bij ontvangst)

**Trigger:** Klant ontvangt pakket, meldt transportschade (gebroken/verkreukeld/nat) binnen redelijke termijn, met foto's. [ASSUMED]

**Flow:**
1. Klant uploadt schadefoto's via support/returns-flow. [ASSUMED — uploadkanaal TO-VERIFY in app]
2. Flowva vergelijkt met QC-bewijs: het verplichte QC-pakket (Standard Product Photos + Garment Measurement) bewijst dat het item ONbeschadigd verzonden is → schade = transport. [CONFIRMED — QC-pakket verplicht per order; foto's via `qc_images` op order]
3. Schuld bij vervoerder → Flowva claimt bij vervoerder/BuckyDrop én biedt klant direct herstel/vervanging/refund. [ASSUMED claim-route]
4. Beschadigd = "niet conform" → valt onder faulty-items, niet onder de 14-dagen-herroeping. [CONFIRMED — ReturnsPage §10]

**Wie betaalt wat:** Flowva betaalt retour + vervanging/refund (faulty item). Klant betaalt niets, ook geen retourzending. [CONFIRMED — ReturnsPage §10 "we cover the return cost"]

**Wat als het faalt:**
- Discussie schade vooraf vs. transport → QC-foto's zijn doorslaggevend bewijs. [CONFIRMED — transparantietroef]
- Vervanging ook beschadigd → tweede vervanging of volledige refund.
- Klant wil houden met korte korting i.p.v. retour → partiële refund/compensatie als goedkoper dan retour-logistiek. [ASSUMED — commerciële keuze]

**System action:** `qc_images` op order (al gevuld door webhook); refund via `refund_order` (→ **Stripe vereist, §13**); vervanging via nieuwe `place-bucky-order`. [CONFIRMED]

---

## 4. EU 14-dagen herroeping (zonder reden, item OK)

**Trigger:** Klant bedenkt zich binnen 14 dagen na ONTVANGST (of al vóór ontvangst), zonder reden. Dient in via `/withdraw` (geen login nodig: naam + ordernummer + e-mail + optionele reden). [CONFIRMED — WithdrawalPage.jsx]

**Flow:**
1. `/withdraw`-formulier → edge function `withdrawal-request` (logt + bevestigingsmail). [CONFIRMED — WithdrawalPage r.21]
2. Klant krijgt automatische bevestiging + 14 dagen om terug te sturen naar het **NL-retouradres** (nooit naar China). [CONFIRMED — ReturnsPage §3/§5]
3. Item retour ontvangen + gecontroleerd op staat (ongedragen, labels, verpakking). [CONFIRMED — ReturnsPage §6]
4. Refund binnen 14 dagen na ontvangst retour (of bewijs van verzending). [CONFIRMED — ReturnsPage §7]

**Wie betaalt wat:**
- **Retourverzending: klant betaalt** (tenzij faulty). [CONFIRMED — WithdrawalPage r.55, ReturnsPage §5]
- **Refundbedrag:** partieel (klant houdt deel) = alleen productprijs van geretourneerde item(s), verzending NIET terug; volledige herroeping = productprijs + standaard uitgaande verzendkost. [CONFIRMED — ReturnsPage §4]
- **Waardevermindering:** refund mag verlaagd worden bij gebruik voorbij inspectie. [CONFIRMED — ReturnsPage §6, wet]

**Wat als het faalt:**
- Item komt gedragen/zonder labels terug → refund verlaagd of geweigerd; klant informeren met QC-foto's als referentie. [CONFIRMED — §6]
- Herroeping vóór verzending uit China → annuleren zonder kosten, volledige refund (zie §8 cancel-during-fulfilment). [CONFIRMED — ReturnsPage §8]
- Klant stuurt per ongeluk naar China i.p.v. NL → hoge kosten/zoekgeraakt; daarom retouradres prominent. [ASSUMED]
- Uitgesloten categorie (custom/verzegelde hygiëne ontzegeld/perishable) → geen herroepingsrecht. [CONFIRMED — ReturnsPage §9]
- **Refund gaat nu naar saldo i.p.v. Stripe** → wettelijk fout, §13. [CONFIRMED]

**System action:** `withdrawal-request` edge function (log+mail); retour-registratie + refund. Refund-route BuckyDrop apply-return → `returnFlowCode` is [TO-VERIFY: geen apply-return-doc in de gelezen PNG-set; checken in volledige order/after-sales-docs]. App-refund via `refund_order` (→ **Stripe vereist**). [CONFIRMED app-deel / TO-VERIFY BD-deel]

---

## 5. FOUT item ontvangen (verkeerd product/maat/kleur t.o.v. bestelling)

**Trigger:** Klant ontvangt ander artikel dan besteld (verkeerde SKU/maat/kleur). [ASSUMED]

**Flow:**
1. Klant meldt + foto. Flowva vergelijkt met QC-bewijs: Garment Measurement Service (¥4/SKU) en Standard Product Photos zijn vóór verzending gemaakt → tonen of de FOUT al bij seller/QC zat of bij verzending. [CONFIRMED — QC verplicht per order]
2. Mismatch tussen besteld en QC-gemeten/-gefotografeerd → fout ligt bij seller/sourcing → faulty-route. [CONFIRMED]
3. Flowva regelt gratis retour + correcte herzending of refund. [CONFIRMED — ReturnsPage §10 "not as described"]

**Wie betaalt wat:** Flowva betaalt retour + herzending (fout ligt niet bij klant). Klant betaalt niets. [CONFIRMED — §10]

**Wat als het faalt:**
- QC-foto's tonen dat het JUISTE item verzonden is (klant vergist zich / claim onterecht) → afhandelen als dispuut/mogelijke fraude (§10). [CONFIRMED — QC = bewijs]
- "Minor variations from supplier photos" (kleurnuance, kleine afwijking) = GEEN defect. [CONFIRMED — ReturnsPage §10]
- Correcte herzending opnieuw fout (seller-probleem) → refund i.p.v. derde poging; seller flaggen. [ASSUMED]

**System action:** `qc_images` op order als bewijs; herzending = nieuwe `place-bucky-order`; refund = `refund_order` (→ **Stripe vereist, §13**). Defect-melding kan ook via Notify Po Pending binnenkomen (`confirmType` + `picList`) → webhook zet `dispute_status='pending'` + `problem_type`. [CONFIRMED — webhook r.108-114]

---

## 6. DEFECT na levering (non-conformiteit / wettelijke garantie 2 jaar)

**Trigger:** Item gaat binnen redelijke termijn (NL: conformiteit, in praktijk tot 2 jaar) stuk/vertoont gebrek dat al bij levering latent aanwezig was. Klant meldt ná de 14-dagen-herroeping. [CONFIRMED — wet]

**Flow:**
1. Klant meldt defect + foto/omschrijving. [ASSUMED]
2. Flowva beoordeelt non-conformiteit (geen normale slijtage). QC-foto's documenteren beginstaat. [CONFIRMED — QC]
3. Remedie-ladder: herstel of vervanging; als dat niet kan/proportioneel is → (gedeeltelijke) refund/ontbinding. [CONFIRMED — wet]

**Wie betaalt wat:** Binnen wettelijke conformiteitstermijn draagt **Flowva** kosten van herstel/vervanging incl. verzending. Eerste ~jaar: bewijslast bij verkoper (gebrek vermoed aanwezig bij levering). [CONFIRMED — EU/NL consumentenwet] Daarna kan bewijslast verschuiven naar klant. [ASSUMED — afhankelijk van casus]

**Wat als het faalt:**
- Normale slijtage / misbruik → geen garantie; klant betaalt. [CONFIRMED — wet]
- Item al uit BuckyDrop-retourvenster → retour naar seller in China niet meer mogelijk; Flowva neemt verlies, schikt met klant. [ASSUMED — BuckyDrop after-sales-venster TO-VERIFY]
- Herhaald defect zelfde product → seller/product flaggen, uit assortiment. [ASSUMED]

**System action:** dispuut-record op order; refund/credit via `refund_order` (→ **Stripe vereist, §13**) of vervanging via `place-bucky-order`. BuckyDrop after-sales/return-window = [TO-VERIFY in after-sales-docs]. [CONFIRMED app-deel]

---

## 7. Klant niet thuis / weigert het pakket

**Trigger:** Vervoerder kan niet bezorgen (niemand thuis) of klant weigert pakket bij de deur. Tracking toont failed delivery / refused; `signStatus` blijft 1; mogelijk `pkgAbnormalStatus`→1 (to be returned) of `packageStatus`→9 (foreign returned). [ASSUMED status-mapping; pkgAbnormalStatus/packageStatus 9 bestaan CONFIRMED]

**Flow:**
1. **Niet thuis:** vervoerder probeert opnieuw of plaatst in afhaalpunt (§9). [ASSUMED — carrier-afhankelijk]
2. **Geweigerd / max. pogingen op:** pakket gaat retour (afzender = BuckyDrop/forwarder). [ASSUMED]
3. Flowva detecteert via Notify Parcel Status (return-status) of parcel detail (`pkgAbnormalStatus`/`returnTime`). [CONFIRMED — velden bestaan; **let op: webhook mapt deze NIET, §0**]

**Wie betaalt wat:**
- Weigering zonder geldige reden = de facto herroeping → behandeld als §4: klant draagt retour/verzendkosten conform herroepingsregels; productprijs terug. [CONFIRMED — herroepingsregime]
- Niet-thuis met herbezorging/afhaalpunt = geen extra kosten als normaal carrier-proces. [ASSUMED]
- Retour-naar-afzender-kosten internationaal kunnen hoog zijn → afgetrokken/verrekend binnen wettelijke grenzen. [ASSUMED]

**Wat als het faalt:**
- Pakket geretourneerd en niet meer te traceren → behandelen als kwijt (§2). [ASSUMED]
- Klant wil alsnog ontvangen → herbezorging tegen verzendkosten. [ASSUMED]
- Webhook negeert return-status → order blijft hangen op `shipped_international`; vereist handmatige check of nieuwe webhook-mapping. [CONFIRMED — gap §0]

**System action:** parcel detail poll op `pkgAbnormalStatus`/`returnTime`; handmatige statusafhandeling tot webhook-mapping voor `packageStatus` 8/9 + `pkgAbnormalStatus` is toegevoegd ([TO-DO/TO-VERIFY in webhook]); refund via `refund_order`. [CONFIRMED gap]

---

## 8. Annuleren tijdens fulfilment (vóór bezorging)

**Trigger:** Klant annuleert ná betaling maar vóór bezorging. [CONFIRMED]

**Flow / wie betaalt:**
- **Vóór inkoop item** (`quote_accepted`, item nog niet gekocht): annuleren kost niets, volledige refund. RPC `cancel_paid_order` — alleen owner, alleen fase `quote_accepted`, en alleen als agent een `problem_type` meldde; refundt `price`/`quoted_total` naar saldo + `cancelled`. [CONFIRMED — auto-refund.sql]
  - **Edge:** zonder gemeld `problem_type` weigert de RPC ("alleen als je agent een probleem heeft gemeld") → klant-geïnitieerde annulering zonder agentprobleem valt NIET onder deze RPC; vereist support-pad. [CONFIRMED — auto-refund.sql r.36-38] → [TO-VERIFY: aparte klant-annuleer-RPC nodig?]
- **Na verzending:** behandeld als return → klant stuurt naar NL-adres. [CONFIRMED — ReturnsPage §8]
- **BuckyDrop weigert order zelf** (uitverkocht): PO `orderStatus 8` → webhook roept `refund_order` aan, order `cancelled` + reden. Hele aanvraaggroep cancelled → service fee één keer terug. [CONFIRMED — webhook r.115-117, refund-order.sql r.42-60]

**Wat als het faalt:**
- Item net gekocht tussen klik en verwerking → niet meer kosteloos; valt terug op return-route. [ASSUMED]
- Refund naar saldo i.p.v. Stripe → §13. [CONFIRMED]

**System action:** `cancel_paid_order` (owner) / `refund_order` (service_role, webhook bij `orderStatus 8`). [CONFIRMED]

---

## 9. Afhaalpunt / pickup point

**Trigger:** Vervoerder levert bij afhaalpunt/locker i.p.v. aan huis (klantkeuze of na faalde thuisbezorging). [ASSUMED]

**Flow:**
1. Bezorging bij afhaalpunt → kan al `pkgNormalStatus 4`/`signStatus 2` triggeren (afgetekend door punt). [ASSUMED — carrier-afhankelijk]
2. Klant haalt op binnen afhaaltermijn. [ASSUMED]

**Wie betaalt wat:** Geen extra kosten; normaal bezorgproces. [ASSUMED]

**Wat als het faalt:**
- Klant haalt niet op binnen termijn → pakket retour → behandel als §7/§2.
- `signTime` gezet bij afhaalpunt maar klant heeft fysiek nog niets → herroepingstermijn start pas bij FEITELIJKE ontvangst door klant; gebruik feitelijke ophaaldatum als bewijslast verschilt. [CONFIRMED — wet: termijn vanaf fysieke ontvangst] → [ASSUMED dat carrier-`signTime` ≈ ophaalmoment]

**System action:** parcel detail `signStatus`/`signTime` als indicatie; geen aparte API-call. [CONFIRMED veld]

---

## 10. Tracking = delivered, maar klant claimt NIET ontvangen (dispuut / mogelijke fraude)

**Trigger:** Parcel detail toont `signStatus 2` + `signTime` + `finishTime` (delivered), maar klant zegt niets ontvangen te hebben. [CONFIRMED — POD-velden]

**Flow:**
1. Flowva trekt volledig POD-bewijs: `signStatus`, `signTime`, `finishTime`, `deliveryTime`, `channelName`, `turnOrder`, bezorgadres (`address`/`countryName`/`provinceName`/`cityName`/`buyerPostCode`). [CONFIRMED — parcel detail velden]
2. Vraag bij vervoerder om bezorgbewijs (GPS/handtekening/foto) via BuckyDrop. [ASSUMED — afhankelijk van carrier]
3. Adres kloppen? Buren/huisgenoten/afhaalpunt checken met klant. [ASSUMED]
4. Beoordeling: bewijs sterk → claim afwijzen; bewijs zwak/twijfel → coulance.

**Wie betaalt wat:**
- POD sterk + adres correct → bewijslast verschuift naar klant; Flowva hoeft niet te refunden (bezorging voltooid). [CONFIRMED — wet: geleverd = nakoming]
- Twijfel/coulance → Flowva neemt verlies (eenmalig), markeert account. [ASSUMED]
- Patroon van herhaalde "niet ontvangen" claims → fraude-flag, weigeren/extra verificatie. [ASSUMED]

**Wat als het faalt:**
- Vervoerder kan POD niet hardmaken → in voordeel klant beslissen (geen sluitend bewijs). [ASSUMED]
- Echte mislevering (verkeerd adres afgetekend) → Flowva-fout-route, refund/herzending (§2). [ASSUMED]
- Chargeback via Stripe → Flowva verweert met POD-bewijs (`signTime`/`turnOrder`/adres). [CONFIRMED — POD beschikbaar als bewijs]

**System action:** parcel detail query als bewijsdossier; fraude-flag op profiel [TO-VERIFY: bestaat veld?]; refund alleen bij coulance via `refund_order`. [CONFIRMED query / TO-VERIFY flag]

---

## 11. Adres-correctie (vóór/ tijdens internationale verzending)

**Trigger:** Klant geeft fout/gewijzigd adres door vóór bezorging. [ASSUMED]

**Flow:**
1. Vóór outbound (`outboundTime` nog leeg): adreswijziging doorgeven aan BuckyDrop. [ASSUMED — adres-update-endpoint NIET in gelezen docs] → [TO-VERIFY: bestaat address-modify-API? Checken in volledige order-docs/portaal.]
2. Na outbound: vervoerder-redirect indien mogelijk, anders pakket gaat retour → herzending naar correct adres. [ASSUMED]

**Wie betaalt wat:**
- Fout door klant → klant draagt eventuele redirect-/herzendkosten. [ASSUMED]
- Fout door Flowva (verkeerd overgenomen) → Flowva draagt. [ASSUMED]

**Wat als het faalt:**
- Te laat → pakket naar fout adres, mogelijk afgetekend door verkeerde persoon → §10-dispuut.
- Retour-en-herzend kost internationaal veel → met klant verrekenen. [ASSUMED]

**System action:** address-modify API [TO-VERIFY]; anders nieuwe `place-bucky-order` voor herzending. [TO-VERIFY]

---

## 12. Supplement / overgewicht-bijbetaling rond verzending (reconcile)

**Trigger:** Werkelijk pakketgewicht > schatting → BuckyDrop zet PO op `orderStatus 4` (to be confirmed incl. supplementary payment); of overweight-fee (¥1,5/kg boven 2kg). [CONFIRMED — kernmodel + Notify Po Status orderStatus 4]

**Flow:**
1. Channel-carriage-list geeft estimate bij checkout; na weging volgt actual. [CONFIRMED — kernmodel]
2. Verschil → reconcile: supplement bijbetalen (wallet) of refund bij overschatting. [CONFIRMED — kernmodel]
3. PO `orderStatus 4` betekent: order wacht op bevestiging/bijbetaling vóór verdere fulfilment. [CONFIRMED — doc]

**Wie betaalt wat:**
- Supplement uit Flowva BuckyDrop-wallet (CNY, prepaid). Of dit aan de klant wordt doorbelast: tax-inclusive DDP-lijnen → BTW niet dubbel; meestal door Flowva geabsorbeerd binnen marge. [ASSUMED — doorbelasting-beleid TO-VERIFY]
- Overschatting → refund-deel terug naar klant (saldo/Stripe). [ASSUMED]

**Wat als het faalt:**
- Supplement niet betaald → PO blijft op `orderStatus 4`, fulfilment stokt; wallet-saldo bewaken. [CONFIRMED — status-betekenis]
- Reconcile mist → marge-lek; admin Financiën-tab moet estimate↔actual sluiten. [ASSUMED]

**System action:** webhook ziet `orderStatus 4` (geen app-status-map → blijft hangen tot handmatig/wallet-actie; [CONFIRMED: PO_STATUS_MAP dekt 4 niet]); supplement betalen in BuckyDrop-wallet/portaal. [CONFIRMED gap]

---

## 13. Dwarsdoorsnede: refund-bestemming (wettelijk kritiek)

**Trigger:** Elke refund in §2-§8 hierboven. [CONFIRMED]

**Bevinding:** `refund_order` en `cancel_paid_order` schrijven naar `profiles.balance` (in-app saldo) + `transactions`. **De wet (EU-herroeping) eist refund via dezelfde betaalmethode als de aankoop, dus Stripe.** ReturnsPage §7 en WithdrawalPage beloven óók "to your Flowva balance". [CONFIRMED — code + pagina-tekst]

**Wie betaalt wat:** n.v.t. (procesfout, geen kostenpost) — maar saldo-only-refund is een nalevingsrisico (boete/chargebacks).

**Wat als het faalt:** Klant eist Stripe-refund → handmatige Stripe-refund nodig; tekst op /returns + /withdraw moet "to your original payment method" worden, niet "balance". [CONFIRMED — fix nodig]

**System action:** [TO-DO] `refund_order`/`cancel_paid_order` uitbreiden met Stripe-refund-pad (refunds.create op de originele PaymentIntent) i.p.v./naast saldo; UI-teksten corrigeren. [CONFIRMED — fix-richting; implementatie TO-VERIFY tegen finance-hardening werk]

---

## 14. Dwarsdoorsnede: BuckyDrop apply-return → returnFlowCode

**Trigger:** Elke fysieke retour richting BuckyDrop/seller (§3-§6). [ASSUMED]

**Bevinding:** Het kernmodel noemt "BuckyDrop apply-return → `returnFlowCode`", maar in de gelezen API-PNG-set (order/parcel/product/logistics/notifications) staat GEEN apply-return-endpoint. [TO-VERIFY — checken in de volledige BuckyDrop after-sales/return-docs of bij agent Vera: exacte path, parameters, of returns überhaupt via API kunnen of alleen via portaal.]

**Belangrijke nuance:** Flowva's returns-beleid stuurt klanten naar een **NL-retouradres**, niet naar China. Een BuckyDrop apply-return (terug naar Chinese seller) is dus vooral relevant voor faulty/defect-items die Flowva zelf richting seller terugstuurt — niet voor de standaard EU-herroeping. [CONFIRMED — ReturnsPage §5 NL-adres]

**System action:** [TO-VERIFY] apply-return-call; NL-retourontvangst + interne afhandeling is het primaire pad. [CONFIRMED NL-pad]

---

## Samenvattende beslis-tabel

| Scenario | Wie draagt kosten | App-status / RPC | BuckyDrop signaal |
|---|---|---|---|
| 1 Geleverd OK | klant (al betaald) | `delivered` | pkgNormalStatus 4 / PO 12 [CONFIRMED] |
| 2 Kwijt onderweg | Flowva (verhaalt op carrier) | `dispute`→refund/herzend | geen `signTime`; claim [TO-VERIFY] |
| 3 Transportschade | Flowva | refund/`place-bucky-order` | foto's; QC-bewijs [CONFIRMED] |
| 4 14-dagen herroeping | klant betaalt retour | `withdrawal-request`→refund | apply-return [TO-VERIFY] |
| 5 Fout item | Flowva | herzend/refund | Notify Po Pending confirmType [CONFIRMED] |
| 6 Defect/garantie | Flowva (binnen termijn) | refund/vervang | after-sales-window [TO-VERIFY] |
| 7 Niet thuis/geweigerd | klant (bij weigering) | handmatig→refund | pkgAbnormalStatus/packageStatus 9 (NIET gemapt) [CONFIRMED gap] |
| 8 Annuleren fulfilment | niemand (vóór inkoop) | `cancel_paid_order`/`refund_order` | PO orderStatus 8 [CONFIRMED] |
| 9 Afhaalpunt | klant (al betaald) | `delivered` bij aftekenen | signStatus 2 [CONFIRMED] |
| 10 Delivered-disp./fraude | klant (bij sterke POD) | dispute/coulance-refund | signTime/turnOrder POD [CONFIRMED] |
| 11 Adres-correctie | klant (eigen fout) | address-modify/herzend | [TO-VERIFY] |
| 12 Supplement/overgewicht | Flowva-wallet | hangt op PO 4 | orderStatus 4 [CONFIRMED] |

**Hoogste prioriteit fixes:** (a) refund naar Stripe i.p.v. saldo (§13, wettelijk); (b) webhook-mapping voor retour-/abnormaal-statussen (`packageStatus` 7/8/9, `pkgAbnormalStatus`) zodat §7 niet blijft hangen; (c) verifieer BuckyDrop apply-return + lost-parcel-claim + address-modify endpoints (§2/§11/§14).
