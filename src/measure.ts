/**
 * The replica workbench's measurement format, read directly (shot-03 拆解_v1/tools/measure*.py write it under measure/*.json):
 *
 *   { "<frame>": { "x": 803.3, "y": 224.4, "core_r": 57.5, ... }, ... }                 one element per file (orb.json, knob.json)
 *   { "<element>": { "<frame>": { "center": [942.3, 574.5], "core_r": 9.0 }, ... }, ... } several elements (lights_v2.json)
 *   { "<frame>": 803.3, ... }                                                              a bare channel
 *
 * measurePoints(doc, "x") / measurePoints(doc, "music.center.0") walks the element keys down to the frame level (the first object whose
 * keys are all frame numbers), then reads the rest of the path inside each frame's record (array indexes allowed). Frames where the
 * channel is missing, null or not a number are skipped and counted, never invented. Per-frame lists without identity (beads.json:
 * several unlabelled detections per frame) are not a channel: track them into one element first.
 * Pure, no imports: shared by fit.ts, the motion-fit CLI and the vocabulary's fitEase.
 */
export interface MeasuredPoint { f: number; value: number }
export interface MeasureResult { points: MeasuredPoint[]; skipped: number[]; element: string[]; channel: string }

const isFrameMap = (o: unknown): o is Record<string, unknown> =>
  !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length > 0 && Object.keys(o).every((k) => /^-?\d+$/.test(k));

/** read one channel of a measurement document; `range` keeps frames from..to (inclusive) */
export function measureSeries(doc: unknown, path: string, range: { from?: number; to?: number } = {}): MeasureResult {
  const parts = path.split(".").filter(Boolean);
  let cur = doc;
  const element: string[] = [];
  while (!isFrameMap(cur)) {
    const k = parts.shift();
    if (k === undefined) throw new Error(`measure ${path}: no frame-keyed level found (keys like "112")`);
    if (!cur || typeof cur !== "object" || !(k in (cur as object))) {
      const keys = cur && typeof cur === "object" ? Object.keys(cur as object).slice(0, 12).join(", ") : String(cur);
      throw new Error(`measure ${path}: "${k}" not found (here: ${keys})`);
    }
    cur = (cur as Record<string, unknown>)[k];
    element.push(k);
  }
  const frames = cur as Record<string, unknown>;
  const points: MeasuredPoint[] = [], skipped: number[] = [];
  for (const key of Object.keys(frames)) {
    const f = Number(key);
    if ((range.from !== undefined && f < range.from) || (range.to !== undefined && f > range.to)) continue;
    let v: unknown = frames[key];
    for (const k of parts) v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
    if (Array.isArray(v) && parts.length === 0) throw new Error(`measure ${path}: frame ${key} holds a list; name the channel (e.g. "${path ? path + "." : ""}0") or track the detections first`);
    if (typeof v === "number" && Number.isFinite(v)) points.push({ f, value: v }); else skipped.push(f);
  }
  points.sort((a, b) => a.f - b.f);
  if (!points.length) throw new Error(`measure ${path}: no numeric samples${skipped.length ? ` (${skipped.length} frames without it)` : ""}`);
  return { points, skipped: skipped.sort((a, b) => a - b), element, channel: parts.join(".") };
}
