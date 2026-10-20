/**
 * Easing engine. Every easing is `(u, duration_s?) => p` with u and p in 0..1 (spring may overshoot and need not settle at
 * u = 1). `duration_s` is the real length of the segment in seconds and is only used by spring.
 *
 * JSON spec (what a keys file or a curve library stores):
 *   "linear" | { "bezier": [x1,y1,x2,y2] } | { "trapezoid": [accel,decel] } | { "spring": [freqHz,damping] }
 */
export type EaseFn = (u: number, duration_s?: number) => number;
export type EaseSpec = "linear" | { bezier: [number, number, number, number] } | { trapezoid: [number, number] } | { spring: [number, number] };

export const linear = (): EaseFn => (u) => clamp01(u);

const clamp01 = (u: number) => (u < 0 ? 0 : u > 1 ? 1 : u);

/** CSS cubic-bezier(x1,y1,x2,y2) semantics: solve x(t) = u (Newton, bisection fallback), return y(t). x1,x2 must be in 0..1. */
export function bezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  if (!(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1)) throw new RangeError("bezier: x1 and x2 must be in 0..1");
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t: number) => ((ax * t + bx) * t + cx) * t;
  const Y = (t: number) => ((ay * t + by) * t + cy) * t;
  const dX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let t = u;
    for (let i = 0; i < 8; i++) {
      const err = X(t) - u;
      if (Math.abs(err) < 1e-9) return Y(t);
      const d = dX(t);
      if (Math.abs(d) < 1e-7) break;
      t -= err / d;
    }
    let lo = 0, hi = 1;
    t = u;
    for (let i = 0; i < 60; i++) {
      const x = X(t);
      if (Math.abs(x - u) < 1e-9) break;
      if (x < u) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return Y(t);
  };
}

/**
 * Start easing, run at constant speed, stop easing. accel and decel are the shares (0..1, sum <= 1) of the segment duration
 * spent speeding up (constant acceleration) and slowing down (constant deceleration); the middle share is constant speed.
 * Normalised so p(0) = 0 and p(1) = 1; accel = decel = 0 is linear.
 */
export function trapezoid(accel: number, decel: number): EaseFn {
  if (!(accel >= 0 && decel >= 0 && accel + decel <= 1 + 1e-12)) throw new RangeError("trapezoid: accel, decel >= 0 and accel + decel <= 1");
  const v = 1 / (1 - (accel + decel) / 2); // peak speed so that the area under the speed profile is 1
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    if (accel > 0 && u < accel) return (v * u * u) / (2 * accel);
    if (decel > 0 && u > 1 - decel) { const r = 1 - u; return 1 - (v * r * r) / (2 * decel); }
    return v * (accel / 2 + (u - accel));
  };
}

/**
 * Step response of a damped spring (natural frequency freqHz, damping ratio): under-, critically and over-damped forms.
 * Time is the real elapsed seconds, u * duration_s, so the same spring looks the same on a longer segment (it just has
 * more time to settle). The end is NOT forced to 1: the caller decides whether to hold or cut.
 */
export function spring(freqHz: number, dampingRatio: number): EaseFn {
  if (!(freqHz > 0) || !(dampingRatio >= 0)) throw new RangeError("spring: freqHz > 0 and dampingRatio >= 0");
  const w = 2 * Math.PI * freqHz, z = dampingRatio;
  return (u, duration_s = 1) => {
    const t = clamp01(u) * duration_s;
    if (t <= 0) return 0;
    if (Math.abs(z - 1) < 1e-6) return 1 - Math.exp(-w * t) * (1 + w * t);
    if (z < 1) {
      const wd = w * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
    }
    const s = w * Math.sqrt(z * z - 1);
    return 1 - Math.exp(-z * w * t) * (Math.cosh(s * t) + ((z * w) / s) * Math.sinh(s * t));
  };
}

export function easeProblems(spec: unknown): string[] {
  if (spec === "linear") return [];
  const nums = (a: unknown, n: number) => Array.isArray(a) && a.length === n && a.every((v) => typeof v === "number" && Number.isFinite(v));
  if (spec && typeof spec === "object" && !Array.isArray(spec)) {
    const keys = Object.keys(spec);
    const s = spec as Record<string, unknown>;
    if (keys.length === 1) {
      try {
        if (keys[0] === "bezier") { if (!nums(s.bezier, 4)) return ["bezier needs 4 numbers"]; const b = s.bezier as number[]; bezier(b[0], b[1], b[2], b[3]); return []; }
        if (keys[0] === "trapezoid") { if (!nums(s.trapezoid, 2)) return ["trapezoid needs [accel,decel]"]; const t = s.trapezoid as number[]; trapezoid(t[0], t[1]); return []; }
        if (keys[0] === "spring") { if (!nums(s.spring, 2)) return ["spring needs [freqHz,damping]"]; const t = s.spring as number[]; spring(t[0], t[1]); return []; }
      } catch (e) { return [(e as Error).message]; }
    }
  }
  return ['ease must be "linear", {bezier:[x1,y1,x2,y2]}, {trapezoid:[accel,decel]} or {spring:[freqHz,damping]}'];
}

const cache = new WeakMap<object, EaseFn>();
/** Compiles a JSON spec to a function (object specs are cached by identity). Throws on a bad spec. */
export function easeFromSpec(spec: EaseSpec): EaseFn {
  if (spec === "linear") return linear();
  const hit = cache.get(spec);
  if (hit) return hit;
  const p = easeProblems(spec);
  if (p.length) throw new RangeError(p.join("; "));
  let fn: EaseFn;
  if ("bezier" in spec) fn = bezier(...spec.bezier);
  else if ("trapezoid" in spec) fn = trapezoid(...spec.trapezoid);
  else fn = spring(...spec.spring);
  cache.set(spec, fn);
  return fn;
}

export type Space = "linear" | "log";
/** One eased move of one channel over frames [f0, f1): the last segment of a channel also includes f1. */
export interface Seg { f0: number; f1: number; from: number; to: number; ease: EaseSpec; space?: Space }

/** Value of a segment at frame f (u clamped to 0..1). `log` interpolates in ln space and needs from, to > 0. */
export function evaluateSegment(seg: Seg, f: number, fps: number, defaultSpace?: Space): number {
  const u = clamp01((f - seg.f0) / (seg.f1 - seg.f0));
  const p = easeFromSpec(seg.ease)(u, (seg.f1 - seg.f0) / fps);
  // defaultSpace "log" only applies when it is possible (both ends > 0); an explicit space is always honoured
  const space = seg.space ?? (defaultSpace === "log" && seg.from > 0 && seg.to > 0 ? "log" : "linear");
  if (space === "log") {
    if (!(seg.from > 0 && seg.to > 0)) throw new RangeError("log space needs from and to > 0");
    const a = Math.log(seg.from);
    return Math.exp(a + (Math.log(seg.to) - a) * p);
  }
  return seg.from + (seg.to - seg.from) * p;
}

/** The segment covering f (f0 <= f < f1; the last one also f1) in an ordered, non-overlapping list, or undefined. */
export function coveringSegment(segs: Seg[], f: number): Seg | undefined {
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (f >= s.f0 && (f < s.f1 || (i === segs.length - 1 && f === s.f1))) return s;
  }
  return undefined;
}

/** Hold value outside every segment: `to` of the nearest earlier segment, else `from` of the nearest later one. */
export function holdValue(segs: Seg[], f: number): number | undefined {
  let before: Seg | undefined, after: Seg | undefined;
  for (const s of segs) { if (s.f1 <= f) before = s; else if (s.f0 > f && !after) after = s; }
  return before ? before.to : after?.from;
}

export function segmentsSorted(segs: Seg[]): Seg[] { return [...segs].sort((a, b) => a.f0 - b.f0); }
