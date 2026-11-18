// Random path / shape generators used by the tracing and drawing tasks.
import { catmullRom } from '../lib/geom.js';

const inset = (a, m) => ({ x: a.x + m, y: a.y + m, w: a.w - 2 * m, h: a.h - 2 * m });

/** n points evenly spaced in x across `box`, with random y and a minimum vertical jump. */
export function zigzag(rng, box, n, minDy = 90) {
  const pts = [];
  let y = rng.range(box.y, box.y + box.h);
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      let ny;
      let k = 0;
      do ny = rng.range(box.y, box.y + box.h);
      while (Math.abs(ny - y) < minDy && ++k < 200);
      y = ny;
    }
    pts.push({ x: Math.round(box.x + (box.w * i) / (n - 1)), y: Math.round(y) });
  }
  return pts;
}

/** Axis-aligned serpentine: right, down, left, down, right. */
export function snake(rng, box) {
  const y1 = box.y + rng.range(0, box.h * 0.12);
  const y3 = box.y + box.h - rng.range(0, box.h * 0.12);
  const y2 = (y1 + y3) / 2 + rng.range(-box.h * 0.1, box.h * 0.1);
  const xl = () => box.x + rng.range(0, box.w * 0.22);
  const xr = () => box.x + box.w - rng.range(0, box.w * 0.22);
  const a = xl();
  const b = xr();
  const c = xl();
  const d = xr();
  return [
    [a, y1],
    [b, y1],
    [b, y2],
    [c, y2],
    [c, y3],
    [d, y3],
  ].map(([x, y]) => ({ x: Math.round(x), y: Math.round(y) }));
}

/** Smooth curve y(x): a Catmull-Rom spline through zigzag control points (never self-intersects). */
export function wave(rng, box, n) {
  return catmullRom(zigzag(rng, box, n, 110), { step: 2 });
}

/** Archimedean spiral, sampled about every 2 px. */
export function spiral(rng, box) {
  const cx = box.x + box.w / 2 + rng.range(-box.w * 0.12, box.w * 0.12);
  const cy = box.y + box.h / 2;
  const rMax = Math.min(box.h / 2, box.w / 2 - Math.abs(cx - (box.x + box.w / 2)));
  const r0 = 36;
  const turns = rng.range(1.75, 2.25);
  const total = turns * Math.PI * 2;
  const phase = rng.range(0, Math.PI * 2);
  const dir = rng.chance(0.5) ? 1 : -1;
  const pts = [];
  for (let th = 0; th <= total; ) {
    const r = r0 + ((rMax - r0) * th) / total;
    pts.push({ x: cx + r * Math.cos(phase + dir * th), y: cy + r * Math.sin(phase + dir * th) });
    th += 2 / r;
  }
  return pts;
}

export function circlePts(cx, cy, r, phase = 0) {
  const n = Math.max(24, Math.round((2 * Math.PI * r) / 2));
  return Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

export function ellipsePts(cx, cy, rx, ry, rot) {
  const n = Math.max(24, Math.round((Math.PI * (rx + ry)) / 2));
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const x = rx * Math.cos(a);
    const y = ry * Math.sin(a);
    return { x: cx + x * c - y * s, y: cy + x * s + y * c };
  });
}

/** Vertices of a polygon / star around (cx, cy). `radii` alternate around the vertices. */
export function radialPolygon(cx, cy, n, radii, rot) {
  return Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * Math.PI * 2;
    const r = radii[i % radii.length];
    return { x: Math.round(cx + r * Math.cos(a)), y: Math.round(cy + r * Math.sin(a)) };
  });
}

/** Smooth closed blob: spline through points at random radii. */
export function blob(rng, cx, cy, rMin, rMax, n = 8) {
  const rot = rng.range(0, Math.PI * 2);
  const ctrl = Array.from({ length: n }, (_, i) => {
    const a = rot + ((i + rng.range(-0.18, 0.18)) / n) * Math.PI * 2;
    const r = rng.range(rMin, rMax);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
  return catmullRom(ctrl, { closed: true, step: 2 });
}

export { inset };
