// Pure game logic for Wall Fit: pieces, the 24 turns, what the wall asks for.
// No three.js here so node can test it (test_fit.mjs).

// index 0 = white (no colour), 1..5 = side colours
export const COLOURS = [0xe8e8f0, 0xff5a4e, 0x35c9ff, 0xffd23f, 0x7be36a, 0xc77dff];

function mul(a, b) {
  const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    for (let k = 0; k < 3; k++) r[i][j] += a[i][k] * b[k][j];
  return r;
}

// The 24 ways a cube can sit axis-aligned, as integer 3x3 matrices.
export const ROTS = (() => {
  const X = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
  const Y = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]];
  const seen = new Map();
  let frontier = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]]];
  while (frontier.length) {
    const next = [];
    for (const m of frontier) {
      const k = JSON.stringify(m);
      if (seen.has(k)) continue;
      seen.set(k, m);
      next.push(mul(X, m), mul(Y, m));
    }
    frontier = next;
  }
  return [...seen.values()];
})();

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Grow a random connected cluster of n cubes, centred on the bounding-box middle.
// Returns [{p:[x,y,z]}]
export function genPiece(n, rng) {
  const cells = [[0, 0, 0]];
  const has = (p) => cells.some((q) => q[0] === p[0] && q[1] === p[1] && q[2] === p[2]);
  const D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  let guard = 0;
  while (cells.length < n && guard++ < 1000) {
    const b = cells[Math.floor(rng() * cells.length)];
    const d = D[Math.floor(rng() * 6)];
    const p = [b[0] + d[0], b[1] + d[1], b[2] + d[2]];
    // keep it within 3 cubes each way so it stays hand sized
    const all = cells.concat([p]);
    let ok = !has(p);
    for (let a = 0; a < 3 && ok; a++) {
      const v = all.map((q) => q[a]);
      if (Math.max(...v) - Math.min(...v) > 2) ok = false;
    }
    if (ok) cells.push(p);
  }
  const mid = [0, 1, 2].map((a) => {
    const v = cells.map((q) => q[a]);
    return (Math.max(...v) + Math.min(...v)) / 2;
  });
  return cells.map((q) => ({ p: [q[0] - mid[0], q[1] - mid[1], q[2] - mid[2]] }));
}

// The outline the wall sees when the piece sits in turn `rot`.
// Returns [{x, y}] centred on 0,0 (cube units, may be half numbers).
export function project(piece, rot) {
  const seen = new Map();
  for (const cell of piece) {
    const x = rot[0][0] * cell.p[0] + rot[0][1] * cell.p[1] + rot[0][2] * cell.p[2];
    const y = rot[1][0] * cell.p[0] + rot[1][1] * cell.p[1] + rot[1][2] * cell.p[2];
    seen.set(x + ',' + y, { x, y });
  }
  return [...seen.values()];
}

// Sides of the piece, in the piece's own frame, in three.js box-face order.
export const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Which side of the piece meets the wall first in turn `rot`.
// The wall arrives from -z, so it is the side whose direction turns into (0,0,-1).
export function sideFacingWall(rot) {
  // R * d = (0,0,-1)  =>  d = -(third row of R)
  const d = [-rot[2][0], -rot[2][1], -rot[2][2]];
  return SIDES.findIndex((s) => s[0] === d[0] && s[1] === d[1] && s[2] === d[2]);
}

// Fingerprint of what the wall checks: the outline, plus (when sides are coloured)
// the colour of the side that meets the wall. sides[i] = 0 means white.
export function key(piece, sides, rot) {
  const shape = project(piece, rot).map((q) => q.x + ',' + q.y).sort().join('|');
  return shape + '#' + sides[sideFacingWall(rot)];
}

// How many sides carry a colour at each level: white first, then one side, then more.
export function colouredSides(level) {
  if (level < 5) return 0;
  return Math.min(1 + Math.floor((level - 5) / 4), 5);
}

// Make one round: a piece, its side colours, the turn the wall is cut for,
// and a start turn that does NOT fit.
export function makeRound(level, rng) {
  const n = Math.min(2 + Math.floor((level + 1) / 2), 7);
  const nSides = colouredSides(level);
  for (let attempt = 0; attempt < 500; attempt++) {
    const piece = genPiece(n, rng);
    if (!nSides) { const lr = looseRound(piece, rng); if (lr) return lr; continue; }
    const sides = [0, 0, 0, 0, 0, 0];
    const order = [0, 1, 2, 3, 4, 5].sort(() => rng() - 0.5);
    for (let i = 0; i < nSides; i++) sides[order[i]] = 1 + i;   // colour 1..5, each used once
    const target = Math.floor(rng() * 24);
    // once sides are coloured, the wall always asks for a coloured side
    if (nSides && sides[sideFacingWall(ROTS[target])] === 0) continue;
    const want = key(piece, sides, ROTS[target]);
    const fits = ROTS.map((r) => key(piece, sides, r) === want);
    const wrong = fits.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
    if (!wrong.length) continue; // every turn fits: no puzzle, try another piece
    const start = wrong[Math.floor(rng() * wrong.length)];
    return {
      piece, sides, target, start, want,
      hole: project(piece, ROTS[target]),
      holeColour: sides[sideFacingWall(ROTS[target])],
      fitCount: fits.filter(Boolean).length,
    };
  }
  throw new Error('no puzzle found');
}

// Does the piece, sitting in turn index `rotIndex`, satisfy the round?
// A shapeOnly round (the glass sheet) checks the outline and ignores colour.
export function fitsRound(round, rotIndex) {
  if (round.loose) return looseFit(round, rotIndex).length > 0;
  const k = key(round.piece, round.sides, ROTS[rotIndex]);
  return round.shapeOnly ? k.split('#')[0] === round.want.split('#')[0] : k === round.want;
}

// The request a wall makes when it is cut for one known turn of an existing piece.
export function demandFor(piece, sides, rotIndex, shapeOnly = false) {
  return {
    piece, sides, shapeOnly, target: rotIndex,
    want: key(piece, sides, ROTS[rotIndex]),
    hole: project(piece, ROTS[rotIndex]),
    holeColour: shapeOnly ? 0 : sides[sideFacingWall(ROTS[rotIndex])],
  };
}

// A second wall's request of a piece that already exists (two walls in one round).
// Returns null if no coloured side can be asked for.
export function makeDemand(piece, sides, rng) {
  const anyColour = sides.some((c) => c);
  for (let attempt = 0; attempt < 100; attempt++) {
    const target = Math.floor(rng() * 24);
    if (anyColour && sides[sideFacingWall(ROTS[target])] === 0) continue;
    return {
      piece, sides, target,
      want: key(piece, sides, ROTS[target]),
      hole: project(piece, ROTS[target]),
      holeColour: sides[sideFacingWall(ROTS[target])],
    };
  }
  return null;
}

// A round for a piece whose cells are already decided (a real object from the item library).
// Same rules as makeRound: coloured sides by level, a turn that fits, and a start that does not.
export function roundFor(cells, level, rng) {
  const mid = [0, 1, 2].map((a) => { const v = cells.map((q) => q[a]); return (Math.max(...v) + Math.min(...v)) / 2; });
  const piece = cells.map((q) => ({ p: [q[0] - mid[0], q[1] - mid[1], q[2] - mid[2]] }));
  const nSides = colouredSides(level);
  if (!nSides) { const lr = looseRound(piece, rng); if (lr) return lr; }
  for (let attempt = 0; attempt < 500; attempt++) {
    const sides = [0, 0, 0, 0, 0, 0];
    const order = [0, 1, 2, 3, 4, 5].sort(() => rng() - 0.5);
    for (let i = 0; i < nSides; i++) sides[order[i]] = 1 + i;
    const target = Math.floor(rng() * 24);
    if (nSides && sides[sideFacingWall(ROTS[target])] === 0) continue;
    const want = key(piece, sides, ROTS[target]);
    const fits = ROTS.map((r) => key(piece, sides, r) === want);
    const wrong = fits.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0);
    if (!wrong.length) continue;
    return {
      piece, sides, target, want, start: wrong[Math.floor(rng() * wrong.length)],
      hole: project(piece, ROTS[target]),
      holeColour: sides[sideFacingWall(ROTS[target])],
      fitCount: fits.filter(Boolean).length,
    };
  }
  // a single cube with no coloured side goes through every way round: a free gift (half an apple)
  if (!nSides) { const target = Math.floor(rng() * 24); return { piece, sides: [0, 0, 0, 0, 0, 0], target, loose: true, free: true, hole: project(piece, ROTS[target]), holeColour: 0, want: '', start: target, fitCount: 24 }; }
  throw new Error('no puzzle found');
}

// AN UNTINTED OPENING DOES NOT CARE HOW YOU HOLD THE THING, only whether it physically goes through.
// For the piece in turn `rotIndex`, the sideways shifts (in cells) at which every part of its outline
// lies inside the opening. Empty = it does not go through that way round.
export function looseFit(round, rotIndex) {
  const H = new Set(round.hole.map((q) => q.x + ',' + q.y)), P = project(round.piece, ROTS[rotIndex]), out = [];
  for (const hc of round.hole) {
    const dx = hc.x - P[0].x, dy = hc.y - P[0].y;
    if (P.every((q) => H.has((q.x + dx) + ',' + (q.y + dy)))) out.push([dx, dy]);
  }
  return out;
}
// The opening for an untinted round: cut for the SLIMMEST way the piece can be turned, so there is
// still something to work out (a bottle must go end-on, not sideways). Returns a finished round, or null.
function looseRound(piece, rng) {
  const sizes = ROTS.map((r) => project(piece, r).length), least = Math.min(...sizes);
  const slim = sizes.map((n, i) => (n === least ? i : -1)).filter((i) => i >= 0);
  const target = slim[Math.floor(rng() * slim.length)];
  const round = { piece, sides: [0, 0, 0, 0, 0, 0], target, loose: true, hole: project(piece, ROTS[target]), holeColour: 0, want: '' };
  const fits = ROTS.map((r, i) => looseFit(round, i).length > 0), wrong = fits.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0);
  if (!wrong.length) return null;                       // it goes through every way round: no puzzle
  round.start = wrong[Math.floor(rng() * wrong.length)];
  round.fitCount = fits.filter(Boolean).length;
  return round;
}
