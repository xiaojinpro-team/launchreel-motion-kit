/**
 * Batch 2 · family "data": data reveals, ported by motion design from the 人造太阳 experiment (55_scenes p01/p02/p05/p09/p10, e6 render.py
 * s_record/s_fair/s_three/s_fuel/s_bomb). Each variant is the motion, not the picture: elements, keyframes, easing, events below.
 * Built on the engine foundations: every move is named and eased on its own (DATA_MOTIONS, overridable by opts.ease); the elements
 * are objects in a declared space (rows, parents, depth), so a value rides its tube as the tube's child and glow stays inside its object.
 *
 * counter    p01 s2 "1066 秒": the number rolls fast and settles long (roll), then SLAMS on landing (1.5 -> 0.94 -> 1 in 300 ms), a bloom
 *            inside the number's object flashes and an underline sweeps. One landing = one accent event.
 * tubes      p02 s0-1 / e6 s_record: a row of tubes rises in (120 ms stagger); each fills in turn (the liquid decelerates) with its value
 *            riding the surface as the tube's child and bubbles rising inside (ambient); the first level is drawn across in front of the
 *            tubes as a reference line; the ratio ("×2.6") slams onto the top of the last tube (its child, in front).
 * bars       e6 s_fair: a column of horizontal bars grows with a 250 ms stagger, values ride the bar ends (children of their rows); the
 *            highlighted bar is the brand colour and its value slams when it lands.
 * gauges     p05 s0-1: a row of up to three dials pops in; their needles swing in turn on an underdamped spring (a real needle
 *            overshoots) into the target zone; entering the zone flashes the zone arc and turns the label to the accent; 0.8° tremor.
 * pictogram  p10 s2-3 / e6 s_fuel: one big unit on the left, "≈", a grid of small units filling in reading order at an eased rate
 *            (slow, fast, slow); each unit pops; the count rides under the grid and slams at the end.
 * curve      e6 s_bomb / p09 s1: axes draw, each series draws left to right with a glowing head dot; the highlight series has the glow
 *            stroke and an area that follows the head; a shorter series stops early with an end pin (the "403 vs 1066" read).
 */
import { attr, clamp, css, ff, h, isCjk, lazy, mix, rgba, rng, root, seg, svg, theme, type CommonOpts, type Component, type Theme } from "./core.js";
import { along, curve as easeCurve, motions, prog, type MotionTable } from "./easing.js";
import { coreOf, fmt, glowPath, ICON, label, rollAt, stageSvg, tag, type PictoIcon } from "./parts.js";
import { glow, litSurface, scene, slamKeys, type Obj } from "./space.js";
export type { PictoIcon };

export type DataVariant = "counter" | "tubes" | "bars" | "gauges" | "pictogram" | "curve";

export interface DataItem { label: string; value: number; display?: string }
export interface GaugeItem { label: string; value: number; zone?: [number, number] }
export interface CurveSeries { label: string; values: number[]; highlight?: boolean }

export interface DataOpts extends CommonOpts {
  variant?: DataVariant;
  /** counter: the value it lands on; from (default 0); decimals (default: as the value) */
  value?: number;
  from?: number;
  decimals?: number;
  /** a unit after the number(s): "s", "%", "h", "秒" */
  unit?: string;
  /** a short line above (counter) or the chart's title */
  label?: string;
  /** tubes / bars: 2-4 (tubes) or 2-5 (bars) items; the last tube / the largest bar is the hero */
  items?: DataItem[];
  /** tubes: the ratio slammed on the last tube (default "×<last/first>" to one decimal); false: none */
  ratio?: string | false;
  /** bars: index of the highlighted bar (default the largest) */
  highlight?: number;
  /** tubes / bars: the full scale (default the largest value) */
  max?: number;
  /** gauges: 1-3 dials, value and zone in 0..1 of the dial */
  gauges?: GaugeItem[];
  /** pictogram: the one unit on the left and the many on the right */
  one?: { label: string };
  many?: { label: string; count: number };
  icon?: PictoIcon;
  /** curve: 1-3 series; x is the sample index (a shorter series stops early) */
  series?: CurveSeries[];
  xLabel?: string;
  yLabel?: string;
  /** ms the main motion takes (counter roll / tube fill / bar grow / pictogram fill / curve draw) */
  motion_ms?: number;
  /** counter: number size px (default 220) */
  size?: number;
}

const SLAM: MotionTable = {
  "slam.drop": { ease: "in-quad", doc: "the landing's fall from 1.5x to 0.94x" },
  "slam.settle": { ease: "in-out-sine", doc: "the landing's settle from 0.94x to 1x" },
};
/** the named moves of each variant and their default curves (opts.ease overrides any of them by name) */
export const DATA_MOTIONS: Record<DataVariant, MotionTable> = {
  counter: {
    in: { ease: "house", doc: "the number fading and growing in (0.92x -> 1x)" },
    roll: { ease: "out-expo", doc: "the digits rolling from `from` to the value" },
    ...SLAM,
    underline: { ease: "out-quart", doc: "the underline sweeping out after the landing" },
    label: { ease: "house", doc: "the line above rising in" },
  },
  tubes: {
    "tube.in": { ease: "house", doc: "each tube rising 40 px and fading in" },
    fill: { ease: "out-cubic", doc: "the liquid filling (its value rides the surface)" },
    "ref.draw": { ease: "out-cubic", doc: "the reference line drawn across from the first level" },
    ...SLAM,
  },
  bars: {
    "row.in": { ease: "house", doc: "each row's label and track sliding in" },
    grow: { ease: "out-cubic", doc: "each bar growing to its value" },
    ...SLAM,
  },
  gauges: {
    "dial.in": { ease: "house", doc: "each dial growing in (0.9x -> 1x)" },
    swing: { ease: "spring-needle", doc: "each needle swinging to its value (a spring: overshoot and settle)" },
  },
  pictogram: {
    "one.pop": { ease: "overshoot", doc: "the big unit popping in" },
    rate: { ease: "in-out-sine", doc: "the rate the small units appear at (slow, fast, slow)" },
    "unit.pop": { ease: "overshoot", doc: "each small unit popping in" },
    ...SLAM,
  },
  curve: {
    "axes.draw": { ease: "out-cubic", doc: "the axes drawing" },
    draw: { ease: "in-out-sine", doc: "each series drawing left to right" },
    "pin.pop": { ease: "overshoot", doc: "the end pin popping at a series' end" },
  },
};

export function data(host: HTMLElement, o: DataOpts): Component {
  const v: DataVariant = o.variant ?? "counter";
  const th = theme(o);
  const M = motions(DATA_MOTIONS[v] ?? DATA_MOTIONS.counter, o.ease, `data.${v}`);
  const el = root(host, th, o, `data-${v}`);
  const start = o.start_ms ?? 300;
  switch (v) {
    case "tubes": return tubes(el, th, o, start, M);
    case "bars": return bars(el, th, o, start, M);
    case "gauges": return gauges(el, th, o, start, M);
    case "pictogram": return pictogram(el, th, o, start, M);
    case "curve": return curveChart(el, th, o, start, M);
    default: return counter(el, th, o, start, M);
  }
}
type Moves = ReturnType<typeof motions>;

const numStyle = (th: Theme, size: number) => ({ fontFamily: ff(th.display), fontSize: size, lineHeight: 1, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum" 1' });
const decOf = (x: number) => (Number.isInteger(x) ? 0 : Math.min(2, (String(x).split(".")[1] ?? "").length));
/** fill a node's body with one centred child */
const centre = (body: HTMLElement, kid: HTMLElement) => { css(body, { display: "flex", alignItems: "center", justifyContent: "center" }); body.append(kid); };

// ---------------------------------------------------------------- counter
function counter(el: HTMLElement, th: Theme, o: DataOpts, start: number, M: Moves): Component {
  const value = o.value ?? 1066, from = o.from ?? 0, dec = o.decimals ?? decOf(value);
  const size = o.size ?? 220, roll = o.motion_ms ?? 1500;
  const cy = 560, land = start + 150 + roll;
  const sc = scene(el, {
    camera: o.camera,
    objects: [
      { id: "label", w: 1600, h: size * 0.3, at: [960, cy - size * 0.86], z: -2, motion: { opacity: [[start, 0], [start + 420, 1, M.label]], y: [[start, 12], [start + 420, 0, M.label]] } },
      { id: "bar", w: 1600, h: Math.max(6, size * 0.045), at: [960, cy + size * 0.62] },
      { id: "num", w: size * 4, h: size * 1.2, at: [960, cy], z: 2, motion: { opacity: [[start, 0], [start + 260, 1, M.in]], scale: [[start, 0.92], [start + 260, 1, M.in], ...slamKeys(land, M["slam.drop"], M["slam.settle"])] } },
    ],
  });
  const bloomG = glow(sc.n.num, { color: th.accent, radius: size * 0.9, spread: 0.55 });
  const row = h("div", { display: "flex", alignItems: "baseline", gap: size * 0.08, whiteSpace: "nowrap" });
  const num = h("span", { ...numStyle(th, size), color: th.ink, textAlign: "right", display: "inline-block" }, fmt(value, dec));
  const unit = o.unit ? h("span", { fontFamily: ff(th.display), fontSize: size * (isCjk(o.unit) ? 0.3 : 0.34), color: th.accent }, o.unit) : null;
  row.append(num);
  if (unit) row.append(unit);
  centre(sc.n.num.body, row);
  const bar = h("div", { height: "100%", width: 0, background: th.accent, borderRadius: 99 });
  centre(sc.n.bar.body, bar);
  if (o.label) centre(sc.n.label.body, h("div", { fontFamily: ff(th.display), fontSize: Math.max(30, size * 0.17), color: th.muted, whiteSpace: "nowrap" }, o.label));
  let w = 0, uw = 0;
  const layout = lazy(() => { const k = currentScale(el); w = num.getBoundingClientRect().width / k; uw = unit ? unit.getBoundingClientRect().width / k + size * 0.08 : 0; css(num, { minWidth: w }); });
  return {
    el, duration_ms: land + 1300,
    seek(ms) {
      layout();
      sc.seek(ms);
      const val = rollAt(ms, start + 150, land, from, value, M.roll);
      num.textContent = fmt(ms >= land ? value : val, dec);
      const a = along(M.in, ms, start, start + 260);
      bloomG.set(ms < land ? 0.18 * a : 0.4 + 0.6 * Math.exp(-(ms - land) / 260));
      css(bar, { width: (w + uw) * along(M.underline, ms, land, land + 450) });
    },
  };
}

/** the stage's CSS scale (a page may show the 1920 stage scaled down); layout widths are read back in stage px */
function currentScale(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  return r.width > 0 && el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
}

// ---------------------------------------------------------------- tubes
function tubes(el: HTMLElement, th: Theme, o: DataOpts, start: number, M: Moves): Component {
  const items = (o.items ?? [{ label: "Before", value: 403 }, { label: "After", value: 1066 }]).slice(0, 4);
  const n = items.length, max = o.max ?? Math.max(...items.map((i) => i.value));
  const TW = 150, TH = 520, base = 860, pitch = n <= 2 ? 360 : 300;
  const fillMs = o.motion_ms ?? 1300, fillGap = fillMs + 200;
  const level = (v: number) => (TH - 20) * (v / max);
  const at = (i: number) => start + 500 + i * fillGap;
  const lastEnd = at(n - 1) + fillMs;
  const ratioText = o.ratio === false ? null : o.ratio ?? (n >= 2 && items[0].value > 0 ? `×${(items[n - 1].value / items[0].value).toFixed(1)}` : null);
  const refY = base - 10 - level(items[0].value);
  const span = (n - 1) * pitch;
  const sc = scene(el, {
    camera: o.camera,
    light: { angle: 315, elevation: 0.6 },
    groups: [{ id: "row", kind: "row", at: [960, base - TH / 2], gap: pitch - TW }],
    objects: [
      ...items.flatMap((it, i): Obj[] => [
        { id: `tube${i}`, w: TW, h: TH, group: "row", motion: { opacity: [[start + i * 120, 0], [start + i * 120 + 500, 1, M["tube.in"]]], y: [[start + i * 120, 40], [start + i * 120 + 500, 0, M["tube.in"]]] } },
        // the value rides the liquid's surface: the tube's child, moving up with the fill on the same curve
        { id: `val${i}`, w: 420, h: 80, parent: `tube${i}`, at: [0, TH / 2 - 10 - 18 - 40] as [number, number], z: 3, motion: { y: [[at(i), 0], [at(i) + fillMs, -level(it.value), M.fill]], opacity: [[at(i), 0], [at(i) + fillMs * 0.2, 1, "linear"]] } },
        { id: `lab${i}`, w: 420, h: 60, parent: `tube${i}`, at: [0, TH / 2 + 58] as [number, number] },
      ]),
      ...(n >= 2 ? [{ id: "ref", w: span + 4, h: 4, at: [960 - (n - 1) * pitch / 2 + span / 2 + TW / 2, refY] as [number, number], z: 2 } as Obj] : []),
      ...(ratioText ? [{ id: "ratio", w: 520, h: 140, parent: `tube${n - 1}`, at: [0, TH / 2 - 10 - level(items[n - 1].value) - 150] as [number, number], z: 6, motion: { opacity: [[lastEnd + 150, 0], [lastEnd + 151, 1, "linear" as const]], scale: slamKeys(lastEnd + 150, M["slam.drop"], M["slam.settle"]) } } as Obj] : []),
    ],
  });
  const r = rng(29);
  const core = coreOf(th);
  const T = items.map((it, i) => {
    const hero = i === n - 1;
    const col = hero ? th.accent : mix(th.accent, th.muted, 0.55);
    const node = sc.n[`tube${i}`], L = sc.sp.slots[`tube${i}`].light;
    const halo = hero ? glow(node, { color: col, radius: 46, spread: 0.45, shape: "rect", corner: TW / 2 }) : null;
    const glass = h("div", { position: "absolute", inset: 0, ...litSurface(th, L, th.stage === "dark" ? mix(th.surface, th.bg, 0.4) : th.surface, { radius: TW / 2, rim: 2 }), border: `3px solid ${rgba(th.ink, 0.14)}`, overflow: "hidden" });
    const fill = h("div", { position: "absolute", left: 10, right: 10, bottom: 10, height: 0, borderRadius: (TW - 20) / 2, background: `linear-gradient(180deg, ${mix(col, core, 0.45)} 0%, ${col} 22%, ${mix(col, th.bg, 0.25)} 100%)`, overflow: "hidden" });
    const bubbles = Array.from({ length: 7 }, () => { const b = h("div", { position: "absolute", width: 8 + r() * 10, height: 8 + r() * 10, borderRadius: 99, background: rgba(core, 0.5) }); fill.append(b); return { b, x: 10 + r() * (TW - 60), y0: r() * TH, sp: 0.06 + r() * 0.08 }; });
    // the glass highlight sits on the side that faces the key light
    const shine = h("div", { position: "absolute", left: L.dx < 0 ? 22 : TW - 36, top: 30, width: 14, height: TH - 120, borderRadius: 99, background: rgba("#FFFFFF", th.stage === "dark" ? 0.08 : 0.5) });
    glass.append(fill);
    node.body.append(glass, shine);
    const val = h("div", { ...numStyle(th, 64), color: hero ? th.accent : th.ink, whiteSpace: "nowrap", alignSelf: "flex-end" });
    css(sc.n[`val${i}`].body, { display: "flex", justifyContent: "center", alignItems: "flex-end" });
    sc.n[`val${i}`].body.append(val);
    centre(sc.n[`lab${i}`].body, h("div", { fontFamily: ff(th.display), fontSize: 40, color: th.muted, whiteSpace: "nowrap" }, it.label));
    return { it, fill, bubbles, val, halo };
  });
  const ref = h("div", { position: "absolute", left: 0, top: 0, height: 0, borderTop: `3px dashed ${rgba(th.ink, 0.35)}`, width: 0 });
  if (sc.n.ref) sc.n.ref.body.append(ref);
  const ratio = ratioText ? h("div", { ...numStyle(th, 104), color: th.accent, whiteSpace: "nowrap", textShadow: `0 0 40px ${rgba(th.accent, 0.5)}` }, ratioText) : null;
  if (ratio) centre(sc.n.ratio.body, ratio);
  return {
    el, duration_ms: lastEnd + 1500,
    seek(ms) {
      sc.seek(ms);
      T.forEach((t, i) => {
        const p = along(M.fill, ms, at(i), at(i) + fillMs);
        const hgt = level(t.it.value) * p;
        css(t.fill, { height: hgt });
        t.bubbles.forEach((b) => { const y = ((b.y0 + ms * b.sp) % Math.max(1, hgt + 20)); css(b.b, { left: b.x, bottom: y - 10, opacity: hgt > 30 ? 1 : 0 }); });
        t.val.textContent = t.it.display && p >= 1 ? t.it.display : fmt(t.it.value * p, decOf(t.it.value)) + (o.unit ? ` ${o.unit}` : "");
        if (t.halo) t.halo.set(0.85 * clamp(p * 1.4));
      });
      if (n >= 2) css(ref, { width: (span + 4) * along(M["ref.draw"], ms, at(0) + fillMs, at(0) + fillMs + 450) });
    },
  };
}

// ---------------------------------------------------------------- bars
function bars(el: HTMLElement, th: Theme, o: DataOpts, start: number, M: Moves): Component {
  const items = (o.items ?? [{ label: "A", value: 40 }, { label: "B", value: 100 }]).slice(0, 5);
  const n = items.length, max = o.max ?? Math.max(...items.map((i) => i.value));
  const hi = o.highlight ?? items.reduce((b, it, i) => (it.value > items[b].value ? i : b), 0);
  const X = 380, W = 1080, BH = 66, rowH = n <= 3 ? 200 : 165;
  const y0 = 560 - ((n - 1) * rowH) / 2;
  const grow = o.motion_ms ?? 1400;
  const at = (i: number) => start + 400 + i * 250;
  const sc = scene(el, {
    camera: o.camera,
    groups: [{ id: "rows", kind: "column", at: [X + W / 2, 560], gap: rowH - BH }],
    objects: [
      ...(o.label ? [{ id: "title", w: W, h: 60, at: [X + W / 2, y0 - rowH * 0.85] as [number, number], motion: { opacity: [[start - 100, 0], [start + 300, 1, M["row.in"]]] } } as Obj] : []),
      ...items.flatMap((it, i): Obj[] => {
        const wv = (W * it.value) / max;
        return [
          { id: `row${i}`, w: W, h: BH, group: "rows", motion: { opacity: [[start + i * 120, 0], [start + i * 120 + 450, 1, M["row.in"]]] } },
          { id: `lab${i}`, w: W, h: 56, parent: `row${i}`, at: [0, -60] as [number, number], motion: { x: [[start + i * 120, 30], [start + i * 120 + 450, 0, M["row.in"]]] } },
          // the value rides the bar's end: the row's child, its x on the grow curve
          { id: `val${i}`, w: 400, h: 70, parent: `row${i}`, z: 2, at: [-W / 2 + 24 + 200, 0] as [number, number], motion: { x: [[at(i), 0], [at(i) + grow, wv, M.grow]], opacity: [[at(i), 0], [at(i) + grow * 0.2, 1, "linear" as const]], ...(i === hi ? { scale: slamKeys(at(i) + grow, M["slam.drop"], M["slam.settle"]) } : {}) } },
        ];
      }),
    ],
  });
  if (sc.n.title) sc.n.title.body.append(h("div", { position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", fontFamily: ff(th.display), fontSize: 44, color: th.muted, whiteSpace: "nowrap" }, o.label!));
  const R = items.map((it, i) => {
    const isHi = i === hi;
    const col = isHi ? th.accent : mix(th.ink, th.bg, th.stage === "dark" ? 0.62 : 0.55);
    const body = sc.n[`row${i}`].body;
    const track = h("div", { position: "absolute", inset: 0, borderRadius: 14, background: rgba(th.ink, th.stage === "dark" ? 0.06 : 0.05) });
    // the bar's glow is its own box-shadow: inside the row's stacking context, so it is occluded with the row
    const fill = h("div", { position: "absolute", left: 0, top: 0, width: 0, height: BH, borderRadius: 14, background: col, boxShadow: isHi ? `0 0 36px ${rgba(col, 0.45)}` : "none" });
    body.append(track, fill);
    sc.n[`lab${i}`].body.append(h("div", { position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", fontFamily: ff(th.display), fontSize: 40, color: isHi ? th.ink : th.muted, whiteSpace: "nowrap" }, it.label));
    const val = h("div", { position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", ...numStyle(th, 54), color: isHi ? th.accent : th.ink, whiteSpace: "nowrap" });
    css(sc.n[`val${i}`].el, { transformOrigin: "0 50%" });
    sc.n[`val${i}`].body.append(val);
    return { it, fill, val };
  });
  const lastEnd = at(n - 1) + grow;
  return {
    el, duration_ms: lastEnd + 1400,
    seek(ms) {
      sc.seek(ms);
      R.forEach((r, i) => {
        const p = along(M.grow, ms, at(i), at(i) + grow);
        css(r.fill, { width: ((W * r.it.value) / max) * p, opacity: p > 0 ? 1 : 0 });
        r.val.textContent = r.it.display && p >= 1 ? r.it.display : fmt(r.it.value * p, decOf(r.it.value)) + (o.unit ? ` ${o.unit}` : "");
      });
    },
  };
}

// ---------------------------------------------------------------- gauges
function gauges(el: HTMLElement, th: Theme, o: DataOpts, start: number, M: Moves): Component {
  const items = (o.gauges ?? [{ label: "Speed", value: 0.86 }, { label: "Quality", value: 0.9 }, { label: "Reach", value: 0.82 }]).slice(0, 3);
  const n = items.length, R = n === 1 ? 240 : 190, pitch = n === 1 ? 0 : n === 2 ? 620 : 560;
  const DW = R * 2 + 80, DH = R + 160, cy = 600;
  const swing = o.motion_ms ?? 900;
  const at = (i: number) => start + 500 + i * swing;
  const sc = scene(el, {
    camera: o.camera,
    groups: [{ id: "dials", kind: "row", at: [960, cy - R / 2 + 50], gap: Math.max(0, pitch - DW) }],
    objects: items.map((_, i) => ({ id: `dial${i}`, w: DW, h: DH, group: "dials", motion: { opacity: [[start + i * 160, 0], [start + i * 160 + 450, 1, M["dial.in"]]], scale: [[start + i * 160, 0.9], [start + i * 160 + 450, 1, M["dial.in"]]] } })),
  });
  // dial-local geometry: the pivot sits at (DW/2, R + 30)
  const px = DW / 2, py = R + 30;
  const arc = (r: number, a0: number, a1: number) => {
    const p = (a: number) => [px + r * Math.cos(Math.PI + a * Math.PI), py + r * Math.sin(Math.PI + a * Math.PI)];
    const [ax, ay] = p(a0), [bx, by] = p(a1);
    return `M ${ax.toFixed(1)} ${ay.toFixed(1)} A ${r} ${r} 0 0 1 ${bx.toFixed(1)} ${by.toFixed(1)}`;
  };
  const G = items.map((it, i) => {
    const zone = it.zone ?? [0.75, 1];
    const s = svg("svg", { viewBox: `0 0 ${DW} ${DH}`, width: DW, height: DH });
    (s as unknown as HTMLElement).style.cssText = "position:absolute;left:0;top:0;overflow:visible";
    s.append(svg("path", { d: arc(R, 0, 1), fill: "none", stroke: rgba(th.ink, 0.12), "stroke-width": 26, "stroke-linecap": "round" }));
    const z = svg("path", { d: arc(R, zone[0], zone[1]), fill: "none", stroke: th.accent, "stroke-width": 26, "stroke-linecap": "round" });
    s.append(z);
    for (let k = 0; k <= 10; k++) {
      const a = Math.PI + (k / 10) * Math.PI, r1 = R - 40, r2 = R - (k % 5 === 0 ? 70 : 56);
      s.append(svg("line", { x1: px + r1 * Math.cos(a), y1: py + r1 * Math.sin(a), x2: px + r2 * Math.cos(a), y2: py + r2 * Math.sin(a), stroke: rgba(th.ink, 0.35), "stroke-width": k % 5 === 0 ? 5 : 3, "stroke-linecap": "round" }));
    }
    const needle = svg("g", {});
    needle.append(svg("path", { d: `M ${px - 9} ${py} L ${px} ${py - R + 52} L ${px + 9} ${py} Z`, fill: th.ink }));
    needle.append(svg("circle", { cx: px, cy: py, r: 22, fill: th.ink }));
    needle.append(svg("circle", { cx: px, cy: py, r: 9, fill: th.accent }));
    s.append(needle);
    const body = sc.n[`dial${i}`].body;
    body.append(s);
    const lab = label(th, it.label, px, py + 86, { size: 40, color: th.muted });
    body.append(lab);
    return { it, zone, z, needle, lab };
  });
  return {
    el, duration_ms: at(n - 1) + swing + 1400,
    seek(ms) {
      sc.seek(ms);
      G.forEach((q, i) => {
        const k = along(M.swing, ms, at(i), at(i) + swing);
        const val = q.it.value * k;
        const tremor = Math.sin((ms / 1000) * 2.3 + i * 1.7) * 0.8 * seg(ms, at(i) + swing * 0.7, at(i) + swing * 1.3);
        attr(q.needle, { transform: `rotate(${(-90 + 180 * val + tremor).toFixed(2)} ${px} ${py})` });
        const inZone = val >= q.zone[0] - 0.005;
        const enteredAt = at(i) + swing * 0.35;
        attr(q.z, { "stroke-opacity": (inZone ? 0.55 + 0.45 * Math.exp(-Math.max(0, ms - enteredAt) / 300) : 0.28).toFixed(3) });
        css(q.lab, { color: inZone ? th.accent : th.muted });
      });
    },
  };
}

// ---------------------------------------------------------------- pictogram
function pictogram(el: HTMLElement, th: Theme, o: DataOpts, start: number, M: Moves): Component {
  const one = o.one ?? { label: "1 film" }, many = o.many ?? { label: "hours of editing", count: 40 };
  const N = Math.max(1, Math.min(400, Math.round(many.count)));
  const icon = ICON[o.icon ?? "box"];
  const fillMs = o.motion_ms ?? 2600, fillAt = start + 900, end = fillAt + fillMs;
  const GW = 840, GH = 480;
  const sc = scene(el, {
    camera: o.camera,
    groups: [{ id: "eq", kind: "row", at: [960, 490], gap: 60, align: "center" }],
    objects: [
      { id: "one", w: 260, h: 500, group: "eq" },
      { id: "approx", w: 120, h: 140, group: "eq", motion: { opacity: [[start + 450, 0], [start + 800, 1, "linear"]] } },
      { id: "grid", w: GW, h: GH, group: "eq" },
      { id: "count", w: GW, h: 100, parent: "grid", at: [0, GH / 2 + 90], z: 2, motion: { opacity: [[fillAt, 0], [fillAt + 1, 1, "linear"]], scale: slamKeys(end, M["slam.drop"], M["slam.settle"]) } },
    ],
  });
  // the one: a big unit popping in, its label under it
  const big = svg("svg", { viewBox: "0 0 100 100", width: 220, height: 220 });
  (big as unknown as HTMLElement).style.cssText = "position:absolute;left:20px;top:140px;overflow:visible;transform-origin:50% 50%";
  big.append(svg("path", { d: icon, fill: th.accent, "fill-rule": "evenodd" }));
  const oneLab = label(th, one.label, 130, 480, { size: 40, color: th.ink });
  sc.n.one.body.append(big, oneLab);
  centre(sc.n.approx.body, h("div", { fontFamily: ff(th.display), fontSize: 110, color: th.muted }, "≈"));
  // the many: a grid fitted into GW x GH
  const s = svg("svg", { viewBox: `0 0 ${GW} ${GH}`, width: GW, height: GH });
  (s as unknown as HTMLElement).style.cssText = "position:absolute;left:0;top:0;overflow:visible";
  sc.n.grid.body.append(s);
  const cols = Math.max(1, Math.ceil(Math.sqrt((N * GW) / GH))), rows = Math.ceil(N / cols);
  const cell = Math.min(GW / cols, GH / rows), sz = cell * 0.8;
  const ox = (GW - cols * cell) / 2, oy = (GH - rows * cell) / 2;
  const col = mix(th.accent, th.ink, 0.12);
  // the appear time of unit i: the inverse of the rate curve (bisection; any monotone ease)
  const rate = easeCurve(M.rate);
  const inv = (y: number) => { let lo = 0, hi = 1; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (rate.at(m * fillMs, fillMs) < y) lo = m; else hi = m; } return (lo + hi) / 2; };
  const units = Array.from({ length: N }, (_, i) => {
    const p = svg("path", { d: icon, fill: col, "fill-rule": "evenodd" });
    s.append(p);
    const c = i % cols, r = Math.floor(i / cols);
    return { p, x: ox + c * cell + (cell - sz) / 2, y: oy + r * cell + (cell - sz) / 2, at: fillAt + fillMs * inv((i + 1) / N) };
  });
  const count = h("div", { display: "flex", alignItems: "baseline", gap: 18, whiteSpace: "nowrap" });
  const cnum = h("span", { ...numStyle(th, 76), color: th.accent });
  count.append(cnum, h("span", { fontFamily: ff(th.display), fontSize: 36, color: th.ink }, many.label));
  centre(sc.n.count.body, count);
  return {
    el, duration_ms: end + 1500,
    seek(ms) {
      sc.seek(ms);
      const b = prog(M["one.pop"], seg(ms, start, start + 500), 500);
      css(big as unknown as HTMLElement, { transform: `scale(${b.toFixed(4)})` });
      css(oneLab, { opacity: seg(ms, start + 200, start + 500).toFixed(3) });
      let shown = 0;
      for (const u of units) {
        const k = seg(ms, u.at - 180, u.at);
        if (k > 0) shown++;
        const s2 = k > 0 ? prog(M["unit.pop"], k, 180) : 0;
        attr(u.p, { transform: `translate(${(u.x + (sz / 2) * (1 - s2)).toFixed(1)} ${(u.y + (sz / 2) * (1 - s2)).toFixed(1)}) scale(${((sz / 100) * s2).toFixed(4)})` });
      }
      cnum.textContent = fmt(shown);
    },
  };
}

// ---------------------------------------------------------------- curve
let uid = 0;

function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0][0]} ${pts[0][1]}` : "";
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function curveChart(el: HTMLElement, th: Theme, o: DataOpts, start: number, M: Moves): Component {
  const series = (o.series ?? [{ label: "Before", values: [0, 3, 5, 5.5, 5.6], highlight: false }, { label: "After", values: [0, 3, 5.5, 6, 6.2, 6.3, 6.3, 6.4, 6.4], highlight: true }]).slice(0, 3);
  const L = Math.max(...series.map((s) => s.values.length));
  const yMax = (o.max ?? Math.max(...series.flatMap((s) => s.values))) * 1.12 || 1;
  const X0 = 300, Y0 = 860, W = 1320, H = 560;
  const drawMs = o.motion_ms ?? 2200;
  // the chart is one object (its strokes, area, glow and pins live in it); the stage svg keeps stage coordinates inside it
  const sc = scene(el, { camera: o.camera, objects: [{ id: "chart", w: 1920, h: 1080, at: [960, 540] }] });
  const body = sc.n.chart.body;
  const s = stageSvg();
  body.append(s);
  const axes = svg("path", { d: `M ${X0} ${Y0 - H - 20} V ${Y0} H ${X0 + W + 30}`, fill: "none", stroke: rgba(th.ink, 0.35), "stroke-width": 4, "stroke-linecap": "round", "stroke-linejoin": "round" });
  s.append(axes);
  const axLen = H + 20 + W + 30;
  const xl = o.xLabel ? label(th, o.xLabel, X0 + W + 30, Y0 + 48, { size: 34, color: th.muted, align: "right" }) : null;
  const yl = o.yLabel ? label(th, o.yLabel, X0 - 24, Y0 - H - 20, { size: 34, color: th.muted, align: "right" }) : null;
  const title = o.label ? label(th, o.label, X0, Y0 - H - 80, { size: 40, color: th.ink, align: "left" }) : null;
  for (const x of [xl, yl, title]) if (x) body.append(x);
  const defs = svg("defs", {});
  s.append(defs);
  const S = series.map((se, k) => {
    const pts = se.values.map((v, i) => [X0 + (W * i) / Math.max(1, L - 1), Y0 - (H * v) / yMax] as [number, number]);
    const d = smoothPath(pts);
    const hi = se.highlight ?? k === series.length - 1;
    const col = hi ? th.accent : mix(th.ink, th.bg, 0.5);
    const g = svg("g", {});
    s.append(g);
    let clip: SVGElement | null = null;
    if (hi) {
      const id = `mv-curve-${++uid}`;
      const grad = svg("linearGradient", { id: `${id}g`, x1: 0, y1: 0, x2: 0, y2: 1 }, svg("stop", { offset: "0", "stop-color": col, "stop-opacity": 0.32 }), svg("stop", { offset: "1", "stop-color": col, "stop-opacity": 0 }));
      clip = svg("rect", { x: X0, y: 0, width: 0, height: 1080 });
      defs.append(grad, svg("clipPath", { id: `${id}c` }, clip));
      g.append(svg("path", { d: `${d} L ${pts[pts.length - 1][0]} ${Y0} L ${pts[0][0]} ${Y0} Z`, fill: `url(#${id}g)`, "clip-path": `url(#${id}c)` }));
    }
    const line = hi ? glowPath(g, d, col, coreOf(th), 10) : null;
    const plain = hi ? null : svg("path", { d, fill: "none", stroke: col, "stroke-width": 7, "stroke-linecap": "round" });
    if (plain) g.append(plain);
    const head = svg("circle", { r: hi ? 13 : 10, fill: hi ? coreOf(th) : col });
    const halo = svg("circle", { r: 40, fill: col, "fill-opacity": 0.25 });
    g.append(halo, head);
    const pin = tag(th, se.label, { size: 34, dot: col, ease: M["pin.pop"] });
    body.append(pin.el);
    return { se, hi, line, plain, head, halo, pin, clip, at: start + 500 + k * 600, len: 0, path: (line ? line.paths[0] : plain) as SVGPathElement };
  });
  const layout = lazy(() => { for (const q of S) q.len = q.path.getTotalLength(); });
  const lastEnd = Math.max(...S.map((q) => q.at + (drawMs * q.se.values.length) / L));
  return {
    el, duration_ms: lastEnd + 1500,
    seek(ms) {
      layout();
      sc.seek(ms);
      const a = along(M["axes.draw"], ms, start, start + 500);
      attr(axes, { "stroke-dasharray": `${axLen} ${axLen}`, "stroke-dashoffset": (axLen * (1 - a)).toFixed(1) });
      for (const x of [xl, yl, title]) if (x) css(x, { opacity: a.toFixed(3) });
      for (const q of S) {
        const myMs = (drawMs * q.se.values.length) / L;
        const p = clamp(along(M.draw, ms, q.at, q.at + myMs));
        if (q.line) q.line.set(p > 0 ? 1 : 0, q.len, p); else attr(q.plain!, { "stroke-dasharray": `${q.len} ${q.len}`, "stroke-dashoffset": (q.len * (1 - p)).toFixed(1), opacity: p > 0 ? 1 : 0 });
        const pt = q.path.getPointAtLength(q.len * p);
        attr(q.head, { cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), opacity: p > 0 ? 1 : 0 });
        const pulse = 0.18 + 0.12 * Math.sin(ms / 160);
        attr(q.halo, { cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), "fill-opacity": (p > 0 ? (p < 1 ? pulse : 0.14) : 0).toFixed(3) });
        if (q.clip) attr(q.clip, { width: Math.max(0, pt.x - X0).toFixed(1) });
        const end = q.at + myMs;
        q.pin.set(seg(ms, end, end + 450));
        css(q.pin.el, { left: Math.min(pt.x, 1700), top: pt.y - 74 });
      }
    },
  };
}

