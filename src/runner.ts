// Runs a suite: (tasks x levels x seeds) episodes for one agent, and writes results.
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Agent, EndedBy, EpisodeResult } from './types.ts';
import { EnvClosedError } from './env.ts';
import { Bench, DEFAULT_VIEWPORT } from './session.ts';
import type { Episode, EpisodeSpec, TaskMeta } from './session.ts';
import { writeReport } from './report.ts';

export { DEFAULT_VIEWPORT };
export type { TaskMeta };

export interface SuiteConfig {
  agent: Agent;
  /** Task ids, category ids, or "all". */
  tasks: string[];
  levels: number[];
  seeds: number[];
  viewport?: { width: number; height: number };
  /** Episodes in parallel (default 4). */
  concurrency?: number;
  /** Per-episode wall-clock limit (default 600). */
  timeoutSec?: number;
  /** Override every task's own action budget. */
  maxActions?: number;
  outDir: string;
  headed?: boolean;
  quiet?: boolean;
}

export interface Aggregate {
  episodes: number;
  score: number;
  success: number;
  actions: number;
  seconds: number;
}

export interface SuiteSummary {
  agent: string;
  agentConfig: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
  viewport: { width: number; height: number };
  levels: number[];
  seeds: number[];
  /** Headline number: mean score over tasks (each task weighted equally), 0..1. */
  score: number;
  /** Mean strict success rate over tasks. */
  success: number;
  episodes: number;
  errors: number;
  byTask: Record<string, Aggregate & { category: string; title: string; byLevel: Record<string, Aggregate> }>;
  byCategory: Record<string, Aggregate>;
  outDir: string;
}

/** The task catalogue, read from the task pages themselves. */
export async function listTasks(): Promise<TaskMeta[]> {
  const bench = await Bench.start();
  try {
    return bench.catalogue;
  } finally {
    await bench.close();
  }
}

export const episodeDir = (spec: EpisodeSpec) => join('episodes', `${spec.task}-L${spec.level}-s${spec.seed}`);

/**
 * Score an episode that is no longer being driven: read the final state, save the
 * review screenshot and the trace under outDir, and return the result record.
 * `endedBy: 'agent_stopped'` is refined to how the task itself ended, if it did.
 */
export async function scoreEpisode(
  episode: Episode,
  spec: EpisodeSpec,
  opts: { outDir: string; endedBy: EndedBy; error?: string; seconds: number },
): Promise<EpisodeResult> {
  const dir = episodeDir(spec);
  const { env, info } = episode;
  await mkdir(join(opts.outDir, dir), { recursive: true });
  const { status, events } = await episode.finish(join(opts.outDir, dir, 'final.png'));

  let { endedBy, error } = opts;
  if (endedBy === 'agent_stopped' && env.finished === 'task_complete') endedBy = 'task_complete';
  else if (endedBy === 'agent_stopped' && env.finished === 'budget') endedBy = 'budget';
  const pageProblems = [...status.errors, ...episode.pageErrors];
  if (pageProblems.length) error = [error, ...pageProblems].filter(Boolean).join(' | ');

  const result: EpisodeResult = {
    ...spec,
    category: info.category,
    instruction: info.instruction,
    score: status.score,
    success: status.success,
    endedBy,
    error,
    actions: env.actions,
    screenshots: env.screenshots,
    seconds: Math.round(opts.seconds * 100) / 100,
    metrics: status.metrics,
    agent: Object.keys(env.reported).length ? env.reported : undefined,
    dir,
  };
  await writeFile(join(opts.outDir, dir, 'trace.json'), JSON.stringify({ result, actions: env.log, events }));
  return result;
}

/** The record for an episode that could not be run or scored at all. Counts as a zero. */
export function failedEpisode(spec: EpisodeSpec, error: string, episode?: Episode, seconds = 0): EpisodeResult {
  return {
    ...spec,
    category: episode?.info.category ?? '',
    instruction: episode?.info.instruction ?? '',
    score: 0,
    success: false,
    endedBy: 'error',
    error,
    actions: episode?.env.actions ?? 0,
    screenshots: episode?.env.screenshots ?? 0,
    seconds: Math.round(seconds * 100) / 100,
    metrics: {},
    dir: '',
  };
}

/** Run one agent on one task instance and score it. Never throws: failures become a zero-score result. */
export async function runEpisode(bench: Bench, agent: Agent, spec: EpisodeSpec, opts: { outDir: string; timeoutSec: number; maxActions?: number }): Promise<EpisodeResult> {
  const started = Date.now();
  const elapsed = () => (Date.now() - started) / 1000;
  let episode: Episode | undefined;
  try {
    episode = await bench.open(spec, { privileged: !!agent.privileged, maxActions: opts.maxActions });
    const { env } = episode;

    // Run the agent against a wall-clock limit. On timeout the env is closed, so a
    // still-running agent cannot touch the page while it is being scored.
    let timer: NodeJS.Timeout | undefined;
    const agentRun = agent.run(env).then(
      () => null,
      (err: unknown) => err ?? new Error('agent failed'),
    );
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), opts.timeoutSec * 1000);
    });
    const outcome = await Promise.race([agentRun, timeout]);
    clearTimeout(timer);
    const seconds = elapsed();

    let endedBy: EndedBy = 'agent_stopped';
    let error: string | undefined;
    if (outcome === 'timeout') {
      endedBy = 'timeout';
      error = `timed out after ${opts.timeoutSec}s`;
    } else if (outcome && !(outcome instanceof EnvClosedError)) {
      endedBy = 'error';
      error = outcome instanceof Error ? outcome.message : String(outcome);
    }
    return await scoreEpisode(episode, spec, { outDir: opts.outDir, endedBy, error, seconds });
  } catch (err) {
    // The harness itself failed (page crashed, navigation failed, ...).
    return failedEpisode(spec, `harness: ${err instanceof Error ? err.message : String(err)}`, episode, elapsed());
  } finally {
    await episode?.close();
  }
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

function aggregate(rows: EpisodeResult[]): Aggregate {
  const mean = (f: (r: EpisodeResult) => number) => (rows.length ? rows.reduce((a, r) => a + f(r), 0) / rows.length : 0);
  return {
    episodes: rows.length,
    score: round4(mean((r) => r.score)),
    success: round4(mean((r) => (r.success ? 1 : 0))),
    actions: Math.round(mean((r) => r.actions) * 10) / 10,
    seconds: Math.round(mean((r) => r.seconds) * 100) / 100,
  };
}

/** Per-task, per-level and per-category aggregates. The headline score weights every task equally. */
export function summarize(results: EpisodeResult[], catalogue: TaskMeta[]): Pick<SuiteSummary, 'score' | 'success' | 'episodes' | 'errors' | 'byTask' | 'byCategory'> {
  const byTask: SuiteSummary['byTask'] = {};
  for (const meta of catalogue) {
    const rows = results.filter((r) => r.task === meta.id);
    if (!rows.length) continue;
    const byLevel: Record<string, Aggregate> = {};
    for (const level of [...new Set(rows.map((r) => r.level))].sort((a, b) => a - b)) byLevel[level] = aggregate(rows.filter((r) => r.level === level));
    byTask[meta.id] = { ...aggregate(rows), category: meta.category, title: meta.title, byLevel };
  }
  const tasks = Object.values(byTask);
  const macro = (f: (a: Aggregate) => number, list: Aggregate[]) => (list.length ? list.reduce((a, t) => a + f(t), 0) / list.length : 0);
  const byCategory: Record<string, Aggregate> = {};
  for (const cat of [...new Set(tasks.map((t) => t.category))]) {
    const list = tasks.filter((t) => t.category === cat);
    byCategory[cat] = {
      episodes: list.reduce((a, t) => a + t.episodes, 0),
      score: round4(macro((t) => t.score, list)),
      success: round4(macro((t) => t.success, list)),
      actions: Math.round(macro((t) => t.actions, list) * 10) / 10,
      seconds: Math.round(macro((t) => t.seconds, list) * 100) / 100,
    };
  }
  return {
    score: round4(macro((t) => t.score, tasks)),
    success: round4(macro((t) => t.success, tasks)),
    episodes: results.length,
    errors: results.filter((r) => r.error).length,
    byTask,
    byCategory,
  };
}

/** Sort the results into catalogue order, then write summary.json and report.html. */
export async function writeRunOutputs(
  meta: Pick<SuiteSummary, 'agent' | 'agentConfig' | 'startedAt' | 'viewport' | 'levels' | 'seeds' | 'outDir'>,
  results: EpisodeResult[],
  catalogue: TaskMeta[],
): Promise<SuiteSummary> {
  const order = new Map(catalogue.map((t, i) => [t.id, i]));
  results.sort((a, b) => order.get(a.task)! - order.get(b.task)! || a.level - b.level || a.seed - b.seed);
  const summary: SuiteSummary = { ...meta, finishedAt: new Date().toISOString(), ...summarize(results, catalogue) };
  await writeFile(join(meta.outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeReport(meta.outDir, summary, results);
  return summary;
}

export async function runSuite(cfg: SuiteConfig): Promise<{ summary: SuiteSummary; results: EpisodeResult[] }> {
  const log = (s: string) => {
    if (!cfg.quiet) console.log(s);
  };
  const timeoutSec = cfg.timeoutSec ?? 600;
  const startedAt = new Date().toISOString();
  await mkdir(cfg.outDir, { recursive: true });

  const bench = await Bench.start({ viewport: cfg.viewport, headed: cfg.headed });
  const results: EpisodeResult[] = [];
  try {
    const specs: EpisodeSpec[] = [];
    for (const task of bench.resolveTasks(cfg.tasks)) for (const level of cfg.levels) for (const seed of cfg.seeds) specs.push({ task, level, seed });

    const config = {
      agent: cfg.agent.name,
      agentConfig: cfg.agent.describe?.() ?? {},
      tasks: cfg.tasks,
      levels: cfg.levels,
      seeds: cfg.seeds,
      viewport: bench.viewport,
      timeoutSec,
      maxActions: cfg.maxActions ?? null,
      startedAt,
    };
    await writeFile(join(cfg.outDir, 'config.json'), JSON.stringify(config, null, 2));
    await writeFile(join(cfg.outDir, 'results.jsonl'), '');
    log(`${cfg.agent.name}: ${specs.length} episodes (${new Set(specs.map((s) => s.task)).size} tasks x ${cfg.levels.length} levels x ${cfg.seeds.length} seeds) -> ${cfg.outDir}`);

    let next = 0;
    const width = String(specs.length).length;
    const worker = async () => {
      while (next < specs.length) {
        const spec = specs[next++];
        const r = await runEpisode(bench, cfg.agent, spec, { outDir: cfg.outDir, timeoutSec, maxActions: cfg.maxActions });
        results.push(r);
        await appendFile(join(cfg.outDir, 'results.jsonl'), `${JSON.stringify(r)}\n`);
        const tag = `${r.task} L${r.level} s${r.seed}`.padEnd(26);
        const note = r.error ? `  ! ${r.error.slice(0, 120)}` : '';
        log(`[${String(results.length).padStart(width)}/${specs.length}] ${tag} score ${r.score.toFixed(3)} ${r.success ? 'PASS' : 'fail'}  ${String(r.actions).padStart(3)} actions ${r.seconds.toFixed(1).padStart(6)}s  ${r.endedBy}${note}`);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(cfg.concurrency ?? 4, specs.length)) }, worker));

    const summary = await writeRunOutputs(
      { agent: cfg.agent.name, agentConfig: cfg.agent.describe?.() ?? {}, startedAt, viewport: bench.viewport, levels: cfg.levels, seeds: cfg.seeds, outDir: cfg.outDir },
      results,
      bench.catalogue,
    );
    return { summary, results };
  } finally {
    await bench.close();
  }
}

/** Plain-text results table for the terminal. */
export function formatSummary(s: SuiteSummary): string {
  const pct = (v: number) => (v * 100).toFixed(1).padStart(5);
  const levels = s.levels.map(String);
  const lines: string[] = [];
  lines.push(`${'task'.padEnd(16)} ${'score'.padStart(5)} ${'pass%'.padStart(5)}  ${levels.map((l) => `L${l}`.padStart(5)).join(' ')}  ${'actions'.padStart(7)} ${'sec'.padStart(6)}`);
  let cat = '';
  for (const [id, t] of Object.entries(s.byTask)) {
    if (t.category !== cat) {
      cat = t.category;
      const c = s.byCategory[cat];
      lines.push(`-- ${cat} ${'-'.repeat(Math.max(0, 12 - cat.length))} ${pct(c.score)} ${pct(c.success)}  ${'-'.repeat(31)}`);
    }
    lines.push(`${id.padEnd(16)} ${pct(t.score)} ${pct(t.success)}  ${levels.map((l) => (t.byLevel[l] ? pct(t.byLevel[l].score) : '    -')).join(' ')}  ${t.actions.toFixed(1).padStart(7)} ${t.seconds.toFixed(1).padStart(6)}`);
  }
  lines.push('-'.repeat(56));
  lines.push(`${'OVERALL'.padEnd(16)} ${pct(s.score)} ${pct(s.success)}   (${s.episodes} episodes${s.errors ? `, ${s.errors} with errors` : ''})`);
  return lines.join('\n');
}
