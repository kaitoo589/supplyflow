// Flowva — Maattabel-extractie met Claude vision.
// Admin uploadt een (vaak Chinese) maattabel-screenshot; Claude leest de tabel
// en geeft gestructureerde data terug die het admin-formulier in de grid zet.
// Zelfde admin-gating als de buckydrop-gateway; zelfde Anthropic-patroon als
// support-answer (model claude-opus-4-8 + json_schema structured output).
//
// Secrets:  ANTHROPIC_API_KEY  (SUPABASE_URL / SUPABASE_ANON_KEY worden geïnjecteerd)
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.88.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Gevraagde JSON-vorm. rows[i] hoort bij sizes[i]; rows[i][j] bij measures[j].
// We vragen Claude direct om dit JSON-object (geen structured-output API) zodat de
// call kogelvrij werkt met vision op opus-4-8, zonder afhankelijkheid van
// output_config/thinking-combinaties.
const SHAPE_HINT = `Antwoord met UITSLUITEND een geldig JSON-object — geen uitleg, geen markdown-codeblok. Exacte sleutels en vorm:
{
  "found": true,            // boolean; false als de afbeelding geen maattabel is
  "unit": "cm",             // "cm" of "inch"; "" als onbekend
  "measures": ["Waist"],    // kolomkoppen (metingen), beknopt Engels, GEEN komma's
  "sizes": ["S","M"],       // rij-labels (maten), GEEN komma's
  "rows": [["72"],["76"]],  // rows[i] hoort bij sizes[i]; rows[i][j] bij measures[j]; "" voor onleesbaar
  "confidence": 0.9,        // getal 0-1
  "notes": ""               // korte opmerking of ""
}`;

const SYSTEM_PROMPT =
  "Je bent een nauwkeurige assistent die maattabellen (size charts) uit afbeeldingen leest " +
  "voor een kledingwebshop. De afbeeldingen zijn vaak Chinese maattabellen van 1688/Taobao. " +
  "Extraheer de tabel EXACT zoals afgebeeld. Regels:\n" +
  "1. Vertaal de metingnamen (kolomkoppen) naar beknopte Engelse kledingtermen " +
  "(腰围→Waist, 臀围→Hip, 衣长/裤长→Length, 袖长→Sleeve, 肩宽→Shoulder, 胸围→Bust, " +
  "大腿围→Thigh, 脚口→Hem, 裆深→Rise). Houd ze kort, één of twee woorden.\n" +
  "2. Laat de maatlabels (rijen) staan zoals ze zijn (S, M, L, XL, of getallen zoals 29, 30).\n" +
  "3. Geef celwaarden als platte getallen, of een bereik als string ('72' of '68-72').\n" +
  "4. Verzin NOOIT waarden. Is een cel onleesbaar of leeg, gebruik dan een lege string.\n" +
  "5. Bepaal de eenheid: meestal cm bij Chinese tabellen, inch alleen als dat duidelijk staat.\n" +
  "6. measures en sizes mogen GEEN komma's bevatten.\n" +
  "7. Zorg dat rows.length == sizes.length en elke rows[i].length == measures.length.\n" +
  "8. Is de afbeelding geen maattabel, zet found=false en laat de arrays leeg.\n" +
  "confidence weerspiegelt de leesbaarheid van de afbeelding.";

const ALLOWED_MEDIA = ["image/png", "image/jpeg", "image/webp", "image/gif"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Admin-check: valideer de JWT van de aanroeper en eis role = admin.
  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "Niet ingelogd" }, 401);
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return json({ error: "Alleen admins" }, 403);

  const body = await req.json().catch(() => ({}));
  const rawImage = (body as { image?: unknown }).image;
  const mediaType = (body as { mediaType?: unknown }).mediaType;
  if (typeof rawImage !== "string" || !rawImage) {
    return json({ error: "geen afbeelding ontvangen" }, 400);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "AI niet geconfigureerd (ANTHROPIC_API_KEY ontbreekt)" }, 503);

  // data:-URL parsen: type én payload uit dezelfde match, zodat het gedeclareerde
  // media_type altijd bij de echte bytes hoort (anders weigert de vision-API).
  // Sta tussenliggende parameters toe (bijv. ;charset=utf-8;base64,).
  const m = rawImage.match(/^data:([^;,]+)(?:;[^,]*)*;base64,(.*)$/s);
  const detectedType = m?.[1];
  const base64 = m ? m[2] : rawImage.replace(/^data:[^,]*,/, "");
  const mt = ALLOWED_MEDIA.includes(detectedType ?? "")
    ? detectedType
    : (typeof mediaType === "string" && ALLOWED_MEDIA.includes(mediaType) ? mediaType : "image/png");

  // Grootte-grens (~5MB gedecodeerd; base64 ≈ +33%) → duidelijke fout i.p.v. opaque 502.
  if (base64.length > 7_000_000) {
    return json({ error: "afbeelding te groot — verklein de screenshot (max ~5MB)" }, 413);
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mt, data: base64 } },
            { type: "text", text: `Lees deze maattabel en geef de gestructureerde data terug.\n\n${SHAPE_HINT}` },
          ],
        },
      ],
    });
    const textBlock = response.content.find((b) => b.type === "text") as
      | { text?: string }
      | undefined;
    const raw = textBlock?.text ?? "";
    // Robuust: pak het JSON-object uit de tekst (evt. binnen ```-fences of met omringende tekst).
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? raw;
    const s = fenced.indexOf("{");
    const e = fenced.lastIndexOf("}");
    const chart = JSON.parse(s >= 0 && e > s ? fenced.slice(s, e + 1) : fenced);
    return json({ ok: true, chart });
  } catch (apiErr) {
    console.error("extract-size-chart API error:", apiErr);
    return json({ error: (apiErr as Error).message || "AI-extractie mislukt" }, 502);
  }
});
