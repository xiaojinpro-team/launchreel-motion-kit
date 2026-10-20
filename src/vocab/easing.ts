/**
 * Engine requirement 1 (owner 10-19: 「一定要把引擎的缓动调到颗粒度很细并且极其好用」): easing per property, down to bezier handles.
 *
 *  - Ease: a preset name from EASES, a bezier tuple [x1, y1, x2, y2] (CSS cubic-bezier semantics), {bezier}, {spring: [hz, damping]},
 *    {trapezoid: [accel, decel]} or "linear". Built on the kit's easing engine (../ease.ts), so a desk curve and a keys-file curve agree.
 *  - EASES: the named curve library the desk calls by name (each with when to use it).
 *  - tracks({prop: [[t, v], [t, v, ease], ...]}): every property keyframed on its own; a key's ease is the curve INTO that key (AE).
 *    A spring segment runs on real time and keeps settling after its key instead of being cut.
 *  - motions(table, opts.ease): every component names its moves ("roll", "tag.scale", ...) with a default ease; opts.ease overrides
 *    any of them by name, so the desk can retune one property of one element without touching the rest.
 *  - fitEase(samples): measured position-over-time of one move in a reference clip -> best cubic-bezier + residual (and the nearest
 *    preset). Several moves in one clip: cut them first, or use fitCurve (../fit.ts), which segments and fits per move.
 * Pure: no DOM, no clock.
 */
import { bezier, spring as springFn, trapezoid, type EaseSpec } from "../ease.js";
import { measureSeries } from "../measure.js";

export type Bezier = [number, number, number, number];
export type Ease = EasePreset | Bezier | EaseSpec;

/** the preset library: name -> curve + when to use it. Beziers are the standard Penner/CSS fits; springs are [hz, damping ratio]. */
export const EASES = {
  "linear": { e: "linear", doc: "constant speed: tickers, scrolling roads, a progress bar that is a clock" },
  "house": { e: { bezier: [0.22, 1, 0.36, 1] }, doc: "the house UI curve: fast start, long settle (cards, tags, text in)" },
  "out-cubic": { e: { bezier: [0.33, 1, 0.68, 1] }, doc: "a calm arrival: small moves, fades" },
  "out-quart": { e: { bezier: [0.25, 1, 0.5, 1] }, doc: "a firm arrival: panels settling into place" },
  "out-quint": { e: { bezier: [0.22, 1, 0.36, 1] }, doc: "same as house; use for anything that should look designed, not mechanical" },
  "out-expo": { e: { bezier: [0.16, 1, 0.3, 1] }, doc: "a burst then a long glide: counters rolling, light igniting, big reveals" },
  "out-circ": { e: { bezier: [0, 0.55, 0.45, 1] }, doc: "a quick snap that slows sharply: bars and fills hitting their value" },
  "in-out-sine": { e: { bezier: [0.37, 0, 0.63, 1] }, doc: "the gentle travel: a ball or camera moving between two rests" },
  "in-out-cubic": { e: { bezier: [0.65, 0, 0.35, 1] }, doc: "a deliberate travel: a hero object crossing the frame" },
  "in-out-quint": { e: { bezier: [0.83, 0, 0.17, 1] }, doc: "a dramatic travel: whip pans, a scene sliding away" },
  "in-out-expo": { e: { bezier: [0.87, 0, 0.13, 1] }, doc: "the slowest start and stop: a swap that must feel instant in the middle" },
  "in-quad": { e: { bezier: [0.11, 0, 0.5, 0] }, doc: "a light drop: the fall of a slam onto its landing" },
  "out-quad": { e: { bezier: [0.5, 1, 0.89, 1] }, doc: "a light arrival: small nudges, fades out" },
  "in-cubic": { e: { bezier: [0.32, 0, 0.67, 0] }, doc: "a departure: things leaving the frame, slams dropping in" },
  "in-quint": { e: { bezier: [0.64, 0, 0.78, 0] }, doc: "a hard departure: an object pulled or sucked away" },
  "in-expo": { e: { bezier: [0.7, 0, 0.84, 0] }, doc: "a collapse: parts pulled into a centre at the end" },
  "overshoot": { e: { bezier: [0.34, 1.56, 0.64, 1] }, doc: "pops past and settles back: tags, badges, icons popping in" },
  "anticipate": { e: { bezier: [0.36, 0, 0.66, -0.56] }, doc: "pulls back before leaving: an exit with intent" },
  "anticipate-overshoot": { e: { bezier: [0.68, -0.6, 0.32, 1.6] }, doc: "pulls back, crosses, overshoots: a playful swap" },
  "css-ease": { e: { bezier: [0.25, 0.1, 0.25, 1] }, doc: "the browser default: plain web UI copies" },
  "ios": { e: { bezier: [0.32, 0.72, 0, 1] }, doc: "the phone sheet curve: device UI sliding in" },
  "material-standard": { e: { bezier: [0.2, 0, 0, 1] }, doc: "Android standard: device UI state changes" },
  "material-decel": { e: { bezier: [0.05, 0.7, 0.1, 1] }, doc: "Android emphasized decelerate: an element entering" },
  "material-accel": { e: { bezier: [0.3, 0, 0.8, 0.15] }, doc: "Android emphasized accelerate: an element leaving" },
  "drift": { e: { bezier: [0.45, 0.05, 0.55, 0.95] }, doc: "near-linear with soft ends: ambient drifts, slow pushes" },
  "spring-critical": { e: { spring: [2.2, 1] }, doc: "a spring that never overshoots: UI that must feel physical but tidy" },
  "spring-soft": { e: { spring: [1.6, 0.78] }, doc: "a soft spring, one small overshoot: cards, sheets" },
  "spring-snappy": { e: { spring: [2.8, 0.6] }, doc: "a quick spring with a visible overshoot: toggles, active rims" },
  "spring-needle": { e: { spring: [1.1, 0.72] }, doc: "a heavy pointer: a gauge needle that overshoots once and settles" },
  "spring-bounce": { e: { spring: [2.4, 0.35] }, doc: "a real needle or ball that wobbles: gauges, a ball landing" },
} as const satisfies Record<string, { e: EaseSpec; doc: string }>;
export type EasePreset = keyof typeof EASES;

const isBezier = (e: unknown): e is Bezier => Array.isArray(e) && e.length === 4 && e.every((v) => typeof v === "number" && Number.isFinite(v));

/** the JSON spec of an ease (preset names resolved) */
export function easeSpec(e: Ease): EaseSpec {
  if (typeof e === "string") {
    if (e === "linear") return "linear";
    const p = (EASES as Record<string, { e: EaseSpec }>)[e];
    if (!p) throw new RangeError(`unknown ease "${e}" (presets: ${Object.keys(EASES).join(", ")})`);
    return p.e;
  }
  if (isBezier(e)) return { bezier: e };
  return e;
}

/** what is wrong with an ease, if anything (names, tuple ranges, spec shapes) */
export function easeIssue(e: unknown): string | null {
  try {
    if (typeof e === "string") { easeSpec(e as Ease); return null; }
    if (isBezier(e)) { if (e[0] < 0 || e[0] > 1 || e[2] < 0 || e[2] > 1) return "bezier x1 and x2 must be in 0..1"; return null; }
    if (e && typeof e === "object" && !Array.isArray(e)) { compile(e as EaseSpec); return null; }
    return "an ease is a preset name, [x1,y1,x2,y2], {spring:[hz,damping]} or {trapezoid:[accel,decel]}";
  } catch (err) { return (err as Error).message; }
}

/** a compiled ease: at(elapsed_ms, duration_ms) -> progress. Springs run on real time and may pass 1 or keep moving after duration. */
export interface Curve { at(elapsed_ms: number, duration_ms: number): number; spring: boolean }

const compiled = new Map<string, Curve>();
function compile(spec: EaseSpec): Curve {
  const key = JSON.stringify(spec);
  const hit = compiled.get(key);
  if (hit) return hit;
  let c: Curve;
  if (spec === "linear") c = { at: (t, d) => clamp01(d > 0 ? t / d : 1), spring: false };
  else if ("bezier" in spec) { const f = bezier(...spec.bezier); c = { at: (t, d) => f(clamp01(d > 0 ? t / d : 1)), spring: false }; }
  else if ("trapezoid" in spec) { const f = trapezoid(...spec.trapezoid); c = { at: (t, d) => f(clamp01(d > 0 ? t / d : 1)), spring: false }; }
  else if ("spring" in spec) {
    const [hz, z] = spec.spring;
    const f = springFn(hz, z);
    // real time, not clamped to the segment: a spring keeps settling after its key (seconds as the duration, u = 1)
    c = { at: (t) => (t <= 0 ? 0 : f(1, t / 1000)), spring: true };
  } else throw new RangeError("unknown ease spec");
  compiled.set(key, c);
  return c;
}
const clamp01 = (u: number) => (u < 0 ? 0 : u > 1 ? 1 : u);

/** compile any Ease */
export const curve = (e: Ease): Curve => compile(easeSpec(e));

/** progress 0..1 of a move from `a` to `b` ms with ease `e`, at `ms` (springs keep settling after b) */
export function along(e: Ease, ms: number, a: number, b: number): number {
  if (ms <= a) return 0;
  const c = curve(e);
  if (!c.spring && ms >= b) return 1;
  return c.at(ms - a, b - a);
}

/** progress of an ease at p (0..1) of a move that lasts dur_ms (springs need a real length to look right) */
export const prog = (e: Ease, p: number, dur_ms = 600): number => (p <= 0 ? 0 : curve(e).at(Math.min(p, 1) * dur_ms, dur_ms));

/** CSS form of a bezier ease (for handing a curve to CSS or reading it back); null for springs */
export function cssEase(e: Ease): string | null {
  const s = easeSpec(e);
  if (s === "linear") return "linear";
  if ("bezier" in s) return `cubic-bezier(${s.bezier.map((v) => +v.toFixed(4)).join(", ")})`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// per-property keyframe tracks

/** [t_ms, value] or [t_ms, value, ease into this key] */
export type Key = [number, number] | [number, number, Ease];
export type TrackSpec = Record<string, Key[] | number>;

export interface Tracks<K extends string = string> {
  /** every property's value at ms */
  at(ms: number): Record<K, number>;
  /** one property's value at ms */
  get(prop: K, ms: number): number;
  /** the last key's time */
  end_ms: number;
}

/**
 * Keyframe each property on its own. A number is a constant. Before the first key: the first value; after the last: the last value
 * (or a spring still settling into it). `dflt` is the ease for keys that do not name one (default "house").
 */
export function tracks<K extends string>(spec: Record<K, Key[] | number>, dflt: Ease = "house"): Tracks<K> {
  const props = Object.keys(spec) as K[];
  const keys = {} as Record<K, Key[]>;
  let end = 0;
  for (const p of props) {
    const v = spec[p];
    const ks = typeof v === "number" ? [[0, v] as Key] : [...(v as Key[])].sort((a, b) => a[0] - b[0]);
    if (!ks.length) throw new RangeError(`track "${p}" has no keys`);
    keys[p] = ks;
    end = Math.max(end, ks[ks.length - 1][0]);
  }
  const get = (p: K, ms: number): number => {
    const ks = keys[p];
    if (!ks) throw new RangeError(`no track "${p}"`);
    if (ms <= ks[0][0]) return ks[0][1];
    // the segment that covers ms; after the last key, the last segment (a spring may still be settling)
    let i = 1;
    while (i < ks.length - 1 && ms > ks[i][0]) i++;
    const a = ks[i - 1], b = ks[i];
    if (!b) return a[1];
    const p01 = along(b[2] ?? dflt, ms, a[0], b[0]);
    return a[1] + (b[1] - a[1]) * p01;
  };
  return {
    get,
    at: (ms) => { const o = {} as Record<K, number>; for (const p of props) o[p] = get(p, ms); return o; },
    end_ms: end,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// named moves of a component, overridable by opts.ease

/** a component's moves: name -> default ease + what moves */
export type MotionTable = Record<string, { ease: Ease; doc: string }>;

/**
 * Resolve a component's moves against opts.ease. Unknown names and bad curves throw (a typo must not silently fall back),
 * so the desk sees its mistake in the shot's error instead of a default curve it did not ask for.
 */
export function motions<T extends MotionTable>(table: T, over: Partial<Record<string, Ease>> | undefined, who: string): Record<keyof T, Ease> {
  const out = {} as Record<keyof T, Ease>;
  for (const k in table) out[k] = table[k].ease;
  if (over) for (const k of Object.keys(over)) {
    if (!(k in table)) throw new RangeError(`${who}: no move "${k}" to ease (moves: ${Object.keys(table).join(", ")})`);
    const issue = easeIssue(over[k]);
    if (issue) throw new RangeError(`${who}: ease for "${k}": ${issue}`);
    (out as Record<string, Ease>)[k] = over[k] as Ease;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// fitting an ease to a reference clip

export interface FitEaseResult {
  /** the best cubic-bezier for the move */
  bezier: Bezier;
  css: string;
  /** residuals as a share of the move (|to - from|): rms 0.01 = 1% of the travel */
  rms: number;
  max: number;
  /** the same residuals in the samples' unit (px, degrees, ...) */
  rms_abs: number;
  /** the closest named preset and its residual (use the preset when it is close enough: the desk can say its name) */
  nearest: { name: EasePreset; rms: number };
  /** the move's ends as measured (t in the samples' unit, usually ms or frames) */
  from: { t: number; value: number };
  to: { t: number; value: number };
}

/**
 * Fit one move's measured position over time with a cubic-bezier. Input: samples [{t, value}] (t in any unit: ms or frames), or a
 * replica workbench measurement document read directly: fitEase(doc, "x", {from: 115, to: 130}) or fitEase(doc, "music.center.0")
 * (see ../measure.ts; t is then the frame number). Pick one move with from/to; a clip with several moves goes to fitCurve.
 * Time and value are normalised by the first and last sample; the four handles are searched by Nelder-Mead from every bezier
 * preset (x1, x2 kept in 0..1; y free so overshoot and anticipation fit). Deterministic.
 */
export function fitEase(samples: { t: number; value: number }[] | object, channel?: string, range?: { from?: number; to?: number }): FitEaseResult {
  const list = Array.isArray(samples) ? samples : measureSeries(samples, channel ?? "", range).points.map((p) => ({ t: p.f, value: p.value }));
  const pts = [...list].filter((s) => Number.isFinite(s.t) && Number.isFinite(s.value)).sort((a, b) => a.t - b.t);
  if (pts.length < 4) throw new RangeError("fitEase needs at least 4 samples");
  const a = pts[0], b = pts[pts.length - 1];
  const span = b.value - a.value, dur = b.t - a.t;
  if (!(dur > 0)) throw new RangeError("fitEase: samples need increasing t");
  if (Math.abs(span) < 1e-9) throw new RangeError("fitEase: the move does not move (first and last value are equal)");
  // one move: the end-to-end change must carry most of the excursion; a value that goes out and comes back is several moves
  const lo = Math.min(...pts.map((p) => p.value)), hi = Math.max(...pts.map((p) => p.value));
  if (Math.abs(span) < 0.6 * (hi - lo)) throw new RangeError(`fitEase: not one move (it travels ${(hi - lo).toFixed(1)} but ends ${Math.abs(span).toFixed(1)} from its start); narrow from/to to one move, or use fitCurve to cut the moves`);
  const U = pts.map((p) => (p.t - a.t) / dur), P = pts.map((p) => (p.value - a.value) / span);
  const err = (h: number[]): number => {
    if (h[0] < 0 || h[0] > 1 || h[2] < 0 || h[2] > 1 || h[1] < -2 || h[1] > 3 || h[3] < -2 || h[3] > 3) return 1e9;
    const f = bezier(h[0], h[1], h[2], h[3]);
    let s = 0;
    for (let i = 0; i < U.length; i++) { const d = f(U[i]) - P[i]; s += d * d; }
    return Math.sqrt(s / U.length);
  };
  const presets = (Object.keys(EASES) as EasePreset[]).filter((k) => typeof EASES[k].e === "object" && "bezier" in (EASES[k].e as object));
  let nearest = { name: "linear" as EasePreset, rms: err([0, 0, 1, 1]) };
  let best = { h: [0, 0, 1, 1], f: nearest.rms };
  for (const k of presets) {
    const h = [...((EASES[k].e as { bezier: Bezier }).bezier)];
    const f = err(h);
    if (f < nearest.rms) nearest = { name: k, rms: f };
    const r = nelderMead(err, h, 0.08, 400);
    if (r.f < best.f) best = r;
  }
  const h = best.h.map((v) => Math.round(v * 1e4) / 1e4) as Bezier;
  const f = bezier(...h);
  let s = 0, mx = 0;
  for (let i = 0; i < U.length; i++) { const d = Math.abs(f(U[i]) - P[i]); s += d * d; mx = Math.max(mx, d); }
  const rms = Math.sqrt(s / U.length);
  const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
  return { bezier: h, css: `cubic-bezier(${h.join(", ")})`, rms: r5(rms), max: r5(mx), rms_abs: r5(rms * Math.abs(span)), nearest: { name: nearest.name, rms: r5(nearest.rms) }, from: { t: a.t, value: a.value }, to: { t: b.t, value: b.value } };
}

/** plain Nelder-Mead minimiser (deterministic: fixed simplex from the start point) */
function nelderMead(f: (x: number[]) => number, x0: number[], step: number, iters: number): { h: number[]; f: number } {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (j === i ? v + (v + step <= 1 || i % 2 === 1 ? step : -step) : v)))].map((x) => ({ x, f: f(x) }));
  for (let it = 0; it < iters; it++) {
    simplex.sort((p, q) => p.f - q.f);
    if (simplex[n].f - simplex[0].f < 1e-10) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i].x[j] / n;
    const worst = simplex[n];
    const at = (k: number) => c.map((v, j) => v + k * (worst.x[j] - v));
    const r = at(-1), fr = f(r);
    if (fr < simplex[0].f) { const e = at(-2), fe = f(e); simplex[n] = fe < fr ? { x: e, f: fe } : { x: r, f: fr }; }
    else if (fr < simplex[n - 1].f) simplex[n] = { x: r, f: fr };
    else {
      const k = at(fr < worst.f ? -0.5 : 0.5), fk = f(k);
      if (fk < Math.min(fr, worst.f)) simplex[n] = { x: k, f: fk };
      else simplex = simplex.map((p, i) => (i === 0 ? p : (() => { const x = p.x.map((v, j) => simplex[0].x[j] + 0.5 * (v - simplex[0].x[j])); return { x, f: f(x) }; })()));
    }
  }
  simplex.sort((p, q) => p.f - q.f);
  return { h: simplex[0].x, f: simplex[0].f };
}
