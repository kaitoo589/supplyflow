// Liquid Glass-motor (naar Jhey Tompkins' backdrop-displacement-techniek).
// De échte rand-breking werkt via `backdrop-filter: url(#filter)` met een SVG-
// displacement map — dat kan ALLEEN in Chromium (Chrome/Edge/Android). Safari/iOS
// en Firefox krijgen automatisch de "clear glass"-terugval (blur + saturate + rims),
// die er nog steeds premium uitziet. Eén API, twee niveaus.
//
// De displacement map genereren we zelf per vorm (canvas): neutraal grijs (128,128)
// in het midden, en in een rand-zone ("bezel") wijst de R/G-kleur naar buiten langs
// de normaal van de afgeronde rechthoek → het glas "buigt" de content aan de randen.
// Drie kanalen met net iets andere sterkte = subtiele chromatische aberratie.
import { useEffect } from "react";
import { createPortal } from "react-dom";

export const LG_DISPLACE =
  typeof window !== "undefined" &&
  typeof CSS !== "undefined" &&
  /Chrom(e|ium)/.test(navigator.userAgent || "") &&
  CSS.supports("backdrop-filter", "blur(1px)");

// Zachte lichtranden + diepte — gedeeld door beide niveaus (mockup-variant B).
const RIMS =
  "inset 0 0 0 1px rgba(255,255,255,0.45), inset 2px 3px 9px rgba(255,255,255,0.5), inset -5px -7px 12px rgba(0,0,0,0.06), 0 10px 26px rgba(0,0,0,0.14)";

// Stijl voor een glas-element. kind ∈ nav | bar | chip (elk z'n eigen filter/map).
export function glassStyle(kind) {
  const fx = LG_DISPLACE
    ? `url(#lg-${kind}) saturate(1.5) brightness(1.06)`
    : "blur(3px) saturate(1.7)";
  return {
    background: "rgba(255,255,255,0.12)",
    backdropFilter: fx,
    WebkitBackdropFilter: fx,
    boxShadow: RIMS,
  };
}

// Glans-plek (specular highlight) — als los element in een relative parent leggen.
export const glassSpec = {
  position: "absolute",
  top: "6%",
  right: "9%",
  width: "34%",
  height: "34%",
  borderRadius: "50%",
  background: "radial-gradient(ellipse at center, rgba(255,255,255,0.55), transparent 70%)",
  pointerEvents: "none",
};

// Displacement map voor een afgeronde rechthoek w×h met hoekradius r.
function makeMap(w, h, r, bezel) {
  const cw = Math.max(2, Math.round(w));
  const ch = Math.max(2, Math.round(h));
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(cw, ch);
  const rr = Math.min(r, cw / 2, ch / 2);
  const bz = Math.min(bezel, rr);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      // Signed distance tot de afgeronde rechthoek (negatief = binnen).
      const px = x + 0.5 - cw / 2, py = y + 0.5 - ch / 2;
      const qx = Math.abs(px) - (cw / 2 - rr), qy = Math.abs(py) - (ch / 2 - rr);
      const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
      const dist = Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - rr;
      const depth = -dist; // afstand tot de rand, positief binnenin
      let nx = 0, ny = 0, m = 0;
      if (depth >= 0 && depth < bz) {
        // Buitenwaartse normaal: hoek-richting waar van toepassing, anders as-richting.
        let ox, oy;
        if (ax > 0 || ay > 0) { ox = ax * Math.sign(px || 1); oy = ay * Math.sign(py || 1); }
        else if (qx > qy) { ox = Math.sign(px || 1); oy = 0; }
        else { ox = 0; oy = Math.sign(py || 1); }
        const len = Math.hypot(ox, oy) || 1;
        nx = ox / len; ny = oy / len;
        const t = 1 - depth / bz;   // 1 aan de rand → 0 aan de binnenkant van de bezel
        m = t * t;                  // zachte falloff (lens-profiel)
      }
      const i = (y * cw + x) * 4;
      img.data[i] = Math.round(128 + nx * m * 110);
      img.data[i + 1] = Math.round(128 + ny * m * 110);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

// Eén filter-def (feImage-map → 3 kanalen met eigen sterkte → screen-blend → blur).
function FilterDef({ id, scale }) {
  return (
    <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
      <feImage data-lg-map result="map" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" />
      <feDisplacementMap in="SourceGraphic" in2="map" scale={scale * 1.06} xChannelSelector="R" yChannelSelector="G" result="dispRed" />
      <feColorMatrix in="dispRed" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
      <feDisplacementMap in="SourceGraphic" in2="map" scale={scale} xChannelSelector="R" yChannelSelector="G" result="dispGreen" />
      <feColorMatrix in="dispGreen" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
      <feDisplacementMap in="SourceGraphic" in2="map" scale={scale * 0.94} xChannelSelector="R" yChannelSelector="G" result="dispBlue" />
      <feColorMatrix in="dispBlue" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
      <feBlend in="red" in2="green" mode="screen" result="rg" />
      <feBlend in="rg" in2="blue" mode="screen" result="out" />
      <feGaussianBlur in="out" stdDeviation="0.45" />
    </filter>
  );
}

// Rendert de drie filters + houdt de maps in sync met de schermbreedte.
// Vormen zijn deterministisch (afgeleid van de viewport, app is maxWidth 430):
//   nav = zwevende pill, bar = mand-balk, chip = ronde header-knop 42×42.
export default function GlassDefs() {
  useEffect(() => {
    if (!LG_DISPLACE) return;
    let t = 0;
    const refresh = () => {
      // Verborgen/prerender-vensters kunnen innerWidth 0 rapporteren → dan zou de
      // nav-map 2px breed worden. Fallback + retry tot er een echte breedte is.
      const raw = window.innerWidth || document.documentElement.clientWidth || 0;
      if (!raw) { clearTimeout(t); t = setTimeout(refresh, 500); return; }
      const vw = Math.min(raw, 430);
      const shapes = {
        "lg-nav": { w: vw - 28, h: 64, r: 32, bezel: 15 },
        "lg-bar": { w: vw - 40, h: 58, r: 29, bezel: 14 },
        "lg-chip": { w: 42, h: 42, r: 21, bezel: 11 },
      };
      Object.entries(shapes).forEach(([id, s]) => {
        const img = document.querySelector(`#${id} [data-lg-map]`);
        if (img) img.setAttribute("href", makeMap(s.w, s.h, s.r, s.bezel));
      });
    };
    const onResize = () => { clearTimeout(t); t = setTimeout(refresh, 200); };
    refresh();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); clearTimeout(t); };
  }, []);
  if (!LG_DISPLACE) return null;
  return createPortal(
    <svg aria-hidden="true" style={{ position: "fixed", width: 0, height: 0, pointerEvents: "none" }}>
      <defs>
        <FilterDef id="lg-nav" scale={44} />
        <FilterDef id="lg-bar" scale={40} />
        <FilterDef id="lg-chip" scale={24} />
      </defs>
    </svg>,
    document.body,
  );
}
