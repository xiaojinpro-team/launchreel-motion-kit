/**
 * Same-frame comparison of two PNG directories (a = reference, b = candidate; frames matched by file name).
 * Per frame: PSNR over RGB (capped at 100 dB for identical frames), mean absolute and signed (b - a) RGB offset,
 * high-frequency energy ratio (Laplacian energy of b's luma over a's), and optional 8x crops of the darkest / mid /
 * brightest 64 px tile of a (by luma), written side by side (a | b).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export interface FrameCompare {
  frame: string;
  psnr_db: number | null;
  identical: boolean;
  mean_abs_offset: { r: number; g: number; b: number };
  mean_signed_offset: { r: number; g: number; b: number };
  hf_ratio: number | null;
  crops?: { dark: string; mid: string; bright: string };
  error?: string;
}
export interface CompareReport {
  schema: "xjp.motion-compare.v1";
  a: string; b: string;
  frames: FrameCompare[];
  missing_in_a: string[]; missing_in_b: string[];
  summary: { compared: number; min_psnr_db: number | null; mean_psnr_db: number | null; worst_frame: string | null };
}
export interface Raster { width: number; height: number; data: Uint8Array | Uint8ClampedArray | Buffer }
export const PSNR_CAP_DB = 100;
export const CROP_TILE = 64;
export const CROP_ZOOM = 8;

type PngLib = { PNG: { new (o?: object): { width: number; height: number; data: Buffer }; sync: { read(b: Buffer): { width: number; height: number; data: Buffer }; write(p: unknown): Buffer } } };
let pngLib: PngLib | null = null;
async function png(): Promise<PngLib> {
  if (pngLib) return pngLib;
  try { pngLib = (await import("pngjs")) as unknown as PngLib; } catch {
    try { pngLib = createRequire(path.join(process.cwd(), "noop.js"))("pngjs"); } catch { throw new Error("pngjs is not installed (optional dependency of motion-compare)"); }
  }
  const lib = pngLib as PngLib & { default?: PngLib };
  if (!lib.PNG && lib.default) pngLib = lib.default;
  return pngLib!;
}

export async function readPng(file: string): Promise<Raster> {
  const { PNG } = await png();
  const p = PNG.sync.read(fs.readFileSync(file));
  return { width: p.width, height: p.height, data: p.data };
}
export async function writePng(file: string, r: Raster): Promise<void> {
  const { PNG } = await png();
  const p = new PNG({ width: r.width, height: r.height });
  Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength).copy(p.data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG.sync.write(p));
}

const luma = (d: ArrayLike<number>, i: number) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

/** PSNR in dB over the RGB channels (alpha ignored); PSNR_CAP_DB when identical. */
export function psnrRgb(a: Raster, b: Raster): number {
  let se = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n * 4; i += 4) for (let c = 0; c < 3; c++) { const d = a.data[i + c] - b.data[i + c]; se += d * d; }
  if (se === 0) return PSNR_CAP_DB;
  return Math.min(PSNR_CAP_DB, 10 * Math.log10((255 * 255) / (se / (n * 3))));
}

/** Mean |b - a| and mean (b - a) per channel. */
export function rgbOffsets(a: Raster, b: Raster) {
  const abs = [0, 0, 0], sgn = [0, 0, 0];
  const n = a.width * a.height;
  for (let i = 0; i < n * 4; i += 4) for (let c = 0; c < 3; c++) { const d = b.data[i + c] - a.data[i + c]; abs[c] += Math.abs(d); sgn[c] += d; }
  const f = (v: number[]) => ({ r: +(v[0] / n).toFixed(4), g: +(v[1] / n).toFixed(4), b: +(v[2] / n).toFixed(4) });
  return { abs: f(abs), signed: f(sgn) };
}

/** Mean squared 4-neighbour Laplacian of the luma plane (interior pixels). */
export function laplacianEnergy(r: Raster): number {
  const { width: w, height: h, data } = r;
  if (w < 3 || h < 3) return 0;
  const Y = new Float32Array(w * h);
  for (let i = 0, p = 0; p < w * h; p++, i += 4) Y[p] = luma(data, i);
  let e = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    const l = Y[p - 1] + Y[p + 1] + Y[p - w] + Y[p + w] - 4 * Y[p];
    e += l * l;
  }
  return e / ((w - 2) * (h - 2));
}

/** Top-left corners of the darkest, median and brightest full tiles of r by mean luma. */
export function pickTiles(r: Raster, tile = CROP_TILE): { dark: [number, number]; mid: [number, number]; bright: [number, number]; tile: number } {
  const t = Math.min(tile, r.width, r.height);
  const tiles: { x: number; y: number; l: number }[] = [];
  for (let y = 0; y + t <= r.height; y += t) for (let x = 0; x + t <= r.width; x += t) {
    let s = 0;
    for (let yy = y; yy < y + t; yy++) for (let xx = x; xx < x + t; xx++) s += luma(r.data, (yy * r.width + xx) * 4);
    tiles.push({ x, y, l: s / (t * t) });
  }
  tiles.sort((p, q) => p.l - q.l);
  const pick = (k: { x: number; y: number }): [number, number] => [k.x, k.y];
  return { dark: pick(tiles[0]), mid: pick(tiles[tiles.length >> 1]), bright: pick(tiles[tiles.length - 1]), tile: t };
}

function cropSideBySide(a: Raster, b: Raster, [x0, y0]: [number, number], t: number, zoom: number): Raster {
  const side = t * zoom, gap = 8, W = side * 2 + gap;
  const out = new Uint8ClampedArray(W * side * 4).fill(255);
  const put = (src: Raster, ox: number) => {
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const s = ((y0 + ((y / zoom) | 0)) * src.width + x0 + ((x / zoom) | 0)) * 4;
      const d = (y * W + ox + x) * 4;
      out[d] = src.data[s]; out[d + 1] = src.data[s + 1]; out[d + 2] = src.data[s + 2]; out[d + 3] = 255;
    }
  };
  put(a, 0); put(b, side + gap);
  return { width: W, height: side, data: out };
}

export interface CompareOptions { a: string; b: string; outDir?: string; crops?: boolean }

const pngs = (d: string) => fs.readdirSync(d).filter((f) => f.toLowerCase().endsWith(".png")).sort();

export async function compareDirs(o: CompareOptions): Promise<CompareReport> {
  const fa = new Set(pngs(o.a)), fb = new Set(pngs(o.b));
  const common = [...fa].filter((f) => fb.has(f));
  const frames: FrameCompare[] = [];
  for (const name of common) {
    const [ra, rb] = await Promise.all([readPng(path.join(o.a, name)), readPng(path.join(o.b, name))]);
    if (ra.width !== rb.width || ra.height !== rb.height) {
      frames.push({ frame: name, psnr_db: null, identical: false, mean_abs_offset: { r: 0, g: 0, b: 0 }, mean_signed_offset: { r: 0, g: 0, b: 0 }, hf_ratio: null, error: `size mismatch ${ra.width}x${ra.height} vs ${rb.width}x${rb.height}` });
      continue;
    }
    const psnr = psnrRgb(ra, rb), off = rgbOffsets(ra, rb);
    const ea = laplacianEnergy(ra), eb = laplacianEnergy(rb);
    const fc: FrameCompare = { frame: name, psnr_db: +psnr.toFixed(3), identical: psnr >= PSNR_CAP_DB, mean_abs_offset: off.abs, mean_signed_offset: off.signed, hf_ratio: ea > 0 ? +(eb / ea).toFixed(4) : null };
    if (o.crops && o.outDir) {
      const tiles = pickTiles(ra);
      const stem = name.replace(/\.png$/i, "");
      const crops = {} as NonNullable<FrameCompare["crops"]>;
      for (const k of ["dark", "mid", "bright"] as const) {
        const rel = path.join("crops", `${stem}-${k}.png`);
        await writePng(path.join(o.outDir, rel), cropSideBySide(ra, rb, tiles[k], tiles.tile, CROP_ZOOM));
        crops[k] = rel;
      }
      fc.crops = crops;
    }
    frames.push(fc);
  }
  const ok = frames.filter((f) => f.psnr_db !== null);
  const worst = ok.reduce<FrameCompare | null>((w, f) => (!w || f.psnr_db! < w.psnr_db! ? f : w), null);
  return {
    schema: "xjp.motion-compare.v1", a: path.resolve(o.a), b: path.resolve(o.b), frames,
    missing_in_a: [...fb].filter((f) => !fa.has(f)), missing_in_b: [...fa].filter((f) => !fb.has(f)),
    summary: { compared: ok.length, min_psnr_db: worst?.psnr_db ?? null, mean_psnr_db: ok.length ? +(ok.reduce((s, f) => s + f.psnr_db!, 0) / ok.length).toFixed(3) : null, worst_frame: worst?.frame ?? null },
  };
}

export function reportMarkdown(r: CompareReport): string {
  const L = [`# motion-compare`, ``, `- a (reference): \`${r.a}\``, `- b (candidate): \`${r.b}\``,
    `- compared: ${r.summary.compared} frames, min PSNR ${r.summary.min_psnr_db ?? "n/a"} dB (${r.summary.worst_frame ?? "-"}), mean ${r.summary.mean_psnr_db ?? "n/a"} dB`];
  if (r.missing_in_a.length) L.push(`- only in b: ${r.missing_in_a.join(", ")}`);
  if (r.missing_in_b.length) L.push(`- only in a: ${r.missing_in_b.join(", ")}`);
  L.push(``, `PSNR over RGB, 100 dB = identical. Offset = mean(b - a) per channel. HF = Laplacian energy of b / a (1 = same sharpness).`, ``,
    `| frame | PSNR dB | mean abs R/G/B | mean b-a R/G/B | HF b/a | crops |`, `|---|---|---|---|---|---|`);
  for (const f of r.frames) {
    const o = f.mean_abs_offset, s = f.mean_signed_offset;
    L.push(f.error ? `| ${f.frame} | - | ${f.error} | | | |`
      : `| ${f.frame} | ${f.psnr_db} | ${o.r}/${o.g}/${o.b} | ${s.r}/${s.g}/${s.b} | ${f.hf_ratio ?? "-"} | ${f.crops ? `[dark](${f.crops.dark}) [mid](${f.crops.mid}) [bright](${f.crops.bright})` : ""} |`);
  }
  return L.join("\n") + "\n";
}
