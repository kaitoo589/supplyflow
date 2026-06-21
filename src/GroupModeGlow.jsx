// Flowva Friends — groep-modus gloed, OPTIE 2: een afgerond frame om het INHOUD-vlak
// (onder de statusbalk, boven de bottom-nav, weg van de ronde schermhoeken). Stromende
// oranje gradient + sweep bij activeren. `dimmed` vervaagt 'm terwijl een sheet open staat.
export default function GroupModeGlow({ active, dimmed }) {
  if (!active) return null;
  return (
    <>
      <style>{`
        @property --ffa { syntax:'<angle>'; initial-value:0deg; inherits:false; }
        @keyframes ffRot { to { --ffa:360deg; } }
        @keyframes ffIn  { from { opacity:0; transform:scale(1.015); } to { opacity:1; transform:scale(1); } }
        @keyframes ffCat { 0%,100% { box-shadow:0 0 0 1px rgba(255,92,0,.22); } 50% { box-shadow:0 0 10px 1px rgba(255,92,0,.5), 0 0 0 1px rgba(255,92,0,.6); } }
        .ff-edge {
          position:fixed; left:6px; right:6px; margin:0 auto; max-width:420px;
          top:calc(env(safe-area-inset-top, 0px) + 6px);
          bottom:66px;   /* net boven de bottom-nav (die zit op bottom:0 zonder eigen safe-area) */
          z-index:95; pointer-events:none; border-radius:26px;
          animation: ffIn .55s ease-out; transition: opacity .25s ease;
        }
        .ff-edge.dim { opacity:0; }
        .ff-edge::before {
          content:""; position:absolute; inset:0; padding:2.5px; border-radius:26px;
          background:conic-gradient(from var(--ffa), #FF5C00, #FFC08A, #FF5C00, #b83800, #FF7A2E, #FF5C00);
          -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite:xor; mask-composite:exclude;
          animation: ffRot 1.2s linear, ffRot 5s linear 1.2s infinite;   /* sweep → dan rustig stromen */
        }
        .ff-edge::after { content:""; position:absolute; inset:0; border-radius:26px; box-shadow: inset 0 0 24px 2px rgba(255,92,0,.18); }
        @media (prefers-reduced-motion: reduce) {
          .ff-edge { animation: none; }
          .ff-edge::before { animation: none; background:linear-gradient(#FF5C00,#FF5C00); }
          .ff-cat-on { animation: none !important; box-shadow:0 0 0 1px rgba(255,92,0,.4) !important; }
        }
        .ff-cat-on { animation: ffCat 3.4s ease-in-out infinite; }
      `}</style>
      <div className={"ff-edge" + (dimmed ? " dim" : "")} aria-hidden="true" />
    </>
  );
}
