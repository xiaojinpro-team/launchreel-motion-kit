/**
 * The demo loop of a catalogue entry: the component on its stage, at 1920x1080, as one seekable Component of loop_ms.
 * Used by the compreel pages (played on a clock there) and by the render tests (seeked frame by frame). Not on the film shelf.
 */
import { css, h, mix, theme, type Component } from "./core.js";
import type { CatalogueEntry } from "./catalogue.js";
import { typeInput, type TypeInputOpts } from "./type-input.js";
import { title, type TitleOpts } from "./title.js";
import { captions, type CaptionOpts } from "./captions.js";
import { logo, endCard, type LogoOpts } from "./logo.js";
import { transition, transitionSpan, type TransitionOpts } from "./transition.js";
import { device, type DeviceOpts } from "./device.js";
import { data, type DataOpts } from "./data.js";
import { timeline, type TimelineOpts } from "./timeline.js";
import { energy, type EnergyOpts } from "./energy.js";
import { diagram, type DiagramOpts } from "./diagram.js";

const FONTS = { en: { display: "Inter-Bold", body: "Inter-Regular" }, zh: { display: "NotoSansSC-Bold", body: "NotoSansSC-Regular" } };

/** the options the demo plays in a locale: the entry's opts, the Chinese overrides for "zh", the locale's font stems */
export function demoOpts(entry: CatalogueEntry, loc: "en" | "zh" = "en"): Record<string, unknown> {
  const { stage, brand } = entry.demo;
  return { brand, stage, ...FONTS[loc], ...entry.demo.opts, ...(loc === "zh" ? entry.demo.opts_zh ?? {} : {}) };
}

/** the demo's own dressing text (a transition's two mock shots) in a locale */
export function demoScene(entry: CatalogueEntry, loc: "en" | "zh" = "en"): Record<string, string> {
  return (loc === "zh" ? entry.demo.scene_zh : entry.demo.scene) ?? entry.demo.scene ?? {};
}

export function demo(host: HTMLElement, entry: CatalogueEntry, loc: "en" | "zh" = "en"): Component {
  const { stage, brand, loop_ms } = entry.demo;
  const th = theme({ stage, brand });
  css(host, { position: "relative", width: 1920, height: 1080, overflow: "hidden", background: th.bg });
  const o = demoOpts(entry, loc);
  const scene = demoScene(entry, loc);
  let c: Component;
  switch (entry.factory) {
    case "typeInput": c = typeInput(host, o as unknown as TypeInputOpts); break;
    case "title": c = title(host, o as unknown as TitleOpts); break;
    case "captions": c = captionScene(host, o as unknown as CaptionOpts, th.bg, th.stage); break;
    case "logo": c = logo(host, o as unknown as LogoOpts); break;
    case "endCard": c = endCard(host, o as unknown as LogoOpts); break;
    case "transition": c = transitionScene(host, o as unknown as TransitionOpts, loop_ms, scene); break;
    case "device": c = device(host, o as unknown as DeviceOpts); break;
    case "data": c = data(host, o as unknown as DataOpts); break;
    case "timeline": c = timeline(host, o as unknown as TimelineOpts); break;
    case "energy": c = energy(host, o as unknown as EnergyOpts); break;
    case "diagram": c = diagram(host, o as unknown as DiagramOpts); break;
  }
  return { el: host, duration_ms: loop_ms, seek: (ms) => c.seek(ms) };
}

/** captions sit over a picture: a calm product-like backdrop so the plate and the safe area read */
function captionScene(host: HTMLElement, o: CaptionOpts, bg: string, stage: "light" | "dark"): Component {
  const tone = stage === "dark" ? mix(bg, "#FFFFFF", 0.06) : mix(bg, "#000000", 0.05);
  const back = h("div", { position: "absolute", left: 260, top: 120, width: 1400, height: 700, borderRadius: 28, background: tone, border: `1px solid ${mix(tone, stage === "dark" ? "#FFFFFF" : "#000000", 0.08)}` });
  for (let i = 0; i < 4; i++) back.append(h("div", { position: "absolute", left: 60, top: 70 + i * 120, width: [620, 460, 540, 380][i], height: i === 0 ? 56 : 26, borderRadius: 10, background: mix(tone, stage === "dark" ? "#FFFFFF" : "#000000", i === 0 ? 0.14 : 0.08) }));
  back.append(h("div", { position: "absolute", right: 60, top: 70, width: 520, height: 420, borderRadius: 22, background: `linear-gradient(140deg, ${o.brand ?? "#6B5BFF"}, ${mix(o.brand ?? "#6B5BFF", "#FFFFFF", 0.4)})`, opacity: 0.85 }));
  host.append(back);
  return captions(host, o);
}

/** two mock shots joined by the transition: A until the cut at half the loop, then B */
function transitionScene(host: HTMLElement, o: TransitionOpts, loop: number, scene: Record<string, string>): Component {
  const th = theme(o);
  const cut = loop / 2;
  const dur = transitionSpan(o);
  const A = h("div", { position: "absolute", inset: 0, background: th.bg });
  const B = h("div", { position: "absolute", inset: 0, background: mix(th.bg, th.brand, 0.16) });
  // shot A: a dashboard with one card (the zoom target)
  const t = o.target ?? { x: 700, y: 430, w: 520, h: 220 };
  const aContent = h("div", { position: "absolute", inset: 0 });
  aContent.append(h("div", { position: "absolute", left: 160, top: 150, fontFamily: `"${o.display ?? "Inter-Bold"}"`, fontSize: 64, color: th.ink, letterSpacing: "-0.02em" }, scene.head ?? "Six shots planned"));
  [[160, 430], [1240, 430]].forEach(([x, y]) => aContent.append(h("div", { position: "absolute", left: x, top: y, width: 520, height: 220, borderRadius: 24, background: th.surface, border: `1px solid ${th.line}` })));
  const card = h("div", { position: "absolute", left: t.x, top: t.y, width: t.w, height: t.h, borderRadius: 24, background: th.brand, color: th.brandInk, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: `"${o.display ?? "Inter-Bold"}"`, fontSize: 44, boxShadow: th.shadow }, scene.card ?? "Shot 3");
  aContent.append(card);
  A.append(aContent);
  // shot B: the title of the next chapter
  const bContent = h("div", { position: "absolute", inset: 0, background: mix(th.bg, th.brand, 0.16) });
  B.append(bContent);
  host.append(B, A);
  const v = o.variant ?? "wipe";
  const shared = { ...o, variant: v, dur_ms: dur, ...(v === "zoomThrough" ? { target: t, fill: th.brand } : {}) };
  const outT = transition(A, { ...shared, phase: "out", at_ms: cut - dur, content: aContent });
  const bTitle = title(bContent, { ...o, variant: "rise", text: scene.next ?? "Shot 3: the film", size: "chapter", start_ms: 120 });
  const inT = transition(B, { ...shared, phase: "in", at_ms: 0, content: bContent });
  return {
    el: host, duration_ms: loop,
    seek(ms) {
      const inA = ms < cut;
      css(A, { display: inA ? "block" : "none" });
      css(B, { display: inA ? "none" : "block" });
      if (inA) outT.seek(ms);
      else { inT.seek(ms - cut); bTitle.seek(ms - cut); }
    },
  };
}
