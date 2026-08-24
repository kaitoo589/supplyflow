// Landcode van de bezoeker (22..23-08): Vercel geeft het land mee in een header op
// basis van het IP, maar wij zien en bewaren het IP zelf nooit — alleen de twee
// letters (NL, DE, ...) gaan naar de bezoek-trechter. Zie privacyverklaring 2.8.
export default function handler(req, res) {
  const land = String(req.headers['x-vercel-ip-country'] || '').slice(0, 2).toUpperCase();
  res.setHeader('cache-control', 'private, max-age=3600');
  res.status(200).json({ land: land || null });
}
