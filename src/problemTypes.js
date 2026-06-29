// Vaste probleem-types die de agent met één tik kan melden tijdens de
// aanvraag-fase (vóór betaling). Gedeeld door AgentPanel en klant-app.
export const problemTypes = {
  out_of_stock: {
    icon: "📦",
    label: "Out of stock",
    msg: "Unfortunately this product is currently out of stock. You can cancel your request, or let me know via the chat if I should wait until it's back in stock.",
  },
  variant_unavailable: {
    icon: "📏",
    label: "Size/variant unavailable",
    msg: "The chosen size or variant is unfortunately unavailable. You can cancel your request for a full refund and order a different option.",
  },
  price_changed: {
    icon: "💰",
    label: "Price has changed",
    msg: "The price of this product differs from what's shown in the app. I'll send you a quote with the current price — if you don't agree, you can cancel your request.",
  },
  link_broken: {
    icon: "🔗",
    label: "Link not working",
    msg: "The product link unfortunately no longer works. You can cancel your request for a full refund.",
  },
};
