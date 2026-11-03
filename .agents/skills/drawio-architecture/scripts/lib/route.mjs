// Orthogonal router for edges that are kept out of the automatic layout
// ("loose" edges, for example replication between two availability zones).
// The layout places everything first; these edges are then threaded through the
// free space: around shapes and their labels, away from edges already drawn.
const MARGIN = 14;                 // clearance kept from shapes
const TURN = 40, CROSS = 14, PORT_BUSY = 30, NEAR = 8;

class Heap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

const inflate = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];            // right, down, left, up
const SIDES = [                                              // side -> outward direction index and port position
  { d: 0, at: (r, f) => ({ x: r.x + r.w, y: r.y + r.h * f }) },
  { d: 1, at: (r, f) => ({ x: r.x + r.w * f, y: r.y + r.h }) },
  { d: 2, at: (r, f) => ({ x: r.x, y: r.y + r.h * f }) },
  { d: 3, at: (r, f) => ({ x: r.x + r.w * f, y: r.y }) },
];

/** True when the open segment a-b passes through the inside of rectangle r. */
function cuts(r, a, b) {
  if (a.y === b.y) return a.y > r.y && a.y < r.y + r.h && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.w;
  return a.x > r.x && a.x < r.x + r.w && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.h;
}
const within = (r, p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

/**
 * source/target: { rect, labelSide } in absolute pixels (labelSide: "below", "right" or null).
 * obstacles: rectangles to stay clear of (shapes and labels, not containers).
 * segments: [[p, q], ...] of edges already drawn. usedPorts: their end points.
 * Returns an array of points from the source border to the target border, or null.
 */
export function routeLoose({ source, target, obstacles, segments, usedPorts, bounds }) {
  const blocks = [...obstacles.map(o => inflate(o.rect, o.pad ?? MARGIN))];
  const ports = (end) => {
    const out = [];
    for (let s = 0; s < 4; s++) {
      if ((s === 1 && end.labelSide === "below") || (s === 0 && end.labelSide === "right")) continue;   // never leave through the node's own label
      for (const f of [0.5, 0.25, 0.75]) {
        const p = SIDES[s].at(end.rect, f);
        const p0 = { x: Math.round(p.x), y: Math.round(p.y) };
        const stub = { x: p0.x + DIRS[s][0] * MARGIN, y: p0.y + DIRS[s][1] * MARGIN };
        if (blocks.some(b => within(b, stub))) continue;
        const busy = usedPorts.some(u => Math.abs(u.x - p0.x) < NEAR && Math.abs(u.y - p0.y) < NEAR);
        out.push({ port: p0, stub, d: s, cost: MARGIN + (busy ? PORT_BUSY : 0) + (f === 0.5 ? 0 : 6) });
      }
    }
    return out;
  };
  const from = ports(source), to = ports(target);
  if (!from.length || !to.length) return null;

  const xs = new Set([bounds.x - 30, bounds.x + bounds.w + 30]), ys = new Set([bounds.y - 30, bounds.y + bounds.h + 30]);
  for (const b of blocks) { xs.add(b.x); xs.add(b.x + b.w); ys.add(b.y); ys.add(b.y + b.h); }
  for (const p of [...from, ...to]) { xs.add(p.stub.x); ys.add(p.stub.y); }
  for (const [p, q] of segments) { if (p.x === q.x) { xs.add(p.x - 12); xs.add(p.x + 12); } else if (p.y === q.y) { ys.add(p.y - 12); ys.add(p.y + 12); } }
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b);
  const nx = X.length, ny = Y.length;
  const xi = new Map(X.map((v, i) => [v, i])), yi = new Map(Y.map((v, i) => [v, i]));
  const free = new Uint8Array(nx * ny);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) free[i * ny + j] = blocks.some(b => within(b, { x: X[i], y: Y[j] })) ? 0 : 1;

  const hSeg = segments.filter(([p, q]) => p.y === q.y), vSeg = segments.filter(([p, q]) => p.x === q.x);
  const stepCost = (a, b) => {
    let c = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (a.y === b.y) {
      const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
      for (const [p, q] of hSeg) if (Math.abs(p.y - a.y) < NEAR) { const o = Math.min(hi, Math.max(p.x, q.x)) - Math.max(lo, Math.min(p.x, q.x)); if (o > 0) c += o * 5; }
      for (const [p, q] of vSeg) if (p.x > lo && p.x < hi && a.y > Math.min(p.y, q.y) && a.y < Math.max(p.y, q.y)) c += CROSS;
    } else {
      const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
      for (const [p, q] of vSeg) if (Math.abs(p.x - a.x) < NEAR) { const o = Math.min(hi, Math.max(p.y, q.y)) - Math.max(lo, Math.min(p.y, q.y)); if (o > 0) c += o * 5; }
      for (const [p, q] of hSeg) if (p.y > lo && p.y < hi && a.x > Math.min(p.x, q.x) && a.x < Math.max(p.x, q.x)) c += CROSS;
    }
    return c;
  };

  // Dijkstra over (grid point, direction of travel); the extra state "5" marks arrival at a target port.
  const N = nx * ny;
  const best = new Float64Array(N * 4 + to.length).fill(Infinity);
  const prev = new Int32Array(N * 4 + to.length).fill(-1);
  const heap = new Heap();
  const key = (i, j, d) => (i * ny + j) * 4 + d;
  for (const s of from) {
    const i = xi.get(s.stub.x), j = yi.get(s.stub.y);
    if (i == null || j == null || !free[i * ny + j]) continue;
    const k = key(i, j, s.d);
    if (s.cost < best[k]) { best[k] = s.cost; prev[k] = -2 - from.indexOf(s); heap.push(s.cost, k); }
  }
  const goalAt = new Map();
  to.forEach((t, n) => { const i = xi.get(t.stub.x), j = yi.get(t.stub.y); if (i != null && j != null && free[i * ny + j]) { const g = i * ny + j; if (!goalAt.has(g)) goalAt.set(g, []); goalAt.get(g).push(n); } });
  let end = -1;
  while (heap.size) {
    const [cost, k] = heap.pop();
    if (cost > best[k]) continue;
    if (k >= N * 4) { end = k; break; }
    const cell = k >> 2, d = k & 3, i = Math.floor(cell / ny), j = cell % ny;
    for (const n of goalAt.get(cell) ?? []) {
      const t = to[n], inward = (t.d + 2) % 4;
      const c = cost + t.cost + (d === inward ? 0 : TURN);
      if (c < best[N * 4 + n]) { best[N * 4 + n] = c; prev[N * 4 + n] = k; heap.push(c, N * 4 + n); }
    }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue;                       // no U-turns
      const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny || !free[ni * ny + nj]) continue;
      const a = { x: X[i], y: Y[j] }, b = { x: X[ni], y: Y[nj] };
      if (blocks.some(r => cuts(r, a, b))) continue;
      const c = cost + stepCost(a, b) + (nd === d ? 0 : TURN);
      const nk = key(ni, nj, nd);
      if (c < best[nk]) { best[nk] = c; prev[nk] = k; heap.push(c, nk); }
    }
  }
  if (end < 0) return null;
  const t = to[end - N * 4];
  const pts = [t.port, t.stub];
  let k = prev[end];
  for (;;) {
    const cell = k >> 2;
    pts.push({ x: X[Math.floor(cell / ny)], y: Y[cell % ny] });
    const p = prev[k];
    if (p <= -2) { pts.push(from[-2 - p].port); break; }
    k = p;
  }
  pts.reverse();
  const out = [];
  for (const p of pts) {                                       // drop repeats and points in the middle of a straight run
    const n = out.length;
    if (n && out[n - 1].x === p.x && out[n - 1].y === p.y) continue;
    if (n >= 2 && ((out[n - 2].x === out[n - 1].x && out[n - 1].x === p.x) || (out[n - 2].y === out[n - 1].y && out[n - 1].y === p.y))) out[n - 1] = p; else out.push(p);
  }
  return out;
}

/** Where to put a label of the given size on a routed line: the middle of the longest segment that has room. */
export function placeLabel(pts, size, taken) {
  const segs = [];
  for (let i = 0; i + 1 < pts.length; i++) segs.push({ a: pts[i], b: pts[i + 1], len: Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y) });
  segs.sort((p, q) => q.len - p.len);
  const hit = (r) => taken.some(o => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h);
  for (const s of segs) {
    for (const f of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const c = { x: s.a.x + (s.b.x - s.a.x) * f, y: s.a.y + (s.b.y - s.a.y) * f };
      const r = { x: c.x - size.w / 2, y: c.y - size.h / 2, w: size.w, h: size.h };
      if (s.len >= Math.max(size.w, size.h) + 8 && !hit(r)) return c;
    }
  }
  const s = segs[0];
  return { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
}
