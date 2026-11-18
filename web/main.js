// Page runtime: builds one task instance from the URL, captures trusted input,
// renders, and exposes the result on window.__bench.
//
//   /?task=<id>&level=<1..3>&seed=<int>      one task instance
//   /                                        task menu (for trying tasks by hand)
//
// Optional: &hud=1 (live score readout), &cursor=0 (do not draw the pointer).
import { TASK_LIST, TASKS, CATEGORIES } from './tasks/index.js';
import { makeRng, hashStr } from './lib/rng.js';
import { C, MONO, drawCursor, rect, text } from './lib/ui.js';

const params = new URLSearchParams(location.search);
const BAR = 56;
const $ = (id) => document.getElementById(id);
const r1 = (v) => Math.round(v * 10) / 10;

window.__benchTasks = TASK_LIST.map(({ id, title, category, summary }) => ({ id, title, category, summary }));

if (params.get('task')) boot(params.get('task'));
else menu();

function menu() {
  document.body.classList.add('menu');
  const el = $('menu');
  el.hidden = false;
  const seed = Math.floor(Math.random() * 100000);
  let html =
    '<h1>motorbench</h1><p>Basic mouse and keyboard skills for computer-use agents. ' +
    'Pick a task and a difficulty level to try it by hand; the score is shown live in the top bar.</p>';
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
  el.innerHTML = html;
  window.__bench = { ready: true, menu: true };
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
  const hud = params.get('hud') === '1';
  const showCursor = params.get('cursor') !== '0';
  const W = window.innerWidth;
  const H = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;

  document.body.classList.add('task');
  if (!showCursor) document.body.classList.add('oscursor');
  $('bar').hidden = false;

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

  let dirty = true; // the canvas is repainted only after input (or when a task asks for it)
  function emit(ev) {
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
  on('mousedown', (e) => {
    moveTo(e.clientX, e.clientY, e.timeStamp);
    if (e.button === 0) ptr.left = true;
    rec('d', rel(e.timeStamp), r1(e.clientX), r1(e.clientY), e.button);
    emit({ type: 'down', button: e.button, x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (!isField(e.target) && !isLink(e.target)) e.preventDefault();
  });
  on('mouseup', (e) => {
    moveTo(e.clientX, e.clientY, e.timeStamp);
    if (e.button === 0) ptr.left = false;
    rec('u', rel(e.timeStamp), r1(e.clientX), r1(e.clientY), e.button);
    emit({ type: 'up', button: e.button, x: e.clientX, y: e.clientY, t: e.timeStamp });
  });
  on('click', (e) => {
    if (e.button !== 0) return;
    rec('c', rel(e.timeStamp), r1(e.clientX), r1(e.clientY), e.detail);
    emit({ type: 'click', x: e.clientX, y: e.clientY, detail: e.detail, t: e.timeStamp });
  });
  on('dblclick', (e) => {
    rec('dc', rel(e.timeStamp), r1(e.clientX), r1(e.clientY));
    emit({ type: 'dblclick', x: e.clientX, y: e.clientY, t: e.timeStamp });
  });
  on('contextmenu', (e) => {
    e.preventDefault();
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
    if (hud) {
      const s = status();
      const t = `score ${s.score.toFixed(3)}${s.done ? ' · done' : ''}${s.success ? ' ✓' : ''}`;
      if (t !== hudText) $('hud').firstChild.textContent = hudText = t;
    }
    requestAnimationFrame(frame);
  }

  if (hud) {
    const next = new URLSearchParams(params);
    next.set('seed', String(seed + 1));
    $('hud').innerHTML = `<span></span><a href="${location.search}">retry</a><a href="?${next}">next</a><a href="./">menu</a>`;
    window.addEventListener('resize', () => location.reload());
  }
  requestAnimationFrame(frame);

  window.__bench = {
    ready: true,
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
