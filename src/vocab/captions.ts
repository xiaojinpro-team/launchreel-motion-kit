/**
 * Family 3: subtitles and captions synced to narration timestamps. API: lines [{text, start, end}] in ms of the shot (optional per-word
 * timings; without them the words share the line's time by length). Variants: a lower-third bar, a karaoke highlight, word-pop, and
 * classic two-line captions inside the title-safe area.
 */
import { clamp, css, ff, h, isCjk, lazy, lerp, rgba, root, theme, words, type CommonOpts, type Component } from "./core.js";
import { along, motions, type MotionTable } from "./easing.js";

export type CaptionVariant = "lowerThird" | "karaoke" | "wordPop" | "safe";

export interface CaptionWord { text: string; start: number; end: number }
export interface CaptionLine { text: string; start: number; end: number; words?: CaptionWord[] }

export interface CaptionOpts extends CommonOpts {
  variant?: CaptionVariant;
  lines: CaptionLine[];
  /** lowerThird: a short label above the text (a speaker, a step) */
  kicker?: string;
  /** px (default per variant: lowerThird 44, karaoke 58, wordPop 64, safe 46) */
  size?: number;
  /** safe / karaoke / wordPop: characters per caption line before it wraps into two (default 38 Latin, 16 CJK) */
  maxChars?: number;
  /** distance of the caption's baseline block from the bottom edge, px (default 120: inside the 10 % title-safe area) */
  bottom?: number;
}

/** the words of a line with their times: given, or the line's span shared by length */
export function timedWords(l: CaptionLine): CaptionWord[] {
  if (l.words?.length) return l.words;
  const ws = words(l.text);
  const a = l.start + 60, b = Math.max(a + 1, l.end - 180);
  const weight = ws.map((w) => Array.from(w).length + 1.5);
  const total = weight.reduce((x, y) => x + y, 0);
  let t = a;
  return ws.map((w, i) => { const d = ((b - a) * weight[i]) / total; const o = { text: w, start: Math.round(t), end: Math.round(t + d) }; t += d; return o; });
}

/** split a caption into at most two balanced lines when it is longer than maxChars */
export function balance(text: string, maxChars: number): string[] {
  const cjk = isCjk(text);
  const n = Array.from(text).length;
  if (n <= maxChars) return [text];
  if (cjk) {
    // Chinese: cut near the middle of the drawn width (a Latin letter is about half a Chinese character), after a comma when one
    // is close, never inside a Latin word
    const c = Array.from(text);
    const wOf = (ch: string) => (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55);
    const pos: number[] = [0];
    for (const ch of c) pos.push(pos[pos.length - 1] + wOf(ch));
    const half = pos[n] / 2;
    let cut = Math.ceil(n / 2), best = Infinity;
    for (let i = 1; i < n; i++) {
      const after = /[,，、;；:：]/.test(c[i - 1]) ? 0 : /\s/.test(c[i - 1]) ? 1.5 : /[A-Za-z0-9]/.test(c[i - 1]) && /[A-Za-z0-9]/.test(c[i]) ? 99 : 4.5;
      const d = Math.abs(pos[i] - half) + after;
      if (d < best) { best = d; cut = i; }
    }
    return [c.slice(0, cut).join("").trim(), c.slice(cut).join("").trim()];
  }
  const ws = text.split(/\s+/);
  let best = 1, bestD = Infinity;
  for (let i = 1; i < ws.length; i++) { const d = Math.abs(ws.slice(0, i).join(" ").length - ws.slice(i).join(" ").length); if (d < bestD) { bestD = d; best = i; } }
  return [ws.slice(0, best).join(" "), ws.slice(best).join(" ")];
}

const LINE: MotionTable = {
  "line.in": { ease: "out-cubic", doc: "the line rising 16 px and fading in just before it is spoken" },
  "line.out": { ease: "in-quad", doc: "the line fading out after it ends" },
};
/** the named moves of each variant and their default curves (opts.ease overrides any of them by name) */
export const CAPTION_MOTIONS: Record<CaptionVariant, MotionTable> = {
  lowerThird: {
    "plate.in": { ease: "out-quart", doc: "the plate uncovering left to right as the group starts" },
    "plate.out": { ease: "in-cubic", doc: "the plate covering back up after the group ends" },
    "bar.grow": { ease: { spring: [2.5, 1] }, doc: "the accent bar growing up from the bottom" },
    "plate.width": { ease: "out-quint", doc: "the plate's width following the line being spoken" },
    "line.swap.in": { ease: "out-quint", doc: "the next line rising into the plate" },
    "line.swap.out": { ease: "in-quad", doc: "the previous line leaving upward" },
  },
  karaoke: { ...LINE, "word.wipe": { ease: "linear", doc: "the brand colour wiping across each word while it is spoken (follows the voice: keep linear)" } },
  wordPop: { ...LINE, "word.pop": { ease: { spring: [2.38, 0.78] }, doc: "each word popping up from 0.55x as it is spoken, a small overshoot" } },
  safe: {
    "line.in": { ease: "linear", doc: "the line fading in over 120 ms at its start" },
    "line.out": { ease: "linear", doc: "the line fading out over 120 ms at its end" },
  },
};

export function captions(host: HTMLElement, o: CaptionOpts): Component {
  const v: CaptionVariant = o.variant ?? "safe";
  const th = theme(o);
  const el = root(host, th, o, `cap-${v}`);
  const M = motions(CAPTION_MOTIONS[v], o.ease, `captions.${v}`);
  const lines = [...(o.lines ?? [])].sort((a, b) => a.start - b.start);
  const bottom = o.bottom ?? 120;
  const fs = o.size ?? { lowerThird: 52, karaoke: 64, wordPop: 72, safe: 48 }[v];
  const cjk = lines.some((l) => isCjk(l.text));
  const maxChars = o.maxChars ?? (cjk ? 16 : 38);
  const last = lines.length ? lines[lines.length - 1].end : 0;
  const duration = Math.round(last + 500);
  type Built = { line: CaptionLine; node: HTMLElement; ws: { w: CaptionWord; node: HTMLElement }[]; width: number };
  const built: Built[] = [];

  if (v === "lowerThird") {
    // groups of lines that follow each other closely share one plate
    const wrap = h("div", { position: "absolute", left: 140, bottom: bottom + 10, height: fs * 1.9 + (o.kicker ? 40 : 0) });
    const accentBar = h("div", { position: "absolute", left: 0, bottom: 0, width: 10, height: "100%", background: th.accent, borderRadius: 3, transformOrigin: "50% 100%" });
    const plate = h("div", { position: "absolute", left: 22, bottom: 0, height: fs * 1.9, background: rgba(th.surface, 0.94), borderRadius: 10, boxShadow: th.shadow, overflow: "hidden" });
    const kick = o.kicker ? h("div", { position: "absolute", left: 22, bottom: fs * 1.9 + 10, fontFamily: ff(th.display), fontSize: 26, letterSpacing: "0.12em", textTransform: "uppercase", color: th.accent, whiteSpace: "nowrap" }, o.kicker) : null;
    wrap.append(accentBar, plate);
    if (kick) wrap.append(kick);
    for (const line of lines) {
      const node = h("div", { position: "absolute", left: 30, top: 0, height: "100%", display: "flex", alignItems: "center", whiteSpace: "nowrap", fontFamily: ff(th.display), fontSize: fs, color: th.ink, letterSpacing: "-0.01em" }, line.text);
      plate.append(node);
      built.push({ line, node, ws: [], width: 0 });
    }
    el.append(wrap);
    const groups: { from: number; to: number; items: Built[] }[] = [];
    for (const b of built) {
      const g = groups[groups.length - 1];
      if (g && b.line.start - g.to < 300) { g.to = b.line.end; g.items.push(b); } else groups.push({ from: b.line.start, to: b.line.end, items: [b] });
    }
    const layout = lazy(() => { for (const b of built) b.width = b.node.scrollWidth + 60; });
    const seek = (ms: number) => {
      layout();
      const g = groups.find((x) => ms >= x.from - 400 && ms < x.to + 500) ?? null;
      if (!g) { css(wrap, { opacity: 0 }); return; }
      css(wrap, { opacity: 1 });
      const enter = along(M["plate.in"], ms, g.from - 150, g.from + 350);
      const exit = along(M["plate.out"], ms, g.to - 50, g.to + 300);
      const barK = clamp(along(M["bar.grow"], ms, g.from - 250, g.from + 150));
      css(accentBar, { transform: `scaleY(${(barK * (1 - exit)).toFixed(3)})` });
      // width follows the current line
      let cur = g.items[0], prev = g.items[0];
      for (const b of g.items) if (ms >= b.line.start - 120) { prev = cur; cur = b; }
      const wp = along(M["plate.width"], ms, cur.line.start - 120, cur.line.start + 260);
      const width = lerp(prev.width, cur.width, cur === prev ? 1 : wp);
      css(plate, { width, clipPath: `inset(0 ${((1 - enter * (1 - exit)) * 100).toFixed(2)}% 0 0)` });
      if (kick) css(kick, { opacity: enter * (1 - exit), transform: `translateY(${lerp(10, 0, enter)}px)` });
      for (const b of built) {
        if (!g.items.includes(b)) { css(b.node, { opacity: 0 }); continue; }
        const inP = along(M["line.swap.in"], ms, b.line.start - 120, b.line.start + 240);
        const next = g.items[g.items.indexOf(b) + 1];
        const outP = next ? along(M["line.swap.out"], ms, next.line.start - 160, next.line.start + 40) : 0;
        const first = b === g.items[0];
        css(b.node, { opacity: (first ? 1 : inP) * (1 - outP), transform: `translateY(${first ? -outP * 40 : lerp(40, 0, inP) - outP * 40}px)` });
      }
    };
    return { el, duration_ms: duration, seek };
  }

  // karaoke / wordPop / safe: one centred block at the bottom
  const box = h("div", { position: "absolute", left: 0, right: 0, bottom, display: "flex", justifyContent: "center", textAlign: "center" });
  el.append(box);
  for (const line of lines) {
    const node = h("div", { position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "max-content", maxWidth: 1600, fontSize: fs, lineHeight: 1.28 });
    const ws: Built["ws"] = [];
    if (v === "safe") {
      css(node, { fontFamily: ff(th.display), color: th.ink });
      for (const part of balance(line.text, maxChars)) {
        const row = h("div", {});
        row.append(h("span", { background: rgba(th.bg, 0.78), padding: "4px 18px", borderRadius: 8, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }, part));
        node.append(row);
      }
    } else {
      css(node, { fontFamily: ff(th.display), maxWidth: 1500, whiteSpace: "normal", letterSpacing: cjk ? "0" : "-0.01em" });
      const tw = timedWords(line);
      tw.forEach((w, i) => {
        const span = h("span", v === "karaoke"
          ? { display: "inline-block", color: "transparent", backgroundImage: "none", WebkitBackgroundClip: "text", backgroundClip: "text", padding: "0 0.02em" }
          : { display: "inline-block", padding: "0.02em 0.18em", borderRadius: "0.22em", transformOrigin: "50% 80%" }, w.text);
        node.append(span);
        if (!cjk && i < tw.length - 1) node.append(" ");
        ws.push({ w, node: span });
      });
    }
    box.append(node);
    built.push({ line, node, ws, width: 0 });
  }
  const base = rgba(th.ink, 0.38);
  const seek = (ms: number) => {
    for (const b of built) {
      const { start, end } = b.line;
      const vis = ms >= start - 200 && ms < end + 250;
      if (!vis) { css(b.node, { display: "none" }); continue; }
      css(b.node, { display: "block" });
      if (v === "safe") {
        const a = along(M["line.in"], ms, start - 60, start + 60) * (1 - along(M["line.out"], ms, end - 40, end + 80));
        css(b.node, { opacity: a.toFixed(3) });
        continue;
      }
      const inP = along(M["line.in"], ms, start - 180, start + 120);
      const outP = along(M["line.out"], ms, end + 20, end + 220);
      css(b.node, { opacity: (inP * (1 - outP)).toFixed(3), transform: `translateX(-50%) translateY(${lerp(16, 0, inP) - outP * 10}px)` });
      for (const { w, node } of b.ws) {
        if (v === "karaoke") {
          const p = along(M["word.wipe"], ms, w.start, w.end) * 100;
          css(node, { backgroundImage: `linear-gradient(90deg, ${th.accent} ${p.toFixed(2)}%, ${base} ${p.toFixed(2)}%)` });
        } else {
          const k = along(M["word.pop"], ms, w.start - 40, w.start + 380);
          const current = ms >= w.start - 40 && ms < w.end + 60;
          css(node, {
            opacity: clamp(k * 3).toFixed(3), transform: `translateY(${lerp(22, 0, clamp(k)).toFixed(2)}px) scale(${lerp(0.55, 1, k).toFixed(3)})`,
            background: current ? th.brand : "transparent", color: current ? th.brandInk : th.ink,
          });
        }
      }
    }
  };
  return { el, duration_ms: duration, seek };
}
