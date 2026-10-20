/** Canvas player for xjp.motion-keys.v1: draws one frame of a keys document as textured cards. */
import type { FrameMeta, PageDefinition } from "./protocol.js";
import { FrameAccumulator, snapToDirect } from "./blur.js";
import { makeRig, project } from "./camera.js";
import type { Seg } from "./ease.js";
import { lastFrame, sampleCamera, sampleLayer, sampleSegmentList, sampleShutter, validateKeys, type Layer, type LayerKey, type MotionKeys } from "./keys.js";

/** t * fps rounded to the nearest integer frame when within 1e-6 of it, so f / fps * fps never lands just before frame f. */
export const snapFrame = (f: number): number => (Math.abs(f - Math.round(f)) < 1e-6 ? Math.round(f) : f);

export type Texture = CanvasImageSource & { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; decode?: () => Promise<void> };

function textureSize(img: Texture): [number, number] {
  const w = img.naturalWidth ?? (img.width as number), h = img.naturalHeight ?? (img.height as number);
  return [w, h];
}

/** The card's placement on screen (after the camera, if any). rot is degrees, clockwise. */
export interface Xf { x: number; y: number; sx: number; sy: number; rot: number }
export interface Card { s: LayerKey; xf: Xf }

/** The layer's state and screen placement at frame g (null is kept for callers; the near-plane clamp means it is not returned today). */
export function cardAt(keys: MotionKeys, layer: Layer, g: number): Card | null {
  const s = sampleLayer(layer, g, keys.interp, keys.fps);
  if (!keys.camera) return { s, xf: { x: s.x, y: s.y, sx: s.sx, sy: s.sy, rot: s.rot } };
  const cam = sampleCamera(keys, g)!;
  const rig = makeRig(cam, keys.size[0], keys.size[1], { near: keys.camera.near, nearFade: keys.camera.nearFade });
  const p = project(rig, s.x, s.y, s.z ?? 0);
  if (p.alpha < 1) return { s: { ...s, opacity: s.opacity * p.alpha }, xf: { x: p.x, y: p.y, sx: s.sx * p.scale, sy: s.sy * p.scale, rot: s.rot + (cam.roll ?? 0) } };
  return { s, xf: { x: p.x, y: p.y, sx: s.sx * p.scale, sy: s.sy * p.scale, rot: s.rot + (cam.roll ?? 0) } };
}

/** The four corners of the drawn card in canvas px. */
export function cardCorners(xf: Xf, anchor: [number, number], tw: number, th: number): [number, number][] {
  const a = (xf.rot * Math.PI) / 180, c = Math.cos(a), si = Math.sin(a);
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
    const lx = (u - anchor[0]) * tw * xf.sx, ly = (v - anchor[1]) * th * xf.sy;
    return [xf.x + lx * c - ly * si, xf.y + lx * si + ly * c] as [number, number];
  });
}

export type BlurPlan =
  | { method: "accumulate"; times: number[] }
  | { method: "directional"; offsets: [number, number][] }
  | { method: "radial"; scales: number[]; center: [number, number] };

export const BLUR_STEP_PX = 1.5;
/** Blur is off for frames whose shutter is at or below this. */
export const SHUTTER_EPS = 0.01;
/** Default budget of layer-samples (blurred layers x their samples) per frame. */
export const BLUR_BUDGET = 2000;
const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** The shutter a layer's motionBlur uses at frame f: a number, a segment list, or "timeline" (the envelope timeline.shutter; 0.5 when the document has none). */
export function layerShutter(keys: MotionKeys, mb: { shutter?: number | Seg[] | "timeline" }, f: number): number {
  const sh = mb.shutter;
  if (typeof sh === "number") return sh;
  if (sh === "timeline") return sampleShutter(keys, f, 0.5);
  if (Array.isArray(sh)) return Math.min(1, Math.max(0, sampleSegmentList(sh, f, keys.fps) ?? 0.5));
  return 0.5;
}

/** Number of layer-samples a plan costs. */
export const planSamples = (p: BlurPlan | null): number => (!p ? 0 : p.method === "accumulate" ? p.times.length : p.method === "directional" ? p.offsets.length : p.scales.length);

/**
 * What to draw for a layer with motionBlur at frame f, or null for a plain draw (blur off, shutter <= 0.01, or nothing moves).
 * The window is w = shutter * strength (default strength 1) as a share of one frame interval; `shutter` is a number, a segment
 * list sampled at f, or "timeline" (the envelope timeline.shutter, so the layer's shutter is envelope * strength); default 0.5.
 * Sample counts follow the streak length (about one sample per BLUR_STEP_PX of travel, at most 32 / 48), so a bigger strength
 * or a faster move gets more samples; `sampleScale` (< 1) shrinks the counts proportionally (never below 2) for the frame budget.
 *  accumulate   the card is re-placed at sub-frame times over the window [f - w/2, f + w/2] and averaged; the camera and every
 *               channel move for real inside the window.
 *  directional  the card at f is smeared along its screen velocity (central difference over one frame) * w.
 *  radial       the card at f is zoomed about `center` (default: canvas centre) over a total scale range of 0.2 * w; the
 *               streak length is that range times the card's farthest corner distance from the centre.
 */
export function planMotionBlur(keys: MotionKeys, layer: Layer, f: number, tex: [number, number], sampleScale = 1): BlurPlan | null {
  const raw = layer.motionBlur;
  if (!raw) return null;
  const mb = raw === true ? {} : raw;
  const method = mb.method ?? "accumulate";
  const shutter = layerShutter(keys, mb, f);
  if (!(shutter > SHUTTER_EPS)) return null;
  const w = shutter * (mb.strength ?? 1);
  const [W, H] = keys.size;
  const count = (n: number, cap: number) => Math.max(2, Math.min(cap, Math.round(n * sampleScale)));
  if (method === "accumulate") {
    const a = cardAt(keys, layer, f - w / 2), b = cardAt(keys, layer, f + w / 2);
    if (!a || !b) return null;
    const ca = cardCorners(a.xf, layer.anchor, ...tex), cb = cardCorners(b.xf, layer.anchor, ...tex);
    const disp = Math.max(...ca.map((p, i) => Math.hypot(cb[i][0] - p[0], cb[i][1] - p[1])));
    if (disp < 0.5) return null;
    const n = count(clampInt(Math.ceil(disp / BLUR_STEP_PX), 2, 32), 32);
    return { method, times: Array.from({ length: n }, (_, i) => f - w / 2 + ((i + 0.5) / n) * w) };
  }
  if (method === "directional") {
    const a = cardAt(keys, layer, f - 0.5), b = cardAt(keys, layer, f + 0.5);
    if (!a || !b) return null;
    const vx = (b.xf.x - a.xf.x) * w, vy = (b.xf.y - a.xf.y) * w, len = Math.hypot(vx, vy);
    if (len < 0.5) return null;
    const n = count(clampInt(Math.ceil(len / BLUR_STEP_PX) + 1, 2, 48), 48);
    return { method, offsets: Array.from({ length: n }, (_, i) => [(i / (n - 1) - 0.5) * vx, (i / (n - 1) - 0.5) * vy] as [number, number]) };
  }
  const center = mb.center ?? [W / 2, H / 2];
  const cd = cardAt(keys, layer, f);
  if (!cd) return null;
  const far = Math.max(...cardCorners(cd.xf, layer.anchor, ...tex).map(([x, y]) => Math.hypot(x - center[0], y - center[1])));
  const spread = 0.2 * w, reach = spread * far;
  if (reach < 0.5) return null;
  const n = count(clampInt(Math.ceil(reach / BLUR_STEP_PX) + 1, 2, 48), 48);
  return { method: "radial", scales: Array.from({ length: n }, (_, i) => 1 + (i / (n - 1) - 0.5) * spread), center };
}

function drawCard(ctx: CanvasRenderingContext2D, img: Texture, layer: Layer, c: Card, tw: number, th: number): void {
  const { s, xf } = c;
  ctx.save();
  ctx.globalAlpha = Math.min(1, s.opacity); // catmull may overshoot
  ctx.filter = s.blur && s.blur > 0 ? `blur(${s.blur}px)` : "none";
  ctx.translate(xf.x, xf.y);
  ctx.rotate((xf.rot * Math.PI) / 180);
  ctx.scale(xf.sx, xf.sy);
  ctx.drawImage(img, -layer.anchor[0] * tw, -layer.anchor[1] * th, tw, th);
  ctx.restore();
}

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * The canvas rectangle a blurred layer can touch: the card's corners over the whole window, extended by the streak
 * (directional: the offsets; radial: the scaled corners; accumulate: every sub-frame placement), padded for the card's own
 * blur filter, clipped to the canvas. null = entirely off the canvas.
 */
export function blurBounds(keys: MotionKeys, layer: Layer, f: number, card: Card, tex: [number, number], plan: BlurPlan): Rect | null {
  const [W, H] = keys.size;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (pts: [number, number][], dx = 0, dy = 0) => { for (const [x, y] of pts) { x0 = Math.min(x0, x + dx); x1 = Math.max(x1, x + dx); y0 = Math.min(y0, y + dy); y1 = Math.max(y1, y + dy); } };
  let pad = 2 + 3 * (card.s.blur ?? 0);
  if (plan.method === "accumulate") {
    for (const g of plan.times) { const c = cardAt(keys, layer, g); if (c) { add(cardCorners(c.xf, layer.anchor, ...tex)); pad = Math.max(pad, 2 + 3 * (c.s.blur ?? 0)); } }
  } else if (plan.method === "directional") {
    const corners = cardCorners(card.xf, layer.anchor, ...tex);
    for (const [dx, dy] of [plan.offsets[0], plan.offsets[plan.offsets.length - 1]]) add(corners, dx, dy);
  } else {
    const corners = cardCorners(card.xf, layer.anchor, ...tex), [cx, cy] = plan.center;
    for (const k of [plan.scales[0], plan.scales[plan.scales.length - 1]]) add(corners.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as [number, number]));
  }
  void f;
  if (!Number.isFinite(x0)) return null;
  const rx0 = Math.max(0, Math.floor(x0 - pad)), ry0 = Math.max(0, Math.floor(y0 - pad)), rx1 = Math.min(W, Math.ceil(x1 + pad)), ry1 = Math.min(H, Math.ceil(y1 + pad));
  return rx1 > rx0 && ry1 > ry0 ? { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 } : null;
}

type Scratch = { layer: CanvasRenderingContext2D; work: CanvasRenderingContext2D };
const scratch = new WeakMap<CanvasRenderingContext2D, Scratch>();
/** Offscreen canvases for the blur, grown to at least w x h and cleared over that area (they are shared by every layer of the frame). */
function scratchFor(ctx: CanvasRenderingContext2D, w: number, h: number): Scratch {
  let sc = scratch.get(ctx);
  if (!sc) {
    const mk = () => ctx.canvas.ownerDocument.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    sc = { layer: mk(), work: mk() };
    scratch.set(ctx, sc);
  }
  for (const c of [sc.layer, sc.work]) {
    if (c.canvas.width < w) c.canvas.width = w;
    if (c.canvas.height < h) c.canvas.height = h;
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.filter = "none"; c.globalCompositeOperation = "source-over"; c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  }
  return sc;
}

/** Samples summed on the GPU per readback (a canvas adds with 8-bit rounding, so the groups stay small: <= ~1 level of error). */
export const BLUR_GROUP = 8;

/**
 * Draws the planned samples of one layer in offscreen canvases the size of `r` (the layer's bounding box plus streak) and
 * composites the result on ctx with one drawImage. Samples are summed in groups of up to BLUR_GROUP on the canvas itself
 * (globalCompositeOperation "lighter", each sample at alpha 1 / group size: a premultiplied mean), and only the group means are
 * read back and averaged in floats (weighted by group size): the readback, which dominates the cost, is 8x smaller than one
 * per sample, and nothing outside `r` is touched.
 */
function drawBlurred(ctx: CanvasRenderingContext2D, img: Texture, keys: MotionKeys, layer: Layer, card: Card, tw: number, th: number, plan: BlurPlan, r: Rect): void {
  const sc = scratchFor(ctx, r.w, r.h);
  const n = planSamples(plan);
  const groups = Math.ceil(n / BLUR_GROUP), base = Math.floor(n / groups), extra = n % groups;
  const acc = new FrameAccumulator(r.w * r.h);
  const clear = (c: CanvasRenderingContext2D) => { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, r.w, r.h); c.restore(); };
  sc.layer.setTransform(1, 0, 0, 1, -r.x, -r.y);
  if (plan.method !== "accumulate") drawCard(sc.layer, img, layer, card, tw, th);
  const [cx, cy] = plan.method === "radial" ? [plan.center[0] - r.x, plan.center[1] - r.y] : [0, 0];
  let k = 0;
  for (let gi = 0; gi < groups; gi++) {
    const size = base + (gi < extra ? 1 : 0);
    clear(sc.work);
    sc.work.globalCompositeOperation = "lighter";
    sc.work.globalAlpha = 1 / size;
    for (let m = 0; m < size; m++, k++) {
      if (plan.method === "accumulate") {
        clear(sc.layer);
        const c = cardAt(keys, layer, plan.times[k]);
        if (!c) continue;
        drawCard(sc.layer, img, layer, c, tw, th);
        sc.work.drawImage(sc.layer.canvas, 0, 0, r.w, r.h, 0, 0, r.w, r.h);
      } else if (plan.method === "directional") {
        const [dx, dy] = plan.offsets[k];
        sc.work.drawImage(sc.layer.canvas, 0, 0, r.w, r.h, dx, dy, r.w, r.h);
      } else {
        sc.work.save(); sc.work.translate(cx, cy); sc.work.scale(plan.scales[k], plan.scales[k]); sc.work.translate(-cx, -cy);
        sc.work.drawImage(sc.layer.canvas, 0, 0, r.w, r.h, 0, 0, r.w, r.h); sc.work.restore();
      }
    }
    acc.add(sc.work.getImageData(0, 0, r.w, r.h).data, size);
  }
  sc.work.globalCompositeOperation = "source-over"; sc.work.globalAlpha = 1;
  const out = new ImageData(r.w, r.h);
  acc.into(out.data);
  // the card as a plain draw at f: pixels the blur does not move are set back to exactly that (see snapToDirect)
  if (plan.method === "accumulate") { clear(sc.layer); drawCard(sc.layer, img, layer, card, tw, th); }
  snapToDirect(out.data, sc.layer.getImageData(0, 0, r.w, r.h).data, Math.ceil((base + (extra ? 1 : 0)) / 2));
  clear(sc.layer);
  sc.layer.putImageData(out, 0, 0);
  ctx.save();
  ctx.globalAlpha = 1; ctx.filter = "none"; ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(sc.layer.canvas, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
  ctx.restore();
}

export interface DrawOptions { /** layer-samples per frame, default BLUR_BUDGET */ blurBudget?: number }
const warned = new WeakSet<MotionKeys>();

/**
 * Draws frame `f` (fractional allowed) of `keys` onto ctx, which is cleared first. With a camera the cards are projected
 * (camera.ts); layers with motionBlur are smeared (planMotionBlur). Without either the output is the plain card draw.
 * The blurred layers of one frame share a budget of layer-samples (default 2000): beyond it every plan is thinned in
 * proportion (never below 2 samples) and a warning is logged once per document.
 */
export function drawKeysFrame(ctx: CanvasRenderingContext2D, keys: MotionKeys, textures: Record<string, Texture>, f: number, opt: DrawOptions = {}): void {
  const [W, H] = keys.size;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.clearRect(0, 0, W, H);
  const items: { layer: Layer; img: Texture; card: Card; tex: [number, number]; plan: BlurPlan | null }[] = [];
  let total = 0;
  for (const layer of keys.layers) {
    const img = textures[layer.texture];
    if (!img) throw new Error(`motion-keys: texture "${layer.texture}" (layer ${layer.id}) was not provided`);
    const card = cardAt(keys, layer, f);
    if (!card || card.s.opacity <= 0) continue;
    const tex = textureSize(img);
    const plan = layer.motionBlur ? planMotionBlur(keys, layer, f, tex) : null;
    total += planSamples(plan);
    items.push({ layer, img, card, tex, plan });
  }
  const budget = opt.blurBudget ?? BLUR_BUDGET;
  if (total > budget) {
    const k = budget / total;
    if (!warned.has(keys)) { warned.add(keys); console.warn(`motion-kit: motion blur sample budget exceeded (${total} layer-samples > ${budget}); using ${(k * 100).toFixed(0)}% of the samples (reported once)`); }
    for (const it of items) if (it.plan) it.plan = planMotionBlur(keys, it.layer, f, it.tex, k);
  }
  for (const { layer, img, card, tex, plan } of items) {
    const r = plan ? blurBounds(keys, layer, f, card, tex, plan) : null;
    if (plan && !r) continue; // blurred layer entirely off the canvas
    if (plan && r) drawBlurred(ctx, img, keys, layer, card, tex[0], tex[1], plan, r);
    else drawCard(ctx, img, layer, card, tex[0], tex[1]);
  }
  ctx.restore();
}

const hasTimelineShutter = (k: MotionKeys) => { const t = k.timeline?.shutter; return !!t && (Array.isArray(t) ? t.length > 0 : t.segments.length > 0); };

export interface KeysPageOptions {
  /** Canvas to draw on; default document.getElementById("stage"). */
  canvas?: HTMLCanvasElement;
  shutter?: number;
  subframes?: number;
  /** Layer-samples per frame for layer motion blur (default 2000). */
  blurBudget?: number;
}

/**
 * Wraps a keys document + preloaded textures as a page definition for definePage():
 *   definePage(createKeysPage(keys, await loadImages(urls)))
 */
export function createKeysPage(keys: MotionKeys, textures: Record<string, Texture>, options: KeysPageOptions = {}): PageDefinition {
  validateKeys(keys);
  const meta: FrameMeta = {
    fps: keys.fps,
    width: keys.size[0],
    height: keys.size[1],
    duration_s: (lastFrame(keys) + 1) / keys.fps,
    shutter: options.shutter ?? 0,
    subframes: options.subframes ?? 1,
  };
  const canvas = () => options.canvas ?? (document.getElementById("stage") as HTMLCanvasElement);
  return {
    meta,
    // timeline.shutter wins per frame; without it __meta.shutter (read live, so __load may change it) is used
    shutterAt: hasTimelineShutter(keys) ? (t_s) => sampleShutter(keys, t_s * keys.fps, meta.shutter) : undefined,
    async load() {
      for (const l of keys.layers) {
        const img = textures[l.texture];
        if (!img) throw new Error(`motion-keys: texture "${l.texture}" (layer ${l.id}) was not provided`);
        await img.decode?.();
      }
      const c = canvas();
      if (c.width !== meta.width) c.width = meta.width;
      if (c.height !== meta.height) c.height = meta.height;
    },
    frame(t_s) {
      const ctx = canvas().getContext("2d");
      if (!ctx) throw new Error("motion-keys: #stage has no 2D context");
      drawKeysFrame(ctx, keys, textures, snapFrame(t_s * keys.fps), { blurBudget: options.blurBudget });
    },
  };
}

/** Loads images by url → { name: HTMLImageElement }, decoded. Rejects when any fails. */
export async function loadImages(urls: Record<string, string>): Promise<Record<string, HTMLImageElement>> {
  const out: Record<string, HTMLImageElement> = {};
  await Promise.all(Object.entries(urls).map(async ([name, url]) => {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { throw new Error(`motion-keys: could not load texture "${name}" from ${url}`); }
    out[name] = img;
  }));
  return out;
}
