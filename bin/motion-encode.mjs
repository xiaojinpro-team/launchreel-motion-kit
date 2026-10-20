#!/usr/bin/env node
import { parseArgs, die } from "./_cli.mjs";

const HELP = `motion-encode --dir <png dir> --out <file.mov|file.mp4> --fps <n> [--codec prores|h264] [slate options]
  PNG sequence (NNNNNN.png) -> ProRes 422 HQ (.mov) or H.264 High yuv420p faststart (.mp4); ffmpeg is taken from PATH.
  --slate-title T --slate-purpose P --slate-version V [--slate-date YYYY-MM-DD] [--slate-seconds 3]
      prepends a black 3 s card, white text "T · P" over "V / date" (date defaults to today); needs playwright-core
  --ffmpeg <bin>  --chrome <bin>`;
let a;
try { a = parseArgs(process.argv.slice(2), { flags: ["help"] }); } catch (e) { die(e.message + "\n" + HELP, 2); }
if (a.help) { console.log(HELP); process.exit(0); }
if (!a.dir || !a.out || !a.fps) die(HELP, 2);
let slate;
if (a["slate-title"] || a["slate-purpose"] || a["slate-version"]) {
  if (!a["slate-title"] || !a["slate-purpose"] || !a["slate-version"]) die("a slate needs --slate-title, --slate-purpose and --slate-version", 2);
  slate = { title: a["slate-title"], purpose: a["slate-purpose"], version: a["slate-version"], date: a["slate-date"], seconds: a["slate-seconds"] ? Number(a["slate-seconds"]) : undefined };
}
const { encodeSequence } = await import("../dist/encode.js");
try {
  const r = await encodeSequence({ dir: a.dir, out: a.out, fps: Number(a.fps), codec: a.codec, slate, ffmpeg: a.ffmpeg, executablePath: a.chrome });
  console.log(`wrote ${r.out} (${r.frames} frames)`);
} catch (e) { die(`motion-encode: ${e.message}`); }
