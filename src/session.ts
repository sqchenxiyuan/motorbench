// Bench: a running task server plus a browser. Episode: one opened task instance.
// The suite runner is built on these; use them directly for custom evaluation loops.
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { TaskInfo, TaskStatus } from './types.ts';
import { BrowserEnv, DEVICE_SCALE } from './env.ts';
import { startServer } from './server.ts';
import type { TaskServer } from './server.ts';

export interface TaskMeta {
  id: string;
  title: string;
  category: string;
  summary: string;
}

export interface EpisodeSpec {
  task: string;
  level: number;
  seed: number;
}

export const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

const READY = 'window.__bench && window.__bench.ready';

export class Episode {
  readonly env: BrowserEnv;
  readonly info: TaskInfo;
  readonly page: Page;
  readonly pageErrors: string[] = [];
  private context: BrowserContext;

  constructor(context: BrowserContext, page: Page, info: TaskInfo, env: BrowserEnv) {
    this.context = context;
    this.page = page;
    this.info = info;
    this.env = env;
    page.on('pageerror', (e) => this.pageErrors.push(String(e)));
  }

  status(): Promise<TaskStatus> {
    return this.env.status();
  }

  /**
   * End the episode: stop accepting input, read the final status and the input
   * trace, and optionally save the review screenshot (pointer trail overlaid).
   */
  async finish(screenshotPath?: string): Promise<{ status: TaskStatus; events: unknown[] }> {
    this.env.close();
    await this.page.waitForTimeout(80);
    const status = await this.status();
    const events = await this.page.evaluate<unknown[]>('window.__bench.trace()');
    if (screenshotPath) {
      await this.page.evaluate('window.__bench.reveal(), window.__bench.frame()');
      await this.page.screenshot({ path: screenshotPath, scale: 'css' });
    }
    return { status, events };
  }

  async close(): Promise<void> {
    this.env.close();
    await this.context.close().catch(() => {});
  }
}

export class Bench {
  readonly url: string;
  readonly viewport: { width: number; height: number };
  /** Every task the pages offer, in catalogue order. */
  catalogue: TaskMeta[] = [];
  private server: TaskServer;
  private browser: Browser;
  private wheelScale = 1;

  private constructor(server: TaskServer, browser: Browser, viewport: { width: number; height: number }) {
    this.server = server;
    this.browser = browser;
    this.url = server.url;
    this.viewport = viewport;
  }

  static async start(opts: { viewport?: { width: number; height: number }; headed?: boolean } = {}): Promise<Bench> {
    const server = await startServer();
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: !opts.headed });
      const bench = new Bench(server, browser, opts.viewport ?? DEFAULT_VIEWPORT);
      const page = await browser.newPage();
      await page.goto(`${server.url}/`);
      await page.waitForFunction(READY);
      bench.catalogue = await page.evaluate<TaskMeta[]>('window.__benchTasks');
      await page.close();
      bench.wheelScale = await bench.calibrateWheel();
      return bench;
    } catch (err) {
      await browser?.close();
      await server.close();
      throw err;
    }
  }

  /** Expand task ids / category ids / "all" into task ids, in catalogue order. */
  resolveTasks(wanted: string[]): string[] {
    const ids = new Set<string>();
    for (const w of wanted) {
      const matches = w === 'all' ? this.catalogue : this.catalogue.filter((t) => t.id === w || t.category === w);
      if (!matches.length) throw new Error(`unknown task or category "${w}". Known tasks: ${this.catalogue.map((t) => t.id).join(', ')}`);
      for (const m of matches) ids.add(m.id);
    }
    return this.catalogue.filter((t) => ids.has(t.id)).map((t) => t.id);
  }

  private newContext(): Promise<BrowserContext> {
    return this.browser.newContext({ viewport: this.viewport, deviceScaleFactor: DEVICE_SCALE });
  }

  /**
   * Chromium scales wheel deltas under device-scale emulation, so the page would not
   * receive the number of pixels that was asked for. Measure the factor once.
   */
  private async calibrateWheel(): Promise<number> {
    const context = await this.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${this.url}/?task=click`);
      await page.waitForFunction(READY);
      await page.mouse.move(this.viewport.width / 2, this.viewport.height / 2);
      await page.mouse.wheel(0, 400);
      await page.waitForFunction(`window.__bench.trace().some((e) => e[0] === 'w')`, undefined, { timeout: 5000 });
      const got = await page.evaluate<number>(`window.__bench.trace().find((e) => e[0] === 'w')[5]`);
      if (!(got > 0)) throw new Error(`wheel calibration failed (page received deltaY=${got})`);
      return 400 / got;
    } finally {
      await context.close();
    }
  }

  /** Open one task instance in a fresh browser context. */
  async open(spec: EpisodeSpec, opts: { privileged?: boolean; maxActions?: number } = {}): Promise<Episode> {
    const context = await this.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${this.url}/?task=${encodeURIComponent(spec.task)}&level=${spec.level}&seed=${spec.seed}`);
      await page.waitForFunction(READY);
      const buildError = await page.evaluate<string | null>('window.__bench.error || null');
      if (buildError) throw new Error(buildError);
      const info = await page.evaluate<TaskInfo>('window.__bench.spec()');
      if (opts.maxActions) info.maxActions = opts.maxActions;
      const env = new BrowserEnv(
        page,
        info,
        { maxActions: info.maxActions, maxScreenshots: 3 * info.maxActions + 20, wheelScale: this.wheelScale },
        !!opts.privileged,
      );
      await env.init();
      return new Episode(context, page, info, env);
    } catch (err) {
      await context.close().catch(() => {});
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.browser.close().catch(() => {});
    await this.server.close();
  }
}
