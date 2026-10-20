#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs, die } from "./_cli.mjs";

const HELP = `motion-compare --a <dir> --b <dir> --out <dir> [--no-crops] [--min-psnr <dB>]
  a = reference PNG directory, b = candidate; frames are matched by file name.
  writes <out>/report.json, <out>/report.md and (unless --no-crops) 8x crops of the darkest/mid/brightest tile of each frame.
  --min-psnr  exit non-zero when any frame is below it (or sizes differ / frames are missing)`;
let a;
try { a = parseArgs(process.argv.slice(2), { flags: ["no-crops", "help"] }); } catch (e) { die(e.message + "\n" + HELP, 2); }
if (a.help) { console.log(HELP); process.exit(0); }
if (!a.a || !a.b || !a.out) die(HELP, 2);
const { compareDirs, reportMarkdown } = await import("../dist/compare.js");
try {
  const r = await compareDirs({ a: a.a, b: a.b, outDir: a.out, crops: !a["no-crops"] });
  fs.mkdirSync(a.out, { recursive: true });
  fs.writeFileSync(path.join(a.out, "report.json"), JSON.stringify(r, null, 2) + "\n");
  fs.writeFileSync(path.join(a.out, "report.md"), reportMarkdown(r));
  console.log(`compared ${r.summary.compared} frames: min PSNR ${r.summary.min_psnr_db} dB, mean ${r.summary.mean_psnr_db} dB -> ${path.join(a.out, "report.md")}`);
  if (a["min-psnr"] !== undefined) {
    const min = Number(a["min-psnr"]);
    const bad = r.frames.filter((f) => f.psnr_db === null || f.psnr_db < min);
    if (bad.length || r.missing_in_a.length || r.missing_in_b.length || !r.summary.compared) die(`FAIL: ${bad.length} frame(s) below ${min} dB or mismatched/missing: ${bad.map((f) => f.frame).join(", ")}`);
  }
} catch (e) { die(`motion-compare: ${e.message}`); }
