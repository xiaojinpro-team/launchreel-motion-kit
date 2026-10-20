// The engine foundations behind the vocabulary (owner 10-19): per-property easing down to bezier handles, fitting an ease to a measured
// clip, the spatial layout layer, the transform tree with detach, and camera parallax. Pure parts only; the DOM side (glow inside its
// object, occlusion) is checked on rendered frames in LaunchReel's runner test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bezier } from "../dist/ease.js";
import { EASES, along, cssEase, curve, easeIssue, fitEase, motions, prog, tracks } from "../dist/vocab/easing.js";
import { layout, space } from "../dist/vocab/space.js";
import { CATALOGUE, catalogueDoc, catalogueProblems } from "../dist/vocab/catalogue.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test("every preset is a valid curve that runs 0 -> 1, and bezier presets have their CSS form", () => {
  for (const [name, p] of Object.entries(EASES)) {
    assert.equal(easeIssue(name), null, name);
    assert.ok(typeof p.doc === "string" && p.doc.length > 10, name);
    const c = curve(name);
    assert.equal(c.at(0, 600), 0, name);
    if (c.spring) assert.ok(Math.abs(c.at(5000, 600) - 1) < 0.01, `${name} settles`);
    else { assert.ok(near(c.at(600, 600), 1, 1e-6), name); assert.match(cssEase(name), /^(linear|cubic-bezier\()/, name); }
  }
  assert.equal(cssEase("spring-soft"), null);
  assert.match(easeIssue("bounce-out") ?? "", /unknown ease/);
  assert.match(easeIssue([1.2, 0, 0.5, 1]) ?? "", /x1 and x2/);
  assert.equal(easeIssue([0.3, 1.6, 0.6, 1]), null, "y may overshoot");
});

test("tracks: each property keyed on its own curve; a key's ease is the curve into it; constants and holds", () => {
  const t = tracks({ x: [[0, 0], [1000, 100, "linear"]], opacity: [[0, 0], [200, 1, [0.5, 0, 0.5, 1]]], scale: 2 });
  assert.deepEqual(t.at(-50), { x: 0, opacity: 0, scale: 2 });
  assert.ok(near(t.get("x", 500), 50));
  assert.ok(near(t.get("opacity", 100), bezier(0.5, 0, 0.5, 1)(0.5)));
  assert.equal(t.get("opacity", 900), 1, "held after its last key");
  assert.equal(t.end_ms, 1000);
  // a jump (two keys at one time) then an eased fall: the slam shape
  const s = tracks({ k: [[100, 1], [100, 1.5], [270, 0.94, "in-quad"], [400, 1, "in-out-sine"]] });
  assert.equal(s.get("k", 99), 1);
  assert.ok(s.get("k", 101) > 1.49);
  assert.ok(near(s.get("k", 270), 0.94, 1e-9) && near(s.get("k", 500), 1, 1e-9));
  // a spring into its key keeps settling after the key instead of being cut
  const sp = tracks({ v: [[0, 0], [100, 1, "spring-bounce"]] });
  assert.ok(Math.abs(sp.get("v", 150) - 1) > 0.01, "still moving after the key");
  assert.ok(Math.abs(sp.get("v", 4000) - 1) < 0.005, "settled");
});

test("motions: defaults by name, opts.ease overrides one move, a wrong name or curve throws (no silent fallback)", () => {
  const T = { roll: { ease: "out-expo", doc: "d" }, "tag.pop": { ease: "overshoot", doc: "d" } };
  assert.deepEqual(motions(T, undefined, "x"), { roll: "out-expo", "tag.pop": "overshoot" });
  assert.deepEqual(motions(T, { roll: [0.2, 0.9, 0.3, 1] }, "x"), { roll: [0.2, 0.9, 0.3, 1], "tag.pop": "overshoot" });
  assert.throws(() => motions(T, { rol: "house" }, "data.counter"), /no move "rol"/);
  assert.throws(() => motions(T, { roll: "fast" }, "data.counter"), /unknown ease "fast"/);
  assert.equal(along("linear", 50, 0, 100), 0.5);
  assert.equal(prog("house", 1), 1);
});

test("fitEase: recovers a known bezier from sampled positions, reports a tiny residual and the nearest preset", () => {
  const truth = [0.25, 1, 0.5, 1]; // out-quart
  const f = bezier(...truth);
  // a move from 120 px to 860 px over 30 frames, sampled at 24 fps in ms
  const samples = Array.from({ length: 31 }, (_, i) => ({ t: 400 + (i * 1000) / 24, value: 120 + 740 * f(i / 30) }));
  const r = fitEase(samples);
  assert.ok(r.rms < 0.002, `rms ${r.rms}`);
  assert.ok(r.rms_abs < 1.5, `rms ${r.rms_abs} px`);
  assert.equal(r.nearest.name, "out-quart");
  assert.match(r.css, /^cubic-bezier\(/);
  assert.deepEqual(r.from, { t: 400, value: 120 });
  // noisy measurements (±2 px) still land near the curve
  const noisy = samples.map((s, i) => ({ t: s.t, value: s.value + (i % 2 ? 2 : -2) * (i > 0 && i < 30 ? 1 : 0) }));
  const n = fitEase(noisy);
  assert.ok(n.rms_abs < 3, `noisy rms ${n.rms_abs} px`);
  // an overshooting move fits a y > 1 handle
  const ob = bezier(0.34, 1.56, 0.64, 1);
  const o = fitEase(Array.from({ length: 25 }, (_, i) => ({ t: i, value: ob(i / 24) * 100 })));
  assert.ok(Math.max(o.bezier[1], o.bezier[3]) > 1.2 && o.rms < 0.01, JSON.stringify(o));
  assert.throws(() => fitEase([{ t: 0, value: 1 }, { t: 1, value: 1 }, { t: 2, value: 1 }, { t: 3, value: 1 }]), /does not move/);
});

test("layout: groups place objects by relation (row, bottom-aligned row, column, ring, depth-stack), light per object", () => {
  const s = layout({
    light: { angle: 270, elevation: 0.5 },
    groups: [
      { id: "r", kind: "row", at: [960, 500], gap: 20 },
      { id: "b", kind: "row", at: [960, 800], gap: 0, align: "end" },
      { id: "c", kind: "column", at: [300, 540], gap: 10 },
      { id: "o", kind: "ring", at: [960, 540], radius: 200 },
      { id: "d", kind: "depth-stack", at: [1500, 400], gap: 100, offset: [40, -30], z: 10 },
    ],
    objects: [
      { id: "r1", w: 100, h: 50, group: "r" }, { id: "r2", w: 200, h: 50, group: "r" },
      { id: "b1", w: 100, h: 100, group: "b" }, { id: "b2", w: 100, h: 300, group: "b" },
      { id: "c1", w: 80, h: 40, group: "c" }, { id: "c2", w: 80, h: 60, group: "c" },
      { id: "o1", w: 10, h: 10, group: "o" }, { id: "o2", w: 10, h: 10, group: "o" },
      { id: "d1", w: 300, h: 200, group: "d" }, { id: "d2", w: 300, h: 200, group: "d" },
      { id: "free", w: 10, h: 10, at: [10, 20], z: 5 },
    ],
  });
  assert.equal(s.r2.x - s.r1.x, 50 + 20 + 100, "row: edge to edge with the gap");
  assert.equal((s.r1.x - 50 + s.r2.x + 100) / 2, 960, "row: centred");
  assert.equal(s.b1.y + 50, s.b2.y + 150, "bottom-aligned: same floor");
  assert.equal(s.c2.y - s.c1.y, 20 + 10 + 30);
  assert.ok(near(s.o1.y, 340) && near(s.o2.y, 740), "ring: first at the top, opposite at the bottom");
  assert.deepEqual([s.d2.x - s.d1.x, s.d2.y - s.d1.y, s.d1.z, s.d2.z], [40, -30, 10, -90], "depth-stack: parallel, each one step back");
  assert.deepEqual([s.free.x, s.free.y, s.free.z], [10, 20, 5]);
  assert.ok(near(s.r1.light.dx, -1) && near(s.r1.light.dy, 0, 1e-9) && s.r1.light.k === 0.5, "light from the left");
});

test("hierarchy: a child follows its parent's move, rotation and scale; detach freezes the parent as of at_ms with no jump", () => {
  const sp = space({
    objects: [
      { id: "p", w: 10, h: 10, at: [500, 500], motion: { x: [[0, 0], [1000, 400, "linear"]], rot: [[0, 0], [1000, 90, "linear"]], scale: [[0, 1], [1000, 2, "linear"]] } },
      { id: "c", w: 10, h: 10, parent: "p", at: [100, 0] },
      { id: "d", w: 10, h: 10, parent: "p", at: [100, 0], detach: { at_ms: 500 }, motion: { y: [[500, 0], [1000, 50, "linear"]] } },
    ],
  });
  const c0 = sp.world("c", 0), c1 = sp.world("c", 1000);
  assert.deepEqual([c0.x, c0.y], [600, 500]);
  assert.ok(near(c1.x, 900, 1e-6) && near(c1.y, 700, 1e-6) && c1.scale === 2 && c1.rot === 90, JSON.stringify(c1));
  // continuous at the detach: the same world position just before and at 500 ms
  const before = sp.world("d", 499.999), at = sp.world("d", 500);
  assert.ok(Math.hypot(before.x - at.x, before.y - at.y) < 0.01, "no jump at the detach");
  // after the detach the parent's later motion no longer moves it; its own track still does
  // after the detach: the parent as it was at 500 ms (x 700, 45°, 1.5x) composed with the child's own later track (y 50 at 1000 ms)
  const late = sp.world("d", 1000), c45 = Math.SQRT1_2;
  assert.ok(near(late.x, 700 + (100 * c45 - 50 * c45) * 1.5, 1e-6) && near(late.y, 500 + (100 * c45 + 50 * c45) * 1.5, 1e-6), JSON.stringify(late));
  assert.ok(late.scale === 1.5 && late.rot === 45, "the parent's later scale and turn no longer apply");
  const parentAt = sp.world("p", 500);
  assert.ok(parentAt.x === 700);
  assert.throws(() => space({ objects: [{ id: "a", w: 1, h: 1, parent: "b" }, { id: "b", w: 1, h: 1, parent: "a" }] }), /loop/);
});

test("camera parallax: a push moves a near object more than a far one; depth sets the stacking order", () => {
  const sp = space({
    camera: { focal: 1800, z: [[0, 0], [1000, 200, "linear"]] },
    objects: [{ id: "near", w: 10, h: 10, at: [1400, 540], z: 300 }, { id: "far", w: 10, h: 10, at: [1400, 540], z: -300 }],
  });
  const dn = sp.screen("near", 1000).x - sp.screen("near", 0).x, df = sp.screen("far", 1000).x - sp.screen("far", 0).x;
  assert.ok(dn > df * 1.3 && df > 0, `near moved ${dn}, far ${df}`);
  assert.ok(sp.screen("near", 0).s > 1 && sp.screen("far", 0).s < 1);
  assert.ok(sp.screen("near", 0).depth > sp.screen("far", 0).depth);
});

test("catalogue: every batch 2 entry lists its moves (valid curves, en + zh), the doc carries the ease library", () => {
  const b2 = CATALOGUE.filter((e) => ["data", "timeline", "energy", "diagram"].includes(e.family));
  assert.equal(b2.length, 15);
  for (const e of b2) {
    assert.ok(e.motions && e.motions.length >= 2, e.id);
    assert.ok(e.inputs.some((i) => i.name === "ease") && e.inputs.some((i) => i.name === "camera"), e.id);
  }
  const doc = catalogueDoc("x");
  assert.ok(doc.eases.length >= 25 && doc.eases.every((x) => x.doc && (x.css === null || /^(linear|cubic-bezier)/.test(x.css))));
  const bad = JSON.parse(JSON.stringify(doc));
  bad.entries.find((e) => e.id === "data.counter").motions[0].ease = "zoomy";
  assert.match(catalogueProblems(bad).join("\n"), /data\.counter.*motions in: unknown ease/);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// the replica workbench's measurement files (拆解_v1/measure/*.json) go straight into fitEase / fitCurve / motion-fit

import { measureSeries } from "../dist/measure.js";
import { fitCurve, toPoints } from "../dist/fit.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** a synthetic file in the workbench's shape: frame-keyed records, one element; a nested element; a frame that lost the channel */
function synthetic() {
  const f = bezier(0.45, 0, 0.15, 0.9);
  const one = {}, nested = { slider: {}, lamp: {} };
  for (let n = 100; n <= 120; n++) {
    const p = n < 105 ? 0 : n > 116 ? 1 : f((n - 105) / 11);
    one[String(n)] = { x: 1000 + 120 * p, y: 375, area: 300 };
    nested.slider[String(n)] = { center: [1000 + 120 * p, 375], r: 9 };
    nested.lamp[String(n)] = { center: [940, 574], r: n === 110 ? null : 20 };
  }
  delete one["111"].x; // a frame where the detector lost it
  return { one, nested };
}

test("measure: frame-keyed records, nested elements and array channels read directly; missing frames skipped, lists refused", () => {
  const { one, nested } = synthetic();
  const m = measureSeries(one, "x");
  assert.equal(m.points.length, 20);
  assert.deepEqual(m.skipped, [111]);
  assert.deepEqual(m.points[0], { f: 100, value: 1000 });
  const c = measureSeries(nested, "slider.center.0", { from: 105, to: 116 });
  assert.deepEqual([c.element, c.channel, c.points.length, c.points[0].f, c.points.at(-1).f], [["slider"], "center.0", 12, 105, 116]);
  assert.deepEqual(measureSeries(nested, "lamp.r").skipped, [110]);
  assert.throws(() => measureSeries(nested, "slide.center.0"), /"slide" not found \(here: slider, lamp\)/);
  assert.throws(() => measureSeries({ "1": [[1, 2]], "2": [] }, ""), /holds a list/);
  // a bare {frame: value} map is a curve for toPoints (and so for motion-fit without --measure)
  assert.deepEqual(toPoints({ "3": 5, "1": 2 }), [{ f: 1, value: 2 }, { f: 3, value: 5 }]);
});

test("fitEase and fitCurve take the measurement as it is: one move -> its bezier; a clip -> hold + move segments", () => {
  const { nested } = synthetic();
  const r = fitEase(nested, "slider.center.0", { from: 105, to: 116 });
  assert.ok(r.rms_abs < 0.5, `rms ${r.rms_abs} px`);
  assert.ok(Math.abs(r.bezier[0] - 0.45) < 0.05 && Math.abs(r.bezier[2] - 0.15) < 0.05, JSON.stringify(r.bezier));
  assert.deepEqual([r.from.t, r.to.t], [105, 116], "t is the frame number");
  assert.throws(() => fitEase({ "1": { v: 0 }, "2": { v: 10 }, "3": { v: 10 }, "4": { v: 1 } }, "v"), /not one move/);
  const clip = fitCurve(measureSeries(nested, "slider.center.0").points, { fps: 30, targetAbs: 1 });
  assert.ok(clip.segments.length >= 1 && clip.fit.rms_abs < 1, JSON.stringify(clip.fit));
  // the CLI: motion-fit <file> --measure <channel> [--from --to] --ease
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mf-")), file = path.join(dir, "lights.json");
  fs.writeFileSync(file, JSON.stringify(nested));
  const out = JSON.parse(execFileSync(process.execPath, [path.join(import.meta.dirname, "../bin/motion-fit.mjs"), file, "--measure", "slider.center.0", "--from", "105", "--to", "116", "--ease"], { stdio: ["ignore", "pipe", "ignore"] }).toString());
  assert.match(out.css, /^cubic-bezier\(/);
  fs.rmSync(dir, { recursive: true });
});

const REPLICA = "/Volumes/U2工作盘/灵渠OS宣传片2026/参考片/复刻/hyperos-motion-521b0b50/shot-03/replica/拆解_v1/measure";
test("the real shot-03 measurements fit without conversion (runs only where the drive is mounted)", { skip: !fs.existsSync(REPLICA) && "the replica drive is not mounted" }, () => {
  const knob = JSON.parse(fs.readFileSync(path.join(REPLICA, "knob.json"), "utf8"));
  const r = fitEase(knob, "x", { from: 133, to: 142 });
  assert.ok(r.rms_abs < 3, `knob slide rms ${r.rms_abs} px`);
  const lights = JSON.parse(fs.readFileSync(path.join(REPLICA, "lights_v2.json"), "utf8"));
  assert.ok(measureSeries(lights, "music.center.0").points.length > 5);
});
