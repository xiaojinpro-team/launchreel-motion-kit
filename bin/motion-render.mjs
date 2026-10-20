#!/usr/bin/env node
import { parseArgs, die } from "./_cli.mjs";

const HELP = `motion-render --html <page.html|url> --out <dir> [options]
  --html      page implementing xjp.frame-protocol.v1 (or a legacy renderAt page); local files are served over http://127.0.0.1
  --out       output directory, frames are written as <frame zero-padded to 6>.png
  --spec      JSON file passed to __load(spec)
  --range     a-b, inclusive frame indices (default: the whole page)
  --fps       default: __meta.fps (required for a legacy page)
  --scale     deviceScaleFactor (default 1)
  --full-page photograph the whole scrolling page (default: the #stage canvas, else the viewport)
  --viewport  photograph the viewport instead of #stage
  --root      directory served for a local html (default: its own directory); use it when the page imports ../dist etc.
  --width --height --duration   overrides / legacy meta
  --chrome    Chrome binary (default: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, CHROME_PATH, else the installed Chrome channel)
  --network   leave Chrome's network on for local pages
Exit code is non-zero on any page or frame error.`;

let a;
try { a = parseArgs(process.argv.slice(2), { flags: ["full-page", "viewport", "network", "help"] }); } catch (e) { die(e.message + "\n" + HELP, 2); }
if (a.help) { console.log(HELP); process.exit(0); }
if (!a.html || !a.out) die(HELP, 2);
let range;
if (a.range) {
  const m = /^(\d+)-(\d+)$/.exec(a.range);
  if (!m) die(`bad --range ${a.range} (want a-b)`, 2);
  range = [Number(m[1]), Number(m[2])];
}
const num = (k) => (a[k] === undefined ? undefined : Number(a[k]));
const { renderFrames } = await import("../dist/render.js");
try {
  const r = await renderFrames({
    html: a.html, spec: a.spec, outDir: a.out, range, fps: num("fps"), scale: num("scale"), root: a.root,
    target: a["full-page"] ? "full-page" : a.viewport ? "viewport" : undefined,
    width: num("width"), height: num("height"), duration_s: num("duration"), executablePath: a.chrome, network: !!a.network,
    onLog: (l) => console.error(l),
    onProgress: (done, total, f) => { if (done === 1 || done === total || done % 10 === 0) console.log(`frame ${f} (${done}/${total})`); },
  });
  console.log(`done: ${r.frames} frames ${r.first}-${r.last} @ ${r.fps} fps -> ${r.outDir} in ${(r.ms / 1000).toFixed(1)} s`);
} catch (e) {
  die(`motion-render: ${e.code ? `[${e.code}] ` : ""}${e.message}`);
}
