// "Modern pixel" layer: the art stays chunky 16px pixel art, but it is lit and shaded
// like a modern indie game (soft contact shadows, ambient occlusion, warm light pools,
// additive glow, day/night ambience). Everything here is smooth on purpose; the contrast
// between crisp pixels and soft light is the look.
import { MAP, MAP_H, MAP_W, TILE, isWall, type MapObject, type Zone } from '@shared/map';

// ------------------------------------------------------------------ time of day

export interface Ambience {
  /** multiply colour for unlit areas */
  ambient: string;
  /** how strongly lamps/screens show (0..1) */
  lampStrength: number;
  /** sunlight through windows (0..1) and its colour */
  sun: number;
  sunColor: string;
  name: 'morning' | 'day' | 'evening' | 'night';
}

export function ambienceFor(date = new Date()): Ambience {
  const h = date.getHours() + date.getMinutes() / 60;
  // The office is always well lit (lights on all day, every day). Time of day only nudges
  // the warmth: soft gold mornings, clean daylight, warm late afternoons, cosy lamp-lit evenings.
  if (h >= 5 && h < 10) return { name: 'morning', ambient: '#ece4ea', lampStrength: 0.55, sun: 0.8, sunColor: '#ffdcae' };
  if (h >= 10 && h < 16) return { name: 'day', ambient: '#eceef5', lampStrength: 0.45, sun: 0.85, sunColor: '#fff6e2' };
  if (h >= 16 && h < 19) return { name: 'evening', ambient: '#efe2dc', lampStrength: 0.7, sun: 0.7, sunColor: '#ffc690' };
  return { name: 'night', ambient: '#e2e0ee', lampStrength: 0.8, sun: 0.35, sunColor: '#d4ddff' };
}

// ------------------------------------------------------------------ lights

export interface Light {
  x: number; // world px
  y: number;
  r: number; // radius px
  color: string;
  power: number; // 0..1 before ambience
  kind: 'ceiling' | 'lamp' | 'screen' | 'window' | 'machine';
  zone: Zone | null;
  /** window shafts are drawn as a downward fan instead of a circle */
  shaft?: { w: number; len: number };
  flicker?: boolean;
}

const zoneOfTile = (tx: number, ty: number) => MAP.zones.find((z) => tx >= z.rect.x && tx < z.rect.x + z.rect.w && ty >= z.rect.y && ty < z.rect.y + z.rect.h) ?? null;

const CEILING_COLOR: Record<string, string> = {
  warehouse: '#e8f1ff', break: '#fff1d6', lobby: '#fff3e0', mgmt: '#ffd9a0', boothA: '#ffcf8f', boothB: '#ffcf8f',
};

export function buildLights(): Light[] {
  const out: Light[] = [];
  // ceiling fixtures on a loose grid in every zone
  for (const z of MAP.zones) {
    const { x, y, w, h } = z.rect;
    const step = z.id === 'hall' ? 6 : 5;
    const nx = Math.max(1, Math.round(w / step)), ny = Math.max(1, Math.round(h / step));
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        out.push({
          x: (x + (w * (i + 0.5)) / nx) * TILE, y: (y + (h * (j + 0.5)) / ny) * TILE,
          r: Math.max(w / nx, h / ny) * TILE * 0.95, color: CEILING_COLOR[z.id] ?? '#fff6e6', power: 0.55, kind: 'ceiling', zone: z,
        });
  }
  const at = (o: MapObject, dx: number, dy: number) => ({ x: o.x * TILE + o.ox + dx, y: o.y * TILE + dy, zone: zoneOfTile(o.x, Math.min(MAP_H - 1, o.y + (o.layer === 'wall' ? 1 : 0))) });
  for (const o of MAP.objects) {
    switch (o.type) {
      case 'lamp': out.push({ ...at(o, TILE / 2, -TILE * 0.6), r: TILE * 3.2, color: '#ffc46b', power: 0.95, kind: 'lamp', flicker: true }); break;
      case 'execDesk': out.push({ ...at(o, TILE * 2.4, -TILE * 0.2), r: TILE * 2.6, color: '#ffc46b', power: 0.8, kind: 'lamp' }); break;
      case 'desk': {
        const col = o.variant === 1 ? '#ffb46b' : o.variant === 2 ? '#7ff0c4' : '#7cc4ff';
        out.push({ ...at(o, TILE, -TILE * 0.1), r: TILE * 1.6, color: col, power: 0.55, kind: 'screen', flicker: true });
        break;
      }
      case 'tv': out.push({ ...at(o, TILE, TILE * 0.9), r: TILE * 3, color: o.variant === 1 ? '#6fb4ff' : '#b8c8ff', power: 0.6, kind: 'screen', flicker: true }); break;
      case 'vending': out.push({ ...at(o, TILE / 2, TILE * 0.2), r: TILE * 2.2, color: o.variant ? '#5b8cff' : '#ff5b5b', power: 0.7, kind: 'machine' }); break;
      case 'kiosk': out.push({ ...at(o, TILE * 1.5, 0), r: TILE * 2.4, color: '#7cc4ff', power: 0.5, kind: 'screen' }); break;
      case 'fridge': case 'coffee': out.push({ ...at(o, TILE / 2, TILE * 0.3), r: TILE * 1.4, color: '#fff0c8', power: 0.35, kind: 'machine' }); break;
      case 'logo': out.push({ ...at(o, TILE * 2, TILE * 0.9), r: TILE * 3.2, color: '#ff9a52', power: 0.45, kind: 'machine' }); break;
      case 'window': out.push({ ...at(o, TILE, TILE * 0.7), r: TILE * 4, color: '#ffffff', power: 1, kind: 'window', shaft: { w: TILE * 1.5, len: TILE * 5.5 } }); break;
      case 'glassDoor': out.push({ ...at(o, TILE * 1.5, TILE * 0.2), r: TILE * 4, color: '#ffffff', power: 0.9, kind: 'window', shaft: { w: TILE * 2.2, len: -TILE * 4.5 } }); break;
    }
  }
  return out;
}

// ------------------------------------------------------------------ light map

/** Lightmap resolution: 1 lightmap px = LM world px. Smoothly upscaled. */
export const LM = 4;

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

/**
 * Multiply-blended light map. White = fully lit (art shows true colours),
 * ambient colour = unlit. Lights are clipped to their room (+1 tile so wall faces
 * and doorways catch the spill) so they don't leak through walls.
 */
export function renderLightmap(lights: Light[], amb: Ambience): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = (MAP_W * TILE) / LM; c.height = (MAP_H * TILE) / LM;
  const g = c.getContext('2d')!;
  g.scale(1 / LM, 1 / LM);
  g.fillStyle = amb.ambient;
  g.fillRect(0, 0, MAP_W * TILE, MAP_H * TILE);
  g.globalCompositeOperation = 'lighter';
  for (const L of lights) {
    const strength =
      L.kind === 'window' ? amb.sun * L.power * 0.55 :
      L.kind === 'ceiling' ? L.power * 0.38 :
      L.power * amb.lampStrength * 0.6;
    if (strength <= 0.01) continue;
    const color = L.kind === 'window' ? amb.sunColor : L.color;
    g.save();
    if (L.zone) { const r = L.zone.rect; g.beginPath(); g.rect((r.x - 1) * TILE, (r.y - 1) * TILE, (r.w + 2) * TILE, (r.h + 2) * TILE); g.clip(); }
    if (L.shaft) {
      // slanted sunbeam falling from the window across the floor
      const { w, len } = L.shaft;
      const grad = g.createLinearGradient(L.x, L.y, L.x, L.y + len);
      grad.addColorStop(0, hexA(color, strength)); grad.addColorStop(1, hexA(color, 0));
      g.fillStyle = grad;
      const skew = len * 0.28;
      g.beginPath();
      g.moveTo(L.x - w / 2, L.y); g.lineTo(L.x + w / 2, L.y);
      g.lineTo(L.x + w / 2 + w * 0.35 + skew, L.y + len); g.lineTo(L.x - w / 2 - w * 0.35 + skew, L.y + len);
      g.closePath(); g.fill();
      // soft spill around the shaft
      const rg = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
      rg.addColorStop(0, hexA(color, strength * 0.5)); rg.addColorStop(1, hexA(color, 0));
      g.fillStyle = rg; g.fillRect(L.x - L.r, L.y - L.r, L.r * 2, L.r * 2);
    } else {
      const rg = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
      rg.addColorStop(0, hexA(color, strength)); rg.addColorStop(0.35, hexA(color, strength * 0.7)); rg.addColorStop(0.7, hexA(color, strength * 0.25)); rg.addColorStop(1, hexA(color, 0));
      g.fillStyle = rg; g.fillRect(L.x - L.r, L.y - L.r, L.r * 2, L.r * 2);
    }
    g.restore();
  }
  return c;
}

/** Additive sunbeams (brightens above the art's own colours, which a multiply map can't). */
export function renderShafts(lights: Light[], amb: Ambience): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = (MAP_W * TILE) / LM; c.height = (MAP_H * TILE) / LM;
  const g = c.getContext('2d')!;
  g.scale(1 / LM, 1 / LM);
  g.globalCompositeOperation = 'lighter';
  for (const L of lights) {
    if (!L.shaft) continue;
    const { w, len } = L.shaft;
    const a = amb.sun * 0.5;
    g.save();
    if (L.zone) { const r = L.zone.rect; g.beginPath(); g.rect(r.x * TILE, (r.y - 1) * TILE, r.w * TILE, (r.h + 2) * TILE); g.clip(); }
    const grad = g.createLinearGradient(L.x, L.y, L.x, L.y + len);
    grad.addColorStop(0, hexA(amb.sunColor, a)); grad.addColorStop(0.5, hexA(amb.sunColor, a * 0.4)); grad.addColorStop(1, hexA(amb.sunColor, 0));
    g.fillStyle = grad;
    const skew = len * 0.28;
    g.beginPath();
    g.moveTo(L.x - w / 2, L.y); g.lineTo(L.x + w / 2, L.y);
    g.lineTo(L.x + w / 2 + w * 0.35 + skew, L.y + len); g.lineTo(L.x - w / 2 - w * 0.35 + skew, L.y + len);
    g.closePath(); g.fill();
    g.restore();
  }
  return c;
}

/** Graphics quality, remembered per browser. 'low' skips post-processing and particles. */
export type Quality = 'high' | 'low';
export function getQuality(): Quality {
  try { return localStorage.getItem('rsp.gfx') === 'low' ? 'low' : 'high'; } catch { return 'high'; }
}
export function setQuality(q: Quality) {
  try { localStorage.setItem('rsp.gfx', q); } catch { /* private mode */ }
}

/** `?time=night` (morning|day|evening|night) previews another time of day. */
export function currentAmbience(): Ambience {
  const t = new URLSearchParams(location.search).get('time');
  const hours: Record<string, number> = { morning: 8, day: 13, evening: 18, night: 22 };
  if (t && t in hours) { const d = new Date(); d.setHours(hours[t], 0); return ambienceFor(d); }
  return ambienceFor();
}

// ------------------------------------------------------------------ baked shadows / AO

/** Paints soft ambient occlusion onto the background canvas (canvas px = world px). */
export function bakeShadows(ctx: CanvasRenderingContext2D) {
  ctx.save();
  // ambient occlusion where floor meets walls
  for (let ty = 0; ty < MAP_H; ty++)
    for (let tx = 0; tx < MAP_W; tx++) {
      if (isWall(tx, ty)) continue;
      const x = tx * TILE, y = ty * TILE;
      if (isWall(tx, ty - 1)) grad(ctx, x, y, x, y + 18, x, y, TILE, 18, 0.32);
      if (isWall(tx - 1, ty)) grad(ctx, x, y, x + 12, y, x, y, 12, TILE, 0.22);
      if (isWall(tx + 1, ty)) grad(ctx, x + TILE, y, x + TILE - 12, y, x + TILE - 12, y, 12, TILE, 0.22);
      if (isWall(tx, ty + 1)) grad(ctx, x, y + TILE, x, y + TILE - 8, x, y + TILE - 8, TILE, 8, 0.14);
    }
  ctx.restore();
}

/** Contact shadows under furniture, as their own layer (so they also fall on rugs). */
export function contactShadowCanvas() {
  const c = document.createElement('canvas');
  c.width = MAP_W * TILE; c.height = MAP_H * TILE;
  const ctx = c.getContext('2d')!;
  // light comes from above-left, so offset down-right
  for (const o of MAP.objects) {
    if (o.layer !== 'normal' || o.type === 'chair') continue;
    const x = o.x * TILE + o.ox, y = o.y * TILE, w = o.w * TILE, h = o.h * TILE;
    const cx = x + w / 2 + 4, cy = y + h - 2;
    const rx = w / 2 + 4, ry = Math.max(8, Math.min(h * 0.55, 18)) + o.tall * 4;
    softEllipse(ctx, cx, cy, rx, ry, 0.34);
  }
  // chairs get a small one
  for (const o of MAP.objects) if (o.type === 'chair') softEllipse(ctx, o.x * TILE + o.ox + TILE / 2 + 2, o.y * TILE + TILE - 4, 13, 6, 0.28);
  return c;
}

function grad(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number, a: number) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, `rgba(10,12,28,${a})`); g.addColorStop(1, 'rgba(10,12,28,0)');
  ctx.fillStyle = g; ctx.fillRect(rx, ry, rw, rh);
}

export function softEllipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, a: number) {
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(8,10,24,${a})`); g.addColorStop(0.6, `rgba(8,10,24,${a * 0.55})`); g.addColorStop(1, 'rgba(8,10,24,0)');
  ctx.fillStyle = g; ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
  ctx.restore();
}

// ------------------------------------------------------------------ small textures

/** White radial glow (tint it); used with ADD blend. */
export function glowCanvas(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  const rg = g.createRadialGradient(r, r, 0, r, r, r);
  rg.addColorStop(0, 'rgba(255,255,255,0.9)'); rg.addColorStop(0.25, 'rgba(255,255,255,0.45)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, size, size);
  return c;
}

/** Soft dark oval used as a drop shadow under characters. */
export function shadowCanvas() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 24;
  softEllipse(c.getContext('2d')!, 32, 12, 30, 11, 0.55);
  return c;
}

/** 1 art-pixel square (2x2 world px) for pixel particles. */
export function pixelCanvas(size = 2) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
  return c;
}
