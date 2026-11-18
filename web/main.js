// Page runtime: builds one task instance from the URL, captures trusted input,
// renders, and exposes the result on window.__bench.
//
//   /?task=<id>&level=<1..3>&seed=<int>      one task instance (what the harness loads)
//   /?task=...&hud=1                         the same, for trying by hand: live score, next instance loads by itself
//   /?start=quick|standard|full              start a scored run through all tasks (see suite.js)
//   /?run=<id>&results=1                     the scorecard of a run
//   /                                        menu
//
// Optional: &cursor=0 (do not draw the pointer).
import { TASK_LIST, TASKS, CATEGORIES } from './tasks/index.js';
import { makeRng, hashStr } from './lib/rng.js';
import { C, MONO, drawCursor, rect, text } from './lib/ui.js';
import { PRESETS, createRun, episodeUrl, exportRun, lastRun, loadRun, nextIndex, renderResults, resultsUrl, saveRun, storageOk, summarize } from './suite.js';

const params = new URLSearchParams(location.search);
const BAR = 56;
const $ = (id) => document.getElementById(id);
const r1 = (v) => Math.round(v * 10) / 10;

window.__benchTasks = TASK_LIST.map(({ id, title, category, summary }) => ({ id, title, category, summary }));

if (params.get('start')) startRun();
else if (params.get('run') && params.get('results')) scorecard();
else if (params.get('task')) boot(params.get('task'));
else menu();

/** Show a plain document page (menu, scorecard, messages) instead of a task. */
function page(html, extra = {}) {
  document.body.classList.add('menu');
  const el = $('menu');
  el.hidden = false;
  el.innerHTML = html;
  window.__bench = { ready: true, menu: true, ...extra };
}

function menu() {
  const seed = Math.floor(Math.random() * 100000);
  let html = '<h1>motorbench</h1><p>Basic mouse and keyboard skills for computer-use agents: pointing, following paths, dragging, scrolling, typing.</p>';

  html +=
    '<div class="runbox"><h2>Scored run</h2><p>Work through the tasks one after another and get a scorecard at the end. ' +
    'A task moves on by itself once it is completed; press <b>Done</b> in the top bar to move on without completing it.</p><div class="presets">';
  for (const [id, p] of Object.entries(PRESETS)) {
    html += `<a class="preset" href="?start=${id}"><b>${p.title}</b><span>${TASK_LIST.length * p.levels.length * p.seeds.length} episodes</span><small>${p.about}</small></a>`;
  }
  html += '</div>';
  const last = lastRun();
  if (last) {
    const s = summarize(last);
    const next = nextIndex(last);
    html +=
      next >= 0
        ? `<p class="resume">Unfinished run: ${s.attempted} of ${s.episodes} episodes done. <a href="${episodeUrl(last, next)}">Resume</a> · <a href="${resultsUrl(last)}">scorecard so far</a></p>`
        : `<p class="resume">Last run: score ${(s.score * 100).toFixed(1)}. <a href="${resultsUrl(last)}">Scorecard</a></p>`;
  }
  html += '</div>';

  html += '<p class="lead">Or practise a single task. The score is shown live in the top bar, and the next instance loads by itself when you complete one.</p>';
  for (const cat of CATEGORIES) {
    html += `<h2>${cat.title}</h2>`;
    for (const t of TASK_LIST.filter((x) => x.category === cat.id)) {
      const links = [1, 2, 3].map((l) => `<a href="?task=${t.id}&level=${l}&seed=${seed}&hud=1">L${l}</a>`).join('');
      html += `<div class="row"><b>${t.id}</b><span>${t.summary}</span>${links}</div>`;
    }
  }
  html +=
    '<p class="foot">These pages score themselves. The harness that drives them, the scoring rules and the HTTP API for agents are at ' +
    '<a href="https://github.com/sqchenxiyuan/motorbench">github.com/sqchenxiyuan/motorbench</a>.</p>';
  page(html);
}

function startRun() {
  if (!storageOk()) return page('<h1>Scored run</h1><p>A scored run keeps its progress in this browser\'s local storage, which is not available here (private window?).</p><p class="actions"><a class="btn" href="./">Back to the menu</a></p>');
  const run = createRun(params);
  if (!run) return page('<h1>Scored run</h1><p>No task matches this link.</p><p class="actions"><a class="btn" href="./">Back to the menu</a></p>');
  location.replace(episodeUrl(run, 0));
}

function scorecard() {
  const run = loadRun(params.get('run'));
  if (!run) return page('<h1>Scorecard</h1><p>This run is not stored in this browser.</p><p class="actions"><a class="btn" href="./">Back to the menu</a></p>');
  const data = exportRun(run);
  page(renderResults(run), { results: data });
  $('download').addEventListener('click', (e) => {
    e.preventDefault();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `motorbench-${run.preset}-${run.startedAt.slice(0, 10)}.json`;
    a.click();
  });
}

function fail(msg) {
  $('bar').hidden = false;
  $('instruction').textContent = msg;
  window.__bench = { ready: true, error: msg };
}

function boot(taskId) {
  const def = TASKS[taskId];
  if (!def) return fail(`Unknown task "${taskId}"`);

  const level = Math.min(3, Math.max(1, parseInt(params.get('level') ?? '1', 10) || 1));
  const seed = parseInt(params.get('seed') ?? '1', 10) || 0;

  // Part of a scored run? Then this page must be the run's next unfinished episode.
  let run = null;
  let runIndex = -1;
  if (params.get('run')) {
    run = loadRun(params.get('run'));
    runIndex = parseInt(params.get('i') ?? '', 10);
    const planned = run?.episodes[runIndex];
    if (!planned || planned.task !== taskId || planned.level !== level || planned.seed !== seed) {
      $('hud').innerHTML = '<a href="./">menu</a>';
      return fail('This scored run is not stored in this browser. Start a new one from the menu.');
    }
    if (run.results[runIndex]) {
      // Already scored: an episode cannot be played twice.
      const next = nextIndex(run);
      location.replace(next < 0 ? resultsUrl(run) : episodeUrl(run, next));
      return;
    }
  }
  // 'bare' is what the harness uses: no controls, nothing that moves on by itself.
  const mode = run ? 'run' : params.get('hud') === '1' ? 'free' : 'bare';
  const showCursor = params.get('cursor') !== '0';
  const stage = run?.viewport ?? null;
  const W = stage ? stage.width : window.innerWidth;
  const H = stage ? stage.height : window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  if (stage && (window.innerWidth < W || window.innerHeight < H)) {
    window.addEventListener('resize', () => {
      if (window.innerWidth >= W && window.innerHeight >= H) location.reload();
    });
    return fail(`This run uses a ${W}×${H} stage, and the window is only ${window.innerWidth}×${window.innerHeight}. Enlarge the window or zoom out (Ctrl or ⌘ with −); the task appears as soon as it fits.`);
  }

  document.body.classList.add('task');
  if (!showCursor) document.body.classList.add('oscursor');
  $('bar').hidden = false;
  if (stage) {
    // Fixed stage in the top-left corner: page coordinates are stage coordinates.
    document.body.classList.add('stage');
    Object.assign($('bar').style, { right: 'auto', width: `${W}px` });
    Object.assign($('widgets').style, { right: 'auto', bottom: 'auto', width: `${W}px`, height: `${H}px` });
  }
  if (run) {
    run.opened[runIndex] = (run.opened[runIndex] || 0) + 1;
    if (run.opened[runIndex] > 1) run.restarts++;
    saveRun(run);
  }

  const main = $('main');
  main.hidden = false;
  main.width = Math.round(W * dpr);
  main.height = Math.round(H * dpr);
  main.style.width = `${W}px`;
  main.style.height = `${H}px`;
  const g = main.getContext('2d');

  // The pointer is a small sprite moved with CSS, drawn once.
  const sprite = $('cursor');
  sprite.width = Math.round(24 * dpr);
  sprite.height = Math.round(32 * dpr);
  sprite.style.width = '24px';
  sprite.style.height = '32px';
  const cg = sprite.getContext('2d');
  cg.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawCursor(cg, 4, 4); // hotspot at (4, 4) inside the sprite

  const ctx = {
    rng: makeRng(hashStr(`${taskId}|${level}|${seed}`)),
    level,
    seed,
    W,
    H,
    bar: BAR,
    // Tasks lay themselves out inside this box (below the instruction bar, with a margin).
    area: { x: 28, y: BAR + 28, w: W - 56, h: H - BAR - 56 },
    widgets: $('widgets'),
    now: () => performance.now(),
  };

  let task;
  try {
    task = def.create(ctx);
  } catch (err) {
    console.error(err);
    return fail(`Task "${taskId}" failed to build: ${err.message}`);
  }
  $('instruction').textContent = task.instruction;
  const maxActions = task.maxActions ?? 2 * task.solution().length + 10;

  // ---- input capture ---------------------------------------------------------
  // Only trusted (real) input counts. Pointer moves are read through
  // getCoalescedEvents() so that no intermediate position is lost when the browser
  // batches several moves into one frame.
  const t0 = performance.now();
  const events = [];
  const errors = [];
  const rec = (...e) => {
    if (events.length < 300000) events.push(e);
  };
  const rel = (ts) => Math.round(ts - t0);
  const ptr = { x: 0, y: 0, has: false, left: false };
  const isField = (el) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  const isLink = (el) => el instanceof HTMLAnchorElement;

  const inHud = (el) => el instanceof Element && !!el.closest('#hud');

  let dirty = true; // the canvas is repainted only after input (or when a task asks for it)
  let finishing = false; // set once the episode has been scored by this page (run and practice modes)
  function emit(ev) {
    if (finishing) return;
    ev.left = ptr.left;
    dirty = true;
    try {
      task.onEvent(ev);
    } catch (err) {
      console.error(err);
      errors.push(String(err?.stack || err));
    }
  }

  function moveTo(x, y, ts, buttons) {
    // A move that reports the left button as up while we think it is down means the
    // release happened where we could not see it (outside the window).
    if (ptr.left && buttons !== undefined && !(buttons & 1)) {
      ptr.left = false;
      rec('u', rel(ts), r1(ptr.x), r1(ptr.y), 0);
      emit({ type: 'up', button: 0, x: ptr.x, y: ptr.y, t: ts });
    }
    if (ptr.has && x === ptr.x && y === ptr.y) return;
    const prev = ptr.has ? { x: ptr.x, y: ptr.y } : null;
    ptr.x = x;
    ptr.y = y;
    ptr.has = true;
    rec('m', rel(ts), r1(x), r1(y), ptr.left ? 1 : 0);
    emit({ type: 'move', x, y, prev, t: ts });
  }

  const on = (type, fn, opts = true) => window.addEventListener(type, (e) => e.isTrusted && fn(e), opts);

  on('pointermove', (e) => {
    const parts = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const c of parts) moveTo(c.clientX, c.clientY, c.timeStamp || e.timeStamp, c.buttons);
    moveTo(e.clientX, e.clientY, e.timeStamp, e.buttons);
  });
  // Presses on the controls in the top bar (Done, next, ...) are not input to the task.
  on('mousedown', (e) => {
    if (inHud(e.target)) return;
    moveTo(e.clientX, e.clientY, e.timeStamp);
    if (e.button === 0) ptr.left = true;
    rec('d', rel(e.timeStamp), r1(e.clientX), r1(e.clientY), e.button);
    emit({ type: 'down', button: e.button, x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (!isField(e.target) && !isLink(e.target)) e.preventDefault();
  });
  on('mouseup', (e) => {
    if (inHud(e.target) && !ptr.left) return; // a drag that ends over the bar is still released
    moveTo(e.clientX, e.clientY, e.timeStamp);
    if (e.button === 0) ptr.left = false;
    rec('u', rel(e.timeStamp), r1(e.clientX), r1(e.clientY), e.button);
    emit({ type: 'up', button: e.button, x: e.clientX, y: e.clientY, t: e.timeStamp });
  });
  on('click', (e) => {
    if (e.button !== 0 || inHud(e.target)) return;
    rec('c', rel(e.timeStamp), r1(e.clientX), r1(e.clientY), e.detail);
    emit({ type: 'click', x: e.clientX, y: e.clientY, detail: e.detail, t: e.timeStamp });
  });
  on('dblclick', (e) => {
    if (inHud(e.target)) return;
    rec('dc', rel(e.timeStamp), r1(e.clientX), r1(e.clientY));
    emit({ type: 'dblclick', x: e.clientX, y: e.clientY, t: e.timeStamp });
  });
  on('contextmenu', (e) => {
    e.preventDefault();
    if (inHud(e.target)) return;
    rec('cx', rel(e.timeStamp), r1(e.clientX), r1(e.clientY));
    emit({ type: 'context', x: e.clientX, y: e.clientY, t: e.timeStamp });
  });
  on(
    'wheel',
    (e) => {
      e.preventDefault();
      const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
      rec('w', rel(e.timeStamp), r1(e.clientX), r1(e.clientY), r1(e.deltaX * k), r1(e.deltaY * k));
      emit({ type: 'wheel', x: e.clientX, y: e.clientY, dx: e.deltaX * k, dy: e.deltaY * k, t: e.timeStamp });
    },
    { capture: true, passive: false },
  );
  const mods = (e) => (e.ctrlKey ? 'C' : '') + (e.shiftKey ? 'S' : '') + (e.altKey ? 'A' : '') + (e.metaKey ? 'M' : '');
  on('keydown', (e) => {
    const inField = isField(e.target);
    rec('kd', rel(e.timeStamp), e.key, e.code, mods(e));
    emit({
      type: 'keydown',
      key: e.key,
      code: e.code,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey,
      repeat: e.repeat,
      inField,
      t: e.timeStamp,
    });
    // Keep the browser from scrolling, reloading, moving focus etc. (F12 stays usable.)
    if (!inField && e.key !== 'F12') e.preventDefault();
  });
  on('keyup', (e) => rec('ku', rel(e.timeStamp), e.key, e.code));
  for (const type of ['dragstart', 'selectstart']) {
    on(type, (e) => {
      if (!isField(e.target)) e.preventDefault();
    });
  }

  // ---- result ----------------------------------------------------------------
  function status() {
    const s = task.status();
    const score = Number.isFinite(s.score) ? Math.max(0, Math.min(1, s.score)) : 0;
    return {
      done: !!s.done,
      success: !!s.success,
      score: Math.round(score * 10000) / 10000,
      metrics: s.metrics || {},
      errors,
    };
  }

  // ---- review overlay (drawn only after the episode, on request) ---------------
  let revealed = null;
  function buildReveal() {
    const lines = []; // { down: boolean, pts: [] }
    const marks = [];
    let prev = null;
    for (const e of events) {
      const p = { x: e[2], y: e[3] };
      if (e[0] === 'm') {
        const down = !!e[4];
        const last = lines[lines.length - 1];
        if (prev && last && last.down === down) last.pts.push(p);
        else if (prev) lines.push({ down, pts: [prev, p] });
        prev = p;
      } else if (e[0] === 'd') marks.push({ ...p, kind: e[4] === 2 ? 'right' : 'down' });
      else if (e[0] === 'u') marks.push({ ...p, kind: 'up' });
    }
    return { lines, marks, first: events.find((e) => e[0] === 'm') };
  }
  function drawReveal() {
    task.reveal?.(g);
    for (const l of revealed.lines) {
      g.beginPath();
      g.moveTo(l.pts[0].x, l.pts[0].y);
      for (let i = 1; i < l.pts.length; i++) g.lineTo(l.pts[i].x, l.pts[i].y);
      g.strokeStyle = l.down ? '#f97316' : '#c026d3';
      g.lineWidth = 1.5;
      g.lineJoin = 'round';
      g.stroke();
    }
    for (const m of revealed.marks) {
      g.beginPath();
      g.arc(m.x, m.y, m.kind === 'up' ? 5 : 3, 0, Math.PI * 2);
      if (m.kind === 'up') {
        g.strokeStyle = '#f97316';
        g.lineWidth = 1.5;
        g.stroke();
      } else {
        g.fillStyle = m.kind === 'right' ? '#7c3aed' : '#f97316';
        g.fill();
      }
    }
    const s = status();
    const label = `score ${s.score.toFixed(3)}  ${s.success ? 'SUCCESS' : 'not solved'}`;
    g.font = `600 14px ${MONO}`;
    const w = g.measureText(label).width + 24;
    rect(g, { x: 12, y: H - 42, w, h: 30 }, { fill: s.success ? '#166534' : '#7f1d1d', radius: 6 });
    text(g, label, 24, H - 27, { size: 14, color: '#fff', baseline: 'middle', weight: 600, font: MONO });
  }

  // ---- finishing an episode (practice and run modes) ------------------------------
  const flashEl = $('flash');
  function flash(s, note) {
    flashEl.innerHTML = `<b class="${s.success ? 'pass' : 'part'}">${s.success ? '✓ ' : ''}${s.score.toFixed(3)}</b><small>${note}</small>`;
    Object.assign(flashEl.style, { left: `${W / 2}px`, top: `${BAR + (H - BAR) / 2}px` });
    flashEl.hidden = false;
  }
  function finish(endedBy) {
    if (finishing) return;
    const s = status();
    finishing = true; // from here on input is ignored
    if (!run) {
      flash(s, 'next one in a moment');
      const next = new URLSearchParams(params);
      next.set('seed', String(seed + 1));
      setTimeout(() => location.assign(`?${next}`), 1500);
      return;
    }
    run.results[runIndex] = {
      task: taskId,
      level,
      seed,
      category: def.category,
      score: s.score,
      success: s.success,
      endedBy,
      seconds: Math.round((performance.now() - t0) / 100) / 10,
      metrics: s.metrics,
    };
    const next = nextIndex(run);
    if (next < 0) run.finishedAt = new Date().toISOString();
    saveRun(run);
    flash(s, next < 0 ? 'run complete' : `${runIndex + 1} of ${run.episodes.length} done`);
    setTimeout(() => location.assign(next < 0 ? resultsUrl(run) : episodeUrl(run, next)), s.success ? 900 : 1300);
  }

  if (mode === 'free') {
    const next = new URLSearchParams(params);
    next.set('seed', String(seed + 1));
    $('hud').innerHTML = `<span id="live"></span><a href="${location.search}">retry</a><a href="?${next}">next</a><a href="./">menu</a>`;
    window.addEventListener('resize', () => location.reload());
  } else if (mode === 'run') {
    // No live score in a run: the score is only shown once the episode is over.
    $('hud').innerHTML = `<span id="progress">${runIndex + 1} / ${run.episodes.length}</span><span id="timer"></span><button id="done" type="button" tabindex="-1">Done ›</button><a href="./">quit</a>`;
    $('done').addEventListener('click', () => finish('done_button'));
  }

  // ---- render loop -----------------------------------------------------------
  let hudText = '';
  function frame(now) {
    try {
      if (task.tick?.(now)) dirty = true; // a task returns true from tick() while it is animating
      if (dirty) {
        dirty = false;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = C.bg;
        g.fillRect(0, 0, W, H);
        task.draw(g);
        if (revealed) drawReveal();
        const show = showCursor && ptr.has && !revealed;
        sprite.hidden = !show;
        if (show) sprite.style.transform = `translate(${ptr.x - 4}px, ${ptr.y - 4}px)`;
      }
    } catch (err) {
      console.error(err);
      if (errors.length < 5) errors.push(String(err?.stack || err));
    }
    if (mode !== 'bare' && !finishing) {
      const s = status();
      let t = '';
      if (mode === 'free') t = `score ${s.score.toFixed(3)}`;
      else {
        const left = Math.max(0, Math.ceil(run.limitSec - (performance.now() - t0) / 1000));
        t = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        if (left <= 0 && !s.done) finish('timeout');
      }
      if (t !== hudText) $(mode === 'free' ? 'live' : 'timer').textContent = hudText = t;
      if (s.done) finish('task_complete');
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.__bench = {
    ready: true,
    mode,
    spec: () => ({
      task: taskId,
      title: def.title,
      category: def.category,
      level,
      seed,
      instruction: task.instruction,
      viewport: { width: W, height: H },
      maxActions,
    }),
    status,
    /** Reference solution as a list of harness actions. Privileged: never shown to agents. */
    solution: () => task.solution(),
    trace: () => events,
    pointer: () => ({ ...ptr }),
    reveal: () => {
      revealed = buildReveal();
      dirty = true;
    },
    /** Resolves after the next two animation frames, i.e. once the canvas reflects all input so far. */
    frame: () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(true)))),
  };
}
