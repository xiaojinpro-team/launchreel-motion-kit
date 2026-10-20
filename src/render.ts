/**
 * Headless renderer: open a page that implements xjp.frame-protocol.v1 (or a legacy renderAt page), wait for it to be ready,
 * then photograph it one instant at a time. The waits and limits are ported from launchreel runner/lib/free.mjs
 * (renderFree): 15 s for __ready, 15 s for __load, 5 s per frame (seek and capture each), a page error fails the render,
 * Chrome flags FREE_CHROME_ARGS (+ no-network flags for local pages), PNG screenshots.
 */
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { installCompat } from "./compat.js";
import { frameCount, metaProblems, type FrameMeta } from "./protocol.js";

/** Same flags as runner/lib/free.mjs FREE_CHROME_ARGS. */
export const FREE_CHROME_ARGS = ["--ignore-gpu-blocklist", "--enable-webgl", "--use-angle=metal", "--disable-gpu-rasterization", "--disable-background-timer-throttling", "--force-color-profile=srgb", "--hide-scrollbars", "--font-render-hinting=none"];
/** Same flags as runner/lib/fence.mjs CHROME_RENDER_ARGS (Chrome has no DNS, no background networking), plus EXCLUDE 127.0.0.1 so the local page server stays reachable. */
export const NO_NETWORK_ARGS = ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "--no-proxy-server", "--disable-background-networking", "--disable-component-update", "--disable-domain-reliability", "--disable-sync", "--metrics-recording-only", "--no-pings"];
export const READY_TIMEOUT_MS = 15000;
export const LOAD_TIMEOUT_MS = 15000;
export const FRAME_TIMEOUT_MS = 5000;

export class RenderError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "RenderError"; }
}

export interface RenderOptions {
  /** Page to render: a local .html path, a file:// URL, or an http(s) URL. */
  html: string;
  /** JSON spec file passed to __load(spec). */
  spec?: string;
  outDir: string;
  /** Inclusive frame indices [from, to]; default the whole page (ceil(duration_s * fps) frames). */
  range?: [number, number];
  /** Defaults to __meta.fps. Required for a legacy page that has no __meta. */
  fps?: number;
  /** deviceScaleFactor. Default 1. */
  scale?: number;
  /** What to photograph: the #stage canvas (default when present), the viewport, or the whole scrolling page. */
  target?: "stage" | "viewport" | "full-page";
  /** Directory served at http://127.0.0.1 when `html` is a local file (default: the html's directory). Needed when the page imports files outside its own directory, e.g. dist/. */
  root?: string;
  /** Viewport / legacy-meta overrides (default: __meta.width x height, else 1920x1080). */
  width?: number;
  height?: number;
  duration_s?: number;
  /** Chrome binary; default PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, CHROME_PATH, then playwright's channel "chrome". */
  executablePath?: string;
  /** Keep Chrome's network on for local pages too (default: off for local pages, on for http(s) URLs). */
  network?: boolean;
  /** The playwright-core module (default: import("playwright-core") from here, then from the cwd). */
  playwright?: unknown;
  onProgress?: (done: number, total: number, frame: number) => void;
  onLog?: (line: string) => void;
}

export interface RenderResult { outDir: string; fps: number; frames: number; first: number; last: number; files: string[]; meta: FrameMeta | null; ms: number }

// Minimal structural types so playwright-core stays an optional peer (no type dependency on it).
interface PwPage {
  goto(url: string, o?: object): Promise<unknown>;
  evaluate<R = unknown>(fn: unknown, arg?: unknown): Promise<R>;
  waitForFunction(fn: unknown, arg?: unknown, o?: object): Promise<unknown>;
  screenshot(o?: object): Promise<Buffer>;
  locator(sel: string): { screenshot(o?: object): Promise<Buffer>; count(): Promise<number> };
  setViewportSize(s: { width: number; height: number }): Promise<void>;
  on(ev: string, cb: (...a: never[]) => void): void;
}
interface PwBrowser { newPage(o?: object): Promise<PwPage>; close(): Promise<void> }
interface PwChromium { launch(o: object): Promise<PwBrowser> }

export async function loadPlaywright(): Promise<{ chromium: PwChromium }> {
  try { return (await import("playwright-core")) as unknown as { chromium: PwChromium }; } catch { /* try the cwd */ }
  try { return createRequire(path.join(process.cwd(), "noop.js"))("playwright-core"); } catch { /* fall through */ }
  throw new RenderError("no_playwright", "playwright-core is not installed (optional peer dependency): add it to the project or run from a directory that has it");
}

/** Launches Chrome with the runner's flags. `localOnly` adds the no-network flags. */
export async function launchChrome(pw: { chromium: PwChromium }, o: { executablePath?: string; localOnly: boolean }): Promise<PwBrowser> {
  const args = [...(o.localOnly ? NO_NETWORK_ARGS : []), ...FREE_CHROME_ARGS];
  const executablePath = o.executablePath || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROME_PATH;
  const opts: Record<string, unknown> = { headless: true, args };
  if (executablePath) opts.executablePath = executablePath; else opts.channel = "chrome";
  try {
    return await pw.chromium.launch(opts);
  } catch (e) {
    if (executablePath) throw e;
    delete opts.channel; // no installed Chrome: fall back to playwright's own Chromium
    return pw.chromium.launch(opts);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const t = new Promise<never>((_, bad) => { timer = setTimeout(() => bad(new RenderError("timeout", `${what} timed out after ${ms} ms`)), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".wasm": "application/wasm", ".map": "application/json" };

/** Serves `root` read-only on 127.0.0.1 (module scripts do not load over file://). */
export async function serveDir(root: string): Promise<{ origin: string; close(): Promise<void> }> {
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      if (rel === "/favicon.ico") { res.writeHead(204).end(); return; }
      const file = path.resolve(base, "." + rel);
      if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
      const st = fs.statSync(file);
      const target = st.isDirectory() ? path.join(file, "index.html") : file;
      const body = fs.readFileSync(target);
      res.writeHead(200, { "Content-Type": MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new RenderError("serve", "could not start the local file server");
  return { origin: `http://127.0.0.1:${addr.port}`, close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()); }) };
}

const firstLine = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0].slice(0, 400);

export async function renderFrames(o: RenderOptions): Promise<RenderResult> {
  const t0 = Date.now();
  const log = o.onLog ?? (() => {});
  const pw = (o.playwright as { chromium: PwChromium } | undefined) ?? (await loadPlaywright());

  let url: string, server: Awaited<ReturnType<typeof serveDir>> | null = null, local = true;
  if (/^https?:\/\//i.test(o.html)) { url = o.html; local = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(o.html); }
  else {
    const file = path.resolve(o.html.startsWith("file://") ? decodeURIComponent(new URL(o.html).pathname) : o.html);
    if (!fs.existsSync(file)) throw new RenderError("bad_input", `html not found: ${file}`);
    const root = path.resolve(o.root ?? path.dirname(file));
    const rel = path.relative(root, file);
    if (rel.startsWith("..")) throw new RenderError("bad_input", `html ${file} is outside --root ${root}`);
    server = await serveDir(root);
    url = `${server.origin}/${rel.split(path.sep).map(encodeURIComponent).join("/")}`;
  }
  const spec = o.spec ? JSON.parse(fs.readFileSync(o.spec, "utf8")) : undefined;
  const scale = o.scale ?? 1;
  if (!(scale > 0)) throw new RenderError("bad_input", "scale must be > 0");

  const browser = await launchChrome(pw, { executablePath: o.executablePath, localOnly: o.network ? false : local });
  try {
    const page = await browser.newPage({ viewport: { width: o.width ?? 1920, height: o.height ?? 1080 }, deviceScaleFactor: scale });
    const errors: string[] = [], consoleErrors: string[] = [];
    page.on("pageerror", ((e: Error) => errors.push(firstLine(e))) as never);
    page.on("console", ((m: { type(): string; text(): string }) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); }) as never);
    page.on("crash", (() => errors.push("page crashed")) as never);
    const fail = (where: string) => { if (errors.length) throw new RenderError("page_error", `${where}: ${errors[0]}`); };

    await page.goto(url, { timeout: READY_TIMEOUT_MS });
    // A runner-style page is ready (__ready) before __load; a definePage page becomes ready only after __load. Either way __load exists or __ready is already true.
    await page.waitForFunction(() => (window as { __ready?: boolean }).__ready === true || typeof (window as { __load?: unknown }).__load === "function", null, { timeout: READY_TIMEOUT_MS });
    fail("ready");
    if (await page.evaluate(() => typeof (window as { __load?: unknown }).__load === "function")) {
      await withTimeout(page.evaluate((s: unknown) => (window as unknown as { __load(s: unknown): Promise<void> }).__load(s), spec), LOAD_TIMEOUT_MS, "__load")
        .catch((e) => { throw e instanceof RenderError ? e : new RenderError("load_failed", `__load: ${firstLine(e)}`); });
    }
    await page.waitForFunction(() => (window as { __ready?: boolean }).__ready === true, null, { timeout: READY_TIMEOUT_MS });
    fail("load");

    const needFps = o.fps;
    const shimmed = await page.evaluate(`(${installCompat.toString()})(window, ${JSON.stringify({ fps: needFps ?? 24, width: o.width, height: o.height, duration_s: o.duration_s })})`);
    if (shimmed) {
      log("legacy page: installed renderAt -> __frame shim");
      if (!needFps) log("warning: legacy page without --fps, assuming 24");
    }
    const hasFrame = await page.evaluate(() => typeof (window as { __frame?: unknown }).__frame === "function");
    if (!hasFrame) throw new RenderError("bad_page", "the page defines neither window.__frame nor window.renderAt");
    const rawMeta = await page.evaluate(() => (window as { __meta?: unknown }).__meta ?? null);
    let meta: FrameMeta | null = null;
    if (rawMeta) {
      const problems = metaProblems(rawMeta);
      if (problems.length) throw new RenderError("bad_meta", `__meta: ${problems.join("; ")}`);
      meta = rawMeta as FrameMeta;
    }
    const fps = o.fps ?? meta?.fps;
    if (!fps) throw new RenderError("bad_input", "the page has no __meta: pass --fps");
    if (meta && o.fps && o.fps !== meta.fps) log(`note: --fps ${o.fps} overrides __meta.fps ${meta.fps}`);
    const width = o.width ?? meta?.width, height = o.height ?? meta?.height;
    if (width && height) await page.setViewportSize({ width, height });

    const total = frameCount({ fps, duration_s: o.duration_s ?? meta?.duration_s ?? 0 });
    const [first, last] = o.range ?? [0, total - 1];
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first) throw new RenderError("bad_input", `bad range ${first}-${last}`);
    fs.mkdirSync(o.outDir, { recursive: true });

    const hasStage = (await page.locator("#stage").count()) > 0;
    const target = o.target ?? (hasStage ? "stage" : "viewport");
    if (target === "stage" && !hasStage) throw new RenderError("bad_page", "target is the stage canvas but the page has no #stage element");
    const shot = () => target === "stage" ? page.locator("#stage").screenshot({ type: "png", timeout: FRAME_TIMEOUT_MS })
      : page.screenshot({ type: "png", timeout: FRAME_TIMEOUT_MS, fullPage: target === "full-page" });

    const files: string[] = [];
    const n = last - first + 1;
    for (let f = first; f <= last; f++) {
      const t = f / fps;
      try {
        await withTimeout(page.evaluate((t: number) => (window as unknown as { __frame(t: number): Promise<void> }).__frame(t), t), FRAME_TIMEOUT_MS, `__frame(${t})`);
        fail(`frame ${f}`);
        const png = await shot();
        const file = path.join(o.outDir, `${String(f).padStart(6, "0")}.png`);
        fs.writeFileSync(file, png);
        files.push(file);
      } catch (e) {
        if (e instanceof RenderError && e.code === "page_error") throw e;
        throw new RenderError("frame_error", `frame ${f} (t=${t.toFixed(4)} s): ${firstLine(e)}`);
      }
      o.onProgress?.(f - first + 1, n, f);
    }
    if (consoleErrors.length) log(`page console errors: ${consoleErrors.length} (first: ${consoleErrors[0]})`);
    return { outDir: o.outDir, fps, frames: n, first, last, files, meta, ms: Date.now() - t0 };
  } finally {
    await browser.close().catch(() => {});
    await server?.close();
  }
}

