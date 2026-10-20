/**
 * The motion catalogue (xjp.motion-catalogue.v1): one entry per component variant, read by the LaunchReel desk (skill reference
 * motion-catalogue.md is generated from it) and by compreel (one page per entry). Pure data + a validator; no DOM.
 * Demo copy follows the house rules: the product in demos is LaunchReel, short plain sentences, no price, plan, trial or currency words.
 * Batch 2 entries also list their named moves (the curve each move uses by default; opts.ease retunes any of them), and the document
 * carries the ease library (EASES) the desk calls by name.
 */
import { DATA_MOTIONS } from "./data.js";
import { DIAGRAM_MOTIONS } from "./diagram.js";
import { EASES, cssEase, easeIssue, easeSpec, type Ease, type EasePreset, type MotionTable } from "./easing.js";
import { ENERGY_MOTIONS } from "./energy.js";
import { TIMELINE_MOTIONS } from "./timeline.js";
import { CAPTION_MOTIONS } from "./captions.js";
import { DEVICE_MOTIONS } from "./device.js";
import { LOGO_MOTIONS } from "./logo.js";
import { TITLE_MOTIONS } from "./title.js";
import { TRANSITION_MOTIONS } from "./transition.js";
import { TYPE_INPUT_MOTIONS } from "./type-input.js";

export const MOTION_CATALOGUE_SCHEMA = "xjp.motion-catalogue.v1";
export const INTENTS = ["hook", "feature", "proof", "end-card", "transition"] as const;
export type Intent = (typeof INTENTS)[number];
export const FAMILIES = ["type-input", "title", "captions", "logo", "transition", "device", "data", "timeline", "energy", "diagram"] as const;
export type Family = (typeof FAMILIES)[number];
export type L10n = { en: string; zh: string };

export interface Input { name: string; type: string; required?: boolean; default?: string; doc: string; /** the doc in Chinese (the zh page) */ doc_zh?: string }

export interface CatalogueEntry {
  /** "<family>.<variant>" */
  id: string;
  family: Family;
  /** the MV factory: MV.<factory>(host, opts) */
  factory: "typeInput" | "title" | "captions" | "logo" | "endCard" | "transition" | "device" | "data" | "timeline" | "energy" | "diagram";
  variant: string;
  name: L10n;
  summary: L10n;
  intent: Intent[];
  /** the natural length range of the component, ms */
  duration_ms: [number, number];
  inputs: Input[];
  when: L10n;
  rationale: L10n;
  /** do-not-use-with notes */
  avoid: L10n[];
  /** the component's named moves and their default curves (retune any with opts.ease: {"<name>": <ease>}) */
  motions?: Move[];
  /** what the demo loop plays (also the render test's input) */
  demo: {
    stage: "light" | "dark"; brand: string; loop_ms: number; opts: Record<string, unknown>;
    /** the zh page's demo: these keys replace opts' (Chinese on-screen words; the fonts become NotoSansSC) */
    opts_zh?: Record<string, unknown>;
    /** the demo's own dressing words (a transition's two mock shots), and their Chinese */
    scene?: Record<string, string>;
    scene_zh?: Record<string, string>;
  };
}

export interface Move { name: string; ease: Ease; doc: L10n }
export interface EaseDoc { name: EasePreset; ease: unknown; css: string | null; doc: string }

export interface FamilyInfo { id: Family; factory: string; name: L10n; lede: L10n; inputs: Input[] }

const COMMON: Input[] = [
  { name: "brand", type: "hex", default: "#6B5BFF", doc: "the site's brand colour; the component derives its accent (>= 3:1 on the stage), surfaces and ink from it" },
  { name: "stage", type: '"dark" | "light"', default: '"dark"', doc: "the stage the component sits on" },
  { name: "display", type: "font stem", default: '"Inter-Bold"', doc: "headline stem; name it in the call so the runtime loads it" },
  { name: "body", type: "font stem", default: '"Inter-Regular"', doc: "UI / body stem; name it in the call so the runtime loads it" },
  { name: "start_ms", type: "ms", default: "300", doc: "when the component starts, ms into the shot" },
  { name: "background", type: "boolean", default: "false", doc: "draw the stage background (off: transparent over the shot's own stage)" },
  { name: "place", type: "{x, y, w, h, z?}", doc: "the component's place in the shot's layout: it fits its 1920x1080 composition into this stage rect (centred, aspect kept); z orders components front to back. Default: the whole stage" },
];
/** batch 2 families are built on the spatial layer and named moves: these two inputs come with them */
const SPATIAL: Input[] = [
  { name: "ease", type: '{"<move>": ease}', doc: 'retune any named move (see the entry\'s moves): a preset name ("out-expo"), a cubic-bezier [x1, y1, x2, y2], {spring: [hz, damping]} or {trapezoid: [accel, decel]}. A wrong move name or curve throws, it never falls back. A move measured from a reference clip (the replica workbench\'s measure/*.json, frame-keyed) becomes a curve without conversion: MV.fitEase(doc, "x", {from: 133, to: 142}) or `motion-fit <file> --measure x --from 133 --to 142 --ease`' },
  { name: "camera", type: "{focal?, x?, y?, z?}", doc: "the scene's camera: pan x / y and push z as numbers or keyframes [[ms, value, ease?], ...]; objects at different depths move differently (real parallax). focal default 1800" },
];

export const FAMILY_INFO: FamilyInfo[] = [
  {
    id: "type-input", factory: "typeInput", name: { en: "Text input typing", zh: "文字输入动画" },
    lede: { en: "A caret types into a real-looking field with a human rhythm, then the submit press and the result flipping in.", zh: "光标以真人节奏在输入框里打字,然后按下提交、结果翻入。" },
    inputs: [
      { name: "text", type: "string", required: true, doc: "what is typed (or pasted)" },
      { name: "placeholder", type: "string", doc: "grey text in the empty field" },
      { name: "result", type: "string | string[]", doc: "what flips in after the submit: a title line, then up to 3 lines" },
      { name: "resultSrc", type: '"/assets/<screen>.jpg"', doc: "a real screen as the result card instead of lines" },
      { name: "cps", type: "number", default: "15", doc: "characters per second (a person types 8-20)" },
      { name: "mistype", type: "{at, wrong} | false", doc: "a typo and its fix at char index `at`" },
      { name: "x / y / width", type: "px", doc: "field centre x, top y, width" },
      SPATIAL[0],
      ...COMMON,
    ],
  },
  {
    id: "title", factory: "title", name: { en: "Big title kinetic type", zh: "大标题动画" },
    lede: { en: "Headline type that moves with intent: rise, mask, weight, split-flap and outline-to-fill, on the look sheets' type scale.", zh: "有意图的大标题:逐词升起、遮罩揭示、字重变化、翻牌、描边转填充,字号取自 look 的字阶。" },
    inputs: [
      { name: "text", type: "string", required: true, doc: 'the title; "\\n" breaks lines' },
      { name: "accent", type: "string", doc: "a word of the text drawn in the brand colour" },
      { name: "size", type: '"super" | "chapter" | "ui" | px', default: '"super"', doc: "type scale: super 144, chapter 64, ui 40 (px at 1080p); wide lines are fitted to maxWidth" },
      { name: "align", type: '"center" | "left"', default: '"center"', doc: "alignment and anchor" },
      { name: "x / y / maxWidth", type: "px", doc: "anchor and the widest a line may be (default 1600)" },
      SPATIAL[0],
      ...COMMON,
    ],
  },
  {
    id: "captions", factory: "captions", name: { en: "Subtitles and captions", zh: "字幕动画" },
    lede: { en: "Captions synced to the narration's timestamps: lines with start and end in ms, words timed by length when not given.", zh: "与旁白时间戳同步的字幕:每行给 start/end(毫秒),不给逐词时间时按字长分配。" },
    inputs: [
      { name: "lines", type: "[{text, start, end, words?}]", required: true, doc: "caption lines in ms of the shot; optional words [{text, start, end}]" },
      { name: "kicker", type: "string", doc: "lowerThird: a short label above the text" },
      { name: "size", type: "px", doc: "type size (default per variant, 48-72)" },
      { name: "maxChars", type: "number", default: "38 / 16 CJK", doc: "wrap into two balanced lines past this" },
      { name: "bottom", type: "px", default: "120", doc: "distance from the bottom edge (inside the title-safe area)" },
      SPATIAL[0],
      ...COMMON,
    ],
  },
  {
    id: "logo", factory: "logo", name: { en: "Logo reveals", zh: "Logo 出场" },
    lede: { en: "The product's mark and wordmark arriving with one clear idea each, and an end card that pairs the logo with one line and one action.", zh: "产品标志与字标的出场方式,每种只做一个清楚的想法;另有结尾卡:Logo + 一句话 + 一个行动按钮。" },
    inputs: [
      { name: "wordmark", type: "string", doc: "the product name" },
      { name: "mark", type: "{parts: [{d, fill?}], box?} | false", doc: "the mark as SVG path parts in a 100-unit box; omitted = the default reel mark in the brand colour" },
      { name: "markSize", type: "px", default: "168", doc: "mark height; the wordmark is 0.72 of it" },
      { name: "line / cta", type: "string", doc: "endCard: the one line and the button label (a product action, never a price or a trial)" },
      { name: "x / y", type: "px", doc: "lockup centre" },
      SPATIAL[0],
      ...COMMON,
    ],
  },
  {
    id: "transition", factory: "transition", name: { en: "Transitions between shots", zh: "转场" },
    lede: { en: "A cut in two halves with the same options: phase out at the end of the leaving shot, phase in at the start of the entering one; the speed peaks at the cut.", zh: "一个转场分两半、参数相同:离开镜头末尾 phase out,进入镜头开头 phase in,速度在剪切点最快。" },
    inputs: [
      { name: "phase", type: '"out" | "in"', required: true, doc: "out at the end of the leaving shot, in at the start of the entering shot" },
      { name: "at_ms", type: "ms", doc: "out: shot length minus dur_ms; in: 0" },
      { name: "dur_ms", type: "ms", doc: "one half (wipe 420, zoomThrough 560, flip 460, sweep 480)" },
      { name: "dir", type: '"left" | "right" | "up" | "down"', default: '"left"', doc: "where things travel" },
      { name: "content", type: "element | selector", doc: "zoomThrough / flip: the shot's main wrapper that moves" },
      { name: "target", type: "{x, y, w, h}", doc: "zoomThrough: the UI element the camera goes through, stage px" },
      SPATIAL[0],
      ...COMMON,
    ],
  },
  {
    id: "device", factory: "device", name: { en: "Device frames", zh: "设备框" },
    lede: { en: "Phone, laptop and browser frames around the product's screen rebuilt as HTML (or one of its own pictures), eased scroll-through, taps, notifications and a chat conversation.", zh: "手机、笔记本、浏览器框:屏幕里是用 HTML 重建的产品界面(或它自己的图片),缓动滚动、点击涟漪、通知下落,以及聊天对话。" },
    inputs: [
      { name: "src", type: '"/assets/<picture>.jpg"', doc: "one of the site's own pictures (a photo, a poster), shown at the frame's width; never a page capture (owner 2026-10-19: rebuild it as `screen`)" },
      { name: "screen", type: "html string", doc: "the screen as the shot's own HTML: the page's elements rebuilt (the default)" },
      { name: "scroll", type: "[{at, y, dur?}]", doc: "sparse scroll moves (sine in-out, default 900 ms)" },
      { name: "taps", type: "[{at, x, y}]", doc: "taps in screen px" },
      { name: "notifications", type: "[{at, app?, title, body?, hold_ms?}]", doc: "banners that drop in" },
      { name: "messages", type: '[{at, from: "me"|"them", text}]', doc: "chat: the conversation" },
      { name: "url / name / chatPalette", type: "string", doc: 'browser address; chat contact name; "brand" or "whatsapp"' },
      { name: "x / y / scale / tilt / enter", type: "px / deg", doc: 'placement; tilt = rotateY; enter "rise" | "none"' },
      { name: "lang", type: '"en" | "zh"', doc: 'the device chrome words ("online", "Message", "now"); default "zh" when the content is Chinese' },
      SPATIAL[0],
      ...COMMON,
    ],
  },
  {
    id: "data", factory: "data", name: { en: "Data reveals", zh: "数据揭示" },
    lede: { en: "Numbers that land: a counter that slams, tubes that fill to a ratio, racing bars, gauges, a pictogram that counts up and a curve that draws.", zh: "让数字落地:砸下的计数器、灌到倍数的管子、赛跑的条形、仪表、数出来的图标阵和画出来的曲线。" },
    inputs: [
      { name: "value / from / decimals / unit", type: "number / string", doc: "counter: the number it lands on, where it starts, its decimals, the unit after it" },
      { name: "label", type: "string", doc: "counter: a short line above the number; bars / curve: the chart's title" },
      { name: "items", type: "[{label, value, display?}]", doc: "tubes (2-4) / bars (2-5): the values; display replaces the landed number" },
      { name: "ratio / max / highlight", type: "string | false / number / index", doc: 'tubes: the ratio slammed on the last tube (default "×last/first"); the full scale; bars: the hero bar' },
      { name: "gauges", type: "[{label, value 0..1, zone?}]", doc: "gauges: 1-3 dials; the needle swings to value, zone is the target arc" },
      { name: "one / many / icon", type: "{label} / {label, count} / icon", doc: 'pictogram: the one unit, the many (up to 400) and the unit icon ("box", "page", "drop", "clock", "can", "dot")' },
      { name: "series / xLabel / yLabel", type: "[{label, values[], highlight?}]", doc: "curve: 1-3 series; a shorter series stops early with its end pin" },
      { name: "motion_ms", type: "ms", doc: "the main motion's length (roll, fill, grow, count, draw)" },
      ...SPATIAL,
      ...COMMON,
    ],
  },
  {
    id: "timeline", factory: "timeline", name: { en: "Timelines and milestones", zh: "时间线与里程碑" },
    lede: { en: "Progress you can watch: a ball hopping up steps, a ball travelling a road past milestones, a lane of hurdles lighting one by one.", zh: "看得见的进度:小球跳上台阶、小球沿路走过里程碑、跑道上的栏一个个亮起。" },
    inputs: [
      { name: "steps", type: "[{label, value?}]", doc: "steps: 2-6 steps, low to high; value pops on landing, the last one slams" },
      { name: "milestones / goal", type: "[{date, label}] / boolean", doc: "roadmap: 3-6 milestones; goal blooms the last one (default true)" },
      { name: "items / clear", type: "string[] / boolean", doc: "hurdles: 3-5 labels; clear: the ball hops each one (done) instead of waiting (to do)" },
      { name: "step_ms", type: "ms", doc: "one beat: hop + dwell, move + dwell, hurdle to hurdle" },
      ...SPATIAL,
      ...COMMON,
    ],
  },
  {
    id: "energy", factory: "energy", name: { en: "Energy builds", zh: "能量与粒子" },
    lede: { en: "Light that builds: a ring that ignites and keeps flowing, parts pulled together into one, a pulse that powers a chain node by node.", zh: "积聚起来的光:点亮后一直流动的光环、被挤到一起合成一个的粒子、一节节点亮链条的能量脉冲。" },
    inputs: [
      { name: "text / radius / tilt", type: "string / px / ratio", doc: "ring: the line in its centre after it lights; its half width (560) and tilt (0.34)" },
      { name: "items / result", type: "string[] / string", doc: "converge: 3-6 parts that come together and what they become" },
      { name: "nodes", type: "[{label, icon?}]", doc: 'flow: 3-5 nodes in order; icon "page", "chat", "play", "check", "bolt", "gear", "box", "dot"' },
      { name: "step_ms", type: "ms", doc: "flow: node to node; converge: the hold before the pull" },
      ...SPATIAL,
      ...COMMON,
    ],
  },
  {
    id: "diagram", factory: "diagram", name: { en: "Diagram builds", zh: "图解" },
    lede: { en: "Explanations that build: callouts on a real screen, a checklist that ticks itself, a hub that its sources feed.", zh: "一步步搭起来的讲解:真实页面上的标注、自己打勾的清单、被各个来源喂数据的中枢。" },
    inputs: [
      { name: "src / points", type: '"/assets/<screen>.jpg" / [{x, y, label}]', doc: "callouts: the screen and 2-5 points (x, y in 0..1 of the screen)" },
      { name: "items / title / stamp", type: '[{text, mark?: "yes"|"no"|"note", sub?}] / string / string', doc: "checklist: 2-5 rows, a heading, a stamp slammed on at the end" },
      { name: "hub / nodes / from", type: "string / string[] / index", doc: "network: the hub, 3-8 nodes and the node whose packets pave its spoke" },
      { name: "step_ms", type: "ms", doc: "one beat between two callouts or two rows" },
      ...SPATIAL,
      ...COMMON,
    ],
  },
];

/** the Chinese of every input doc ("<family>:<name>", or "<name>" for the common ones) */
const DOC_ZH: Record<string, string> = {
  brand: "网站的品牌色;组件由它推出强调色(在舞台上对比度 ≥ 3:1)、面板色和文字色",
  stage: "组件所在的舞台:深色或浅色",
  display: "标题字体;在调用里写出它的名字,运行时才会加载",
  body: "界面 / 正文字体;在调用里写出它的名字,运行时才会加载",
  start_ms: "组件开始的时间,镜头内的毫秒数",
  background: "画出舞台背景(关闭时透明,叠在镜头自己的背景上)",
  place: "组件在镜头布局里的位置:把它 1920x1080 的构图缩放进这个舞台矩形(居中、保持比例);z 决定组件之间的前后。默认整个舞台",
  ease: "重调任一具名动作(见本条的动作表):预设名(\"out-expo\")、三次贝塞尔 [x1, y1, x2, y2]、{spring: [频率, 阻尼]} 或 {trapezoid: [加速, 减速]}。动作名或曲线写错会直接报错,绝不悄悄退回默认。参考片里量出来的动作(复刻工作台 measure/*.json,按帧号存)不用手工转换:MV.fitEase(doc, \"x\", {from: 133, to: 142}) 或 motion-fit <文件> --measure x --from 133 --to 142 --ease 直接得到曲线",
  camera: "场景相机:平移 x / y、推进 z,可写数字或关键帧 [[毫秒, 值, 缓动?], ...];不同深度的物体移动量不同(真实视差)。焦距默认 1800",
  "type-input:text": "要打出(或粘贴)的文字",
  "type-input:placeholder": "空输入框里的灰色提示字",
  "type-input:result": "提交后翻入的内容:一行标题,再加最多 3 行",
  "type-input:resultSrc": "用一张真实页面截图做结果卡,代替文字行",
  "type-input:cps": "每秒字符数(真人约 8–20;中文输入法约 5–8)",
  "type-input:mistype": "在第 at 个字符处打错再改回",
  "type-input:x / y / width": "输入框中心 x、顶部 y、宽度",
  "title:text": "标题文字;\\n 换行",
  "title:accent": "标题里用品牌色画出的一个词",
  "title:size": "字阶:super 144、chapter 64、ui 40(1080p 像素);过宽的行缩到 maxWidth",
  "title:align": "对齐方式与锚点",
  "title:x / y / maxWidth": "锚点位置,以及一行最宽多少(默认 1600)",
  "captions:lines": "字幕行,时间是镜头内毫秒;可选逐词时间 words [{text, start, end}]",
  "captions:kicker": "lowerThird:文字上方的短标签",
  "captions:size": "字号(默认按变体 48–72)",
  "captions:maxChars": "超过这个字数就拆成两行均衡的字幕",
  "captions:bottom": "离底边的距离(在标题安全区内)",
  "logo:wordmark": "产品名",
  "logo:mark": "标志的 SVG 路径(100 单位方框);不填就用品牌色的默认胶片标志",
  "logo:markSize": "标志高度;字标是它的 0.72 倍",
  "logo:line / cta": "endCard:那一句话和按钮文字;按钮只写产品动作,例如「开始做片」",
  "logo:x / y": "整组标志的中心",
  "transition:phase": "out 用在离开镜头的末尾,in 用在进入镜头的开头",
  "transition:at_ms": "out:镜头时长减 dur_ms;in:0",
  "transition:dur_ms": "半个转场的时长(wipe 420、zoomThrough 560、flip 460、sweep 480)",
  "transition:dir": "画面移动的方向",
  "transition:content": "zoomThrough / flip:镜头里会动的主容器",
  "transition:target": "zoomThrough:镜头穿过的那个界面元素,舞台像素",
  "device:src": "真实页面截图,按设备屏幕宽度显示",
  "device:screen": "或者用镜头自己的 HTML 当屏幕内容",
  "device:scroll": "稀疏的滚动动作(正弦缓入缓出,默认 900 毫秒)",
  "device:taps": "点击位置,屏幕像素",
  "device:notifications": "从顶部落下的通知横幅",
  "device:messages": "chat:对话内容",
  "device:url / name / chatPalette": "浏览器地址;聊天联系人名字;配色 \"brand\" 或 \"whatsapp\"",
  "device:x / y / scale / tilt / enter": "位置与缩放;tilt 是 rotateY;enter 为 \"rise\" 或 \"none\"",
  "data:value / from / decimals / unit": "counter:落定的数字、起始值、小数位、数字后的单位",
  "data:label": "counter:数字上方的一句短话;bars / curve:图表标题",
  "data:items": "tubes(2–4)/ bars(2–5):各项数值;display 替换落定后显示的数字",
  "data:ratio / max / highlight": "tubes:砸在最后一根管顶的倍数(默认 ×末项/首项);满刻度;bars:主角那一条",
  "data:gauges": "gauges:1–3 个表盘;指针摆到 value,zone 是目标弧段",
  "data:one / many / icon": "pictogram:左边的一个、右边的许多(最多 400)和单位图标",
  "data:series / xLabel / yLabel": "curve:1–3 条曲线;短的那条提前停住并标出终点",
  "data:motion_ms": "主运动的时长(滚动、灌注、生长、计数、描线)",
  "timeline:steps": "steps:2–6 级台阶,由低到高;落上去时弹出 value,最后一级砸下",
  "timeline:milestones / goal": "roadmap:3–6 个里程碑;goal 让最后一个绽开光(默认开)",
  "timeline:items / clear": "hurdles:3–5 个标签;clear 时小球依次跳过(已完成),否则在起点等着(待完成)",
  "timeline:step_ms": "一拍的时长:跳跃+停留、移动+停留、栏到栏",
  "energy:text / radius / tilt": "ring:点亮后环中央的一句话;环的半宽(560)和倾斜(0.34)",
  "energy:items / result": "converge:3–6 个合到一起的部分,以及合成的结果",
  "energy:nodes": "flow:按顺序的 3–5 个节点,可选图标",
  "energy:step_ms": "flow:节点到节点的间隔;converge:被挤压前的停留",
  "diagram:src / points": "callouts:页面截图和 2–5 个标注点(x、y 是截图内 0..1 的位置)",
  "diagram:items / title / stamp": "checklist:2–5 行、标题、最后砸下的印章",
  "diagram:hub / nodes / from": "network:中枢、3–8 个节点,以及数据包沿连线铺路的那个节点",
  "diagram:step_ms": "两个标注或两行之间的间隔",
  "device:lang": "设备界面自带的字(在线、输入消息、现在);内容是中文时默认中文",
};
for (const f of FAMILY_INFO) for (const i of f.inputs) i.doc_zh = DOC_ZH[`${f.id}:${i.name}`] ?? DOC_ZH[i.name];

const L = (en: string, zh: string): L10n => ({ en, zh });
const BRAND = "#6B5BFF";

type Def = Omit<CatalogueEntry, "id" | "inputs">;
const e = (d: Def): CatalogueEntry => ({ id: `${d.family}.${d.variant}`, ...d, inputs: FAMILY_INFO.find((f) => f.id === d.family)!.inputs });

const NO_TYPING_TWICE = L("another typing component on screen at the same time (one caret per frame)", "同一画面再放一个打字组件(每帧只能有一个光标)");
const NO_LONG = L("a line longer than about 60 characters (it reads as a wall of text at 720p)", "超过约 60 个字符的文字(手机 720p 上像一堵墙)");
const NO_TRANSITION_IN = L("the runtime's transition_in on the same cut (two transitions fight)", "同一个剪切点再声明 transition_in(两个转场打架)");
const NO_SECOND_TITLE = L("a second kinetic title in the same shot", "同一镜头再放第二个动态大标题");

export const CATALOGUE: CatalogueEntry[] = [
  // ---- 1 text input typing
  e({ family: "type-input", factory: "typeInput", variant: "url", name: L("URL bar typing", "网址栏输入"), summary: L("A URL is typed into an address bar, autocompletes, Enter is pressed and the site flips in.", "在地址栏输入网址、自动补全、按回车,网站翻入。"),
    intent: ["hook", "feature"], duration_ms: [3200, 5200],
    when: L("The hook of a tool that starts from a link: the viewer sees the one input the product needs.", "从一个链接开始工作的工具做开场:让观众看到产品只需要这一个输入。"),
    rationale: L("Typing is the most legible action on a phone; the autocomplete chip proves the product knows where you are going.", "打字是手机上最好读的动作;补全提示说明产品知道你要去哪。"),
    avoid: [NO_TYPING_TWICE, L("a real customer URL you were not given (only the brief's own domain)", "未提供的客户网址(只能用 brief 里的域名)")],
    demo: { stage: "dark", brand: BRAND, loop_ms: 6000, opts: { variant: "url", text: "launchre", complete: "launchreel.ai", result: ["LaunchReel", "Paste a link. Get a launch film."] } } }),
  e({ family: "type-input", factory: "typeInput", variant: "prompt", name: L("AI prompt box", "AI 提示词输入框"), summary: L("A prompt is typed with a human rhythm, the send button lights up and is pressed, the answer cards flip in.", "以真人节奏输入提示词,发送键亮起并按下,答案卡片翻入。"),
    intent: ["hook", "feature"], duration_ms: [4500, 8000],
    when: L("An AI product's core moment: the ask and the first answer, in one continuous shot.", "AI 产品的核心时刻:提问与第一个回答,一镜到底。"),
    rationale: L("The send press and the flip are the cause and the effect in under a second, so the result reads as earned.", "按下发送与结果翻入在一秒内构成因果,结果显得是挣来的。"),
    avoid: [NO_TYPING_TWICE, NO_LONG],
    demo: { stage: "light", brand: BRAND, loop_ms: 8000, opts: { variant: "prompt", text: "Make a launch film for my product page", chips: ["16:9", "English"], result: ["Your film plan is ready", "Six shots. One idea per shot.", "Real screens from your site."] } } }),
  e({ family: "type-input", factory: "typeInput", variant: "search", name: L("Search with typo and fix", "搜索框:打错再改"), summary: L("A search pill: the query is typed with one typo that is noticed and fixed, suggestions follow, the first one is picked.", "搜索框:输入中打错一个字母、发现、删掉改正,下拉建议出现并选中第一条。"),
    intent: ["hook", "feature"], duration_ms: [4000, 7000],
    when: L("Search-first products, or a hook that shows the viewer's own question being asked.", "以搜索为入口的产品,或用观众自己的问题做开场。"),
    rationale: L("One honest typo makes the hand feel human and holds the eye on the field a beat longer.", "一个真实的打错让手显得像人,也让视线在输入框多停一拍。"),
    avoid: [NO_TYPING_TWICE, L("more than one typo (a second one reads as a joke)", "超过一个打错(第二个就成了笑料)")],
    demo: { stage: "dark", brand: "#2F9E6E", loop_ms: 7000, opts: { variant: "search", text: "launch film template", suggestions: ["launch film template", "launch film for apps", "launch film music"], result: ["Launch film templates", "Pick a look. Add your screens."] } } }),
  e({ family: "type-input", factory: "typeInput", variant: "paste", name: L("Paste-in", "粘贴输入"), summary: L("⌘V lands the whole text at once with a selection flash, then the send press and the result.", "⌘V 一次落下整段文字并闪一下选区,然后发送、出结果。"),
    intent: ["hook", "feature"], duration_ms: [3000, 5000],
    when: L("When the input is long (a paragraph, a document, a link) and typing it would waste the viewer's time.", "输入很长(一段话、一篇文档、一个链接)时,逐字打会浪费观众时间。"),
    rationale: L("A paste is faster than typing and still shows the input; the flash says the text arrived.", "粘贴比打字快,又仍然展示了输入;选区闪一下说明文字到了。"),
    avoid: [NO_TYPING_TWICE, NO_LONG],
    demo: { stage: "dark", brand: "#E0563B", loop_ms: 6000, opts: { variant: "paste", text: "LaunchReel turns a product page into a launch film.", result: ["Script ready", "Six shots planned"] } } }),

  // ---- 2 big title kinetic
  e({ family: "title", factory: "title", variant: "rise", name: L("Word-by-word rise", "逐词升起"), summary: L("Each word rises out of its own mask on an expo-out curve, 75 ms apart.", "每个词从自己的遮罩里以 expo-out 曲线升起,间隔 75 毫秒。"),
    intent: ["hook", "feature", "end-card"], duration_ms: [2400, 3600],
    when: L("The thesis line: the hook's promise or a chapter title that must read at once.", "论点句:开场承诺或必须一眼读懂的章节标题。"),
    rationale: L("Reading order and motion order are the same, so the eye is led, never chased.", "阅读顺序就是运动顺序,视线被带着走而不是被追着跑。"),
    avoid: [NO_SECOND_TITLE, NO_LONG],
    demo: { stage: "dark", brand: BRAND, loop_ms: 6000, opts: { variant: "rise", text: "Your product,\nin motion.", accent: "motion" } } }),
  e({ family: "title", factory: "title", variant: "mask", name: L("Line mask reveal", "整行遮罩揭示"), summary: L("Each line is revealed left to right behind a brand bar that leads the edge, then retracts.", "每行由左到右揭示,品牌色竖条领着边缘走,再收回。"),
    intent: ["hook", "feature"], duration_ms: [2400, 3400],
    when: L("Two short parallel lines (a cause and its result); the bar ties the type to the brand.", "两句短的并列句(原因与结果);竖条把文字和品牌连在一起。"),
    rationale: L("A single moving edge is calmer than many moving words and suits a confident tone.", "一条移动的边比很多移动的词更沉稳,适合自信的语气。"),
    avoid: [NO_SECOND_TITLE, L("centre alignment with lines of very different length (the bars start at different x)", "居中且两行长度相差很大(竖条起点不齐)")],
    demo: { stage: "light", brand: BRAND, loop_ms: 6000, opts: { variant: "mask", text: "Paste a link.\nGet a film.", accent: "film" } } }),
  e({ family: "title", factory: "title", variant: "weight", name: L("Weight and width morph", "字重与字宽变化"), summary: L("Letters go from regular to bold from the centre out while the tracking closes in: the word gets heavier as it lands.", "字母从中心向外由常规变粗,同时字距收紧:词在落定时变重。"),
    intent: ["hook", "end-card"], duration_ms: [2000, 3200],
    when: L("A one- to three-word statement that should feel like it gains weight: a slogan, the product name.", "一到三个词的宣言,要有加重的感觉:口号、产品名。"),
    rationale: L("Weight is emphasis; animating it shows emphasis being added instead of shouting with scale.", "字重就是强调;让它变化是在展示加重,而不是靠放大去喊。"),
    avoid: [NO_SECOND_TITLE, L("long lines (more than 20 letters: the per-letter cross-fade turns busy)", "长句(超过 20 个字母时逐字渐变显得乱)")],
    demo: { stage: "dark", brand: BRAND, loop_ms: 6000, opts: { variant: "weight", text: "Make it move", accent: "move" } } }),
  e({ family: "title", factory: "title", variant: "flap", name: L("Split-flap board", "翻牌字"), summary: L("Tiles flip through letters and settle left to right, like a departures board.", "字块翻过一串字母,从左到右依次停下,像机场航班牌。"),
    intent: ["hook", "proof"], duration_ms: [2400, 3800],
    when: L("A label, a status or a short number that changes: launch day, a version, a count stated in the brief.", "会变化的标签、状态或短数字:发布日、版本号、brief 中写明的数量。"),
    rationale: L("The flapping says the value is live and arriving; the settle is the payoff.", "翻动说明数值是实时的、正在到来;停下就是落点。"),
    avoid: [NO_SECOND_TITLE, L("a figure nobody stated (only numbers from the brief or the site)", "没人说过的数字(只能用 brief 或网站里的数字)")],
    demo: { stage: "dark", brand: "#F2A03D", loop_ms: 6000, opts: { variant: "flap", text: "LAUNCH DAY", size: 120 } } }),
  e({ family: "title", factory: "title", variant: "outline", name: L("Outline to fill", "描边转填充"), summary: L("The outline of the type draws on in the brand colour, then the fill floods in from the left.", "文字轮廓以品牌色描出,然后填色从左侧灌满。"),
    intent: ["hook", "end-card"], duration_ms: [2600, 3800],
    when: L("The product name or a one-word idea that deserves a beat of construction before it is complete.", "产品名或一个词的想法,值得在完成前有一拍构建过程。"),
    rationale: L("Drawing then filling is the design process in miniature: idea, then substance.", "先描后填是设计过程的缩影:先有想法,再有实体。"),
    avoid: [NO_SECOND_TITLE, L("thin or light stems (the outline needs a bold display face)", "细字重(描边需要粗的展示字体)")],
    demo: { stage: "light", brand: "#E0563B", loop_ms: 6000, opts: { variant: "outline", text: "LaunchReel", size: 168 } } }),

  // ---- 3 captions
  e({ family: "captions", factory: "captions", variant: "lowerThird", name: L("Lower-third bar", "下三分之一字条"), summary: L("A brand bar grows, a plate slides out of it with the text; the plate resizes between lines and collapses at the end.", "品牌色竖条长出,字板从中滑出带出文字;换行时字板变宽变窄,结束时收回。"),
    intent: ["feature", "proof"], duration_ms: [2000, 12000],
    when: L("Naming a step, a speaker or a feature while the picture keeps playing.", "在画面继续播放时标注一个步骤、说话人或功能。"),
    rationale: L("Anchored bottom-left, it never covers the product UI in the centre.", "固定在左下,永远不挡中间的产品界面。"),
    avoid: [L("another caption style in the same shot", "同一镜头再用另一种字幕样式"), L("a device frame whose screen reaches the bottom-left corner", "屏幕延伸到左下角的设备框")],
    demo: { stage: "dark", brand: BRAND, loop_ms: 8000, opts: { variant: "lowerThird", kicker: "How it works", lines: [{ text: "Paste your product page", start: 300, end: 2400 }, { text: "LaunchReel reads every screen", start: 2500, end: 4600 }, { text: "You get a film plan", start: 4700, end: 6600 }] } } }),
  e({ family: "captions", factory: "captions", variant: "karaoke", name: L("Karaoke highlight", "卡拉 OK 高亮"), summary: L("The whole line is shown dim and each word fills with the brand colour as it is spoken.", "整行先以暗色显示,每个词被念到时填上品牌色。"),
    intent: ["hook", "feature"], duration_ms: [2000, 12000],
    when: L("A narrated film watched muted: the viewer reads along at the speaker's pace.", "有旁白但多半静音观看的片子:观众按说话人的速度跟读。"),
    rationale: L("The fill marks the spoken word without moving the type, so reading is never disturbed.", "填色标出正在念的词而不移动文字,阅读不被打断。"),
    avoid: [L("lines without narration (the highlight then has no clock)", "没有旁白的行(高亮就没有节拍)"), NO_LONG],
    demo: { stage: "dark", brand: BRAND, loop_ms: 8000, opts: { variant: "karaoke", lines: [{ text: "Paste a link and LaunchReel writes the script.", start: 300, end: 3600 }, { text: "Then it draws every shot in motion.", start: 3800, end: 6800 }] } } }),
  e({ family: "captions", factory: "captions", variant: "wordPop", name: L("Word pop", "逐词弹出"), summary: L("Words pop in one by one on a spring; the word being spoken sits on a brand pill.", "词随弹簧逐个弹出;正在念的词落在品牌色胶囊上。"),
    intent: ["hook"], duration_ms: [1500, 8000],
    when: L("Short punchy narration in the first seconds, social-feed style.", "开头几秒短促有力的旁白,社交信息流风格。"),
    rationale: L("Each word is an event, which keeps attention in the hook; too tiring for a whole film.", "每个词都是一个事件,开场能抓住注意力;整片都用会累。"),
    avoid: [L("use for more than about 8 s of a film", "在一部片子里用超过约 8 秒"), L("a kinetic title on screen at the same time", "同时出现动态大标题")],
    demo: { stage: "dark", brand: "#E0563B", loop_ms: 6000, opts: { variant: "wordPop", lines: [{ text: "Every screen tells the story", start: 300, end: 2700 }, { text: "One idea per shot", start: 3000, end: 5200 }] } } }),
  e({ family: "captions", factory: "captions", variant: "safe", name: L("Two-line safe-area captions", "安全区双行字幕"), summary: L("Classic captions: at most two balanced lines on a soft plate, inside the 10 % title-safe area, short fades.", "经典字幕:最多两行平衡换行,柔和底板,位于 10% 标题安全区内,短淡入淡出。"),
    intent: ["feature", "proof"], duration_ms: [2000, 60000],
    when: L("Narration that runs over product footage for a long stretch; the quietest option.", "长时间覆盖在产品画面上的旁白;最安静的选择。"),
    rationale: L("Captions should be read, not watched: no motion beyond a 120 ms fade.", "字幕是用来读的不是用来看的:除了 120 毫秒淡入淡出没有任何运动。"),
    avoid: [L("text near the bottom edge of the shot (the plate covers it)", "镜头底部边缘的文字(底板会盖住)")],
    demo: { stage: "light", brand: BRAND, loop_ms: 8000, opts: { variant: "safe", lines: [{ text: "LaunchReel reads your product page and plans six shots.", start: 300, end: 3600 }, { text: "Each shot shows one real screen from your site.", start: 3800, end: 7200 }] } } }),

  // ---- 4 logo reveals
  e({ family: "logo", factory: "logo", variant: "draw", name: L("Wordmark draw-on", "字标描绘"), summary: L("The mark's outlines and the wordmark's letters draw on in the brand colour, then fill.", "标志轮廓与字标笔画以品牌色描出,然后填色。"),
    intent: ["hook", "end-card"], duration_ms: [2800, 3800],
    when: L("A crafted, precise brand (design tools, developer tools); an opening or a closing.", "讲究精确的品牌(设计工具、开发者工具);开场或结尾。"),
    rationale: L("Line before fill shows care in the making, which is the message of a precise brand.", "先线后面展示了制作上的用心,这正是精确型品牌要说的话。"),
    avoid: [L("a raster logo (it needs SVG path parts)", "位图 Logo(需要 SVG 路径)"), L("a busy background behind the thin first strokes", "细线描绘阶段背后是繁杂背景")],
    demo: { stage: "light", brand: BRAND, loop_ms: 6000, opts: { variant: "draw", wordmark: "LaunchReel" } } }),
  e({ family: "logo", factory: "logo", variant: "assemble", name: L("Mark assembles from parts", "标志由部件组装"), summary: L("The mark's parts fly in from around it and lock together on a soft spring; the wordmark slides out from behind.", "标志的各部件从四周飞入,以柔和弹簧扣合;字标从标志背后滑出。"),
    intent: ["hook", "end-card"], duration_ms: [2400, 3400],
    when: L("A product that combines things (integrations, a platform, a team tool).", "把东西组合在一起的产品(集成、平台、团队工具)。"),
    rationale: L("Assembly is the product's promise acted out by its own mark.", "组装就是产品承诺,由它自己的标志演出来。"),
    avoid: [L("a one-piece mark (it needs at least 3 parts)", "一体式标志(至少需要 3 个部件)")],
    demo: { stage: "dark", brand: BRAND, loop_ms: 6000, opts: { variant: "assemble", wordmark: "LaunchReel" } } }),
  e({ family: "logo", factory: "logo", variant: "glass", name: L("Glass pane slide", "玻璃板滑过"), summary: L("A frosted pane slides in over a blurred lockup, rests, then slides away and leaves the sharp logo behind.", "磨砂玻璃板滑入、盖住模糊的 Logo,停一下,再滑走留下清晰的 Logo。"),
    intent: ["end-card", "hook"], duration_ms: [2600, 3600],
    when: L("A premium or calm brand; works on gradient or photographic stages.", "高级或安静的品牌;在渐变或照片背景上都好用。"),
    rationale: L("The pane is a physical object with an edge and a highlight, so the reveal has depth without a global glow.", "玻璃板是有边缘和高光的实体,揭示有纵深,不靠全局发光。"),
    avoid: [L("another blur effect in the same shot", "同一镜头再用别的模糊效果"), L("a flat background in the exact pane tint (the pane disappears)", "与玻璃同色的纯色背景(玻璃会消失)")],
    demo: { stage: "dark", brand: BRAND, loop_ms: 6000, opts: { variant: "glass", wordmark: "LaunchReel" } } }),
  e({ family: "logo", factory: "logo", variant: "blurUp", name: L("Blur-up with ring pulse", "模糊浮现 + 光环脉冲"), summary: L("The lockup sharpens out of a blur while it grows to size; one ring, then a fainter one, pulses out of the mark.", "Logo 从模糊中变清晰并长到尺寸;一道光环、再一道更淡的从标志扩散出去。"),
    intent: ["end-card", "hook"], duration_ms: [2400, 3200],
    when: L("The default end-card reveal: quick, clean, works for any brand.", "默认的结尾揭示:快、干净,适合任何品牌。"),
    rationale: L("Focus pulling is how a camera says 'look here'; the ring marks the exact moment it lands.", "拉焦是镜头说「看这里」的方式;光环标出落定的那一刻。"),
    avoid: [L("a whole-frame glow or blur in the same shot (only the lockup blurs)", "同一镜头全画面发光或模糊(只有 Logo 模糊)")],
    demo: { stage: "dark", brand: BRAND, loop_ms: 6000, opts: { variant: "blurUp", wordmark: "LaunchReel" } } }),
  e({ family: "logo", factory: "endCard", variant: "endCard", name: L("End card: logo, line, action", "结尾卡:Logo、一句话、行动"), summary: L("A logo reveal, the slogan rising under it, one CTA button that springs in and catches a light once; all of it holds.", "Logo 揭示,口号在下方升起,一个行动按钮弹入并闪过一次高光;全部停住。"),
    intent: ["end-card"], duration_ms: [3200, 5000],
    when: L("The last shot of every film: the logo, the slogan, and what to do next.", "每部片子的最后一镜:Logo、口号、下一步做什么。"),
    rationale: L("One line and one action: the end card is a decision, not a menu.", "一句话一个行动:结尾卡是一个决定,不是一张菜单。"),
    avoid: [L("a price, a plan, a trial length or a currency in the line or the button", "在句子或按钮里写价格、套餐、试用天数或货币"), L("more than one button", "超过一个按钮")],
    demo: { stage: "dark", brand: BRAND, loop_ms: 6000, opts: { variant: "blurUp", wordmark: "LaunchReel", line: "Your product, in motion.", cta: "Make your film" } } }),

  // ---- 5 transitions
  e({ family: "transition", factory: "transition", variant: "wipe", name: L("Brand push / wipe", "品牌色推拉擦除"), summary: L("Two skewed panels in the brand colour cross the frame; the new shot is behind them.", "两块倾斜的品牌色面板扫过画面,新镜头在它们身后。"),
    intent: ["transition"], duration_ms: [700, 1100],
    when: L("A chapter change: from the problem to the product, from one feature group to the next.", "章节切换:从问题到产品,从一组功能到下一组。"),
    rationale: L("Colour is the brand's loudest asset; a wipe in it says 'new chapter' and 'still us'.", "颜色是品牌最响的资产;用它擦除既说「新章节」也说「还是我们」。"),
    avoid: [NO_TRANSITION_IN, L("more than two wipes in one film", "一部片子超过两次擦除")],
    demo: { stage: "dark", brand: BRAND, loop_ms: 6000, opts: { variant: "wipe", dir: "left" } } }),
  e({ family: "transition", factory: "transition", variant: "zoomThrough", name: L("Zoom through a UI element", "穿过界面元素"), summary: L("The camera dives into a card or button until its face fills the frame; the next shot grows out of the same place.", "镜头冲进一张卡片或按钮直到它铺满画面;下一镜从同一位置长出来。"),
    intent: ["transition", "feature"], duration_ms: [900, 1300],
    when: L("Going deeper: from an overview into one feature, from a button to what it opens.", "向深处走:从概览进入某个功能,从按钮进入它打开的东西。"),
    rationale: L("The cut is motivated by the UI itself, so it explains the product's structure while it moves.", "转场由界面本身驱动,一边运动一边讲清产品结构。"),
    avoid: [NO_TRANSITION_IN, L("a target smaller than about 120 px (the zoom becomes a crash)", "目标小于约 120 像素(变成猛冲)")],
    demo: { stage: "dark", brand: BRAND, loop_ms: 6000, opts: { variant: "zoomThrough", target: { x: 700, y: 430, w: 520, h: 220 } } } }),
  e({ family: "transition", factory: "transition", variant: "flip", name: L("Match-cut card flip", "卡片翻转匹配剪辑"), summary: L("The frame turns edge-on like a card and the next shot turns in from the other side.", "画面像卡片一样转到侧面,下一镜从另一面转进来。"),
    intent: ["transition"], duration_ms: [800, 1100],
    when: L("Before and after, or two sides of the same thing (the user's view and the team's view).", "前后对比,或同一件事的两面(用户视角与团队视角)。"),
    rationale: L("A flip says 'the other side of this', which a plain cut cannot.", "翻转说的是「这件事的另一面」,硬切说不出来。"),
    avoid: [NO_TRANSITION_IN, L("text-heavy shots on either side (text at an angle is unreadable)", "两侧镜头文字很多(斜着的字读不了)")],
    demo: { stage: "dark", brand: BRAND, loop_ms: 6000, opts: { variant: "flip", dir: "left" } } }),
  e({ family: "transition", factory: "transition", variant: "sweep", name: L("Light sweep", "光扫转场"), summary: L("A soft band of light crosses the frame; the exposure lifts toward white at the cut and falls after it.", "一道柔和光带扫过画面;剪切点曝光抬向白色,随后回落。"),
    intent: ["transition", "end-card"], duration_ms: [800, 1100],
    when: L("Into the end card, or into the signature moment: a lift in energy.", "进入结尾卡或标志性时刻:能量上扬。"),
    rationale: L("Light is local and travels, so it reads as a moment rather than a global flash.", "光是局部且移动的,读起来是一个瞬间而不是全屏闪白。"),
    avoid: [NO_TRANSITION_IN, L("light stages where the band has no contrast (use it on dark or mid stages)", "浅色背景(光带没有对比,用在深色或中间调背景)")],
    demo: { stage: "dark", brand: BRAND, loop_ms: 6000, opts: { variant: "sweep", dir: "left" } } }),

  // ---- 6 device frames
  e({ family: "device", factory: "device", variant: "phone", name: L("Phone with scroll, tap and notification", "手机:滚动、点击、通知"), summary: L("A phone rises in, its screen scrolls on eased keys, a tap ripples, a notification drops in.", "手机升入画面,屏幕按缓动关键帧滚动,点击出涟漪,通知从顶部落下。"),
    intent: ["feature", "proof"], duration_ms: [3000, 9000],
    when: L("A mobile product's real screen, or the moment the product reaches the user (the notification).", "移动产品的真实界面,或产品触达用户的那一刻(通知)。"),
    rationale: L("Scrolls on few eased keys read as a person's thumb; per-frame scroll reads as a machine.", "少量缓动关键帧的滚动像人的拇指;逐帧滚动像机器。"),
    avoid: [L("a page capture in the frame (rebuild the screen as HTML from the page's elements; a desktop page also shrinks to unreadable)", "把网页截图放进框里(用页面元素重建成 HTML;桌面页面放进手机还会缩到读不了)"), L("a second device on screen with its own motion", "另一个也在动的设备同屏")],
    demo: { stage: "dark", brand: BRAND, loop_ms: 8000, opts: { variant: "phone", scroll: [{ at: 1300, y: 420 }, { at: 3200, y: 160, dur: 700 }], taps: [{ at: 4400, x: 200, y: 520 }], notifications: [{ at: 5000, app: "LaunchReel", title: "Your film is ready", body: "Six shots. Open it to watch." }] } } }),
  e({ family: "device", factory: "device", variant: "laptop", name: L("Laptop with scroll-through", "笔记本:整页滚动"), summary: L("A laptop with the site on screen; the page scrolls through its sections on sparse eased keys.", "笔记本屏幕上显示网站;页面按稀疏的缓动关键帧滚过各个区块。"),
    intent: ["feature", "proof"], duration_ms: [3000, 9000],
    when: L("A desktop web product or a long landing page: show its real structure in one move.", "桌面 Web 产品或长落地页:一个运动展示真实结构。"),
    rationale: L("The hardware frame gives scale and context; the scroll shows there is more than one screen.", "硬件外框给出尺度与语境;滚动说明内容不止一屏。"),
    avoid: [L("a page capture in the frame (rebuild the screen as HTML from the page's elements)", "把网页截图放进框里(用页面元素重建成 HTML)"), L("type on the screen smaller than about 14 px at 1080p (unreadable on a phone)", "屏幕上的字在 1080p 下小于约 14 像素(手机上读不了)")],
    demo: { stage: "light", brand: BRAND, loop_ms: 7000, opts: { variant: "laptop", scroll: [{ at: 1400, y: 380, dur: 1100 }, { at: 3600, y: 0, dur: 900 }] } } }),
  e({ family: "device", factory: "device", variant: "browser", name: L("Browser window", "浏览器窗口"), summary: L("A clean browser window with the product's address, scroll-through, a click ripple and a toast in the corner.", "干净的浏览器窗口,带产品网址、页面滚动、点击涟漪和角落提示。"),
    intent: ["feature", "proof"], duration_ms: [3000, 9000],
    when: L("A web app where the address itself matters (the product is the site).", "网址本身有意义的 Web 应用(产品就是网站)。"),
    rationale: L("Without hardware the UI is larger, and the address bar names the product for free.", "没有硬件外框,界面更大,地址栏顺便念出了产品名。"),
    avoid: [L("an address the brief does not give", "brief 中没有的网址")],
    demo: { stage: "dark", brand: BRAND, loop_ms: 7000, opts: { variant: "browser", url: "launchreel.ai", scroll: [{ at: 1300, y: 300, dur: 1000 }], taps: [{ at: 3000, x: 720, y: 420 }], notifications: [{ at: 3600, app: "LaunchReel", title: "Film rendered", body: "Six shots are ready to watch." }] } } }),
  e({ family: "device", factory: "device", variant: "chat", name: L("Chat conversation", "聊天对话"), summary: L("A WhatsApp-style chat in a phone: typing indicators, messages typed and sent, bubbles that pop, read ticks, auto-scroll.", "手机里的 WhatsApp 风格聊天:对方正在输入、我方打字发送、气泡弹出、已读勾、自动滚动。"),
    intent: ["hook", "feature", "proof"], duration_ms: [4000, 14000],
    when: L("A product that works in a conversation (support, an assistant, a bot), or a customer's words as proof.", "在对话里工作的产品(客服、助手、机器人),或用客户原话做证明。"),
    rationale: L("Everyone knows how a chat moves, so the viewer reads the content, not the interface.", "人人都知道聊天怎么动,观众读的是内容而不是界面。"),
    avoid: [L("invented customer quotes (only words from the brief or the site)", "编造的客户原话(只能用 brief 或网站里的话)"), L("more than about six messages in one shot", "一个镜头超过约六条消息")],
    demo: { stage: "light", brand: "#2F9E6E", loop_ms: 10000, opts: { variant: "chat", name: "LaunchReel", chatPalette: "whatsapp", messages: [{ at: 1300, from: "them", text: "Hi! Send me your product link." }, { at: 3000, from: "me", text: "Here it is: launchreel.ai" }, { at: 4800, from: "them", text: "Got it. I planned six shots for your film." }, { at: 6600, from: "me", text: "Looks good. Make the film." }, { at: 8200, from: "them", text: "Rendering now." }] } } }),
  // ---------------------------------------------------------------- batch 2: ported from the 人造太阳 experiment's scene motion
  e({ family: "data", factory: "data", variant: "counter", name: L("Slam counter", "砸落计数器"), summary: L("A big number rolls fast, settles long and slams on landing with a bloom and an underline.", "大数字快速滚动、长长减速,落定时砸一下,背后闪光、下方划线。"),
    intent: ["hook", "proof"], duration_ms: [2400, 4500],
    when: L("The one number the film is about: a result, a length, a count. Use it once, on the beat the voice says the number.", "整部片围绕的那一个数字:结果、时长、数量。只用一次,落在旁白说出数字的那一拍。"),
    rationale: L("The slow settle builds expectation and the slam marks the exact moment; the eye lands on one number, not a table.", "慢慢收住制造期待,砸下标记那一刻;视线落在一个数字上,而不是一张表。"),
    avoid: [L("a second slam in the same shot (one accent per shot)", "同一镜头第二次砸落(每镜只有一个重音)"), L("a number the brief does not state", "brief 里没有的数字")],
    demo: { stage: "dark", brand: "#F2A03D", loop_ms: 6000, opts: { variant: "counter", value: 90, unit: "s", label: "Your launch film" } } }),
  e({ family: "data", factory: "data", variant: "tubes", name: L("Fill tubes and ratio", "灌注管与倍数"), summary: L("Glass tubes fill in turn, the first level is drawn across, and the ratio slams onto the last tube.", "玻璃管依次灌满,第一根的液面拉成参考线,倍数砸在最后一根管顶。"),
    intent: ["proof"], duration_ms: [4000, 7000],
    when: L("A before-and-after: last release vs this one, the old way vs the new. Two tubes read best; four at most.", "前后对比:上一版和这一版、老办法和新办法。两根最清楚,最多四根。"),
    rationale: L("Filling in turn makes the viewer compare levels, the reference line makes the gap visible, the ratio names it.", "依次灌注让观众比较高度,参考线让差距看得见,倍数把差距说出来。"),
    avoid: [L("values with different units in one set", "一组里放不同单位的数值"), L("a ratio under about 1.3 (the slam over-sells it)", "倍数小于约 1.3(砸下显得夸张)")],
    demo: { stage: "dark", brand: "#6B5BFF", loop_ms: 6000, opts: { variant: "tubes", items: [{ label: "Draft", value: 4 }, { label: "Final", value: 10 }], unit: "shots" } } }),
  e({ family: "data", factory: "data", variant: "bars", name: L("Bar race", "条形赛跑"), summary: L("Horizontal bars grow together with a small stagger; values ride the bar ends and the hero bar's value slams.", "横条错开一点同时生长,数值跟着条端走,主角那条的数值砸下。"),
    intent: ["proof", "feature"], duration_ms: [3500, 6000],
    when: L("Where the time or the effort goes, or how options compare. Keep labels short.", "时间或力气花在哪里,或几个选项怎么比。标签要短。"),
    rationale: L("Bars that start together turn the comparison into a race the eye follows without reading the axis.", "同时起跑的条形把比较变成一场赛跑,不看坐标轴也能看懂。"),
    avoid: [L("more than five bars", "超过五条"), L("a highlight that is not the point of the line said over it", "高亮的那条不是旁白要说的重点")],
    demo: { stage: "light", brand: "#2F6BFF", loop_ms: 6000, opts: { variant: "bars", label: "Seconds per step", unit: "s", items: [{ label: "Script", value: 12 }, { label: "Voice", value: 18 }, { label: "Motion", value: 40 }, { label: "Render", value: 30 }] } } }),
  e({ family: "data", factory: "data", variant: "gauges", name: L("Gauges into the zone", "仪表打进目标区"), summary: L("Up to three dials; their needles swing in turn with a real overshoot into the target zone, which flashes.", "最多三个表盘;指针依次带着真实的过冲摆进目标区,目标区闪亮。"),
    intent: ["proof", "feature"], duration_ms: [3500, 6000],
    when: L("Two or three qualities that all have to be right at once: speed, quality, fit.", "两三个必须同时达标的指标:速度、质量、契合度。"),
    rationale: L("A needle that overshoots reads as a real instrument; three in turn turn 'all of them' into a rhythm.", "带过冲的指针像真仪表;三个依次打进去,把「全部达标」变成节奏。"),
    avoid: [L("exact values the brief does not give (a gauge reads as a measurement)", "brief 没给的精确数值(仪表会被当成测量结果)")],
    demo: { stage: "dark", brand: "#E0563B", loop_ms: 6000, opts: { variant: "gauges", gauges: [{ label: "Pace", value: 0.86 }, { label: "Clarity", value: 0.9 }, { label: "Brand fit", value: 0.82 }] } } }),
  e({ family: "data", factory: "data", variant: "pictogram", name: L("Pictogram count", "图标数量对比"), summary: L("One big unit, an approximately-equals sign, and a grid of small units counting up slow-fast-slow to the total.", "一个大单位、一个约等号,再加一片小图标以慢-快-慢的节奏数到总数。"),
    intent: ["proof", "hook"], duration_ms: [4500, 7000],
    when: L("An equivalence that is hard to picture as a number: one of this is worth this many of that.", "一个数字难以想象的等价关系:一个这个 = 这么多个那个。"),
    rationale: L("Counting units makes size felt, not read; the slow start lets the viewer see what one unit is.", "一个个数出来,大小是感觉到的而不是读到的;慢启动让观众先看清一个单位是什么。"),
    avoid: [L("counts above about 400 (they become texture)", "超过约 400 个(变成纹理)"), L("an equivalence the brief does not support", "brief 不支持的等价关系")],
    demo: { stage: "dark", brand: "#2F9E6E", loop_ms: 7000, opts: { variant: "pictogram", one: { label: "1 product page" }, many: { label: "frames drawn", count: 240 }, icon: "box" } } }),
  e({ family: "data", factory: "data", variant: "curve", name: L("Curve draw", "曲线描绘"), summary: L("Axes draw, then each series draws left to right with a glowing head; the shorter series stops early with its end pin.", "先画坐标轴,再逐条从左到右画线,线头发光;短的那条提前停住并标出终点。"),
    intent: ["proof"], duration_ms: [4000, 7000],
    when: L("A change over time: growth, a steady plateau, one line that keeps going where another stopped.", "随时间的变化:增长、平稳的平台、一条线在另一条停下的地方继续走。"),
    rationale: L("Drawing in time order tells the story the chart holds; the glowing head shows where 'now' is.", "按时间顺序描线,讲出图里的故事;发光的线头告诉观众「现在」在哪里。"),
    avoid: [L("more than three series", "超过三条线"), L("a curve shape the brief does not describe", "brief 没描述过的曲线形状")],
    demo: { stage: "light", brand: "#6B5BFF", loop_ms: 7000, opts: { variant: "curve", xLabel: "Time", yLabel: "Viewers", series: [{ label: "Without a hook", values: [10, 6, 4, 3, 2.6] }, { label: "With a hook", values: [10, 9.4, 9, 8.7, 8.5, 8.4, 8.3, 8.2, 8.2], highlight: true }] } } }),
  e({ family: "timeline", factory: "timeline", variant: "steps", name: L("Step climb", "台阶攀升"), summary: L("Steps grow from the floor; a glowing ball hops up them one by one, lighting each step and popping its value.", "台阶从地面长出;发光的小球一级级跳上去,点亮每一级并弹出它的数值。"),
    intent: ["proof", "feature"], duration_ms: [4500, 8000],
    when: L("Progress in stages: a record broken several times, a workflow in steps, a growing number of users.", "分阶段的进展:一次次刷新的纪录、按步骤的流程、逐步增长的用户。"),
    rationale: L("The ball gives the progress a body the eye can follow; each landing is a beat for the voice.", "小球给进展一个能被眼睛跟随的身体;每次落地都是旁白的一拍。"),
    avoid: [L("more than six steps", "超过六级"), L("steps that are not in rising order", "不是逐级升高的台阶")],
    demo: { stage: "dark", brand: "#F2A03D", loop_ms: 8000, opts: { variant: "steps", steps: [{ label: "Link", value: "1" }, { label: "Script", value: "2" }, { label: "Shots", value: "3" }, { label: "Film", value: "Done" }] } } }),
  e({ family: "timeline", factory: "timeline", variant: "roadmap", name: L("Roadmap travel", "路线图行进"), summary: L("A road draws across; a glowing ball travels it, lighting each milestone with its date; the last one blooms.", "一条路画出来;发光小球沿路前进,依次点亮带日期的里程碑,最后一个绽开光。"),
    intent: ["feature", "end-card"], duration_ms: [5000, 9000],
    when: L("How it works in steps over days, or what comes next. The last milestone is the promise.", "按天分步的使用过程,或接下来的计划。最后一个里程碑是承诺。"),
    rationale: L("Travel turns a list into a journey; the bloom at the end gives the film a place to arrive.", "行进把清单变成旅程;终点的光让片子有一个到达的地方。"),
    avoid: [L("dates the brief does not give", "brief 没给的日期"), L("more than six milestones", "超过六个里程碑")],
    demo: { stage: "dark", brand: "#6B5BFF", loop_ms: 8000, opts: { variant: "roadmap", milestones: [{ date: "Day 1", label: "Paste a link" }, { date: "Day 2", label: "Review the script" }, { date: "Day 3", label: "Approve the shots" }, { date: "Launch", label: "Post the film" }] } } }),
  e({ family: "timeline", factory: "timeline", variant: "hurdles", name: L("Hurdle lane", "跨栏跑道"), summary: L("A lane with hurdles; one by one each lights with its label while a guide reaches from the ball; with clear the ball hops them.", "一条有栏的跑道;栏一个个亮起并弹出标签,引导线从小球伸过去;clear 时小球依次跳过。"),
    intent: ["feature"], duration_ms: [4500, 8000],
    when: L("The steps the product takes care of (clear: done), or the problems still in the viewer's way (waiting).", "产品替你完成的步骤(clear:已完成),或观众面前还有的难关(等待)。"),
    rationale: L("Hurdles make each step an obstacle with a name; clearing them is the product's work made visible.", "栏把每一步变成有名字的障碍;跳过去就是把产品的工作看得见。"),
    avoid: [L("more than five hurdles", "超过五个栏"), L("long labels (the tags sit over the bars)", "过长的标签(标签悬在栏上方)")],
    demo: { stage: "light", brand: "#E0563B", loop_ms: 8000, opts: { variant: "hurdles", items: ["Script", "Voice", "Motion", "Render"], clear: true } } }),
  e({ family: "energy", factory: "energy", variant: "ring", name: L("Ignition ring", "点亮光环"), summary: L("A faint ring ignites with a flash and keeps flowing with light streaks; the centre line rises once it is lit.", "淡淡的环随一下闪光被点亮,之后光流一直沿环流动;点亮后中央的字升起。"),
    intent: ["hook", "end-card"], duration_ms: [3000, 6000],
    when: L("An opening that needs energy before any word, or a logo or name revealed inside light at the end.", "开场在任何字出现之前需要能量感,或结尾在光里揭示 Logo、名字。"),
    rationale: L("Light that keeps moving holds the eye while nothing else happens; the ignition is the hook's single event.", "一直流动的光在没有别的动作时也能留住视线;点亮就是开场钩子的那一个事件。"),
    avoid: [L("a second glowing element in the same shot", "同一镜头再放一个发光主体"), L("a light stage with a pale brand colour (the glow washes out)", "浅色舞台配浅品牌色(光会被冲淡)")],
    demo: { stage: "dark", brand: "#F2A03D", loop_ms: 6000, opts: { variant: "ring", text: "LaunchReel" } } }),
  e({ family: "energy", factory: "energy", variant: "converge", name: L("Converge and fuse", "汇聚合一"), summary: L("Labelled orbs drift, pressure pushes them together, they fuse in a flash and one result orb springs out with sparks.", "带标签的小球漂浮,压力把它们挤到一起,一闪合成一个结果球,火花四散。"),
    intent: ["feature", "hook"], duration_ms: [4500, 7000],
    when: L("Many parts become one: tools into one app, assets into one film, inputs into one result.", "许多部分合成一个:工具合成一个应用、素材合成一条片子、输入合成一个结果。"),
    rationale: L("The squeeze builds tension, the flash releases it; the viewer sees 'all of these become this'.", "挤压积累张力,闪光释放它;观众看到「这些全部变成了这个」。"),
    avoid: [L("more than six parts", "超过六个部分"), L("a result label longer than a few words", "结果标签超过几个词")],
    demo: { stage: "dark", brand: "#6B5BFF", loop_ms: 7000, opts: { variant: "converge", items: ["Script", "Screens", "Voice", "Music"], result: "Your film" } } }),
  e({ family: "energy", factory: "energy", variant: "flow", name: L("Energy flow chain", "能量流链条"), summary: L("Node cards pop in; a pulse rides each connector and lights the next node on arrival; pulses keep flowing behind.", "节点卡片弹出;脉冲沿连线前进,到达时点亮下一个节点;身后的脉冲一直流动。"),
    intent: ["feature"], duration_ms: [4500, 7000],
    when: L("A pipeline the product runs: input, steps, output. Three to five nodes.", "产品跑的一条流程:输入、步骤、输出。三到五个节点。"),
    rationale: L("Cause becomes visible: the next step lights exactly when the pulse arrives, so the order needs no words.", "因果看得见:脉冲到达的那一刻下一步亮起,顺序不需要文字。"),
    avoid: [L("branching flows (one line only)", "分叉的流程(只能一条线)"), L("more than five nodes", "超过五个节点")],
    demo: { stage: "light", brand: "#2F9E6E", loop_ms: 7000, opts: { variant: "flow", nodes: [{ label: "Your page", icon: "page" }, { label: "Script", icon: "chat" }, { label: "Shots", icon: "play" }, { label: "Film", icon: "check" }] } } }),
  e({ family: "diagram", factory: "diagram", variant: "callouts", name: L("Screen callouts", "页面标注"), summary: L("A screen settles in; points get a rippling dot, a leader line to the side and a label, one by one.", "页面落定;标注点逐个出现:涟漪圆点、伸向一侧的引线和标签。"),
    intent: ["feature"], duration_ms: [4000, 7000],
    when: L("Pointing at the parts of a real screen: where to paste, what to pick, what you get.", "指出真实页面的各个部分:在哪里粘贴、选什么、得到什么。"),
    rationale: L("One point at a time keeps the eye on the screen and the label together; the slow push keeps it alive.", "一次一个点,让视线同时落在页面和标签上;缓慢推近让画面一直在动。"),
    avoid: [L("more than five points on one screen", "一个页面超过五个标注"), L("points on a placeholder in a film (use the real screen)", "片子里在占位图上标注(要用真实页面)")],
    demo: { stage: "dark", brand: "#6B5BFF", loop_ms: 7000, opts: { variant: "callouts", points: [{ x: 0.22, y: 0.3, label: "Paste a link" }, { x: 0.7, y: 0.42, label: "Pick a look" }, { x: 0.35, y: 0.78, label: "Get the film" }] } } }),
  e({ family: "diagram", factory: "diagram", variant: "checklist", name: L("Ticking checklist", "自动打勾清单"), summary: L("Rows slide in one per beat and draw their tick, cross or note; an optional stamp slams on at the end.", "每拍滑入一行并画出勾、叉或提示;结尾可以砸下一枚印章。"),
    intent: ["proof", "feature", "end-card"], duration_ms: [4000, 7000],
    when: L("What the product does and does not need from you, or the promises before the end card.", "产品替你做了什么、不需要你做什么,或者结尾卡之前的几个承诺。"),
    rationale: L("Drawing each mark makes it a decision, not a bullet; the stamp closes the list with one word.", "每个标记是画出来的,像一个决定而不是一个圆点;印章用一个词收住清单。"),
    avoid: [L("more than five rows", "超过五行"), L("a cross for something the brief does not say", "给 brief 没提到的事打叉")],
    demo: { stage: "dark", brand: "#2F9E6E", loop_ms: 7000, opts: { variant: "checklist", items: [{ text: "Reads your product page", mark: "yes" }, { text: "Writes the script", mark: "yes" }, { text: "Draws every shot", mark: "yes" }, { text: "Needs an editor", mark: "no" }], stamp: "Ready" } } }),
  e({ family: "diagram", factory: "diagram", variant: "network", name: L("Hub network", "中枢网络"), summary: L("A hub and its sources pop in, spokes draw, one source's packets pave its spoke and pulse the hub; then all spokes flow.", "中枢和各个来源弹出,连线画出,一个来源的数据包沿连线铺路并让中枢跳动;之后所有连线都在流动。"),
    intent: ["feature"], duration_ms: [5000, 8000],
    when: L("Integrations or inputs feeding one product; the source that paves its spoke is the one the line is about.", "汇入一个产品的集成或输入;铺路的那个来源就是旁白讲的那一个。"),
    rationale: L("Paving shows one connection in detail while the others say 'and everything else too'.", "铺路把一条连接讲细,其他连线在说「其余的也都接上了」。"),
    avoid: [L("more than eight nodes", "超过八个节点"), L("brand names of integrations the brief does not list", "brief 没列出的集成品牌名")],
    demo: { stage: "light", brand: "#6B5BFF", loop_ms: 8000, opts: { variant: "network", hub: "LaunchReel", nodes: ["Product page", "Docs", "Screens", "Brand", "Voice", "Music"], from: 0 } } }),
];

/** the Chinese of every named move (the zh pages' moves table) */
const MOVE_ZH: Record<string, string> = {
  "submit.rise": "提交后输入框上移让位",
  "card.flip": "结果卡片逐张向下翻入(间隔 110 ms)",
  "send.on": "敲下第一个字时发送键变成品牌色",
  "send.down": "发送键按下缩到 0.84 倍",
  "send.release": "按下后发送键弹回",
  "ripple": "发送键上扩散出一圈光环",
  "enter.release": "按回车后输入框回弹",
  "drop.open": "下拉框在输入框下方展开",
  "drop.close": "按回车后下拉框收起",
  "row.highlight": "第一条建议亮起",
  "type-input.url:accept.fade": "接受补全后的高亮淡去",
  "chip.in": "粘贴按钮从输入框上方弹出",
  "chip.out": "粘贴后按钮淡出",
  "paste.highlight": "粘贴进来的文字高亮淡去",
  "word.rise": "每个词从遮罩里带一点倾斜升起(760 ms)",
  "line.reveal": "品牌色竖条带着每一行从左到右揭开(900 ms)",
  "bar.out": "行尾的品牌色竖条缩没",
  "track.in": "整段字距从宽收紧",
  "weight.morph": "每个字母从细体过渡到粗体,从中间向两边",
  "title.weight:fade": "字母在变粗之前淡入",
  "cell.in": "每个翻牌格先淡入再开始翻",
  "flap.settle": "最后一个字母落到牌面上,轻轻回弹",
  "stroke.draw": "每行的描边沿字形画出来(1.1 s)",
  "fill.flood": "描边之后填色从左到右漫进去",
  "plate.in": "这组字幕开始时底板从左到右揭开",
  "plate.out": "这组结束后底板收回",
  "bar.grow": "强调竖条从下往上长出",
  "plate.width": "底板宽度跟着正在说的那一行变化",
  "line.swap.in": "下一行升入底板",
  "line.swap.out": "上一行向上离开",
  "captions.karaoke:line.in": "开口前这一行上移 16 px 淡入",
  "captions.karaoke:line.out": "说完后这一行淡出",
  "word.wipe": "说到哪个词品牌色就扫过哪个词(跟着声音,保持线性)",
  "captions.wordPop:line.in": "开口前这一行上移 16 px 淡入",
  "captions.wordPop:line.out": "说完后这一行淡出",
  "word.pop": "说到的词从 0.55 倍弹出,轻微过冲",
  "captions.safe:line.in": "开头 120 ms 淡入",
  "captions.safe:line.out": "结尾 120 ms 淡出",
  "mark.draw": "标志轮廓逐段画出(每段 900 ms,间隔 120 ms)",
  "mark.fill": "轮廓淡去时标志填色",
  "word.draw": "文字标的轮廓画出(1.2 s)",
  "word.fill": "文字标填色",
  "part.settle": "标志各部分从四周飞入,软弹簧落定",
  "word.slide": "文字标从标志后面滑出",
  "pane.in": "磨砂玻璃从右侧滑入停在标志上",
  "pane.out": "玻璃向左滑走,露出清晰的标志",
  "spec.sweep": "玻璃上的高光条扫过",
  "lockup.sharpen": "标志从模糊里变清晰,同时从 0.9 倍长到原大",
  "ring.grow": "光环从标志向外扩散",
  "ring.fade": "光环边扩散边淡去",
  "line.rise": "口号从遮罩里升起 70 px",
  "button.pop": "按钮从 0.86 倍弹出,轻微过冲",
  "shine.sweep": "高光扫过按钮",
  "cover": "前半段:两块品牌色面板扫过来盖住画面",
  "uncover": "后半段:面板扫过新镜头离开",
  "zoom.in": "前半段:镜头冲进目标元素",
  "face.fill": "前半段最后 40%:目标的面填满画面",
  "zoom.out": "后半段:新镜头从目标的位置长出来",
  "face.clear": "后半段前 35%:面的颜色退去",
  "flip.away": "前半段:卡片转到侧面并缩到 0.88 倍",
  "flip.in": "后半段:新卡片从侧面转回来",
  "band.in": "前半段:光带走到画面中央",
  "band.out": "后半段:光带离开画面",
  "lift": "前半段:剪切点前曝光抬向白色",
  "fall": "后半段:剪切点后曝光回落",
  "device.in": "设备上移 90 px 并从 0.96 倍长到原大入场",
  "tap.approach": "手指圆点缩到点击位置",
  "tap.ring": "点击处扩散出光环",
  "note.drop": "通知从顶部落下,轻微过冲",
  "note.up": "停留后通知收回顶部",
  "scroll": "屏幕按每个滚动关键帧滚动",
  "chat.scroll": "每条消息或输入气泡到来时对话上滚(360 ms)",
  "bubble.pop": "每个消息气泡从 0.7 倍弹出",
  "slam.drop": "落地时从 1.5 倍砸下到 0.94 倍",
  "slam.settle": "从 0.94 倍回到 1 倍",
  "data.counter:in": "数字淡入并放大(0.92 → 1)",
  "data.counter:roll": "数字从起始值滚动到落定值",
  "data.counter:underline": "落地后下划线扫出",
  "data.counter:label": "上方一行字升入",
  "data.tubes:tube.in": "每根管子上升 40 px 并淡入",
  "data.tubes:fill": "液体灌注(数值随液面上升)",
  "data.tubes:ref.draw": "参考线从第一根的液面画过去",
  "data.bars:row.in": "每行标签和底槽滑入",
  "data.bars:grow": "每根条形长到它的数值",
  "data.gauges:dial.in": "表盘放大淡入(0.9 → 1)",
  "data.gauges:swing": "指针摆到数值(弹簧:过冲一次后回稳)",
  "data.pictogram:one.pop": "左边的大图标弹出",
  "data.pictogram:rate": "小图标出现的速率(慢、快、慢)",
  "data.pictogram:unit.pop": "每个小图标弹出",
  "data.curve:axes.draw": "坐标轴描出",
  "data.curve:draw": "每条曲线从左到右描出",
  "data.curve:pin.pop": "曲线终点的标签弹出",
  "timeline.steps:step.grow": "每级台阶从地面长起",
  "timeline.steps:hop.x": "小球跳跃的横向移动(高度按重力)",
  "timeline.steps:value.pop": "小球落地时台阶数值弹出",
  "timeline.steps:slam.drop": "最后一个数值落地时从 1.5 倍砸下",
  "timeline.steps:slam.settle": "最后一个数值回到 1 倍",
  "timeline.steps:drift": "整个台阶随小球向左漂移 40 px",
  "timeline.roadmap:road.draw": "道路描出",
  "timeline.roadmap:node.in": "每个节点圆环淡入",
  "timeline.roadmap:travel": "小球沿路从一个节点走到下一个",
  "timeline.roadmap:node.spring": "小球到达时节点弹一下",
  "timeline.roadmap:label.in": "节点日期点亮、标签升入",
  "timeline.roadmap:goal.bloom": "最后一个节点的光晕绽开",
  "timeline.hurdles:hurdle.in": "每个栏淡入",
  "timeline.hurdles:tag.pop": "栏亮起时标签弹出",
  "timeline.hurdles:guide.reach": "虚线从小球伸向亮起的栏",
  "timeline.hurdles:hop.x": "小球跳过栏的横向移动(clear 时;高度按重力)",
  "energy.ring:ignite": "光环从轮廓加热到全亮",
  "energy.ring:text.in": "光环点亮后中央文字升入",
  "energy.converge:orb.pop": "每个光球弹出",
  "energy.converge:pull": "组合架把光球拉向中心并扭转(越来越快直到相遇)",
  "energy.converge:label.fade": "标签在脱离处淡出",
  "energy.converge:push": "拉拢时相机推进(远近光球产生视差)",
  "energy.converge:result.spring": "结果光球从闪光中弹出",
  "energy.converge:result.label": "结果标签淡入",
  "energy.converge:spark.fly": "火花飞出并减速",
  "energy.flow:card.pop": "每张卡片弹出",
  "energy.flow:card.activate": "卡片激活时从 1.12 倍回稳",
  "energy.flow:wire.draw": "亮起的连线画向下一张卡",
  "energy.flow:pulse.ride": "能量脉冲沿连线行进",
  "energy.flow:slam.drop": "最后一张卡落地时从 1.5 倍砸下",
  "energy.flow:slam.settle": "最后一张卡回到 1 倍",
  "energy.flow:goal.bloom": "最后一张卡的光晕绽开",
  "diagram.callouts:panel.in": "面板落定(0.96 → 1)",
  "diagram.callouts:push": "整个镜头里面板和标注一起缓慢推进 2 %",
  "diagram.callouts:dot.pop": "标注点弹出",
  "diagram.callouts:ripple": "标注点的涟漪扩散(循环)",
  "diagram.callouts:line.draw": "引线向侧边画出",
  "diagram.callouts:tag.pop": "引线末端的标签弹出",
  "diagram.checklist:title.in": "标题淡入",
  "diagram.checklist:row.in": "每行从左滑入 40 px",
  "diagram.checklist:mark.circle": "标记的圆圈描出",
  "diagram.checklist:mark.glyph": "勾、叉或提示符描出",
  "diagram.checklist:stamp.drop": "印章从 1.6 倍砸到清单上",
  "diagram.checklist:stamp.settle": "印章的小回弹回稳",
  "diagram.network:hub.pop": "中枢弹出",
  "diagram.network:node.pop": "每个节点标签弹出",
  "diagram.network:spoke.draw": "每条连线画向中枢",
  "diagram.network:pave": "来源节点的连线向中枢铺亮",
  "diagram.network:packet": "数据包沿来源连线行进",
};
const MOTION_TABLES: Record<Family, Record<string, MotionTable>> = {
  "type-input": TYPE_INPUT_MOTIONS, title: TITLE_MOTIONS, captions: CAPTION_MOTIONS, logo: LOGO_MOTIONS, transition: TRANSITION_MOTIONS, device: DEVICE_MOTIONS,
  data: DATA_MOTIONS, timeline: TIMELINE_MOTIONS, energy: ENERGY_MOTIONS, diagram: DIAGRAM_MOTIONS,
};
for (const x of CATALOGUE) {
  const t = MOTION_TABLES[x.family]?.[x.variant];
  if (t) x.motions = Object.entries(t).map(([name, m]) => ({ name, ease: m.ease, doc: { en: m.doc, zh: MOVE_ZH[`${x.id}:${name}`] ?? MOVE_ZH[name] ?? "" } }));
}

/** the ease library as published: name, JSON spec, CSS form (null for springs), when to use it */
export const EASE_DOCS: EaseDoc[] = (Object.keys(EASES) as EasePreset[]).map((name) => ({ name, ease: easeSpec(name), css: cssEase(name), doc: EASES[name].doc }));

/** the zh pages' demos: Chinese on screen (owner 2026-10-19: a Chinese page is Chinese, not a translated frame around English) */
const ZH_DEMO: Record<string, { opts_zh: Record<string, unknown>; scene?: Record<string, string>; scene_zh?: Record<string, string> }> = {
  "type-input.url": { opts_zh: { result: ["LaunchReel", "贴一个链接,拿到一条发布片。"] } },
  "type-input.prompt": { opts_zh: { text: "为我的产品页做一条发布片", chips: ["16:9", "中文"], cps: 7, result: ["发布片方案已就绪", "六个镜头,每个镜头一个要点。", "画面来自你网站的真实页面。"] } },
  "type-input.search": { opts_zh: { text: "发布片模板", cps: 6, suggestions: ["发布片模板", "App 发布片", "发布片配乐"], result: ["发布片模板", "选一种风格,放进你的页面截图。"] } },
  "type-input.paste": { opts_zh: { text: "LaunchReel 把产品页变成一条发布片。", result: ["脚本已就绪", "已规划六个镜头"] } },
  "title.rise": { opts_zh: { text: "你的产品,\n动起来。", accent: "动起来" } },
  "title.mask": { opts_zh: { text: "贴一个链接。\n拿到一条片子。", accent: "片子" } },
  "title.weight": { opts_zh: { text: "让它动起来", accent: "动起来" } },
  "title.flap": { opts_zh: { text: "发布日" } },
  "title.outline": { opts_zh: { text: "一键成片" } },
  "captions.lowerThird": { opts_zh: { kicker: "使用方法", lines: [{ text: "贴上你的产品页", start: 300, end: 2400 }, { text: "LaunchReel 读取每一个页面", start: 2500, end: 4600 }, { text: "你会拿到一份分镜方案", start: 4700, end: 6600 }] } },
  "captions.karaoke": { opts_zh: { lines: [{ text: "贴一个链接,LaunchReel 写好脚本。", start: 300, end: 3600 }, { text: "再把每个镜头做成动画。", start: 3800, end: 6800 }] } },
  "captions.wordPop": { opts_zh: { lines: [{ text: "每个页面都在讲故事", start: 300, end: 2700 }, { text: "一个镜头一个要点", start: 3000, end: 5200 }] } },
  "captions.safe": { opts_zh: { lines: [{ text: "LaunchReel 读取你的产品页,规划六个镜头。", start: 300, end: 3600 }, { text: "每个镜头展示你网站上的一个真实页面。", start: 3800, end: 7200 }] } },
  "logo.endCard": { opts_zh: { line: "你的产品,动起来。", cta: "开始做片" } },
  "device.phone": { opts_zh: { notifications: [{ at: 5000, app: "LaunchReel", title: "你的片子做好了", body: "六个镜头,点开观看。" }] } },
  "device.browser": { opts_zh: { notifications: [{ at: 3600, app: "LaunchReel", title: "片子已渲染", body: "六个镜头可以观看了。" }] } },
  "device.chat": { opts_zh: { messages: [{ at: 1300, from: "them", text: "你好!把产品链接发给我。" }, { at: 3000, from: "me", text: "给你:launchreel.ai" }, { at: 4800, from: "them", text: "收到。我为你的片子规划了六个镜头。" }, { at: 6600, from: "me", text: "看起来不错,开始做片。" }, { at: 8200, from: "them", text: "正在渲染。" }] } },
  "data.counter": { opts_zh: { unit: "秒", label: "你的发布片" } },
  "data.tubes": { opts_zh: { items: [{ label: "初稿", value: 4 }, { label: "成片", value: 10 }], unit: "个镜头" } },
  "data.bars": { opts_zh: { label: "每一步的秒数", unit: "秒", items: [{ label: "脚本", value: 12 }, { label: "配音", value: 18 }, { label: "动效", value: 40 }, { label: "渲染", value: 30 }] } },
  "data.gauges": { opts_zh: { gauges: [{ label: "节奏", value: 0.86 }, { label: "清晰度", value: 0.9 }, { label: "品牌契合", value: 0.82 }] } },
  "data.pictogram": { opts_zh: { one: { label: "1 个产品页" }, many: { label: "帧画面", count: 240 } } },
  "data.curve": { opts_zh: { xLabel: "时间", yLabel: "观众", series: [{ label: "没有开场钩子", values: [10, 6, 4, 3, 2.6] }, { label: "有开场钩子", values: [10, 9.4, 9, 8.7, 8.5, 8.4, 8.3, 8.2, 8.2], highlight: true }] } },
  "timeline.steps": { opts_zh: { steps: [{ label: "链接", value: "1" }, { label: "脚本", value: "2" }, { label: "镜头", value: "3" }, { label: "成片", value: "完成" }] } },
  "timeline.roadmap": { opts_zh: { milestones: [{ date: "第 1 天", label: "贴上链接" }, { date: "第 2 天", label: "审脚本" }, { date: "第 3 天", label: "确认镜头" }, { date: "发布", label: "发出片子" }] } },
  "timeline.hurdles": { opts_zh: { items: ["脚本", "配音", "动效", "渲染"] } },
  "energy.ring": { opts_zh: { text: "一键成片" } },
  "energy.converge": { opts_zh: { items: ["脚本", "画面", "配音", "音乐"], result: "你的片子" } },
  "energy.flow": { opts_zh: { nodes: [{ label: "你的页面", icon: "page" }, { label: "脚本", icon: "chat" }, { label: "镜头", icon: "play" }, { label: "成片", icon: "check" }] } },
  "diagram.callouts": { opts_zh: { points: [{ x: 0.22, y: 0.3, label: "贴上链接" }, { x: 0.7, y: 0.42, label: "选一种风格" }, { x: 0.35, y: 0.78, label: "拿到成片" }] } },
  "diagram.checklist": { opts_zh: { items: [{ text: "读取你的产品页", mark: "yes" }, { text: "写好脚本", mark: "yes" }, { text: "画好每个镜头", mark: "yes" }, { text: "需要剪辑师", mark: "no" }], stamp: "就绪" } },
  "diagram.network": { opts_zh: { nodes: ["产品页", "文档", "截图", "品牌", "配音", "音乐"] } },
};
const TRANSITION_SCENE = { scene: { head: "Six shots planned", card: "Shot 3", next: "Shot 3: the film" }, scene_zh: { head: "已规划六个镜头", card: "镜头 3", next: "镜头 3:成片" } };
for (const x of CATALOGUE) Object.assign(x.demo, x.family === "transition" ? TRANSITION_SCENE : ZH_DEMO[x.id] ?? {});

/** opts keys whose words are on screen; logo / device chrome words that are names (wordmark, url, chat name) stay as they are */
const SCREEN_TEXT = ["text", "result", "suggestions", "chips", "accent", "lines", "kicker", "line", "cta", "messages", "notifications", "unit", "label", "items", "gauges", "one", "many", "series", "xLabel", "yLabel", "steps", "milestones", "nodes", "points", "stamp"];

/** words that may never appear in demo copy (owner 2026-10-19: no money, no trial length) */
export const MONEY_WORDS = /\$|¥|€|£|\bprice\b|\bpricing\b|\bpricing plan|\bsubscription plan|\bfree\b|\btrial\b|\bper month\b|\b\/mo\b|\bcredit|\bdiscount|\bsubscription|\bbilling|价格|免费|试用|元\b|折扣|积分|订阅/i;

function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === "string") out.push(x);
  else if (Array.isArray(x)) x.forEach((y) => strings(y, out));
  else if (x && typeof x === "object") Object.values(x).forEach((y) => strings(y, out));
  return out;
}

/** structural problems of a catalogue document (empty = valid) */
export function catalogueProblems(doc: unknown): string[] {
  const p: string[] = [];
  const d = doc as { schema?: unknown; families?: unknown; entries?: unknown };
  if (!d || typeof d !== "object") return ["catalogue must be an object"];
  if (d.schema !== MOTION_CATALOGUE_SCHEMA) p.push(`schema must be "${MOTION_CATALOGUE_SCHEMA}"`);
  if (!Array.isArray(d.entries) || !d.entries.length) return [...p, "entries must be a non-empty array"];
  const ids = new Set<string>();
  const l10n = (v: unknown) => !!v && typeof (v as L10n).en === "string" && !!(v as L10n).en && typeof (v as L10n).zh === "string" && !!(v as L10n).zh;
  (d.entries as CatalogueEntry[]).forEach((x, i) => {
    const w = `entries[${i}]${x && typeof x.id === "string" ? ` (${x.id})` : ""}`;
    if (!x || typeof x !== "object") { p.push(`${w} must be an object`); return; }
    if (typeof x.id !== "string" || !/^[a-z-]+\.[a-zA-Z]+$/.test(x.id)) p.push(`${w}.id must be "<family>.<variant>"`);
    else if (ids.has(x.id)) p.push(`${w}.id is duplicated`); else ids.add(x.id);
    if (!FAMILIES.includes(x.family)) p.push(`${w}.family must be one of ${FAMILIES.join(", ")}`);
    if (x.id && x.family && x.variant && x.id !== `${x.family}.${x.variant}`) p.push(`${w}.id must equal family.variant`);
    for (const k of ["name", "summary", "when", "rationale"] as const) if (!l10n(x[k])) p.push(`${w}.${k} must be {en, zh}, both non-empty`);
    if (!Array.isArray(x.intent) || !x.intent.length || !x.intent.every((t) => (INTENTS as readonly string[]).includes(t))) p.push(`${w}.intent must be a non-empty subset of ${INTENTS.join(", ")}`);
    if (!Array.isArray(x.duration_ms) || x.duration_ms.length !== 2 || !(x.duration_ms[0] > 0 && x.duration_ms[1] >= x.duration_ms[0])) p.push(`${w}.duration_ms must be [min, max] ms`);
    if (!Array.isArray(x.inputs) || !x.inputs.length || !x.inputs.every((q) => q && typeof q.name === "string" && typeof q.type === "string" && typeof q.doc === "string")) p.push(`${w}.inputs must be [{name, type, doc}]`);
    if (!Array.isArray(x.avoid) || !x.avoid.length || !x.avoid.every(l10n)) p.push(`${w}.avoid must be a non-empty list of {en, zh}`);
    const dm = x.demo;
    if (!dm || (dm.stage !== "light" && dm.stage !== "dark") || !/^#[0-9a-fA-F]{6}$/.test(dm.brand ?? "") || !(dm.loop_ms >= 6000 && dm.loop_ms <= 10000) || !dm.opts || typeof dm.opts !== "object") p.push(`${w}.demo must be {stage, brand #rrggbb, loop_ms 6000-10000 (a 6-10 s loop), opts}`);
    const copy = strings([dm?.opts, dm?.opts_zh, dm?.scene, dm?.scene_zh]).find((s) => MONEY_WORDS.test(s));
    if (copy) p.push(`${w}.demo copy "${copy}" has a money or trial word (owner 2026-10-19)`);
    if (strings([dm?.opts, dm?.opts_zh]).some((s) => /https?:|\/\//.test(s))) p.push(`${w}.demo copy must not carry a URL scheme (a bundle may not)`);
    // the zh page is Chinese: every on-screen word key has a Chinese override, every input doc has its Chinese
    const cjk = (v: unknown) => strings(v).some((s) => /[\u3400-\u9fff]/.test(s));
    for (const k of SCREEN_TEXT) {
      if (!dm?.opts || !(k in dm.opts) || cjk(dm.opts[k])) continue;
      if (k === "text" && x.id === "type-input.url") continue; // an address is typed as it is
      if (!cjk(dm.opts_zh?.[k])) p.push(`${w}.demo.opts_zh.${k} must be the Chinese of opts.${k} (the zh page shows Chinese on screen)`);
    }
    if (dm?.scene && !cjk(dm.scene_zh)) p.push(`${w}.demo.scene_zh must be Chinese`);
    if (Array.isArray(x.inputs)) for (const q of x.inputs) if (!q.doc_zh || !cjk(q.doc_zh)) p.push(`${w}.inputs ${q.name}: doc_zh must be Chinese`);
    if (x.motions !== undefined) {
      if (!Array.isArray(x.motions) || !x.motions.length) p.push(`${w}.motions must be a non-empty list`);
      else {
        const seen = new Set<string>();
        for (const m of x.motions) {
          if (!m || typeof m.name !== "string" || !/^[a-z][a-z.]*[a-z]$/.test(m.name)) { p.push(`${w}.motions: a move needs a name like "roll" or "tag.pop"`); continue; }
          if (seen.has(m.name)) p.push(`${w}.motions ${m.name} is duplicated`); seen.add(m.name);
          const issue = easeIssue(m.ease);
          if (issue) p.push(`${w}.motions ${m.name}: ${issue}`);
          if (!l10n(m.doc) || !cjk(m.doc.zh)) p.push(`${w}.motions ${m.name}: doc must be {en, zh} with Chinese`);
        }
      }
    }
  });
  return p;
}

/** the catalogue document as published (motion-catalogue.json) */
export function catalogueDoc(version: string) {
  return { schema: MOTION_CATALOGUE_SCHEMA, version, shelf_path: "/vendor/motion-vocab.js", global: "MV", families: FAMILY_INFO, entries: CATALOGUE, eases: EASE_DOCS };
}
