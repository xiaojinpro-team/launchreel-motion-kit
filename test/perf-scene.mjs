// Synthetic perf scene for layer motion blur: 47 layers, 1920x1080, 12 frames, shutter 0.4 / 0.62 / 0.68 on frames 3..5 and 0 elsewhere.
export function perfScene() {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const methods = ["radial", "directional", "accumulate"];
  const seg = (f0, f1, from, to) => ({ f0, f1, from: Math.round(from), to: Math.round(to), ease: "linear" });
  const layers = Array.from({ length: 47 }, (_, i) => {
    const x = 100 + rnd() * 1720, y = 100 + rnd() * 880, big = i % 12 === 0;
    const dx = (rnd() - 0.5) * 160, dy = (rnd() - 0.5) * 100, s = big ? 3 + rnd() : 0.6 + rnd();
    const method = methods[i % 3];
    return {
      id: `l${i}`, texture: "card", anchor: [0.5, 0.5], frames: [{ f: 0, x, y, sx: s, sy: s, rot: rnd() * 30, opacity: 0.9 }],
      segments: { x: [seg(0, 12, x, x + dx * 12)], y: [seg(0, 12, y, y + dy * 12)] },
      motionBlur: { method, shutter: "timeline", strength: 1, ...(method === "radial" ? { center: [960, 540] } : {}) },
    };
  });
  const hold = (f, v) => ({ f0: f, f1: f + 1, from: v, to: v, ease: "linear" });
  return {
    schema: "xjp.motion-keys.v1", fps: 24, size: [1920, 1080], layers,
    timeline: { shutter: { segments: [{ f0: 0, f1: 3, from: 0, to: 0, ease: "linear" }, hold(3, 0.4), hold(4, 0.62), hold(5, 0.68), { f0: 6, f1: 12, from: 0, to: 0, ease: "linear" }] } },
  };
}
export const PERF_HTML = (keysUrl) => `<!doctype html>
<meta charset="utf-8"><title>perf</title>
<style>html,body{margin:0;background:#000}canvas{display:block}</style>
<canvas id="stage" width="1920" height="1080"></canvas>
<script type="module">
  import { definePage, createKeysPage, validateKeys } from "/dist/index.js";
  const c = document.createElement("canvas"); c.width = 128; c.height = 128;
  const g = c.getContext("2d"); g.fillStyle = "#ffb000"; g.fillRect(0, 0, 128, 128); g.fillStyle = "#fff"; g.fillRect(0, 0, 64, 24);
  const keys = validateKeys(await (await fetch("${keysUrl}")).json());
  definePage(createKeysPage(keys, { card: c }));
</script>
`;
