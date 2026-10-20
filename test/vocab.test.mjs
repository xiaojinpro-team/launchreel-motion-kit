// The motion vocabulary (src/vocab): the catalogue validates, the bundles compile, and LaunchReel's vendored copies match this build.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CATALOGUE, catalogueDoc, catalogueProblems, FAMILIES, MONEY_WORDS } from "../dist/vocab/catalogue.js";
import { balance, timedWords } from "../dist/vocab/captions.js";
import { typingEvents } from "../dist/vocab/type-input.js";
import { scrollAt } from "../dist/vocab/device.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = (f) => fs.readFileSync(path.join(ROOT, "dist", f));

test("the catalogue validates: every family has 3+ variants, demo loops are 6-10 s, demo copy has no money words", () => {
  assert.deepEqual(catalogueProblems(catalogueDoc("x")), []);
  for (const f of FAMILIES) assert.ok(CATALOGUE.filter((e) => e.family === f).length >= 3, f);
  assert.ok(MONEY_WORDS.test("Start your free trial") && MONEY_WORDS.test("$9 per month") && MONEY_WORDS.test("免费试用"));
  assert.ok(!MONEY_WORDS.test("Your film plan is ready"));
  const bad = catalogueDoc("x");
  bad.entries = [{ ...bad.entries[0], demo: { ...bad.entries[0].demo, opts: { text: "Try it free for 7 days" } } }];
  assert.match(catalogueProblems(bad).join("\n"), /money or trial word/);
});

test("the zh page is Chinese: an English on-screen word without its Chinese, or an input doc without doc_zh, is a problem", () => {
  const doc = JSON.parse(JSON.stringify(catalogueDoc("x")));
  const chat = doc.entries.find((e) => e.id === "device.chat");
  delete chat.demo.opts_zh;
  doc.entries.find((e) => e.id === "title.rise").inputs[0].doc_zh = "";
  doc.entries.find((e) => e.id === "transition.wipe").demo.scene_zh = { head: "Six shots planned" };
  const p = catalogueProblems(doc).join("\n");
  assert.match(p, /device\.chat\)\.demo\.opts_zh\.messages must be the Chinese/);
  assert.match(p, /title\.rise\)\.inputs text: doc_zh must be Chinese/);
  assert.match(p, /transition\.wipe\)\.demo\.scene_zh must be Chinese/);
  for (const e of CATALOGUE) if (e.demo.opts_zh) assert.ok(!Object.values(e.demo.opts_zh).some((v) => MONEY_WORDS.test(JSON.stringify(v))), e.id);
});

test("the dist catalogue json is this catalogue", () => {
  const doc = JSON.parse(dist("motion-catalogue.json"));
  assert.deepEqual(catalogueProblems(doc), []);
  assert.equal(doc.entries.length, CATALOGUE.length);
});

test("the bundles compile as classic scripts and set the global MV", () => {
  for (const f of ["motion-vocab.js", "motion-vocab-demo.js"]) {
    const window = {};
    new Function("window", dist(f).toString())(window);
    for (const k of ["bind", "typeInput", "title", "captions", "logo", "endCard", "transition", "device"]) assert.equal(typeof window.MV[k], "function", `${f}: MV.${k}`);
  }
  const window = {};
  new Function("window", dist("motion-vocab-demo.js").toString())(window);
  assert.equal(typeof window.MV.demo, "function");
  assert.equal(window.MV.catalogue.entries.length, CATALOGUE.length);
});

test("pure timing helpers: typing is deterministic and monotonic, words share the line, scroll eases between sparse keys", () => {
  const a = typingEvents("launch film template", 300, 15, { at: 10, wrong: "g" });
  assert.deepEqual(a, typingEvents("launch film template", 300, 15, { at: 10, wrong: "g" }));
  assert.ok(a.events.every((e, i) => i === 0 || e.at > a.events[i - 1].at));
  assert.equal(a.events.at(-1).value, "launch film template");
  assert.ok(a.events.some((e) => e.value === "launch fil" + "g"), "the typo is typed");
  const w = timedWords({ text: "Paste a link now", start: 0, end: 2000 });
  assert.equal(w.length, 4);
  assert.ok(w[0].start >= 0 && w.at(-1).end <= 2000);
  assert.deepEqual(balance("LaunchReel reads your product page and plans six shots.", 38).length, 2);
  assert.equal(scrollAt([{ at: 1000, y: 400 }], 500), 0);
  assert.equal(scrollAt([{ at: 1000, y: 400 }], 1900), 400);
  const mid = scrollAt([{ at: 1000, y: 400 }], 1450);
  assert.ok(mid > 150 && mid < 250, `${mid}`);
});

test("LaunchReel's vendored shelf file and desk catalogue match this build (re-run scripts/vendor-motion-vocab.mjs)", (t) => {
  const repo = path.resolve(ROOT, "../..");
  const shelf = path.join(repo, "stage/vendor/motion-vocab.js");
  if (!fs.existsSync(shelf)) return t.skip("not inside the launchreel repo");
  assert.ok(fs.readFileSync(shelf).equals(dist("motion-vocab.js")), "stage/vendor/motion-vocab.js drifted");
  const desk = JSON.parse(fs.readFileSync(path.join(repo, "desk/workstation/skill/references/motion-catalogue.json"), "utf8"));
  assert.deepEqual(desk, JSON.parse(dist("motion-catalogue.json")), "desk motion-catalogue.json drifted");
});
