// Small helpers shared by several tasks.

/** Place circles of the given radii inside `area` without overlap (rejection sampling). */
export function placeCircles(rng, area, radii, gap = 14) {
  const out = [];
  for (const r of radii) {
    let placed = false;
    for (let k = 0; k < 5000 && !placed; k++) {
      const x = Math.round(rng.range(area.x + r + 4, area.x + area.w - r - 4));
      const y = Math.round(rng.range(area.y + r + 4, area.y + area.h - r - 4));
      if (out.every((c) => Math.hypot(c.x - x, c.y - y) >= c.r + r + gap)) {
        out.push({ x, y, r });
        placed = true;
      }
    }
    if (!placed) throw new Error('could not place circles');
  }
  return out;
}

export const inCircle = (p, c) => Math.hypot(p.x - c.x, p.y - c.y) <= c.r;

/** Each stray click / wrong key costs `per` of the score. */
export const penalty = (mistakes, per = 0.25) => Math.max(0, 1 - per * mistakes);

export const move = (p) => ({ type: 'move', x: Math.round(p.x), y: Math.round(p.y) });
