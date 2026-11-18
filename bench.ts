#!/usr/bin/env node
// motorbench command line.
//
//   node bench.ts run   --agent oracle --tasks all --levels 1,2,3 --seeds 3
//   node bench.ts list
//   node bench.ts serve --port 8765
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { AGENTS, makeAgent } from './src/agents/index.ts';
import { DEFAULT_VIEWPORT, formatSummary, listTasks, runSuite } from './src/runner.ts';
import { startApiServer } from './src/api.ts';

const HELP = `motorbench - basic mouse/keyboard skills for computer-use agents

Usage:
  node bench.ts run [options]     run a suite locally and write results/<run>/
  node bench.ts serve [options]   HTTP server: API for remote agents, task pages, result pages
  node bench.ts list              list tasks and agents

Options for run:
  --agent <name>        ${Object.keys(AGENTS).join(' | ')}   (default: oracle)
  --tasks <list>        task ids and/or categories, comma separated, or "all"   (default: all)
  --levels <list>       difficulty levels to run                                 (default: 1,2,3)
  --seeds <n | a,b,c>   a count (seeds 1..n) or an explicit list                 (default: 3)
  --concurrency <n>     episodes in parallel                                     (default: 4)
  --max-actions <n>     override the per-task action budget
  --out <dir>           output directory                                         (default: results/<time>-<agent>)
  --model <id>          model for --agent anthropic                              (default: claude-opus-5-5)
  --effort <level>      low | medium | high | xhigh | max                        (default: medium)
  --max-turns <n>       model turns per episode                                  (default: 60)
  --sigma <px>          noise for --agent noisy                                  (default: 3)

Options for serve:
  --port <n>            port to listen on                                        (default: 8765)
  --host <addr>         address to bind; anything but localhost needs a token    (default: 127.0.0.1)
  --token <secret>      require "Authorization: Bearer <secret>" on /api/ (or set MOTORBENCH_TOKEN)
  --no-auth             allow a non-local --host without a token
  --max-episodes <n>    episodes open at the same time                           (default: 8)
  --idle-timeout <sec>  score and close an episode after this long without a request (default: 120)
  --out <dir>           where run directories are written                        (default: results)

Options for both:
  --viewport <WxH>      browser viewport                                         (default: ${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height})
  --timeout <sec>       wall-clock limit per episode                             (default: 600)
  --headed              show the browser window
`;

function numbers(s: string, what: string): number[] {
  const out = s.split(',').map((x) => Number(x.trim()));
  if (!out.length || out.some((n) => !Number.isInteger(n))) throw new Error(`invalid ${what}: "${s}"`);
  return out;
}

function parseViewport(v: string | undefined): { width: number; height: number } {
  if (!v) return DEFAULT_VIEWPORT;
  const m = /^(\d+)x(\d+)$/.exec(v);
  if (!m) throw new Error(`invalid viewport "${v}", expected WIDTHxHEIGHT`);
  const viewport = { width: Number(m[1]), height: Number(m[2]) };
  if (viewport.width < 1024 || viewport.height < 700) throw new Error('viewport must be at least 1024x700');
  return viewport;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      agent: { type: 'string', default: 'oracle' },
      tasks: { type: 'string', default: 'all' },
      levels: { type: 'string', default: '1,2,3' },
      seeds: { type: 'string', default: '3' },
      viewport: { type: 'string' },
      concurrency: { type: 'string', default: '4' },
      timeout: { type: 'string', default: '600' },
      'max-actions': { type: 'string' },
      out: { type: 'string' },
      model: { type: 'string' },
      effort: { type: 'string' },
      'max-turns': { type: 'string' },
      sigma: { type: 'string' },
      port: { type: 'string', default: '8765' },
      host: { type: 'string', default: '127.0.0.1' },
      token: { type: 'string' },
      'no-auth': { type: 'boolean', default: false },
      'max-episodes': { type: 'string', default: '8' },
      'idle-timeout': { type: 'string', default: '120' },
      headed: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const command = positionals[0] ?? 'run';
  if (values.help || command === 'help') {
    console.log(HELP);
    return;
  }

  if (command === 'list') {
    const tasks = await listTasks();
    console.log('Tasks:');
    let cat = '';
    for (const t of tasks) {
      if (t.category !== cat) console.log(`  [${(cat = t.category)}]`);
      console.log(`    ${t.id.padEnd(16)} ${t.summary}`);
    }
    console.log('\nAgents:');
    for (const [name, a] of Object.entries(AGENTS)) console.log(`    ${name.padEnd(16)} ${a.about}`);
    return;
  }

  if (command === 'serve') {
    const token = values.token ?? process.env.MOTORBENCH_TOKEN;
    const server = await startApiServer({
      port: Number(values.port),
      host: values.host,
      token,
      allowUnauthenticated: values['no-auth'],
      outRoot: values.out ?? 'results',
      viewport: parseViewport(values.viewport),
      maxEpisodes: Number(values['max-episodes']),
      episodeTimeoutSec: Number(values.timeout),
      idleTimeoutSec: Number(values['idle-timeout']),
      headed: values.headed,
    });
    console.log(`motorbench server on ${server.url}  (Ctrl+C to stop)`);
    console.log(`  API          ${server.url}/api/            ${token ? 'bearer token required' : 'no authentication'}`);
    console.log(`  try by hand  ${server.url}/`);
    console.log(`  results      ${server.url}/runs/`);
    const stop = () => {
      console.log('\nshutting down');
      server.close().finally(() => process.exit(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    await new Promise(() => {});
  }

  if (command !== 'run') throw new Error(`unknown command "${command}"\n\n${HELP}`);

  const agent = makeAgent(values.agent, {
    model: values.model,
    effort: values.effort,
    sigma: values.sigma === undefined ? undefined : Number(values.sigma),
    maxTurns: values['max-turns'] === undefined ? undefined : Number(values['max-turns']),
  });
  const seedArg = values.seeds;
  const seeds = seedArg.includes(',') ? numbers(seedArg, 'seeds') : Array.from({ length: numbers(seedArg, 'seeds')[0] }, (_, i) => i + 1);
  const viewport = parseViewport(values.viewport);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const outDir = values.out ?? join('results', `${stamp}-${agent.name.replace(/[^\w.-]+/g, '_')}`);

  const { summary } = await runSuite({
    agent,
    tasks: values.tasks.split(',').map((s) => s.trim()).filter(Boolean),
    levels: numbers(values.levels, 'levels'),
    seeds,
    viewport,
    concurrency: Number(values.concurrency),
    timeoutSec: Number(values.timeout),
    maxActions: values['max-actions'] ? Number(values['max-actions']) : undefined,
    outDir,
    headed: values.headed,
  });
  console.log(`\n${formatSummary(summary)}\n\nReport: ${join(outDir, 'report.html')}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
