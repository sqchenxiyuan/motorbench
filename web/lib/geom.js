// Geometry helpers shared by tasks and scoring.

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const P = (x, y) => ({ x, y });

/** Distance from p to segment ab, plus the projection parameter t in [0,1]. */
export function distPointSeg(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return { d: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)), t };
}

/**
 * Points along the straight segment a -> b, spaced at most `step` apart.
 * Excludes a, includes b. The pointer is assumed to travel in a straight line
 * between two consecutive positions, so scoring walks every segment this way and
 * does not depend on how densely the browser happened to deliver move events.
 */
export function* walk(a, b, step) {
  const d = dist(a, b);
  if (d === 0) return;
  const n = Math.ceil(d / step);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    yield { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
}

/** A polyline with arc-length parametrisation. `closed` joins the last point to the first. */
export class Path {
  constructor(pts, closed = false) {
    this.closed = closed;
    this.pts = closed ? [...pts, pts[0]] : pts.slice();
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + dist(this.pts[i - 1], this.pts[i]));
    this.length = this.cum[this.cum.length - 1];
  }

  get start() {
    return this.pts[0];
  }

  get end() {
    return this.pts[this.pts.length - 1];
  }

  _norm(s) {
    if (this.closed) return ((s % this.length) + this.length) % this.length;
    return clamp(s, 0, this.length);
  }

  _segAt(s) {
    let lo = 0;
    let hi = this.cum.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  pointAt(s) {
    s = this._norm(s);
    const i = this._segAt(s);
    const a = this.pts[i];
    const b = this.pts[i + 1];
    const segLen = this.cum[i + 1] - this.cum[i];
    const t = segLen === 0 ? 0 : (s - this.cum[i]) / segLen;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  /**
   * Nearest point on the path to p, as arc length s and distance d.
   * With a window, only the part of the path with sMin <= s <= sMax is considered
   * (open paths only).
   */
  project(p, sMin = -Infinity, sMax = Infinity) {
    let best = { s: clamp(sMin, 0, this.length), d: Infinity };
    for (let i = 0; i < this.pts.length - 1; i++) {
      const s0 = this.cum[i];
      const s1 = this.cum[i + 1];
      if (s1 < sMin || s0 > sMax) continue;
      const a = this.pts[i];
      const b = this.pts[i + 1];
      const r = distPointSeg(p, a, b);
      let s = s0 + r.t * (s1 - s0);
      let d = r.d;
      if (s < sMin || s > sMax) {
        s = clamp(s, sMin, sMax);
        const t = s1 === s0 ? 0 : (s - s0) / (s1 - s0);
        d = Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.y - (a.y + (b.y - a.y) * t));
      }
      if (d < best.d) best = { s, d };
    }
    return best;
  }

  /** Points of the sub-path between arc lengths s0 <= s1 (open interval, no wrap). */
  slice(s0, s1) {
    s0 = clamp(s0, 0, this.length);
    s1 = clamp(s1, 0, this.length);
    if (s1 <= s0) return [];
    const out = [this.pointAt(s0)];
    for (let i = this._segAt(s0) + 1; i < this.pts.length && this.cum[i] < s1; i++) out.push(this.pts[i]);
    out.push(this.pointAt(s1));
    return out;
  }
}

/** Uniform Catmull-Rom spline through ctrl points, sampled about every `step` px. */
export function catmullRom(ctrl, { closed = false, step = 2 } = {}) {
  const n = ctrl.length;
  const at = (i) => {
    if (closed) return ctrl[((i % n) + n) % n];
    if (i < 0) return { x: 2 * ctrl[0].x - ctrl[1].x, y: 2 * ctrl[0].y - ctrl[1].y };
    if (i >= n) return { x: 2 * ctrl[n - 1].x - ctrl[n - 2].x, y: 2 * ctrl[n - 1].y - ctrl[n - 2].y };
    return ctrl[i];
  };
  const out = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const m = Math.max(2, Math.ceil((dist(p1, p2) * 1.5) / step));
    for (let k = 0; k < m; k++) {
      const t = k / m;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  if (!closed) out.push({ ...ctrl[n - 1] });
  return out;
}

/** Ramer-Douglas-Peucker simplification of an open polyline. */
export function rdp(pts, eps) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let worst = -1;
    let worstD = eps;
    for (let i = i0 + 1; i < i1; i++) {
      const d = distPointSeg(pts[i], pts[i0], pts[i1]).d;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i0, worst], [worst, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Distance from point p to an axis-aligned rectangle (0 inside). */
export function distRect(p, r) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export const round1 = (v) => Math.round(v * 10) / 10;
export const round3 = (v) => Math.round(v * 1000) / 1000;
