// Automatische chat-vertaling tussen klant (Engels) en agent (Chinees).
// Gebruikt de gratis MyMemory API (geen sleutel nodig, ~limiet 500 tekens
// per bericht). Bij een fout valt de chat terug op de originele tekst.

const ZH_RE = /[一-鿿]/;

// Bevat de tekst Chinese karakters?
export const hasChinese = (text) => ZH_RE.test(text || "");

// Vertaal tekst; geeft null terug als het mislukt (toon dan het origineel).
export async function translate(text, from, to) {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
    const res = await fetch(url);
    const data = await res.json();
    const out = data?.responseData?.translatedText;
    if (res.ok && out && data.responseStatus === 200) return out;
    return null;
  } catch {
    return null;
  }
}

// Engels → Chinees (klant stuurt, agent leest)
export const toChinese = (text) => translate(text, "en", "zh-CN");

// Chinees → Engels (agent stuurt, klant leest)
export const toEnglish = (text) => translate(text, "zh-CN", "en");
