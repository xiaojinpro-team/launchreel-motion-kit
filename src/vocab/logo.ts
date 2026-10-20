/**
 * Family 4: logo reveals. A wordmark that draws on, a mark assembled from its parts, a glass pane that slides across a blurred lockup,
 * and a blur-up with a ring pulse. `endCard` pairs a reveal with one line and a CTA button (product actions only: never a price or a trial).
 * The mark is SVG paths in a 100-unit box (the customer's logo as paths, or the default reel mark drawn in the brand colour).
 */
import { attr, clamp, css, ff, h, hash, lazy, lerp, mix, rgba, root, seg, svg, theme, type CommonOpts, type Component, type Theme } from "./core.js";
import { along, motions, prog, type Ease, type MotionTable } from "./easing.js";

export type LogoVariant = "draw" | "assemble" | "glass" | "blurUp";

export interface MarkPart { d: string; fill?: string }

export interface LogoOpts extends CommonOpts {
  variant?: LogoVariant;
  /** the wordmark text (the product name) */
  wordmark?: string;
  /** the mark: SVG path parts in a `box`-unit square (default box 100); omitted = the default reel mark in the brand colour */
  mark?: { parts: MarkPart[]; box?: number } | false;
  /** mark height in px (default 168); the wordmark is 0.72 of it */
  markSize?: number;
  /** lockup centre, stage px */
  x?: number;
  y?: number;
}

export interface LogoComponent extends Component {
  /** ms at which the lockup is settled (what follows it starts here) */
  readonly settle_ms: number;
}

export function defaultMark(th: Theme): MarkPart[] {
  return [
    { d: "M30 4H50V96H30A26 26 0 0 1 4 70V30A26 26 0 0 1 30 4Z", fill: th.brand },
    { d: "M50 4H70A26 26 0 0 1 96 30V70A26 26 0 0 1 70 96H50Z", fill: mix(th.brand, "#FFFFFF", 0.14) },
    { d: "M39 30.5Q39 27 42 28.6L70 46.6Q73 50 70 53.4L42 71.4Q39 73 39 69.5Z", fill: th.brandInk },
    { d: "M73 22a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0 -11 0Z", fill: rgba(th.brandInk, 0.85) },
  ];
}

function lockup(th: Theme, o: LogoOpts, size: number) {
  const parts = o.mark === false ? [] : o.mark?.parts?.length ? o.mark.parts : defaultMark(th);
  const box = (o.mark && o.mark.box) || 100;
  const wrap = h("div", { display: "flex", alignItems: "center", gap: size * 0.24, whiteSpace: "nowrap" });
  let markSvg: SVGElement | null = null;
  const paths: SVGElement[] = [];
  if (parts.length) {
    markSvg = svg("svg", { width: size, height: size, viewBox: `0 0 ${box} ${box}`, overflow: "visible" });
    for (const p of parts) { const el = svg("path", { d: p.d, fill: p.fill ?? th.brand }); paths.push(el); markSvg.append(el); }
    wrap.append(markSvg as unknown as Node);
  }
  const word = h("div", { fontFamily: ff(th.display), fontSize: size * 0.72, lineHeight: 1, letterSpacing: "-0.03em", color: th.ink, position: "relative" }, o.wordmark ?? "");
  if (o.wordmark) wrap.append(word);
  return { wrap, markSvg, paths, word, box };
}

const LOGO_ONLY: Record<LogoVariant, MotionTable> = {
  draw: {
    "mark.draw": { ease: "in-out-sine", doc: "each part of the mark's outline drawing on (900 ms, 120 ms apart)" },
    "mark.fill": { ease: "out-quad", doc: "the mark filling as its outline fades" },
    "word.draw": { ease: "in-out-sine", doc: "the wordmark's outline drawing on (1.2 s)" },
    "word.fill": { ease: "out-quad", doc: "the wordmark filling" },
  },
  assemble: {
    "part.settle": { ease: { spring: [1.61, 0.84] }, doc: "each part flying in from around the mark and settling on a soft spring" },
    "word.slide": { ease: "out-quart", doc: "the wordmark sliding out from behind the mark" },
  },
  glass: {
    "pane.in": { ease: "out-quint", doc: "the frosted pane sliding in from the right to rest over the lockup" },
    "pane.out": { ease: "in-cubic", doc: "the pane sliding away left, leaving the sharp lockup" },
    "spec.sweep": { ease: "linear", doc: "the specular streak crossing the pane" },
  },
  blurUp: {
    "lockup.sharpen": { ease: "out-cubic", doc: "the lockup sharpening out of a blur while it grows from 0.9x" },
    "ring.grow": { ease: "out-cubic", doc: "each ring pulsing out of the mark" },
    "ring.fade": { ease: "out-quad", doc: "each ring fading as it grows" },
  },
};
const END_ONLY: MotionTable = {
  "line.rise": { ease: "out-expo", doc: "the line rising 70 px out of its mask" },
  "button.pop": { ease: { spring: [1.82, 0.86] }, doc: "the button popping up from 0.86x with a small overshoot" },
  "shine.sweep": { ease: "in-out-sine", doc: "the light streak crossing the button" },
};
/** the named moves of each variant and their default curves (opts.ease overrides any of them by name; the end card also takes its logo's moves) */
export const LOGO_MOTIONS: Record<LogoVariant | "endCard", MotionTable> = { ...LOGO_ONLY, endCard: { ...LOGO_ONLY.blurUp, ...END_ONLY } };

export function logo(host: HTMLElement, o: LogoOpts): LogoComponent {
  const v: LogoVariant = o.variant ?? "blurUp";
  const th = theme(o);
  const el = root(host, th, o, `logo-${v}`);
  const M = motions(LOGO_ONLY[v], o.ease, `logo.${v}`);
  const start = o.start_ms ?? 300;
  const size = o.markSize ?? 168;
  const X = o.x ?? 960, Y = o.y ?? 540;
  const place = (n: HTMLElement) => css(n, { position: "absolute", left: X, top: Y, transform: "translate(-50%, -50%)" });
  const L = lockup(th, o, size);
  place(L.wrap);
  el.append(L.wrap);
  const n = L.paths.length;
  let settle = start + 900;
  let seek: (ms: number) => void;

  if (v === "draw") {
    // the mark's outlines draw on (pathLength 1), then fill; the wordmark's outline draws on, then fills
    L.paths.forEach((p) => attr(p, { pathLength: 1, stroke: th.accent, "stroke-width": (L.box / 100) * 1.6, "stroke-linejoin": "round", "fill-opacity": 0 }));
    const wsvg = svg("svg", { width: 10, height: size, overflow: "visible" });
    const wt = svg("text", { x: 0, y: size * 0.72 * 0.86 + (size - size * 0.72) / 2, "font-family": th.display, "font-size": size * 0.72, "letter-spacing": -size * 0.72 * 0.03, fill: th.ink, stroke: th.accent, "stroke-width": 2, "stroke-linejoin": "round" });
    wt.textContent = o.wordmark ?? "";
    wsvg.append(wt);
    if (o.wordmark) { L.word.textContent = ""; L.word.append(wsvg as unknown as Node); }
    const layout = lazy(() => { if (o.wordmark) { const b = (wt as unknown as SVGGraphicsElement).getBBox(); attr(wsvg, { width: Math.ceil(b.width + 4) }); } });
    const wordAt = start + 380;
    settle = wordAt + 1500;
    seek = (ms) => {
      layout();
      L.paths.forEach((p, i) => {
        const at = start + i * 120;
        const d = along(M["mark.draw"], ms, at, at + 900);
        const f = along(M["mark.fill"], ms, start + 750 + i * 80, start + 1150 + i * 80);
        attr(p, { "stroke-dasharray": "1 1", "stroke-dashoffset": (1 - d).toFixed(4), "stroke-opacity": ms < at ? 0 : (1 - f).toFixed(3), "fill-opacity": f.toFixed(3) });
      });
      const len = size * 0.72 * 3.4;
      const d = along(M["word.draw"], ms, wordAt, wordAt + 1200);
      const f = along(M["word.fill"], ms, wordAt + 900, wordAt + 1400);
      attr(wt, { "stroke-dasharray": `${len} ${len}`, "stroke-dashoffset": ((1 - d) * len).toFixed(2), "stroke-opacity": ms < wordAt ? 0 : (1 - f * 0.9).toFixed(3), "fill-opacity": f.toFixed(3) });
    };
  } else if (v === "assemble") {
    // the parts fly in from around the mark and settle on a soft spring; the wordmark slides out from behind the mark
    const r = (k: number) => ((hash(`${k}`) % 1000) / 1000 - 0.5) * 2;
    L.paths.forEach((p) => css(p, { transformBox: "fill-box", transformOrigin: "50% 50%" }));
    const clip = h("div", { overflow: "hidden", paddingRight: 6 });
    if (o.wordmark) { L.word.replaceWith(clip); clip.append(L.word); }
    const wordAt = start + (n - 1) * 90 + 520;
    settle = wordAt + 800;
    seek = (ms) => {
      L.paths.forEach((p, i) => {
        const at = start + i * 90;
        const k = along(M["part.settle"], ms, at, at + 620);
        const ang = (i / Math.max(1, n)) * Math.PI * 2 + Math.PI / 4;
        const dist = 70 * (1 - k);
        css(p, { opacity: clamp(k * 3).toFixed(3), transform: `translate(${(Math.cos(ang) * dist).toFixed(2)}px, ${(Math.sin(ang) * dist).toFixed(2)}px) rotate(${(r(i) * 40 * (1 - k)).toFixed(2)}deg) scale(${lerp(0.6, 1, clamp(k)).toFixed(3)})` });
      });
      const w = along(M["word.slide"], ms, wordAt, wordAt + 750);
      css(L.word, { transform: `translateX(${lerp(-105, 0, w).toFixed(2)}%)` });
      if (L.markSvg) css(L.markSvg, { position: "relative", zIndex: 1 });
    };
  } else if (v === "glass") {
    // a frosted pane slides in over a blurred copy of the lockup, rests, slides away and leaves the sharp lockup behind it
    const blurred = L.wrap.cloneNode(true) as HTMLElement;
    css(blurred, { filter: "blur(18px) saturate(1.2)" });
    el.prepend(blurred);
    const pane = h("div", { position: "absolute", top: Y - size * 0.95, height: size * 1.9, borderRadius: 34, background: th.stage === "dark" ? "linear-gradient(115deg, rgba(255,255,255,0.16), rgba(255,255,255,0.05) 46%, rgba(255,255,255,0.10))" : "linear-gradient(115deg, rgba(255,255,255,0.70), rgba(255,255,255,0.38) 46%, rgba(255,255,255,0.55))", border: `1px solid ${th.stage === "dark" ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.9)"}`, boxShadow: th.stage === "dark" ? "0 30px 60px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.35)" : "0 30px 60px rgba(20,24,40,0.12), inset 0 1px 0 rgba(255,255,255,1)", overflow: "hidden", boxSizing: "border-box" });
    const spec = h("div", { position: "absolute", top: "-40%", bottom: "-40%", width: "18%", background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.35), rgba(255,255,255,0))", transform: "rotate(18deg)" });
    pane.append(spec);
    el.append(pane);
    let lw = 800;
    const layout = lazy(() => { lw = L.wrap.offsetWidth; });
    const inAt = start, restAt = start + 700, outAt = start + 1250;
    settle = outAt + 700;
    seek = (ms) => {
      layout();
      const pw = lw + 220;
      const restX = X - pw / 2;
      const a = along(M["pane.in"], ms, inAt, restAt);
      const b = along(M["pane.out"], ms, outAt, outAt + 650);
      const x = ms < outAt ? lerp(1920 + 40, restX, a) : lerp(restX, -pw - 40, b);
      css(pane, { left: x, width: pw });
      css(spec, { left: `${lerp(-30, 110, along(M["spec.sweep"], ms, inAt, outAt + 650)).toFixed(2)}%` });
      // insets are local to the lockup box, which spans [X - lw/2, X + lw/2]
      const left0 = X - lw / 2;
      css(blurred, { clipPath: `inset(-200px ${(lw - (x + pw - left0)).toFixed(2)}px -200px ${(x - left0).toFixed(2)}px)`, opacity: ms < inAt ? 0 : 1 });
      const right = ms < outAt ? 1920 : x + pw;
      css(L.wrap, { clipPath: `inset(-200px -60px -200px ${(right - left0).toFixed(2)}px)` });
    };
    place(blurred);
  } else {
    // blur-up: the lockup sharpens out of a blur while it grows to size, and one ring (then a fainter one) pulses out of the mark
    const rings = [0, 1].map(() => h("div", { position: "absolute", width: size, height: size, borderRadius: "28%", border: `4px solid ${th.accent}`, boxSizing: "border-box", opacity: 0 }));
    for (const r of rings) el.prepend(r);
    let mx = X - 300, my = Y;
    const layout = lazy(() => {
      if (!L.markSvg) { mx = X; my = Y; return; }
      const k = el.getBoundingClientRect().width / 1920 || 1;
      const rb = el.getBoundingClientRect(), mb = (L.markSvg as unknown as Element).getBoundingClientRect();
      mx = (mb.left - rb.left + mb.width / 2) / k; my = (mb.top - rb.top + mb.height / 2) / k;
    });
    settle = start + 850;
    seek = (ms) => {
      layout();
      const p = along(M["lockup.sharpen"], ms, start, start + 850);
      css(L.wrap, { opacity: clamp(p * 1.6).toFixed(3), filter: `blur(${((1 - p) * 26).toFixed(2)}px)`, transform: `translate(-50%, -50%) scale(${lerp(0.9, 1, p).toFixed(4)})` });
      rings.forEach((r, i) => {
        const at = start + 480 + i * 150;
        const q = seg(ms, at, at + 950);
        css(r, { left: mx - size / 2, top: my - size / 2, opacity: q > 0 && q < 1 ? ((i ? 0.32 : 0.7) * (1 - prog(M["ring.fade"], q, 950))).toFixed(3) : 0, transform: `scale(${lerp(0.92, i ? 2.0 : 2.6, prog(M["ring.grow"], q, 950)).toFixed(4)})`, borderRadius: `${lerp(28, 50, q).toFixed(1)}%` });
      });
    };
  }
  return { el, duration_ms: Math.round(settle + 1600), settle_ms: settle, seek };
}

export interface EndCardOpts extends LogoOpts {
  /** the one line under the logo (the slogan) */
  line?: string;
  /** the button label: a product action ("Make your film", "Open LaunchReel"); never a price, a plan or a trial length */
  cta?: string;
}

/** the end card: a logo reveal, one line, one CTA button; everything holds to the end */
export function endCard(host: HTMLElement, o: EndCardOpts): Component {
  const th = theme(o);
  const Y = o.y ?? 540;
  const hasLine = Boolean(o.line), hasCta = Boolean(o.cta);
  const shift = (hasLine ? 80 : 0) + (hasCta ? 80 : 0);
  // the end card's own moves are eased here; the rest go to its logo (which refuses names it does not have)
  const own: Record<string, Ease> = {}, rest: Record<string, Ease> = {};
  for (const [k, e] of Object.entries(o.ease ?? {})) (k in END_ONLY ? own : rest)[k] = e;
  const M = motions(END_ONLY, own, "logo.endCard");
  const lg = logo(host, { ...o, ease: rest, y: Y - shift, markSize: o.markSize ?? 128 });
  const el = lg.el;
  const lineEl = h("div", { position: "absolute", left: 160, right: 160, top: Y - shift + (o.markSize ?? 128) * 0.5 + 54, textAlign: "center", fontFamily: ff(th.display), fontSize: 72, letterSpacing: "-0.02em", lineHeight: 1.1, color: th.ink }, o.line ?? "");
  const lineMask = h("div", { position: "absolute", inset: 0, overflow: "hidden" });
  const btn = h("div", { position: "absolute", left: "50%", top: Y - shift + (o.markSize ?? 128) * 0.5 + (hasLine ? 196 : 60), transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 16, padding: "0 52px", height: 104, borderRadius: 999, background: th.brand, color: th.brandInk, fontFamily: ff(th.display), fontSize: 40, whiteSpace: "nowrap", overflow: "hidden", boxShadow: `0 18px 40px ${rgba(th.brand, 0.32)}` });
  const label = h("span", {}, o.cta ?? "");
  const arrow = h("span", { display: "inline-block" }, "→");
  const shine = h("span", { position: "absolute", top: 0, bottom: 0, width: 90, background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.45), rgba(255,255,255,0))", transform: "skewX(-20deg)" });
  btn.append(label, arrow, shine);
  if (hasLine) { lineMask.append(lineEl); el.append(lineMask); }
  if (hasCta) el.append(btn);
  const lineAt = lg.settle_ms - 250, btnAt = lineAt + 300, shineAt = btnAt + 700;
  const duration = Math.max(lg.duration_ms, btnAt + 2200);
  const seek = (ms: number) => {
    lg.seek(ms);
    const p = along(M["line.rise"], ms, lineAt, lineAt + 800);
    css(lineEl, { transform: `translateY(${lerp(70, 0, p).toFixed(2)}px)`, opacity: clamp(p * 2).toFixed(3) });
    const k = along(M["button.pop"], ms, btnAt, btnAt + 550);
    css(btn, { opacity: clamp(k * 2.5).toFixed(3), transform: `translateX(-50%) translateY(${lerp(24, 0, clamp(k)).toFixed(2)}px) scale(${lerp(0.86, 1, k).toFixed(4)})` });
    css(arrow, { transform: `translateX(${(Math.sin(clamp(seg(ms, shineAt, shineAt + 500)) * Math.PI) * 8).toFixed(2)}px)` });
    css(shine, { left: `${lerp(-30, 130, along(M["shine.sweep"], ms, shineAt, shineAt + 700)).toFixed(2)}%`, opacity: ms > shineAt && ms < shineAt + 700 ? 1 : 0 });
  };
  return { el, duration_ms: Math.round(duration), seek };
}
