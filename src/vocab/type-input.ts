/**
 * Family 1: text input typing. A caret types into a field (URL bar, AI prompt box, search pill) with a human rhythm (seeded jitter,
 * longer pauses after spaces), or the text is pasted in; then an autocomplete chip, a submit press and the result flipping in.
 */
import { caretOn, clamp, css, ff, h, hash, lerp, lazy, mix, rgba, rng, root, seg, theme, type CommonOpts, type Component, type Theme } from "./core.js";
import { along, motions, prog, type MotionTable } from "./easing.js";

export type TypeInputVariant = "url" | "prompt" | "search" | "paste";

export interface TypeInputOpts extends CommonOpts {
  variant?: TypeInputVariant;
  /** what is typed (or pasted) */
  text: string;
  /** grey text in the empty field */
  placeholder?: string;
  /** url: the autocompleted address (defaults to text); search: the suggestion rows (the first is picked) */
  complete?: string;
  suggestions?: string[];
  /** what flips in after the submit: a title line, then up to 3 lines */
  result?: string | string[];
  /** one of the site's pictures for the result card instead of lines: "/assets/img1.jpg" (never a page capture) */
  resultSrc?: string;
  /** characters per second (default 15; a person types 8-20) */
  cps?: number;
  /** a mis-type and its fix: at char index `at` the wrong characters are typed, then backspaced. search: on by default; false turns it off */
  mistype?: { at: number; wrong: string } | false;
  /** field centre x and top y in stage px; field width */
  x?: number;
  y?: number;
  width?: number;
  /** chips under the prompt box (attachments, modes) */
  chips?: string[];
  /** scale of the whole field and result (default 1.25: legible on a phone at 720p) */
  scale?: number;
  /** ms after the typing ends before the submit press (default 450) */
  submitDelay_ms?: number;
}

interface KeyEv { at: number; value: string }

const NEAR: Record<string, string> = { a: "s", b: "v", c: "x", d: "s", e: "r", f: "g", g: "f", h: "j", i: "o", j: "k", k: "l", l: "k", m: "n", n: "m", o: "i", p: "o", q: "w", r: "e", s: "a", t: "r", u: "y", v: "b", w: "e", x: "z", y: "t", z: "x" };

/** the keystrokes of a human typing `text` from `start` ms: seeded jitter, a pause after spaces and punctuation, an optional mis-type + fix */
export function typingEvents(text: string, start: number, cps = 15, mistype?: { at: number; wrong: string } | false): { events: KeyEv[]; end: number } {
  const r = rng(hash(text) ^ 0x9e3779b9);
  const base = 1000 / cps;
  const chars = Array.from(text);
  const events: KeyEv[] = [];
  let t = start, cur = "";
  for (let i = 0; i < chars.length; i++) {
    if (mistype && i === mistype.at) {
      for (const w of Array.from(mistype.wrong)) { t += base * (0.6 + r() * 0.5); cur += w; events.push({ at: t, value: cur }); }
      t += 300; // noticing
      for (let k = 0; k < Array.from(mistype.wrong).length; k++) { t += 80; cur = Array.from(cur).slice(0, -1).join(""); events.push({ at: t, value: cur }); }
      t += 110;
    }
    const prev = chars[i - 1] ?? "";
    let d = base * (0.55 + r() * 0.9);
    if (/[\s.,/:-]/.test(prev)) d *= 1.7;
    if (r() < 0.05) d += 180; // a short think
    t += i === 0 ? base * 0.5 : d;
    cur += chars[i];
    events.push({ at: t, value: cur });
  }
  return { events, end: t };
}

export function defaultMistype(text: string): { at: number; wrong: string } | undefined {
  const chars = Array.from(text);
  if (chars.length < 6) return undefined;
  for (let i = Math.floor(chars.length * 0.5); i < chars.length - 1; i++) {
    const c = chars[i].toLowerCase();
    if (NEAR[c]) return { at: i, wrong: NEAR[c] + (NEAR[chars[i + 1]?.toLowerCase()] ? chars[i + 1] : "") };
  }
  return undefined;
}

const valueAt = (ev: KeyEv[], ms: number): { value: string; last: number } => {
  let v = "", last = -1e9;
  for (const e of ev) { if (e.at <= ms) { v = e.value; last = e.at; } else break; }
  return { value: v, last };
};

function keycap(th: Theme, label: string): HTMLElement {
  return h("span", { display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 44, height: 40, padding: "0 12px", borderRadius: 10, border: `1px solid ${th.line}`, borderBottomWidth: 3, background: th.surface2, color: th.ink, fontFamily: ff(th.body), fontSize: 20, boxSizing: "border-box" }, label);
}

const ICON_LOCK = (c: string) => `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
const ICON_SEARCH = (c: string) => `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>`;
const ICON_GLOBE = (c: string) => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/></svg>`;
const ICON_UP = (c: string) => `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>`;
const icon = (html: string, style = {}): HTMLElement => { const s = h("span", { display: "inline-flex", flex: "none", ...style }); s.innerHTML = html; return s; };

const AFTER: MotionTable = {
  "submit.rise": { ease: "out-quint", doc: "after the submit, the field rising out of the way" },
  "card.flip": { ease: { spring: [1.33, 0.88] }, doc: "each result card flipping down into place (110 ms apart)" },
};
const BOX: MotionTable = {
  "send.on": { ease: "linear", doc: "the send button turning to the brand colour at the first key" },
  "send.down": { ease: "out-quad", doc: "the send button pressing down to 0.84x" },
  "send.release": { ease: { spring: [2.38, 0.82] }, doc: "the send button springing back after the press" },
  "ripple": { ease: "out-cubic", doc: "the ring spreading from the send button" },
};
const FIELD: MotionTable = {
  "enter.release": { ease: { spring: [2.5, 1] }, doc: "the field easing back after the Enter press" },
  "drop.open": { ease: "out-cubic", doc: "the dropdown opening under the field" },
  "drop.close": { ease: "in-quad", doc: "the dropdown closing after Enter" },
  "row.highlight": { ease: "out-cubic", doc: "the first suggestion lighting up" },
};
/** the named moves of each variant and their default curves (opts.ease overrides any of them by name; typing keeps its human rhythm) */
export const TYPE_INPUT_MOTIONS: Record<TypeInputVariant, MotionTable> = {
  url: { ...FIELD, "accept.fade": { ease: "linear", doc: "the accepted completion's highlight fading" }, ...AFTER },
  search: { ...FIELD, ...AFTER },
  prompt: { ...BOX, ...AFTER },
  paste: {
    "chip.in": { ease: { spring: [2.22, 0.85] }, doc: "the paste chip popping up above the field" },
    "chip.out": { ease: "linear", doc: "the chip fading after the paste" },
    "paste.highlight": { ease: "out-quad", doc: "the pasted text's highlight fading" },
    ...BOX, ...AFTER,
  },
};

export function typeInput(host: HTMLElement, o: TypeInputOpts): Component {
  const v: TypeInputVariant = o.variant ?? "prompt";
  const th = theme(o);
  const el = root(host, th, o, `type-${v}`);
  const M = motions(TYPE_INPUT_MOTIONS[v], o.ease, `typeInput.${v}`);
  const start = o.start_ms ?? 300;
  const boxy = v === "prompt" || v === "paste";
  const W = o.width ?? (boxy ? 1100 : v === "url" ? 1040 : 900);
  const X = o.x ?? 960;
  const Y = o.y ?? (boxy ? 300 : 360);
  const S = o.scale ?? 1.25;
  const fs = boxy ? 38 : 40;
  const text = o.text ?? "";
  const mis = v === "search" ? (o.mistype === false ? undefined : o.mistype ?? defaultMistype(text)) : o.mistype || undefined;

  // ---- timeline
  let events: KeyEv[], typedEnd: number, pasteAt = -1;
  if (v === "paste") {
    pasteAt = start + 650;
    events = [{ at: pasteAt, value: text }];
    typedEnd = pasteAt;
  } else ({ events, end: typedEnd } = typingEvents(text, start, o.cps ?? 15, mis));
  const complete = o.complete ?? text;
  const suggestions = o.suggestions?.length ? o.suggestions : [complete];
  const chipAt = typedEnd + 160;
  const acceptAt = v === "url" && complete !== text ? chipAt + 420 : -1;
  const pressAt = (acceptAt > 0 ? acceptAt : v === "paste" ? typedEnd + 700 : chipAt) + (o.submitDelay_ms ?? 450);
  const flipAt = pressAt + 220;
  const lines = Array.isArray(o.result) ? o.result : o.result ? [o.result] : [];
  const resultN = o.resultSrc ? 1 : Math.max(lines.length, 0);
  const duration = Math.round(flipAt + 700 + resultN * 110 + 1400);

  // ---- DOM
  const stack = h("div", { position: "absolute", left: X - W / 2, top: Y, width: W, perspective: "1600px", transformOrigin: "50% 0%" });
  const field = h("div", {
    position: "relative", boxSizing: "border-box", width: W, background: th.surface, border: `1px solid ${th.line}`, boxShadow: th.shadow,
    borderRadius: boxy ? 30 : 999, display: "flex", alignItems: boxy ? "stretch" : "center", flexDirection: boxy ? "column" : "row",
    padding: boxy ? "34px 36px 26px" : "0 36px", height: boxy ? 270 : v === "url" ? 96 : 92, gap: boxy ? 0 : 18, transformOrigin: "50% 50%",
  });
  if (v === "url") field.append(icon(ICON_LOCK(th.muted)));
  if (v === "search") field.append(icon(ICON_SEARCH(th.muted)));
  const line = h("div", { position: "relative", flex: boxy ? "1 1 auto" : "1 1 auto", fontFamily: ff(th.body), fontSize: fs, lineHeight: boxy ? 1.32 : 1, whiteSpace: boxy ? "pre-wrap" : "pre", overflow: "hidden", color: th.ink, letterSpacing: "-0.005em" });
  const typed = h("span", {});
  const sel = h("span", { borderRadius: 6 });
  const ghost = h("span", { color: th.muted });
  const caret = h("span", { display: "inline-block", width: 3, height: "1.08em", marginLeft: 2, verticalAlign: "-0.16em", background: th.accent, borderRadius: 2 });
  const ph = h("span", { position: "absolute", left: 0, top: 0, color: th.muted, whiteSpace: "pre" }, o.placeholder ?? "");
  sel.append(typed);
  line.append(ph, sel, caret, ghost);
  field.append(line);

  let send: HTMLElement | null = null, ripple: HTMLElement | null = null;
  if (boxy) {
    const bar = h("div", { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 });
    const chipRow = h("div", { display: "flex", gap: 12 });
    for (const c of o.chips ?? []) chipRow.append(h("span", { padding: "8px 16px", borderRadius: 999, border: `1px solid ${th.line}`, color: th.muted, fontSize: 22, fontFamily: ff(th.body) }, c));
    send = h("div", { position: "relative", width: 68, height: 68, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" });
    send.append(icon(ICON_UP(th.brandInk)));
    ripple = h("div", { position: "absolute", inset: 0, borderRadius: 999, border: `3px solid ${th.accent}`, opacity: 0 });
    send.append(ripple);
    bar.append(chipRow, send);
    field.append(bar);
  }

  // url / search: the dropdown under the field
  const drop = h("div", { position: "absolute", left: 0, top: (v === "url" ? 96 : 92) + 14, width: W, boxSizing: "border-box", background: th.surface, border: `1px solid ${th.line}`, borderRadius: 22, boxShadow: th.shadow, padding: 10, opacity: 0 });
  const rows: { row: HTMLElement; label: HTMLElement; key?: HTMLElement }[] = [];
  if (v === "url") {
    const row = h("div", { display: "flex", alignItems: "center", gap: 18, padding: "16px 20px", borderRadius: 14, fontSize: 30 });
    const label = h("span", { flex: "1 1 auto", fontFamily: ff(th.body) }, complete);
    const key = keycap(th, "Enter");
    row.append(icon(ICON_GLOBE(th.muted)), label, key);
    drop.append(row);
    rows.push({ row, label, key });
  } else if (v === "search") {
    for (const s of suggestions.slice(0, 4)) {
      const row = h("div", { display: "flex", alignItems: "center", gap: 18, padding: "14px 20px", borderRadius: 14, fontSize: 30 });
      const label = h("span", { flex: "1 1 auto" });
      row.append(icon(ICON_SEARCH(th.muted)), label);
      drop.append(row);
      rows.push({ row, label });
    }
  }
  if (v === "url" || v === "search") stack.append(drop);

  // paste: the shortcut keycaps
  const paste = h("div", { position: "absolute", right: 0, top: -70, display: "flex", gap: 8, opacity: 0 });
  if (v === "paste") { paste.append(keycap(th, "⌘"), keycap(th, "V")); stack.append(paste); }

  // the result
  const res = h("div", { position: "absolute", left: 0, width: W, top: boxy ? 300 : (v === "url" ? 96 : 92) + 24, display: "flex", flexDirection: "column", gap: 14, transformStyle: "preserve-3d" });
  const cards: HTMLElement[] = [];
  if (o.resultSrc) {
    const c = h("div", { height: 420, borderRadius: 24, overflow: "hidden", border: `1px solid ${th.line}`, boxShadow: th.shadow, background: th.surface, transformOrigin: "50% 0%" });
    const img = h("img", { width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 0%", display: "block" }) as HTMLImageElement;
    img.src = o.resultSrc;
    c.append(img);
    cards.push(c);
  } else {
    lines.slice(0, 4).forEach((t, i) => {
      const c = h("div", { display: "flex", alignItems: "center", gap: 20, padding: i === 0 ? "30px 34px" : "22px 34px", borderRadius: 22, background: th.surface, border: `1px solid ${th.line}`, boxShadow: th.shadow, transformOrigin: "50% 0%" });
      c.append(h("span", { width: 14, height: 14, borderRadius: 99, background: i === 0 ? th.accent : mix(th.accent, th.surface, 0.5), flex: "none" }));
      c.append(h("span", { fontFamily: ff(i === 0 ? th.display : th.body), fontSize: i === 0 ? 40 : 30, color: i === 0 ? th.ink : th.muted, lineHeight: 1.25 }, t));
      cards.push(c);
    });
  }
  res.append(...cards);
  stack.prepend(field);
  stack.append(res);
  el.append(stack);

  const layout = lazy(() => { /* nothing is measured: the field is fixed-size and the text is clipped */ });

  function seek(ms: number): void {
    layout();
    const { value, last } = valueAt(events, ms);
    typed.textContent = value;
    css(ph, { opacity: value ? 0 : 1 });
    // url: ghost completion while typing, then accepted
    let shown = value;
    if (v === "url") {
      const accepted = acceptAt > 0 && ms >= acceptAt;
      if (accepted) { shown = complete; typed.textContent = complete; }
      css(ghost, { display: !accepted && value.length >= 3 && complete.startsWith(value) && complete !== value ? "inline" : "none" });
      ghost.textContent = complete.slice(value.length);
      const hl = accepted ? 1 - along(M["accept.fade"], ms, acceptAt + 60, acceptAt + 560) : 0;
      css(sel, { background: hl > 0 ? rgba(th.accent, 0.28 * hl) : "transparent" });
    } else css(ghost, { display: "none" });
    if (v === "paste") {
      const hl = ms >= pasteAt ? 1 - along(M["paste.highlight"], ms, pasteAt + 250, pasteAt + 900) : 0;
      css(sel, { background: hl > 0 ? rgba(th.accent, 0.3 * hl) : "transparent" });
      const k = along(M["chip.in"], ms, start + 300, start + 750);
      const out = along(M["chip.out"], ms, pasteAt + 500, pasteAt + 800);
      css(paste, { opacity: clamp(k) * (1 - out), transform: `translateY(${lerp(16, 0, clamp(k))}px) scale(${lerp(0.9, 1, clamp(k))})` });
      const press = ms >= pasteAt - 60 && ms < pasteAt + 60;
      (paste.lastChild as HTMLElement).style.transform = press ? "translateY(2px)" : "none";
    }
    // caret
    const typingLast = v === "paste" ? pasteAt : last;
    const submitted = ms >= pressAt;
    css(caret, { opacity: !submitted && caretOn(ms, typingLast) && ms >= start - 200 ? 1 : 0 });
    // send button colour (muted until there is text)
    if (send) {
      const on = shown ? along(M["send.on"], ms, events[0]?.at ?? 0, (events[0]?.at ?? 0) + 160) : 0;
      const k = along(M["send.release"], ms, pressAt + 90, pressAt + 510);
      const down = ms >= pressAt && ms < pressAt + 90 ? along(M["send.down"], ms, pressAt, pressAt + 90) : 0;
      const sc = ms < pressAt ? 1 : ms < pressAt + 90 ? lerp(1, 0.84, down) : lerp(0.84, 1, k);
      css(send, { background: mix(th.line, th.brand, on), transform: `scale(${sc})` });
      const rp = seg(ms, pressAt + 40, pressAt + 640);
      css(ripple!, { opacity: rp > 0 && rp < 1 ? 0.55 * (1 - rp) : 0, transform: `scale(${lerp(1, 2.3, prog(M.ripple, rp, 600))})` });
    }
    // field press (url / search: Enter)
    if (!boxy) {
      const d = ms >= pressAt ? (ms < pressAt + 80 ? seg(ms, pressAt, pressAt + 80) : 1 - clamp(along(M["enter.release"], ms, pressAt + 80, pressAt + 480))) : 0;
      css(field, { transform: `scale(${1 - 0.015 * d})` });
    }
    // dropdown
    if (v === "url" || v === "search") {
      const openAt = v === "url" ? chipAt : (events.find((e) => Array.from(e.value).length >= 2)?.at ?? chipAt);
      const p = along(M["drop.open"], ms, openAt, openAt + 260);
      const close = along(M["drop.close"], ms, pressAt + 60, pressAt + 260);
      css(drop, { opacity: p * (1 - close), transform: `translateY(${lerp(-10, 0, p)}px)` });
      rows.forEach((r, i) => {
        if (v === "search") {
          const s = suggestions[i];
          const q = value.toLowerCase();
          const n = s.toLowerCase().startsWith(q) ? q.length : 0;
          r.label.innerHTML = "";
          r.label.append(h("span", { fontFamily: ff(th.display) }, s.slice(0, n)), h("span", { color: th.muted }, s.slice(n)));
        }
        const hiAt = v === "url" ? (acceptAt > 0 ? acceptAt : chipAt + 200) : typedEnd + 280;
        const hi = i === 0 ? along(M["row.highlight"], ms, hiAt, hiAt + 200) : 0;
        css(r.row, { background: hi > 0 ? rgba(th.accent, 0.14 * hi) : "transparent" });
        if (r.key) {
          const kd = ms >= pressAt && ms < pressAt + 130;
          css(r.key, { transform: kd ? "translateY(2px)" : "none", background: kd ? th.brand : th.surface2, color: kd ? th.brandInk : th.ink, borderBottomWidth: kd ? 1 : 3 });
        }
      });
    }
    // after the submit: the field rises, the result flips in
    const rise = along(M["submit.rise"], ms, pressAt + 120, pressAt + 820);
    css(field, boxy ? { transform: `translateY(${lerp(0, -150, rise)}px) scale(${lerp(1, 0.94, rise)})`, opacity: lerp(1, 0.55, rise) } : { opacity: lerp(1, 0.9, rise) });
    css(stack, { transform: `translateY(${boxy ? 0 : lerp(0, -120, rise)}px) scale(${S})` });
    css(res, { transform: boxy ? `translateY(${lerp(0, -150, rise)}px)` : "none" });
    cards.forEach((c, i) => {
      const at = flipAt + i * 110;
      const k = along(M["card.flip"], ms, at, at + 750);
      css(c, { opacity: clamp(k * 2.2), transform: `rotateX(${lerp(-82, 0, k)}deg) translateY(${lerp(30, 0, clamp(k))}px)` });
    });
  }
  seek(0);
  return { el, duration_ms: duration, seek };
}
