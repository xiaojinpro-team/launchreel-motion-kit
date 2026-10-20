/**
 * Compatibility shim for legacy pages that predate xjp.frame-protocol.v1.
 *
 * A legacy page defines `window.renderAt(frame)` (an integer frame index; sync or async) and sets `window.__ready = true`,
 * but has no `__frame` / `__meta`. installCompat() adds
 *
 *     window.__frame = (t_s) => renderAt(Math.round(t_s * fps))
 *     window.__meta  = { fps, width, height, duration_s, shutter: 0, subframes: 1 }   (only if missing)
 *
 * so the page renders unchanged under motion-render. Rounding (not floor) makes t = f / fps land on frame f for any fps.
 * `fps` and `width`/`height`/`duration_s` come from the arguments (CLI: --fps, --width, --height, --duration); width and
 * height default to the canvas #stage size or the window size. It does nothing when `__frame` already exists.
 *
 * NOTE: this function is serialised with Function.prototype.toString() and evaluated inside the page by motion-render,
 * so it must stay self-contained (no imports, no references to module scope).
 */
export interface CompatOptions { fps: number; width?: number; height?: number; duration_s?: number }

export function installCompat(win: Window, opts: CompatOptions): boolean {
  const w = win as unknown as Record<string, unknown> & Window;
  const legacy = w.renderAt as ((frame: number) => unknown) | undefined;
  if (typeof w.__frame === "function" || typeof legacy !== "function") return false;
  if (!(opts.fps > 0)) throw new Error("compat: fps must be > 0");
  const stage = win.document.getElementById("stage") as HTMLCanvasElement | null;
  if (!w.__meta) {
    w.__meta = {
      fps: opts.fps,
      width: opts.width ?? stage?.width ?? win.innerWidth,
      height: opts.height ?? stage?.height ?? win.innerHeight,
      duration_s: opts.duration_s ?? 0,
      shutter: 0,
      subframes: 1,
    };
  }
  const fps = (w.__meta as { fps: number }).fps;
  w.__frame = async (t_s: number) => {
    await legacy.call(win, Math.round(t_s * fps));
  };
  return true;
}
