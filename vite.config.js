import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true
  },
  // Build-stempel (UTC) — zichtbaar onderin het profiel, zodat je op elk toestel
  // meteen ziet of het de nieuwste deploy draait (PWA/browser-cache-debughulp).
  define: {
    __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'),
  },
})