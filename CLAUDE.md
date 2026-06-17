# SupplyFlow

B2B-dropship/sourcing-app (NL eigenaar, Engelstalige klant-UI). Vite + React 19 + Supabase + Stripe.

## Commands

- `npm run dev` — dev-server (draait meestal al op poort 5180 via Claude preview)
- `npm run lint` — eslint
- Supabase: SQL-bestanden in `supabase/` worden handmatig gedraaid via dashboard → SQL Editor. Edge functions deployen met `supabase functions deploy <naam>`.

## Architectuur

- `src/App.jsx` routeert op rol uit `profiles.role`: customer → `supplyflow-app.jsx`, agent → `AgentPanel.jsx`, admin → `supplyflow-admin.jsx`. Geen router; "pagina's" zijn fullscreen overlays met framer-motion.
- `src/supabase.js` — gedeelde client (publishable key, mag in code).
- `src/theme.js` — alle design-tokens (Apple-clean, vos-oranje `#FF5C00`). Nooit kleuren hardcoden in componenten; altijd via `theme`.
- `src/motion.js` — iOS-stijl spring-presets (`springSoft`, `springSnappy`, `springMorph`, `pressable`, …). Alle animaties gebruiken deze presets, geen losse easing/durations.
- Styling: inline styles met theme-tokens. Geen CSS-framework.
- `src/SupportWidget.jsx` — versleepbare support-chat (klanten). Schrijft naar `support_questions`, roept edge function `support-answer` aan (Claude beantwoordt uit `support_kb`, escaleert bij twijfel). Geëscaleerde vragen worden missies in het ops-hud project (`C:\Users\Kaito\ai-ops-hud`).

## Conventies

- Klantgerichte UI-teksten in het **Engels**; codecommentaar mag Nederlands.
- Supabase-error handling: clients geven `{ data, error }` terug — altijd `error` checken, nooit aannemen dat het lukte.
- RLS is leidend: klanten zien alleen eigen rijen, admin alles (helper `is_admin()`).

## Let op

- Secret keys nooit in code of commits. De service-role key heeft eerder bloot gestaan en moet nog geroteerd worden.
- `supabase/SUPPORT-SETUP.md` beschrijft de resterende deploy-stappen van het supportsysteem.
