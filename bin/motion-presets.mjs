#!/usr/bin/env node
import fs from "node:fs";
import { parseArgs, die } from "./_cli.mjs";

const HELP = `motion-presets --size 1920x1080 [--fov 40] [--seed 1] [--out presets.json]
  prints the xjp.camera-presets.v1 library (push-in, pull-out, dolly-zoom, orbit, crash-zoom, whip-pan, handheld) for a canvas size and base fov.
motion-presets --size 1920x1080 --place push-in --f0 120 --frames 36
  prints { "camera": { "segments": ... } } for one preset placed at frame 120 and stretched to 36 frames, ready to merge into a keys file.`;
let a;
try { a = parseArgs(process.argv.slice(2), { flags: ["help"] }); } catch (e) { die(e.message + "\n" + HELP, 2); }
if (a.help) { console.log(HELP); process.exit(0); }
const m = /^(\d+)x(\d+)$/.exec(a.size ?? "");
if (!m) die(HELP, 2);
const { buildCameraPresetLibrary, placePreset } = await import("../dist/index.js");
try {
  const lib = buildCameraPresetLibrary({ size: [Number(m[1]), Number(m[2])], fov: a.fov ? Number(a.fov) : undefined, seed: a.seed ? Number(a.seed) : undefined });
  let text;
  if (a.place) {
    const p = lib.presets.find((q) => q.id === a.place);
    if (!p) die(`unknown preset ${a.place} (have: ${lib.presets.map((q) => q.id).join(", ")})`, 2);
    text = JSON.stringify({ camera: { segments: placePreset(p, { f0: a.f0 ? Number(a.f0) : 0, duration_frames: a.frames ? Number(a.frames) : undefined }) } }, null, 2) + "\n";
  } else text = JSON.stringify(lib, null, 2) + "\n";
  if (a.out) fs.writeFileSync(a.out, text); else process.stdout.write(text);
} catch (e) { die(`motion-presets: ${e.message}`); }
