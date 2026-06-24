// Flowva Friends — "screen takeover"-gloed: stromende oranje gradient langs de ECHTE
// schermranden (volledig scherm, zoals de allereerste versie), met een sweep bij
// activeren. `dimmed` vervaagt 'm terwijl een product/cart/lobby/notif open staat.
export default function GroupModeGlow({ active, dimmed }) {
  if (!active) return null;
  return (
    <>
      <style>{`
        @property --ffa { syntax:'<angle>'; initial-value:0deg; inherits:false; }
        @keyframes ffRot { to { --ffa:360deg; } }
        @keyframes ffIn  { from { opacity:0; } to { opacity:1; } }
        @keyframes ffCat { 0%,100% { box-shadow:0 0 0 1px rgba(255,92,0,.22); } 50% { box-shadow:0 0 10px 1px rgba(255,92,0,.5), 0 0 0 1px rgba(255,92,0,.6); } }
        .ff-edge { position:fixed; inset:0; left:0; right:0; margin:0 auto; width:100%; max-width:430px; z-index:105; pointer-events:none; animation: ffIn .6s ease-out; transition: opacity .25s ease; }
        .ff-edge.dim { opacity:0; }
        .ff-edge::before {
          content:""; position:absolute; inset:0; padding:3px;
          background:conic-gradient(from var(--ffa), #FF5C00, #FFC08A, #FF5C00, #b83800, #FF7A2E, #FF5C00);
          -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite:xor; mask-composite:exclude;
          animation: ffRot 1.2s linear, ffRot 5s linear 1.2s infinite;   /* sweep → dan rustig stromen */
        }
        .ff-edge::after { content:""; position:absolute; inset:0; box-shadow: inset 0 0 26px 2px rgba(255,92,0,.2); }
        @keyframes ffGlow { 0%,100% { box-shadow:0 0 0 1px rgba(255,92,0,.26); } 50% { box-shadow:0 0 13px 1px rgba(255,92,0,.42), 0 0 0 1px rgba(255,92,0,.55); } }
        .ff-glow { animation: ffGlow 3.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .ff-edge::before { animation: none; background:linear-gradient(#FF5C00,#FF5C00); }
          .ff-cat-on { animation: none !important; box-shadow:0 0 0 1px rgba(255,92,0,.4) !important; }
          .ff-glow { animation: none !important; box-shadow:0 0 0 1px rgba(255,92,0,.45) !important; }
        }
        .ff-cat-on { animation: ffCat 3.4s ease-in-out infinite; }
      `}</style>
      <div className={"ff-edge" + (dimmed ? " dim" : "")} aria-hidden="true" />
    </>
  );
}
