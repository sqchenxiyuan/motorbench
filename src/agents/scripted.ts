// Scripted reference agents. They calibrate the benchmark rather than compete in it:
//   oracle  - replays the reference solution           -> must score 1.0 everywhere
//   noisy   - reference solution with Gaussian pixel noise -> shows how score falls with imprecision
//   random  - random input                             -> should score ~0
//   noop    - does nothing                             -> must score exactly 0
import type { Action, Agent, Env } from '../types.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function episodeSeed(env: Env, salt: number): number {
  let h = 2166136261 ^ salt;
  for (const ch of `${env.task.task}|${env.task.level}|${env.task.seed}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Replays the task's reference solution, optionally jittering every coordinate by N(0, sigma) pixels. */
export class OracleAgent implements Agent {
  readonly name: string;
  readonly privileged = true;
  private sigma: number;

  constructor(sigma = 0) {
    this.sigma = sigma;
    this.name = sigma > 0 ? `noisy-${sigma}px` : 'oracle';
  }

  describe() {
    return { sigma_px: this.sigma };
  }

  async run(env: Env): Promise<void> {
    const rand = mulberry32(episodeSeed(env, 7));
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    const { width, height } = env.task.viewport;
    const jx = (x: number) => Math.max(0, Math.min(width - 1, Math.round(x + this.sigma * gauss())));
    const jy = (y: number) => Math.max(0, Math.min(height - 1, Math.round(y + this.sigma * gauss())));
    const jitter = (a: Action): Action => {
      if (this.sigma <= 0) return a;
      if (a.type === 'drag') return { ...a, path: a.path.map(([x, y]) => [jx(x), jy(y)] as [number, number]) };
      if ((a.type === 'move' || a.type === 'click' || a.type === 'scroll') && a.x !== undefined && a.y !== undefined) {
        return { ...a, x: jx(a.x), y: jy(a.y) };
      }
      return a;
    };
    for (const action of await env.solution!()) {
      const res = await env.act(jitter(action));
      if (res.done) break;
    }
  }
}

/** Random mouse and keyboard input. */
export class RandomAgent implements Agent {
  readonly name = 'random';
  private steps: number;

  constructor(steps = 12) {
    this.steps = steps;
  }

  async run(env: Env): Promise<void> {
    const rand = mulberry32(episodeSeed(env, 13));
    const { width, height } = env.task.viewport;
    const px = () => Math.floor(rand() * width);
    const py = () => 56 + Math.floor(rand() * (height - 56));
    const keys = ['Enter', 'Escape', 'Tab', 'Space', 'ArrowDown', 'KeyA', 'KeyK', 'Control+KeyB', 'Shift+F7'];
    for (let i = 0; i < Math.min(this.steps, env.task.maxActions); i++) {
      const r = rand();
      let action: Action;
      if (r < 0.3) action = { type: 'move', x: px(), y: py() };
      else if (r < 0.55) action = { type: 'click', x: px(), y: py(), button: rand() < 0.8 ? 'left' : 'right', count: rand() < 0.8 ? 1 : 2 };
      else if (r < 0.75) action = { type: 'drag', path: [[px(), py()], [px(), py()]] };
      else if (r < 0.85) action = { type: 'scroll', x: px(), y: py(), dx: 0, dy: Math.round((rand() - 0.3) * 1200) };
      else if (r < 0.95) action = { type: 'key', keys: keys[Math.floor(rand() * keys.length)] };
      else action = { type: 'type', text: 'hello' };
      if ((await env.act(action)).done) break;
    }
  }
}

export class NoopAgent implements Agent {
  readonly name = 'noop';
  async run(): Promise<void> {}
}
