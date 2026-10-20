/**
 * xjp.motion-keys.v1 — per-layer keyed frames of textured cards.
 *
 *   { schema:"xjp.motion-keys.v1", fps, size:[w,h],
 *     layers:[{ id, texture, anchor:[ax,ay], frames:[{ f, x, y, sx, sy, rot, opacity, blur? }] }],
 *     camera?:{ frames:[{ f, z, fov }] } }
 *
 * Conventions (v1): f is a frame index (fractional allowed when sampling); x,y are the canvas position of the layer's
 * anchor in pixels; anchor is normalised to the texture (0..1, [0.5,0.5] = centre); sx,sy are scale factors (1 = texture
 * size); rot is degrees, clockwise; opacity 0..1; blur is a Gaussian radius in pixels. Layers draw in array order
 * (first = back). Before the first / after the last keyed frame values hold. Between keyed frames they interpolate
 * linearly (default) or, with interp:"catmull" (document or layer level, layer wins), along a uniform Catmull-Rom
 * spline per channel (x, y, sx, sy, rot, opacity; end keys clamped; rot is a plain number, no angle wrap; blur and the
 * camera stay linear). timeline.shutter overrides __meta.shutter per frame.
 *
 * Segments (layer.segments / camera.segments): per channel a list of { f0, f1, from, to, ease, space? } eased moves over the
 * half-open frame range [f0, f1) (the channel's last segment also covers f1); segments of one channel must not overlap.
 * A channel that has segments uses ONLY its segments (keyed frames are ignored for that channel): the covering segment;
 * between segments the `to` of the previous one is held; before the first segment its `from`; after the last, its `to`.
 * Channels without segments use the keyed frames (interp as above). A channel with neither takes a default:
 * x 0, y 0, sx 1, sy 1, rot 0, opacity 1, z 0, blur none; camera fov 40, the rest absent (see camera.ts).
 * Evaluation instant: an integer frame f is evaluated at the START of the frame, t = f / fps (not mid-frame). Segments are
 * half-open [f0, f1), so at f = f0 a segment gives exactly `from`, and the frame before f0 never sees it: the frame a card
 * "enters" on is the same for every consumer. (The player snaps t * fps to the nearest integer when it is within 1e-6, so
 * rounding in t = f / fps cannot land a frame just before its own f0.)
 * Camera z and fov segments interpolate in log space unless `space` says otherwise (falling back to linear when an end
 * is <= 0).
 */
import { coveringSegment, easeProblems, evaluateSegment, holdValue, segmentsSorted, type Seg, type Space } from "./ease.js";
export const KEYS_SCHEMA = "xjp.motion-keys.v1";

export interface LayerKey {
  f: number; x: number; y: number; sx: number; sy: number; rot: number; opacity: number; blur?: number;
  /** Depth for the 2.5D camera: 0 = the screen plane, positive = away from the lens. Default 0. */
  z?: number;
}
export type Interp = "linear" | "catmull";
export type LayerChannel = "x" | "y" | "sx" | "sy" | "rot" | "opacity" | "blur" | "z";
export type CameraChannel = "x" | "y" | "z" | "fov" | "roll" | "tx" | "ty" | "tz";
/** Eased segments per channel (see ease.ts). Optional; `frames` may then be empty or absent. */
export type Segments<C extends string> = Partial<Record<C, Seg[]>>;
export type MotionBlurMethod = "accumulate" | "directional" | "radial";
/** Per-layer motion blur: false (default) | true (= accumulate, shutter 0.5) | options. */
export type MotionBlur = boolean | { shutter?: number | Seg[] | "timeline"; method?: MotionBlurMethod; strength?: number; center?: [number, number] };
export interface Layer { id: string; texture: string; anchor: [number, number]; frames: LayerKey[]; interp?: Interp; segments?: Segments<LayerChannel>; motionBlur?: MotionBlur }
/** Camera keyed frame: z (distance to the z=0 plane, px) and fov (vertical, degrees) are required; the rest is optional. */
export interface CameraKey { f: number; z: number; fov: number; x?: number; y?: number; roll?: number; tx?: number; ty?: number; tz?: number }
/** A sampled camera state: every field optional except f; missing z means "home distance", fov defaults to 40. */
export interface CameraSample { f: number; fov: number; z?: number; x?: number; y?: number; roll?: number; tx?: number; ty?: number; tz?: number }
export interface MotionKeys {
  schema: typeof KEYS_SCHEMA;
  fps: number;
  size: [number, number];
  layers: Layer[];
  camera?: {
    frames?: CameraKey[]; segments?: Segments<CameraChannel>;
    /** Near plane in px (default 0.02 * focal length): closer cards are clamped to it and fade out over [near, 2 * near]. */
    near?: number;
    /** false: no fade, closer cards are drawn at full alpha clamped to the near plane. Default true. */
    nearFade?: boolean;
  };
  /** Default interpolation of every layer (a layer's own `interp` overrides it). Default "linear". */
  interp?: Interp;
  /** Per-frame shutter: linear between keys, held at the ends; absent = __meta.shutter. */
  timeline?: { shutter?: ShutterKey[] | { segments: Seg[] } };
}
export interface ShutterKey { f: number; value: number }

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInterp = (v: unknown): v is Interp => v === "linear" || v === "catmull";

export class KeysError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`${KEYS_SCHEMA}: ${problems.join("; ")}`);
    this.name = "KeysError";
    this.problems = problems;
  }
}

export const LAYER_CHANNELS: string[] = ["x", "y", "sx", "sy", "rot", "opacity", "blur", "z"];
export const CAMERA_CHANNELS: string[] = ["x", "y", "z", "fov", "roll", "tx", "ty", "tz"];

export function segmentProblems(where: string, segments: unknown, channels: string[]): string[] {
  const p: string[] = [];
  if (!segments || typeof segments !== "object" || Array.isArray(segments)) return [`${where}.segments must be an object of channel -> segment list`];
  for (const [ch, list] of Object.entries(segments as Record<string, unknown>)) {
    const w = `${where}.segments.${ch}`;
    if (!channels.includes(ch)) { p.push(`${w}: unknown channel (allowed: ${channels.join(", ")})`); continue; }
    if (!Array.isArray(list) || list.length === 0) { p.push(`${w} must be a non-empty array`); continue; }
    const good: Seg[] = [];
    list.forEach((sg: unknown, i) => {
      const ww = `${w}[${i}]`;
      if (!sg || typeof sg !== "object") { p.push(`${ww} must be an object`); return; }
      const r = sg as Record<string, unknown>;
      let ok = true;
      for (const k of ["f0", "f1", "from", "to"]) if (!isNum(r[k])) { p.push(`${ww}.${k} must be a finite number`); ok = false; }
      if (isNum(r.f0) && isNum(r.f1) && r.f1 <= r.f0) { p.push(`${ww}: f1 (${r.f1}) must be greater than f0 (${r.f0})`); ok = false; }
      for (const m of easeProblems(r.ease)) { p.push(`${ww}.ease: ${m}`); ok = false; }
      if (r.space !== undefined && r.space !== "linear" && r.space !== "log") { p.push(`${ww}.space must be "linear" or "log"`); ok = false; }
      if (r.space === "log" && isNum(r.from) && isNum(r.to) && !(r.from > 0 && r.to > 0)) { p.push(`${ww}: log space needs from and to > 0`); ok = false; }
      if (ok) good.push(r as unknown as Seg);
    });
    const sorted = segmentsSorted(good);
    for (let i = 1; i < sorted.length; i++) if (sorted[i].f0 < sorted[i - 1].f1) p.push(`${w}: segments [${sorted[i - 1].f0},${sorted[i - 1].f1}) and [${sorted[i].f0},${sorted[i].f1}) overlap`);
  }
  return p;
}

function motionBlurProblems(where: string, mb: unknown): string[] {
  const w = `${where}.motionBlur`;
  if (typeof mb === "boolean") return [];
  if (!mb || typeof mb !== "object" || Array.isArray(mb)) return [`${w} must be false, true or an object`];
  const p: string[] = [], r = mb as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!["shutter", "method", "strength", "center"].includes(k)) p.push(`${w}.${k}: unknown option`);
  if (r.method !== undefined && !["accumulate", "directional", "radial"].includes(r.method as string)) p.push(`${w}.method must be accumulate, directional or radial`);
  if (r.strength !== undefined && !(isNum(r.strength) && r.strength > 0)) p.push(`${w}.strength must be a number > 0`);
  if (r.center !== undefined && !(Array.isArray(r.center) && r.center.length === 2 && r.center.every(isNum))) p.push(`${w}.center must be [x,y]`);
  if (r.shutter !== undefined) {
    if (r.shutter === "timeline") { /* the envelope timeline.shutter */ }
    else if (isNum(r.shutter)) { if (r.shutter < 0 || r.shutter > 1) p.push(`${w}.shutter must be in 0..1`); }
    else if (Array.isArray(r.shutter)) p.push(...segmentProblems(w, { shutter: r.shutter }, ["shutter"]).map((m) => m.replace(`${w}.segments.shutter`, `${w}.shutter`)));
    else p.push(`${w}.shutter must be a number, a segment list or "timeline"`);
  }
  return p;
}

const hasSegments = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0;
const noFrames = (v: unknown) => v === undefined || (Array.isArray(v) && v.length === 0);

function frameProblems(where: string, frames: unknown, required: string[], optional: string[] = []): string[] {
  const p: string[] = [];
  if (!Array.isArray(frames) || frames.length === 0) return [`${where}.frames must be a non-empty array`];
  let prev = -Infinity;
  frames.forEach((fr: unknown, i) => {
    if (!fr || typeof fr !== "object") { p.push(`${where}.frames[${i}] must be an object`); return; }
    const r = fr as Record<string, unknown>;
    for (const k of required) if (!isNum(r[k])) p.push(`${where}.frames[${i}].${k} must be a finite number`);
    for (const k of optional) if (r[k] !== undefined && !isNum(r[k])) p.push(`${where}.frames[${i}].${k} must be a finite number`);
    if (isNum(r.f)) {
      if (r.f <= prev) p.push(`${where}.frames[${i}].f (${r.f}) must be strictly greater than the previous (${prev})`);
      prev = r.f;
    }
  });
  return p;
}

/** Returns the list of problems (empty = valid). */
export function keysProblems(doc: unknown): string[] {
  if (!doc || typeof doc !== "object") return ["document must be an object"];
  const d = doc as Record<string, unknown>;
  const p: string[] = [];
  if (d.schema !== KEYS_SCHEMA) p.push(`schema must be "${KEYS_SCHEMA}"`);
  if (!isNum(d.fps) || d.fps <= 0) p.push("fps must be a number > 0");
  if (!Array.isArray(d.size) || d.size.length !== 2 || !d.size.every((n) => isNum(n) && Number.isInteger(n) && n >= 1)) p.push("size must be [w,h] positive integers");
  if (!Array.isArray(d.layers)) p.push("layers must be an array");
  else {
    const ids = new Set<string>();
    d.layers.forEach((l: unknown, i) => {
      const w = `layers[${i}]`;
      if (!l || typeof l !== "object") { p.push(`${w} must be an object`); return; }
      const r = l as Record<string, unknown>;
      if (typeof r.id !== "string" || !r.id) p.push(`${w}.id must be a non-empty string`);
      else if (ids.has(r.id)) p.push(`${w}.id "${r.id}" is duplicated`);
      else ids.add(r.id);
      if (typeof r.texture !== "string" || !r.texture) p.push(`${w}.texture must be a non-empty string`);
      if (!Array.isArray(r.anchor) || r.anchor.length !== 2 || !r.anchor.every(isNum)) p.push(`${w}.anchor must be [ax,ay] numbers`);
      if (r.interp !== undefined && !isInterp(r.interp)) p.push(`${w}.interp must be "linear" or "catmull"`);
      if (r.motionBlur !== undefined) p.push(...motionBlurProblems(w, r.motionBlur));
      if (r.segments !== undefined) p.push(...segmentProblems(w, r.segments, LAYER_CHANNELS));
      if (noFrames(r.frames) && hasSegments(r.segments)) { /* segments only: fine */ }
      else p.push(...frameProblems(w, r.frames, ["f", "x", "y", "sx", "sy", "rot", "opacity"], ["blur", "z"]));
    });
  }
  if (d.interp !== undefined && !isInterp(d.interp)) p.push('interp must be "linear" or "catmull"');
  if (d.timeline !== undefined) {
    const t = d.timeline as Record<string, unknown> | null;
    if (!t || typeof t !== "object" || Array.isArray(t)) p.push("timeline must be an object");
    else if (t.shutter !== undefined) {
      if (t.shutter && typeof t.shutter === "object" && !Array.isArray(t.shutter)) {
        const sh = t.shutter as Record<string, unknown>;
        if (Object.keys(sh).some((k) => k !== "segments")) p.push("timeline.shutter object may only have segments");
        p.push(...segmentProblems("timeline", { shutter: sh.segments }, ["shutter"]).map((m) => m.replace("timeline.segments.shutter", "timeline.shutter.segments")));
        if (Array.isArray(sh.segments)) sh.segments.forEach((g: unknown, i) => {
          const r = g as Record<string, unknown> | null;
          for (const k of ["from", "to"]) if (r && isNum(r[k]) && ((r[k] as number) < 0 || (r[k] as number) > 1)) p.push(`timeline.shutter.segments[${i}].${k} must be in 0..1`);
        });
      } else {
        p.push(...frameProblems("timeline.shutter", t.shutter, ["f", "value"]).map((m) => m.replace(".frames", "")));
        if (Array.isArray(t.shutter)) t.shutter.forEach((k: unknown, i) => {
          const v = (k as Record<string, unknown> | null)?.value;
          if (isNum(v) && (v < 0 || v > 1)) p.push(`timeline.shutter[${i}].value must be in 0..1`);
        });
      }
    }
  }
  if (d.camera !== undefined) {
    const c = d.camera as Record<string, unknown> | null;
    if (!c || typeof c !== "object") p.push("camera must be an object");
    else {
      if (c.near !== undefined && !(isNum(c.near) && c.near > 0)) p.push("camera.near must be a number > 0");
      if (c.nearFade !== undefined && typeof c.nearFade !== "boolean") p.push("camera.nearFade must be true or false");
      if (c.segments !== undefined) p.push(...segmentProblems("camera", c.segments, CAMERA_CHANNELS));
      if (noFrames(c.frames) && hasSegments(c.segments)) { /* segments only */ }
      else p.push(...frameProblems("camera", c.frames, ["f", "z", "fov"], ["x", "y", "roll", "tx", "ty", "tz"]));
    }
  }
  return p;
}

/** Throws KeysError when invalid; returns the document typed. */
export function validateKeys(doc: unknown): MotionKeys {
  const p = keysProblems(doc);
  if (p.length) throw new KeysError(p);
  return doc as MotionKeys;
}

/** Last keyed frame index of the document (layers and camera). */
export function lastFrame(keys: MotionKeys): number {
  let last = 0;
  const segEnd = (g?: Record<string, Seg[] | undefined>) => { for (const list of Object.values(g ?? {})) for (const sg of list ?? []) last = Math.max(last, sg.f1); };
  for (const l of keys.layers) {
    if (l.frames?.length) last = Math.max(last, l.frames[l.frames.length - 1].f);
    segEnd(l.segments);
  }
  if (keys.camera) {
    if (keys.camera.frames?.length) last = Math.max(last, keys.camera.frames[keys.camera.frames.length - 1].f);
    segEnd(keys.camera.segments);
  }
  return last;
}

/** Linear interpolation of numeric fields of sorted keyed frames at f; holds before the first and after the last. */
function sampleFrames<T extends { f: number }>(frames: T[], f: number, fields: (keyof T & string)[], splineFields: string[] = []): T {
  const first = frames[0], last = frames[frames.length - 1];
  if (f <= first.f) return { ...first };
  if (f >= last.f) return { ...last };
  // binary search for the keyed interval [lo, hi] with frames[lo].f <= f < frames[hi].f
  let lo = 0, hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].f <= f) lo = mid; else hi = mid;
  }
  const a = frames[lo], b = frames[hi];
  const u = (f - a.f) / (b.f - a.f);
  const out = { ...a } as Record<string, unknown>;
  for (const k of fields) {
    const av = a[k] as unknown as number | undefined, bv = b[k] as unknown as number | undefined;
    if (av === undefined && bv === undefined) continue;
    const x = av ?? bv!, y = bv ?? av!; // a missing optional value takes the other key's
    if (splineFields.includes(k)) {
      const p0 = (frames[Math.max(lo - 1, 0)][k] as unknown as number), p3 = (frames[Math.min(hi + 1, frames.length - 1)][k] as unknown as number);
      out[k] = catmullRom(p0, x, y, p3, u);
    } else out[k] = x + (y - x) * u;
  }
  out.f = f;
  return out as T;
}

/** Uniform Catmull-Rom between p1 (u=0) and p2 (u=1); p0 / p3 are the neighbouring keys (clamped to the end keys). */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

const SPLINE_FIELDS = ["x", "y", "sx", "sy", "rot", "opacity", "z"];
const LAYER_FIELDS: (keyof LayerKey & string)[] = ["x", "y", "sx", "sy", "rot", "opacity", "blur", "z"];

const sortedCache = new WeakMap<Seg[], Seg[]>();
const sortedOf = (list: Seg[]) => { let r = sortedCache.get(list); if (!r) { r = segmentsSorted(list); sortedCache.set(list, r); } return r; };

/** Value of a segment list at f: the covering segment, else the previous `to`, else the next `from` (undefined when empty). */
export function sampleSegmentList(list: Seg[], f: number, fps: number, defaultSpace?: Space): number | undefined {
  if (!list.length) return undefined;
  const sorted = sortedOf(list);
  const cov = coveringSegment(sorted, f);
  return cov ? evaluateSegment(cov, f, fps, defaultSpace) : holdValue(sorted, f);
}

/** Overwrites the channels of `out` that have segments (segments only: keyed frames are not consulted for those channels). */
function applySegments(out: Record<string, number | undefined>, segments: Record<string, Seg[] | undefined> | undefined, f: number, fps: number | undefined, who: string, logChannels: string[] = []): void {
  if (!segments) return;
  if (fps === undefined) throw new Error(`${who}: fps is required to sample segments`);
  for (const [ch, list] of Object.entries(segments)) {
    if (!list?.length) continue;
    const v = sampleSegmentList(list, f, fps, logChannels.includes(ch) ? "log" : undefined);
    if (v !== undefined) out[ch] = v;
  }
}

const LAYER_DEFAULTS = { x: 0, y: 0, sx: 1, sy: 1, rot: 0, opacity: 1, z: 0 };

/**
 * The layer's state at (fractional) frame f. `blur` is only present when a keyed frame or a segment gives it.
 * `docInterp` is the document-level default; layer.interp overrides it; absent = "linear". Catmull-Rom may overshoot
 * (opacity can leave 0..1): the player clamps what it draws, sampleLayer returns the raw value.
 * Channels with segments follow the order in the header comment; `fps` is required when the layer has segments.
 */
export function sampleLayer(layer: Layer, f: number, docInterp?: Interp, fps?: number): LayerKey {
  const mode = layer.interp ?? docInterp ?? "linear";
  const base = layer.frames?.length ? sampleFrames(layer.frames, f, LAYER_FIELDS, mode === "catmull" ? SPLINE_FIELDS : []) : undefined;
  if (!layer.segments) return base ?? { f, ...LAYER_DEFAULTS };
  const out = (base ? { ...base } : { f, ...LAYER_DEFAULTS }) as unknown as Record<string, number | undefined>;
  applySegments(out, layer.segments, f, fps, `layer ${layer.id}`);
  out.f = f;
  return out as unknown as LayerKey;
}

/**
 * Shutter (0..1) at frame f from timeline.shutter: a point list (linear, held at the ends) or { segments } (same rule as any
 * channel); `fallback` (__meta.shutter) when there is none. Eased segments may overshoot: the result is clamped to 0..1.
 * `fps` is required for segments.
 */
export function sampleShutter(keys: MotionKeys, f: number, fallback: number, fps: number = keys.fps): number {
  const t = keys.timeline?.shutter;
  if (!t) return fallback;
  if (!Array.isArray(t)) {
    const v = sampleSegmentList(t.segments, f, fps);
    return v === undefined ? fallback : Math.min(1, Math.max(0, v));
  }
  if (!t.length) return fallback;
  return sampleFrames(t as unknown as { f: number; value: number }[], f, ["value"]).value;
}

const CAMERA_FIELDS = ["z", "fov", "x", "y", "roll", "tx", "ty", "tz"];

/** The camera's state at frame f, or null when the document has no camera. z / fov segments are log-space by default. */
export function sampleCamera(keys: MotionKeys, f: number): CameraSample | null {
  const c = keys.camera;
  if (!c) return null;
  const base = c.frames?.length ? sampleFrames(c.frames, f, CAMERA_FIELDS as (keyof CameraKey & string)[]) : undefined;
  const out = (base ? { ...base } : { f, fov: 40 }) as unknown as Record<string, number | undefined>;
  applySegments(out, c.segments, f, keys.fps, "camera", ["z", "fov"]);
  out.f = f;
  return out as unknown as CameraSample;
}
