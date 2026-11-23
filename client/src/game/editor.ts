// Admin build mode: edits the live map in place (client only) until the admin presses Save,
// which sends the whole layout to the server. Every edit can be undone.
import {
  MAP, MAP_H, MAP_W, OBJ_DEFS, TILE, applyLayout, exportLayout, inBounds, makeObject, zoneAt,
  type Floor, type Layout, type ObjType,
} from '@shared/map';

const undoStack: Layout[] = [];

/** Call before each edit so it can be undone. */
export function snapshot() {
  undoStack.push(exportLayout());
  if (undoStack.length > 50) undoStack.shift();
}
export function undo() {
  const l = undoStack.pop();
  if (!l) return false;
  applyLayout(l);
  return true;
}
export const canUndo = () => undoStack.length > 0;
export const resetUndo = () => { undoStack.length = 0; };

/** Recompute collision/zones/desks after editing MAP directly. */
const commit = () => applyLayout(exportLayout());

export function paintTiles(tiles: { x: number; y: number }[], mode: 'floor' | 'wall', floor: Floor) {
  for (const { x, y } of tiles) {
    if (!inBounds(x, y)) continue;
    if (mode === 'wall') {
      MAP.wall[y][x] = true; MAP.floor[y][x] = 'void';
      // furniture standing there goes; wall decorations stay
      for (let i = MAP.objects.length - 1; i >= 0; i--) {
        const o = MAP.objects[i];
        if (o.layer !== 'wall' && x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h) MAP.objects.splice(i, 1);
      }
    } else { MAP.wall[y][x] = false; MAP.floor[y][x] = floor; }
  }
  commit();
}

/** Returns an error message, or null when placed. (x,y) is the object's top-left tile. */
export function placeObject(type: ObjType, x: number, y: number, variant: number): string | null {
  const d = OBJ_DEFS[type];
  if (x < 0 || y < 0 || x + d.w > MAP_W || y + d.h > MAP_H) return 'That does not fit there.';
  for (let j = y; j < y + d.h; j++)
    for (let i = x; i < x + d.w; i++) {
      const wall = MAP.wall[j][i];
      if (type === 'door') { if (!wall) return 'Doors go into a wall, between two rooms.'; continue; }
      if (d.layer === 'wall' && !wall) return 'Put this on a wall.';
      if (d.layer !== 'wall' && wall) return 'Put this on the floor.';
    }
  if (type === 'door') {
    // knock a hole in the wall, using the floor from the side that has one
    for (let i = x; i < x + d.w; i++) {
      const f = !MAP.wall[y + 1]?.[i] ? MAP.floor[y + 1][i] : !MAP.wall[y - 1]?.[i] ? MAP.floor[y - 1][i] : 'wood';
      MAP.wall[y][i] = false; MAP.floor[y][i] = f === 'void' ? 'wood' : f;
    }
  }
  MAP.objects.push(makeObject(type, x, y, { variant }));
  if (type === 'desk' && y + 1 < MAP_H && !MAP.wall[y + 1][x] && !MAP.wall[y + 1][x + 1]) {
    MAP.objects.push(makeObject('chair', x, y + 1, { ox: TILE / 2 }));
  }
  commit();
  return null;
}

/** Removes the top-most object on the tile. */
export function eraseAt(x: number, y: number) {
  const order = { normal: 0, wall: 1, floor: 2 } as const;
  const hits = MAP.objects.filter((o) => x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h).sort((a, b) => order[a.layer] - order[b.layer]);
  const o = hits[0];
  if (!o) return false;
  MAP.objects.splice(MAP.objects.indexOf(o), 1);
  commit();
  return true;
}

export function addArea(rect: { x: number; y: number; w: number; h: number }, name: string, kind: 'open' | 'private', dept: string | undefined, walls: boolean, floor: Floor) {
  const { x, y, w, h } = rect;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { MAP.wall[j][i] = false; MAP.floor[j][i] = floor; }
  if (walls) {
    for (let j = y - 1; j <= y + h; j++)
      for (let i = x - 1; i <= x + w; i++) {
        const ring = j === y - 1 || j === y + h || i === x - 1 || i === x + w;
        if (!ring || !inBounds(i, j)) continue;
        const z = zoneAt(i, j);
        if (z) continue; // never wall over another area
        MAP.wall[j][i] = true; MAP.floor[j][i] = 'void';
      }
  }
  // the new area wins over any older area it overlaps
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'area';
  let id = base, n = 2;
  while (MAP.zones.some((z) => z.id === id)) id = `${base}-${n++}`;
  MAP.zones.push({ id, name: name.slice(0, 40) || 'New area', kind, dept: dept || undefined, rect: { x, y, w, h } });
  commit();
  return id;
}

export function updateArea(id: string, patch: { name?: string; kind?: 'open' | 'private'; dept?: string }) {
  const z = MAP.zones.find((z) => z.id === id);
  if (!z) return;
  if (patch.name !== undefined) z.name = patch.name.slice(0, 40) || z.name;
  if (patch.kind) z.kind = patch.kind;
  if (patch.dept !== undefined) z.dept = patch.dept || undefined;
  commit();
}

export function removeArea(id: string) {
  const i = MAP.zones.findIndex((z) => z.id === id);
  if (i >= 0) MAP.zones.splice(i, 1);
  commit();
}
