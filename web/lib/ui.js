// Canvas drawing helpers and the shared colour theme.

export const C = {
  bg: '#f3f4f6',
  panel: '#ffffff',
  ink: '#111827',
  muted: '#6b7280',
  line: '#d1d5db',
  blue: '#2563eb',
  blueSoft: '#bfdbfe',
  blueFaint: '#e0e7ff',
  green: '#16a34a',
  greenSoft: '#86efac',
  red: '#dc2626',
  redSoft: '#fecaca',
  gray: '#cbd5e1',
  amber: '#f59e0b',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const MONO = 'ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';

export function circle(g, x, y, r, fill, stroke, lw = 2) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = lw;
    g.stroke();
  }
}

export function stroke(g, pts, { color, width = 2, dash = null, closed = false, cap = 'round', join = 'round' }) {
  if (pts.length < 2) return;
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  if (closed) g.closePath();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = cap;
  g.lineJoin = join;
  g.setLineDash(dash || []);
  g.stroke();
  g.setLineDash([]);
}

export function fillPoly(g, pts, color) {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.closePath();
  g.fillStyle = color;
  g.fill();
}

export function rect(g, r, { fill, color, width = 2, dash = null, radius = 0 }) {
  g.beginPath();
  if (radius) g.roundRect(r.x, r.y, r.w, r.h, radius);
  else g.rect(r.x, r.y, r.w, r.h);
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (color) {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.setLineDash(dash || []);
    g.stroke();
    g.setLineDash([]);
  }
}

/** With maxWidth, text that would be wider is condensed horizontally to fit. */
export function text(g, str, x, y, { size = 16, color = C.ink, align = 'left', baseline = 'alphabetic', weight = 400, font = FONT, maxWidth } = {}) {
  g.font = `${weight} ${size}px ${font}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = baseline;
  if (maxWidth) g.fillText(str, x, y, maxWidth);
  else g.fillText(str, x, y);
}

export function check(g, x, y, size, color = '#fff') {
  g.beginPath();
  g.moveTo(x - size * 0.45, y + size * 0.02);
  g.lineTo(x - size * 0.12, y + size * 0.34);
  g.lineTo(x + size * 0.48, y - size * 0.32);
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.5, size * 0.18);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke();
}

/** A standard arrow pointer with its hotspot at (x, y). */
export function drawCursor(g, x, y) {
  const s = [
    [0, 0],
    [0, 16.5],
    [4, 13],
    [7, 19.5],
    [9.6, 18.4],
    [6.6, 12],
    [11.8, 12],
  ];
  g.beginPath();
  g.moveTo(x + s[0][0], y + s[0][1]);
  for (let i = 1; i < s.length; i++) g.lineTo(x + s[i][0], y + s[i][1]);
  g.closePath();
  g.fillStyle = '#000';
  g.fill();
  g.strokeStyle = '#fff';
  g.lineWidth = 1.2;
  g.lineJoin = 'round';
  g.stroke();
}
