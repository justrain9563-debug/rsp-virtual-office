// Original procedural pixel art for the RSP office: floors, walls and furniture.
import { MAP, MAP_H, MAP_W, isWall, type Floor, type MapObject } from '@shared/map';
import { Pix, SCALE, hash, shade, text, textCentered, textWidth } from './pixel';

const T = 16; // art pixels per tile
const NAVY = '#123a6b', ORANGE = '#f26b1d', OUT = '#1b1626';

// ------------------------------------------------------------------ floors & walls

const FLOOR_BASE: Record<Floor, string> = {
  void: '#0b1220', wood: '#b9824d', woodDark: '#7a4b2c', carpetBlue: '#3d5f8e', carpetTeal: '#2f7472',
  carpetGray: '#8d929b', carpetWine: '#7a3346', carpetGreen: '#4c7a4a', tile: '#efe6d2', concrete: '#9b9a93', marble: '#e7e2d8',
};

function floorTile(p: Pix, f: Floor, tx: number, ty: number) {
  const base = FLOOR_BASE[f];
  p.r(0, 0, T, T, base);
  switch (f) {
    case 'wood': case 'woodDark': {
      for (let row = 0; row < 4; row++) {
        const y = row * 4;
        p.r(0, y + 3, T, 1, shade(base, -0.22));
        const seam = Math.floor(hash(tx, ty * 4 + row) * 16);
        p.r(seam, y, 1, 3, shade(base, -0.18));
        for (let i = 0; i < 3; i++) { const gx = Math.floor(hash(tx + i, ty + row, 3) * 16); p.set(gx, y + 1, shade(base, 0.08)); }
        if (row % 2) p.r(0, y, T, 1, shade(base, 0.06));
      }
      break;
    }
    case 'carpetBlue': case 'carpetTeal': case 'carpetGray': case 'carpetWine': case 'carpetGreen': {
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        if ((x + y) % 4 === 0) p.set(x, y, shade(base, 0.07));
        else if (hash(tx * 16 + x, ty * 16 + y) > 0.9) p.set(x, y, shade(base, -0.08));
      }
      break;
    }
    case 'tile': {
      const alt = (tx + ty) % 2 === 0;
      p.r(0, 0, T, T, alt ? '#f3ecdc' : '#d8ccb2');
      p.r(0, T - 1, T, 1, '#c4b796'); p.r(T - 1, 0, 1, T, '#c4b796');
      p.set(2, 2, '#ffffff'); p.set(3, 2, '#ffffff');
      break;
    }
    case 'concrete': {
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        const n = hash(tx * 16 + x, ty * 16 + y, 7);
        if (n > 0.85) p.set(x, y, shade(base, -0.1)); else if (n < 0.08) p.set(x, y, shade(base, 0.1));
      }
      if (tx % 4 === 0) p.r(0, 0, 1, T, shade(base, -0.2));
      if (ty % 4 === 0) p.r(0, 0, T, 1, shade(base, -0.2));
      break;
    }
    case 'marble': {
      p.r(0, 0, T, 1, '#f6f3ee'); p.r(0, 0, 1, T, '#f6f3ee'); p.r(0, T - 1, T, 1, '#cfc8bb'); p.r(T - 1, 0, 1, T, '#cfc8bb');
      if (hash(tx, ty, 9) < 0.35) {
        let vx = Math.floor(hash(tx, ty) * 10) + 3;
        for (let y = 3; y < T - 3; y++) { if (hash(tx, ty * 16 + y, 5) > 0.7) vx += hash(tx, y) > 0.5 ? 1 : -1; p.set(vx, y, '#ddd7cc'); }
      }
      break;
    }
  }
}

const WALL_TOP = '#2c3445', WALL_FACE = '#e9e2d3', WALL_FACE_D = '#d6cdb9';

function wallTile(p: Pix, tx: number, ty: number) {
  const below = !isWall(tx, ty + 1);
  if (below) {
    // front face: cap, painted wall, brand stripe, baseboard
    p.r(0, 0, T, 4, WALL_TOP);
    p.r(0, 3, T, 1, '#454f63');
    p.r(0, 4, T, 12, WALL_FACE);
    p.r(0, 4, T, 1, '#f5f0e6');
    p.r(0, 10, T, 1, NAVY);
    p.r(0, 11, T, 1, ORANGE);
    p.r(0, 13, T, 3, '#6b5a4a');
    p.r(0, 13, T, 1, '#85725f');
    if (isWall(tx - 1, ty) && isWall(tx - 1, ty + 1)) p.r(0, 4, 1, 9, WALL_FACE_D);
  } else {
    p.r(0, 0, T, T, WALL_TOP);
    for (let i = 0; i < 6; i++) p.set(Math.floor(hash(tx, ty, i) * 16), Math.floor(hash(ty, tx, i) * 16), '#353e51');
    if (!isWall(tx - 1, ty)) p.r(0, 0, 1, T, '#56617a');
    if (!isWall(tx + 1, ty)) p.r(T - 1, 0, 1, T, '#56617a');
    if (!isWall(tx, ty - 1)) p.r(0, 0, T, 1, '#56617a');
  }
}

/** One big canvas with every floor and wall tile (static background layer). */
export function renderBackground(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = MAP_W * T * SCALE;
  c.height = MAP_H * T * SCALE;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, c.width, c.height);
  for (let ty = 0; ty < MAP_H; ty++)
    for (let tx = 0; tx < MAP_W; tx++) {
      const p = new Pix(T, T);
      if (MAP.wall[ty][tx]) {
        // walls that only touch void stay dark
        let near = false;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (!isWall(tx + i, ty + j)) near = true;
        if (!near) continue;
        wallTile(p, tx, ty);
      } else {
        floorTile(p, MAP.floor[ty][tx], tx, ty);
        if (isWall(tx, ty - 1)) p.r(0, 0, T, 2, 'rgba(0,0,0,0.18)'); // shadow under walls
      }
      p.draw(ctx, tx * T * SCALE, ty * T * SCALE);
    }
  return c;
}

// ------------------------------------------------------------------ objects

const BOX = '#c9a26b', BOX_D = '#a37e4b';
const WOOD = '#c48c55', WOOD_D = '#8a5a30';

function monitor(p: Pix, x: number, y: number, w = 10, screen = '#4aa3df') {
  p.r(x, y, w, 7, '#1f2430');
  p.r(x + 1, y + 1, w - 2, 5, screen);
  p.r(x + 1, y + 1, w - 2, 1, shade(screen, 0.35));
  p.set(x + 2, y + 3, '#ffffff'); p.r(x + 2, y + 4, Math.max(1, w - 6), 1, shade(screen, -0.25));
  p.r(x + Math.floor(w / 2) - 1, y + 7, 2, 2, '#3a3f4b');
}
function cardboard(p: Pix, x: number, y: number, w: number, h: number, tapeColor = '#d9c39a') {
  p.box(x, y, w, h, BOX, BOX_D);
  p.r(x + 1, y + 1, w - 2, 2, shade(BOX, 0.15));
  p.r(x + Math.floor(w / 2), y + 1, 1, h - 2, tapeColor);
}

type Drawer = (p: Pix, o: MapObject, W: number, H: number, top: number, label: string) => void;

const DRAW: Partial<Record<MapObject['type'], Drawer>> = {
  desk(p, o, W, H, top) {
    const t = top - 2;
    p.r(1, t, W - 2, 10, WOOD); p.r(1, t, W - 2, 1, shade(WOOD, 0.25));
    p.r(1, t + 10, W - 2, 4, WOOD_D); p.r(2, t + 14, 2, H - t - 15, '#5c3b1f'); p.r(W - 4, t + 14, 2, H - t - 15, '#5c3b1f');
    if (o.variant === 2) { monitor(p, 3, t - 6, 12, '#3fb68b'); monitor(p, 17, t - 6, 12, '#4aa3df'); }
    else monitor(p, 11, t - 6, 11, o.variant === 1 ? '#f2a65a' : '#4aa3df');
    p.r(11, t + 5, 10, 2, '#e5e7eb'); p.r(11, t + 6, 10, 1, '#c7ccd4');
    p.r(23, t + 5, 2, 2, '#e5e7eb');
    if (o.variant === 1) { p.r(3, t + 3, 6, 4, '#2b2f3a'); p.r(3, t + 2, 6, 1, '#4b5263'); p.r(5, t + 4, 2, 1, '#9ca3af'); }
    else { p.r(3, t + 3, 3, 4, '#ffffff'); p.r(3, t + 3, 3, 1, ORANGE); }
    if (o.variant !== 2) { p.r(26, t + 2, 4, 5, '#fafafa'); p.r(27, t + 3, 2, 1, '#9ca3af'); }
  },
  chair(p, o, W, H) {
    const seat = '#2b3f63', back = '#1f2f4c';
    const v = o.variant;
    p.r(4, H - 3, 1, 2, '#333'); p.r(11, H - 3, 1, 2, '#333'); p.r(7, H - 2, 2, 1, '#333');
    if (v === 0) { p.box(3, H - 12, 10, 8, seat); p.box(3, H - 7, 10, 4, back); }
    else if (v === 1) { p.box(3, H - 16, 10, 6, back); p.box(3, H - 11, 10, 8, seat); }
    else if (v === 2) { p.box(3, H - 15, 4, 12, back); p.box(5, H - 12, 8, 8, seat); }
    else { p.box(9, H - 15, 4, 12, back); p.box(3, H - 12, 8, 8, seat); }
  },
  plant(p, o, W, H) {
    p.box(4, H - 8, 8, 7, '#b5562e'); p.r(3, H - 9, 10, 2, '#cf6d3e');
    const leaves = ['#2f8f46', '#3fae5a', '#257238'];
    for (let i = 0; i < 26; i++) {
      const x = 2 + Math.floor(hash(i, o.x, o.y) * 12), y = 2 + Math.floor(hash(o.y, i, 1) * (H - 12));
      p.r(x, y, 2, 2, leaves[i % 3]);
    }
    p.r(7, H - 11, 2, 3, '#257238');
  },
  bigplant(p, o, W, H) {
    p.box(3, H - 9, 10, 8, '#e8e2d6', '#a39d90'); p.r(3, H - 9, 10, 1, '#fff');
    p.r(7, 10, 2, H - 18, '#6b4a2a');
    const leaves = ['#2c8a44', '#3cab58', '#22693a', '#4cc06a'];
    for (let i = 0; i < 18; i++) {
      const x = 1 + Math.floor(hash(i, o.x) * 11), y = 1 + Math.floor(hash(o.y, i) * (H - 16));
      p.oval(x, y, 4, 3, leaves[i % 4]);
    }
  },
  bookshelf(p, o, W, H) {
    p.box(0, 2, W, H - 3, '#6b4423');
    const colors = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ecf0f1', NAVY, ORANGE];
    for (let s = 0; s < 3; s++) {
      const y = 4 + s * 9;
      p.r(1, y + 7, W - 2, 1, '#4a2e16');
      let x = 2;
      while (x < W - 3) {
        const w = 1 + Math.floor(hash(x, s, o.x) * 2), h = 5 + Math.floor(hash(s, x, 2) * 3);
        p.r(x, y + 7 - h, w, h, colors[Math.floor(hash(x, s + o.y) * colors.length)]);
        x += w + (hash(x, s) > 0.85 ? 2 : 0);
      }
    }
  },
  filing(p, o, W, H) {
    p.box(2, 2, 12, H - 3, '#a1a8b3');
    for (let i = 0; i < 3; i++) { p.r(3, 5 + i * 6, 10, 1, '#7d8592'); p.r(6, 7 + i * 6, 4, 1, '#59606c'); }
  },
  printer(p, o, W, H) {
    p.box(1, H - 12, 14, 10, '#e5e7eb', '#9ca3af'); p.r(3, H - 14, 10, 3, '#ffffff'); p.r(2, H - 9, 12, 1, '#4b5563');
    p.set(12, H - 6, '#22c55e'); p.r(3, H - 5, 5, 1, '#9ca3af');
  },
  window(p, o, W) {
    p.r(1, 4, W - 2, 8, '#dfe5ee'); p.r(2, 5, W - 4, 6, '#8ccbef'); p.r(2, 5, W - 4, 2, '#b9e2f7');
    p.r(W / 2, 5, 1, 6, '#dfe5ee'); for (let i = 0; i < 4; i++) p.set(4 + i, 9 - i, '#e6f6ff');
    p.r(0, 12, W, 1, '#c8ccd3');
  },
  whiteboard(p, o, W) {
    p.r(1, 3, W - 2, 9, '#9aa3ad'); p.r(2, 4, W - 4, 7, '#fbfbfb');
    p.r(4, 5, 8, 1, '#2563eb'); p.r(4, 7, 12, 1, '#dc2626'); p.r(18, 5, 1, 4, '#16a34a'); p.r(18, 8, 8, 1, '#16a34a'); p.r(21, 6, 3, 1, ORANGE);
    p.r(3, 12, W - 6, 1, '#6b7280');
  },
  tv(p, o, W) {
    p.r(2, 2, W - 4, 10, '#111827');
    if (o.variant === 1) {
      p.r(3, 3, W - 6, 8, '#0f2a4a');
      const hs = [6, 4, 5, 3, 2];
      hs.forEach((h, i) => p.r(5 + i * 5, 10 - h, 3, h, i === 0 ? ORANGE : '#4aa3df'));
    } else {
      const cols = ['#3b82f6', '#f59e0b', '#10b981', '#ec4899'];
      for (let i = 0; i < 4; i++) { const x = 3 + (i % 2) * 13, y = 3 + Math.floor(i / 2) * 4; p.r(x, y, 12, 3, cols[i]); p.r(x + 5, y + 1, 2, 2, '#fde2c4'); }
    }
  },
  clock(p) {
    p.oval(3, 3, 10, 10, '#1f2937'); p.oval(4, 4, 8, 8, '#ffffff'); p.r(7, 5, 1, 3, '#111'); p.r(8, 7, 2, 1, '#111'); p.set(7, 7, ORANGE);
  },
  logo(p, o, W, _H, _t, label) {
    p.r(0, 2, W, 11, NAVY); p.r(0, 2, W, 1, '#2a5d9c'); p.r(0, 12, W, 1, '#081c35');
    // lightning bolt mark
    const bolt = [[4, 4], [5, 4], [4, 5], [3, 6], [4, 6], [5, 6], [6, 6], [5, 7], [4, 8], [4, 9], [5, 9], [6, 10]];
    bolt.forEach(([x, y]) => p.set(x, y, ORANGE));
    const t = label.slice(0, 14);
    const tw = textWidth(t);
    text(p, t, Math.max(9, Math.round((W + 6 - tw) / 2)), 5, '#ffffff');
    p.r(10, 11, W - 14, 1, ORANGE);
  },
  welcome(p, o, W) {
    p.r(1, 3, W - 2, 9, '#fff7ed'); p.r(1, 3, W - 2, 1, ORANGE); p.r(1, 11, W - 2, 1, ORANGE);
    textCentered(p, 'WELCOME!', W / 2, 5, NAVY);
  },
  deptSign(p, o, W, _H, _t, label) {
    p.r(1, 3, W - 2, 8, NAVY); p.r(1, 10, W - 2, 1, ORANGE);
    textCentered(p, label.slice(0, 11), W / 2, 4, '#ffffff');
  },
  orderBoard(p, o, W) {
    p.r(1, 2, W - 2, 11, '#a8743f'); p.r(2, 3, W - 4, 9, '#c79a62');
    text(p, 'ORDERS', 3, 4, '#3b2410');
    const notes = ['#fde047', '#f9a8d4', '#86efac', '#93c5fd', '#fdba74'];
    for (let i = 0; i < 6; i++) p.r(28 + (i % 3) * 6, 3 + Math.floor(i / 3) * 4, 4, 3, notes[i % 5]);
    for (let i = 0; i < 3; i++) p.r(3 + i * 8, 10, 6, 1, '#fff');
  },
  elecPanel(p, o) {
    p.box(2, 2, 12, 11, '#9ca3af'); p.r(3, 3, 10, 9, '#6b7280');
    for (let i = 0; i < 4; i++) { p.r(4, 4 + i * 2, 3, 1, i % 2 ? '#111' : '#e5e7eb'); p.r(9, 4 + i * 2, 3, 1, '#e5e7eb'); }
    p.r(6, 1, 4, 1, '#facc15');
    if (o.variant) p.r(7, 13, 2, 3, '#6b7280');
  },
  kiosk(p, o, W, H) {
    p.r(5, H - 6, 2, 5, '#374151'); p.r(W - 7, H - 6, 2, 5, '#374151');
    p.box(1, 1, W - 2, H - 7, NAVY, '#081c35');
    textCentered(p, 'DIRECTORY', W / 2, 3, '#ffffff');
    p.r(3, 9, W - 6, 1, ORANGE);
    for (let i = 0; i < 5; i++) { p.r(4, 12 + i * 3, 10 + (i * 7) % 9, 1, '#a9c6ea'); p.r(W - 8, 12 + i * 3, 4, 1, '#ffb27a'); }
  },
  confTable(p, o, W, H, top) {
    p.r(2, top + 1, W - 4, o.h * T - 6, '#6b3f22'); p.r(1, top, W - 2, o.h * T - 7, '#8b5a33');
    p.r(2, top + 1, W - 4, 1, '#a8703f');
    for (let i = 0; i < o.w - 1; i++) {
      const x = 8 + i * 16;
      p.r(x, top + 3, 6, 4, '#d1d5db'); p.r(x + 1, top + 4, 4, 2, '#4aa3df');
      p.r(x + 2, top + o.h * T - 14, 2, 3, '#bfe3f5');
    }
    p.r(W / 2 - 3, top + Math.floor(o.h * T / 2) - 3, 6, 4, '#1f2937'); p.set(W / 2, top + Math.floor(o.h * T / 2) - 2, '#22c55e');
  },
  roundTable(p, o, W, H, top) {
    p.r(W / 2 - 1, H - 8, 2, 6, '#4b5563');
    p.oval(2, top + 2, W - 4, W - 8, '#9b6a3e'); p.oval(3, top + 2, W - 6, W - 10, '#c48c55');
    p.r(9, top + 9, 4, 4, '#fff'); p.r(10, top + 10, 2, 2, '#6b3f22'); p.r(18, top + 12, 5, 4, '#fde68a');
  },
  smallTable(p, o, W, H, top) {
    p.box(2, top + 3, 12, 10, '#c48c55', '#8a5a30'); p.r(3, top + 4, 10, 1, '#d9a873'); p.r(6, top + 6, 3, 3, '#fff');
  },
  couch(p, o, W, H) {
    const c = o.variant === 1 ? '#2f7472' : '#355b8f', d = shade(c, -0.3);
    if (o.variant === 1) { p.box(0, 2, W, 9, d); p.box(1, 8, W - 2, 10, c); }
    else { p.box(1, 4, W - 2, 12, c); p.box(0, H - 10, W, 8, d); }
    p.box(0, 4, 4, H - 6, d); p.box(W - 4, 4, 4, H - 6, d);
    for (let i = 1; i < 3; i++) p.r(i * 16, 6, 1, 8, shade(c, -0.15));
  },
  armchair(p, o, W, H) {
    const c = '#b4532a', d = shade(c, -0.3);
    if (o.variant === 2) { p.box(1, 4, 5, H - 6, d); p.box(4, 7, 10, H - 10, c); }
    else if (o.variant === 3) { p.box(W - 6, 4, 5, H - 6, d); p.box(2, 7, 10, H - 10, c); }
    else { p.box(2, 5, 12, H - 8, c); p.box(1, H - 9, 14, 6, d); }
  },
  coffee(p, o, W, H) {
    p.box(0, H - 14, 16, 13, '#d8d2c4', '#9c9584'); p.r(0, H - 14, 16, 2, '#57534e');
    p.box(3, H - 26, 10, 13, '#27272a', '#09090b'); p.r(4, H - 25, 8, 3, '#52525b'); p.r(6, H - 20, 4, 2, '#a1a1aa');
    p.set(11, H - 24, '#ef4444'); p.r(6, H - 16, 3, 3, '#ffffff'); p.r(12, H - 17, 3, 3, ORANGE);
  },
  counter(p, o, W, H) {
    p.box(0, H - 14, 16, 13, '#d8d2c4', '#9c9584'); p.r(0, H - 14, 16, 2, '#57534e');
    p.r(6, H - 8, 4, 1, '#78716c');
    if (o.variant === 1) { p.r(3, H - 13, 10, 4, '#a1a1aa'); p.r(4, H - 12, 8, 2, '#d4d4d8'); p.r(7, H - 15, 2, 2, '#71717a'); }
  },
  fridge(p, o, W, H) {
    p.box(1, 2, 14, H - 3, '#f1f5f9', '#94a3b8'); p.r(2, 12, 12, 1, '#94a3b8'); p.r(12, 5, 1, 5, '#64748b'); p.r(12, 15, 1, 8, '#64748b');
    p.r(4, 5, 3, 3, '#fde047'); p.r(5, 15, 3, 2, '#f9a8d4');
  },
  vending(p, o, W, H) {
    const c = o.variant ? '#1d4ed8' : '#dc2626';
    p.box(0, 1, 16, H - 2, c); p.r(2, 3, 9, H - 10, '#1e293b');
    const snacks = ['#facc15', '#22c55e', '#f97316', '#e879f9', '#38bdf8'];
    for (let r = 0; r < 4; r++) for (let i = 0; i < 3; i++) p.r(3 + i * 3, 4 + r * 5, 2, 3, snacks[(r + i + o.variant) % 5]);
    p.r(12, 5, 3, 6, '#cbd5e1'); p.r(2, H - 6, 9, 3, '#0f172a');
  },
  waterCooler(p, o, W, H) {
    p.box(4, H - 14, 8, 13, '#e5e7eb', '#9ca3af'); p.oval(4, H - 26, 8, 13, '#7cc7f2'); p.r(6, H - 24, 2, 6, '#c8ecff');
    p.r(6, H - 10, 1, 2, '#3b82f6'); p.r(9, H - 10, 1, 2, '#ef4444');
  },
  reception(p, o, W, H) {
    p.r(0, 2, W, 6, '#e5e7eb'); p.r(0, 2, W, 1, '#f9fafb');
    p.box(0, 7, W, H - 8, NAVY, '#081c35'); p.r(1, 12, W - 2, 2, ORANGE);
    text(p, 'RSP', W / 2 - 5, 16, '#ffffff');
    monitor(p, 6, -1, 10, '#4aa3df'); p.r(44, 3, 4, 2, '#facc15'); p.r(50, 3, 6, 3, '#ffffff');
  },
  rug(p, o, W, H) {
    const pal = [[NAVY, ORANGE, '#2a5d9c'], ['#2f7472', '#e9d8a6', '#3f8f8c'], ['#7a3346', '#f4c27a', '#93425a'], ['#5b4636', '#e9d8a6', '#7a5f4a']][o.variant % 4];
    p.r(0, 0, W, H, pal[0]); p.r(2, 2, W - 4, H - 4, pal[2]); p.r(3, 3, W - 6, 1, pal[1]); p.r(3, H - 4, W - 6, 1, pal[1]);
    p.r(3, 3, 1, H - 6, pal[1]); p.r(W - 4, 3, 1, H - 6, pal[1]);
    for (let y = 6; y < H - 6; y += 4) for (let x = 6; x < W - 6; x += 4) p.set(x + ((y / 4) % 2) * 2, y, pal[1]);
  },
  mat(p, o, W, H) {
    p.r(1, 2, W - 2, H - 4, '#3f3f46'); for (let x = 2; x < W - 2; x += 2) p.r(x, 3, 1, H - 6, '#52525b');
    textCentered(p, 'WELCOME', W / 2, 6, '#a1a1aa');
  },
  floorLine(p, o, W) {
    p.r(0, 7, W, 2, '#facc15');
    for (let x = 0; x < 12; x += 4) { p.r(x, 6, 2, 4, '#111'); p.r(W - 12 + x, 6, 2, 4, '#111'); }
  },
  rack(p, o, W, H) {
    const up = ORANGE, beam = '#1d4ed8';
    p.r(0, 2, 2, H - 3, up); p.r(W - 2, 2, 2, H - 3, up); p.r(W / 2 - 1, 2, 2, H - 3, up);
    const levels = [6, 18, 30];
    levels.forEach((y, li) => {
      p.r(0, y + 8, W, 2, beam);
      for (let i = 0; i < 4; i++) {
        const x = 3 + i * 11, kind = Math.floor(hash(i, li, o.x + o.y + o.variant) * 4);
        if (x + 8 >= W - 1) break;
        if (kind === 0) cardboard(p, x, y + 1, 9, 7);
        else if (kind === 1) { p.oval(x, y + 1, 8, 7, '#7c4a1e'); p.oval(x + 2, y + 3, 4, 3, '#f26b1d'); }
        else if (kind === 2) { p.box(x, y + 2, 8, 6, '#9ca3af'); p.r(x + 2, y + 4, 4, 1, '#facc15'); }
        else { cardboard(p, x, y + 3, 4, 5); cardboard(p, x + 4, y + 2, 5, 6); }
      }
    });
  },
  pallet(p, o, W, H) {
    p.r(0, H - 4, 16, 3, '#a47148'); p.r(2, H - 2, 2, 1, '#6b4423'); p.r(12, H - 2, 2, 1, '#6b4423');
    if (o.variant === 1) { p.box(1, 3, 14, H - 7, '#d6dde6', '#94a3b8'); for (let y = 5; y < H - 5; y += 3) p.r(2, y, 12, 1, '#eef2f7'); }
    else if (o.variant === 2) { for (let i = 0; i < 3; i++) p.box(1, 4 + i * 6, 14, 6, '#9ca3af'); p.r(5, 6, 6, 1, '#facc15'); }
    else { cardboard(p, 1, 10, 7, 9); cardboard(p, 8, 10, 7, 9); cardboard(p, 3, 2, 9, 8); }
  },
  spool(p, o, W, H) {
    const cable = o.variant ? '#111827' : ORANGE;
    p.oval(1, H - 15, 14, 13, '#8b5a2b'); p.oval(3, H - 13, 10, 9, cable); p.oval(6, H - 10, 4, 3, '#5c3b1f');
    for (let i = 0; i < 3; i++) p.r(4 + i * 3, H - 12, 1, 7, shade(cable, 0.2));
  },
  shipTable(p, o, W, H) {
    p.box(0, 4, W, 12, '#cbd5e1', '#64748b'); p.r(2, 16, 2, H - 17, '#475569'); p.r(W - 4, 16, 2, H - 17, '#475569');
    p.box(3, 3, 10, 8, '#334155'); p.r(4, 4, 8, 5, '#94a3b8'); p.r(5, 9, 4, 1, '#22c55e');
    cardboard(p, 17, 2, 12, 10); p.r(32, 5, 6, 5, '#1f2937'); p.r(33, 4, 4, 1, '#ffffff');
    p.r(41, 6, 5, 4, ORANGE); p.r(42, 7, 3, 2, '#7c2d12');
  },
  conveyor(p, o, W, H) {
    p.r(0, 3, W, 11, '#475569'); for (let x = 1; x < W - 1; x += 3) p.r(x, 4, 2, 9, '#94a3b8');
    p.r(0, 14, W, 2, '#1e293b'); p.r(2, 16, 2, H - 17, '#334155'); p.r(W - 4, 16, 2, H - 17, '#334155');
    cardboard(p, 8, 2, 10, 9); cardboard(p, 36, 3, 9, 8);
  },
  forklift(p, o, W, H) {
    p.r(0, H - 12, 2, 10, '#4b5563'); p.r(2, H - 4, 8, 2, '#6b7280'); p.r(2, H - 10, 8, 2, '#6b7280');
    p.box(10, H - 22, 20, 18, '#facc15', '#a16207'); p.r(13, H - 30, 2, 10, '#1f2937'); p.r(26, H - 30, 2, 10, '#1f2937'); p.r(13, H - 31, 15, 2, '#1f2937');
    p.box(18, H - 18, 7, 7, '#1f2937'); p.oval(11, H - 6, 6, 6, '#111827'); p.oval(23, H - 6, 6, 6, '#111827');
  },
  handTruck(p, o, W, H) {
    p.r(3, 2, 2, H - 4, '#dc2626'); p.r(3, H - 3, 9, 2, '#dc2626'); cardboard(p, 5, H - 13, 9, 10); p.oval(2, H - 4, 4, 4, '#111827');
  },
  trash(p, o, W, H) { p.box(4, H - 11, 8, 10, '#6b7280'); p.r(3, H - 12, 10, 2, '#4b5563'); p.r(6, H - 9, 1, 6, '#9ca3af'); },
  lamp(p, o, W, H) {
    p.r(7, 10, 2, H - 12, '#44403c'); p.r(4, H - 3, 8, 2, '#44403c');
    p.oval(2, 1, 12, 11, '#fde68a'); p.r(3, 8, 10, 3, '#f59e0b'); p.r(4, 2, 4, 2, '#fffbeb');
  },
  execDesk(p, o, W, H, top) {
    const t = top - 2;
    p.r(0, t, W, 11, '#5c3a21'); p.r(0, t, W, 1, '#7a5233'); p.r(0, t + 11, W, H - t - 12, '#3f2614');
    monitor(p, 19, t - 6, 12); p.r(4, t + 3, 10, 3, '#e5e7eb'); text(p, 'MGR', 5, t + 4, NAVY);
    p.r(36, t + 2, 4, 5, '#d4a72c'); p.r(37, t - 3, 2, 5, '#44403c'); p.oval(35, t - 6, 6, 4, '#fde68a');
  },
  transformer(p, o, W, H) {
    p.box(1, 3, 14, H - 4, '#4d7c4a', '#2f4f2d'); for (let i = 0; i < 4; i++) p.r(3, 6 + i * 3, 10, 1, '#3b6339');
    p.r(6, H - 8, 4, 4, '#facc15'); p.set(8, H - 7, '#111'); p.set(8, H - 6, '#111');
  },
  glassDoor(p, o, W) {
    p.r(0, 3, W, 10, '#64748b'); p.r(2, 4, W / 2 - 3, 8, '#bfe3f5'); p.r(W / 2 + 1, 4, W / 2 - 3, 8, '#bfe3f5');
    p.r(W / 2 - 2, 7, 1, 3, '#e5e7eb'); p.r(W / 2 + 1, 7, 1, 3, '#e5e7eb'); text(p, 'IN', 4, 6, NAVY);
  },
  dock(p, o, W) {
    p.r(0, 2, W, 12, '#6b7280'); for (let y = 3; y < 13; y += 2) p.r(1, y, W - 2, 1, '#9ca3af');
    for (let x = 0; x < W; x += 4) { p.r(x, 13, 2, 3, '#facc15'); p.r(x + 2, 13, 2, 3, '#111'); }
  },
};

const NO_OUTLINE = new Set(['rug', 'mat', 'floorLine', 'window', 'whiteboard', 'tv', 'clock', 'logo', 'welcome', 'deptSign', 'orderBoard', 'elecPanel', 'glassDoor', 'dock']);

export function objectSize(o: MapObject) {
  return { W: o.w * T, H: Math.ceil((o.h + o.tall) * T) };
}

/** Draws an object to a canvas; footprint is bottom-aligned in the canvas. */
export function renderObject(o: MapObject, label = o.label ?? ''): HTMLCanvasElement {
  const { W, H } = objectSize(o);
  const pad = NO_OUTLINE.has(o.type) ? 0 : 1;
  const p = new Pix(W + pad * 2, H + pad * 2);
  const inner = new Pix(W, H);
  DRAW[o.type]?.(inner, o, W, H, H - o.h * T, label);
  p.blit(inner, pad, pad);
  if (pad) p.outline(OUT, (c) => c.startsWith('rgba'));
  return p.toCanvas();
}
export const OBJECT_PAD = (o: MapObject) => (NO_OUTLINE.has(o.type) ? 0 : 1) * SCALE;
