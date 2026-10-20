/**
 * Family 6: device frames. A phone, a laptop and a browser window around the screen as the shot's own HTML (or one of the site's pictures; never a page capture, owner 2026-10-19),
 * scroll-through on sparse eased keyframes, tap ripples, notifications that drop in, and a WhatsApp-style chat conversation.
 */
import { clamp, css, ff, h, isCjk, lazy, lerp, mix, rgba, root, seg, theme, type CommonOpts, type Component, type Theme } from "./core.js";
import { along, motions, prog, type Ease, type MotionTable } from "./easing.js";

export type DeviceVariant = "phone" | "laptop" | "browser" | "chat";

export interface ScrollKey { at: number; y: number; dur?: number }
export interface Tap { at: number; x: number; y: number }
export interface Note { at: number; app?: string; title: string; body?: string; hold_ms?: number }
export interface ChatMsg { at: number; from: "me" | "them"; text: string }

export interface DeviceOpts extends CommonOpts {
  variant?: DeviceVariant;
  /** one of the site's pictures for the screen: "/assets/img1.jpg" (shown at the screen's width, scrolled by `scroll`); never a page capture */
  src?: string;
  /** the screen's content as HTML (the shot's own UI, rebuilt from the page's elements: the default) */
  screen?: string;
  /** browser: the address shown in the bar */
  url?: string;
  /** scroll moves: at `at` ms the screen scrolls to `y` px over `dur` ms (default 900, sine in-out); sparse keys, never per frame */
  scroll?: ScrollKey[];
  /** taps in screen px (0,0 = the screen's top-left) */
  taps?: Tap[];
  notifications?: Note[];
  /** chat: the conversation; "me" messages are typed into the input bar first, "them" messages show a typing indicator first */
  messages?: ChatMsg[];
  /** chat: the contact's name in the header (default "LaunchReel") */
  name?: string;
  /** chat colours: "brand" (default) or "whatsapp" (the classic greens) */
  chatPalette?: "brand" | "whatsapp";
  /** device centre and scale (stage px) */
  x?: number;
  y?: number;
  scale?: number;
  /** rotateY in degrees for depth (default 0) */
  tilt?: number;
  /** the device's own chrome words (chat "online" / "typing…" / "Message", a notification's "now"): "zh" or "en";
   *  default "zh" when the messages, notifications or name are Chinese */
  lang?: "en" | "zh";
  /** "rise" (default): the device rises into place at start_ms; "none": already in place */
  enter?: "rise" | "none";
}

interface Frame { outer: HTMLElement; screen: HTMLElement; sw: number; sh: number; topInset: number }

function phoneFrame(th: Theme): Frame {
  const W = 430, H = 900, b = 14;
  const outer = h("div", { position: "relative", width: W, height: H, borderRadius: 68, background: "linear-gradient(145deg, #2A2D34, #0E0F12 40%, #1C1E23)", boxShadow: `${th.shadow}, inset 0 0 0 2px rgba(255,255,255,0.08)` });
  const screen = h("div", { position: "absolute", left: b, top: b, width: W - 2 * b, height: H - 2 * b, borderRadius: 54, overflow: "hidden", background: th.stage === "dark" ? "#0E1015" : "#FFFFFF" });
  const island = h("div", { position: "absolute", left: "50%", top: b + 12, width: 122, height: 36, marginLeft: -61, borderRadius: 20, background: "#000", zIndex: 5 });
  outer.append(screen, island);
  return { outer, screen, sw: W - 2 * b, sh: H - 2 * b, topInset: 58 };
}

function laptopFrame(th: Theme): Frame {
  const SW = 1280, SH = 800, b = 22;
  const outer = h("div", { position: "relative", width: SW + 2 * b, height: SH + 2 * b + 34 });
  const lid = h("div", { position: "absolute", left: 0, top: 0, width: SW + 2 * b, height: SH + 2 * b, borderRadius: 28, background: "#0D0E11", boxShadow: `${th.shadow}, inset 0 0 0 2px #2B2E35` });
  const screen = h("div", { position: "absolute", left: b, top: b, width: SW, height: SH, borderRadius: 8, overflow: "hidden", background: th.stage === "dark" ? "#0E1015" : "#FFFFFF" });
  const base = h("div", { position: "absolute", left: -110, right: -110, top: SH + 2 * b - 2, height: 30, borderRadius: "4px 4px 22px 22px", background: th.stage === "dark" ? "linear-gradient(#3A3D45, #1D1F24)" : "linear-gradient(#E4E5E9, #B9BBC2)" });
  const notch = h("div", { position: "absolute", left: "50%", top: 0, width: 200, height: 10, marginLeft: -100, borderRadius: "0 0 10px 10px", background: th.stage === "dark" ? "#16171B" : "#A7A9B0" });
  base.append(notch);
  lid.append(screen);
  outer.append(lid, base);
  return { outer, screen, sw: SW, sh: SH, topInset: 0 };
}

function browserFrame(th: Theme, url: string): Frame {
  const W = 1440, H = 860, bar = 58;
  const outer = h("div", { position: "relative", width: W, height: H, borderRadius: 18, overflow: "hidden", background: th.surface, border: `1px solid ${th.line}`, boxShadow: th.shadow });
  const top = h("div", { position: "absolute", left: 0, right: 0, top: 0, height: bar, display: "flex", alignItems: "center", gap: 10, padding: "0 22px", background: th.surface2, borderBottom: `1px solid ${th.line}`, boxSizing: "border-box" });
  for (const c of ["#FF5F57", "#FEBC2E", "#28C840"]) top.append(h("span", { width: 14, height: 14, borderRadius: 99, background: c, flex: "none" }));
  const field = h("div", { flex: "0 1 640px", margin: "0 auto", height: 36, borderRadius: 10, background: th.stage === "dark" ? mix(th.surface2, "#000000", 0.25) : "#FFFFFF", border: `1px solid ${th.line}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: ff(th.body), fontSize: 19, color: th.muted }, url);
  top.append(field, h("span", { width: 66, flex: "none" }));
  const screen = h("div", { position: "absolute", left: 0, top: bar, width: W, height: H - bar, overflow: "hidden", background: th.stage === "dark" ? "#0E1015" : "#FFFFFF" });
  outer.append(top, screen);
  return { outer, screen, sw: W, sh: H - bar, topInset: 0 };
}

const FRAME: MotionTable = {
  "device.in": { ease: "out-quart", doc: "the device rising 90 px and growing from 0.96x as it enters" },
  "tap.approach": { ease: "out-cubic", doc: "the finger dot shrinking onto the tap point" },
  "tap.ring": { ease: "out-cubic", doc: "the ring spreading from the tap" },
  "note.drop": { ease: { spring: [1.82, 0.84] }, doc: "a notification dropping in from the top with a small overshoot" },
  "note.up": { ease: "in-cubic", doc: "the notification sliding back up after its hold" },
};
const SCROLL: MotionTable = { scroll: { ease: "in-out-sine", doc: "the screen scrolling to each scroll key over its dur" } };
/** the named moves of each variant and their default curves (opts.ease overrides any of them by name) */
export const DEVICE_MOTIONS: Record<DeviceVariant, MotionTable> = {
  phone: { ...FRAME, ...SCROLL },
  laptop: { ...FRAME, ...SCROLL },
  browser: { ...FRAME, ...SCROLL },
  chat: {
    ...FRAME,
    "chat.scroll": { ease: "out-quint", doc: "the thread scrolling up as each message or typing bubble arrives (360 ms)" },
    "bubble.pop": { ease: { spring: [2.22, 0.82] }, doc: "each message bubble popping in from 0.7x" },
  },
};

/** the screen's scroll at ms: hold, then ease to each key's y over its dur (curve `e`, default in-out-sine) */
export function scrollAt(keys: ScrollKey[] | undefined, ms: number, e: Ease = "in-out-sine"): number {
  if (!keys?.length) return 0;
  const ks = [...keys].sort((a, b) => a.at - b.at);
  let y = 0;
  for (const k of ks) {
    const d = k.dur ?? 900;
    if (ms < k.at) break;
    y = lerp(y, k.y, along(e, ms, k.at, k.at + d));
    if (ms < k.at + d) return y;
    y = k.y;
  }
  return y;
}

const CHROME = {
  en: { online: "online", typing: "typing…", message: "Message", now: "now" },
  zh: { online: "在线", typing: "对方正在输入…", message: "输入消息", now: "现在" },
};
/** the chrome words for the device: o.lang, else Chinese when the content is Chinese */
export function chromeWords(o: DeviceOpts): (typeof CHROME)["en"] {
  const text = [o.name ?? "", ...(o.messages ?? []).map((m) => m.text), ...(o.notifications ?? []).map((n) => `${n.title} ${n.body ?? ""}`)].join(" ");
  return CHROME[o.lang ?? (isCjk(text) ? "zh" : "en")];
}

export function device(host: HTMLElement, o: DeviceOpts): Component {
  const v: DeviceVariant = o.variant ?? "phone";
  const th = theme(o);
  const el = root(host, th, o, `device-${v}`);
  const M = motions(DEVICE_MOTIONS[v], o.ease, `device.${v}`);
  const start = o.start_ms ?? 300;
  const F = v === "laptop" ? laptopFrame(th) : v === "browser" ? browserFrame(th, o.url ?? "launchreel.ai") : phoneFrame(th);
  const sc = o.scale ?? (v === "laptop" ? 0.98 : v === "browser" ? 1 : 1);
  const X = o.x ?? 960, Y = o.y ?? 540;
  const holder = h("div", { position: "absolute", left: X, top: Y, perspective: "2400px" });
  css(F.outer, { transform: "translate(-50%, -50%)" });
  holder.append(F.outer);
  el.append(holder);

  const scroller = h("div", { position: "absolute", left: 0, top: 0, width: F.sw, willChange: "transform" });
  if (v !== "chat") {
    if (o.src) {
      const img = h("img", { display: "block", width: F.sw, height: "auto", paddingTop: F.topInset, background: "inherit" }) as HTMLImageElement;
      img.src = o.src;
      scroller.append(img);
    } else if (o.screen) {
      const s = h("div", { width: F.sw, minHeight: F.sh, paddingTop: F.topInset, boxSizing: "border-box" });
      s.innerHTML = o.screen;
      scroller.append(s);
    } else scroller.append(placeholderUi(th, F));
    F.screen.append(scroller);
  }

  // chat UI
  let chatSeek: ((ms: number) => void) | null = null;
  let lastAt = 0;
  if (v === "chat") ({ seek: chatSeek, last: lastAt } = chatUi(th, F, o, M));

  // taps
  const tapEls = (o.taps ?? []).map((t) => {
    const ring = h("div", { position: "absolute", left: t.x - 70, top: t.y - 70, width: 140, height: 140, borderRadius: 999, background: rgba(th.stage === "dark" ? "#FFFFFF" : th.brand, 0.28), opacity: 0, zIndex: 8 });
    const dot = h("div", { position: "absolute", left: t.x - 26, top: t.y - 26, width: 52, height: 52, borderRadius: 999, background: "rgba(255,255,255,0.55)", border: "2px solid rgba(255,255,255,0.9)", boxShadow: "0 6px 18px rgba(0,0,0,0.25)", boxSizing: "border-box", opacity: 0, zIndex: 9 });
    F.screen.append(ring, dot);
    return { t, ring, dot };
  });

  // notifications
  const phoneLike = v === "phone" || v === "chat";
  const noteEls = (o.notifications ?? []).map((n) => {
    const w = phoneLike ? F.sw - 24 : 440;
    const card = h("div", { position: "absolute", left: phoneLike ? 12 : F.sw - w - 20, top: 0, width: w, boxSizing: "border-box", display: "flex", gap: 14, padding: "16px 18px", borderRadius: phoneLike ? 26 : 16, background: th.stage === "dark" ? "rgba(48,50,58,0.92)" : "rgba(250,250,252,0.94)", boxShadow: "0 16px 40px rgba(0,0,0,0.22)", zIndex: 10, fontFamily: ff(th.body), color: th.ink });
    const appIcon = h("div", { width: 46, height: 46, borderRadius: 12, background: th.brand, color: th.brandInk, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: ff(th.display), fontSize: 22, flex: "none" }, (n.app ?? "L").slice(0, 1).toUpperCase());
    const txt = h("div", { flex: "1 1 auto", minWidth: 0 });
    const head = h("div", { display: "flex", justifyContent: "space-between", fontSize: 16, color: th.muted, marginBottom: 2 }, h("span", {}, (n.app ?? "LaunchReel").toUpperCase()), h("span", {}, chromeWords(o).now));
    txt.append(head, h("div", { fontFamily: ff(th.display), fontSize: 21, lineHeight: 1.25 }, n.title));
    if (n.body) txt.append(h("div", { fontSize: 19, lineHeight: 1.3, color: th.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, n.body));
    card.append(appIcon, txt);
    F.screen.append(card);
    return { n, card };
  });

  const ends = [start + 900, ...(o.scroll ?? []).map((k) => k.at + (k.dur ?? 900)), ...(o.taps ?? []).map((t) => t.at + 600), ...(o.notifications ?? []).map((n) => n.at + (n.hold_ms ?? 2200) + 400), lastAt + 600];
  const duration = Math.round(Math.max(...ends) + 1200);

  function seek(ms: number): void {
    const enter = o.enter === "none" ? 1 : along(M["device.in"], ms, start - 300, start + 600);
    css(holder, { opacity: o.enter === "none" ? 1 : clamp(enter * 1.5).toFixed(3), transform: `translateY(${lerp(90, 0, enter).toFixed(2)}px) scale(${(sc * lerp(0.96, 1, enter)).toFixed(4)}) rotateY(${(o.tilt ?? 0).toFixed(2)}deg)` });
    if (v !== "chat") css(scroller, { transform: `translateY(${(-scrollAt(o.scroll, ms, M.scroll)).toFixed(2)}px)` });
    else chatSeek!(ms);
    for (const { t, ring, dot } of tapEls) {
      const approach = along(M["tap.approach"], ms, t.at - 260, t.at);
      const leave = seg(ms, t.at + 160, t.at + 420);
      const press = ms >= t.at && ms < t.at + 160 ? 0.84 : lerp(1.25, 1, approach);
      css(dot, { opacity: (approach * (1 - leave) * 0.95).toFixed(3), transform: `scale(${press.toFixed(3)})` });
      const r = seg(ms, t.at, t.at + 520);
      css(ring, { opacity: r > 0 && r < 1 ? (1 - r).toFixed(3) : 0, transform: `scale(${lerp(0.2, 1, prog(M["tap.ring"], r, 520)).toFixed(3)})` });
    }
    for (const { n, card } of noteEls) {
      const k = along(M["note.drop"], ms, n.at, n.at + 550);
      const up = along(M["note.up"], ms, n.at + (n.hold_ms ?? 2200), n.at + (n.hold_ms ?? 2200) + 320);
      const yTop = phoneLike ? 64 : 18;
      css(card, { transform: `translateY(${(lerp(-160, yTop, k) - up * (yTop + 180)).toFixed(2)}px)`, opacity: ms < n.at ? 0 : 1 });
    }
  }
  return { el, duration_ms: duration, seek };
}

function placeholderUi(th: Theme, F: Frame): HTMLElement {
  // a neutral app skeleton when the shot gives no screen: header, a hero block, rows
  const wrap = h("div", { width: F.sw, paddingTop: F.topInset + 18, boxSizing: "border-box", padding: `${F.topInset + 18}px 24px 40px`, display: "flex", flexDirection: "column", gap: 18 });
  const tone = th.stage === "dark" ? "#2A2E3A" : "#EEF0F4";
  wrap.append(h("div", { height: 28, width: "40%", borderRadius: 8, background: tone }));
  wrap.append(h("div", { height: Math.round(F.sw * 0.5), borderRadius: 22, background: `linear-gradient(135deg, ${th.brand}, ${mix(th.brand, "#FFFFFF", 0.35)})` }));
  for (let i = 0; i < 9; i++) {
    const row = h("div", { display: "flex", gap: 16, alignItems: "center" });
    row.append(h("div", { width: 64, height: 64, borderRadius: 16, background: i % 3 === 0 ? mix(th.brand, tone, 0.6) : tone, flex: "none" }));
    const col = h("div", { flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 10 });
    col.append(h("div", { height: 18, width: `${60 + ((i * 17) % 30)}%`, borderRadius: 6, background: tone }), h("div", { height: 14, width: `${40 + ((i * 23) % 35)}%`, borderRadius: 6, background: tone, opacity: 0.7 }));
    row.append(col);
    wrap.append(row);
  }
  return wrap;
}

function chatUi(th: Theme, F: Frame, o: DeviceOpts, M: Record<string, Ease>): { seek: (ms: number) => void; last: number } {
  const wa = o.chatPalette === "whatsapp";
  const dark = th.stage === "dark";
  const P = wa
    ? { head: dark ? "#1F2C34" : "#F7F8FA", wall: dark ? "#0B141A" : "#EFE7DD", me: dark ? "#005C4B" : "#D9FDD3", them: dark ? "#202C33" : "#FFFFFF", ink: dark ? "#E9EDEF" : "#111B21", muted: dark ? "#8696A0" : "#667781", read: "#53BDEB", send: "#00A884" }
    : { head: th.surface, wall: mix(th.bg, th.brand, 0.05), me: mix(th.brand, th.surface, dark ? 0.55 : 0.82), them: th.surface, ink: th.ink, muted: th.muted, read: th.accent, send: th.brand };
  const statusH = F.topInset, headH = 92, inputH = 92;
  const scr = F.screen;
  css(scr, { background: P.wall, fontFamily: ff(th.body), color: P.ink });
  const status = h("div", { position: "absolute", left: 0, right: 0, top: 0, height: statusH, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 36px 0", boxSizing: "border-box", fontFamily: ff(th.display), fontSize: 19, background: P.head, zIndex: 4 }, h("span", {}, "9:41"), h("span", { letterSpacing: "0.1em" }, "●●●"));
  const head = h("div", { position: "absolute", left: 0, right: 0, top: statusH, height: headH, display: "flex", alignItems: "center", gap: 14, padding: "0 20px", boxSizing: "border-box", background: P.head, borderBottom: `1px solid ${rgba(P.ink, 0.08)}`, zIndex: 4 });
  const name = o.name ?? "LaunchReel";
  head.append(h("span", { fontSize: 34, color: wa ? P.send : th.accent, marginRight: 2 }, "‹"), h("div", { width: 52, height: 52, borderRadius: 99, background: th.brand, color: th.brandInk, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: ff(th.display), fontSize: 22, flex: "none" }, name.slice(0, 1).toUpperCase()));
  const who = h("div", { display: "flex", flexDirection: "column" }, h("span", { fontFamily: ff(th.display), fontSize: 27 }, name));
  const W = chromeWords(o);
  const sub = h("span", { fontSize: 17, color: P.muted }, W.online);
  who.append(sub);
  head.append(who);
  const vpTop = statusH + headH, vpH = F.sh - vpTop - inputH;
  const vp = h("div", { position: "absolute", left: 0, right: 0, top: vpTop, height: vpH, overflow: "hidden" });
  const list = h("div", { position: "absolute", left: 0, right: 0, top: 0, padding: "18px 16px", display: "flex", flexDirection: "column", gap: 10, boxSizing: "border-box" });
  vp.append(list);
  const input = h("div", { position: "absolute", left: 0, right: 0, bottom: 0, height: inputH, display: "flex", alignItems: "center", gap: 12, padding: "0 14px 10px", boxSizing: "border-box", background: P.head });
  const field = h("div", { flex: "1 1 auto", height: 56, borderRadius: 28, background: dark ? rgba("#FFFFFF", 0.08) : "#FFFFFF", border: `1px solid ${rgba(P.ink, 0.08)}`, display: "flex", alignItems: "center", padding: "0 20px", fontSize: 22, color: P.muted, overflow: "hidden", whiteSpace: "nowrap" });
  const fieldText = h("span", { color: P.ink });
  const fieldPh = h("span", {}, W.message);
  const fieldCaret = h("span", { display: "inline-block", width: 2, height: 26, background: P.send, marginLeft: 1 });
  field.append(fieldPh, fieldText, fieldCaret);
  const sendBtn = h("div", { width: 56, height: 56, borderRadius: 99, background: P.send, display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF", fontSize: 26, flex: "none" }, "➤");
  input.append(field, sendBtn);
  scr.append(vp, status, head, input);

  const msgs = [...(o.messages ?? [])].sort((a, b) => a.at - b.at);
  const items = msgs.map((m) => {
    const me = m.from === "me";
    const b = h("div", { alignSelf: me ? "flex-end" : "flex-start", maxWidth: "76%", padding: "12px 16px 8px", borderRadius: 20, [me ? "borderTopRightRadius" : "borderTopLeftRadius"]: 6, background: me ? P.me : P.them, color: P.ink, fontSize: 27, lineHeight: 1.3, boxShadow: "0 1px 1px rgba(0,0,0,0.08)", transformOrigin: me ? "100% 0%" : "0% 0%", visibility: "hidden" });
    const meta = h("div", { display: "flex", justifyContent: "flex-end", gap: 6, fontSize: 14, color: P.muted, marginTop: 2 });
    const ticks = h("span", { letterSpacing: "-0.25em", fontSize: 15 }, me ? "✓✓" : "");
    meta.append(h("span", {}, "9:41"), ticks);
    b.append(h("div", {}, m.text), meta);
    list.append(b);
    return { m, b, ticks, me, top: 0, hgt: 0 };
  });
  const typingEl = h("div", { position: "absolute", left: 16, padding: "18px 20px", borderRadius: 20, borderTopLeftRadius: 6, background: P.them, display: "flex", gap: 8, opacity: 0 });
  const dots = [0, 1, 2].map(() => h("span", { width: 11, height: 11, borderRadius: 99, background: P.muted }));
  typingEl.append(...dots);
  list.append(typingEl);
  const TYPE_LEAD = 1100;
  const typeDur = (m: ChatMsg) => Math.min(1500, 220 + Array.from(m.text).length * 42);
  let typingH = 54;
  const layout = lazy(() => {
    for (const it of items) { it.top = it.b.offsetTop; it.hgt = it.b.offsetHeight; }
    typingH = typingEl.offsetHeight || 54;
  });
  // the scroll target after each event, eased over 360 ms
  const target = (bottom: number) => Math.max(0, bottom + 18 - vpH);
  const seek = (ms: number) => {
    layout();
    let scroll = 0, prev = 0;
    const evs: { at: number; to: number }[] = [];
    for (const it of items) {
      if (!it.me) evs.push({ at: it.m.at - TYPE_LEAD, to: target(it.top + typingH) });
      evs.push({ at: it.m.at, to: target(it.top + it.hgt) });
    }
    for (const e of evs) { if (ms < e.at) break; scroll = lerp(prev, e.to, along(M["chat.scroll"], ms, e.at, e.at + 360)); prev = e.to; if (ms < e.at + 360) { prev = scroll; break; } }
    css(list, { transform: `translateY(${(-scroll).toFixed(2)}px)` });
    let typingOn = false;
    let typingText = "";
    let lastKey = -1e9;
    for (const it of items) {
      const shown = ms >= it.m.at;
      const k = along(M["bubble.pop"], ms, it.m.at, it.m.at + 450);
      css(it.b, { visibility: shown ? "visible" : "hidden", opacity: clamp(k * 3).toFixed(3), transform: `scale(${lerp(0.7, 1, k).toFixed(4)}) translateY(${lerp(10, 0, clamp(k)).toFixed(2)}px)` });
      if (it.me) {
        css(it.ticks, { color: ms >= it.m.at + 900 ? P.read : P.muted });
        const d = typeDur(it.m);
        if (ms >= it.m.at - d - 150 && ms < it.m.at) {
          const n = Math.floor(Array.from(it.m.text).length * clamp((ms - (it.m.at - d - 150)) / d));
          typingText = Array.from(it.m.text).slice(0, n).join("");
          lastKey = ms;
        }
      } else if (ms >= it.m.at - TYPE_LEAD && ms < it.m.at) {
        typingOn = true;
        css(typingEl, { top: it.top });
        dots.forEach((dt, i) => css(dt, { transform: `translateY(${(-7 * Math.max(0, Math.sin((ms / 1000) * Math.PI * 2 * 1.5 - i * 0.7))).toFixed(2)}px)`, opacity: 0.55 + 0.45 * Math.max(0, Math.sin((ms / 1000) * Math.PI * 2 * 1.5 - i * 0.7)) }));
      }
    }
    css(typingEl, { opacity: typingOn ? 1 : 0 });
    sub.textContent = typingOn ? W.typing : W.online;
    fieldText.textContent = typingText;
    css(fieldPh, { display: typingText ? "none" : "inline" });
    css(fieldCaret, { opacity: typingText && ms - lastKey < 300 ? 1 : 0 });
    // send press
    const pressed = items.some((it) => it.me && ms >= it.m.at - 60 && ms < it.m.at + 90);
    css(sendBtn, { transform: `scale(${pressed ? 0.86 : 1})` });
  };
  return { seek, last: msgs.length ? msgs[msgs.length - 1].at : 0 };
}
