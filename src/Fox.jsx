// Consistente vos op elk toestel: de native vos-emoji verschilt per OS (iPhone, Samsung
// en PC tonen elk een andere vos). We renderen 'm als vaste afbeelding (Microsoft Fluent /
// Windows-stijl, public/fox.svg), em-groot zodat 'ie automatisch de omringende fontSize
// volgt — een drop-in vervanger voor de emoji. Zie geheugen: fox-rendering-consistency.
const FOX_SRC = "/fox.svg";

export default function Fox({ style }) {
  return (
    <img
      src={FOX_SRC}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ width: "1em", height: "1em", display: "inline-block", verticalAlign: "-0.15em", ...style }}
    />
  );
}
