// Tiny pixel-art toolkit: draw at 16px-per-tile "art resolution", then blit to a
// canvas at SCALE so Phaser renders crisp pixels at 32px tiles.

export const SCALE = 2;

export class Pix {
  data: (string | null)[];
  constructor(public w: number, public h: number) {
    this.data = new Array(w * h).fill(null);
  }
  set(x: number, y: number, c: string | null) {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = c;
  }
  get(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.data[y * this.w + x] : null;
  }
  r(x: number, y: number, w: number, h: number, c: string) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
    return this;
  }
  /** rect with 1px darker border */
  box(x: number, y: number, w: number, h: number, c: string, border = shade(c, -0.3)) {
    this.r(x, y, w, h, border);
    if (w > 2 && h > 2) this.r(x + 1, y + 1, w - 2, h - 2, c);
    return this;
  }
  /** filled ellipse in the box */
  oval(x: number, y: number, w: number, h: number, c: string) {
    const cx = x + w / 2 - 0.5, cy = y + h / 2 - 0.5, rx = w / 2, ry = h / 2;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const dx = (x + i - cx) / rx, dy = (y + j - cy) / ry;
        if (dx * dx + dy * dy <= 1.0) this.set(x + i, y + j, c);
      }
    return this;
  }
  /** add a 1px outline around opaque pixels */
  outline(c = '#1b1626', skip?: (col: string) => boolean) {
    const add: number[] = [];
    const solid = (x: number, y: number) => {
      const v = this.get(x, y);
      return v !== null && !(skip && skip(v));
    };
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.data[y * this.w + x] === null && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) add.push(y * this.w + x);
    for (const i of add) this.data[i] = c;
    return this;
  }
  blit(src: Pix, ox: number, oy: number, flipX = false) {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const v = src.data[y * src.w + (flipX ? src.w - 1 - x : x)];
        if (v !== null) this.set(ox + x, oy + y, v);
      }
  }
  draw(ctx: CanvasRenderingContext2D, dx = 0, dy = 0, s = SCALE) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const v = this.data[y * this.w + x];
        if (v === null) continue;
        ctx.fillStyle = v;
        ctx.fillRect(dx + x * s, dy + y * s, s, s);
      }
  }
  toCanvas(s = SCALE) {
    const c = document.createElement('canvas');
    c.width = this.w * s; c.height = this.h * s;
    this.draw(c.getContext('2d')!, 0, 0, s);
    return c;
  }
}

export function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  r = f(r); g = f(g); b = f(b);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

/** deterministic hash noise 0..1 */
export function hash(x: number, y: number, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// 3x5 pixel font
const GLYPHS: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010', '8': '111101111101111',
  '9': '111101111001110', '&': '010101010101011', '-': '000000111000000', '!': '010010010000010', '.': '000000000000010',
  "'": '010010000000000', ' ': '000000000000000', '?': '110001010000010', '/': '001001010100100', ':': '000010000010000',
  ',': '000000000010100', '+': '000010111010000',
};
export const textWidth = (t: string) => Math.max(0, t.length * 4 - 1);
export function text(p: Pix, t: string, x: number, y: number, c: string) {
  t = t.toUpperCase();
  for (let k = 0; k < t.length; k++) {
    const g = GLYPHS[t[k]] ?? GLYPHS['?'];
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j * 3 + i] === '1') p.set(x + k * 4 + i, y + j, c);
  }
}
export function textCentered(p: Pix, t: string, cx: number, y: number, c: string) {
  text(p, t, Math.round(cx - textWidth(t.toUpperCase()) / 2), y, c);
}
