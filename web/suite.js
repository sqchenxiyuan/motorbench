// Scored runs in the browser: a list of episodes played one after another, with a
// scorecard at the end. Everything lives in this browser's localStorage, so it works
// on a static site and needs no server.
import { CATEGORIES, TASK_LIST } from './tasks/index.js';

/** Runs use a fixed stage, so the instances are the same ones the harness generates by default. */
export const STAGE = { width: 1280, height: 800 };

export const PRESETS = {
  quick: { title: 'Quick', levels: [2], seeds: [1], about: 'every task once, at level 2' },
  standard: { title: 'Standard', levels: [1, 2, 3], seeds: [1], about: 'every task at all three levels' },
  full: { title: 'Full', levels: [1, 2, 3], seeds: [1, 2, 3], about: 'three instances of every task and level, the same episodes as the harness default' },
};

const PREFIX = 'motorbench.run.';
const LAST = 'motorbench.lastRun';
const KEEP = 6; // stored runs

export function storageOk() {
  try {
    localStorage.setItem('motorbench.probe', '1');
    localStorage.removeItem('motorbench.probe');
    return true;
  } catch {
    return false;
  }
}

export function loadRun(id) {
  try {
    return JSON.parse(localStorage.getItem(PREFIX + id));
  } catch {
    return null;
  }
}

export function saveRun(run) {
  localStorage.setItem(PREFIX + run.id, JSON.stringify(run));
  localStorage.setItem(LAST, run.id);
}

export function lastRun() {
  try {
    const id = localStorage.getItem(LAST);
    return id ? loadRun(id) : null;
  } catch {
    return null;
  }
}

const ints = (s) => s.split(',').map((x) => parseInt(x, 10)).filter(Number.isInteger);

/**
 * Create a run from URL parameters:
 *   start=quick|standard|full   which preset
 *   tasks=a,b                    only these task or category ids (default: all)
 *   levels=1,3  seeds=1,2        override the preset
 *   limit=300                    seconds allowed per episode
 *   viewport=window              lay tasks out for this window instead of the fixed stage
 */
export function createRun(params) {
  const presetId = PRESETS[params.get('start')] ? params.get('start') : 'standard';
  const preset = PRESETS[presetId];
  const wanted = (params.get('tasks') || 'all').split(',');
  const tasks = TASK_LIST.filter((t) => wanted.includes('all') || wanted.includes(t.id) || wanted.includes(t.category));
  const levels = params.get('levels') ? ints(params.get('levels')).filter((l) => l >= 1 && l <= 3) : preset.levels;
  const seeds = params.get('seeds') ? ints(params.get('seeds')) : preset.seeds;
  const episodes = [];
  for (const t of tasks) for (const level of levels) for (const seed of seeds) episodes.push({ task: t.id, level, seed });
  if (!episodes.length) return null;

  const run = {
    id: Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36),
    preset: presetId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    limitSec: Math.max(5, Number(params.get('limit')) || 300),
    viewport: params.get('viewport') === 'window' ? null : STAGE,
    episodes,
    results: episodes.map(() => null),
    opened: {}, // episode index -> how many times its page was loaded
    restarts: 0, // episodes that were loaded again before being finished
  };
  // Drop the oldest stored runs.
  const stored = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).sort();
  for (const k of stored.slice(0, Math.max(0, stored.length - KEEP + 1))) localStorage.removeItem(k);
  saveRun(run);
  return run;
}

export const episodeUrl = (run, i) => {
  const e = run.episodes[i];
  return `?task=${e.task}&level=${e.level}&seed=${e.seed}&run=${run.id}&i=${i}`;
};
export const resultsUrl = (run) => `?run=${run.id}&results=1`;
/** Index of the first episode without a result, or -1 when the run is complete. */
export const nextIndex = (run) => run.results.findIndex((r) => !r);

const mean = (list, f) => (list.length ? list.reduce((a, x) => a + f(x), 0) / list.length : 0);

/**
 * Same aggregation as the harness: a task's score is the mean over its episodes,
 * the overall score is the mean over tasks. Episodes that were not attempted count as zero.
 */
export function summarize(run) {
  const rows = run.episodes.map((e, i) => run.results[i] || { ...e, score: 0, success: false, endedBy: 'not_attempted', seconds: 0 });
  const byTask = [];
  for (const t of TASK_LIST) {
    const mine = rows.filter((r) => r.task === t.id);
    if (!mine.length) continue;
    const byLevel = {};
    for (const level of [...new Set(mine.map((r) => r.level))].sort()) {
      byLevel[level] = mean(mine.filter((r) => r.level === level), (r) => r.score);
    }
    byTask.push({ id: t.id, title: t.title, category: t.category, episodes: mine.length, score: mean(mine, (r) => r.score), success: mean(mine, (r) => (r.success ? 1 : 0)), byLevel });
  }
  const byCategory = CATEGORIES.map((c) => {
    const tasks = byTask.filter((t) => t.category === c.id);
    return { id: c.id, title: c.title, tasks: tasks.length, score: mean(tasks, (t) => t.score), success: mean(tasks, (t) => t.success) };
  }).filter((c) => c.tasks);
  return {
    score: mean(byTask, (t) => t.score),
    success: mean(byTask, (t) => t.success),
    episodes: rows.length,
    attempted: run.results.filter(Boolean).length,
    seconds: rows.reduce((a, r) => a + (r.seconds || 0), 0),
    levels: [...new Set(rows.map((r) => r.level))].sort(),
    byTask,
    byCategory,
    rows,
  };
}

/** What "Download results" saves: enough to compare or archive a run. */
export function exportRun(run) {
  const s = summarize(run);
  const pct = (v) => Math.round(v * 10000) / 10000;
  return {
    kind: 'motorbench-web-run',
    preset: run.preset,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    viewport: run.viewport || { width: window.innerWidth, height: window.innerHeight, fixed: false },
    limitSec: run.limitSec,
    restarts: run.restarts,
    userAgent: navigator.userAgent,
    score: pct(s.score),
    success: pct(s.success),
    episodes: s.episodes,
    attempted: s.attempted,
    byCategory: Object.fromEntries(s.byCategory.map((c) => [c.id, { score: pct(c.score), success: pct(c.success) }])),
    byTask: Object.fromEntries(s.byTask.map((t) => [t.id, { score: pct(t.score), success: pct(t.success), byLevel: Object.fromEntries(Object.entries(t.byLevel).map(([l, v]) => [l, pct(v)])) }])),
    results: s.rows,
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const p1 = (v) => (v * 100).toFixed(1);
const shade = (v) => `background: rgba(37, 99, 235, ${(v * 0.45).toFixed(3)})`;

/** The scorecard page. */
export function renderResults(run) {
  const s = summarize(run);
  const left = s.episodes - s.attempted;
  const preset = PRESETS[run.preset];
  let html = `<h1>Scorecard</h1><p>${esc(preset.title)} run · ${s.episodes} episodes · started ${esc(run.startedAt.replace('T', ' ').slice(0, 16))} UTC · ${s.seconds >= 90 ? `${Math.round(s.seconds / 60)} min` : `${Math.round(s.seconds)} s`} of play`;
  html += run.viewport ? ` · ${run.viewport.width}×${run.viewport.height} stage` : ' · laid out for the window (not comparable with the standard stage)';
  html += '</p>';
  if (left) {
    const next = nextIndex(run);
    html += `<p class="warn">${left} of ${s.episodes} episodes have not been attempted and count as zero. <a href="${episodeUrl(run, next)}">Resume the run</a></p>`;
  }
  if (run.restarts) html += `<p class="warn">${run.restarts} episode page${run.restarts === 1 ? ' was' : 's were'} reloaded before being finished.</p>`;
  html += `<div class="kpis"><div class="kpi"><b>${p1(s.score)}</b><span>score, 0–100 (mean over tasks)</span></div><div class="kpi"><b>${p1(s.success)}%</b><span>tasks passed strictly</span></div><div class="kpi"><b>${s.attempted}/${s.episodes}</b><span>episodes attempted</span></div></div>`;

  html += `<table class="scores"><thead><tr><th>task</th><th>score</th><th>pass %</th>${s.levels.map((l) => `<th>L${l}</th>`).join('')}</tr></thead><tbody>`;
  for (const c of s.byCategory) {
    html += `<tr class="cat"><td>${esc(c.title)}</td><td>${p1(c.score)}</td><td>${p1(c.success)}</td><td colspan="${s.levels.length}"></td></tr>`;
    for (const t of s.byTask.filter((x) => x.category === c.id)) {
      html += `<tr><td class="id">${esc(t.id)}</td><td style="${shade(t.score)}"><b>${p1(t.score)}</b></td><td>${p1(t.success)}</td>${s.levels.map((l) => (l in t.byLevel ? `<td style="${shade(t.byLevel[l])}">${p1(t.byLevel[l])}</td>` : '<td>–</td>')).join('')}</tr>`;
    }
  }
  html += `<tr class="total"><td>Overall</td><td>${p1(s.score)}</td><td>${p1(s.success)}</td><td colspan="${s.levels.length}"></td></tr></tbody></table>`;

  html += '<p class="actions"><a class="btn" id="download" href="#">Download results (JSON)</a><a class="btn" href="./">Back to the menu</a></p>';
  html += '<details><summary>Every episode</summary><table class="scores eps"><thead><tr><th>task</th><th>level</th><th>seed</th><th>score</th><th>result</th><th>ended by</th><th>seconds</th></tr></thead><tbody>';
  for (const r of s.rows) {
    html += `<tr><td class="id">${esc(r.task)}</td><td>${r.level}</td><td>${r.seed}</td><td>${r.score.toFixed(3)}</td><td class="${r.success ? 'pass' : 'fail'}">${r.success ? 'PASS' : 'fail'}</td><td>${esc(r.endedBy.replace(/_/g, ' '))}</td><td>${(r.seconds || 0).toFixed(1)}</td></tr>`;
  }
  html += '</tbody></table></details>';
  html += '<p class="foot">Scores are computed in this browser from your real mouse and keyboard input, with the same rules as the harness. Unlike the harness there is no action budget here, only a time limit per episode.</p>';
  return html;
}
