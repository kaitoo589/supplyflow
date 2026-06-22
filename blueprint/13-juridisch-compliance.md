# 13. Juridisch & Compliance (EU + BuckyDrop)

Deze sectie dekt het juridische en compliance-raamwerk waarbinnen Flowva moet draaien:
EU-consumentenrecht (herroeping, conformiteit/garantie, refund-mechaniek, informatieplichten),
import-BTW/IOSS/DDP en de grote douane-wijziging van 1 juli 2026, productveiligheid (GPSR),
GDPR/privacy, verboden/gereguleerde goederen, de relatie met BuckyDrop (User/API-agreement,
geen API-reselling), en de KvK/niveau-2-afhankelijkheid rond de launch van 2 juli 2026.

**Kernpositie (juridische bril):** Flowva is in de eigen `/returns`-tekst expliciet **"the seller"**
(*"You purchase from Flowva. (...) Flowva is the seller."* — `src/ReturnsPage.jsx` sectie 1)
[CONFIRMED]. Dat is een bewuste, sterke keuze: Flowva is **geen** "marketplace" of "agent" maar de
**verkoper én importeur of record** richting de EU-consument. Daardoor rust het hele EU-consumenten-
en importpakket op Flowva zelf — niet op BuckyDrop, niet op de Chinese seller. Alle scenario's hieronder
gaan van die kwalificatie uit.

> **Disclaimer:** dit is geen juridisch advies. De richting is onderbouwd met EU-wetteksten en de
> aanwezige code, maar elke `[TO-VERIFY]` en elk refund-/BTW-/GPSR-punt moet door een NL-jurist
> (consumentenrecht + fiscaal/douane) worden bevestigd vóór de launch. De 5 review-punten voor de
> NL-adviseur staan onderaan.

---

## 13.1 Herroepingsrecht — 14 dagen (happy path)

**Trigger:** consument klikt op `/withdraw` (publiek, geen login) en vult naam, ordernummer, e-mail
en optioneel reden in. [CONFIRMED — `src/WithdrawalPage.jsx`]

**Flow (stap voor stap):**
1. Formulier valideert naam + ordernummer + geldig e-mailadres (`/.+@.+\..+/`). [CONFIRMED]
2. `supabase.functions.invoke("withdrawal-request", { body: form })` → edge function schrijft (service
   role) in `public.withdrawal_requests` (status `'new'`) en stuurt een bevestigingsmail. [CONFIRMED —
   `withdrawal-requests.sql`; mailverzending via Resend = TO-VERIFY, function nog deployen]
3. UI toont bevestiging: *"we'll send the return details. Once received and checked, we refund the
   product price to your balance."* [CONFIRMED]
4. Admin ziet het verzoek (RLS: `role = 'admin'` mag lezen) en handelt af. [CONFIRMED]

**Wettelijke kern:** onder Richtlijn 2011/83/EU (Consumer Rights Directive) heeft de EU-consument
**14 kalenderdagen** herroepingsrecht zonder opgaaf van reden; de termijn start **bij ontvangst van de
goederen** (niet besteldatum). [CONFIRMED — webresearch, Your Europe / EUR-Lex]. Flowva's `/returns`
sectie 2 verwoordt dit correct ("14 days start the day you receive the item"). [CONFIRMED]

**Wie betaalt wat:**
- Klant betaalt de **retourzending** (toegestaan, mits vooraf gemeld). [CONFIRMED — `/returns` sectie 5;
  art. 14 lid 1 CRD staat dit toe als de consument vooraf is geïnformeerd].
- Flowva moet bij **volledige** herroeping de productprijs **plus de standaard (goedkoopste) outbound
  leveringskosten** terugbetalen. [CONFIRMED — art. 13 lid 1 CRD; `/returns` sectie 4 dekt dit:
  *"product price plus the standard outbound delivery cost"*].

**Wat als het faalt (volgende edge-laag):**
- **Mail komt niet aan / function niet gedeployed** → klant heeft geen bewijs van zijn herroeping →
  juridisch risico (klant kán per gewone e-mail herroepen, dat is rechtsgeldig). Mitigatie: function
  deployen + Resend-bevestiging garanderen, en in `withdrawal_requests` een onmiskenbaar
  tijdstempel (`created_at`) bewaren als bewijs van de herroepingsdatum. [TO-VERIFY — deploy + Resend]
- **Ordernummer onjuist/onvindbaar** → admin kan verzoek niet koppelen → koppel op e-mail als fallback;
  herroeping blijft geldig ook bij verkeerd nummer (vormvrij). [ASSUMED]
- **14-dagentermijn dreigt te verlopen tijdens afhandeling** → de herroeping zelf hoeft alleen
  *binnen* 14 dagen te zijn verstuurd; daarna heeft de klant nóg 14 dagen om terug te sturen. Borg dat
  de `created_at` als peildatum geldt, niet het moment van admin-actie. [CONFIRMED — art. 9/11 CRD]

**System action:** `withdrawal-request` edge function → insert `withdrawal_requests` (status `new`) →
admin zet later status (`new` → bv. `return_label_sent` → `received` → `refunded`). Refund-RPC: zie 13.3.
[CONFIRMED tabel/insert; statusovergangen = ASSUMED, niet in SQL afgedwongen]

---

## 13.2 Herroeping vóór verzending / annuleren tijdens fulfilment

**Trigger:** klant wil annuleren terwijl de order nog niet (internationaal) verzonden is. [CONFIRMED —
`/returns` sectie 8]

**Flow:**
- **Vóór inkoop bij de seller** (status `quote_accepted`, nog niet `bought`): annuleren kan kosteloos,
  volledige refund. [CONFIRMED — `/returns` sectie 8 + `refund-order.sql cancel_paid_order`].
- **Na verzending:** afgehandeld als retour → klant stuurt naar het NL-adres. [CONFIRMED — `/returns` 8].

**Wie betaalt wat:**
- Vóór inkoop: niemand draagt extra kosten; volledig bedrag terug. [CONFIRMED]
- `cancel_paid_order` vereist op dit moment **dat de agent een probleem heeft gemeld**
  (`if v_order.problem_type is null then ... 'kan alleen als je agent een probleem heeft gemeld'`).
  [CONFIRMED — `refund-order.sql`]. **Juridisch knelpunt:** het EU-herroepingsrecht is
  *onvoorwaardelijk* — een klant mag annuleren zónder dat er een probleem is gemeld. De huidige
  RPC blokkeert dus een wettelijk toegestane annulering. [TO-VERIFY → laat NL-jurist bevestigen;
  aanbeveling: aparte herroepingspad dat `problem_type` niet vereist].

**Wat als het faalt (edge-laag):**
- **Race: klant annuleert terwijl `place-bucky-order` net de PO plaatst** → dubbele actie. De order kan
  al `bought` zijn bij BuckyDrop terwijl de klant op "annuleren" drukt. Mitigatie: `for update`-lock op
  de orderrij (aanwezig in `refund_order`, **niet** in `cancel_paid_order` — daar staat geen `for
  update`). [CONFIRMED — verschil tussen de twee functies]. → afdwingen dat annuleren na `bought` naar
  het BuckyDrop-cancel/refund-pad gaat (PO orderStatus 8 = cancelled), niet naar saldo-refund.
- **BuckyDrop weigert annulering omdat de seller al verzonden heeft** → wordt retour (13.5).
- **Statussprong gemist** (webhook niet binnen) → order lijkt nog `quote_accepted` maar is in
  werkelijkheid al gekocht → refund-lek. Mitigatie: status alleen vertrouwen na webhook-bevestiging.
  [ASSUMED]

**System action:** `cancel_paid_order(p_order_id)` (authenticated, eigen order, status
`quote_accepted`) → refund naar `balance` + `transactions(type='refund')` → order `cancelled`.
[CONFIRMED]. Na `bought`: BuckyDrop cancel-call + retourpad. [TO-VERIFY — exacte cancel-API].

---

## 13.3 Refund naar originele betaalmethode (Stripe) — KRITIEKE NON-COMPLIANCE

**Trigger:** elke goedgekeurde herroeping/retour/annulering die tot terugbetaling leidt.

**Wettelijke eis:** de handelaar moet terugbetalen **met hetzelfde betaalmiddel** als de consument
gebruikte, tenzij de consument uitdrukkelijk instemt met iets anders **en daar geen kosten van
ondervindt**, en wel **binnen 14 dagen**. [CONFIRMED — art. 13 CRD, webresearch:
*"using the same means of payment as the consumer used for the initial transaction"*].

**Huidige werkelijkheid in code (het probleem):**
- `refund_order` en `cancel_paid_order` boeken de refund naar het **in-app `balance`** + een
  `transactions`-rij — **niet** terug naar Stripe. [CONFIRMED — `auto-refund.sql`, `refund-order.sql`].
- `/withdraw` en `/returns` beloven de klant expliciet refund **"to your Flowva balance"**. [CONFIRMED —
  `WithdrawalPage.jsx`, `ReturnsPage.jsx` sectie 7].
- → Dit is **structureel in strijd** met art. 13 CRD: saldo-tegoed is *niet* het oorspronkelijke
  betaalmiddel, en de klant heeft niet uitdrukkelijk ingestemd. [CONFIRMED — wet + code samen].
  (Bekend uit MEMORY: refund_order refundt naar in-app saldo; wettelijk moet naar Stripe.)

**Wie betaalt wat:** Flowva draagt de Stripe-refundkosten/-fees; de klant mag **geen** kosten ondervinden
van de wijze van terugbetaling. [CONFIRMED — art. 13 lid 1 CRD].

**Wat als het faalt (edge-laag):**
- **Stripe-refund na payout al uitbetaald** → het geld staat al op Wise/Revolut/BuckyDrop-wallet (CNY)
  → liquiditeit nodig om de Stripe-refund te dekken. Mitigatie: refund-buffer aanhouden; Stripe staat
  refunds toe ook na payout (verrekent met nieuwe omzet of trekt van saldo). [TO-VERIFY — Stripe-saldo].
- **Refund > 180 dagen na charge** → Stripe kan de originele charge niet meer terugboeken → dan is een
  alternatieve uitbetaling (bankoverschrijving) toegestaan, mits kosteloos voor de klant. [TO-VERIFY —
  Stripe 180d-grens]. 14-dagen-herroeping valt hier ruim binnen; alleen late garantieclaims (13.4)
  kunnen erbuiten vallen.
- **Wisselkoersverschil EUR↔CNY** → niet relevant voor de klant: terugbetaling is in EUR, het bedrag
  dat de klant betaalde. Flowva draagt het koersrisico. [CONFIRMED — refund in betaalde valuta].
- **Klant stemt in met saldo-tegoed** → dán mag het wél naar `balance`, mits aantoonbaar uitdrukkelijk
  (opt-in checkbox + log), niet als default. [CONFIRMED — art. 13 uitzondering].

**System action (vereiste aanpassing):** nieuwe/aangepaste refund-flow die een **Stripe Refund**
aanmaakt (`stripe.refunds.create` met de oorspronkelijke `payment_intent`) als primair pad; `balance`
alleen bij expliciete opt-in. De UI-teksten in `WithdrawalPage.jsx`/`ReturnsPage.jsx` ("to your Flowva
balance") moeten mee veranderen naar "to your original payment method". [TO-VERIFY — Stripe-refund
endpoint nog te bouwen; dit is een launch-blocker].

---

## 13.4 Wettelijke garantie / conformiteit (2 jaar)

**Trigger:** product is defect / niet-conform binnen 2 jaar na levering (los van de 14-dagen-herroeping).

**Wettelijke kern:** onder Richtlijn (EU) 2019/771 is de verkoper **2 jaar** aansprakelijk voor
non-conformiteit die bij levering bestond; bij gebreken die binnen het **eerste jaar** zichtbaar worden
geldt **omgekeerde bewijslast** (vermoeden dat het gebrek bij levering bestond — verkoper moet het
tegendeel bewijzen). Remedies: herstel/vervanging gratis, daarna prijsvermindering of ontbinding/refund.
[CONFIRMED — webresearch EUR-Lex / EU-Commissie]. Omdat Flowva = verkoper, rust deze garantie op Flowva,
niet op de Chinese seller. [CONFIRMED — kwalificatie 13.0].

**Flow:**
1. Klant meldt defect (support/`/returns` sectie 10). [CONFIRMED]
2. Flowva biedt herstel, vervanging of refund; **Flowva draagt de retourkosten** bij een defect.
   [CONFIRMED — `/returns` 10: *"If an item arrives defective (...) we cover the return cost"*].
3. QC-bewijs (verplichte foto's + maatmeting per order, ~¥6) dient als referentie of het gebrek al bij
   verzending bestond. [CONFIRMED — kernmodel; foto's komen ook mee bij defect via webhook Notify Po
   Pending, velden `confirmType` + `picList` beide Required].

**Wie betaalt wat:**
- Bij echt defect/niet-conform: **Flowva** betaalt retour + herstel/vervanging/refund. [CONFIRMED].
- *"Minor variations from supplier photos are normal and not a defect"* → geen recht op kosteloze
  remedie bij louter kleurnuance. [ASSUMED — redelijk, maar mag de wettelijke conformiteitsmaatstaf
  niet uithollen; bij afwijking van een toegezegde eigenschap is het wél non-conformiteit].

**Wat als het faalt (edge-laag):**
- **Garantieclaim ná 14 dagen herroeping maar binnen 2 jaar** → herroepingspad (`/withdraw`) is hier
  niet de juiste route; er moet een apart conformiteits-/klachtenpad bestaan. Nu ontbreekt dat als
  expliciete flow (alleen support). [TO-VERIFY — apart RMA/conformiteitspad bouwen].
- **Refund na maanden** → kan buiten Stripe-180d vallen (zie 13.3) → bankoverschrijving nodig.
  [TO-VERIFY].
- **Bewijslast jaar 1** → Flowva moet aantonen dat het géén fabricagefout was; zonder bewijs verliest
  Flowva. QC-foto's zijn hier het verweer. [CONFIRMED — 2019/771 art. 11].
- **Seller in China niet meer bereikbaar / item uitverkocht** → Flowva blijft alsnog
  garantieplichtig richting de klant (kan niet doorschuiven). [CONFIRMED].

**System action:** los conformiteits-/RMA-pad (status bv. `warranty_claim`) + Stripe-refund (13.3);
QC-`picList` uit `buckydrop-webhook` als bewijslog bewaren. [TO-VERIFY — pad bestaat nog niet].

---

## 13.5 Retourstroom (operationeel) — NL-retouradres i.p.v. China

**Trigger:** goedgekeurde herroeping of garantie-retour van een fysiek verzonden item.

**Flow:**
1. Klant krijgt NL-retouradres (nooit terug naar China). [CONFIRMED — `/returns` sectie 5].
2. Klant stuurt binnen 14 dagen ná het herroepingsverzoek terug. [CONFIRMED — `/returns` 5].
3. Bij ontvangst: conditiecheck (ongedragen, labels, verpakking). [CONFIRMED — `/returns` 6].
4. Refund binnen 14 dagen na ontvangst (of na bewijs van verzending). [CONFIRMED — `/returns` 7;
   art. 13 lid 3 CRD: handelaar mag wachten tot terugontvangst óf verzendbewijs].

**Wie betaalt wat:**
- Retourzending: klant (herroeping) of Flowva (defect). [CONFIRMED — 13.1/13.4].
- **Waardevermindering door bovenmatig gebruik** mag op de refund in mindering worden gebracht.
  [CONFIRMED — `/returns` 6; art. 14 lid 2 CRD].

**Wat als het faalt (edge-laag):**
- **Item komt beschadigd/gedragen terug** → Flowva mag refund verlagen, maar moet de
  waardevermindering kunnen onderbouwen (foto's bij ontvangst). [CONFIRMED — art. 14 lid 2].
- **Item komt nooit aan / klant levert geen verzendbewijs** → geen refundplicht tot bewijs.
  [CONFIRMED — art. 13 lid 3].
- **BuckyDrop-retour vanuit NL-warehouse** (apply-return → `returnFlowCode`) → operationeel los van de
  klant-refund; verwar de klant-refundtermijn niet met de BuckyDrop-retourdoorlooptijd. [CONFIRMED —
  kernmodel apply-return]. De wettelijke 14-dagen-klantrefund loopt onafhankelijk door. [CONFIRMED].
- **Partial vs full return** → bij partial geen verzendrefund, bij full wél de outbound-leverkosten
  (goedkoopste tarief). [CONFIRMED — `/returns` 4].

**System action:** BuckyDrop apply-return → `returnFlowCode`; klant-refund via Stripe (13.3) bij
ontvangst/verzendbewijs. [CONFIRMED apply-return bestaat; koppeling refund = TO-VERIFY].

---

## 13.6 Uitzonderingen op het herroepingsrecht

**Trigger:** klant wil herroepen op een item dat wettelijk is uitgezonderd.

**Uitzonderingen (art. 16 CRD):** op maat gemaakte/gepersonaliseerde producten; verzegelde
hygiëne-/gezondheidsartikelen ná ontzegeling; bederfelijke goederen; verzegelde audio/video/software
ná ontzegeling; en enkele andere. [CONFIRMED — webresearch + `/returns` sectie 9 verwoordt dit].

**Wie betaalt wat:** bij geldige uitzondering is er **geen** herroepingsrecht → geen refundplicht
(behoudens conformiteit 13.4, die blijft altijd gelden). [CONFIRMED].

**Wat als het faalt (edge-laag):**
- **Onterecht als "personalised" bestempeld** om herroeping te ontlopen → boete-risico
  (oneerlijke handelspraktijk). Alleen écht gepersonaliseerde items uitzonderen. [ASSUMED].
- **Hygiëne-item: was het verzegeld?** Zonder zegel geen uitzondering. [CONFIRMED — art. 16(e) eist
  verzegeling]. Voor LITHRA-apparel speelt dit vooral bij ondergoed/badkleding. [ASSUMED].

**System action:** productflag "withdrawal_excluded" + reden, getoond vóór aankoop (informatieplicht
13.8). [TO-VERIFY — flag bestaat nog niet expliciet; `product-flags.sql` checken].

---

## 13.7 Import-BTW, IOSS, DDP en de douane-wijziging van 1 juli 2026

**Trigger:** elke internationale zending China → EU-consument.

**Wettelijke kern:**
- **Import-BTW geldt altijd** (de €22-vrijstelling verviel al in 2021): alle import is BTW-plichtig
  ongeacht waarde. [CONFIRMED — webresearch].
- **IOSS** vereenvoudigt BTW-inning op afstandsverkopen tot **€150 intrinsieke waarde** (= prijs
  goederen, *excl.* verzending/verzekering/taksen mits apart op factuur). [CONFIRMED — webresearch].
- **GROTE WIJZIGING per 1 juli 2026:** de **€150 douanerecht-vrijstelling vervalt** en wordt vervangen
  door een tijdelijke **douaneheffing van ~€3 per item** (verwacht tot 1 juli 2028). IOSS blijft
  bestaan voor BTW ≤€150, maar coëxisteert nu met douanerechten. [CONFIRMED — webresearch,
  EU Taxation & Customs / Avalara / vatcalc]. **Dit raakt Flowva's launchdatum direct (2 juli 2026).**
- **Product-identifiers** in zendingen ≤€150: vanaf 1 juli 2026 vrijwillig, vanaf **1 nov 2026
  verplicht**. [CONFIRMED — webresearch].

**Hoe Flowva het nu doet (code):**
- `pay_shipping` rekent **21% NL invoer-BTW over (goederen + verzending)** — DDP, BTW vooraf inbegrepen.
  [CONFIRMED — `pay-shipping.sql`: `v_vat := round((v_goods + v_ship) * 0.21, 2)`].
- DDP-lijnen zijn **tax-inclusive**; niet dubbel BTW rekenen. [CONFIRMED — kernmodel].

**Wie betaalt wat:**
- Klant betaalt 21% import-BTW (in de DDP-prijs) + (vanaf 1/7/2026) de **~€3/item douaneheffing**.
  [CONFIRMED tarief in code; €3-heffing nog NIET in `pay_shipping` verwerkt → TO-VERIFY/aanpassen].
- Flowva draagt BTW af via **IOSS** (≤€150) of reguliere import (>€150). [TO-VERIFY — IOSS-registratie
  bestaat nog? Zo niet: launch-blocker voor compliant DDP].

**Wat als het faalt (edge-laag):**
- **€3-heffing niet doorberekend** → marge-lek per item vanaf 1/7/2026 (precies bij launch). Voeg een
  `c_customs_per_item` constante toe in `pay_shipping` + spiegel in `WarehouseAndHaul.jsx`. [TO-VERIFY].
- **Consignment >€150** → buiten IOSS → reguliere import met BTW + douanerecht bij invoer → DDP-prijs
  moet dat dekken anders krijgt de klant een onverwachte invoernota (= verboden bij DDP-belofte).
  Bundelen tot >€150 (advies uit MEMORY: mik €20–40/bundel) houdt de meeste binnen €150 maar let op
  grote bundels. [CONFIRMED — €150-grens; bundel-strategie = ASSUMED].
- **Geen IOSS-nummer geregistreerd** → BuckyDrop/vervoerder int BTW bij invoer → dubbele BTW (klant
  betaalde al in DDP) → refund-claims. [TO-VERIFY — IOSS-status urgent].
- **Product-identifiers ontbreken na 1 nov 2026** → zending kan worden tegengehouden. [TO-VERIFY].
- **BTW berekend over verkeerde grondslag** → bij DDP is BTW over goederen + verzending correct;
  controleer of de douanewaarde-definitie overeenkomt. [TO-VERIFY — fiscaal jurist].

**System action:** `pay_shipping` RPC (21% over goederen+verzending). Toe te voegen: `c_customs_per_item`
(~€3) vanaf 1/7/2026; IOSS-registratie + IOSS-nummer in de zendingsdata aan BuckyDrop meegeven.
[CONFIRMED huidige RPC; toevoegingen = TO-VERIFY].

---

## 13.8 Precontractuele informatieplichten (afstandsverkoop)

**Trigger:** elke productweergave + checkout (doorlopende plicht, niet één scenario).

**Wettelijke kern (art. 6 CRD):** vóór sluiting van de overeenkomst moet de consument o.a. weten:
totale prijs incl. alle taksen + verzendkosten, identiteit/adres van de handelaar, herroepingsrecht +
modelformulier, leveringstermijn, wettelijke garantie, klachtenafhandeling. [CONFIRMED — webresearch
EUR-Lex samenvatting CRD]. Voor België/sommige LS geldt bovendien expliciete vermelding van de
2-jaars-garantie. [TO-VERIFY — landspecifiek].

**Hoe Flowva het doet:** transparant prijsmodel (echte fabrieksprijs + 8% fee, min €5) + "How Flowva
works"-pagina LIVE; DDP-BTW vooraf inbegrepen. [CONFIRMED — kernmodel/MEMORY]. `/returns` dekt
herroeping, garantie en kosten. [CONFIRMED].

**Wat als het faalt (edge-laag):**
- **Geen modelformulier voor herroeping** → bij ontbreken verlengt de herroepingstermijn van rechtswege
  tot **12 maanden**. [CONFIRMED — art. 10 CRD: ontbrekende info → +12 maanden]. → modelformulier/
  duidelijke herroepingsinfo vóór koop tonen is essentieel.
- **Totaalprijs niet vóór de "betaal"-knop volledig zichtbaar** (verzending/BTW/€3-heffing pas later) →
  prijs niet "compleet" → de klant is mogelijk niet aan die extra kosten gebonden. [CONFIRMED — art. 6
  lid 6 CRD]. Borg dat verzending+BTW(+heffing) vóór bevestiging zichtbaar zijn; `pay_shipping` rekent
  het pas in de warehouse-fase → check of de totaalprijs eerder transparant is. [TO-VERIFY].
- **"Bestelknop" niet ondubbelzinnig** (art. 8 lid 2: knop met "bestelling met betalingsverplichting"
  o.i.d.) → anders is de consument niet gebonden. [TO-VERIFY — labeltekst checkout-knop].
- **Handelaarsidentiteit/KvK/BTW-nummer niet vermeld** → informatieplicht-schending. [TO-VERIFY — staat
  KvK/BTW in footer/imprint? Nu geen imprint-pagina, zie 13.9].

**System action:** statische content (productpagina, checkout, "How Flowva works", herroepings-
modelformulier). [CONFIRMED gedeeltelijk; modelformulier + complete totaalprijs vóór knop = TO-VERIFY].

---

## 13.9 GDPR / privacy + ontbrekende juridische pagina's

**Trigger:** elke verwerking van persoonsgegevens (account, order, e-mail, push-subscriptions, chat).

**Bevinding (code):** de app routeert alléén `/withdraw` en `/returns`. Er is **geen** `/privacy`,
`/terms`, `/imprint`/`/legal`, en **geen cookie-consent**. [CONFIRMED — `App.jsx` regels 141–142; geen
matches op privacy/cookie/consent in `App.jsx`]. Push-subscriptions worden opgeslagen
(`push-subscriptions.sql`) → persoonsgegevens zonder zichtbaar privacybeleid. [CONFIRMED].

**Wettelijke kern:**
- **GDPR** vereist een privacyverklaring (art. 13 informatieplicht), grondslag per verwerking,
  bewaartermijnen, en rechten (inzage/verwijdering). [CONFIRMED — algemeen GDPR].
- **ePrivacy/cookiewet**: niet-strikt-noodzakelijke cookies/trackers vereisen voorafgaande toestemming.
  [CONFIRMED — algemeen]. (PWA/analytics → consent nodig.) [TO-VERIFY — welke trackers draaien].
- **Derde landen (China):** ordergegevens/adres gaan naar BuckyDrop (CN) → doorgifte naar derde land →
  vereist een geldige transfermechanisme (SCC's) + vermelding in de privacyverklaring. [CONFIRMED —
  GDPR hoofdstuk V doorgifte derde landen; SCC-noodzaak voor CN]. **Dit is een reëel risico** omdat
  fulfilment per definitie NAW-gegevens naar China stuurt. [TO-VERIFY — SCC's met BuckyDrop].

**Wie betaalt wat:** n.v.t. (compliance-kosten Flowva).

**Wat als het faalt (edge-laag):**
- **Geen privacyverklaring/cookiebanner** → AP-handhavingsrisico + informatieplicht-schending bij
  launch. → `/privacy`, `/terms`, `/imprint` (handelaarsidentiteit, KvK, BTW, contact) en cookie-consent
  toevoegen. [TO-VERIFY — pagina's bestaan niet].
- **Geen verwerkersovereenkomst/SCC met BuckyDrop** → onrechtmatige doorgifte adresgegevens naar CN.
  [TO-VERIFY].
- **Recht op verwijdering vs. bewaarplicht** → fiscale bewaarplicht (7 jaar NL) botst met "delete me";
  los op via gedifferentieerde bewaartermijnen. [CONFIRMED — NL 7-jaar fiscale bewaarplicht; ASSUMED
  toepassing].
- **Chat-vertaling** (`chat-translation.sql`) → mogelijk doorgifte van berichtinhoud naar een
  vertaaldienst → vermelden + grondslag. [TO-VERIFY].

**System action:** statische pagina's + consent-state; DPA/SCC met BuckyDrop. [TO-VERIFY — niets
hiervan in code aanwezig].

---

## 13.10 Productveiligheid (GPSR) + Responsible Person

**Trigger:** het op de EU-markt aanbieden van (non-EU) producten — geldt voor elk LITHRA/Flowva-item.

**Wettelijke kern:** GPSR — Verordening (EU) 2023/988 — is van toepassing sinds **13 december 2024**.
Een product mag **niet** op de EU-markt worden gebracht tenzij er een in de EU gevestigde **economic
operator / Responsible Person** verantwoordelijk voor is (art. 16). Bij non-EU fabrikanten moet een
in de EU gevestigde Responsible Person worden aangewezen; diens naam + post-/e-mailadres moet bij het
online-aanbod staan (afstandsverkoop). [CONFIRMED — webresearch, EUR-Lex 2023/988]. Online
marktplaatsen moeten zich bij Safety Gate registreren en een contactpunt aanwijzen. [CONFIRMED].

**Toepassing op Flowva:** omdat Flowva (NL, EU) **de verkoper/importeur** is, kan Flowva **zelf de
Responsible Person zijn** voor de geïmporteerde producten — mits EU-gevestigd (KvK/niveau-2, zie
13.11). [ASSUMED — juridisch plausibel; bevestigen]. Dat is dus géén blocker mits Flowva als importeur
de RP-rol vervult én de RP-gegevens toont.

**Wie betaalt wat:** Flowva draagt compliance-/registratiekosten; bij onveilig product de recall-/
remediekosten. [CONFIRMED — GPSR legt dit op de operator].

**Wat als het faalt (edge-laag):**
- **RP-gegevens niet bij het aanbod** → niet-conform aanbod → kan worden verwijderd/beboet.
  [CONFIRMED — art. 19 distance-sales-info]. → naam + adres Flowva (RP) op productpagina tonen.
  [TO-VERIFY].
- **Onveilig product / recall** → Flowva moet melden via Safety Gate + corrigerende maatregelen.
  [CONFIRMED]. → incident-/recallprocedure nodig. [TO-VERIFY].
- **Bepaalde apparel = PBM of speelgoed-achtig** → strengere regels (CE, EN-normen). Voor gewone kleding
  meestal GPSR + textiel-labelling; kinderkleding (trekkoorden EN 14682) strenger. [ASSUMED — afhankelijk
  van assortiment].
- **Textiel-labelling (Verordening 1007/2011)** → vezelsamenstelling verplicht vermelden; sluit aan op
  het samenstelling-veld (`product-material.sql`). [CONFIRMED bestaan veld; labelling-plicht = ASSUMED
  toepassing].

**System action:** RP-gegevens (Flowva NL) + samenstelling op productpagina; Safety-Gate-procedure.
[TO-VERIFY — nog niet in code].

---

## 13.11 Verboden / gereguleerde goederen

**Trigger:** klant requestt een item dat invoer-/verkoopbeperkt is (`OrderRequest.jsx` open request-model).

**Flow:** omdat klanten via een open request-model 1688/Taobao/Tmall-links kunnen insturen, kan een
verboden/namaakartikel binnenkomen vóór curatie. [CONFIRMED — open request-model uit kernmodel].

**Categorieën risico:** namaak/merkinbreuk (IP), wapens/replica's, bepaalde elektronica (radio/CE),
cosmetica/voeding/supplementen (aparte regimes), CITES (dierlijke producten), batterijen/lithium
(transportbeperkingen). [ASSUMED — algemeen import/douane]. BuckyDrop zal eigen verboden-lijst hanteren
en kan zending weigeren. [TO-VERIFY — BuckyDrop prohibited-list].

**Wie betaalt wat:**
- Wordt een order door BuckyDrop geweigerd → `refund_order` (server-side) refundt de productprijs (+ fee
  als hele groep weg). [CONFIRMED — `auto-refund.sql`]. **Let op:** ook hier nu naar `balance`, niet
  Stripe (zie 13.3). [CONFIRMED].
- Namaak dat tóch doorglipt → Flowva (als verkoper) draagt IP-inbreukrisico richting merkhouder +
  douane-inbeslagname. [CONFIRMED — verkoper aansprakelijk].

**Wat als het faalt (edge-laag):**
- **Counterfeit verkocht aan klant** → IP-claim + reputatie + douane-seizing; QC-foto's helpen
  detecteren vóór verzending. [ASSUMED].
- **Geweigerd ná betaling** → refund-pad (13.3) + order `cancelled` (`bd_error` = reden). [CONFIRMED].
- **Gereguleerd maar niet verboden** (bv. cosmetica) → extra documentatie/registratie nodig → uit
  assortiment houden tot compliant. [ASSUMED].

**System action:** pre-curatie-filter op request + BuckyDrop prohibited-check; bij weigering
`refund_order(p_order_id, p_reason)` → `cancelled`, `bd_error`. [CONFIRMED RPC; pre-filter = TO-VERIFY].

---

## 13.12 BuckyDrop User/API-agreement — geen reselling, kwalificatie, aansprakelijkheid

**Trigger:** doorlopende relatie Flowva ↔ BuckyDrop (Solution API).

**Bekende contouren (kernmodel):** BuckyDrop User Agreement bevat een **no-compete** en **geen
API-reselling**. [ASSUMED — uit projectbriefing; exacte clausuletekst niet te lezen]. De clausuletekst
op `buckydrop.com/en/agreement_api/` is JS-gerenderd en kon **niet** worden uitgelezen via WebFetch.
[CONFIRMED — fetch gaf alleen de titel "Solution API Agreement" terug]. → de precieze verplichtingen
moeten uit het ingelogde dashboard/PDF komen. [TO-VERIFY].

**Aandachtspunten (juridisch):**
- **Geen API-reselling / doorverkoop van de API zelf** → Flowva mag de BuckyDrop-API niet als product
  doorverkopen; Flowva gebruikt 'm als interne fulfilment-laag (dat is toegestaan gebruik, geen
  reselling). [ASSUMED].
- **No-compete** → Flowva mag (vermoedelijk) niet zelf een concurrerende sourcing-agent-dienst bouwen op
  BuckyDrop-infrastructuur. [ASSUMED]. Flowva's model (eigen merk verkopen, BuckyDrop als fulfilment)
  lijkt geen schending, maar bevestigen. [TO-VERIFY].
- **Seller/importeur of record:** richting de **EU-consument** is Flowva de verkoper (13.0). BuckyDrop is
  Flowva's **leverancier/dienstverlener**, niet de verkoper richting de eindklant. Borg dat de
  BuckyDrop-agreement Flowva niet contractueel tot loutere "agent" degradeert op een manier die met de
  consumentenbelofte botst. [TO-VERIFY — clausule kwalificatie].
- **Aansprakelijkheidsdisclaimers** van BuckyDrop richting Flowva → die kunnen NIET worden doorgeschoven
  naar de consument; Flowva blijft volledig consumenten-aansprakelijk ongeacht wat BuckyDrop uitsluit.
  [CONFIRMED — dwingend consumentenrecht gaat vóór B2B-disclaimer].

**Wie betaalt wat:** prepaid wallet-model (CNY) — Flowva draagt het saldo- en koersrisico; BuckyDrop-fees
(¥9,9/parcel etc.) zijn kosten voor Flowva, door te rekenen in prijs/verzending. [CONFIRMED — kernmodel].

**Wat als het faalt (edge-laag):**
- **BuckyDrop schorst het account** (vermeende agreement-schending) → fulfilment valt stil → openstaande
  orders kunnen niet verzonden → refundgolf nodig (13.3). [ASSUMED]. → buffer + alternatieve agent als
  continuïteitsplan. [TO-VERIFY].
- **Agreement wijzigt eenzijdig** (fees/terms) → margemodel kan kapseizen. → fees periodiek herijken.
  [ASSUMED].

**System action:** geen directe code; contractbeheer + continuïteitsplan. [TO-VERIFY].

---

## 13.13 KvK / niveau-2-afhankelijkheid en launch 2 juli 2026

**Trigger:** alle bovenstaande EU-verplichtingen vereisen een **EU-gevestigde, geregistreerde
handelaar**. De KvK-registratie/niveau-2 hangt aan **2 juli** (MEMORY: deploy-status). [CONFIRMED —
MEMORY].

**Afhankelijkheden die op KvK/EU-vestiging rusten:**
- **Handelaarsidentiteit + KvK + BTW-nummer** in de informatieplicht (13.8) en imprint (13.9).
  [CONFIRMED — art. 6 CRD].
- **IOSS-registratie** voor compliant DDP-BTW (13.7) — vereist een EU-entiteit/intermediair.
  [CONFIRMED — IOSS vereist EU-registratie].
- **GPSR Responsible Person** = Flowva zelf, alleen geldig als EU-gevestigd (13.10). [CONFIRMED].
- **BTW-aangifte/afdracht** als NL-ondernemer. [CONFIRMED].

**Wat als het faalt (edge-laag):**
- **KvK/niveau-2 niet rond op 2 juli** → Flowva mist een geldige handelaarsidentiteit/BTW/IOSS/RP →
  **launch-blocker**: zonder dit kan Flowva niet rechtmatig als EU-verkoper/importeur verkopen.
  [CONFIRMED — afhankelijkheidsketen]. → launchdatum koppelen aan KvK-bevestiging.
- **Verkopen vóór registratie** → ondernemen zonder inschrijving + niet-conforme informatieplicht +
  BTW-risico. [ASSUMED — vermijden].
- **Samenloop met 1/7/2026 douanewijziging** (13.7) → launch valt precies in het nieuwe €3-heffing-
  regime; zorg dat KvK, IOSS én de €3-doorberekening alle drie vóór de eerste order klaarstaan.
  [CONFIRMED — data-samenloop].

**System action:** geen code; registratiemijlpaal als harde launch-gate. [CONFIRMED — afhankelijkheid].

---

## 13.14 Samenvattende compliance-risicomatrix (launch-blockers eerst)

| # | Onderwerp | Status | Ernst |
|---|-----------|--------|-------|
| 13.3 | Refund naar **Stripe** i.p.v. saldo | NIET compliant (code refundt naar `balance`) | **Launch-blocker** [CONFIRMED] |
| 13.7 | IOSS-registratie + €3-heffing (1/7/2026) in `pay_shipping` | Onbekend / ontbreekt | **Launch-blocker** [TO-VERIFY] |
| 13.13 | KvK/niveau-2 (2 juli) | Hangend | **Launch-blocker** [CONFIRMED afhankelijkheid] |
| 13.9 | Privacy/terms/imprint + cookie-consent + SCC's CN | Ontbreekt in code | Hoog [CONFIRMED] |
| 13.10 | GPSR Responsible Person + RP-gegevens tonen | Ontbreekt | Hoog [CONFIRMED plicht] |
| 13.2 | Herroeping vereist nu `problem_type` (onvoorwaardelijk recht) | Te ruim geblokkeerd | Hoog [TO-VERIFY] |
| 13.8 | Modelformulier + complete totaalprijs vóór "betaal"-knop | Deels | Middel [TO-VERIFY] |
| 13.4 | Apart 2-jaars-conformiteits-/RMA-pad | Ontbreekt als flow | Middel [TO-VERIFY] |
| 13.12 | BuckyDrop-agreement exact (no-compete/reselling) | Niet leesbaar | Middel [TO-VERIFY] |

---

## 5 punten voor de NL-jurist (consumentenrecht + fiscaal/douane)

1. **Refund-mechaniek (art. 13 CRD):** bevestig dat saldo-tegoed onrechtmatig is en dat Stripe-refund
   verplicht is; mag een uitdrukkelijke opt-in voor saldo? Wat bij Stripe-180d-grens (late
   garantieclaims)?
2. **Onvoorwaardelijke herroeping vs. `problem_type`-eis** in `cancel_paid_order`: bevestig dat de
   herroeping niet aan een gemeld probleem mag worden gekoppeld, en het juiste pad ná `bought`.
3. **IOSS + 1/7/2026 douanewijziging:** moet Flowva IOSS-geregistreerd zijn; hoe de €3/item-heffing
   correct doorberekenen onder een DDP-belofte; grondslag van de 21%-berekening in `pay_shipping`.
4. **GPSR Responsible Person:** kan Flowva (NL, als importeur) zelf RP zijn; welke RP-gegevens moeten
   waar getoond worden; textiel-labelling (1007/2011) en eventueel kinderkleding-normen.
5. **GDPR-doorgifte naar China + ontbrekende juridische pagina's:** SCC's/DPA met BuckyDrop voor
   NAW-doorgifte; verplichte privacy-/terms-/imprint-pagina's + cookie-consent vóór launch; bewaartermijn
   vs. fiscale 7-jaarsplicht.

---

### Bronnen (EU-recht, webresearch)
- Right of withdrawal / refund original method (CRD 2011/83): Your Europe, EUR-Lex CRD-samenvatting, ECC-Net.
- Legal guarantee 2 jaar + omgekeerde bewijslast (Richtlijn 2019/771): EU-Commissie, EUR-Lex.
- IOSS / €150-grens / 1-juli-2026 douaneheffing €3: EU Taxation & Customs Union, Avalara, vatcalc.
- GPSR Responsible Person (Verordening 2023/988): EUR-Lex, EU-Commissie.

*(Tags door de sectie: [CONFIRMED] = uit code/wet geverifieerd; [ASSUMED] = redelijke aanname;
[TO-VERIFY] = expliciet checken — hoe/waar staat per punt vermeld.)*
