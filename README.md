# @launchreel/motion-kit

41 finished, seekable motion components for launch films, plus the headless renderer that photographs them frame by frame.

- **Typing, kinetic titles, captions, logo reveals, transitions, device frames, data reveals, timelines, energy builds, diagrams.** Each one is a plain function: `component(host, options)` returns `{ el, duration_ms, seek(ms) }`.
- **Pure and deterministic.** `seek(ms)` has no clock, no `requestAnimationFrame` and seeded jitter, so the same millisecond always gives the same pixels. Render any frame, in any order, on any machine.
- **Brand-driven.** One brand colour and a light or dark stage drive every colour; sizes follow a fixed type scale.
- **No runtime dependencies.** TypeScript types included. `playwright-core` and `pngjs` are optional peers for the render and compare CLIs; `ffmpeg` is taken from `PATH`.

Made by [LaunchReel](https://launchreel.ai/?utm_source=npm), which turns a product URL into a launch video. This is the motion vocabulary its engine draws from. Every component, with a live loop, its parameters and when to use it: **[compreel.com/motion](https://compreel.com/motion/)**.

## See it move

| Component | Live demo |
| --- | --- |
| Typing a URL into an input | [compreel.com/motion/type-input/url](https://compreel.com/motion/type-input/url/) |
| Kinetic title, word by word | [compreel.com/motion/title/rise](https://compreel.com/motion/title/rise/) |
| Logo assembling | [compreel.com/motion/logo/assemble](https://compreel.com/motion/logo/assemble/) |

Finished films made with this vocabulary: [launchreel.ai/examples](https://launchreel.ai/examples?utm_source=npm).

## Install

```sh
npm install @launchreel/motion-kit
```

## Use it

```js
import { title } from "@launchreel/motion-kit/vocab";

const stage = document.querySelector("#stage");           // a 1920x1080 box
const t = title(stage, {
  variant: "rise", text: "Ship the video\nwith the release",
  accent: "video", brand: "#e8543a", stage: "dark",
});
const slider = document.querySelector("#scrub");          // <input type="range" max="3100">
slider.oninput = () => t.seek(Number(slider.value));      // pure: any ms, any order
console.log(t.duration_ms);
```

Prefer a script tag? `@launchreel/motion-kit/motion-vocab.js` is one classic script that defines the global `MV` (`MV.title(...)`, `MV.typeInput(...)`, ...). The machine-readable catalogue (name, intent tags, duration range, inputs, when to use) is `@launchreel/motion-kit/catalogue.json`.

## Render to video

```sh
npm install playwright-core pngjs
npx motion-render --html index.html --spec keys.json --fps 24 --range 0-57 --out frames/
npx motion-encode --dir frames/ --out out.mp4 --fps 24
```

Pages implement a tiny frame protocol (`window.__meta`, `window.__load`, `window.__frame(t)`); `definePage` installs it. Motion keys (`xjp.motion-keys.v1`) support linear and Catmull-Rom interpolation, eased segments, a 2.5D camera and motion blur. See [CHANGELOG.md](CHANGELOG.md) and the type definitions for the full surface.

## Exports

| Import | What |
| --- | --- |
| `@launchreel/motion-kit` | frame protocol, motion keys, player, easing, fitting (browser-safe) |
| `@launchreel/motion-kit/vocab` | the 41 components and their catalogue |
| `@launchreel/motion-kit/node` | render, compare, encode (Node) |
| `@launchreel/motion-kit/motion-vocab.js` | the vocabulary as one classic script (global `MV`) |

## Links

- LaunchReel: <https://launchreel.ai/?utm_source=npm>
- Component gallery: <https://compreel.com/motion/>
- Motion studies: <https://github.com/xiaojinpro-team/compreel-motion-studies>

Paste a product URL at [launchreel.ai](https://launchreel.ai/?utm_source=npm) and get a launch video.

MIT licence.

---

## 中文

**@launchreel/motion-kit** 是 41 个可逐帧定位的动效组件，专为产品发布片准备：文字输入打字、大标题动效、字幕、Logo 出场、转场、设备外框、数据展示、时间线、能量汇聚和图解。外加一个无头渲染器，把页面按帧拍成视频。

- **纯函数、结果确定。** `seek(ms)` 不依赖时钟和 `requestAnimationFrame`，同一毫秒永远得到同样的画面，可以任意顺序、任意机器逐帧渲染。
- **品牌色驱动。** 一个品牌色加明暗舞台决定全部配色，字号遵循固定字阶。
- **无运行时依赖。** 自带 TypeScript 类型；渲染和对比命令行需要可选的 `playwright-core` 与 `pngjs`，`ffmpeg` 从 PATH 取。

由 [LaunchReel](https://launchreel.ai/zh?utm_source=npm) 出品：贴一个产品链接，自动生成发布视频。这里是它的引擎所用的动效词汇表。每个组件的实时循环演示、参数和适用场景见 **[compreel.com/zh/motion](https://compreel.com/zh/motion/)**。

演示：[输入网址打字](https://compreel.com/zh/motion/type-input/url/)，[标题逐词升起](https://compreel.com/zh/motion/title/rise/)，[Logo 组装](https://compreel.com/zh/motion/logo/assemble/)。

安装与用法见上文英文部分，代码示例相同。贴上产品链接，拿到发布视频：[launchreel.ai](https://launchreel.ai/zh?utm_source=npm)。

MIT 许可证。
