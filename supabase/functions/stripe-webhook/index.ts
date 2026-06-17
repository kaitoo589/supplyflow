import Stripe from "https://esm.sh/stripe@13.3.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-08-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;

  try {
    const cryptoProvider = Stripe.createSubtleCryptoProvider();
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
      undefined,
      cryptoProvider
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response(
      JSON.stringify({ error: "Invalid signature" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.payment_status !== "paid") {
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = session.metadata?.userId;
    const amount = parseInt(session.metadata?.amount || "0");
    const euroAmount = amount / 100;

    if (!userId || !amount) {
      return new Response(
        JSON.stringify({ error: "Missing metadata" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Idempotent + atomisch via apply_top_up (zie finance-hardening.sql):
    // hetzelfde event twee keer → tweede keer is een no-op.
    const { data, error } = await supabase.rpc("apply_top_up", {
      p_event_id: event.id,
      p_session_id: session.id,
      p_user_id: userId,
      p_amount: euroAmount,
    });

    // Bij een fout 500 teruggeven: dan probeert Stripe het later
    // opnieuw in plaats van dat de storting stilletjes verdwijnt.
    if (error || data?.ok === false) {
      console.error("apply_top_up mislukt:", error?.message || data?.error);
      return new Response(
        JSON.stringify({ error: error?.message || data?.error }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (data?.duplicate) {
      console.log(`Dubbel event ${event.id} genegeerd (al verwerkt)`);
    } else {
      console.log(`Balance verhoogd voor ${userId}: +€${euroAmount}`);
    }
  }

  return new Response(
    JSON.stringify({ received: true }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});