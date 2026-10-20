/**
 * xjp.frame-protocol.v1 — what a page must implement so that every renderer (launchreel runner, motion-render, a
 * browser tab) can photograph it one instant at a time.
 *
 *   window.__meta  { fps, width, height, duration_s, shutter 0..1, subframes int >= 1 }
 *   window.__load(spec): Promise<void>   loads spec + assets + fonts, then sets window.__ready = true
 *   window.__frame(t_s): Promise<void>   draws time t onto <canvas id="stage">; pure (no rAF / Date), resolves when drawn
 */
import { accumulate } from "./blur.js";

export const FRAME_PROTOCOL = "xjp.frame-protocol.v1";

export interface FrameMeta {
  fps: number;
  width: number;
  height: number;
  duration_s: number;
  /** Shutter angle as a fraction of the frame interval, 0 (no blur) .. 1 (full frame interval). The default value: a page may override it per frame (PageDefinition.shutterAt, keys timeline.shutter). */
  shutter: number;
  /** Sub-frame renders averaged per output frame, integer >= 1. */
  subframes: number;
}

export interface PageDefinition<Spec = unknown> {
  meta: FrameMeta;
  load?: (spec: Spec) => Promise<void> | void;
  frame: (t_s: number) => Promise<void> | void;
  /** Per-frame shutter override; return undefined to fall back to __meta.shutter (which is the default value). */
  shutterAt?: (t_s: number) => number | undefined;
}

export class ProtocolError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`${FRAME_PROTOCOL}: ${problems.join("; ")}`);
    this.name = "ProtocolError";
    this.problems = problems;
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Returns the list of problems (empty = valid). */
export function metaProblems(meta: unknown): string[] {
  const p: string[] = [];
  if (!meta || typeof meta !== "object") return ["__meta must be an object"];
  const m = meta as Record<string, unknown>;
  if (!isNum(m.fps) || m.fps <= 0) p.push("fps must be a number > 0");
  if (!isNum(m.width) || !Number.isInteger(m.width) || m.width < 1) p.push("width must be an integer >= 1");
  if (!isNum(m.height) || !Number.isInteger(m.height) || m.height < 1) p.push("height must be an integer >= 1");
  if (!isNum(m.duration_s) || m.duration_s < 0) p.push("duration_s must be a number >= 0");
  if (!isNum(m.shutter) || m.shutter < 0 || m.shutter > 1) p.push("shutter must be a number in 0..1");
  if (!isNum(m.subframes) || !Number.isInteger(m.subframes) || m.subframes < 1) p.push("subframes must be an integer >= 1");
  return p;
}

/** Throws ProtocolError when invalid; returns the meta typed. */
export function validateMeta(meta: unknown): FrameMeta {
  const p = metaProblems(meta);
  if (p.length) throw new ProtocolError(p);
  return meta as FrameMeta;
}

/** Fills the optional fields (shutter 0, subframes 1) of a partial meta, then validates. */
export function normalizeMeta(meta: Partial<FrameMeta> & Pick<FrameMeta, "fps" | "width" | "height" | "duration_s">): FrameMeta {
  return validateMeta({ shutter: 0, subframes: 1, ...meta });
}

/** Number of frames of a meta: ceil(duration_s * fps), at least 1. */
export function frameCount(meta: Pick<FrameMeta, "fps" | "duration_s">): number {
  return Math.max(1, Math.ceil(meta.duration_s * meta.fps - 1e-9));
}

export interface DefinePageOptions {
  /** Apply sub-frame accumulation around `frame` when meta.shutter > 0 and meta.subframes > 1 (needs a 2D #stage canvas). Default true. */
  blur?: boolean;
  /** The canvas to read back for blur; default document.getElementById("stage"). */
  canvas?: HTMLCanvasElement;
}

declare global {
  interface Window {
    __meta?: FrameMeta;
    __ready?: boolean;
    __load?: (spec?: unknown) => Promise<void>;
    __frame?: (t_s: number) => Promise<void>;
  }
}

/**
 * Installs window.__meta / __load / __frame / __ready on `win` (default: window) for a page definition.
 * __ready is false until `load` has resolved; calling __load twice reloads. A throw inside load or frame rejects the call
 * (the renderer reports it as a frame error) and is never swallowed.
 */
export function definePage<Spec = unknown>(def: PageDefinition<Spec>, options: DefinePageOptions = {}, win: Window = window): FrameMeta {
  const meta = validateMeta(def.meta);
  win.__meta = meta;
  win.__ready = false;
  win.__load = async (spec?: unknown) => {
    win.__ready = false;
    if (def.load) await def.load(spec as Spec);
    if (win.__meta) validateMeta(win.__meta); // __load may have updated the meta
    win.__ready = true;
  };
  const wantBlur = options.blur !== false;
  win.__frame = async (t_s: number) => {
    if (!isNum(t_s)) throw new ProtocolError([`__frame(t): t must be a finite number, got ${String(t_s)}`]);
    const m = win.__meta ?? meta;
    const shutter = def.shutterAt?.(t_s) ?? m.shutter;
    if (!isNum(shutter) || shutter < 0 || shutter > 1) throw new ProtocolError([`shutter at t=${t_s} must be a number in 0..1, got ${String(shutter)}`]);
    if (wantBlur && shutter > 0 && m.subframes > 1) {
      const canvas = options.canvas ?? (win.document.getElementById("stage") as HTMLCanvasElement | null);
      const ctx = canvas?.getContext("2d");
      if (!ctx) throw new ProtocolError(["blur needs a 2D <canvas id=\"stage\">; pass { blur: false } or call accumulate() yourself"]);
      await accumulate(def.frame, t_s, shutter, m.subframes, ctx, { fps: m.fps });
      return;
    }
    await def.frame(t_s);
  };
  return meta;
}
