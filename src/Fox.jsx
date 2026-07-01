// Consistente vos op elk toestel: de native vos-emoji verschilt per OS (iPhone, Samsung
// en PC tonen elk een andere vos). We renderen 'm als vaste afbeelding (Microsoft Fluent /
// Windows-stijl, public/fox.svg), em-groot zodat 'ie automatisch de omringende fontSize
// volgt — een drop-in vervanger voor de emoji. Zie geheugen: fox-rendering-consistency.
//
// "Levende vos": heel af en toe (per instantie een eigen, willekeurig ritme) kantelt de
// vos even z'n kop — een metgezel i.p.v. een statisch plaatje. `still` zet dat uit
// (voor ghosts/confetti waar een eigen animatie in de weg zit).
import { useRef } from "react";
import { motion } from "framer-motion";

const FOX_SRC = "/fox.svg";
const baseStyle = { width: "1em", height: "1em", display: "inline-block", verticalAlign: "-0.15em" };

export default function Fox({ style, still = false }) {
  const rhythm = useRef({ delay: 5 + Math.random() * 18, repeatDelay: 16 + Math.random() * 24 }).current;
  if (still) {
    return <img src={FOX_SRC} alt="" aria-hidden="true" draggable={false} style={{ ...baseStyle, ...style }} />;
  }
  return (
    <motion.img
      src={FOX_SRC}
      alt=""
      aria-hidden="true"
      draggable={false}
      animate={{ rotate: [0, 0, -7, 5, -2, 0] }}
      transition={{ duration: 0.9, ease: "easeInOut", delay: rhythm.delay, repeat: Infinity, repeatDelay: rhythm.repeatDelay }}
      style={{ ...baseStyle, transformOrigin: "50% 85%", ...style }}
    />
  );
}
