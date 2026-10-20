# Changelog

## 0.5.0 (first public release)

- 41 finished, seekable motion components in `@launchreel-ai/motion-kit/vocab`: text input typing, big-title kinetic type, captions, logo reveals, transitions, device frames, data reveals, timelines, energy builds and diagrams. A component is `factory(host, opts) -> { el, duration_ms, seek(ms) }`; `seek` is pure (no clock, no rAF, seeded jitter), so any frame can be drawn in any order.
- `dist/motion-vocab.js` (one classic script, global `MV`) and `dist/motion-catalogue.json` (name, intent tags, duration range, inputs, when to use, rationale for each component).
- Frame protocol `xjp.frame-protocol.v1`, motion keys `xjp.motion-keys.v1` (linear / Catmull-Rom, segments, 2.5D camera, motion blur) and the easing engine.
- CLIs: `motion-render`, `motion-encode`, `motion-compare`, `motion-fit`, `motion-presets`. `playwright-core` and `pngjs` are optional peers; `ffmpeg` is taken from PATH.
- MIT licence.
