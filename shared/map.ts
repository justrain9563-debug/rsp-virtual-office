// The RSP Supply office map. Pure data + geometry helpers, used by both the
// client (rendering, prediction, path-finding) and the server (authoritative
// collision, zones and proximity).

export const TILE = 32; // world pixels per tile (art is 16px, drawn at 2x)
export const MAP_W = 60;
export const MAP_H = 38;

export type Floor =
  | 'void' | 'wood' | 'carpetBlue' | 'carpetTeal' | 'carpetGray' | 'carpetWine'
  | 'carpetGreen' | 'tile' | 'concrete' | 'marble' | 'woodDark';

export type ObjType =
  | 'desk' | 'chair' | 'plant' | 'bigplant' | 'bookshelf' | 'filing' | 'printer' | 'whiteboard'
  | 'window' | 'tv' | 'clock' | 'logo' | 'welcome' | 'deptSign' | 'kiosk' | 'elecPanel' | 'orderBoard'
  | 'confTable' | 'roundTable' | 'smallTable' | 'couch' | 'armchair' | 'coffee' | 'counter' | 'fridge'
  | 'vending' | 'waterCooler' | 'reception' | 'rug' | 'mat' | 'rack' | 'pallet' | 'spool' | 'shipTable'
  | 'conveyor' | 'forklift' | 'handTruck' | 'trash' | 'lamp' | 'execDesk' | 'transformer' | 'glassDoor'
  | 'dock' | 'floorLine' | 'door';

interface ObjDef { w: number; h: number; solid: boolean; layer: 'floor' | 'normal' | 'wall'; tall?: number }

export const OBJ_DEFS: Record<ObjType, ObjDef> = {
  desk: { w: 2, h: 1, solid: true, layer: 'normal', tall: 0.75 },
  chair: { w: 1, h: 1, solid: false, layer: 'normal', tall: 0.25 },
  plant: { w: 1, h: 1, solid: true, layer: 'normal', tall: 0.75 },
  bigplant: { w: 1, h: 1, solid: true, layer: 'normal', tall: 1.25 },
  bookshelf: { w: 2, h: 1, solid: true, layer: 'normal', tall: 1 },
  filing: { w: 1, h: 1, solid: true, layer: 'normal', tall: 0.5 },
  printer: { w: 1, h: 1, solid: true, layer: 'normal', tall: 0.25 },
  whiteboard: { w: 2, h: 1, solid: false, layer: 'wall' },
  window: { w: 2, h: 1, solid: false, layer: 'wall' },
  tv: { w: 2, h: 1, solid: false, layer: 'wall' },
  clock: { w: 1, h: 1, solid: false, layer: 'wall' },
  logo: { w: 4, h: 1, solid: false, layer: 'wall' },
  welcome: { w: 4, h: 1, solid: false, layer: 'wall' },
  deptSign: { w: 3, h: 1, solid: false, layer: 'wall' },
  orderBoard: { w: 3, h: 1, solid: false, layer: 'wall' },
  elecPanel: { w: 1, h: 1, solid: false, layer: 'wall' },
  kiosk: { w: 3, h: 1, solid: true, layer: 'normal', tall: 1 },
  confTable: { w: 8, h: 3, solid: true, layer: 'normal', tall: 0.25 },
  roundTable: { w: 2, h: 2, solid: true, layer: 'normal', tall: 0.25 },
  smallTable: { w: 1, h: 1, solid: true, layer: 'normal', tall: 0.25 },
  couch: { w: 3, h: 1, solid: true, layer: 'normal', tall: 0.5 },
  armchair: { w: 1, h: 1, solid: true, layer: 'normal', tall: 0.5 },
  coffee: { w: 1, h: 1, solid: true, layer: 'normal', tall: 0.75 },
  counter: { w: 1, h: 1, solid: true, layer: 'normal', tall: 0.25 },
  fridge: { w: 1, h: 1, solid: true, layer: 'normal', tall: 1 },
  vending: { w: 1, h: 1, solid: true, layer: 'normal', tall: 1 },
  waterCooler: { w: 1, h: 1, solid: true, layer: 'normal', tall: 0.75 },
  reception: { w: 4, h: 1, solid: true, layer: 'normal', tall: 0.5 },
  rug: { w: 3, h: 3, solid: false, layer: 'floor' },
  mat: { w: 3, h: 1, solid: false, layer: 'floor' },
  floorLine: { w: 1, h: 1, solid: false, layer: 'floor' },
  rack: { w: 3, h: 1, solid: true, layer: 'normal', tall: 1.5 },
  pallet: { w: 1, h: 1, solid: true, layer: 'normal', tall: 0.75 },
  spool: { w: 1, h: 1, solid: true, layer: 'normal', tall: 0.25 },
  shipTable: { w: 3, h: 1, solid: true, layer: 'normal', tall: 0.5 },
  conveyor: { w: 4, h: 1, solid: true, layer: 'normal', tall: 0.25 },
  forklift: { w: 2, h: 1, solid: true, layer: 'normal', tall: 1 },
  handTruck: { w: 1, h: 1, solid: true, layer: 'normal', tall: 0.5 },
  trash: { w: 1, h: 1, solid: true, layer: 'normal' },
  lamp: { w: 1, h: 1, solid: true, layer: 'normal', tall: 1 },
  execDesk: { w: 3, h: 1, solid: true, layer: 'normal', tall: 0.75 },
  transformer: { w: 1, h: 1, solid: true, layer: 'normal', tall: 0.5 },
  glassDoor: { w: 3, h: 1, solid: true, layer: 'wall' },
  dock: { w: 3, h: 1, solid: true, layer: 'wall' },
  door: { w: 2, h: 1, solid: false, layer: 'wall' },
};

export const FLOORS: Floor[] = ['wood', 'woodDark', 'carpetBlue', 'carpetTeal', 'carpetGray', 'carpetWine', 'carpetGreen', 'tile', 'concrete', 'marble'];

export interface MapObject {
  id: string;
  type: ObjType;
  x: number;
  y: number;
  w: number;
  h: number;
  solid: boolean;
  layer: 'floor' | 'normal' | 'wall';
  tall: number;
  variant: number;
  ox: number; // render offset in px (e.g. chairs centred under 2-wide desks)
  label?: string;
}

export interface Zone {
  id: string;
  name: string;
  kind: 'open' | 'private';
  dept?: string;
  rect: { x: number; y: number; w: number; h: number };
}

export interface Desk {
  id: string;
  dept: string;
  x: number; // desk tile
  y: number;
  seatX: number; // world px where the owner spawns
  seatY: number;
}

// ---------------------------------------------------------------- builder

const floor: Floor[][] = Array.from({ length: MAP_H }, () => Array<Floor>(MAP_W).fill('void'));
const wall: boolean[][] = Array.from({ length: MAP_H }, () => Array<boolean>(MAP_W).fill(true));
const objects: MapObject[] = [];
const zones: Zone[] = [];
const desks: Desk[] = [];

function carve(x: number, y: number, w: number, h: number, f: Floor) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { floor[j][i] = f; wall[j][i] = false; }
}
function region(id: string, name: string, kind: 'open' | 'private', x: number, y: number, w: number, h: number, f: Floor, dept?: string) {
  carve(x, y, w, h, f);
  zones.push({ id, name, kind, dept, rect: { x, y, w, h } });
}
let oid = 0;
function add(type: ObjType, x: number, y: number, o: Partial<Pick<MapObject, 'w' | 'h' | 'variant' | 'ox' | 'label'>> = {}) {
  const d = OBJ_DEFS[type];
  const obj: MapObject = {
    id: `${type}-${oid++}`, type, x, y, w: o.w ?? d.w, h: o.h ?? d.h, solid: d.solid, layer: d.layer,
    tall: d.tall ?? 0, variant: o.variant ?? 0, ox: o.ox ?? 0, label: o.label,
  };
  objects.push(obj);
  return obj;
}
let deskCount: Record<string, number> = {};
function deskWithChair(dept: string, x: number, y: number, variant = 0) {
  deskCount[dept] = (deskCount[dept] ?? 0) + 1;
  const id = `${dept}-${deskCount[dept]}`;
  add('desk', x, y, { variant, label: id });
  add('chair', x, y + 1, { ox: TILE / 2, variant: 0 });
  desks.push({ id, dept, x, y, seatX: (x + 1) * TILE, seatY: (y + 1) * TILE + TILE / 2 + 4 });
}

// --- regions (interior rectangles; everything not carved stays wall)
region('sales', 'Sales Department', 'open', 1, 1, 18, 12, 'carpetBlue', 'sales');
region('sdr', 'SDR Department', 'open', 20, 1, 14, 12, 'carpetTeal', 'sdr');
region('conf', 'Sales Conference Room', 'private', 35, 1, 12, 12, 'carpetGray');
region('mgmt', 'Management Office', 'private', 48, 1, 11, 12, 'woodDark', 'management');
region('hall', 'Main Hallway', 'open', 1, 14, 58, 3, 'wood');
region('lobby', 'Reception & Lobby', 'open', 1, 18, 14, 19, 'marble');
region('ops', 'Quoting & Operations', 'open', 16, 18, 16, 11, 'carpetGray', 'ops');
region('opsmeet', 'Operations Meeting Room', 'private', 16, 30, 16, 7, 'carpetWine');
region('break', 'Break Room', 'private', 33, 18, 11, 10, 'tile');
region('boothA', 'One-on-One Booth A', 'private', 33, 29, 5, 8, 'carpetGreen');
region('boothB', 'One-on-One Booth B', 'private', 39, 29, 5, 8, 'carpetGreen');
region('warehouse', 'Warehouse & Shipping', 'open', 45, 18, 14, 19, 'concrete', 'warehouse');

// --- doors
carve(8, 13, 2, 1, 'wood'); carve(26, 13, 2, 1, 'wood'); carve(40, 13, 2, 1, 'wood'); carve(52, 13, 2, 1, 'wood');
carve(19, 6, 1, 2, 'carpetBlue');
carve(7, 17, 2, 1, 'wood'); carve(23, 17, 2, 1, 'wood'); carve(37, 17, 2, 1, 'wood'); carve(50, 17, 3, 1, 'wood');
carve(15, 22, 1, 2, 'marble');
carve(23, 29, 2, 1, 'carpetWine');
carve(35, 28, 1, 1, 'carpetGreen'); carve(41, 28, 1, 1, 'carpetGreen');

// --- doors on the private rooms (they show closed + red when the room is locked)
add('door', 40, 13); add('door', 52, 13); add('door', 37, 17); add('door', 23, 29);
add('door', 35, 28, { w: 1 }); add('door', 41, 28, { w: 1 });

// --- Sales
add('window', 1, 0); add('deptSign', 4, 0, { label: 'SALES' }); add('window', 8, 0);
add('whiteboard', 11, 0); add('window', 14, 0); add('clock', 17, 0);
for (const x of [2, 5, 8, 11]) { deskWithChair('sales', x, 3); deskWithChair('sales', x, 7); }
add('bookshelf', 15, 3); add('filing', 17, 3); add('printer', 18, 5);
add('rug', 14, 8, { w: 4, h: 4, variant: 0 }); add('roundTable', 15, 9); add('armchair', 14, 9, { variant: 1 }); add('armchair', 17, 10, { variant: 2 });
add('plant', 1, 12); add('bigplant', 18, 12); add('waterCooler', 1, 10); add('plant', 18, 1);

// --- SDR
add('deptSign', 21, 0, { label: 'SDR' }); add('window', 25, 0); add('tv', 28, 0, { variant: 1 }); add('window', 31, 0);
for (const x of [21, 24, 27, 30]) { deskWithChair('sdr', x, 3, 1); deskWithChair('sdr', x, 7, 1); }
add('rug', 25, 10, { w: 4, h: 2, variant: 1 }); add('couch', 21, 11, { variant: 0 });
add('plant', 33, 1); add('bigplant', 33, 12); add('trash', 20, 1);

// --- Sales Conference Room (private)
add('window', 36, 0); add('tv', 40, 0, { variant: 0 }); add('window', 44, 0);
add('confTable', 37, 4, { w: 8, h: 3 });
for (const x of [38, 40, 42, 44]) { add('chair', x, 3, { variant: 1 }); add('chair', x - 1, 7, { variant: 0 }); }
add('chair', 36, 5, { variant: 2 }); add('chair', 45, 5, { variant: 3 });
add('bigplant', 35, 1); add('bigplant', 46, 1); add('plant', 35, 12); add('plant', 46, 12);

// --- Management Office (private)
add('window', 49, 0); add('deptSign', 52, 0, { label: 'MANAGEMENT' }); add('window', 56, 0);
add('execDesk', 52, 4); add('chair', 53, 3, { variant: 1 }); add('chair', 52, 6); add('chair', 54, 6);
add('rug', 48, 8, { w: 5, h: 4, variant: 2 }); add('couch', 49, 11, { variant: 0 }); add('smallTable', 50, 9);
add('bookshelf', 56, 8); add('plant', 48, 1); add('plant', 58, 1); add('filing', 58, 5); add('lamp', 58, 11);

// --- Hallway
add('plant', 1, 14); add('waterCooler', 15, 14); add('trash', 16, 14); add('plant', 34, 14);
add('plant', 47, 14); add('plant', 58, 14);

// --- Reception & Lobby
add('logo', 2, 17); add('welcome', 10, 17);
add('glassDoor', 6, 37); add('mat', 6, 36);
add('reception', 5, 29); add('chair', 6, 28, { variant: 1, ox: TILE / 2 });
add('rug', 2, 21, { w: 5, h: 5, variant: 3 }); add('couch', 2, 21, { variant: 1 }); add('smallTable', 3, 23); add('couch', 2, 25, { variant: 0 });
add('kiosk', 11, 22);
add('plant', 1, 18); add('plant', 14, 18); add('bigplant', 1, 36); add('bigplant', 14, 36);
add('bigplant', 4, 35); add('bigplant', 10, 35); add('armchair', 12, 27, { variant: 3 }); add('armchair', 12, 29, { variant: 3 });

// --- Quoting & Operations
add('deptSign', 17, 17, { label: 'OPERATIONS' }); add('whiteboard', 20, 17); add('orderBoard', 26, 17); add('whiteboard', 29, 17);
for (const x of [17, 20, 26, 29]) { deskWithChair('ops', x, 20, 2); deskWithChair('ops', x, 24, 2); }
add('printer', 31, 18); add('filing', 31, 21); add('filing', 31, 22); add('plant', 16, 28); add('plant', 31, 28);

// --- Operations Meeting Room (private)
add('whiteboard', 18, 29); add('tv', 27, 29, { variant: 0 });
add('confTable', 19, 32, { w: 10, h: 2 });
for (const x of [20, 22, 24, 26]) { add('chair', x, 31, { variant: 1 }); add('chair', x + 1, 34, { variant: 0 }); }
add('chair', 18, 32, { variant: 2 }); add('chair', 29, 33, { variant: 3 });
add('plant', 16, 30); add('plant', 31, 30); add('bigplant', 16, 36); add('bigplant', 31, 36);

// --- Break Room (private)
add('coffee', 33, 18); add('counter', 34, 18, { variant: 1 }); add('counter', 35, 18); add('fridge', 36, 18);
add('vending', 39, 18); add('vending', 40, 18, { variant: 1 }); add('clock', 42, 17);
add('roundTable', 34, 21); add('chair', 33, 21, { variant: 2 }); add('chair', 36, 22, { variant: 3 });
add('roundTable', 39, 21); add('chair', 38, 21, { variant: 2 }); add('chair', 41, 22, { variant: 3 });
add('couch', 34, 26, { variant: 0 }); add('couch', 39, 26, { variant: 0 }); add('rug', 34, 24, { w: 3, h: 2, variant: 1 });
add('plant', 43, 18); add('bigplant', 43, 27); add('trash', 42, 18);

// --- One-on-one booths (private)
add('rug', 34, 31, { w: 3, h: 3, variant: 2 }); add('smallTable', 35, 32); add('armchair', 34, 32, { variant: 2 }); add('armchair', 36, 32, { variant: 3 });
add('lamp', 37, 29); add('plant', 33, 36);
add('rug', 40, 31, { w: 3, h: 3, variant: 0 }); add('smallTable', 41, 32); add('armchair', 40, 32, { variant: 2 }); add('armchair', 42, 32, { variant: 3 });
add('lamp', 39, 29); add('plant', 43, 36);

// --- Warehouse & Shipping
add('elecPanel', 46, 17); add('elecPanel', 47, 17, { variant: 1 }); add('deptSign', 54, 17, { label: 'WAREHOUSE' });
for (const y of [20, 23, 26]) for (const x of [46, 50, 55]) add('rack', x, y, { variant: (x + y) % 3 });
add('pallet', 58, 20); add('pallet', 58, 21, { variant: 1 }); add('spool', 58, 24); add('spool', 58, 25, { variant: 1 }); add('transformer', 58, 18);
add('floorLine', 45, 29, { w: 14, h: 1 });
add('shipTable', 47, 31); add('conveyor', 51, 33); add('pallet', 56, 31, { variant: 2 }); add('pallet', 57, 31, { variant: 0 });
add('pallet', 56, 32, { variant: 1 }); add('forklift', 55, 35); add('handTruck', 46, 35); add('spool', 45, 33); add('spool', 45, 34, { variant: 1 });
add('dock', 49, 37); add('dock', 54, 37);

// ---------------------------------------------------------------- derived grids

const solid: boolean[][] = wall.map((r) => r.slice());
const zoneGrid: (Zone | null)[][] = Array.from({ length: MAP_H }, () => Array<Zone | null>(MAP_W).fill(null));

/** Recomputes collision, zone lookup and desks from floor/wall/objects/zones (after any edit). */
function rebuildDerived() {
  for (let j = 0; j < MAP_H; j++) for (let i = 0; i < MAP_W; i++) { solid[j][i] = wall[j][i]; zoneGrid[j][i] = null; }
  for (const o of objects) {
    if (!o.solid || o.layer === 'wall') continue;
    for (let j = o.y; j < o.y + o.h; j++) for (let i = o.x; i < o.x + o.w; i++) if (inBounds(i, j)) solid[j][i] = true;
  }
  for (const z of zones) for (let j = z.rect.y; j < z.rect.y + z.rect.h; j++) for (let i = z.rect.x; i < z.rect.x + z.rect.w; i++) if (inBounds(i, j)) zoneGrid[j][i] = z;
  // desks come from desk objects; the label is the desk id people claim
  const keep = new Map(desks.map((d) => [d.id, d]));
  desks.length = 0;
  for (const o of objects) {
    if (o.type !== 'desk') continue;
    if (!o.label) o.label = `D${o.x}-${o.y}`;
    const z = zoneGrid[Math.min(MAP_H - 1, o.y + 1)]?.[o.x] ?? zoneGrid[o.y]?.[o.x];
    desks.push({ id: o.label, dept: z?.dept ?? keep.get(o.label)?.dept ?? 'sales', x: o.x, y: o.y, seatX: (o.x + 1) * TILE, seatY: (o.y + 1) * TILE + TILE / 2 + 4 });
  }
}

export const MAP = { floor, wall, solid, objects, zones, desks };

// ---------------------------------------------------------------- editable layouts (admin build mode)

/** Serialisable office layout. tiles: one char per tile, '#' = wall, otherwise an index into FLOORS. */
export interface Layout {
  v: 1;
  tiles: string[];
  objects: { id: string; type: ObjType; x: number; y: number; w: number; h: number; variant: number; ox: number; label?: string }[];
  zones: { id: string; name: string; kind: 'open' | 'private'; dept?: string; x: number; y: number; w: number; h: number }[];
}

const FLOOR_CHARS = 'abcdefghij';

export function exportLayout(): Layout {
  return {
    v: 1,
    tiles: floor.map((row, j) => row.map((f, i) => (wall[j][i] ? '#' : FLOOR_CHARS[Math.max(0, FLOORS.indexOf(f))])).join('')),
    objects: objects.map((o) => ({ id: o.id, type: o.type, x: o.x, y: o.y, w: o.w, h: o.h, variant: o.variant, ox: o.ox, ...(o.label ? { label: o.label } : {}) })),
    zones: zones.map((z) => ({ id: z.id, name: z.name, kind: z.kind, ...(z.dept ? { dept: z.dept } : {}), ...z.rect })),
  };
}

/** Throws with a readable message if the layout is malformed. Returns a cleaned copy. */
export function validateLayout(l: any): Layout {
  const bad = (m: string) => { throw new Error(m); };
  if (!l || l.v !== 1 || !Array.isArray(l.tiles) || l.tiles.length !== MAP_H) bad('Layout has the wrong size.');
  for (const row of l.tiles) if (typeof row !== 'string' || row.length !== MAP_W || !/^[#a-j]+$/.test(row)) bad('Layout tiles are invalid.');
  if (!Array.isArray(l.objects) || l.objects.length > 900) bad('Too many objects (max 900).');
  if (!Array.isArray(l.zones) || l.zones.length > 40) bad('Too many areas (max 40).');
  const ids = new Set<string>();
  const objs = l.objects.map((o: any) => {
    const d = OBJ_DEFS[o?.type as ObjType];
    if (!d) bad(`Unknown object type ${o?.type}.`);
    const n = (v: any, lo: number, hi: number) => (Number.isInteger(v) && v >= lo && v <= hi ? v : bad('Object position is invalid.'));
    const id = typeof o.id === 'string' && /^[\w-]{1,40}$/.test(o.id) && !ids.has(o.id) ? o.id : bad('Object ids must be unique.');
    ids.add(id);
    const w = n(o.w, 1, MAP_W), h = n(o.h, 1, MAP_H);
    return { id, type: o.type, x: n(o.x, 0, MAP_W - w), y: n(o.y, 0, MAP_H - h), w, h, variant: n(o.variant ?? 0, 0, 9), ox: n(o.ox ?? 0, 0, TILE), ...(typeof o.label === 'string' && o.label ? { label: o.label.slice(0, 24) } : {}) };
  });
  const zids = new Set<string>();
  const zs = l.zones.map((z: any) => {
    if (typeof z?.id !== 'string' || !/^[\w-]{1,32}$/.test(z.id) || zids.has(z.id)) bad('Area ids must be unique.');
    zids.add(z.id);
    if (z.kind !== 'open' && z.kind !== 'private') bad('Area kind is invalid.');
    const n = (v: any, lo: number, hi: number) => (Number.isInteger(v) && v >= lo && v <= hi ? v : bad('Area position is invalid.'));
    const x = n(z.x, 0, MAP_W - 1), y = n(z.y, 0, MAP_H - 1);
    return { id: z.id, name: String(z.name ?? 'Area').slice(0, 40) || 'Area', kind: z.kind, ...(typeof z.dept === 'string' && z.dept ? { dept: z.dept } : {}), x, y, w: n(z.w, 1, MAP_W - x), h: n(z.h, 1, MAP_H - y) };
  });
  return { v: 1, tiles: l.tiles.slice(), objects: objs, zones: zs };
}

/** Replaces the live map (in place, so every importer sees the change). */
export function applyLayout(l: Layout) {
  for (let j = 0; j < MAP_H; j++)
    for (let i = 0; i < MAP_W; i++) {
      const ch = l.tiles[j][i];
      wall[j][i] = ch === '#';
      floor[j][i] = ch === '#' ? 'void' : FLOORS[FLOOR_CHARS.indexOf(ch)] ?? 'wood';
    }
  objects.length = 0;
  for (const o of l.objects) {
    const d = OBJ_DEFS[o.type];
    objects.push({ id: o.id, type: o.type, x: o.x, y: o.y, w: o.w, h: o.h, solid: d.solid, layer: d.layer, tall: d.tall ?? 0, variant: o.variant, ox: o.ox, label: o.label });
  }
  zones.length = 0;
  for (const z of l.zones) zones.push({ id: z.id, name: z.name, kind: z.kind, dept: z.dept, rect: { x: z.x, y: z.y, w: z.w, h: z.h } });
  rebuildDerived();
  layoutVersion++;
}

/** The built-in RSP office (what "Reset to default" restores). */
export let DEFAULT_LAYOUT: Layout;
/** Increments whenever the layout changes (clients use it to know when to redraw). */
export let layoutVersion = 0;

/** New object id for the editor. */
export const newObjectId = (type: ObjType) => `${type}-${Math.random().toString(36).slice(2, 8)}`;
export function makeObject(type: ObjType, x: number, y: number, extra: Partial<Pick<MapObject, 'w' | 'h' | 'variant' | 'ox' | 'label'>> = {}): MapObject {
  const d = OBJ_DEFS[type];
  return { id: newObjectId(type), type, x, y, w: extra.w ?? d.w, h: extra.h ?? d.h, solid: d.solid, layer: d.layer, tall: d.tall ?? 0, variant: extra.variant ?? 0, ox: extra.ox ?? 0, label: extra.label };
}

export const inBounds = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H;
export const isWall = (tx: number, ty: number) => !inBounds(tx, ty) || wall[ty][tx];
export const isSolid = (tx: number, ty: number) => !inBounds(tx, ty) || solid[ty][tx];
export const zoneAt = (tx: number, ty: number): Zone | null => (inBounds(tx, ty) ? zoneGrid[ty][tx] : null);
export const zoneById = (id: string | null | undefined) => zones.find((z) => z.id === id) ?? null;
export const privateZones = () => zones.filter((z) => z.kind === 'private');
export const tileOf = (px: number) => Math.floor(px / TILE);
export const zoneAtPx = (x: number, y: number) => zoneAt(tileOf(x), tileOf(y));

/** Player collision box relative to the feet position. */
export const HITBOX = { left: 10, right: 10, top: 8, bottom: 4 };

export function boxBlocked(x: number, y: number, blocked?: (tx: number, ty: number) => boolean) {
  const x0 = tileOf(x - HITBOX.left), x1 = tileOf(x + HITBOX.right - 0.01);
  const y0 = tileOf(y - HITBOX.top), y1 = tileOf(y + HITBOX.bottom - 0.01);
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) if (isSolid(i, j) || blocked?.(i, j)) return true;
  return false;
}

/** True if no wall tile lies on the grid line between two tiles (furniture does not block sound). */
export function lineOfSight(ax: number, ay: number, bx: number, by: number) {
  let x = ax, y = ay;
  const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
  let err = dx + dy;
  while (!(x === bx && y === by)) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    if (!(x === bx && y === by) && isWall(x, y)) return false;
  }
  return true;
}

/** 4-way BFS over walkable tiles. Returns the list of tiles after `from`, or null. */
export function findPath(fx: number, fy: number, tx: number, ty: number, blocked?: (x: number, y: number) => boolean) {
  if (isSolid(tx, ty) || blocked?.(tx, ty)) return null;
  const key = (x: number, y: number) => y * MAP_W + x;
  const prev = new Map<number, number>();
  const q: number[] = [key(fx, fy)];
  prev.set(q[0], -1);
  while (q.length) {
    const k = q.shift()!;
    const x = k % MAP_W, y = (k - x) / MAP_W;
    if (x === tx && y === ty) {
      const out: { x: number; y: number }[] = [];
      let c = k;
      while (c !== q[0] && prev.get(c) !== -1) { out.push({ x: c % MAP_W, y: Math.floor(c / MAP_W) }); c = prev.get(c)!; }
      return out.reverse();
    }
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + ox, ny = y + oy, nk = key(nx, ny);
      if (prev.has(nk) || isSolid(nx, ny) || blocked?.(nx, ny)) continue;
      prev.set(nk, k);
      q.push(nk);
    }
  }
  return null;
}

/** Nearest walkable tile to (tx,ty) (spiral search). */
export function nearestFree(tx: number, ty: number, blocked?: (x: number, y: number) => boolean) {
  for (let r = 0; r < 12; r++)
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const x = tx + i, y = ty + j;
        if (!isSolid(x, y) && !blocked?.(x, y)) return { x, y };
      }
  return null;
}

export const SPAWN = { x: 7 * TILE + TILE / 2, y: 33 * TILE + TILE / 2 };
export function spawnPoint(seed = Math.random()) {
  const cands: { x: number; y: number }[] = [];
  const lobby = zones.find((z) => z.id === 'lobby') ?? zones.find((z) => z.kind === 'open');
  const near = lobby ? { x: lobby.rect.x + Math.floor(lobby.rect.w / 2), y: lobby.rect.y + lobby.rect.h - 3 } : { x: 7, y: 33 };
  for (let y = near.y - 2; y <= near.y + 1; y++) for (let x = near.x - 2; x <= near.x + 2; x++) if (!isSolid(x, y) && zoneAt(x, y)?.kind !== 'private') cands.push({ x, y });
  let t = cands[Math.floor(seed * cands.length)];
  if (!t) for (let y = 0; y < MAP_H && !t; y++) for (let x = 0; x < MAP_W && !t; x++) if (!isSolid(x, y) && zoneAt(x, y)?.kind !== 'private') t = { x, y };
  t ??= { x: 7, y: 33 };
  return { x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 };
}

rebuildDerived();
DEFAULT_LAYOUT = exportLayout();
