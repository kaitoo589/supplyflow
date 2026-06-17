// Apple-stijl motion-presets voor framer-motion.
// Spring-fysica i.p.v. lineaire easing geeft het natuurlijke iOS-gevoel.

// De kenmerkende iOS-spring: snel maar zacht, met een subtiele overshoot.
export const springSnappy = { type: "spring", stiffness: 420, damping: 30, mass: 0.8 };
// Zachter, voor grotere bewegingen (schermen, kaarten die inschuiven).
export const springSoft = { type: "spring", stiffness: 240, damping: 26 };
// Speels en verend, voor accenten (mascotte, badges).
export const springBouncy = { type: "spring", stiffness: 500, damping: 18, mass: 0.7 };

// Voor morphing (gedeelde elementen die van scherm wisselen):
// vlot en strak, zonder na-wiebelen. Overal dezelfde gebruiken,
// zodat kaart, foto en titel synchroon bewegen.
export const springMorph = { type: "spring", stiffness: 300, damping: 30, mass: 0.9 };

// Tik-feedback: een knop "geeft mee" als je 'm indrukt, zoals op iOS.
export const pressable = {
  whileTap: { scale: 0.96 },
  whileHover: { scale: 1.02 },
  transition: springSnappy,
};

// Inhoud die zachtjes opkomt en omhoog schuift.
export const riseIn = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: springSoft,
};

// Container die zijn kinderen één voor één laat binnenkomen.
export const staggerContainer = {
  initial: {},
  animate: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

// Kind-element voor gebruik binnen staggerContainer.
export const staggerItem = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: springSoft },
};

// Soepel in-/uitvouwen op hoogte (bijv. extra velden tonen/verbergen).
export const collapse = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto" },
  exit: { opacity: 0, height: 0 },
  transition: springSoft,
};
