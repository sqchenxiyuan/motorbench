// BrowserEnv: one task instance in a Chromium page, driven through Playwright.
// Input goes through the browser's real input pipeline (trusted events).
import type { Page } from 'playwright';
import type { Action, ActResult, Button, Env, TaskInfo, TaskStatus } from './types.ts';
import { normalizeKeys, parseKeys } from './keys.ts';

/**
 * A pointer move is delivered as a few intermediate mouse events. Chromium hands the
 * page one mouse-move per animation frame, so every extra step costs ~16 ms; scoring
 * does not depend on the density (the page treats the gap between two positions as a
 * straight line), so a handful of steps is enough.
 */
const STEP_PX = 48;
const MAX_STEPS = 12;
const MAX_WAIT_S = 10;
const MAX_TEXT = 2000;
const MAX_PATH_POINTS = 2000;

/** The request was understood but is invalid. act() reports it in its result; zoom() throws it. */
export class ActionError extends Error {}

export class EnvClosedError extends Error {
  constructor() {
    super('the episode is over (environment closed)');
  }
}

export interface ActionRecord {
  i: number;
  ms: number;
  action: unknown;
  ok: boolean;
  error?: string;
  score: number;
  done: boolean;
}

export interface EnvLimits {
  maxActions: number;
  maxScreenshots: number;
  /** Factor applied to wheel deltas so that the page receives exactly the requested pixels (see calibrateWheel). */
  wheelScale?: number;
}

/** Pages render at 2x so that zoom() returns real extra detail; screenshots stay 1 image px per CSS px. */
export const DEVICE_SCALE = 2;

// Expressions evaluated inside the page (see web/main.js for window.__bench).
const STATUS = 'window.__bench.status()';
const SOLUTION = 'window.__bench.solution()';
const FRAME = 'window.__bench.frame()';

export class BrowserEnv implements Env {
  readonly task: TaskInfo;
  readonly log: ActionRecord[] = [];
  solution?: () => Promise<Action[]>;
  actions = 0;
  screenshots = 0;
  /** Why act() stopped accepting actions, if it did. */
  finished: 'task_complete' | 'budget' | null = null;
  reported: Record<string, unknown> = {};

  private page: Page;
  private limits: EnvLimits;
  private pos = { x: 0, y: 0 };
  private held = new Set<Button>();
  private closed = false;
  private t0 = Date.now();

  constructor(page: Page, task: TaskInfo, limits: EnvLimits, privileged: boolean) {
    this.page = page;
    this.task = task;
    this.limits = limits;
    if (privileged) this.solution = () => this.page.evaluate<Action[]>(SOLUTION);
  }

  /** Park the pointer in the instruction bar so every episode starts from the same place. */
  async init(): Promise<void> {
    this.pos = { x: this.task.viewport.width - 28, y: 28 };
    await this.page.mouse.move(this.pos.x, this.pos.y);
    await this.settle();
    this.t0 = Date.now();
  }

  close(): void {
    this.closed = true;
  }

  get done(): boolean {
    return this.closed || this.finished !== null;
  }

  get actionsLeft(): number {
    return Math.max(0, this.limits.maxActions - this.actions);
  }

  cursor(): { x: number; y: number } {
    return { ...this.pos };
  }

  report(data: Record<string, unknown>): void {
    Object.assign(this.reported, data);
  }

  status(): Promise<TaskStatus> {
    return this.page.evaluate<TaskStatus>(STATUS);
  }

  async screenshot(): Promise<Buffer> {
    this.guard();
    if (++this.screenshots > this.limits.maxScreenshots) throw new Error('screenshot budget exhausted');
    await this.settle();
    return this.page.screenshot({ type: 'png', scale: 'css' });
  }

  async zoom(region: [number, number, number, number]): Promise<Buffer> {
    this.guard();
    if (++this.screenshots > this.limits.maxScreenshots) throw new Error('screenshot budget exhausted');
    const { width: W, height: H } = this.task.viewport;
    const [x0, y0, x1, y1] = region.map(Number);
    if (![x0, y0, x1, y1].every(Number.isFinite) || x1 - x0 < 1 || y1 - y0 < 1 || x0 < 0 || y0 < 0 || x1 > W || y1 > H) {
      throw new ActionError(`invalid zoom region [${region.join(', ')}]: expected [x0, y0, x1, y1] inside the ${W}x${H} screen`);
    }
    const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    // Use the page's 2x backing store when the result stays within typical model image limits.
    const longEdge = 2 * Math.max(clip.width, clip.height);
    const tokens = Math.ceil((2 * clip.width) / 28) * Math.ceil((2 * clip.height) / 28);
    await this.settle();
    return this.page.screenshot({ type: 'png', clip, scale: longEdge <= 2576 && tokens <= 4784 ? 'device' : 'css' });
  }

  async act(action: Action): Promise<ActResult> {
    this.guard();
    if (this.finished) return { ok: false, done: true, error: this.finished === 'budget' ? 'action budget exhausted' : 'the task has already ended' };
    if (this.actions >= this.limits.maxActions) {
      this.finished = 'budget';
      return { ok: false, done: true, error: 'action budget exhausted' };
    }
    this.actions++;
    let error: string | undefined;
    try {
      await this.exec(action);
    } catch (err) {
      if (!(err instanceof ActionError)) throw err;
      error = err.message;
    }
    await this.settle();
    const st = await this.status();
    if (st.done) this.finished = 'task_complete';
    else if (this.actions >= this.limits.maxActions) this.finished = 'budget';
    this.log.push({ i: this.actions, ms: Date.now() - this.t0, action: compact(action), ok: !error, error, score: st.score, done: st.done });
    return { ok: !error, error, done: this.finished !== null };
  }

  // ---------------------------------------------------------------------------

  private guard(): void {
    if (this.closed) throw new EnvClosedError();
  }

  /** Wait until the page has rendered everything that happened so far. */
  private async settle(): Promise<void> {
    await this.page.evaluate(FRAME);
  }

  private point(x: unknown, y: unknown): { x: number; y: number } {
    const { width: W, height: H } = this.task.viewport;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new ActionError(`invalid coordinate (${String(x)}, ${String(y)})`);
    }
    if (x < 0 || y < 0 || x > W - 1 || y > H - 1) throw new ActionError(`coordinate (${x}, ${y}) is outside the ${W}x${H} screen`);
    return { x, y };
  }

  private async moveTo(p: { x: number; y: number }): Promise<void> {
    const d = Math.hypot(p.x - this.pos.x, p.y - this.pos.y);
    await this.page.mouse.move(p.x, p.y, { steps: Math.max(1, Math.min(MAX_STEPS, Math.ceil(d / STEP_PX))) });
    this.pos = p;
  }

  private button(b: unknown): Button {
    if (b === undefined || b === null) return 'left';
    if (b !== 'left' && b !== 'right' && b !== 'middle') throw new ActionError(`invalid button ${JSON.stringify(b)}: expected left, right or middle`);
    return b;
  }

  private async withModifiers(mods: unknown, fn: () => Promise<void>): Promise<void> {
    if (mods !== undefined && mods !== null && !(Array.isArray(mods) && mods.every((m) => typeof m === 'string'))) {
      throw new ActionError('modifiers must be a list of key names');
    }
    const keys = ((mods ?? []) as string[]).flatMap((m) => parseKeys(m));
    const bad = keys.find((k) => !['Control', 'Shift', 'Alt', 'Meta'].includes(k));
    if (bad) throw new ActionError(`not a modifier key: ${bad}`);
    for (const k of keys) await this.page.keyboard.down(k);
    try {
      await fn();
    } finally {
      for (const k of keys.reverse()) await this.page.keyboard.up(k);
    }
  }

  private async keyboard(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      if (this.page.isClosed()) throw err;
      throw new ActionError(err instanceof Error ? err.message.split('\n')[0] : String(err));
    }
  }

  private async exec(a: Action): Promise<void> {
    // Actions can come from untrusted callers (the HTTP API), so every field is checked.
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new ActionError('an action must be an object with a "type"');
    const { mouse, keyboard } = this.page;
    switch (a.type) {
      case 'move':
        return this.moveTo(this.point(a.x, a.y));

      case 'click': {
        const button = this.button(a.button);
        const count = a.count ?? 1;
        if (![1, 2, 3].includes(count)) throw new ActionError(`invalid click count ${JSON.stringify(count)}`);
        if (this.held.size) throw new ActionError('a mouse button is already held down');
        const target = a.x !== undefined || a.y !== undefined ? this.point(a.x, a.y) : null;
        return this.withModifiers(a.modifiers, async () => {
          if (target) await this.moveTo(target);
          for (let i = 1; i <= count; i++) {
            await mouse.down({ button, clickCount: i });
            await mouse.up({ button, clickCount: i });
          }
        });
      }

      case 'mouse_down': {
        const button = this.button(a.button);
        if (this.held.has(button)) throw new ActionError(`the ${button} button is already down`);
        await mouse.down({ button });
        this.held.add(button);
        return;
      }

      case 'mouse_up': {
        const button = this.button(a.button);
        if (!this.held.has(button)) throw new ActionError(`the ${button} button is not down`);
        await mouse.up({ button });
        this.held.delete(button);
        return;
      }

      case 'drag': {
        if (!Array.isArray(a.path) || a.path.length < 2) throw new ActionError('a drag needs a path of at least two points');
        if (a.path.length > MAX_PATH_POINTS) throw new ActionError(`a drag path may have at most ${MAX_PATH_POINTS} points`);
        if (this.held.size) throw new ActionError('a mouse button is already held down');
        const pts = a.path.map((p) => this.point(p?.[0], p?.[1]));
        const button = this.button(a.button);
        return this.withModifiers(a.modifiers, async () => {
          await this.moveTo(pts[0]);
          await mouse.down({ button });
          try {
            for (const p of pts.slice(1)) await this.moveTo(p);
          } finally {
            await mouse.up({ button });
          }
        });
      }

      case 'scroll': {
        if (!Number.isFinite(a.dx) || !Number.isFinite(a.dy)) throw new ActionError('scroll needs numeric dx and dy');
        const target = a.x !== undefined || a.y !== undefined ? this.point(a.x, a.y) : null;
        return this.withModifiers(a.modifiers, async () => {
          if (target) await this.moveTo(target);
          const k = this.limits.wheelScale ?? 1;
          await mouse.wheel(a.dx * k, a.dy * k);
        });
      }

      case 'type':
        if (typeof a.text !== 'string') throw new ActionError('type needs a text string');
        if (a.text.length > MAX_TEXT) throw new ActionError(`text may be at most ${MAX_TEXT} characters`);
        return this.keyboard(() => keyboard.type(a.text));

      case 'key': {
        if (typeof a.keys !== 'string' || !a.keys.trim()) throw new ActionError('key needs a key name');
        if (a.repeat !== undefined && !Number.isFinite(a.repeat)) throw new ActionError('repeat must be a number');
        if (a.holdSeconds !== undefined && !(Number.isFinite(a.holdSeconds) && a.holdSeconds >= 0)) throw new ActionError('holdSeconds must be a non-negative number');
        const repeat = Math.max(1, Math.min(100, Math.floor(a.repeat ?? 1)));
        if (a.holdSeconds === undefined) {
          const combo = normalizeKeys(a.keys);
          return this.keyboard(async () => {
            for (let i = 0; i < repeat; i++) await keyboard.press(combo);
          });
        }
        const keys = parseKeys(a.keys);
        const ms = Math.max(0, Math.min(MAX_WAIT_S, a.holdSeconds)) * 1000;
        return this.keyboard(async () => {
          const down: string[] = [];
          try {
            for (const k of keys) {
              await keyboard.down(k);
              down.push(k);
            }
            await this.page.waitForTimeout(ms);
          } finally {
            for (const k of down.reverse()) await keyboard.up(k);
          }
        });
      }

      case 'wait': {
        if (!Number.isFinite(a.seconds) || a.seconds < 0) throw new ActionError('wait needs a non-negative number of seconds');
        await this.page.waitForTimeout(Math.min(MAX_WAIT_S, a.seconds) * 1000);
        return;
      }

      default:
        throw new ActionError(`unknown action type: ${String((a as { type?: unknown }).type)}`);
    }
  }
}

/** Keep the action log readable: long drag paths are summarised. */
function compact(a: Action): unknown {
  if (a && typeof a === 'object' && a.type === 'drag' && Array.isArray(a.path) && a.path.length > 12) {
    return { type: 'drag', points: a.path.length, from: a.path[0], to: a.path[a.path.length - 1], button: a.button };
  }
  return a;
}
