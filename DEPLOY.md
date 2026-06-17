# SupplyFlow — deployen naar het internet

Dit is een **test-/staging-deploy** (niveau 1): de app komt op een echt
internetadres, maar nog niet "open voor betalende klanten". Voor dat laatste
(niveau 2) zie onderaan de checklist — dat hangt o.a. aan je KvK (2 juli).

Er zijn **twee aparte apps** met één gedeelde Supabase-backend (die staat al online):

| App | Map | Wordt | Poort lokaal |
|-----|-----|-------|--------------|
| Klant-app | `C:\Users\Kaito\supplyflow` | bv. `vable.store` | 5180 |
| Admin-dashboard | `C:\Users\Kaito\ai-ops-hud` | bv. `admin.vable.store` | 5181 |

## Wat al is voorbereid (code/config — klaar)
- `vercel.json` in beide projecten (juiste build + SPA-routing voor o.a. `/reset-password`).
- `src/supabase.js` leest nu uit env-vars met een veilige fallback (lokaal blijft werken).
- `.env.example` per project met precies de vars die je in Vercel zet.
- `.gitignore` laat `.env.example` wél toe maar houdt je echte `.env` buiten git.

## Wat jij doet (in je eigen accounts — ik kan hier niet inloggen)

### 0. Vereiste: een (gratis) Vercel-account
Maak er één aan op vercel.com en koppel je GitHub (handigst).

### 1. Klant-app deployen (supplyflow)
Dit is al een git-repo. Push hem naar een GitHub-repo en:
1. Vercel → **Add New… → Project** → importeer de `supplyflow`-repo.
2. Framework wordt automatisch **Vite** herkend (build = `npm run build`, output = `dist`).
3. Zet onder **Environment Variables** (zie tabel onderaan):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_HUD_URL` → vul later in (stap 3)
4. **Deploy**. Je krijgt een URL als `supplyflow-xxxx.vercel.app`.

### 2. Admin-dashboard deployen (ai-ops-hud)
Dit is nog **geen git-repo**. Eenmalig in die map:
```powershell
cd C:\Users\Kaito\ai-ops-hud
git init
git add .
git commit -m "Initial commit"
```
Push naar een (aparte) GitHub-repo, en importeer die net als hierboven in Vercel.
Zet als env-vars: `VITE_SUPABASE_URL` en `VITE_SUPABASE_PUBLISHABLE_KEY`.
Deploy → je krijgt een URL als `ai-ops-hud-xxxx.vercel.app`.

> Geen zin in GitHub? Dan kan ook met de Vercel CLI: `npm i -g vercel`, dan
> `vercel` in de projectmap (deployt direct vanaf je schijf, zonder git).

### 3. De twee koppelen
Ga naar het **klant-app**-project in Vercel → Settings → Environment Variables →
zet `VITE_HUD_URL` op de admin-URL (bv. `https://admin.vable.store`, of voorlopig
de `ai-ops-hud-xxxx.vercel.app`-URL) → **Redeploy**. Nu wijst de "OPEN COMMAND
CENTER"-knop voor admins naar het juiste adres.

### 4. Je domein koppelen (optioneel, kan later)
In Vercel per project → Settings → **Domains**:
- Klant-app → `vable.store` (en `www.vable.store`)
- Admin → `admin.vable.store`

Vercel toont dan de exacte **DNS-records** (een A-record / CNAME) die je bij je
domeinregistrar invult. Stuur ze me gerust, dan check ik of ze kloppen.

## Env-variabelen — overzicht
| Variabele | Klant-app | Admin | Waarde |
|-----------|:---------:|:-----:|--------|
| `VITE_SUPABASE_URL` | ✅ | ✅ | `https://bjtpnuxjbazlbaoyflcx.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | ✅ | je publishable key (Supabase → Settings → API) |
| `VITE_HUD_URL` | ✅ | — | URL van het admin-dashboard |

> De publishable key is veilig voor de browser (beschermd door RLS). Zet hier
> **nooit** de service/secret key — die hoort alleen bij Edge Functions.

## ⚠️ Vóór "open voor echte klanten" (niveau 2)
Niet nodig voor een test-deploy, wél vóór je echt geld int:
- [ ] **KvK-nummer** (2 juli) — nodig voor Stripe live + Wise-zakelijk
- [ ] **Stripe naar live-modus** + bedrijfsverificatie + bankrekening
- [ ] **Gelekte Supabase secret key roteren** (dashboard → Settings → API Keys)
- [ ] **Eigen SMTP** (Resend/SendGrid) i.p.v. de gerate-limite ingebouwde mailer
- [ ] **Juridisch**: privacy, algemene voorwaarden, retourbeleid, btw
- [ ] **Wise-automatisering** (kan pas na KvK; tot dan handmatig)
