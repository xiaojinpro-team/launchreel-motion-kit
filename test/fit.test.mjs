import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { bezier, trapezoid, spring, fitCurve, toPoints, pickPath, mergeSegments, validateKeys, sampleLayer, entriesFromFit, appendEntries, libraryProblems, evaluateSegment } from "../dist/index.js";

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const noise = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
const moves = (r) => r.segments.filter((g) => g.from !== g.to);
const pts = (vals) => vals.map((value, f) => ({ f, value }));

// two moves like a camera zoom: a trapezoid move, a hold, then a bezier move; in ln space, with measurement noise
function syntheticZoom() {
  const rnd = noise(7), b = bezier(0.74, 0.27, 0.14, 0.79), t = trapezoid(0.3, 0.3), v = [];
  for (let f = 0; f <= 43; f++) {
    const lz = f <= 14 ? Math.log(1.6) * t(f / 14) : f < 20 ? Math.log(1.6) : Math.log(1.6) + Math.log(2) * b((f - 20) / 23);
    v.push(Math.exp(lz + rnd() * 0.002));
  }
  return v;
}

test("synthetic log zoom: two moves, the second a bezier close to the generator, rms <= 0.5%", () => {
  const r = fitCurve(pts(syntheticZoom()), { fps: 24, space: "log", targetRms: 0.003 });
  assert.equal(r.segments.length, 3); // move, hold (the plateau), move: no gaps
  const [m1, hold, m2] = r.segments;
  assert.deepEqual([m1.f0, m1.f1, hold.f0, hold.f1, m2.f0, m2.f1], [0, 14, 14, 20, 20, 43]);
  assert.ok(hold.from === hold.to && hold.ease === "linear" && hold.from === m1.to);
  assert.ok(r.segments.every((s) => s.space === "log"));
  assert.deepEqual(r.fit.per_segment.map((q) => q.kind === "hold"), [false, true, false]);
  const e = m2.ease;
  assert.ok("bezier" in e, JSON.stringify(e));
  [0.74, 0.27, 0.14, 0.79].forEach((want, i) => assert.ok(Math.abs(e.bezier[i] - want) < 0.1, `bezier[${i}] ${e.bezier[i]} vs ${want}`));
  assert.ok(r.fit.rms <= 0.005, `rms ${r.fit.rms}`);
  assert.ok(r.fit.max < 0.02);
  // the model reproduces the samples
  const vals = syntheticZoom();
  for (const f of [3, 10, 25, 40]) {
    const s = r.segments.find((q) => f >= q.f0 && f <= q.f1);
    assert.ok(Math.abs(Math.log(evaluateSegment(s, f, 24)) - Math.log(vals[f])) < 0.02 * Math.log(3.2));
  }
});
test("a simpler easing wins when it already reaches the target", () => {
  const t = trapezoid(0.25, 0.25), v = Array.from({ length: 30 }, (_, f) => 10 + 90 * t(f / 29));
  const r = fitCurve(pts(v), { fps: 30, targetRms: 0.01 });
  assert.equal(r.segments.length, 1);
  assert.deepEqual(Object.keys(r.segments[0].ease), ["trapezoid"]);
  const ramp = fitCurve(pts(Array.from({ length: 20 }, (_, f) => f * 2)), { fps: 30 });
  assert.equal(ramp.segments[0].ease, "linear");
  assert.equal(ramp.segments[0].space, undefined);
  assert.ok(ramp.fit.notes.length >= 1 && "max_abs" in ramp.fit && "rms_abs" in ramp.fit.per_segment[0]);
});
test("plateaus become explicit hold segments (no gaps); flat data is one hold", () => {
  const v = [...Array(10).fill(5), ...Array.from({ length: 11 }, (_, i) => 5 + i * 10), ...Array(10).fill(105)];
  const r = fitCurve(pts(v), { fps: 24 });
  assert.equal(r.segments.length, 3);
  const [h1, mv, h2] = r.segments;
  assert.deepEqual([h1.f0, h1.f1, h1.from, h1.to, h1.ease], [0, 10, 5, 5, "linear"]);
  assert.deepEqual([mv.f0, mv.f1, mv.from, mv.to], [10, 20, 5, 105]);
  assert.deepEqual([h2.f0, h2.f1, h2.from, h2.to, h2.ease], [20, 30, 105, 105, "linear"]);
  assert.ok(r.fit.rms < 0.01);
  assert.deepEqual(r.fit.per_segment.map((q) => q.kind), ["hold", "linear", "hold"]);
  const flat = fitCurve(pts(Array(12).fill(3)), { fps: 24 });
  assert.deepEqual(flat.segments, [{ f0: 0, f1: 11, from: 3, to: 3, ease: "linear" }]);
});
test("--target-abs: an absolute tolerance accepts a simpler easing than the range share would", () => {
  // a big coordinate: a mild bend on a 2000 px move. 0.3% of the range is 6 px; the bend is ~15 px rms
  const t = trapezoid(0.1, 0.1), v = Array.from({ length: 30 }, (_, f) => 1000 + 2000 * (0.9 * f / 29 + 0.1 * t(f / 29)));
  const strict = fitCurve(pts(v), { fps: 24, targetRms: 0.001 });
  const abs = fitCurve(pts(v), { fps: 24, targetRms: 0.001, targetAbs: 40 });
  assert.notEqual(strict.segments[0].ease, "linear");
  assert.equal(abs.segments[0].ease, "linear");
  assert.ok(abs.fit.rms_abs <= 40 && abs.fit.max_abs >= abs.fit.rms_abs);
  assert.equal(abs.fit.target_abs, 40);
  assert.ok(abs.fit.per_segment[0].rms_abs > 0 && abs.fit.per_segment[0].max_abs >= abs.fit.per_segment[0].rms_abs);
  assert.match(abs.fit.notes[0], /NOT safe for large coordinates/);
});
test("a velocity sign change cuts at the extremum", () => {
  const up = Array.from({ length: 11 }, (_, i) => i * 10), v = [...up, ...up.slice(0, -1).reverse()];
  const r = fitCurve(pts(v), { fps: 24 });
  assert.equal(r.segments.length, 2);
  assert.deepEqual([r.segments[0].f1, r.segments[1].f0], [10, 10]);
  assert.deepEqual([r.segments[0].to, r.segments[1].from, r.segments[1].to], [100, 100, 0]);
});
test("a ringing spring is kept as one spring move", () => {
  const sp = spring(2, 0.35), v = Array.from({ length: 49 }, (_, f) => 50 * sp(f / 48, 2));
  const r = fitCurve(pts(v), { fps: 24, targetRms: 0.01 });
  assert.equal(moves(r).length, 1, JSON.stringify(r.segments));
  assert.ok("spring" in moves(r)[0].ease);
  const [freq, z] = moves(r)[0].ease.spring;
  assert.ok(Math.abs(freq - 2) < 0.2 && Math.abs(z - 0.35) < 0.1, `${freq} ${z}`);
});
test("smoothing keeps the structure of noisy data", () => {
  const rnd = noise(3), t = trapezoid(0.3, 0.3), v = Array.from({ length: 40 }, (_, f) => 100 * t(f / 39) + rnd() * 1);
  const r = fitCurve(pts(v), { fps: 24, smooth: true, targetRms: 0.02 });
  assert.equal(moves(r).length, 1);
  assert.ok(r.fit.rms < 0.02);
});
test("input helpers and errors", () => {
  assert.deepEqual(toPoints([5, 6], 10), [{ f: 10, value: 5 }, { f: 11, value: 6 }]);
  assert.deepEqual(toPoints([[3, 1], { f: 1, value: 2 }]), [{ f: 1, value: 2 }, { f: 3, value: 1 }]);
  assert.equal(pickPath({ a: { b: [1, 2] } }, "a.b").length, 2);
  assert.throws(() => pickPath({ a: 1 }, "a.x"), /not found/);
  assert.throws(() => fitCurve(pts([1, 2, 0]), { fps: 24, space: "log" }), /> 0/);
  assert.throws(() => fitCurve(pts([1]), { fps: 24 }), /at least 2/);
  assert.throws(() => fitCurve([{ f: 1, value: 1 }, { f: 1, value: 2 }], { fps: 24 }), /increasing/);
});
test("mergeSegments puts the fit on a layer or camera channel and the result samples back", () => {
  const r = fitCurve(pts(Array.from({ length: 20 }, (_, f) => f * 2)), { fps: 24 });
  const base = { schema: "xjp.motion-keys.v1", fps: 24, size: [10, 10], layers: [{ id: "icon.v2", texture: "t", anchor: [0, 0], frames: [{ f: 0, x: 0, y: 0, sx: 1, sy: 1, rot: 0, opacity: 1 }] }] };
  const m = mergeSegments(base, "icon.v2.sx", r.segments);
  assert.equal(base.layers[0].segments, undefined); // input untouched
  validateKeys(m);
  assert.equal(sampleLayer(m.layers[0], 10, undefined, 24).sx, 20);
  const c = mergeSegments(base, "camera.z", r.segments);
  assert.ok(c.camera.segments.z.length === 1);
  assert.throws(() => mergeSegments(base, "nope.x", r.segments), /not found/);
});
test("ease library: entries per segment, unique ids, validation", () => {
  const points = pts(syntheticZoom());
  const r = fitCurve(points, { fps: 24, space: "log", targetRms: 0.003 });
  const entries = entriesFromFit(points, r.segments, r.fit.per_segment.map((s) => s.rms), "log", { name: "Zoom 推", source: { clip: "c1", shot: "s2", channel: "cam.z" }, note: "n" });
  assert.equal(entries.length, 2); // two moves; the plateau hold is skipped
  assert.equal(entries[1].name, "Zoom 推 #2");
  assert.equal(entries[1].frames[0].f, 0);
  assert.equal(entries[1].frames.at(-1).f, 23);
  let lib = appendEntries(null, entries);
  assert.deepEqual(libraryProblems(lib), []);
  assert.equal(lib.schema, "xjp.ease-library.v1");
  lib = appendEntries(lib, entries);
  assert.equal(new Set(lib.entries.map((e) => e.id)).size, 4);
  assert.ok(libraryProblems({ schema: "x", entries: [{}] }).length >= 4);
});

test("CLI: motion-fit prints segments, merges into keys, saves to a library", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-fit-"));
  try {
    const curve = path.join(dir, "tracking.json");
    fs.writeFileSync(curve, JSON.stringify({ meta: {}, tracks: { icon_scale: syntheticZoom() } }));
    const run = (...a) => spawnSync(process.execPath, [path.join(PKG, "bin/motion-fit.mjs"), ...a], { encoding: "utf8" });
    const r = run(curve, "--path", "tracks.icon_scale", "--fps", "24", "--space", "log", "--target-rms", "0.003");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).segments.filter((g) => g.from !== g.to).length, 2);
    const keys = path.join(dir, "keys.json");
    fs.writeFileSync(keys, JSON.stringify({ schema: "xjp.motion-keys.v1", fps: 24, size: [10, 10], layers: [{ id: "icon", texture: "t", anchor: [0, 0], frames: [{ f: 0, x: 0, y: 0, sx: 1, sy: 1, rot: 0, opacity: 1 }] }] }));
    const out = path.join(dir, "out.json"), lib = path.join(dir, "lib.json");
    const e = run(curve, "--path", "tracks.icon_scale", "--fps", "24", "--space", "log", "--target-rms", "0.003", "--emit-keys", "icon.sx", "--keys", keys, "--out", out, "--save", lib, "--name", "zoom");
    assert.equal(e.status, 0, e.stderr);
    validateKeys(JSON.parse(fs.readFileSync(out, "utf8")));
    assert.equal(JSON.parse(fs.readFileSync(lib, "utf8")).entries.length, 2); // the hold is not a library entry
    assert.equal(run(curve, "--path", "tracks.icon_scale").status, 2); // --fps missing
    assert.notEqual(run(curve, "--path", "tracks.nope", "--fps", "24").status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Real measured curves (test/fixtures, plain {f,value} lists).
const load = (n) => JSON.parse(fs.readFileSync(path.join(PKG, "test/fixtures", n), "utf8"));
test("fixture fit-camera-zoom.json (log, f 0..43): linear drift then a bezier zoom, scale-ratio rms <= 0.5%", () => {
  const r = fitCurve(toPoints(load("fit-camera-zoom.json")), { fps: 24, space: "log" });
  assert.equal(r.segments.length, 2, JSON.stringify(r.fit.per_segment));
  const [a, b] = r.segments;
  assert.equal(a.ease, "linear");
  assert.ok(a.f0 === 0 && a.f1 > 19 && a.f1 < 22, `cut at ${a.f1}`);
  assert.equal(b.f0, a.f1);
  assert.equal(b.f1, 43);
  assert.ok("bezier" in b.ease, JSON.stringify(b.ease));
  [0.738, 0.271, 0.135, 0.792].forEach((want, i) => assert.ok(Math.abs(b.ease.bezier[i] - want) < 0.1, `bezier[${i}] ${b.ease.bezier[i]} vs ${want}`));
  assert.ok(r.fit.rms_ratio <= 0.005, `ratio rms ${r.fit.rms_ratio}`);
  assert.ok(r.fit.rms <= 0.005, `rms ${r.fit.rms}`);
});
test("fixture fit-depth-decay.json (f 28..44, bounce at 31-32): not shattered, <= 3 segments, rms <= 2%", () => {
  const r = fitCurve(toPoints(load("fit-depth-decay.json")), { fps: 24 });
  assert.ok(r.segments.length >= 1 && r.segments.length <= 3, JSON.stringify(r.segments.map((s) => [s.f0, s.f1])));
  assert.ok(r.fit.rms <= 0.02, `rms ${r.fit.rms}`);
  assert.equal(r.segments[0].f0, 28);
  assert.equal(r.segments.at(-1).f1, 44);
  for (let i = 1; i < r.segments.length; i++) assert.equal(r.segments[i].f0, r.segments[i - 1].f1); // contiguous
  assert.ok(r.fit.per_segment.every((s) => s.candidates.linear !== undefined));
});
test("a one-frame bounce does not cut a move", () => {
  const t = trapezoid(0.3, 0.3), v = Array.from({ length: 40 }, (_, f) => 100 * t(f / 39));
  v[20] = v[19] - 2; // a single frame going backwards
  const r = fitCurve(pts(v), { fps: 24, targetRms: 0.02 });
  assert.equal(moves(r).length, 1);
});
