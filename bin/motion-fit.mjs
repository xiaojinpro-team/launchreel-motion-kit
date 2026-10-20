#!/usr/bin/env node
import fs from "node:fs";
import { parseArgs, die } from "./_cli.mjs";

const HELP = `motion-fit <curve.json> --fps <n> [options]
  curve.json   [{f,value}] | [[f,value]] | [numbers] (frame = --first-frame + index) | {"<frame>": value}; with --path a.b.c a dotted path into a larger json (e.g. tracking.json)
  --measure CH            read a replica workbench measurement file (拆解_v1/measure/*.json) directly: CH is the channel, after any element keys
                          ("x", "core_r", "music.center.0", "仪表大屏.cx"); frames without it are skipped and reported
  --from F --to F         keep frames F..F (inclusive) of the measurement
  --ease                  fit ONE move with a single cubic-bezier instead of segmenting (no --fps needed): prints {bezier, css, rms, nearest}
  --fps N                 required (spring and the segment time need real seconds)
  --space linear|log      fit in ln space (values must be > 0)            [linear]
  --target-rms 0.01       share of the curve's range; a simpler easing that reaches it wins   [0.01]
  --target-abs V          absolute tolerance in value units (px; ln units with --space log); a move is good enough when it is within
                          --target-rms OR --target-abs. Use it for big coordinates: a share of a large range is a large error
  --channel shutter       input is per-frame shutter samples (0..1): fit to segments for timeline.shutter (abs tolerance 0.01 unless given);
                          --emit-keys timeline.shutter merges them as timeline.shutter.segments
  --smooth                3-point smoothing before cutting and fitting
  --first-frame N         frame of the first number                       [0]
  --emit-keys id.channel  print a keys fragment for layer <id> channel <channel> ("camera.z" for the camera);
                          with --keys doc.json it merges into that document and writes --out (default stdout)
  --save lib.json --name "..."   append the fitted moves to an xjp.ease-library.v1 file (--id, --note, --source-clip, --source-shot, --source-channel)
Prints { segments, fit } as JSON.`;
let a;
try { a = parseArgs(process.argv.slice(2), { flags: ["smooth", "help", "ease"] }); } catch (e) { die(e.message + "\n" + HELP, 2); }
if (a.help) { console.log(HELP); process.exit(0); }
const input = a._[0] ?? a.in;
if (!input || (!a.fps && !a.ease)) die(HELP, 2);
const space = a.space ?? "linear";
if (space !== "linear" && space !== "log") die("--space must be linear or log", 2);
const { toPoints, pickPath, measureSeries, fitCurve, fitShutter, mergeSegments, entriesFromFit, appendEntries, libraryProblems } = await import("../dist/index.js");
try {
  let doc = JSON.parse(fs.readFileSync(input, "utf8"));
  if (a.path) doc = pickPath(doc, a.path);
  const range = { from: a.from === undefined ? undefined : Number(a.from), to: a.to === undefined ? undefined : Number(a.to) };
  let points;
  if (a.measure !== undefined) {
    const m = measureSeries(doc, String(a.measure), range);
    if (m.skipped.length) console.error(`note: ${m.skipped.length} frame(s) without ${a.measure} skipped: ${m.skipped.join(", ")}`);
    points = m.points;
  } else points = toPoints(doc, a["first-frame"] === undefined ? 0 : Number(a["first-frame"]));
  if (a.ease) {
    const { fitEase } = await import("../dist/vocab/easing.js");
    const r = fitEase(points.map((p) => ({ t: p.f, value: p.value })));
    console.log(JSON.stringify(r, null, 2));
    console.error(`ease: ${r.css}, rms ${(r.rms * 100).toFixed(2)}% of the move (${r.rms_abs} units), nearest preset ${r.nearest.name} (rms ${(r.nearest.rms * 100).toFixed(2)}%)`);
    process.exit(0);
  }
  if (a.channel !== undefined && a.channel !== "shutter") die("--channel only supports shutter", 2);
  const opts = { fps: Number(a.fps), space, targetRms: a["target-rms"] === undefined ? undefined : Number(a["target-rms"]), targetAbs: a["target-abs"] === undefined ? undefined : Number(a["target-abs"]), smooth: !!a.smooth };
  const res = a.channel === "shutter" ? fitShutter(points, opts) : fitCurve(points, opts);
  for (const n of res.fit.notes) console.error(`note: ${n}`);
  if (a.save) {
    if (!a.name) die("--save needs --name", 2);
    let lib = null;
    if (fs.existsSync(a.save)) {
      lib = JSON.parse(fs.readFileSync(a.save, "utf8"));
      const p = libraryProblems(lib);
      if (p.length) die(`${a.save} is not a valid xjp.ease-library.v1: ${p.join("; ")}`);
    }
    const source = a["source-clip"] || a["source-shot"] || a["source-channel"] ? { clip: a["source-clip"], shot: a["source-shot"], channel: a["source-channel"] } : undefined;
    const entries = entriesFromFit(points, res.segments, res.fit.per_segment.map((s) => s.rms), space, { name: a.name, source, note: a.note });
    fs.writeFileSync(a.save, JSON.stringify(appendEntries(lib, entries, a.id), null, 2) + "\n");
    console.error(`saved ${entries.length} entr${entries.length === 1 ? "y" : "ies"} to ${a.save}`);
  }
  if (a["emit-keys"]) {
    const target = a["emit-keys"];
    if (a.keys) {
      const merged = mergeSegments(JSON.parse(fs.readFileSync(a.keys, "utf8")), target, res.segments);
      const text = JSON.stringify(merged, null, 2) + "\n";
      if (a.out) fs.writeFileSync(a.out, text); else process.stdout.write(text);
    } else {
      const dot = target.lastIndexOf("."), owner = target.slice(0, dot), channel = target.slice(dot + 1);
      const frag = owner === "camera" ? { camera: { segments: { [channel]: res.segments } } } : { layers: [{ id: owner, segments: { [channel]: res.segments } }] };
      console.log(JSON.stringify(frag, null, 2));
    }
    console.error(`fit: rms ${res.fit.rms} (abs ${res.fit.rms_abs}), max ${res.fit.max} (abs ${res.fit.max_abs}), ${res.segments.length} segment(s)`);
  } else {
    console.log(JSON.stringify(res, null, 2));
  }
} catch (e) { die(`motion-fit: ${e.message}`); }
