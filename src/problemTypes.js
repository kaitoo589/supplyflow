// Vaste probleem-types die de agent met één tik kan melden tijdens de
// aanvraag-fase (vóór betaling). Gedeeld door AgentPanel en klant-app.
// label/msg blijven Engels (bron); de klant-app vertaalt op leestijd via
// tr(labelKey/msgKey, ...). De admin (AgentPanel) leest gewoon .label/.msg (Engels).
export const problemTypes = {
  out_of_stock: {
    icon: "📦",
    labelKey: "orders.problem.outOfStock.label",
    label: "Out of stock",
    msgKey: "orders.problem.outOfStock.msg",
    msg: "Unfortunately this product is currently out of stock. You can cancel your request, or let me know via the chat if I should wait until it's back in stock.",
  },
  variant_unavailable: {
    icon: "📏",
    labelKey: "orders.problem.variantUnavailable.label",
    label: "Size/variant unavailable",
    msgKey: "orders.problem.variantUnavailable.msg",
    msg: "The chosen size or variant is unfortunately unavailable. You can cancel your request for a full refund and order a different option.",
  },
  price_changed: {
    icon: "💰",
    labelKey: "orders.problem.priceChanged.label",
    label: "Price has changed",
    msgKey: "orders.problem.priceChanged.msg",
    msg: "The price of this product differs from what's shown in the app. I'll send you a quote with the current price — if you don't agree, you can cancel your request.",
  },
  link_broken: {
    icon: "🔗",
    labelKey: "orders.problem.linkBroken.label",
    label: "Link not working",
    msgKey: "orders.problem.linkBroken.msg",
    msg: "The product link unfortunately no longer works. You can cancel your request for a full refund.",
  },
};
