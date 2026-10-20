/** ffmpeg wrapper: PNG sequence -> ProRes 422 HQ .mov or H.264 .mp4 (yuv420p, faststart), optional 3 s head slate. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchChrome, loadPlaywright } from "./render.js";

export interface Slate { title: string; purpose: string; version: string; date?: string; seconds?: number }
export interface EncodeOptions {
  dir: string;
  out: string;
  fps: number;
  codec?: "prores" | "h264";
  slate?: Slate;
  ffmpeg?: string;
  executablePath?: string;
  onLog?: (line: string) => void;
}

/** Slate text: "<title> · <purpose>" over "<version> / <export date>". Black background, white text. */
export function slateLines(s: Slate): [string, string] {
  return [`${s.title} · ${s.purpose}`, `${s.version} / ${s.date ?? new Date().toISOString().slice(0, 10)}`];
}

export function pngSize(file: string): [number, number] {
  const fd = fs.openSync(file, "r");
  try {
    const b = Buffer.alloc(24);
    fs.readSync(fd, b, 0, 24, 0);
    if (b.toString("latin1", 1, 4) !== "PNG") throw new Error(`${file} is not a PNG`);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  } finally { fs.closeSync(fd); }
}

/** Draws the slate with Chrome (no freetype / drawtext dependency in ffmpeg) at the sequence's size. */
export async function renderSlatePng(s: Slate, size: [number, number], file: string, executablePath?: string): Promise<void> {
  const pw = await loadPlaywright();
  const browser = await launchChrome(pw, { executablePath, localOnly: true });
  try {
    const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
    const [l1, l2] = slateLines(s);
    const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
    await page.evaluate(`document.documentElement.innerHTML = ${JSON.stringify(`<body style="margin:0;background:#000;color:#fff;width:${size[0]}px;height:${size[1]}px;display:flex;flex-direction:column;align-items:center;justify-content:center;font:600 ${Math.round(size[1] * 0.06)}px -apple-system,'Helvetica Neue',Arial,sans-serif"><div>${esc(l1)}</div><div style="margin-top:.6em;font-weight:400;font-size:.7em;opacity:.85">${esc(l2)}</div></body>`)}`);
    fs.writeFileSync(file, await page.screenshot({ type: "png" }));
  } finally { await browser.close().catch(() => {}); }
}

function run(bin: string, args: string[], onLog?: (l: string) => void): Promise<void> {
  return new Promise((ok, bad) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    p.on("error", (e) => bad(new Error(`cannot run ${bin}: ${e.message}`)));
    p.on("close", (c) => (c === 0 ? ok() : bad(new Error(`${bin} exited ${c}: ${err.trim().split("\n").slice(-3).join(" | ")}`))));
    onLog?.(`${bin} ${args.join(" ")}`);
  });
}

export async function encodeSequence(o: EncodeOptions): Promise<{ out: string; frames: number }> {
  const names = fs.readdirSync(o.dir).filter((f) => /^\d+\.png$/.test(f)).sort();
  if (!names.length) throw new Error(`no NNNNNN.png frames in ${o.dir}`);
  const digits = names[0].length - 4, start = Number(names[0].slice(0, -4));
  names.forEach((n, i) => { if (Number(n.slice(0, -4)) !== start + i) throw new Error(`frame sequence has a gap at ${n}`); });
  const codec = o.codec ?? (o.out.toLowerCase().endsWith(".mov") ? "prores" : "h264");
  const ffmpeg = o.ffmpeg ?? "ffmpeg";
  const seq = ["-framerate", String(o.fps), "-start_number", String(start), "-i", path.join(o.dir, `%0${digits}d.png`)];
  const evenSize = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  const enc = codec === "prores"
    ? ["-c:v", "prores_ks", "-profile:v", "3", "-vendor", "apl0", "-pix_fmt", "yuv422p10le"]
    : ["-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
  fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
  let tmp: string | null = null;
  try {
    let args: string[];
    if (o.slate) {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-slate-"));
      const slatePng = path.join(tmp, "slate.png");
      await renderSlatePng(o.slate, pngSize(path.join(o.dir, names[0])), slatePng, o.executablePath);
      const secs = o.slate.seconds ?? 3;
      const fc = `[0:v]format=rgba[s];[1:v]format=rgba[m];[s][m]concat=n=2:v=1:a=0,${evenSize}[v]`;
      args = ["-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", String(o.fps), "-t", String(secs), "-i", slatePng, ...seq, "-filter_complex", fc, "-map", "[v]", "-r", String(o.fps), ...enc, o.out];
    } else {
      args = ["-y", "-hide_banner", "-loglevel", "error", ...seq, "-vf", evenSize, "-r", String(o.fps), ...enc, o.out];
    }
    await run(ffmpeg, args, o.onLog);
  } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
  return { out: o.out, frames: names.length + (o.slate ? Math.round((o.slate.seconds ?? 3) * o.fps) : 0) };
}
