# frame.md — Flowva design-spec

> Visuele identiteit van de Flowva-app, gedestilleerd uit `src/theme.js` + `src/motion.js`
> en de live UI. Gebruik dit als design-spec voor HyperFrames-video's, promo's en mockups.

## Merk
- **Naam:** Flowva (voorheen SupplyFlow)
- **Wat:** factory-first shopping — koop direct bij de fabriek, transparante prijs + fee, samen-shoppen via "Flowva Friends".
- **Sfeer:** Apple-clean, rustig, warm, vertrouwd. Eén speels accent: vos-oranje.
- **Toon:** helder en eerlijk; geen ruis; veel witruimte.

## Palet (exact uit theme.js)
| Rol | Hex | Gebruik |
|-----|-----|---------|
| Canvas | `#F8F7F4` | warme off-white achtergrond |
| Card | `#FFFFFF` | kaarten / panelen |
| Ink | `#111111` | primaire tekst, donkere vlakken |
| Ink soft | `#6E6B66` | secundaire tekst |
| Ink faint | `#A8A5A0` | hints / placeholders |
| Line | `#ECEAE5` | hairline-randen |
| Field | `#F3F1ED` | invoervelden / zachte vlakken |
| **Accent** | **`#FF5C00`** | vos-oranje — primaire acties |
| Accent soft | `#FFF0E7` | zachte oranje achtergrond |
| On accent | `#FFFFFF` | tekst op oranje |

**Regel:** oranje is schaars — alleen voor de primaire actie of het ene ding dat aandacht vraagt. Alles daaromheen is neutraal warm-grijs.

## Typografie
- **Font:** `Inter`, fallback `Helvetica Neue`, sans-serif.
- **Hiërarchie:** zwaar/strak voor titels (ink), licht en rustig voor body (ink-soft).
- **Gevoel:** strak, modern, hoog contrast tussen kop en bijschrift.

## Vorm & diepte
- **Radius:** sm `10` · md `14` · lg `18` · xl `24` px — alles afgerond, nooit scherp.
- **Schaduw:** zacht en gelaagd — `0 1px 2px rgba(17,17,17,0.04), 0 10px 30px rgba(17,17,17,0.07)`. Kaarten "zweven" subtiel boven het canvas.
- **Randen:** hairline `#ECEAE5`, nooit hard zwart.

## Motion (exact uit motion.js — iOS-spring fysica, géén lineaire easing)
| Preset | Waarde | Wanneer |
|--------|--------|---------|
| `springSnappy` | stiffness 420, damping 30, mass 0.8 | knoppen, tik-feedback |
| `springSoft` | stiffness 240, damping 26 | schermen, kaarten die inschuiven |
| `springBouncy` | stiffness 500, damping 18, mass 0.7 | accenten (mascotte, badges) |
| `springMorph` | stiffness 300, damping 30, mass 0.9 | gedeelde elementen die van scherm wisselen |

**Patronen:**
- **Press:** `scale 0.96` indrukken, `scale 1.02` hover — knoppen "geven mee".
- **Rise-in:** opacity 0→1, y 16→0 — inhoud komt zacht omhoog.
- **Stagger:** kinderen 0.06s na elkaar binnen — lijsten bouwen zich op.
- **Collapse:** soepel in-/uitvouwen op hoogte.
- **Morph:** kaart, foto en titel bewegen synchroon tussen schermen.

## Layout & navigatie
- **Bottom-nav (5 tabs):** Feed · Orders · Warehouse · Transit · Profile. Actieve tab = vos-oranje icoon + label.
- **Feed:** fabriek-kaarten met diamant-rang (1–4).
- **Transit / Flowva Friends:** gedeelde mand → één pakket → split shipping; pakket-weergave met gewicht (g) en live verzendregel "~€x ship + VAT at checkout".
- **Status-taal:** altijd "Quality-control" voluit (nooit "QC" in de klant-app).

## Video-richtlijnen (HyperFrames)
- **Achtergrond:** canvas `#F8F7F4`, niet puur wit.
- **Beweging:** uitsluitend spring-gebaseerd (gebruik de presets hierboven) — het iOS-gevoel is het handelsmerk.
- **Accentmoment:** laat oranje pas vallen op de climax / call-to-action.
- **Ritme:** rustig, veel ademruimte; tekst rijst op met stagger.
- **Don't:** harde zwarte randen, scherpe hoeken, knallende kleuren, lineaire/abrupte easing.
