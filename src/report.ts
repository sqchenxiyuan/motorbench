// Static HTML report for one run: score table plus a review gallery. Each episode's
// final screenshot shows the pointer trail (magenta = button up, orange = button down).
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EpisodeResult } from './types.ts';
import type { SuiteSummary } from './runner.ts';

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pct = (v: number) => (v * 100).toFixed(1);
/** Single-hue cell shading: stronger = higher score. */
const shade = (v: number) => `background: color-mix(in srgb, var(--accent) ${Math.round(v * 62)}%, transparent)`;

const CSS = `
:root { --bg:#f6f7f9; --panel:#fff; --ink:#111827; --muted:#6b7280; --line:#e5e7eb; --accent:#2563eb; --good:#15803d; --bad:#b91c1c; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f1218; --panel:#181c25; --ink:#e5e7eb; --muted:#9ca3af; --line:#2a303c; --accent:#3b82f6; --good:#4ade80; --bad:#f87171; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 80px; }
h1 { font-size: 24px; margin: 0; }
h2 { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 40px 0 12px; }
h3 { font-size: 16px; margin: 28px 0 4px; }
.sub { color: var(--muted); margin: 4px 0 0; font-size: 14px; }
.kpis { display:flex; flex-wrap:wrap; gap:12px; margin-top:20px; }
.kpi { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 18px; min-width:150px; }
.kpi b { display:block; font-size:28px; font-variant-numeric: tabular-nums; line-height:1.2; }
.kpi span { color:var(--muted); font-size:13px; }
.scroll { overflow-x:auto; background:var(--panel); border:1px solid var(--line); border-radius:10px; }
table { border-collapse: collapse; width:100%; font-variant-numeric: tabular-nums; }
th, td { padding: 8px 12px; text-align:right; border-bottom:1px solid var(--line); white-space:nowrap; }
th { font-size:12px; color:var(--muted); font-weight:600; }
td:first-child, th:first-child { text-align:left; }
tr:last-child td { border-bottom:0; }
tr.cat td { font-size:12px; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); background:var(--bg); padding:6px 12px; }
tr.total td { font-weight:700; }
td.id { font-family: ui-monospace, Menlo, monospace; font-size:14px; }
.desc { color:var(--muted); font-size:14px; margin:0 0 10px; }
.grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap:12px; }
.ep { background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.ep img { display:block; width:100%; height:auto; aspect-ratio: var(--ar); background:#f3f4f6; }
.ep .none { aspect-ratio: var(--ar); display:grid; place-items:center; color:var(--muted); font-size:13px; background:var(--bg); }
.ep .cap { padding:8px 10px; font-size:13px; display:flex; flex-wrap:wrap; gap:4px 10px; align-items:baseline; }
.ep .cap b { font-variant-numeric: tabular-nums; }
.pass { color:var(--good); font-weight:700; } .fail { color:var(--bad); font-weight:700; }
.ep .m { color:var(--muted); }
.ep details { padding:0 10px 8px; font-size:12px; color:var(--muted); }
.ep pre { margin:6px 0 0; white-space:pre-wrap; word-break:break-word; font: 11px/1.45 ui-monospace, Menlo, monospace; }
.err { color:var(--bad); }
code { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
`;

export async function writeReport(outDir: string, s: SuiteSummary, results: EpisodeResult[]): Promise<void> {
  const levels = s.levels.map(String);
  const rows: string[] = [];
  let cat = '';
  for (const [id, t] of Object.entries(s.byTask)) {
    if (t.category !== cat) {
      cat = t.category;
      rows.push(`<tr class="cat"><td colspan="${5 + levels.length}">${esc(cat)}</td></tr>`);
    }
    const cells = levels.map((l) => (t.byLevel[l] ? `<td style="${shade(t.byLevel[l].score)}">${pct(t.byLevel[l].score)}</td>` : '<td>–</td>')).join('');
    rows.push(
      `<tr><td class="id"><a href="#${esc(id)}" style="color:inherit">${esc(id)}</a></td><td style="${shade(t.score)}"><b>${pct(t.score)}</b></td><td>${pct(t.success)}</td>${cells}<td>${t.actions.toFixed(1)}</td><td>${t.seconds.toFixed(1)}</td></tr>`,
    );
  }
  rows.push(`<tr class="total"><td>Overall (mean over tasks)</td><td>${pct(s.score)}</td><td>${pct(s.success)}</td>${levels.map(() => '<td></td>').join('')}<td></td><td></td></tr>`);

  const sections: string[] = [];
  for (const [id, t] of Object.entries(s.byTask)) {
    const eps = results.filter((r) => r.task === id);
    const cards = eps
      .map((r) => {
        const detail = JSON.stringify({ instruction: r.instruction, endedBy: r.endedBy, metrics: r.metrics, agent: r.agent }, null, 1);
        const shot = r.dir
          ? `<a href="${esc(r.dir)}/final.png" target="_blank"><img loading="lazy" src="${esc(r.dir)}/final.png" alt="${esc(id)} level ${r.level} seed ${r.seed}"></a>`
          : '<div class="none">no screenshot</div>';
        return `<div class="ep">${shot}
<div class="cap"><span>L${r.level} · seed ${r.seed}</span><b>${r.score.toFixed(3)}</b><span class="${r.success ? 'pass' : 'fail'}">${r.success ? 'PASS' : 'FAIL'}</span><span class="m">${r.actions} actions · ${r.seconds.toFixed(1)}s</span></div>
${r.error ? `<div class="cap err">${esc(r.error)}</div>` : ''}<details><summary>details</summary><pre>${esc(detail)}</pre></details></div>`;
      })
      .join('\n');
    sections.push(`<h3 id="${esc(id)}"><code>${esc(id)}</code> — ${esc(t.title)}</h3><p class="desc">score ${pct(t.score)} · pass ${pct(t.success)}% · ${t.episodes} episodes</p><div class="grid">${cards}</div>`);
  }

  const cfg = Object.entries(s.agentConfig).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>motorbench — ${esc(s.agent)}</title><style>${CSS}</style></head>
<body style="--ar:${s.viewport.width}/${s.viewport.height}"><main>
<h1>motorbench — ${esc(s.agent)}</h1>
<p class="sub">${esc(s.startedAt.replace('T', ' ').slice(0, 19))} UTC · viewport ${s.viewport.width}×${s.viewport.height} · levels ${levels.join(', ')} · seeds ${s.seeds.join(', ')}${cfg ? ` · ${esc(cfg)}` : ''}</p>
<div class="kpis">
<div class="kpi"><b>${pct(s.score)}</b><span>score (mean over tasks, 0–100)</span></div>
<div class="kpi"><b>${pct(s.success)}%</b><span>strict pass rate</span></div>
<div class="kpi"><b>${s.episodes}</b><span>episodes${s.errors ? `, ${s.errors} with errors` : ''}</span></div>
</div>
<h2>Scores</h2>
<div class="scroll"><table><thead><tr><th>task</th><th>score</th><th>pass %</th>${levels.map((l) => `<th>L${l}</th>`).join('')}<th>actions</th><th>seconds</th></tr></thead><tbody>
${rows.join('\n')}
</tbody></table></div>
<p class="sub">Score is continuous (0–100, partial credit); pass is the strict criterion. Level columns show the score.</p>
<h2>Episodes</h2>
<p class="sub">Final screenshot of every episode with the pointer trail overlaid: magenta = moving with no button pressed, orange = button held. The dashed line is the reference path where there is one.</p>
${sections.join('\n')}
</main></body></html>`;
  await writeFile(join(outDir, 'report.html'), html);
}

export interface RunRow {
  id: string;
  agent: string;
  score: number;
  success: number;
  episodes: number;
  errors: number;
  startedAt: string;
}

/** A page listing finished runs, best score first, linking to each run's report. */
export function renderRunsIndex(rows: RunRow[]): string {
  const sorted = rows.slice().sort((a, b) => b.score - a.score || a.startedAt.localeCompare(b.startedAt));
  const body = sorted
    .map(
      (r) =>
        `<tr><td class="id"><a href="${esc(encodeURIComponent(r.id))}/report.html" style="color:inherit">${esc(r.agent)}</a></td><td style="${shade(r.score)}"><b>${pct(r.score)}</b></td><td>${pct(r.success)}</td><td>${r.episodes}${r.errors ? ` <span class="err">(${r.errors} errors)</span>` : ''}</td><td>${esc(r.startedAt.replace('T', ' ').slice(0, 16))}</td><td class="id" style="color:var(--muted);text-align:left">${esc(r.id)}</td></tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>motorbench runs</title><style>${CSS}</style></head><body><main>
<h1>motorbench runs</h1>
<p class="sub">${rows.length} finished run${rows.length === 1 ? '' : 's'}. Scores are only comparable between runs that cover the same tasks, levels and seeds.</p>
<h2>Runs</h2>
<div class="scroll"><table><thead><tr><th>agent</th><th>score</th><th>pass %</th><th>episodes</th><th>started (UTC)</th><th style="text-align:left">run</th></tr></thead><tbody>
${body || '<tr><td colspan="6" style="text-align:left;color:var(--muted)">No finished runs yet.</td></tr>'}
</tbody></table></div>
</main></body></html>`;
}
