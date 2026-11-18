// Path-following scorer shared by trace-path, trace-outline and draw-trace.
//
// The pointer trajectory is consumed as straight segments and walked in sub-pixel
// steps, so a "teleporting" pointer cannot skip anything and the result does not
// depend on how many move events the browser delivered.
import { dist, walk } from './geom.js';

const STEP = 1.5;

/**
 * Coverage of a path by a pointer (or pen) that should stay within halfW of it.
 *
 *   coverage  share of the path that an on-band pointer has passed over. The path is
 *             cut into small bins; an on-band position covers the bins within `foot`
 *             px (arc length) of its projection.
 *   accuracy  on-band travel / total travel, i.e. how much of the way was on the band.
 *
 * Options:
 *   start  { x, y, near }  Tracking begins at the first on-band position after the
 *          pointer has come within `near` px of this point, so how the pointer gets
 *          to the start is free, and so is off-band travel inside that neighbourhood.
 *          Without `start`, tracking is on from the beginning.
 *   discs  [{ x, y, r }]   Extra regions that count as on-band (end markers that are
 *          drawn larger than the band).
 */
export class CoverageTracker {
  constructor(path, halfW, { bin = 3, foot = halfW, start = null, discs = [] } = {}) {
    Object.assign(this, { path, halfW, foot, start, discs });
    this.nb = Math.max(1, Math.round(path.length / bin));
    this.binLen = path.length / this.nb;
    this.covered = new Uint8Array(this.nb);
    this.count = 0;
    this.on = 0;
    this.off = 0;
    this.primed = !start; // has been near the start
    this.armed = !start; // tracking has begun
  }

  /** Feed one pointer segment (prev may be null for the very first position). */
  feed(prev, cur) {
    if (!prev) return this._point(cur, 0);
    let last = prev;
    for (const q of walk(prev, cur, STEP)) {
      this._point(q, dist(last, q));
      last = q;
    }
  }

  _point(q, stepLen) {
    const near = !!this.start && dist(q, this.start) <= this.start.near;
    if (near) this.primed = true;
    const pr = this.path.project(q);
    const onBand = pr.d <= this.halfW;
    const inside = onBand || this.discs.some((c) => dist(q, c) <= c.r);
    if (!this.armed) {
      if (!(this.primed && inside)) return;
      this.armed = true;
    }
    if (!inside) {
      if (!near) this.off += stepLen;
      return;
    }
    this.on += stepLen;
    if (!onBand) return;
    const lo = Math.ceil((pr.s - this.foot) / this.binLen - 0.5);
    const hi = Math.floor((pr.s + this.foot) / this.binLen - 0.5);
    for (let i = lo; i <= hi; i++) {
      let k = i;
      if (this.path.closed) k = ((i % this.nb) + this.nb) % this.nb;
      else if (k < 0 || k >= this.nb) continue;
      if (!this.covered[k]) {
        this.covered[k] = 1;
        this.count++;
      }
    }
  }

  get full() {
    return this.count === this.nb;
  }

  get coverage() {
    return this.count / this.nb;
  }

  get accuracy() {
    const total = this.on + this.off;
    return total > 0 ? this.on / total : 0;
  }

  /** Covered stretches as [s0, s1] arc-length runs, for drawing. */
  runs() {
    const out = [];
    let start = -1;
    for (let i = 0; i <= this.nb; i++) {
      const c = i < this.nb && this.covered[i];
      if (c && start < 0) start = i;
      if (!c && start >= 0) {
        out.push([start * this.binLen, i * this.binLen]);
        start = -1;
      }
    }
    return out;
  }
}
