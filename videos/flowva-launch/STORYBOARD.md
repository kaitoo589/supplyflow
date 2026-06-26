---
format: portrait
message: Dropshippers mark factory goods up 3-4x and hide the source. Flowva shows the real factory price plus one small visible fee — and lets you shop together to split the shipping.
arc: PAS (Problem - Agitate - Solve), reveal compressed-early
audience: Gen-Z and younger millennial EU shoppers (Netherlands first) — price-aware, TikTok-native, already on Shein / AliExpress, used to dropshipping and buying together
language: English
music: calm minimal piano under the hook, one low tension note through the agitation, a warm resolve and light rising pulse the moment Flowva is revealed, gentle confident lift into the CTA — never hype, never an EDM drop
---

## Video direction

- palette: warm canvas #F8F7F4 ground on every frame; ink #111111 display + ink-soft #6E6B66 body (Inter); cards #FFFFFF with hairline #ECEAE5 and a soft layered shadow (0 1px 2px rgba(17,17,17,.04), 0 10px 30px rgba(17,17,17,.07)); radii 10–24px. ACCENT vos-orange #FF5C00 is rationed — it does NOT appear at all in Frames 1–2 (the problem is colourless/grey), debuts as a single dot in Frame 3, owns ONLY the 1688 source link + its underline in Frame 4, the final landed shipping figure in Frame 6, and the whole CTA in Frame 7. accent-soft #FFF0E7 only as the CTA halo.
- motion defaults + shot model: iOS-spring physics ONLY — eases like back.out / power3.out / elastic springs, NEVER linear or CSS transitions. Every frame is a directed shot: entrance → development → settle, with a slow macro push/drift running underneath the whole shot. Press 0.96/1.02, rise-in (y 16→0), 0.06s stagger, morph for shared elements. The single orange dot is a through-line: planted in Frame 3, it morphs into the Join button in Frame 7 (visual bookend).
- idle budget during settles: only the macro drift + one breathing element (sine-wave-loop) keep moving; nothing else floats.
- negative list: no pure #000 / pure #fff; no hard-black borders or sharp corners; no linear easing, no CSS transitions, no repeat/yoyo-to-fill; no slideshow (enter-then-freeze) and no screensaver (everything floating independently); no narration SENTENCES rendered as body text — only short motion-graphics copy (headline / stat / one phrase). App surfaces are built natively in HTML/CSS from frame.md tokens, NEVER screenshots.
- stillness allocation: only Frame 7 (CTA) holds as a deliberate settle/breathe; every other frame develops mid-shot.
- canvas: portrait 1080×1920; all content in the top ~83% (≤ 1600px); hero anchored high (~0.25–0.35h); fill the column — don't float one small cluster mid-frame.

## Frame 1 — The price gap

- scene: Warm off-white canvas (#F8F7F4). Two numbers rise and lock, stacked: "You paid €32." then under it "The factory charged €8." A faint grey question mark sits where the gap is.
- voiceover: "You paid thirty-two euros. The factory charged eight."
- duration: 4s
- transition_in: cut
- status: outline
- src: compositions/frames/01-the-price-gap.html
- type: hook
- persuasion: Negative contrast
- beat: skepticism
- effects: kinetic-beat-slam, 3d-text-depth-layers, sine-wave-loop
- focal: none (typography-only)
- roles: none
- asset_candidates:
- narrativeRole: Open hard on a concrete, sound-off-legible number gap so the viewer feels marked-up before they know who to blame — the whole video answers this one gap.
- keyMessage: The price you paid and the real factory price are 4x apart.
- composition: Compose. On-screen copy is short numerals/labels, NOT the spoken sentence. Entrance — "You paid €32" slams down from the top on beat 1 as giant ink display type with a subtle 3d-text-depth-layers stack (heavy, expensive). Development — "The factory charged €8" snaps in beneath on beat 2 at a calmer, smaller weight; a faint grey "?" sits in the gap between them. Settle — the "?" pulses once (sine-wave-loop) under a slow push. No orange anywhere — colourless on purpose. €32 anchored high (~0.28h), everything above 1600px.

## Frame 2 — Where it went, and what else bites

- scene: The €8 stays small while a grey bar labelled "dropshipper markup" stretches it up to €32, then three grey friction chips drop and stack beside it: "Shipping eats cheap items", "Customs at the door", "Quality? A gamble". The screen feels heavy and cluttered.
- voiceover: "A reseller marked it up and hid the source. Then shipping, customs, and quality you just gamble on."
- duration: 5s
- transition_in: push-slide UP
- status: outline
- src: compositions/frames/02-where-it-went.html
- type: pain_point
- persuasion: Rule of three
- beat: frustration
- effects: stat-bars-and-fills, center-outward-expansion, sine-wave-loop
- focal: none (typography + vector)
- roles: none
- asset_candidates:
- narrativeRole: Name the villain and the mechanism, then pile the three secondary pains in one frame so the status quo feels fully broken right before relief — compressed so the reveal lands early.
- keyMessage: Hidden markup is only the start — shipping, customs, and quality all bite too.
- composition: Compose. Entrance — small €8 sits low; a grey "dropshipper markup" bar grows upward (stat-bars-and-fills scaleY) stretching €8 → €32, heavy and dull. Development — three grey friction chips ("Shipping eats cheap items", "Customs at the door", "Quality? A gamble") stagger in around the bar (center-outward-expansion, 0.06s stagger, Rule-of-three rhythm), crowding the frame so it feels cluttered. Settle — the cluster sags with a slow downward drift (sine-wave-loop) under the macro push. Still no orange. Bar top + all chips above 1600px.

## Frame 3 — What if nothing was hidden

- scene: Typography-only. The grey clutter wipes away to clean warm canvas; the word "alone" crosses out and "nothing was hidden" rises in its place: "What if nothing was hidden?" One small vos-orange dot blinks on for the first time.
- voiceover: "What if you could just buy straight from the factory — nothing hidden?"
- duration: 3s
- transition_in: blur-crossfade
- status: outline
- src: compositions/frames/03-what-if-nothing-hidden.html
- type: product_intro
- persuasion: Future pacing
- beat: relief
- effects: discrete-text-sequence, css-marker-patterns, sine-wave-loop
- focal: none (typography-only)
- roles: none
- asset_candidates:
- narrativeRole: The turn — clear the screen and the tension, plant the first orange as a relief signal, and state the brand thesis verbatim without naming the product yet.
- keyMessage: There is a way to shop where nothing is hidden.
- composition: Compose. Entrance — grey clutter wipes away to clean warm canvas; the word "hidden" of an earlier "hidden costs" idea resolves — show the line "What if nothing was hidden?" with the small word "alone" struck through (css-marker-patterns sketchout/strike) as it gives way. Development — the headline settles via discrete-text-sequence (state swap, not per-char) rising into place; the FIRST vos-orange dot blinks on beside the period. Settle — the orange dot breathes (sine-wave-loop). Plant this dot deliberately — it returns in Frame 7. Airy, lots of canvas, one calm question centered ~0.4h.

## Frame 4 — Meet Flowva, the real price

- scene: The Flowva wordmark settles in ink, then the feed slides up: factory cards each with a 1-4 diamond rank. One card opens to a transparent breakdown — factory price + a small visible 8% fee — and the raw 1688 source link underlines itself in vos-orange.
- voiceover: "Flowva. The real factory price, one small visible fee — and the raw source link, shown."
- duration: 5s
- transition_in: push-slide UP
- status: outline
- src: compositions/frames/04-meet-flowva.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: trust
- blueprint: brand-reveal-assemble-zoom
- effects: coordinate-target-zoom, svg-path-draw, sine-wave-loop
- focal: the transparent price-breakdown card (built natively in HTML)
- roles: factory-cards = supporting (native HTML feed, dim none); price-card = focal (native HTML)
- asset_candidates:
- narrativeRole: The reveal, now early at ~13s — name Flowva and immediately pay off Frame 1's gap on real app surfaces: the hidden price, opened, down to the source link.
- keyMessage: Flowva shows the true factory price, the fee, and the original 1688 source — nothing hidden.
- composition: Adapt. Base: brand-reveal-assemble-zoom · Keep: the assemble-then-camera-zoom signature · Depart: instead of a logo image, the "Flowva" wordmark assembles in ink, then a feed of #FFF factory cards (hairline border, soft shadow, a 1–4 diamond rank glyph each) slides up, and the camera (coordinate-target-zoom) pushes into ONE card that opens into a transparent price breakdown — rows "Factory price  €8.00" + "Flowva fee 8%  €0.64" + total, stacked in ink — and a raw "1688.com" source link whose underline draws itself in vos-orange (svg-path-draw). Entrance: wordmark assembles. Development: feed slides up, camera zooms into the opened card, price rows stagger in. Settle: the orange 1688 underline finishes drawing and holds; gentle breath. Orange ONLY on that link/underline. All UI built natively from frame.md tokens — no screenshots.

## Frame 5 — Checked before it ships

- scene: Same product surface continues. A quality-control card flips up: inspection tick plus a measurement photo with size overlays. A calm "DDP — 21% VAT included" chip sits underneath, no orange.
- voiceover: "Every item inspected and measured before it ships. VAT included — no surprise at the door."
- duration: 4s
- transition_in: push-slide UP
- status: outline
- src: compositions/frames/05-checked-before-it-ships.html
- type: benefit_highlight
- persuasion: Risk reversal
- beat: trust
- effects: orbit-3d-entry, svg-path-draw, ai-tracking-box
- focal: the quality-control card (native HTML)
- roles: qc-card = focal (native HTML); ddp-chip = supporting
- asset_candidates:
- narrativeRole: Knock down the leftover pains from Frame 2 (quality gamble, customs surprise) so the only objection left is the one the kicker answers — shipping on cheap items.
- keyMessage: Inspected, measured, and VAT-paid before it ever reaches your door.
- composition: Compose. Entrance — a single #FFF quality-control card flips up into view (orbit-3d-entry, ONE card, settles flat from a +rotateX). Development — a green inspection checkmark draws itself (svg-path-draw) at the card corner, and an ai-tracking-box style measurement overlay (L-bracket corners recolored to neutral ink/line — NOT yellow — plus a small "32 cm" size label) sweeps onto a simple garment silhouette inside the card; a calm "DDP — 21% VAT included" chip rises beneath. Settle — checkmark holds, slight breath. Trust beat: clean, precise, neutral — no orange. Card + chip above 1600px.

## Frame 6 — Shop together, split shipping

- scene: Flowva Friends: round avatars ready-up one by one, a shared cart fills, items consolidate into ONE parcel. A per-item shipping number ticks DOWN as each friend joins — €11.70 → €5.80 → €3.90 — landing on a bold vos-orange figure as the parcel seals.
- voiceover: "Or shop together. One parcel, split shipping — the more friends, the lower it drops."
- duration: 5s
- transition_in: push-slide UP
- status: outline
- src: compositions/frames/06-shop-together-split-shipping.html
- type: feature_showcase
- persuasion: Value stacking
- beat: belonging
- effects: avatar-cloud-network, counting-dynamic-scale, center-outward-expansion, sine-wave-loop
- focal: the shrinking per-item shipping figure (native HTML)
- roles: friend-avatars = supporting; parcel = supporting; shipping-figure = focal
- asset_candidates:
- narrativeRole: The kicker and emotional peak — turn the last, most-felt objection (shipping kills cheap items) into the most shareable, social reason to act, as a number the viewer watches drop.
- keyMessage: Buying together collapses shipping into one parcel and one shrinking cost.
- composition: Compose. Entrance — 3–4 round friend avatars "ready up" one by one on an arc (avatar-cloud-network recolored to brand neutrals; hub = a shared cart). Development — as each avatar lights up, small item tiles fly INWARD and consolidate into ONE parcel at center (center-outward-expansion run in reverse), and a big per-item shipping figure counts DOWN in steps €11.70 → €5.80 → €3.90 (counting-dynamic-scale — the number is the hero; let its weight grow as it lands). The €3.90 lands in BOLD vos-orange as the parcel seals — emotional peak. Settle — the orange figure breathes once (sine-wave-loop). Orange owns ONLY the final landed figure. Warm, social, satisfying.

## Frame 7 — Join Flowva

- scene: Everything resolves to calm warm canvas. Flowva wordmark centred, the one orange dot grows into the primary button "Join Flowva". Under it, soft ink-soft line: "Shop factory-direct · flowva.app".
- voiceover: "Shop factory-direct, nothing hidden. Join Flowva at flowva dot app."
- duration: 3s
- transition_in: blur-crossfade
- status: outline
- src: compositions/frames/07-join-flowva.html
- type: cta
- persuasion: Category announcement
- beat: urgency-to-act
- blueprint: cta-morph-press
- effects: scale-swap-transition, sine-wave-loop
- focal: the "Join Flowva" button (native HTML)
- roles: none (typography + button)
- asset_candidates:
- narrativeRole: Land the single action while trust is at its peak and the orange finally owns the whole screen — bookending the dot planted at the turn.
- keyMessage: Factory-direct shopping has a home — flowva.app — and joining is one tap.
- composition: Adapt (this is the allocated STILLNESS frame). Base: cta-morph-press · Keep: the morph-into-CTA + tactile press signature · Depart: the source of the morph is the single orange dot planted in Frame 3 (bookend) — it travels to center and scale-swaps (scale-swap-transition, back.out(2)) into the primary "Join Flowva" pill in vos-orange with an accent-soft #FFF0E7 halo; the "Flowva" wordmark settles in ink above it, and a soft ink-soft subline "Shop factory-direct · flowva.app" fades in below. Entrance (dot arrives) → development (morph to button) → settle (button breathes gently, sine-wave-loop). Orange finally owns the whole screen. Everything centered, top 83%.
