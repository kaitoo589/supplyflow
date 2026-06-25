import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // #11 — BIND de top-up aan de INGELOGDE gebruiker (nooit een userId uit de body
    // vertrouwen). supabase.functions.invoke() stuurt de sessie-JWT automatisch mee in
    // de Authorization-header; we lezen daaruit de echte user. Anders kan iemand met een
    // eigen sessie een ANDER account opladen (witwas/misbruik-vector).
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return json({ error: "Not authenticated" }, 401);
    }

    const { amount } = await req.json();
    if (!amount || typeof amount !== "number" || amount < 500) {
      return json({ error: "Minimum storting is €5" }, 400);
    }

    const session = await stripe.checkout.sessions.create({
      // Automatische methode-selectie: Stripe toont per land de juiste betaalmethodes,
      // te beheren (aan/uit) in het Stripe-dashboard. Zet daar de lokale PUSH-methodes
      // aan — iDEAL/Wero (NL), Bancontact (BE), EPS (AT), Przelewy24 (PL) — die GEEN
      // chargebacks kennen, plus kaart als universeel vangnet (met 3D-Secure).
      automatic_payment_methods: { enabled: true },
      mode: "payment",
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Flowva Balance",
              description: `Balance opladen — €${(amount / 100).toFixed(2)}`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      success_url: `${Deno.env.get("APP_URL")}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${Deno.env.get("APP_URL")}/`,
      // userId komt SERVER-SIDE uit de geverifieerde sessie, niet uit de body.
      metadata: {
        userId: user.id,
        amount: amount.toString(),
      },
    });

    return json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
