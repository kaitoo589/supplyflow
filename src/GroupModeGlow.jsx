// Flowva Friends — "screen takeover"-gloed: een stromende oranje gradient langs de
// schermranden zolang je in groep-modus shopt, met een snelle sweep bij het activeren.
// De .ff-cat-on-class geeft de categorie-chips dezelfde zachte oranje gloed.
export default function GroupModeGlow({ active }) {
  if (!active) return null;
  return (
    <>
      <style>{`
        @property --ffa { syntax:'<angle>'; initial-value:0deg; inherits:false; }
        @keyframes ffRot { to { --ffa:360deg; } }
        @keyframes ffIn  { from { opacity:0; } to { opacity:1; } }
        @keyframes ffCat { 0%,100% { box-shadow:0 0 0 1px rgba(255,92,0,.22); } 50% { box-shadow:0 0 10px 1px rgba(255,92,0,.5), 0 0 0 1px rgba(255,92,0,.6); } }
        .ff-edge { position:fixed; inset:0; left:0; right:0; margin:0 auto; width:100%; max-width:430px; z-index:95; pointer-events:none; animation: ffIn .7s ease-out; }
        .ff-edge::before {
          content:""; position:absolute; inset:0; padding:3px;
          background:conic-gradient(from var(--ffa), #FF5C00, #FFC08A, #FF5C00, #b83800, #FF7A2E, #FF5C00);
          -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite:xor; mask-composite:exclude;
          animation: ffRot 1.2s linear, ffRot 5s linear 1.2s infinite;   /* sweep → dan rustig stromen */
        }
        .ff-edge::after { content:""; position:absolute; inset:0; box-shadow: inset 0 0 26px 2px rgba(255,92,0,.2); }
        @media (prefers-reduced-motion: reduce) {
          .ff-edge::before { animation: none; background:linear-gradient(#FF5C00,#FF5C00); }
          .ff-cat-on { animation: none !important; box-shadow:0 0 0 1px rgba(255,92,0,.4) !important; }
        }
        .ff-cat-on { animation: ffCat 3.4s ease-in-out infinite; }
      `}</style>
      <div className="ff-edge" aria-hidden="true" />
    </>
  );
}
