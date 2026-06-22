# 15 — Flowva Friends: group-order edge cases

Group/social-buying laag bovenop de solo-orderflow. Vrienden vormen een groep, vullen elk hun **eigen** deel van een gedeelde mand, doen "ready" (= *Confirm & pay*, geld wordt vastgehouden), en zodra **iedereen** ready is plaatst de groep zichzelf atomair (`status='placed'`). Per item ontstaat dan een echte `orders`-rij (eigenaar = lid, **afleveradres = host**), de holds worden omgezet naar normale `order`/`service_fee`-transacties, en de bestaande BuckyDrop-trigger koopt ze in. Verzending is een **tweede geldmoment** met een gewicht-gesplitst first-weight-blok.

Deze sectie dekt elke faal-/edge-laag die de orderflow raakt. Codebronnen: `src/Friends.jsx`, `src/ffApi.js`, `supabase/flowva-friends.sql` (Fase 1), `flowva-friends-money.sql` (Fase 3), `flowva-friends-fulfillment.sql` (Fase 5), `flowva-friends-social.sql` (Fase 4), `flowva-friends-redesign.sql`. Tags: **[CONFIRMED]** = gezien in code/SQL/wet, **[ASSUMED]** = redelijke aanname, **[TO-VERIFY]** = expliciet te checken.

> **Statussen** — groep: `gathering → placed → shipped → arrived → closed`, plus `cancelled`/`expired` ([CONFIRMED], CHECK in `flowva_groups.status`). Geld-lifecycle per lid: geen hold → `group_hold` (ready) → `group_hold_refund` (un-ready/leave tijdens gathering) of `group_hold_release` + `order` + `service_fee` (bij plaatsing). [CONFIRMED]

> **Kerninvariant (de spil van bijna elke edge-case)**: ELKE roster-/cart-wijziging zet `ready=false`, en de `ff_unready_refund_trg`/`ff_leave_refund_trg`-triggers storten het vastgehouden bedrag terug — **maar alleen zolang `status='gathering'`**. Na `placed` is geld definitief en lopen correcties via het order-/QC-/herroepingspad. [CONFIRMED — `flowva-friends-money.sql` triggers A+B]

---

## Scenario 1 — Happy path: groep vult, iedereen ready, plaatst zichzelf

**Trigger.** Admin maakt groep (`ff_create_group`), deelt invite-code/link; leden joinen (`ff_join_group`); elk voegt eigen items toe (`ff_add_item`); elk lid doet *Confirm & pay* (`ff_set_ready`); het laatste lid dat ready wordt, plaatst de groep.

**Flow.**
1. `ff_create_group` → maker = `admin_id` én `host_id`, genereert unieke 6-tekens `invite_code`, `status='gathering'`, `fill_deadline = now()+48h`, max_size geclamped op 2..7. [CONFIRMED]
2. Leden joinen tot `member_count <= max_size`. Elke join zet **alle** `ready=false` (fee-tier verandert). [CONFIRMED]
3. Leden voegen items toe; `price` is indicatief (client). Eigen add/remove reset **alleen jouw** `ready`. [CONFIRMED]
4. `ff_set_ready` per lid: lockt de group-rij `for update`, leidt prijs **server-side** uit `public.products` af (nooit client-prijs), schrijft `locked_price` per item, berekent `fee = ff_member_fee(size,total)`, `charge = round(total+fee,2)`, trekt `charge` van `profiles.balance`, logt `group_hold`, zet `ready=true, held_amount=charge`. [CONFIRMED]
5. Laatste lid: `ready_count == member_count` → groep gaat in dezelfde tx atomair op `placed`, zet `placed_at`, en genereert `request_group_id = 'FF-G-<epoch_ms>-<8hex>'`. [CONFIRMED]
6. `ff_create_orders_trg` (AFTER UPDATE, when placed) → per item een `orders`-rij `status='quote_accepted'`, `user_id=lid`, `host_user_id=host`, `ff_group_id=groep`; logt `order`-tx per regel; logt `group_hold_release` (+held) en `service_fee` (−fee) per lid. [CONFIRMED]
7. Insert van `quote_accepted`-orders vuurt `place_bucky_order_ins_trg` → edge function `place-bucky-order` koopt elk item bij BuckyDrop in. [CONFIRMED — `place-bucky-order-trigger.sql`]

**Wie betaalt wat.** Elk lid betaalt **alleen zijn eigen** goederen + zijn **eigen** groeps-fee (lagere %/min naarmate groep groter). Niemand betaalt voor andermans items. Verzending volgt later (Scenario 12). [CONFIRMED]

**Wat als het faalt.** Zie alle scenario's hieronder — dit is puur de gelukkige route.

**System action.** `ff_create_group`/`ff_join_group`/`ff_add_item`/`ff_set_ready` RPC's; trigger `ff_create_orders_on_placement`; edge `place-bucky-order`. **Tag: [CONFIRMED].**

---

## Scenario 2 — Lid joint terwijl anderen al ready zijn (join mid-gather)

**Trigger.** Lid B/C zijn al ready (geld vastgehouden); lid D joint via de link.

**Flow.**
1. `ff_join_group` lockt de group-rij `for update`, voegt D toe, en draait `update ... set ready=false where group_id=...` → **alle** ready-vlaggen vallen om. [CONFIRMED]
2. De `ready: true→false`-overgang vuurt `ff_unready_refund_trg` voor B en C → hun `held_amount` gaat terug naar balance, `group_hold_refund`-tx, `locked_price` gewist, `held_amount:=0`. [CONFIRMED]
3. Fee-tier verschuift (meer leden = lagere %/min) → B en C moeten opnieuw *Confirm & pay*, nu goedkoper. UI toont "refunded automatically the moment anyone joins". [CONFIRMED]

**Wie betaalt wat.** B/C krijgen 100% terug, betalen daarna minder fee. D betaalt zijn eigen deel. Niemand verliest geld. [CONFIRMED]

**Wat als het faalt.**
- **Vol op het randje**: gelijktijdige join terwijl groep net vol raakt → `ff_join_group` doet `count(*) >= max_size` ná de `for update`-lock, dus serialiseert; te late joiner krijgt "This group is full". [CONFIRMED]
- **Join na `placed`**: `status<>'gathering'` → "This group is already closed". De refund-triggers vuren sowieso niet meer (status-guard). [CONFIRMED]
- **Privé-groep**: `is_private` → "This group is private — ask the admin to make it open". [CONFIRMED — `ff_join_group` redesign]
- **Race join vs. laatste ready (de gevaarlijke)**: lid D joint op exact het moment dat lid C de groep wil plaatsen. Beide RPC's nemen `for update` op dezelfde group-rij → ze serialiseren. Plaatst C eerst: D krijgt "closed". Joint D eerst: C's `ff_set_ready` ziet `member_count` inclusief D, telt D als not-ready → plaatst NIET. Geen geld-lek. [CONFIRMED — `for update` in beide]

**System action.** `ff_join_group` (RPC) → roster-reset → trigger A refunds. **Tag: [CONFIRMED].**

---

## Scenario 3 — Lid verlaat de groep mid-gather (leave)

**Trigger.** Lid (niet de laatste) drukt "Leave" → `ff_leave_group`.

**Flow.**
1. Lock group-rij `for update`, status-check `gathering`. [CONFIRMED]
2. Verwijder eigen items + eigen member-rij. De **DELETE** op de member-rij vuurt `ff_leave_refund_trg` → als `held_amount>0` en status `gathering`: held terug naar balance + `group_hold_refund`-tx. [CONFIRMED]
3. Resterende roster: `ready=false` voor iedereen (tier verschuift). Overige holds worden via trigger A teruggestort. [CONFIRMED]

**Wie betaalt wat.** Vertrekker: volledige refund van zijn hold. Overigen: refund + opnieuw bevestigen tegen nieuw (mogelijk hoger) fee-tier — minder leden = hogere %/min. [CONFIRMED]

**Wat als het faalt.**
- **Vertrekker is admin** → admin gaat over naar **oudste lid** (`order by joined_at limit 1`); was hij ook host, dan host → nieuwe admin. [CONFIRMED]
- **Vertrekker is host (niet admin)** → host valt terug naar `admin_id`. [CONFIRMED]
- **Laatste lid vertrekt** → Scenario 7 (groep `cancelled`). [CONFIRMED]
- **Leave na `placed`** → "This group is already closed"; je kunt niet meer leaven. Refund-triggers vuren niet (status-guard). Correctie loopt via QC-annulering (Scenario 9). [CONFIRMED]
- **UI-edge**: leave vanaf de groeps-cart (`initialGroupId`) → sheet sluit i.p.v. lijst; `onShopForGroup(null)` ruimt de "shopping for X"-pil op. [CONFIRMED — `doLeave` in Friends.jsx]
- **[TO-VERIFY]** Tier-stijging kan een lid verrassen: na een leave wordt iedereen un-ready en moet opnieuw betalen tegen hogere fee. Geen blokkade, maar communiceer dit (UI zegt het impliciet). Check of dit gewenst gedrag is bij grote groepen die uitdunnen.

**System action.** `ff_leave_group` (RPC) → DELETE-trigger B + roster-reset trigger A. **Tag: [CONFIRMED].**

---

## Scenario 4 — Admin kickt een lid

**Trigger.** Admin tikt "remove" op een lid → `ff_kick_member`.

**Flow.** Identiek aan leave maar door admin: lock group-rij, `admin_id = caller` check, status `gathering`, kan zichzelf niet kicken ("Use leave instead"). Verwijdert items + member-rij van target → DELETE-trigger refundt diens hold. Was target host → host terug naar admin. Roster-reset → trigger A refundt de rest. [CONFIRMED]

**Wie betaalt wat.** Gekickte krijgt zijn hold terug. Overigen: refund + opnieuw bevestigen tegen nieuw tier. [CONFIRMED]

**Wat als het faalt.**
- **Kick na `placed`** → "This group is already closed"; kicken kan niet meer (orders bestaan al). [CONFIRMED]
- **Niet-admin probeert te kicken** → "Admins only" (en de UI toont de knop alleen aan admin én alleen pre-placement). [CONFIRMED]
- **[ASSUMED]** Misbruik: admin kickt vlak vóór plaatsing om iemand buiten te sluiten. Geen geld-lek (gekickte is gerefund), maar sociaal vervelend. Mitigatie ontbreekt; acceptabel want admin = maker/vertrouwd.
- **[TO-VERIFY]** Gekickt lid heeft de lobby nog open: zijn realtime-kanaal blijft draaien maar RLS (`ff_is_member`) weigert nieuwe reads → `ffFetchGroup` geeft `error` → `openLobby` valt terug naar de lijst met "That group is no longer available." Bevestig dat de DELETE-realtime-event (alleen PK, geen RLS op DELETE) niets gevoeligs lekt — **[CONFIRMED]** in `flowva-friends-social.sql`: bewust géén `replica identity full`, DELETE draagt alleen PK.

**System action.** `ff_kick_member` (RPC) → trigger B (gekickte) + trigger A (rest). **Tag: [CONFIRMED].**

---

## Scenario 5 — Partial ready-up (sommige leden ready, anderen niet)

**Trigger.** B en C ready, D heeft items maar bevestigt niet; A heeft nog geen items.

**Flow.**
1. B/C: `ff_set_ready` slaagt, geld vastgehouden, `ready=true`. Groep plaatst NIET (`ready_count < member_count`). [CONFIRMED]
2. UI toont "2 of 4 ready"; B/C zien "✓ You're ready — waiting for your friends" met "Cancel & get my money back". [CONFIRMED]
3. A (0 items) toont badge "needs items"; A's ontbrekende ready blokkeert plaatsing. [CONFIRMED — `meMember.ready` check; `ff_set_ready` weigert lid zonder items]
4. Andere leden kunnen D/A **nudgen** (`ff-nudge` edge function, 60s client-cooldown + server-side rate-limit via `ff_nudge_log`). [CONFIRMED]

**Wie betaalt wat.** Alleen wie ready is, heeft geld vastgehouden. Niemand betaalt tot **iedereen** ready is en de groep plaatst. Geld staat veilig geparkeerd (refundbaar). [CONFIRMED]

**Wat als het faalt.**
- **Een lid blijft hangen** → groep plaatst nooit; `fill_deadline` (48h) is gezet maar er is **geen geziene cron/expiry-job** die `gathering→expired` zet en holds vrijgeeft. **[TO-VERIFY] KRITIEK**: zoek of er een scheduled function bestaat die verlopen groepen opruimt en holds terugstort; zo niet, is geld onbeperkt vastgehouden bij een nooit-pluk-vol-groep. Niet gevonden in de FF-SQL-bestanden.
- **Lid met 0 items wil ready** → `ff_set_ready` weigert: "Add at least one item before you confirm". [CONFIRMED]
- **Lege groep / leeg lid telt mee voor plaatsing?** Ja: `member_count` telt ALLE leden, ook die met 0 items. Een lid met 0 items kan niet ready worden → blokkeert plaatsing tot het items toevoegt **of** vertrekt/gekickt wordt. [CONFIRMED]

**System action.** `ff_set_ready` (partial), `ff-nudge` edge, `fill_deadline` (passief). **Tag: [CONFIRMED] behalve expiry [TO-VERIFY].**

---

## Scenario 6 — Race bij gelijktijdig ready-up (twee leden klikken tegelijk als laatsten)

**Trigger.** Groep heeft nog 2 not-ready leden (C en D); beide klikken *Confirm & pay* op exact hetzelfde moment.

**Flow.**
1. Beide RPC's nemen `select * from flowva_groups ... for update` → de **tweede wacht** op de eerste (rij-lock). [CONFIRMED]
2. C committeert eerst: zet C ready, telt `ready_count=member_count-1` (D nog niet) → plaatst NIET. Lock vrij.
3. D draait nu: zet D ready, telt `ready_count=member_count` → plaatst atomair, genereert `request_group_id`, trigger maakt orders. [CONFIRMED]

**Wie betaalt wat.** Beiden betalen exact één keer hun eigen deel; groep plaatst precies één keer. Geen dubbele plaatsing. [CONFIRMED]

**Wat als het faalt.**
- **Dubbel-klik door één lid** → `ff_set_ready` checkt eerst `ready=true` → "already" (idempotent, geen tweede afschrijving). [CONFIRMED]
- **Un-ready landt net na plaatsing** → `ff_unready` neemt óók `for update` op de group-rij en checkt `status='gathering'`; landt het ná `placed`, dan "This group is already closed" en het geld blijft (terecht) staan als order. Comment in SQL bevestigt dit is bewust geserialiseerd. [CONFIRMED]
- **Plaatsing + join race** → zie Scenario 2 (zelfde lock). [CONFIRMED]

**System action.** `ff_set_ready` / `ff_unready` met `for update` op group-rij = serialisatiepunt. **Tag: [CONFIRMED].**

---

## Scenario 7 — Groep valt uiteen vóór plaatsing (laatste lid weg / niemand bevestigt)

**Trigger.** Iedereen verlaat de groep, óf de laatste actieve persoon vertrekt.

**Flow.**
1. Bij elke leave: na verwijderen telt `ff_leave_group` `v_remaining`. Wordt dit 0 → `status='cancelled'`. [CONFIRMED]
2. Vóór de laatste verwijdering: wie nog een hold had, is via trigger B al gerefund. [CONFIRMED]

**Wie betaalt wat.** Iedereen die ooit geld vasthield, kreeg het terug (status was `gathering` bij elke leave). Eindsaldo: niemand betaalt. [CONFIRMED]

**Wat als het faalt.**
- **Verweesde `cancelled`-groep blijft in `ff_my_groups`** → de lijst toont 'm nog; `openLobby` werkt (je was lid... nee: je member-rij is weg). **[TO-VERIFY]** Een ex-lid ziet de groep niet meer (geen member-rij → RLS weigert). De allerlaatste die `cancelled` triggerde heeft ook geen member-rij meer → groep verdwijnt uit zijn lijst. Bevestig dat er geen "zombie"-kaart blijft hangen.
- **Niemand vertrekt maar niemand bevestigt** → groep blijft eeuwig `gathering` tot `fill_deadline`; zie Scenario 5 expiry **[TO-VERIFY]**.
- **Admin verlaat als enige met items, leden zonder items blijven** → admin over naar oudste, groep blijft `gathering` met alleen lege leden → kan niet plaatsen tot iemand items + ready heeft. [CONFIRMED gedrag]

**System action.** `ff_leave_group` → `status='cancelled'` bij `v_remaining=0`. **Tag: [CONFIRMED] / expiry [TO-VERIFY].**

---

## Scenario 8 — Host vertrekt / host-overdracht

**Trigger.** De host (afleveradres-ontvanger) verlaat de groep, wordt gekickt, of admin wijst een nieuwe host aan (`ff_set_host`).

**Flow.**
1. **Pre-placement host leave**: `ff_leave_group` → was de vertrekker host (niet admin), host valt terug op `admin_id`. Was hij admin+host, host → nieuwe admin. [CONFIRMED]
2. **Admin wijst host aan**: `ff_set_host` zet `host_id = target` (target moet lid zijn). [CONFIRMED]
3. Host bepaalt het **afleveradres** voor de geconsolideerde zending — alle orders krijgen `host_user_id = host` bij plaatsing. [CONFIRMED — `ff_create_orders_on_placement`]

**Wie betaalt wat.** Host-wissel raakt geen betalingen; alleen het bezorgadres. [CONFIRMED]

**Wat als het faalt.**
- **Host-wissel ná `placed`** → `ff_set_host` heeft géén expliciete status-guard, MAAR de orders zijn al aangemaakt met `host_user_id` van het moment van plaatsing. Een latere `ff_set_host` verandert `flowva_groups.host_id` maar **niet** de reeds-ingevroren `orders.host_user_id`. **[TO-VERIFY] BELANGRIJK**: `ff_set_host` mist een `status='gathering'`-check (anders dan kick/leave/settings die die check wél hebben). Een admin kan post-placement de host wijzigen zonder effect op de echte zending — verwarrend en mogelijk een adres-mismatch. Voeg status-guard toe of negeer bewust.
- **Host heeft geen geldig/volledig bezorgadres** → het echte adres komt uit het host-profiel bij BuckyDrop-plaatsing. **[TO-VERIFY]**: waar wordt het host-adres uitgelezen en gevalideerd vóór `place-bucky-order`? Niet zichtbaar in FF-SQL; check `place-bucky-order/index.ts` of het `host_user_id`-adres gebruikt i.p.v. `user_id`-adres. **KRITIEK**: als de edge function het adres van de **order-eigenaar** (lid) gebruikt i.p.v. de **host**, gaat elk pakket naar het verkeerde adres en breekt de consolidatie.
- **Host vertrekt na placement** → kan niet (leave geblokkeerd na `placed`). Adres staat vast. [CONFIRMED]

**System action.** `ff_set_host` (RPC); `host_user_id` bevroren bij plaatsing. **Tag: [CONFIRMED] met 2× [TO-VERIFY].**

---

## Scenario 9 — Eén lid zijn item defect/QC-mismatch binnen de groep

**Trigger.** Na plaatsing en inkoop arriveert het lokale Chinese magazijn; BuckyDrop QC (verplicht foto + meet-pakket) meldt een defect via "Notify Po Pending" (velden `confirmType` + `picList`), óf het lid besluit zelf z'n item te annuleren vóór internationale verzending.

**Flow.**
1. **Lid annuleert eigen item**: `ff_cancel_group_order(order_id)` → alleen eigen order, alleen als status NIET in (`shipped_international`,`delivered`,`cancelled`) én `group_shipping_paid=false` → `refund_order(order_id, 'Member cancelled during QC')`. [CONFIRMED]
2. `refund_order` refundt `quoted_total` naar balance + `refund`-tx, zet order `cancelled`. Is de **hele per-lid fee-eenheid** (`request_group_id = FF-G-...-<userhex>`) nu leeg → ook de `service_fee` één keer terug als `fee_refund`. [CONFIRMED — `auto-refund.sql`]
3. De **rest van de groep loopt door** — alleen dit ene item valt eruit. [CONFIRMED — comment "groep loopt door"]

**Wie betaalt wat.** Het lid met het defecte/geannuleerde item krijgt productprijs (+ evt. fee als z'n hele deel weg is) terug **naar in-app saldo**. Andere leden onaangeroerd. [CONFIRMED]

**Wat als het faalt.**
- **Refund gaat naar in-app saldo, niet naar Stripe** → wettelijk (EU-herroeping) moet refund naar de **originele betaalmethode**. Dit is dezelfde bekende gap als solo. **[TO-VERIFY] JURIDISCH**: group-cancel erft het saldo-refund-probleem; `/returns`+`/withdraw` dekken het herroepingspad maar `refund_order` stort naar saldo. Moet naar Stripe-refund.
- **Defect ná `shipped_international` of na betaalde verzending** → `ff_cancel_group_order` weigert ("Too late" / "Shipping already paid — contact support"). Vanaf hier: handmatig support-pad, want annuleren zou het **gewichtsaandeel van de anderen** verschuiven (zij betaalden al verzending op basis van het oude totaalgewicht). [CONFIRMED — expliciete guard + comment]
- **De per-lid fee-eenheid telt mee**: `request_group_id` voor `refund_order` is **per lid** (`FF-G-...-<userhex>`), niet de hele groep. Dus de fee-refund-logica ("hele aanvraaggroep leeg") werkt per lid: als een lid 2 items had en 1 annuleert, blijft de fee staan; pas bij annulering van zijn láátste item gaat zijn fee terug. [CONFIRMED — `v_mgroup` constructie]
- **Defect-webhook (Notify Po Pending) automatisch verwerken** → de FF-SQL bevat **geen** koppeling die een binnenkomend BuckyDrop-defect automatisch op de juiste group-order mapt of het lid notificeert. **[TO-VERIFY]**: hoe komt `confirmType`/`picList` bij het juiste lid? Vereist mapping BuckyDrop PO ↔ `orders.id` ↔ `ff_group_id`. Zie `buckydrop-webhook/index.ts`. Dit is de "BuckyDrop failure-flow" die volgens de fulfillment-SQL nog apart uitgewerkt moet worden.
- **[ASSUMED]** QC-foto's (verplicht ¥6-pakket) zijn het retour-bewijs per item; bij groep idem per order/lid.

**System action.** `ff_cancel_group_order` → `refund_order` (RPC, service-side); BuckyDrop "Notify Po Pending"-webhook **[TO-VERIFY]**. **Tag: [CONFIRMED] kern / [TO-VERIFY] webhook-mapping + Stripe-refund.**

---

## Scenario 10 — Group-refund-split (deel-annulering, fee- en goederen-verdeling)

**Trigger.** Eén of meer leden annuleren tijdens QC; de groep wordt niet volledig geleverd.

**Flow.**
1. Per geannuleerd item: `refund_order` boekt productprijs terug naar het **juiste lid** (`v_order.user_id`). Geld blijft per persoon gescheiden — er is **geen gedeelde pot**. [CONFIRMED]
2. Fee gaat terug per-lid-eenheid (zie Scenario 9). Geen fee van lid A wordt aan lid B terugbetaald. [CONFIRMED — fee-tx hangt aan `v_first_oid` van dát lid]

**Wie betaalt wat.** Strikt per lid: ieder draagt/krijgt alleen zijn eigen goederen + eigen fee terug. De groepsstructuur deelt **alleen verzending** (Scenario 12), niet goederen of fees. [CONFIRMED]

**Wat als het faalt.**
- **Verzending al betaald** → een annulering ná `ff_pay_group_shipping` herverdeelt het gewichtsaandeel niet automatisch; geblokkeerd → support. **[TO-VERIFY]**: er is geen RPC die verzend-refund + gewicht-herverdeling onder de overige leden doet. Handmatig pad. Dit is de zwaarste open edge.
- **Halve groep annuleert vóór verzending** → resterende leden krijgen bij `ff_pay_group_shipping` een **hoger** gewichtsaandeel (minder leden delen het first-weight-blok), maar nog steeds goedkoper dan solo. `weight_grams`-filter telt alleen `status<>'cancelled'`. [CONFIRMED]
- **Alle leden annuleren vóór verzending** → alle orders `cancelled`, niemand kan verzending betalen (`ff_pay_group_shipping` geeft "No items"). Groep blijft `placed` met louter `cancelled` orders. **[TO-VERIFY]**: wordt de groep dan op `cancelled`/`closed` gezet? Geen trigger gezien die `placed→cancelled` doet bij volledige order-annulering.

**System action.** `refund_order` per item; verzend-herverdeling = **support [TO-VERIFY]**. **Tag: [CONFIRMED] kern / [TO-VERIFY] herverdeling.**

---

## Scenario 11 — Group-fee-boekhouding (ledger-correctheid)

**Trigger.** Elke plaatsing en elke refund moet ledger-neutraal en auditbaar zijn.

**Flow (bij plaatsing, per lid).**
1. Bij ready: `−charge` als `group_hold` (saldo al af). [CONFIRMED]
2. Bij plaatsing: `+held_amount` als `group_hold_release` (release in log; saldo niet geraakt), dan `−line` per item als `order`, dan `−fee` als `service_fee`. Som = `+held − Σlines − fee`. Omdat `held = Σlines + fee` (uit `ff_set_ready`), is de netto log-mutatie **0**. [CONFIRMED — comment "netto 0"]
3. `v_member_fee := held_amount − member_total` → fee wordt **afgeleid van het daadwerkelijk vastgehouden bedrag**, niet herberekend → consistent met wat het lid betaalde, ook als het tier intussen anders zou rekenen. [CONFIRMED]

**Wie betaalt wat.** Ledger reflecteert exact: goederen als `order`, fee als `service_fee`, beide per lid, geconsolideerd onder de per-lid `request_group_id`. [CONFIRMED]

**Wat als het faalt.**
- **Lid placed zonder hold** → `ff_create_orders_on_placement` doet `raise exception 'member ... placed without a hold'` als een lid items heeft maar `held_amount<=0` → de hele plaatsings-tx rollt terug. **[ASSUMED] sterk**: dit beschermt tegen gratis goederen, maar betekent ook dat een inconsistente staat de **hele** groepsplaatsing blokkeert. **[TO-VERIFY]**: kan een lid ooit `ready=true` zijn met `held_amount=0`? Trigger A zet held op 0 bij un-ready maar zet dan ook ready=false; dus ready+held=0 zou niet mogen voorkomen. Robuust, maar fragiel als een toekomstig pad ready zonder hold zet.
- **Fee = 0 (gratis tier-edge)** → `if v_member_fee <> 0` slaat de fee-tx over; geen lege `service_fee`-rij. [CONFIRMED]
- **Dubbele fee-refund** → `refund_order` checkt `not exists fee_refund` per fee-order → idempotent. [CONFIRMED]
- **Lid met 0 items bij plaatsing** → `v_first_oid` blijft null → geen orders, geen hold-release, geen fee → "geen lege-mand-lek". [CONFIRMED]

**System action.** Transactietypes `group_hold` / `group_hold_refund` / `group_hold_release` / `order` / `service_fee` / `refund` / `fee_refund`. **Tag: [CONFIRMED].**

---

## Scenario 12 — Group-consolidatie + verzending splitsen (gewicht-split)

**Trigger.** Alle groepsitems zijn ingekocht, in het magazijn aangekomen en **gewogen** (`orders.weight_grams` gevuld door BuckyDrop). Lid opent verzending → `ff_pay_group_shipping`.

**Flow.**
1. Som groepsgewicht `v_total_weight` over alle niet-cancelled group-orders. [CONFIRMED]
2. **Gate**: weiger als er nog ongewogen orders zijn (`weight_grams=0`) → "Shipping opens once every item in the group has reached the warehouse and been weighed". Dit garandeert dat ELK lid door **hetzelfde** totaalgewicht deelt → het first-weight-blok wordt exact één keer geteld. [CONFIRMED — kern van de besparing]
3. `ship_combined = €9 first (0.5kg) + max(0, totaalkg − 0.5) × €8.5/kg`. Jouw aandeel = `ship_combined × (my_weight/total_weight)`, ×1.3 buffer. VAT = 21% over (jouw goederen + jouw verzendaandeel, ongebufferd). Totaal van balance. [CONFIRMED — tarieven gelijk aan `pay-shipping.sql` per comment]
4. `group_shipping_paid=true` op jouw orders; `shipping`-tx. [CONFIRMED]

**Wie betaalt wat.** Elk lid betaalt zijn **gewichtsaandeel** van één gecombineerd first-weight-blok + 21% DDP-BTW. Zwaardere bijdrage = groter aandeel. Samen altijd goedkoper dan ieder een eigen €9-blok. [CONFIRMED]

**Wat als het faalt.**
- **Niet alle items gewogen** → betaling geblokkeerd (zie gate). Voorkomt dat vroege betalers door een lager totaal delen en het blok dubbel betaald wordt. [CONFIRMED]
- **Lid annuleert ná dat anderen verzending betaalden** → gewichtsaandeel klopt niet meer; `ff_cancel_group_order` blokkeert dit (`group_shipping_paid`-guard). Support-pad. [CONFIRMED]
- **Mijn gewicht of totaal = 0** → "Weights not known yet". [CONFIRMED]
- **Al betaald** → "Shipping already paid". [CONFIRMED]
- **Consolidatie naar één fysiek pakket + wie drukt "verzend"** → **[TO-VERIFY]**: de SQL betaalt het gewichtsaandeel maar regelt **niet** de daadwerkelijke BuckyDrop-parcel-consolidatie (welke `place-parcel`/channel-carriage-call, wie triggert internationale verzending zodra iedereen betaald heeft). Comment erkent dit als open BuckyDrop-werk. KRITIEK voor de echte fulfilment.
- **Niet iedereen betaalt verzending** → pakket kan niet weg. **[TO-VERIFY]**: geen mechanisme dat wacht-op-iedereen afdwingt of een wanbetaler na X tijd uit de consolidatie haalt. Mogelijk gijzelt één wanbetaler de hele zending.
- **Overweight/supplement** (PO orderStatus 4, zwaarder dan eerst geschat) → reconcile estimate↔actual. **[TO-VERIFY]**: group-pad heeft geen supplement-RPC; hoe verdeelt een na-weeg-supplement over leden?

**System action.** `ff_pay_group_shipping` (RPC). Echte parcel-consolidatie = **[TO-VERIFY] BuckyDrop-call**. **Tag: [CONFIRMED] geld / [TO-VERIFY] fysieke consolidatie.**

---

## Scenario 13 — Hold/deduct bij ready: prijswijziging vlak vóór bevestiging (price-guard)

**Trigger.** Lid drukt *Confirm & pay*; een leverancier (1688/Taobao) heeft net de prijs gewijzigd.

**Flow.**
1. Client roept eerst `checkGroupPrices` (edge `check-cart-prices`) → bij `anyChanged` worden die `source_url`'s "on hold" getoond; geen afschrijving. Fail-open bij netwerkfout. [CONFIRMED — `ffApi.js`]
2. Server-side dubbele beveiliging in `ff_set_ready`: per item leidt het de prijs uit `public.products` af; `price is null` → "no longer available"; `price_alert=true` → "the price changed — review it"; bij afval wordt `locked_price` teruggedraaid (geen half-vergrendelde staat). [CONFIRMED]

**Wie betaalt wat.** Niets tot de prijs weer klopt; lid betaalt de **server-prijs**, nooit de (mogelijk verouderde) client-prijs. [CONFIRMED]

**Wat als het faalt.**
- **Client-guard onbereikbaar** → fail-open, maar `ff_set_ready` vangt het server-side alsnog af. [CONFIRMED]
- **Prijs stijgt tussen guard en ready** → server-prijs wint; lid betaalt het nieuwe (hogere) bedrag of krijgt de alert. [CONFIRMED]
- **Onbekend product** (uit feed verwijderd) → "no longer available", item moet eruit. [CONFIRMED]
- **[TO-VERIFY]** Race: prijs verandert ná `ff_set_ready` maar vóór `place-bucky-order` inkoopt → solo-pad heeft hier de price-guard bij checkout; group-orders gaan via dezelfde `place-bucky-order` met `quote_accepted`. Bevestig dat de edge function een laatste prijscheck doet en bij mismatch `refund_order` draait (zelfde failure-principe).

**System action.** `check-cart-prices` edge + `ff_set_ready` server-prijs. **Tag: [CONFIRMED] / [TO-VERIFY] post-ready race.**

---

## Scenario 14 — Insufficient balance bij ready

**Trigger.** Lid drukt *Confirm & pay* maar saldo < `charge`.

**Flow.** `ff_set_ready` lockt profiel `for update`, vergelijkt balance < charge → return `{ok:false, error:'Insufficient balance', needed}`. UI: "Insufficient balance — you need €X. Top up first, then confirm." Geen ready, geen hold. [CONFIRMED]

**Wie betaalt wat.** Niets; lid moet eerst topup-en. [CONFIRMED]

**Wat als het faalt.**
- **Topup-race**: lid topup-t in een ander tabblad terwijl ready faalt → opnieuw drukken werkt zodra balance toereikend is (`for update` voorkomt dubbel-spend). [CONFIRMED]
- **[ASSUMED]** Andere leden wachten op deze persoon → nudge (Scenario 5) is de sociale druk; geen auto-topup.

**System action.** `ff_set_ready` balance-guard. **Tag: [CONFIRMED].**

---

## Scenario 15 — Settings-wijziging mid-gather (max_size omlaag, privé togglen, admin-overdracht)

**Trigger.** Admin past groep aan via `ff_update_settings` / `ff_set_private` / `ff_set_admin`.

**Flow.**
1. **max_size**: clamp 2..7, en **nooit onder huidig ledental** (`v_new_max := v_count` als lager). UI disabelt knoppen `< members.length`. [CONFIRMED]
2. **Privé aan**: `is_private=true` → geen nieuwe joins (bestaande leden blijven). [CONFIRMED]
3. **Admin-overdracht**: `ff_set_admin` → target wordt admin, caller wordt member; settings/host-rechten verhuizen. Onomkeerbaar door de oude admin (UI waarschuwt met `window.confirm`). [CONFIRMED]

**Wie betaalt wat.** Settings raken geen geld. [CONFIRMED]

**Wat als het faalt.**
- **Settings na `placed`** → `ff_update_settings`/`ff_set_admin`/`ff_set_private` hebben status-guard `gathering` (set_admin/set_private wél; update_settings **niet** expliciet — **[TO-VERIFY]**: `ff_update_settings` mist `status='gathering'`-check, dus naam/max kan ná plaatsing nog wijzigen; harmless maar inconsistent).
- **max omlaag terwijl join in flight** → `for update`-lock serialiseert (max_size-check in join leest na lock). [CONFIRMED]
- **Admin draagt over aan zichzelf** → no-op (`p_user_id = v_uid` → ok zonder wijziging). [CONFIRMED]
- **Geen admin meer** kan niet: overdracht zet altijd precies één admin; leave promoot oudste lid. [CONFIRMED]

**System action.** `ff_update_settings` / `ff_set_private` / `ff_set_admin` (RPC's). **Tag: [CONFIRMED] / [TO-VERIFY] update_settings-statusguard.**

---

## Scenario 16 — Gedeeld item overnemen + race op de shared cart

**Trigger.** Lid deelt een product/item in de chat (`ff_share_item`/`ff_share_product`); ander lid tikt "+ Add to my cart" (`doAddShared` → `ff_add_item`).

**Flow.** Het overgenomen item wordt een **nieuw eigen item** van de overnemer (eigen `owner_id`), prijs blijft indicatief tot ready. Toevoegen reset alleen de eigen ready. [CONFIRMED]

**Wie betaalt wat.** Ieder betaalt zijn eigen kopie; delen kopieert, deelt geen kosten. [CONFIRMED]

**Wat als het faalt.**
- **Origineel item intussen verwijderd** → `ff_share_item` valideert dat het item bestaat bij delen; bij overnemen kopieert de client de snapshot-velden, dus een verwijderd origineel blokkeert overnemen niet (snapshot). [CONFIRMED — `doAddShared` kopieert velden]
- **Avatar-/PII-lek via shared content** → avatars alleen van eigen Supabase-storage gerenderd (anders IP-harvest). [CONFIRMED — `isStorageUrl`]
- **Reactie-race** → `ff_react` lockt het bericht `for update` → geen lost-update bij gelijktijdige reacties. [CONFIRMED]

**System action.** `ff_share_item`/`ff_share_product`/`ff_add_item`/`ff_react`. **Tag: [CONFIRMED].**

---

## Scenario 17 — Realtime/stale-state edge cases (lobby-sync)

**Trigger.** Twee leden manipuleren tegelijk; realtime valt weg; lid heeft een verouderde lobby.

**Flow.** Eén realtime-kanaal per groep volgt `groups/members/items/messages`; bij elk event `refreshLobby` (of `loadMessages`). 15s fallback-poll vangt realtime-uitval. `held_amount` wordt uit de **echte** server-rij gelezen, niet client-geschat. [CONFIRMED]

**Wie betaalt wat.** Geen geldimpact; alleen UI-consistentie. [CONFIRMED]

**Wat als het faalt.**
- **Stale fetch overschrijft nieuwe state** → `openIdRef`-guard negeert late/stale fetches bij navigatie. [CONFIRMED]
- **DELETE-event lekt velden** → bewust geen `replica identity full`; DELETE draagt alleen PK → geen `held_amount`/PII naar ex-leden. [CONFIRMED]
- **Lid niet meer in groep** → `ffFetchGroup` geeft error → terug naar lijst met "no longer available", ruimt actieve-groep-pil op. [CONFIRMED]
- **Busy-vlag breekt kanaal** → busy via refs gelezen zodat het kanaal niet bij elke actie heropent (anders vielen events weg). [CONFIRMED]

**System action.** `subscribeGroup` + 15s poll + `openIdRef`/busy-refs. **Tag: [CONFIRMED].**

---

## Open punten (samengevat, prioriteit voor de oprichter)

1. **[TO-VERIFY] KRITIEK — geen expiry/cron**: `fill_deadline` (48h) wordt gezet maar geen geziene job zet `gathering→expired` en geeft holds vrij. Geld kan onbeperkt vastgehouden worden bij een nooit-volle groep. (Scenario 5/7)
2. **[TO-VERIFY] KRITIEK — host-adres bij BuckyDrop**: bevestig dat `place-bucky-order` het **host**-adres (`host_user_id`) gebruikt, niet het lid-adres, anders gaat de consolidatie naar het verkeerde adres. (Scenario 8)
3. **[TO-VERIFY] KRITIEK — fysieke parcel-consolidatie**: `ff_pay_group_shipping` int het geld maar regelt de BuckyDrop-parcel-merge + internationale verzending niet; en één wanbetaler kan de zending gijzelen. (Scenario 12)
4. **[TO-VERIFY] JURIDISCH — refund naar Stripe**: group-cancel/QC-refund stort naar in-app saldo i.p.v. originele betaalmethode (EU-herroeping). Erft de bekende solo-gap. (Scenario 9)
5. **[TO-VERIFY] — defect-webhook-mapping**: hoe mapt "Notify Po Pending" (`confirmType`+`picList`) op de juiste group-order/lid + notificatie? (Scenario 9)
6. **[TO-VERIFY] — verzend-herverdeling na late annulering**: geen RPC voor verzend-refund + gewicht-herverdeling; nu support-only. (Scenario 10/12)
7. **[TO-VERIFY] — `ff_set_host` + `ff_update_settings` missen status-guard** (inconsistent met kick/leave). (Scenario 8/15)
8. **[TO-VERIFY] — groep blijft `placed` als álle orders cancelled raken**: geen `placed→cancelled/closed`-overgang gezien. (Scenario 10)
