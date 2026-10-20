/**
 * Shared parts of the batch 2 families (data, timeline, energy, diagram), ported from the 人造太阳 experiment's FX library by motion
 * design, not by frame: the slam on a landing number (FX.slam), the counter that rolls fast and settles long (FX.counter), the pill tag
 * that pops with a back-out (FX.tag), the leader-line callout (FX.callout) and the layered glow stroke (FX.plasma's halo layers).
 */
import { clamp, css, ff, h, mix, rgba, svg, type Theme } from "./core.js";
import { curve, prog, type Ease } from "./easing.js";

/**
 * The slam on a landing (FX.slam / MO.slamK): at `at` the thing appears at 1.5x, drops through 0.94 in 170 ms and settles to 1 by 300 ms.
 * Returns 0 before `at` (not shown yet).
 */
export function slam(ms: number, at: number, drop: Ease = "in-quad", settle: Ease = "in-out-sine"): number {
  if (ms < at) return 0;
  const t = ms - at;
  if (t < 170) return 1.5 + (0.94 - 1.5) * prog(drop, t / 170, 170);
  if (t < 300) return 0.94 + 0.06 * prog(settle, (t - 170) / 130, 130);
  return 1;
}

/** a number as the counter shows it: grouped thousands (1,066 stays 1066 below 10 000, like the source), fixed decimals */
export function fmt(v: number, decimals = 0, group = true): string {
  const s = v.toFixed(decimals);
  if (!group) return s;
  const [i, d] = s.split(".");
  const neg = i.startsWith("-"), digits = neg ? i.slice(1) : i;
  const g = digits.length > 4 ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : digits;
  return (neg ? "-" : "") + g + (d ? "." + d : "");
}

/** the counter's rolling value: fast start, long settle (expo out), from `from` to `to` between `a` and `b` ms */
export const rollAt = (ms: number, a: number, b: number, from: number, to: number, e: Ease = "out-expo"): number => from + (to - from) * (ms <= a ? 0 : ms >= b ? 1 : curve(e).at(ms - a, b - a));

/** a pill tag (FX.tag): returns the element and a seek(p) where p is the pop progress 0..1 (scale on `ease`, default overshoot; quick fade) */
export function tag(th: Theme, text: string, o: { size?: number; dot?: string | null; fill?: string; color?: string; ease?: Ease } = {}): { el: HTMLElement; set: (p: number) => void } {
  const size = o.size ?? 30;
  const el = h("div", { position: "absolute", display: "inline-flex", alignItems: "center", gap: size * 0.4, whiteSpace: "nowrap", padding: `${size * 0.36}px ${size * 0.62}px`, borderRadius: 999, background: o.fill ?? th.surface2, color: o.color ?? th.ink, fontFamily: ff(th.display), fontSize: size, lineHeight: 1, boxShadow: th.stage === "dark" ? "0 8px 24px rgba(0,0,0,0.35)" : "0 8px 24px rgba(20,24,40,0.12)", transformOrigin: "50% 50%" });
  if (o.dot) el.append(h("span", { width: size * 0.42, height: size * 0.42, borderRadius: 99, background: o.dot, flex: "none" }));
  el.append(h("span", {}, text));
  const set = (p: number) => {
    const s = p <= 0 ? 0 : prog(o.ease ?? "overshoot", clamp(p), 450);
    css(el, { opacity: clamp(p * 3).toFixed(3), transform: `translate(-50%, -50%) scale(${s.toFixed(3)})` });
  };
  set(0);
  return { el, set };
}

/** layered glow strokes on one path (FX.plasma's halo: wide faint -> narrow bright); returns the paths to style per frame */
export function glowPath(parent: SVGElement, d: string, col: string, core: string, width: number): { set: (alpha: number, dashLen?: number, drawn?: number) => void; paths: SVGElement[] } {
  const layers: [number, string, number][] = [[width * 3.2, col, 0.1], [width * 1.9, col, 0.22], [width, mix(col, core, 0.35), 0.6], [width * 0.4, core, 0.9]];
  const paths = layers.map(([w, c]) => {
    const p = svg("path", { d, fill: "none", stroke: c, "stroke-width": w, "stroke-linecap": "round", "stroke-linejoin": "round" });
    parent.append(p);
    return p;
  });
  const set = (alpha: number, dashLen?: number, drawn?: number) => {
    paths.forEach((p, i) => {
      p.setAttribute("stroke-opacity", (layers[i][2] * alpha).toFixed(3));
      if (dashLen != null && drawn != null) { p.setAttribute("stroke-dasharray", `${dashLen} ${dashLen}`); p.setAttribute("stroke-dashoffset", String(dashLen * (1 - clamp(drawn)))); }
    });
  };
  return { set, paths };
}

/** a full-stage SVG layer (1920x1080 user units) */
export function stageSvg(): SVGElement {
  const s = svg("svg", { viewBox: "0 0 1920 1080", width: 1920, height: 1080 });
  (s as unknown as HTMLElement).style.cssText = "position:absolute;left:0;top:0;overflow:visible";
  return s;
}

/** an absolutely placed text block centred on (x, y) */
export function label(th: Theme, text: string, x: number, y: number, o: { size?: number; color?: string; stem?: string; align?: "center" | "left" | "right"; weight?: number } = {}): HTMLElement {
  const align = o.align ?? "center";
  const tx = align === "center" ? "-50%" : align === "right" ? "-100%" : "0";
  return h("div", { position: "absolute", left: x, top: y, transform: `translate(${tx}, -50%)`, whiteSpace: "nowrap", fontFamily: ff(o.stem ?? th.display), fontSize: o.size ?? 32, color: o.color ?? th.ink, lineHeight: 1.15, textAlign: align }, text);
}

/** the light core of the brand colour (the glow's centre) */
export const coreOf = (th: Theme): string => mix(th.accent, "#FFFFFF", th.stage === "dark" ? 0.7 : 0.55);

/** a soft round glow as a DOM element (radial gradient), for blooms behind numbers and hubs */
export function bloom(col: string, size: number): HTMLElement {
  return h("div", { position: "absolute", width: size, height: size, borderRadius: "50%", background: `radial-gradient(circle, ${rgba(col, 0.55)} 0%, ${rgba(col, 0.18)} 40%, ${rgba(col, 0)} 70%)`, transform: "translate(-50%, -50%)", pointerEvents: "none" });
}

/** unit icons in a 100-unit box (filled, even-odd): pictogram units and flow nodes */
export type PictoIcon = "dot" | "box" | "can" | "drop" | "clock" | "page" | "bolt" | "play" | "check" | "chat" | "gear";
export const ICON: Record<PictoIcon, string> = {
  dot: "M50 10 A40 40 0 1 1 49.9 10 Z",
  box: "M14 14 H86 Q90 14 90 18 V82 Q90 86 86 86 H14 Q10 86 10 82 V18 Q10 14 14 14 Z",
  can: "M22 24 H78 Q84 24 84 30 V88 Q84 94 78 94 H22 Q16 94 16 88 V30 Q16 24 22 24 Z M34 8 H60 V24 H34 Z",
  drop: "M50 6 C50 6 16 46 16 64 A34 34 0 0 0 84 64 C84 46 50 6 50 6 Z",
  clock: "M50 8 A42 42 0 1 1 49.9 8 Z M47 24 V52 L66 64 L70 58 L54 49 V24 Z",
  page: "M20 6 H62 L84 28 V90 Q84 94 80 94 H20 Q16 94 16 90 V10 Q16 6 20 6 Z M30 44 H70 V50 H30 Z M30 60 H70 V66 H30 Z M30 76 H58 V82 H30 Z",
  bolt: "M58 4 L18 56 H46 L38 96 L82 40 H54 Z",
  play: "M50 6 A44 44 0 1 1 49.9 6 Z M40 30 V70 L72 50 Z",
  check: "M50 6 A44 44 0 1 1 49.9 6 Z M28 50 L44 66 L74 34 L67 27 L44 52 L35 43 Z",
  chat: "M14 14 H86 Q92 14 92 20 V66 Q92 72 86 72 H44 L24 90 V72 H14 Q8 72 8 66 V20 Q8 14 14 14 Z",
  gear: "M44 4 H56 L58 16 L68 20 L78 12 L88 22 L80 32 L84 42 L96 44 V56 L84 58 L80 68 L88 78 L78 88 L68 80 L58 84 L56 96 H44 L42 84 L32 80 L22 88 L12 78 L20 68 L16 58 L4 56 V44 L16 42 L20 32 L12 22 L22 12 L32 20 L42 16 Z M50 34 A16 16 0 1 0 50.1 34 Z",
};

/** "no" red and "note" amber that sit with any brand (house tones, not the brand) */
export const NO_RED = "#E5484D";
export const NOTE_AMBER = "#F2B33D";
