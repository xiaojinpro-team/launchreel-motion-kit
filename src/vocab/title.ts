/**
 * Family 2: big title kinetic type. Word-by-word rise behind a mask, a line mask reveal led by a brand bar, a weight + width morph
 * (four shipped weights cross-faded per letter), a split-flap board, an outline that draws on and then floods with fill.
 * Sizes come from the look sheets' type scale (super 144, chapter 64, ui 40 at 1920x1080); a line too wide for maxWidth is fitted down.
 */
import { attr, clamp, css, ff, h, hash, isCjk, lazy, lerp, rng, root, sizeOf, svg, theme, words, type CommonOpts, type Component, type ScaleName } from "./core.js";
import { along, motions, type MotionTable } from "./easing.js";

export type TitleVariant = "rise" | "mask" | "weight" | "flap" | "outline";

export interface TitleOpts extends CommonOpts {
  variant?: TitleVariant;
  /** the title; "\n" breaks lines */
  text: string;
  /** a word or phrase of the text drawn in the brand colour */
  accent?: string;
  /** "super" (144) | "chapter" (64) | "ui" (40) | px; default "super" */
  size?: ScaleName | number;
  align?: "center" | "left";
  /** anchor: centre of the block (center) or its left edge (left), and its vertical centre; stage px */
  x?: number;
  y?: number;
  /** lines wider than this are fitted down (default 1600) */
  maxWidth?: number;
  /** weight: the stems from light to heavy (default the four Inter weights; Chinese text: NotoSansSC Regular / Medium / Bold) */
  weights?: string[];
  /** ms per word / letter step (default per variant) */
  stagger_ms?: number;
}

/** the named moves of each variant and their default curves (opts.ease overrides any of them by name) */
export const TITLE_MOTIONS: Record<TitleVariant, MotionTable> = {
  rise: { "word.rise": { ease: "out-expo", doc: "each word rising out of its mask with a small tilt (760 ms)" } },
  mask: {
    "line.reveal": { ease: "out-quart", doc: "each line uncovered left to right behind the brand bar (900 ms)" },
    "bar.out": { ease: "in-quad", doc: "the brand bar shrinking away at the line's end" },
  },
  weight: {
    "track.in": { ease: "out-cubic", doc: "the letter spacing closing from wide to tight over the whole build" },
    "weight.morph": { ease: "in-out-sine", doc: "each letter crossing from the light to the heavy weight, from the middle out" },
    "fade": { ease: "linear", doc: "the letters fading in before the morph" },
  },
  flap: {
    "cell.in": { ease: "out-quad", doc: "each flap cell fading in before it spins" },
    "flap.settle": { ease: { spring: [2.86, 0.8] }, doc: "the final letter dropping onto the board with a small bounce" },
  },
  outline: {
    "stroke.draw": { ease: "in-out-sine", doc: "the outline drawing on along each line (1.1 s)" },
    "fill.flood": { ease: "out-cubic", doc: "the fill flooding in left to right after the stroke" },
  },
};

const FLAP_POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function title(host: HTMLElement, o: TitleOpts): Component {
  const v: TitleVariant = o.variant ?? "rise";
  const th = theme(o);
  const el = root(host, th, o, `title-${v}`);
  const M = motions(TITLE_MOTIONS[v], o.ease, `title.${v}`);
  const start = o.start_ms ?? 300;
  const align = o.align ?? "center";
  const X = o.x ?? (align === "center" ? 960 : 160);
  const Y = o.y ?? 540;
  const maxW = o.maxWidth ?? 1600;
  let fs = sizeOf(o.size, "super");
  const cjk = isCjk(o.text);
  const lines = o.text.split("\n");
  const accentWords = new Set((o.accent ?? "").split(/\s+/).filter(Boolean));
  const isAccent = (w: string) => accentWords.has(w.replace(/[.,!?;:，。！？]$/, ""));
  const block = h("div", { position: "absolute", left: X, top: Y, transform: align === "center" ? "translate(-50%, -50%)" : "translateY(-50%)", textAlign: align, fontFamily: ff(th.display), color: th.ink, whiteSpace: "nowrap", lineHeight: 1.04, letterSpacing: cjk ? "0" : "-0.025em" });
  el.append(block);
  const lineEls: HTMLElement[] = [];
  const steps: { node: HTMLElement; i: number; line: number; extra?: HTMLElement[]; ch?: string; seed?: number }[] = [];
  let svgs: { s: SVGElement; stroke: SVGElement; fill: SVGElement; clip: SVGElement; len: number }[] = [];
  const stagger = o.stagger_ms ?? (v === "rise" ? 75 : v === "weight" ? 26 : v === "flap" ? 50 : v === "mask" ? 170 : 160);
  const weights = o.weights ?? (cjk ? ["NotoSansSC-Regular", "NotoSansSC-Medium", "NotoSansSC-Bold"] : ["Inter-Regular", "Inter-Medium", "Inter-SemiBold", "Inter-Bold"]);
  let gi = 0;
  const id = `mvt${hash(o.text + v).toString(36)}`;

  lines.forEach((ln, li) => {
    const L = h("div", { position: "relative", display: v === "mask" ? "table" : "block", margin: v === "mask" && align === "center" ? "0 auto" : "0" });
    lineEls.push(L);
    block.append(L);
    if (v === "rise") {
      const ws = words(ln);
      ws.forEach((w, k) => {
        const mask = h("span", { display: "inline-block", overflow: "hidden", verticalAlign: "bottom", paddingBottom: "0.14em", marginBottom: "-0.14em", paddingRight: "0.04em" });
        const inner = h("span", { display: "inline-block", color: isAccent(w) ? th.accent : th.ink, willChange: "transform" }, w);
        mask.append(inner);
        L.append(mask);
        if (k < ws.length - 1 && !cjk) L.append(" ");
        steps.push({ node: inner, i: gi++, line: li });
      });
    } else if (v === "mask") {
      const inner = h("div", { position: "relative" });
      for (const [k, w] of words(ln).entries()) { inner.append(h("span", { color: isAccent(w) ? th.accent : th.ink }, w)); if (!cjk && k < words(ln).length - 1) inner.append(" "); }
      const bar = h("div", { position: "absolute", top: "6%", bottom: "2%", width: Math.max(8, fs * 0.07), background: th.accent, borderRadius: 2 });
      L.append(inner, bar);
      steps.push({ node: inner, i: li, line: li, extra: [bar] });
    } else if (v === "weight") {
      for (const w of words(ln)) {
        const wordEl = h("span", { display: "inline-block", color: isAccent(w) ? th.accent : th.ink });
        for (const ch of Array.from(w)) {
          const cell = h("span", { position: "relative", display: "inline-block" });
          const layers = weights.map((stem, k) => h("span", k === weights.length - 1 ? { fontFamily: ff(stem) } : { position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)", fontFamily: ff(stem) }, ch));
          cell.append(...layers);
          wordEl.append(cell);
          steps.push({ node: cell, i: gi++, line: li, extra: layers });
        }
        L.append(wordEl);
        if (!cjk) L.append(h("span", { display: "inline-block", width: "0.28em" }));
      }
    } else if (v === "flap") {
      const chars = Array.from(ln);
      const r = rng(hash(ln));
      for (const ch of chars) {
        if (ch === " ") { L.append(h("span", { display: "inline-block", width: fs * 0.32 })); continue; }
        const tile = h("span", { position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: fs * (cjk ? 1.08 : 0.74), height: fs * 1.16, margin: `0 ${fs * 0.03}px`, borderRadius: fs * 0.07, background: th.surface2, color: th.ink, overflow: "hidden", verticalAlign: "middle", boxShadow: `inset 0 -${fs * 0.04}px 0 ${th.line}` });
        const glyph = h("span", { display: "inline-block", transformOrigin: "50% 50%" });
        const seam = h("span", { position: "absolute", left: 0, right: 0, top: "50%", height: Math.max(2, fs * 0.016), background: th.bg, opacity: 0.85 });
        tile.append(glyph, seam);
        L.append(tile);
        steps.push({ node: tile, i: gi++, line: li, extra: [glyph], ch, seed: Math.floor(r() * 997) });
      }
      css(L, { margin: `${fs * 0.06}px 0` });
    } else {
      // outline: an SVG per line, measured on the first seek
      const s = svg("svg", { width: maxW, height: fs * 1.25, overflow: "visible" });
      const defs = svg("defs");
      const clip = svg("clipPath", { id: `${id}c${li}` });
      const rect = svg("rect", { x: 0, y: 0, width: 0, height: fs * 1.6 });
      clip.append(rect);
      defs.append(clip);
      const anchor = align === "center" ? "middle" : "start";
      const tx = align === "center" ? maxW / 2 : 0;
      const mk = (fill: string, stroke: string) => { const t = svg("text", { x: tx, y: fs * 0.95, "text-anchor": anchor, "font-family": th.display, "font-size": fs, fill, stroke, "stroke-width": stroke === "none" ? 0 : Math.max(1.5, fs / 60), "stroke-linejoin": "round", "letter-spacing": cjk ? 0 : -fs * 0.02 }); t.textContent = ln; return t; };
      const fill = mk(th.ink, "none");
      fill.setAttribute("clip-path", `url(#${id}c${li})`);
      const stroke = mk("none", th.accent);
      s.append(defs, stroke, fill);
      L.append(s);
      svgs.push({ s, stroke, fill, clip: rect, len: 0 });
      css(L, { width: maxW, margin: align === "center" ? "0 auto" : "0" });
    }
  });
  const nLines = lines.length;
  const steps_n = gi;

  const layout = lazy(() => {
    // fit: the widest line within maxWidth
    if (v === "outline") {
      let k = 1;
      for (const g of svgs) { const b = (g.stroke as unknown as SVGGraphicsElement).getBBox(); if (b.width > maxW) k = Math.min(k, maxW / b.width); }
      if (k < 1) { fs *= k; for (const g of svgs) for (const t of [g.stroke, g.fill]) attr(t, { "font-size": fs, y: fs * 0.95 }); for (const g of svgs) attr(g.s, { height: fs * 1.25 }); }
      for (const g of svgs) {
        const b = (g.stroke as unknown as SVGGraphicsElement).getBBox();
        attr(g.clip, { x: b.x, y: b.y - fs * 0.2, height: b.height + fs * 0.4 });
        g.len = Math.max(fs * 3.2, 600);
        (g.clip as unknown as { _x: number; _w: number })._x = b.x;
        (g.clip as unknown as { _x: number; _w: number })._w = b.width;
      }
      return;
    }
    css(block, { fontSize: fs });
    const widest = Math.max(...lineEls.map((l) => l.scrollWidth));
    if (widest > maxW) { fs = Math.floor(fs * maxW / widest); css(block, { fontSize: fs }); }
  });
  css(block, { fontSize: fs });

  const lastAt = start + Math.max(0, (v === "mask" ? nLines : steps_n) - 1) * stagger;
  const motionEnd = lastAt + (v === "flap" ? 1100 : v === "outline" ? 1700 : 900);
  const duration = Math.round(motionEnd + 1500);

  function seek(ms: number): void {
    layout();
    if (v === "rise") {
      for (const s of steps) {
        const at = start + s.i * stagger;
        const p = along(M["word.rise"], ms, at, at + 760);
        css(s.node, { transform: `translateY(${((1 - p) * 108).toFixed(2)}%) rotate(${((1 - p) * 4).toFixed(2)}deg)` });
      }
    } else if (v === "mask") {
      for (const s of steps) {
        const at = start + s.i * stagger;
        const p = along(M["line.reveal"], ms, at, at + 900);
        css(s.node, { clipPath: `inset(-10% ${((1 - p) * 100).toFixed(3)}% -10% 0)` });
        const bar = s.extra![0];
        const gone = along(M["bar.out"], ms, at + 820, at + 1100);
        css(bar, { left: `calc(${(p * 100).toFixed(3)}% + 6px)`, opacity: ms < at ? 0 : 1 - gone, transform: `scaleY(${1 - gone})` });
      }
    } else if (v === "weight") {
      const mid = (steps_n - 1) / 2;
      const all = along(M["track.in"], ms, start, lastAt + 700);
      css(block, { letterSpacing: `${lerp(0.22, -0.025, all).toFixed(4)}em` });
      for (const s of steps) {
        const at = start + Math.abs(s.i - mid) * stagger;
        const w = along(M["weight.morph"], ms, at, at + 620) * (s.extra!.length - 1);
        s.extra!.forEach((layer, k) => css(layer, { opacity: +clamp(1 - Math.abs(w - k)).toFixed(3) }));
        css(s.node, { opacity: along(M.fade, ms, start - 200, start + 120) });
      }
    } else if (v === "flap") {
      for (const s of steps) {
        const on = start + s.i * 18;
        const settle = start + 320 + s.i * stagger;
        const glyph = s.extra![0];
        css(s.node, { opacity: along(M["cell.in"], ms, on, on + 160) });
        if (ms >= settle) {
          glyph.textContent = s.ch!;
          const k = along(M["flap.settle"], ms, settle, settle + 350);
          css(glyph, { transform: `translateY(${lerp(-0.06, 0, clamp(k)).toFixed(3)}em) scaleY(${lerp(0.8, 1, k).toFixed(3)})` });
        } else {
          const step = Math.floor(Math.max(0, ms - on) / 62);
          const pool = cjk ? Array.from(o.text.replace(/\s/g, "")) : (s.ch! === s.ch!.toLowerCase() ? FLAP_POOL.toLowerCase() : FLAP_POOL).split("");
          glyph.textContent = ms < on ? "" : pool[(s.seed! + step * 7) % pool.length];
          const q = (Math.max(0, ms - on) % 62) / 62;
          css(glyph, { transform: `scaleY(${(q < 0.35 ? lerp(0.55, 1, q / 0.35) : 1).toFixed(3)})` });
        }
      }
    } else {
      svgs.forEach((g, li) => {
        const at = start + li * stagger;
        const d = along(M["stroke.draw"], ms, at, at + 1100);
        attr(g.stroke, { "stroke-dasharray": `${g.len} ${g.len}`, "stroke-dashoffset": ((1 - d) * g.len).toFixed(2), opacity: ms < at ? 0 : 1 });
        const f = along(M["fill.flood"], ms, at + 750, at + 1500);
        const c = g.clip as unknown as { _x: number; _w: number };
        attr(g.clip, { width: (c._w * f + (f > 0 ? 2 : 0)).toFixed(2) });
        attr(g.stroke, { "stroke-opacity": (1 - 0.65 * f).toFixed(3) });
      });
    }
  }
  return { el, duration_ms: duration, seek };
}
