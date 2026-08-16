import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { LangProvider } from './i18n.js'
// Bezoekersstatistieken (2026-08-16): telt bezoekers, pagina's, land en herkomst
// (bv. TikTok) in het Vercel-dashboard. Cookieloos en zonder persoonsgegevens,
// dus geen cookiebanner nodig. Draait alleen op flowva.app, niet lokaal.
import { Analytics } from '@vercel/analytics/react'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LangProvider>
      <App />
      <Analytics />
    </LangProvider>
  </StrictMode>,
)
