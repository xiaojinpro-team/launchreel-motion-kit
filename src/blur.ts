/** Sub-frame accumulation motion blur: average `subframes` renders spread over `shutter / fps` seconds. */

export interface AccumulateOptions {
  /** Frames per second (the shutter window is shutter / fps seconds). Default: window.__meta.fps. */
  fps?: number;
  /**
   * Where the shutter window sits relative to t: window start = t + phase * shutter / fps.
   * -0.5 (default) centres the window on t, like a centred shutter; 0 starts it at t.
   */
  phase?: number;
}

/**
 * Times at which the sub-frames are sampled: the midpoints of `subframes` equal slices of the shutter window.
 * With shutter 0 or subframes 1 this is just [t].
 */
export function subframeTimes(t_s: number, shutter: number, subframes: number, fps: number, phase = -0.5): number[] {
  if (!(shutter > 0) || subframes <= 1) return [t_s];
  const span = shutter / fps;
  const start = t_s + phase * span;
  return Array.from({ length: subframes }, (_, i) => start + ((i + 0.5) / subframes) * span);
}

/**
 * Streaming premultiplied average of straight-alpha RGBA frames (so a half-transparent sample does not darken the colour,
 * and nothing is lost to 8-bit rounding until the end). Pure: used by accumulate(), the layer motion blur and the unit tests.
 */
export class FrameAccumulator {
  private readonly sum: Float32Array; // r, g, b premultiplied by alpha (0..255 * alpha), then alpha, interleaved per pixel
  private n = 0;
  constructor(readonly pixels: number) { this.sum = new Float32Array(pixels * 4); }
  get count(): number { return this.n; }
  /** `weight` = how many equally weighted frames this one stands for (a mean of `weight` frames counts `weight` times). */
  add(frame: ArrayLike<number>, weight = 1): void {
    const s = this.sum;
    for (let i = 0, end = this.pixels * 4; i < end; i += 4) {
      const al = frame[i + 3];
      if (al === 0) continue; // a fully transparent pixel adds nothing
      const w = al * weight;
      s[i] += frame[i] * w; s[i + 1] += frame[i + 1] * w; s[i + 2] += frame[i + 2] * w; s[i + 3] += w;
    }
    this.n += weight;
  }
  /** Writes the straight-alpha mean into `out` (length pixels * 4). */
  into(out: Uint8ClampedArray): void {
    if (!this.n) throw new Error("FrameAccumulator: no frames");
    const s = this.sum, n = this.n;
    for (let i = 0, end = this.pixels * 4; i < end; i += 4) {
      const a = s[i + 3];
      if (a === 0) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; continue; }
      out[i] = Math.round(s[i] / a); out[i + 1] = Math.round(s[i + 1] / a); out[i + 2] = Math.round(s[i + 2] / a); out[i + 3] = Math.round(a / n);
    }
  }
}

/**
 * Pixels a blur does not actually move must come out exactly as the direct draw. The grouped GPU sums round each sample to 8
 * bits, so a flat pixel can drift by up to half the group size; where the blurred value is within `tol` of the direct one
 * (premultiplied difference per channel, and alpha) it is replaced by the direct value. `tol` is the largest possible sum
 * rounding error, so a pixel that the blur really changed by more than that is untouched. Returns how many pixels were snapped.
 */
export function snapToDirect(blurred: Uint8ClampedArray, direct: ArrayLike<number>, tol: number): number {
  let n = 0;
  for (let i = 0; i < blurred.length; i += 4) {
    const ba = blurred[i + 3], da = direct[i + 3];
    if (Math.abs(ba - da) > tol) continue;
    if (Math.abs((blurred[i] * ba - direct[i] * da) / 255) > tol || Math.abs((blurred[i + 1] * ba - direct[i + 1] * da) / 255) > tol || Math.abs((blurred[i + 2] * ba - direct[i + 2] * da) / 255) > tol) continue;
    if (blurred[i] === direct[i] && blurred[i + 1] === direct[i + 1] && blurred[i + 2] === direct[i + 2] && ba === da) continue;
    blurred[i] = direct[i]; blurred[i + 1] = direct[i + 1]; blurred[i + 2] = direct[i + 2]; blurred[i + 3] = da;
    n++;
  }
  return n;
}

/** Premultiplied average of RGBA frames (straight-alpha in, straight-alpha out). */
export function averageFrames(frames: ArrayLike<number>[], out: Uint8ClampedArray): void {
  if (!frames.length) throw new Error("averageFrames: no frames");
  const acc = new FrameAccumulator(out.length / 4);
  for (const f of frames) acc.add(f);
  acc.into(out);
}

/**
 * Renders `subframes` times with `frameFn` (which draws onto ctx.canvas) and leaves their average on the canvas.
 * `frameFn` must be pure in t. With shutter 0 or subframes 1 it is a single plain call.
 */
export async function accumulate(
  frameFn: (t_s: number) => Promise<void> | void,
  t_s: number,
  shutter: number,
  subframes: number,
  ctx: CanvasRenderingContext2D,
  options: AccumulateOptions = {},
): Promise<void> {
  const fps = options.fps ?? (globalThis as { __meta?: { fps: number } }).__meta?.fps;
  if (!fps || !(fps > 0)) throw new Error("accumulate: fps is required (options.fps or window.__meta.fps)");
  const times = subframeTimes(t_s, shutter, subframes, fps, options.phase);
  if (times.length === 1) { await frameFn(times[0]); return; }
  const { width, height } = ctx.canvas;
  const shots: Uint8ClampedArray[] = [];
  for (const ti of times) {
    await frameFn(ti);
    shots.push(ctx.getImageData(0, 0, width, height).data);
  }
  const out = ctx.createImageData(width, height);
  averageFrames(shots, out.data);
  ctx.putImageData(out, 0, 0);
}
