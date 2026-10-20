// Regression gate: render fixtures with motion-render and compare with committed baselines (PSNR >= 50 dB).
// Needs playwright-core and a Chrome/Chromium; skipped (loudly) when there is none. Also smoke-tests compare and encode.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = (n) => path.join(PKG, "bin", `${n}.mjs`);
const CHROME_CANDIDATES = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
let havePw = true;
try { await import("playwright-core"); } catch { havePw = false; }
const skip = !chrome || !havePw ? `no browser available (playwright-core: ${havePw}, chrome: ${chrome ?? "none found"}); set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` : false;
if (skip) console.warn(`# SKIP render regression: ${skip}`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-kit-test-"));
const env = { ...process.env, ...(chrome ? { CHROME_PATH: chrome } : {}) };
const sh = (name, args) => spawnSync(process.execPath, [BIN(name), ...args], { cwd: PKG, env, encoding: "utf8" });

// [name, args, baseline dir, frame range, names]. The first three predate the camera and layer motion blur: with neither in the
// document the output must still be identical to what v0.3 rendered (the committed baselines), pixel for pixel.
const CASES = [
  ["protocol page", ["--html", "test/fixture/index.html", "--root", "."], "index", "0-2", ["000000.png", "000001.png", "000002.png"], true],
  ["legacy renderAt page (compat shim)", ["--html", "test/fixture/legacy.html", "--fps", "24"], "legacy", "0-2", ["000000.png", "000001.png", "000002.png"], true],
  ["motion-keys page", ["--html", "test/fixture/keys-page.html", "--root", "."], "keys", "0-2", ["000000.png", "000001.png", "000002.png"], true],
  ["2.5D camera page", ["--html", "test/fixture/keys-camera.html", "--root", "."], "camera", "4-6", ["000004.png", "000005.png", "000006.png"], false],
  ["layer motion blur page", ["--html", "test/fixture/keys-blur.html", "--root", "."], "blur", "4-6", ["000004.png", "000005.png", "000006.png"], false],
];
for (const [name, args, base, range, names, identical] of CASES) {
  test(`render 3 frames: ${name} matches baseline >= 50 dB${identical ? " and is pixel-identical" : ""}`, { skip }, () => {
    const out = path.join(tmp, base);
    const r = sh("motion-render", [...args, "--range", range, "--out", out]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepEqual(fs.readdirSync(out).sort(), names);
    const c = sh("motion-compare", ["--a", path.join(PKG, "test/baseline", base), "--b", out, "--out", path.join(tmp, `cmp-${base}`), "--min-psnr", "50"]);
    assert.equal(c.status, 0, c.stderr + c.stdout);
    if (identical) {
      const rep = JSON.parse(fs.readFileSync(path.join(tmp, `cmp-${base}`, "report.json"), "utf8"));
      assert.ok(rep.frames.every((f) => f.identical), `not pixel-identical: ${rep.frames.map((f) => f.psnr_db)}`);
    }
  });
}
test("layer motion blur really smears: more lit pixels than the same document with motionBlur off, and the camera moves the picture", { skip }, () => {
  const dir = path.join(PKG, "test/out");
  fs.mkdirSync(dir, { recursive: true });
  const keys = JSON.parse(fs.readFileSync(path.join(PKG, "test/fixture/keys-blur.json"), "utf8"));
  for (const l of keys.layers) delete l.motionBlur;
  fs.writeFileSync(path.join(dir, "keys-noblur.json"), JSON.stringify(keys));
  fs.writeFileSync(path.join(dir, "keys-noblur.html"), fs.readFileSync(path.join(PKG, "test/fixture/keys-blur.html"), "utf8").replace("/test/fixture/keys-blur.json", "/test/out/keys-noblur.json"));
  const lit = (png) => { const raw = spawnSync("ffmpeg", ["-v", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 26 }).stdout; let n = 0; for (const v of raw) if (v > 8) n++; return n; };
  const a = path.join(tmp, "noblur"); 
  const r = sh("motion-render", ["--html", "test/out/keys-noblur.html", "--root", ".", "--range", "5-5", "--out", a]);
  assert.equal(r.status, 0, r.stderr);
  const blurred = lit(path.join(PKG, "test/baseline/blur/000005.png")), sharp = lit(path.join(a, "000005.png"));
  assert.ok(blurred > sharp * 1.15, `blurred ${blurred} vs sharp ${sharp}`);
  assert.notEqual(lit(path.join(PKG, "test/baseline/camera/000004.png")), lit(path.join(PKG, "test/baseline/camera/000006.png")));
});
test("scale 2 doubles the pixel size", { skip }, () => {
  const out = path.join(tmp, "s2");
  const r = sh("motion-render", ["--html", "test/fixture/index.html", "--root", ".", "--range", "0-0", "--scale", "2", "--out", out]);
  assert.equal(r.status, 0, r.stderr);
  const b = fs.readFileSync(path.join(out, "000000.png"));
  assert.deepEqual([b.readUInt32BE(16), b.readUInt32BE(20)], [640, 360]);
});
test("a page that throws in __frame fails the render with a non-zero exit", { skip }, () => {
  const bad = path.join(tmp, "bad.html");
  fs.writeFileSync(bad, `<canvas id="stage" width="10" height="10"></canvas><script>window.__meta={fps:24,width:10,height:10,duration_s:1,shutter:0,subframes:1};window.__ready=true;window.__frame=async(t)=>{ if(t>0) throw new Error("kaboom") };</script>`);
  const r = sh("motion-render", ["--html", bad, "--range", "0-2", "--out", path.join(tmp, "bad")]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /kaboom/);
});
test("motion-compare --min-psnr fails on a real difference", { skip }, () => {
  const wrong = path.join(tmp, "wrong");
  fs.mkdirSync(wrong, { recursive: true });
  const base = path.join(PKG, "test/baseline/index");
  fs.copyFileSync(path.join(base, "000002.png"), path.join(wrong, "000000.png")); // frame 0 replaced by frame 2
  fs.copyFileSync(path.join(base, "000001.png"), path.join(wrong, "000001.png"));
  fs.copyFileSync(path.join(base, "000002.png"), path.join(wrong, "000002.png"));
  const c = sh("motion-compare", ["--a", base, "--b", wrong, "--out", path.join(tmp, "cmp-wrong"), "--min-psnr", "50"]);
  assert.notEqual(c.status, 0);
  assert.match(c.stderr, /000000\.png/);
  const rep = JSON.parse(fs.readFileSync(path.join(tmp, "cmp-wrong/report.json"), "utf8"));
  assert.ok(rep.frames[0].psnr_db < 50 && rep.frames[0].mean_abs_offset.r > 0);
});
test("motion-compare reports differences (known shift) and crops", { skip }, () => {
  const out = path.join(tmp, "cmp-diff");
  const c = sh("motion-compare", ["--a", path.join(PKG, "test/baseline/index"), "--b", path.join(PKG, "test/baseline/legacy"), "--out", out]);
  assert.equal(c.status, 0, c.stderr);
  const rep = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));
  assert.equal(rep.schema, "xjp.motion-compare.v1");
  assert.ok(rep.frames.every((f) => f.error), "different sizes must be reported as errors, not compared");
  const same = sh("motion-compare", ["--a", path.join(PKG, "test/baseline/index"), "--b", path.join(PKG, "test/baseline/index"), "--out", path.join(tmp, "cmp-same")]);
  assert.equal(same.status, 0, same.stderr);
  const r2 = JSON.parse(fs.readFileSync(path.join(tmp, "cmp-same/report.json"), "utf8"));
  assert.ok(r2.frames.every((f) => f.identical && f.psnr_db === 100 && f.hf_ratio === 1));
  assert.ok(fs.existsSync(path.join(tmp, "cmp-same", r2.frames[0].crops.dark)));
});
const haveFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
test("motion-encode writes H.264 and ProRes, with and without a slate", { skip: skip || (haveFfmpeg ? false : "no ffmpeg on PATH") }, () => {
  const dir = path.join(PKG, "test/baseline/index");
  for (const [file, extra, frames] of [["a.mp4", [], 3], ["b.mov", [], 3], ["c.mp4", ["--slate-title", "Fixture", "--slate-purpose", "review", "--slate-version", "v1", "--slate-date", "2026-10-15"], 3 + 72]]) {
    const out = path.join(tmp, file);
    const r = sh("motion-encode", ["--dir", dir, "--out", out, "--fps", "24", ...extra]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.statSync(out).size > 1000, file);
    assert.match(r.stdout, new RegExp(`\\(${frames} frames\\)`));
    const probe = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,pix_fmt,codec_name", "-of", "csv=p=0", out], { encoding: "utf8" });
    if (probe.status === 0) {
      const [codec, pix, n] = probe.stdout.trim().split(",");
      assert.equal(Number(n), frames, `${file}: ${probe.stdout}`);
      assert.equal(codec, file.endsWith(".mov") ? "prores" : "h264");
      assert.equal(pix, file.endsWith(".mov") ? "yuv422p10le" : "yuv420p");
    }
  }
});
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Performance gate for layer motion blur: 47 layers at 1920x1080, 12 frames, shutter 0.4 / 0.62 / 0.68 on frames 3-5 and 0 elsewhere.
test("perf: 47 blurred layers at 1080p render in <= 1 s per frame (blurred frames included)", { skip }, async () => {
  const { perfScene, PERF_HTML } = await import("./perf-scene.mjs");
  const { renderFrames } = await import("../dist/render.js");
  const dir = path.join(PKG, "test/out");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "perf.json"), JSON.stringify(perfScene()));
  fs.writeFileSync(path.join(dir, "perf.html"), PERF_HTML("/test/out/perf.json"));
  process.env.CHROME_PATH = chrome;
  const ms = [];
  let last = Date.now();
  await renderFrames({ html: path.join(dir, "perf.html"), root: PKG, outDir: path.join(tmp, "perf"), range: [0, 11], onProgress: () => { const n = Date.now(); ms.push(n - last); last = n; } });
  console.log(`# perf ms per frame: ${ms.join(" ")}  (blurred frames 3-5: ${ms.slice(3, 6).join("/")})`);
  assert.equal(ms.length, 12);
  for (const f of [3, 4, 5]) assert.ok(ms[f] <= 1000, `blurred frame ${f} took ${ms[f]} ms`);
  for (const f of [6, 7, 8, 9, 10, 11]) assert.ok(ms[f] <= 500, `unblurred frame ${f} took ${ms[f]} ms`);
});

// ------------------------------------------------------------------------------------------------------------------
// Layer motion blur must not touch what it does not blur: shutter <= 0.01 is the plain draw (pixel-identical, all three
// methods), and pixels the blur does not move are identical to the direct draw even when the shutter is open.
const GRAY_PAGE = (json) => `<!doctype html>
<meta charset="utf-8"><title>exact</title>
<style>html,body{margin:0;background:#000}canvas{display:block}</style>
<canvas id="stage" width="640" height="360"></canvas>
<script type="module">
  import { definePage, createKeysPage, validateKeys } from "/dist/index.js";
  const c = document.createElement("canvas"); c.width = 60; c.height = 60;
  const g = c.getContext("2d"); g.fillStyle = "rgb(100,100,100)"; g.fillRect(0, 0, 60, 60); // 100 / 8 = 12.5: the worst case for 8-bit group sums
  const keys = validateKeys(await (await fetch("${json}")).json());
  definePage(createKeysPage(keys, { card: c }));
</script>
`;
const exactDoc = (layers, timeline) => ({ schema: "xjp.motion-keys.v1", fps: 24, size: [640, 360], layers, ...(timeline ? { timeline } : {}) });
const mover = (id, x, y, dx, dy, motionBlur) => ({
  id, texture: "card", anchor: [0.5, 0.5], frames: [], ...(motionBlur === undefined ? {} : { motionBlur }),
  segments: { x: [{ f0: 0, f1: 10, from: x - dx * 5, to: x + dx * 5, ease: "linear" }], y: [{ f0: 0, f1: 10, from: y - dy * 5, to: y + dy * 5, ease: "linear" }] },
});
async function renderDoc(name, doc) {
  const dir = path.join(PKG, "test/out");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(doc));
  fs.writeFileSync(path.join(dir, `${name}.html`), GRAY_PAGE(`/test/out/${name}.json`));
  const out = path.join(tmp, name);
  const r = sh("motion-render", ["--html", `test/out/${name}.html`, "--root", ".", "--range", "5-5", "--out", out]);
  assert.equal(r.status, 0, r.stderr);
  const { readPng } = await import("../dist/compare.js");
  return readPng(path.join(out, "000005.png"));
}
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.data.length; i++) m = Math.max(m, Math.abs(a.data[i] - b.data[i])); return m; };

test("shutter <= 0.01 draws exactly like motionBlur off, for accumulate, directional and radial (number, 0.01 and a zero timeline envelope)", { skip }, async () => {
  const methods = ["accumulate", "directional", "radial"];
  const forms = [{ shutter: 0 }, { shutter: 0.01 }, { shutter: "timeline" }];
  const build = (blur) => {
    const layers = [];
    methods.forEach((method, mi) => forms.forEach((form, fi) => {
      const mb = blur ? { method, strength: 3, center: [320, 180], ...form } : undefined;
      layers.push(mover(`${method}-${fi}`, 100 + mi * 200, 70 + fi * 110, 8.5, 3.25, mb)); // fractional speeds: sub-pixel positions on every frame
    }));
    return exactDoc(layers, { shutter: { segments: [{ f0: 0, f1: 10, from: 0, to: 0, ease: "linear" }] } });
  };
  const off = await renderDoc("exact-off", build(false)), on = await renderDoc("exact-on", build(true));
  assert.equal(maxDiff(off, on), 0, "a layer with an (almost) closed shutter must be pixel-identical to the plain draw");
});
test("with an open shutter, pixels the blur does not move are exactly the direct draw; the edges it does move differ", { skip }, async () => {
  const mk = (blur) => exactDoc([
    mover("acc", 100, 180, 0, 6, blur && { method: "accumulate", shutter: 1 }), // vertical motion only: left/right edges and the interior are static
    mover("dir", 320, 180, 0, 6, blur && { method: "directional", shutter: 1 }),
    mover("rad", 520, 180, 0, 0, blur && { method: "radial", shutter: 1, strength: 2, center: [520, 180] }),
  ]);
  const off = await renderDoc("static-off", mk(false)), on = await renderDoc("static-on", mk(true));
  const W = off.width, px = (r, x, y) => r.data.slice((y * W + x) * 4, (y * W + x) * 4 + 3).join(",");
  const diffs = [];
  for (let y = 0; y < off.height; y++) for (let x = 0; x < W; x++) if (px(off, x, y) !== px(on, x, y)) diffs.push([x, y]);
  assert.ok(diffs.length > 100, "the blur must have changed something");
  // moving cards (centre y = 180 at frame 5, 60 px tall, streak +-3): only rows near the top / bottom edge may differ; the radial card only away from its centre
  for (const [x, y] of diffs) {
    const vertical = (x < 220 || (x > 280 && x < 380)) && x > 60 && (Math.abs(y - 150) <= 6 || Math.abs(y - 210) <= 6);
    const radial = x > 480 && x < 560 && Math.hypot(x - 520, y - 180) > 20;
    assert.ok(vertical || radial, `pixel ${x},${y} changed although the blur does not move it: ${px(off, x, y)} -> ${px(on, x, y)}`);
  }
  const centre = [[520, 180], [515, 175], [525, 185], [100, 180], [320, 170]];
  for (const [x, y] of centre) assert.equal(px(on, x, y), px(off, x, y), `${x},${y}`);
});
