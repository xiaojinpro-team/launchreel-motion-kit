/**
 * 2.5D camera. Layers are flat cards with a depth `z` (0 = the screen plane, positive = away from the lens); the camera
 * projects each card's anchor with a pinhole model and scales the card by the same factor (cards stay billboards).
 *
 * Camera channels (keys.camera, frames or segments):
 *   fov   vertical field of view, degrees (default 40); focal length f = (H/2) / tan(fov/2) px
 *   z     distance from the lens to the z = 0 plane, px (default = f, "home": a z = 0 card is drawn at scale 1).
 *         Smaller = push in. (Lead's formula f / (z_layer - cam.z) is this with cam.z = -z.)
 *   x, y  where the camera sits, px from the canvas centre (default 0): a pure pan when there is no target
 *   roll  degrees, clockwise, about the centre of the screen
 *   tx, ty, tz   optional look-at point (tz default 0); needs tx and ty. The camera then turns towards it, so moving x / y
 *         while z stays put orbits around the target and layers at different depths show parallax.
 *
 * A card at canvas position (x, y), depth zl is the 3D point (x - W/2, y - H/2, zl); the lens is at (cx, cy, -z) looking
 * along +z (or at the target). Screen = centre + roll(f * (right, down) . (P - C) / (fwd . (P - C))).
 *
 * Near plane: with d = fwd . (P - C) (the distance of the card along the view axis), a card closer than `near` (default
 * 0.02 * f, configurable as camera.near in px) is projected as if it were at `near` instead of being dropped, and between
 * near and 2 * near it fades out linearly (alpha 1 at 2 * near, 0 at near and below, behind the lens included).
 * camera.nearFade: false turns the fade off: the card is then drawn at full alpha, clamped to the near plane.
 */
import { easeFromSpec, type EaseSpec, type Seg } from "./ease.js";
import { CAMERA_CHANNELS, segmentProblems, type CameraChannel, type CameraSample, type Segments } from "./keys.js";

export const focalLength = (fovDeg: number, H: number): number => (H / 2) / Math.tan((fovDeg * Math.PI) / 360);

export interface CameraRig { W: number; H: number; f: number; near: number; nearFade: boolean; pos: [number, number, number]; fwd: [number, number, number]; right: [number, number, number]; down: [number, number, number]; roll: number }
/** Screen position, scale, and the near-plane alpha (1 unless the card is within 2 * near of the lens). */
export interface Projected { x: number; y: number; scale: number; alpha: number }
export interface RigOptions { /** px, default 0.02 * focal length */ near?: number; nearFade?: boolean }

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

export function makeRig(cam: CameraSample, W: number, H: number, opt: RigOptions = {}): CameraRig {
  const f = focalLength(cam.fov ?? 40, H);
  const pos: V3 = [cam.x ?? 0, cam.y ?? 0, -(cam.z ?? f)];
  let fwd: V3 = [0, 0, 1];
  if (cam.tx !== undefined && cam.ty !== undefined) {
    const d = sub([cam.tx, cam.ty, cam.tz ?? 0], pos);
    if (Math.hypot(d[0], d[1], d[2]) > 1e-9) fwd = norm(d);
  }
  let right: V3 = cross([0, 1, 0], fwd);
  right = Math.hypot(right[0], right[1], right[2]) < 1e-9 ? [1, 0, 0] : norm(right);
  const down = cross(fwd, right);
  return { W, H, f, near: opt.near ?? 0.02 * f, nearFade: opt.nearFade !== false, pos, fwd, right, down, roll: ((cam.roll ?? 0) * Math.PI) / 180 };
}

/** Projects the canvas point (x, y) at depth z, with the near-plane clamp and fade described above. */
export function project(rig: CameraRig, x: number, y: number, z: number): Projected {
  const v = sub([x - rig.W / 2, y - rig.H / 2, z], rig.pos);
  const raw = dot(v, rig.fwd);
  const zc = Math.max(raw, rig.near);
  const alpha = rig.nearFade ? Math.min(1, Math.max(0, (raw - rig.near) / rig.near)) : 1;
  const scale = rig.f / zc;
  const sx = dot(v, rig.right) * scale, sy = dot(v, rig.down) * scale;
  const c = Math.cos(rig.roll), s = Math.sin(rig.roll);
  return { x: rig.W / 2 + sx * c - sy * s, y: rig.H / 2 + sx * s + sy * c, scale, alpha };
}

// ---------------------------------------------------------------------------------------------------------------------
// Presets: xjp.camera-presets.v1

export const CAMERA_PRESETS_SCHEMA = "xjp.camera-presets.v1";
export interface CameraPreset {
  id: string;
  name: string;
  description: string;
  /** Length the segments are written for; placePreset() rescales them. */
  duration_frames: number;
  segments: Segments<CameraChannel>;
}
export interface CameraPresetLibrary { schema: typeof CAMERA_PRESETS_SCHEMA; size: [number, number]; fov: number; presets: CameraPreset[] }
export interface PresetOptions { size: [number, number]; fov?: number; seed?: number }

const INOUT: EaseSpec = { bezier: [0.42, 0, 0.58, 1] };
const seg = (f0: number, f1: number, from: number, to: number, ease: EaseSpec = "linear"): Seg => ({ f0, f1, from: r(from), to: r(to), ease });
const r = (v: number) => Math.round(v * 1e5) / 1e5;

/** One linear segment per frame following value(p(k / n)) where p is the eased progress: exact enough for any coupled channels. */
function perFrame(n: number, ease: EaseSpec, value: (p: number) => number): Seg[] {
  const e = easeFromSpec(ease);
  return Array.from({ length: n }, (_, k) => seg(k, k + 1, value(e(k / n)), value(e((k + 1) / n))));
}

/** mulberry32: small deterministic PRNG. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Builds the preset shelf for a canvas size and base fov: push-in, pull-out, dolly-zoom, orbit, crash-zoom, whip-pan, handheld. */
export function buildCameraPresetLibrary(o: PresetOptions): CameraPresetLibrary {
  const [W, H] = o.size, fov = o.fov ?? 40, d = focalLength(fov, H), seed = o.seed ?? 1;
  const presets: CameraPreset[] = [];
  const add = (id: string, name: string, description: string, duration_frames: number, segments: Segments<CameraChannel>) => presets.push({ id, name, description, duration_frames, segments });

  add("push-in", "Push in", "Dolly towards the subject, eased in and out (distance x0.65).", 24, { z: [seg(0, 24, d, d * 0.65, INOUT)] });
  add("pull-out", "Pull out", "Dolly away from the subject, eased in and out (distance x1.5).", 24, { z: [seg(0, 24, d, d * 1.5, INOUT)] });

  // dolly-zoom: the z = 0 subject keeps its size (scale = f(fov) / z stays constant) while fov widens and the lens moves in
  const fov1 = Math.min(120, fov * 1.8), n = 36;
  add("dolly-zoom", "Dolly zoom", "Vertigo effect: fov widens while the lens moves in, the z = 0 subject keeps its size and the background stretches.", n, {
    fov: perFrame(n, INOUT, (p) => fov + (fov1 - fov) * p),
    z: perFrame(n, INOUT, (p) => d * focalLength(fov + (fov1 - fov) * p, H) / focalLength(fov, H)),
  });

  // orbit: the lens swings on an arc around the z = 0 point at the centre, looking at it: layers at other depths slide (parallax)
  const th0 = (12 * Math.PI) / 180, on = 48;
  const theta = (p: number) => -th0 + 2 * th0 * p;
  add("orbit", "Orbit", "2.5D orbit: the lens arcs +-12 degrees around the centre point; deeper layers show parallax (cards stay flat).", on, {
    x: perFrame(on, INOUT, (p) => d * Math.sin(theta(p))),
    z: perFrame(on, INOUT, (p) => d * Math.cos(theta(p))),
    tx: [seg(0, on, 0, 0)],
    ty: [seg(0, on, 0, 0)],
  });

  add("crash-zoom", "Crash zoom", "Fast, hard push in with a late settle (distance x0.3 in 10 frames).", 10, { z: [seg(0, 10, d, d * 0.3, { bezier: [0.7, 0, 0.9, 0.5] })] });
  add("whip-pan", "Whip pan", "Fast sideways pan across 1.5 screen widths; pair with a directional motion blur.", 12, { x: [seg(0, 12, 0, W * 1.5, { bezier: [0.7, 0, 0.3, 1] })] });

  // handheld: deterministic noise, a new target every 4 frames, eased between
  const rnd = seeded(seed), hn = 72, k = 4, amp = 3 * (W / 1920), rollAmp = 0.25;
  const knots = (a: number) => Array.from({ length: hn / k + 1 }, (_, i) => (i === 0 ? 0 : (rnd() * 2 - 1) * a));
  const chan = (vals: number[]): Seg[] => vals.slice(0, -1).map((v, i) => seg(i * k, (i + 1) * k, v, vals[i + 1], INOUT));
  add("handheld", "Handheld", `Deterministic camera shake (seed ${seed}): +-${r(amp)} px, +-${rollAmp} deg roll.`, hn, { x: chan(knots(amp)), y: chan(knots(amp)), roll: chan(knots(rollAmp)) });
  return { schema: CAMERA_PRESETS_SCHEMA, size: [W, H], fov, presets };
}

/** The preset's segments moved to start at f0 and stretched to duration_frames (default: its own length). */
export function placePreset(p: CameraPreset, o: { f0?: number; duration_frames?: number } = {}): Segments<CameraChannel> {
  const f0 = o.f0 ?? 0, k = (o.duration_frames ?? p.duration_frames) / p.duration_frames;
  if (!(k > 0)) throw new RangeError("duration_frames must be > 0");
  const out: Segments<CameraChannel> = {};
  for (const [ch, list] of Object.entries(p.segments) as [CameraChannel, Seg[]][]) out[ch] = list.map((s) => ({ ...s, f0: r(f0 + s.f0 * k), f1: r(f0 + s.f1 * k) }));
  return out;
}

export function cameraPresetsProblems(lib: unknown): string[] {
  if (!lib || typeof lib !== "object") return ["library must be an object"];
  const l = lib as Record<string, unknown>, p: string[] = [];
  if (l.schema !== CAMERA_PRESETS_SCHEMA) p.push(`schema must be "${CAMERA_PRESETS_SCHEMA}"`);
  if (!Array.isArray(l.presets)) return [...p, "presets must be an array"];
  const ids = new Set<string>();
  l.presets.forEach((e: unknown, i) => {
    const w = `presets[${i}]`, q = e as Record<string, unknown> | null;
    if (!q || typeof q !== "object") { p.push(`${w} must be an object`); return; }
    if (typeof q.id !== "string" || !q.id) p.push(`${w}.id must be a non-empty string`); else if (ids.has(q.id)) p.push(`${w}.id "${q.id}" is duplicated`); else ids.add(q.id);
    if (!(typeof q.duration_frames === "number" && q.duration_frames > 0)) p.push(`${w}.duration_frames must be > 0`);
    p.push(...segmentProblems(w, q.segments, CAMERA_CHANNELS));
  });
  return p;
}
