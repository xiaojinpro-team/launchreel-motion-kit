/**
 * motion-fit: turn a measured value curve into eased segments (see ease.ts / keys.ts `segments`).
 *
 *  1. optional 3-point smoothing (used for segmentation and fitting; the reported residuals are against the raw samples);
 *  2. cut into moves: a plateau (|velocity| below plateauFrac of the range per frame for >= minPlateau frames) separates
 *     moves, and a velocity sign change cuts a move at the extremum;
 *  3. per move fit linear, trapezoid, bezier and spring against the measured end points (from / to) and keep the one with the
 *     smallest residual; if a simpler one already reaches `targetRms` it wins (linear > trapezoid > bezier > spring);
 *  4. report rms / max residual of the whole model against the raw samples.
 *
 * Residuals are measured in the working space (ln for space "log") and normalised by the curve's range in that space, so
 * `rms: 0.005` means 0.5% of the full excursion. Pure: no node imports.
 */
import { measureSeries } from "./measure.js";
import { bezier, coveringSegment, easeFromSpec, evaluateSegment, holdValue, segmentsSorted, spring, trapezoid, type EaseFn, type EaseSpec, type Seg, type Space } from "./ease.js";

export interface Point { f: number; value: number }
export interface FitOptions {
  fps: number;
  space?: Space;
  targetRms?: number;
  /** Absolute tolerance in the working space (pixels / the channel's unit, or ln units for space "log"): a move is good enough when
   *  its rms is within targetRms (share of the range) OR within targetAbs. Use it for big coordinates, where a share of a large
   *  range is a large error. */
  targetAbs?: number;
  smooth?: boolean;
  /** Velocity below this share of the range per frame counts as still. Default 0.002. */
  plateauFrac?: number;
  /** Frames of stillness that separate two moves. Default 3. */
  minPlateau?: number;
  /** Frames a reversed direction must last to cut a move (shorter bounces are ignored). Default 3. */
  minReversal?: number;
  /** Search kinks (a change of regime inside one move, cut at a fractional frame) when one easing cannot reach the target. Default true. */
  splitKinks?: boolean;
  /** Moves with a net change below this share of the range are noise and dropped. Default 0.01. */
  minMoveFrac?: number;
}
export type EaseKind = "linear" | "trapezoid" | "bezier" | "spring";
export const KIND_ORDER: EaseKind[] = ["linear", "trapezoid", "bezier", "spring"];
export interface SegmentReport { f0: number; f1: number; kind: EaseKind | "hold"; rms: number; max: number; rms_abs: number; max_abs: number; candidates: Partial<Record<EaseKind, { ease: EaseSpec; rms: number }>> }
export interface FitResult {
  segments: Seg[];
  /** rms / max: share of the range in the working space. rms_ratio (log space only): rms of model / measured - 1, i.e. the scale-ratio error. */
  fit: { space: Space; fps: number; target_rms: number; range: number; rms: number; max: number; rms_abs: number; max_abs: number; target_abs?: number; rms_ratio?: number; max_ratio?: number; notes: string[]; per_segment: SegmentReport[] };
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

function toWork(v: number, space: Space): number {
  if (space === "log") { if (!(v > 0)) throw new RangeError("log space needs all values > 0"); return Math.log(v); }
  return v;
}
const fromWork = (v: number, space: Space) => (space === "log" ? Math.exp(v) : v);

/** Accepts [{f,value}], [[f,value]], plain numbers (frame = firstFrame + index), or a replica measurement channel {"<frame>": value}. */
export function toPoints(raw: unknown, firstFrame = 0): Point[] {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return measureSeries(raw, "").points;
  if (!Array.isArray(raw)) throw new Error("input must be an array");
  const pts = raw.map((r, i): Point => {
    if (typeof r === "number") return { f: firstFrame + i, value: r };
    if (Array.isArray(r) && r.length === 2) return { f: Number(r[0]), value: Number(r[1]) };
    if (r && typeof r === "object" && "f" in r && "value" in r) return { f: Number((r as Point).f), value: Number((r as Point).value) };
    throw new Error(`input[${i}] must be a number, [f,value] or {f,value}`);
  });
  if (pts.some((p) => !Number.isFinite(p.f) || !Number.isFinite(p.value))) throw new Error("input has non-finite numbers");
  return pts.sort((a, b) => a.f - b.f);
}

/** Dotted path lookup ("a.b.c") into a parsed JSON document. */
export function pickPath(doc: unknown, dotted: string): unknown {
  let cur = doc;
  for (const k of dotted.split(".")) {
    if (cur && typeof cur === "object" && k in (cur as object)) cur = (cur as Record<string, unknown>)[k];
    else throw new Error(`path ${dotted}: "${k}" not found`);
  }
  return cur;
}

interface Run { pa: number; pb: number }

function segmentRuns(y: number[], f: number[], range: number, o: Required<Pick<FitOptions, "plateauFrac" | "minPlateau" | "minReversal">>): Run[] {
  const n = y.length;
  const v = Array.from({ length: n - 1 }, (_, i) => (y[i + 1] - y[i]) / (f[i + 1] - f[i]));
  const thr = o.plateauFrac * range;
  const still = v.map((x) => Math.abs(x) < thr);
  // plateau = a run of >= minPlateau still velocities
  const isPlateau = new Array<boolean>(v.length).fill(false);
  for (let i = 0; i < v.length;) {
    if (!still[i]) { i++; continue; }
    let j = i;
    while (j < v.length && still[j]) j++;
    if (j - i >= o.minPlateau) for (let k = i; k < j; k++) isPlateau[k] = true;
    i = j;
  }
  const runs: Run[] = [];
  for (let i = 0; i < v.length;) {
    if (isPlateau[i]) { i++; continue; }
    let j = i;
    while (j < v.length && !isPlateau[j]) j++;
    // moving velocities i..j-1 -> points i..j; cut at sign flips (at the extremum), but only when the new direction
    // persists for >= minReversal velocities: a one- or two-frame bounce is not a new move
    let start = i, prevSign = 0, prevIdx = -1;
    const persists = (k: number, sg: number) => { for (let m = k; m < k + o.minReversal; m++) if (m >= v.length || still[m] || Math.sign(v[m]) !== sg) return false; return true; };
    for (let k = i; k < j; k++) {
      const sg = still[k] ? 0 : Math.sign(v[k]);
      if (sg === 0) continue;
      if (prevSign !== 0 && sg !== prevSign) {
        if (!persists(k, sg)) continue; // a bounce: keep the old direction
        let best = prevIdx + 1;
        for (let m = prevIdx + 1; m <= k; m++) if (prevSign * y[m] > prevSign * y[best]) best = m;
        if (best > start) { runs.push({ pa: start, pb: best }); start = best; }
      }
      prevSign = sg; prevIdx = k;
    }
    runs.push({ pa: start, pb: j });
    i = j;
  }
  return runs.filter((r) => r.pb > r.pa);
}

type Obj = (p: number[]) => number;

/** Coordinate descent: for each parameter try ±step (within bounds), keep improvements, halve the step. */
function descend(p0: number[], obj: Obj, lo: number[], hi: number[], step0: number[], minStep: number): number[] {
  let p = [...p0], best = obj(p);
  let steps = [...step0];
  for (let round = 0; round < 60; round++) {
    let improved = false;
    for (let d = 0; d < p.length; d++) {
      for (const dir of [1, -1]) {
        const q = [...p];
        q[d] = Math.min(hi[d], Math.max(lo[d], q[d] + dir * steps[d]));
        if (q[d] === p[d]) continue;
        const e = obj(q);
        if (e < best - 1e-15) { best = e; p = q; improved = true; }
      }
    }
    if (!improved) { steps = steps.map((s) => s / 2); if (Math.max(...steps) < minStep) break; }
  }
  return p;
}

function gridBest(cands: number[][], obj: Obj): number[] {
  let best = cands[0], be = Infinity;
  for (const c of cands) { const e = obj(c); if (e < be) { be = e; best = c; } }
  return best;
}

interface FitCtx { u: number[]; ys: number[]; from: number; to: number; durS: number; range: number }
const rmsOf = (c: FitCtx, fn: EaseFn) => {
  let s = 0;
  for (let i = 0; i < c.u.length; i++) { const e = (c.from + (c.to - c.from) * fn(c.u[i], c.durS)) - c.ys[i]; s += e * e; }
  return Math.sqrt(s / c.u.length) / c.range;
};
const maxOf = (c: FitCtx, fn: EaseFn) => {
  let m = 0;
  for (let i = 0; i < c.u.length; i++) m = Math.max(m, Math.abs((c.from + (c.to - c.from) * fn(c.u[i], c.durS)) - c.ys[i]));
  return m / c.range;
};

function fitKind(kind: EaseKind, c: FitCtx): { ease: EaseSpec; rms: number } {
  if (kind === "linear") return { ease: "linear", rms: rmsOf(c, (u) => u) };
  if (kind === "trapezoid") {
    const mk = (p: number[]) => trapezoid(p[0], p[1]);
    const obj: Obj = (p) => (p[0] + p[1] > 1 ? Infinity : rmsOf(c, mk(p)));
    const grid: number[][] = [];
    for (let a = 0; a <= 1.0001; a += 0.1) for (let d = 0; a + d <= 1.0001; d += 0.1) grid.push([Math.min(a, 1), Math.min(d, 1 - Math.min(a, 1))]);
    const p = descend(gridBest(grid, obj), obj, [0, 0], [1, 1], [0.05, 0.05], 0.002);
    const spec: EaseSpec = { trapezoid: [r4(p[0]), r4(Math.min(p[1], 1 - r4(p[0])))] };
    return { ease: spec, rms: rmsOf(c, easeFromSpec(spec)) };
  }
  if (kind === "bezier") {
    const mk = (p: number[]) => bezier(p[0], p[1], p[2], p[3]);
    const obj: Obj = (p) => rmsOf(c, mk(p));
    const xs = [0, 0.2, 0.4, 0.6, 0.8, 1], ysg: number[] = [];
    for (let y = -0.4; y <= 1.4001; y += 0.2) ysg.push(r4(y));
    const grid: number[][] = [];
    for (const x1 of xs) for (const y1 of ysg) for (const x2 of xs) for (const y2 of ysg) grid.push([x1, y1, x2, y2]);
    const p = descend(gridBest(grid, obj), obj, [0, -1, 0, -1], [1, 2, 1, 2], [0.1, 0.1, 0.1, 0.1], 0.0005);
    const spec: EaseSpec = { bezier: [r4(p[0]), r4(p[1]), r4(p[2]), r4(p[3])] };
    return { ease: spec, rms: rmsOf(c, easeFromSpec(spec)) };
  }
  const mk = (p: number[]) => spring(Math.exp(p[0]), p[1]);
  const obj: Obj = (p) => rmsOf(c, mk(p));
  const grid: number[][] = [];
  for (let i = 0; i < 30; i++) for (let j = 0; j < 24; j++) grid.push([Math.log(0.3) + (i / 29) * (Math.log(12) - Math.log(0.3)), 0.05 + (j / 23) * 1.55]);
  const p = descend(gridBest(grid, obj), obj, [Math.log(0.05), 0], [Math.log(40), 3], [0.1, 0.05], 0.0005);
  const spec: EaseSpec = { spring: [r4(Math.exp(p[0])), r4(p[1])] };
  return { ease: spec, rms: rmsOf(c, easeFromSpec(spec)) };
}

export function fitCurve(points: Point[], opt: FitOptions): FitResult {
  const space = opt.space ?? "linear";
  const target = opt.targetRms ?? 0.01;
  const targetAbs = opt.targetAbs;
  if (points.length < 2) throw new Error("need at least 2 points");
  if (!(opt.fps > 0)) throw new Error("fps must be > 0");
  const f = points.map((p) => p.f);
  for (let i = 1; i < f.length; i++) if (!(f[i] > f[i - 1])) throw new Error(`frames must be strictly increasing (at ${f[i]})`);
  const raw = points.map((p) => toWork(p.value, space));
  const lo = Math.min(...raw), hi = Math.max(...raw), range = hi - lo;
  const notes = [
    `rms and max are shares of the curve's range (${r4(range)} in ${space} space): target_rms ${target} allows an rms of ${r4(target * range)}. A range-normalised rms is NOT safe for large coordinates (a small share of a big range is a big absolute error): check rms_abs / max_abs, or set --target-abs.`,
  ];
  const base = { space, fps: opt.fps, target_rms: target, ...(targetAbs !== undefined ? { target_abs: targetAbs } : {}), range: r4(range), notes };
  /** A move is good enough: within the share of the range, or within the absolute tolerance. */
  const ok = (rms: number) => rms <= target || (targetAbs !== undefined && rms * range <= targetAbs);
  if (!(range > 0)) {
    const v = r4v(fromWork(raw[0], space));
    return { segments: [{ f0: f[0], f1: f[f.length - 1], from: v, to: v, ease: "linear", ...(space === "log" ? { space } : {}) }], fit: { ...base, rms: 0, max: 0, rms_abs: 0, max_abs: 0, per_segment: [{ f0: f[0], f1: f[f.length - 1], kind: "hold", rms: 0, max: 0, rms_abs: 0, max_abs: 0, candidates: {} }] } };
  }
  const ys = opt.smooth ? raw.map((v, i) => (i === 0 || i === raw.length - 1 ? v : (raw[i - 1] + v + raw[i + 1]) / 3)) : raw;
  const runs = segmentRuns(ys, f, range, { plateauFrac: opt.plateauFrac ?? 0.002, minPlateau: opt.minPlateau ?? 3, minReversal: opt.minReversal ?? 3 });

  const minMove = (opt.minMoveFrac ?? 0.01) * range;
  const segments: Seg[] = [], per: SegmentReport[] = [];
  const yAt = (x: number): number => {
    if (x <= f[0]) return ys[0];
    if (x >= f[f.length - 1]) return ys[ys.length - 1];
    let lo = 0, hi = f.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f[m] <= x) lo = m; else hi = m; }
    return ys[lo] + ((ys[hi] - ys[lo]) * (x - f[lo])) / (f[hi] - f[lo]);
  };
  /** Samples of [f0, f1] with the end points interpolated (cuts may fall between frames). */
  const ctxFor = (f0: number, f1: number): FitCtx => {
    const xs = [f0, ...f.filter((x) => x > f0 + 1e-9 && x < f1 - 1e-9), f1];
    return { u: xs.map((x) => (x - f0) / (f1 - f0)), ys: xs.map(yAt), from: yAt(f0), to: yAt(f1), durS: (f1 - f0) / opt.fps, range };
  };
  const emit = (f0: number, f1: number, ctx: FitCtx, cands: SegmentReport["candidates"], chosen: EaseKind) => {
    const ease = cands[chosen]!.ease;
    const seg: Seg = { f0: r4v(f0), f1: r4v(f1), from: r4v(fromWork(ctx.from, space)), to: r4v(fromWork(ctx.to, space)), ease };
    if (space === "log") seg.space = "log";
    segments.push(seg);
    const mxs = maxOf(ctx, easeFromSpec(ease));
    per.push({ f0: seg.f0, f1: seg.f1, kind: chosen, rms: r4(cands[chosen]!.rms), max: r4(mxs), rms_abs: r4(cands[chosen]!.rms * range), max_abs: r4(mxs * range), candidates: Object.fromEntries(Object.entries(cands).map(([k, v]) => [k, { ease: v!.ease, rms: r4(v!.rms) }])) });
  };
  /** Simplest easing reaching the target, else the smallest residual. */
  const bestFit = (ctx: FitCtx) => {
    const cands: SegmentReport["candidates"] = {};
    let chosen: EaseKind | null = null;
    for (const k of KIND_ORDER) {
      cands[k] = fitKind(k, ctx);
      if (ok(cands[k]!.rms)) { chosen = k; break; }
    }
    if (!chosen) chosen = KIND_ORDER.filter((k) => cands[k]).reduce((a, b) => (cands[b]!.rms < cands[a]!.rms ? b : a));
    return { cands, chosen, rms: cands[chosen]!.rms };
  };
  const combined = (a: { rms: number; n: number }, b: { rms: number; n: number }) => Math.sqrt((a.rms * a.rms * a.n + b.rms * b.rms * b.n) / (a.n + b.n));
  const fitRun = (f0: number, f1: number, depth: number): void => {
    const ctx = ctxFor(f0, f1);
    if (Math.abs(ctx.to - ctx.from) < minMove) return; // noise
    const one = bestFit(ctx);
    if (!ok(one.rms) && depth > 0 && opt.splitKinks !== false) {
      // a change of regime inside the move (e.g. a slow drift, then the real move): search the cut, integer frames first,
      // then the fractional frames around the best one
      const inner = f.filter((x) => x - f0 >= 2 - 1e-9 && f1 - x >= 2 - 1e-9);
      const score = (c: number) => {
        const a = ctxFor(f0, c), b = ctxFor(c, f1);
        if (a.u.length < 3 || b.u.length < 3) return null;
        const ra = bestFit(a), rb = bestFit(b);
        return { c, rms: combined({ rms: ra.rms, n: a.u.length }, { rms: rb.rms, n: b.u.length }), cx: KIND_ORDER.indexOf(ra.chosen) + KIND_ORDER.indexOf(rb.chosen) };
      };
      // among cuts that reach the target prefer the simplest pair of easings (then the smallest residual); otherwise the smallest residual
      const better = (x: { rms: number; cx: number }, y: { rms: number; cx: number }) =>
        ok(x.rms) && ok(y.rms) ? x.cx < y.cx || (x.cx === y.cx && x.rms < y.rms) : ok(x.rms) ? true : ok(y.rms) ? false : x.rms < y.rms;
      let best: { c: number; rms: number; cx: number } | null = null;
      const consider = (c: number) => { const r = score(c); if (r && (!best || better(r, best))) best = r; };
      for (const c of inner) consider(c);
      if (best) {
        const c0 = (best as { c: number }).c;
        for (let d = -0.9; d <= 0.9001; d += 0.1) if (Math.abs(d) > 1e-9 && c0 + d > f0 + 1 && c0 + d < f1 - 1) consider(c0 + d);
      }
      const b = best as { c: number; rms: number; cx: number } | null;
      if (b && (ok(b.rms) || b.rms < 0.6 * one.rms)) { fitRun(f0, b.c, depth - 1); fitRun(b.c, f1, depth - 1); return; }
    }
    emit(f0, f1, ctx, one.cands, one.chosen);
  };
  for (let i = 0; i < runs.length;) {
    // A spring overshoots and rings back, which the sign-flip cut can split into several moves: try the touching run
    // group (longest first) as one spring before treating the run on its own.
    let jMax = i;
    while (jMax + 1 < runs.length && runs[jMax + 1].pa === runs[jMax].pb) jMax++;
    let merged = false;
    for (let j = jMax; j > i && !merged; j--) {
      const f0 = f[runs[i].pa], f1 = f[runs[j].pb], ctx = ctxFor(f0, f1);
      if (Math.abs(ctx.to - ctx.from) < minMove) continue;
      const c = fitKind("spring", ctx);
      if (ok(c.rms)) { emit(f0, f1, ctx, { spring: c }, "spring"); i = j + 1; merged = true; }
    }
    if (merged) continue;
    const run = runs[i++];
    fitRun(f[run.pa], f[run.pb], 2);
  }
  // plateaus (and dropped noise) become explicit hold segments, so the segments tile the whole curve with no gaps
  const tiled = segments.map((sg, i) => ({ sg, rep: per[i] })).sort((a, b) => a.sg.f0 - b.sg.f0);
  const out: { sg: Seg; rep: SegmentReport }[] = [];
  const hold = (f0: number, f1: number, v: number) => {
    if (!(f1 - f0 > 1e-9)) return;
    const ctx = ctxFor(f0, f1);
    const w = toWork(v, space);
    const err = ctx.ys.map((y) => w - y);
    const rmsH = Math.sqrt(err.reduce((a, e) => a + e * e, 0) / err.length), mxH = Math.max(...err.map(Math.abs));
    const sg: Seg = { f0: r4v(f0), f1: r4v(f1), from: r4v(v), to: r4v(v), ease: "linear", ...(space === "log" ? { space } : {}) };
    out.push({ sg, rep: { f0: sg.f0, f1: sg.f1, kind: "hold", rms: r4(rmsH / range), max: r4(mxH / range), rms_abs: r4(rmsH), max_abs: r4(mxH), candidates: {} } });
  };
  if (!tiled.length) hold(f[0], f[f.length - 1], fromWork(raw.reduce((a, v) => a + v, 0) / raw.length, space));
  else {
    hold(f[0], tiled[0].sg.f0, tiled[0].sg.from);
    tiled.forEach((t, i) => { out.push(t); if (i + 1 < tiled.length) hold(t.sg.f1, tiled[i + 1].sg.f0, t.sg.to); });
    hold(tiled[tiled.length - 1].sg.f1, f[f.length - 1], tiled[tiled.length - 1].sg.to);
  }
  segments.length = 0; per.length = 0;
  for (const t of out) { segments.push(t.sg); per.push(t.rep); }
  const stats = modelResiduals(segments, points, space, opt.fps, range);
  const ratio = space === "log" ? ratioError(segments, points, opt.fps) : null;
  return { segments, fit: { ...base, rms: r4(stats.rms), max: r4(stats.max), rms_abs: r4(stats.rmsAbs), max_abs: r4(stats.maxAbs), ...(ratio ? { rms_ratio: r4(ratio.rms), max_ratio: r4(ratio.max) } : {}), per_segment: per } };
}

const r4v = (v: number) => Math.round(v * 1e6) / 1e6;

/** Scale-ratio error of a log-space model: rms and max of |model / measured - 1|. */
export function ratioError(segments: Seg[], points: Point[], fps: number): { rms: number; max: number } {
  const sorted = segmentsSorted(segments);
  let se = 0, mx = 0;
  for (const p of points) {
    const cov = coveringSegment(sorted, p.f);
    const m = cov ? evaluateSegment(cov, p.f, fps) : holdValue(sorted, p.f) ?? points[0].value;
    const e = m / p.value - 1;
    se += e * e; mx = Math.max(mx, Math.abs(e));
  }
  return { rms: Math.sqrt(se / points.length), max: mx };
}

/** Residuals of the segment model (holds outside segments) against the raw samples, in working space. */
export function modelResiduals(segments: Seg[], points: Point[], space: Space, fps: number, range: number): { rms: number; max: number; rmsAbs: number; maxAbs: number } {
  const sorted = segmentsSorted(segments);
  let se = 0, mx = 0;
  for (const p of points) {
    const cov = coveringSegment(sorted, p.f);
    const m = cov ? evaluateSegment(cov, p.f, fps) : holdValue(sorted, p.f) ?? points[0].value;
    const e = toWork(m, space) - toWork(p.value, space);
    se += e * e; mx = Math.max(mx, Math.abs(e));
  }
  const rmsAbs = Math.sqrt(se / points.length);
  return { rms: rmsAbs / range, max: mx / range, rmsAbs, maxAbs: mx };
}

/** Puts `segments` on `target` ("layerId.channel" or "camera.z") of a keys document (copy); replaces that channel's segments. */
export function mergeSegments<D extends { layers?: { id: string; segments?: Record<string, Seg[]> }[]; camera?: { segments?: Record<string, Seg[]> } }>(doc: D, target: string, segments: Seg[]): D {
  const dot = target.lastIndexOf(".");
  if (dot < 1) throw new Error(`target must be <layer>.<channel> or camera.<channel>, got "${target}"`);
  const owner = target.slice(0, dot), channel = target.slice(dot + 1);
  const copy = JSON.parse(JSON.stringify(doc)) as D & { timeline?: Record<string, unknown> };
  if (owner === "timeline" && channel === "shutter") { copy.timeline = { ...copy.timeline, shutter: { segments } }; return copy; }
  if (owner === "camera" && !copy.layers?.some((l) => l.id === "camera")) {
    copy.camera = copy.camera ?? {};
    copy.camera.segments = { ...copy.camera.segments, [channel]: segments };
    return copy;
  }
  const layer = copy.layers?.find((l) => l.id === owner);
  if (!layer) throw new Error(`layer "${owner}" not found in the keys document`);
  layer.segments = { ...layer.segments, [channel]: segments };
  return copy;
}

/**
 * Fits a per-frame shutter sample list (values 0..1) to segments for `timeline.shutter: { segments }`. Linear space, absolute
 * tolerance 0.01 by default (shutter is a small bounded number, so a share of its range would be too loose); end values are
 * clamped to 0..1. Fitting a shutter curve back out of a rendered streak is not done here (that stays in the analysis tools).
 */
export function fitShutter(points: Point[], opt: Omit<FitOptions, "space"> ): FitResult {
  const bad = points.find((p) => p.value < 0 || p.value > 1);
  if (bad) throw new RangeError(`shutter values must be in 0..1 (frame ${bad.f} is ${bad.value})`);
  const res = fitCurve(points, { ...opt, space: "linear", targetAbs: opt.targetAbs ?? 0.01 });
  const c = (v: number) => Math.min(1, Math.max(0, v));
  for (const sg of res.segments) { sg.from = c(sg.from); sg.to = c(sg.to); }
  return res;
}
