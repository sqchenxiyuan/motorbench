import type { Bench, Episode } from '../src/session.ts';
import type { Action, TaskStatus } from '../src/types.ts';

export type Move = Extract<Action, { type: 'move' }>;
export type Click = Extract<Action, { type: 'click' }>;
export type Drag = Extract<Action, { type: 'drag' }>;

/**
 * Open a task with access to its reference solution, perform the actions the
 * script returns (it may also act on the episode itself), and return the final status.
 */
export async function play(
  bench: Bench,
  task: string,
  level: number,
  seed: number,
  script: (solution: Action[], ep: Episode) => Action[] | void | Promise<Action[] | void>,
): Promise<TaskStatus> {
  const ep = await bench.open({ task, level, seed }, { privileged: true, maxActions: 1000 });
  try {
    const actions = await script(await ep.env.solution!(), ep);
    for (const a of actions ?? []) {
      const res = await ep.env.act(a);
      if (res.error) throw new Error(`action rejected: ${res.error}`);
      if (res.done) break;
    }
    return (await ep.finish()).status;
  } finally {
    await ep.close();
  }
}

/** Run jobs with bounded parallelism, preserving order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** First seed in 1..40 whose instance reports the wanted metrics.kind. */
export async function seedWithKind(bench: Bench, task: string, level: number, kind: string | RegExp): Promise<number> {
  for (let seed = 1; seed <= 40; seed++) {
    const ep = await bench.open({ task, level, seed });
    try {
      const k = String((await ep.status()).metrics.kind);
      if (typeof kind === 'string' ? k === kind : kind.test(k)) return seed;
    } finally {
      await ep.close();
    }
  }
  throw new Error(`no seed found for ${task} L${level} kind ${kind}`);
}
