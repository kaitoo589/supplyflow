import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.88.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    can_answer: {
      type: "boolean",
      description: "True alleen als de kennisbank deze vraag echt dekt",
    },
    confidence: {
      type: "number",
      description: "Zekerheid tussen 0 en 1 dat het antwoord juist en volledig is",
    },
    answer: {
      type: "string",
      description: "Het antwoord aan de klant, in de taal van de vraag; leeg als can_answer false is",
    },
    kb_entry_id: {
      type: "string",
      description: "Id van de gebruikte kennisbank-entry; leeg als geen entry gebruikt",
    },
  },
  required: ["can_answer", "confidence", "answer", "kb_entry_id"],
  additionalProperties: false,
} as const;

async function escalate(questionId: string) {
  await supabase
    .from("support_questions")
    .update({ status: "escalated" })
    .eq("id", questionId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { question_id } = await req.json();
    if (!question_id) return json({ error: "question_id ontbreekt" }, 400);

    // Alleen de eigenaar van de vraag mag de beantwoording starten
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    const { data: userData } = await supabase.auth.getUser(jwt);
    if (!userData?.user) return json({ error: "niet ingelogd" }, 401);

    const { data: question, error: qErr } = await supabase
      .from("support_questions")
      .select("id, user_id, question, page_context, status")
      .eq("id", question_id)
      .single();
    if (qErr || !question) return json({ error: "vraag niet gevonden" }, 404);
    if (question.user_id !== userData.user.id) return json({ error: "geen toegang" }, 403);
    if (question.status !== "pending") return json({ status: question.status });

    const { data: kbEntries } = await supabase
      .from("support_kb")
      .select("id, title, answer, times_used")
      .order("times_used", { ascending: false })
      .limit(100);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey || !kbEntries || kbEntries.length === 0) {
      // Geen kennisbank of geen API-key: alles netjes naar de operator
      await escalate(question.id);
      return json({ status: "escalated" });
    }

    const kbText = kbEntries
      .map((e) => `<entry id="${e.id}">\nVraag: ${e.title}\nAntwoord: ${e.answer}\n</entry>`)
      .join("\n");

    let verdict;
    try {
      const anthropic = new Anthropic({ apiKey });
      const response = await anthropic.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system:
          "Je bent de customer-support-agent van Flowva, een Nederlands logistiek platform." +
          "Je beantwoordt klantvragen UITSLUITEND op basis van de meegeleverde kennisbank. " +
          "Verzin nooit beleid, prijzen of termijnen die niet in de kennisbank staan. " +
          "Als de kennisbank de vraag niet duidelijk dekt, zet je can_answer op false — " +
          "een mens neemt het dan over, dat is de gewenste uitkomst bij twijfel. " +
          "Antwoord vriendelijk en concreet, in dezelfde taal als de klantvraag.",
        messages: [
          {
            role: "user",
            content:
              `<kennisbank>\n${kbText}\n</kennisbank>\n\n` +
              `Klantvraag: ${question.question}\n` +
              (question.page_context ? `Context: ${question.page_context}\n` : ""),
          },
        ],
        output_config: { format: { type: "json_schema", schema: ANSWER_SCHEMA } },
      });
      const textBlock = response.content.find((b) => b.type === "text");
      verdict = JSON.parse(textBlock?.text ?? "{}");
    } catch (apiErr) {
      console.error("Claude API error, escaleren:", apiErr);
      await escalate(question.id);
      return json({ status: "escalated" });
    }

    if (!verdict.can_answer || verdict.confidence < 0.7 || !verdict.answer) {
      await escalate(question.id);
      return json({ status: "escalated" });
    }

    await supabase
      .from("support_questions")
      .update({
        status: "answered",
        answer: verdict.answer,
        answered_by: "ai",
        kb_entry_id: verdict.kb_entry_id || null,
        answered_at: new Date().toISOString(),
      })
      .eq("id", question.id);

    if (verdict.kb_entry_id) {
      const used = kbEntries.find((e) => e.id === verdict.kb_entry_id);
      if (used) {
        await supabase
          .from("support_kb")
          .update({ times_used: (used.times_used ?? 0) + 1 })
          .eq("id", verdict.kb_entry_id);
      }
    }

    return json({ status: "answered", answer: verdict.answer });
  } catch (err) {
    console.error("support-answer error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
