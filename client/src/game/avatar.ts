// Procedural 8-bit avatars: 4 directions x 4 walk frames, built from an AvatarConfig.
import type { AvatarConfig, Dir } from '@shared/types';
import { Pix, SCALE, shade } from './pixel';

export const FW = 16, FH = 24; // art px per frame
export const DIRS: Dir[] = ['down', 'left', 'right', 'up'];
export const FRAME_W = FW * SCALE, FRAME_H = FH * SCALE;

const EYE = '#1b1b1b';

function hairFront(p: Pix, a: AvatarConfig, side: boolean) {
  const h = a.hair, hd = shade(h, -0.25);
  const x0 = side ? 5 : 4, w = side ? 7 : 8;
  switch (a.hairStyle) {
    case 'bald': p.set(side ? 8 : 6, 3, shade(a.skin, 0.25)); return;
    case 'mohawk': p.r(7, 0, 2, 4, h); p.r(7, 0, 1, 4, hd); return;
    case 'spiky':
      p.r(x0, 1, w, 3, h); for (let i = 0; i < w; i += 2) p.set(x0 + i, 0, h);
      if (!side) { p.r(4, 4, 1, 2, h); p.r(11, 4, 1, 2, h); p.r(5, 4, 3, 1, h); } else p.r(5, 4, 2, 3, h);
      return;
    case 'curly':
      p.r(x0 - 1, 0, w + 2, 4, h); p.r(x0 - 1, 4, 2, 4, h); if (!side) p.r(11, 4, 2, 4, h);
      for (let i = 0; i < w + 2; i += 2) p.set(x0 - 1 + i, 1, hd);
      return;
  }
  // short / long / bun / ponytail share a base cut
  p.r(x0 + 1, 1, w - 2, 1, h); p.r(x0, 2, w, 2, h);
  if (side) { p.r(5, 4, 2, 3, h); p.r(10, 4, 2, 1, h); }
  else { p.r(4, 4, 1, 2, h); p.r(11, 4, 1, 2, h); p.r(5, 4, 3, 1, h); p.r(9, 4, 1, 1, h); }
  p.r(x0 + 1, 2, w - 2, 1, shade(h, 0.15));
  if (a.hairStyle === 'long') { if (side) p.r(4, 4, 3, 8, h); else { p.r(3, 4, 2, 8, h); p.r(11, 4, 2, 8, h); } }
  if (a.hairStyle === 'bun') p.r(side ? 4 : 6, 0, 4, 2, hd);
  if (a.hairStyle === 'ponytail' && side) p.r(3, 4, 2, 6, hd);
}

function hairBack(p: Pix, a: AvatarConfig) {
  const h = a.hair, hd = shade(h, -0.25);
  if (a.hairStyle === 'bald') return;
  if (a.hairStyle === 'mohawk') { p.r(7, 0, 2, 9, h); return; }
  p.r(4, 1, 8, 8, h); p.r(5, 0, 6, 1, h); p.r(5, 2, 6, 1, shade(h, 0.15));
  if (a.hairStyle === 'spiky') for (let i = 0; i < 8; i += 2) p.set(4 + i, 0, h);
  if (a.hairStyle === 'curly') { p.r(3, 0, 10, 9, h); for (let i = 0; i < 10; i += 2) p.set(3 + i, 3 + (i % 4), hd); }
  if (a.hairStyle === 'long') p.r(3, 4, 10, 8, h);
  if (a.hairStyle === 'bun') p.r(6, 0, 4, 3, hd);
  if (a.hairStyle === 'ponytail') p.r(7, 8, 2, 4, hd);
}

function accessory(p: Pix, a: AvatarConfig, dir: Dir) {
  const side = dir === 'left' || dir === 'right', back = dir === 'up';
  switch (a.accessory) {
    case 'glasses':
      if (back) return;
      if (side) { p.r(9, 5, 3, 1, '#222'); p.set(9, 6, '#222'); p.set(11, 6, '#222'); }
      else { p.r(5, 5, 3, 1, '#222'); p.r(8, 5, 3, 1, '#222'); p.set(5, 6, '#222'); p.set(7, 6, '#222'); p.set(8, 6, '#222'); p.set(10, 6, '#222'); }
      return;
    case 'sunglasses':
      if (back) return;
      if (side) p.r(9, 5, 3, 2, '#111'); else { p.r(5, 5, 6, 2, '#111'); p.set(6, 5, '#555'); p.set(9, 5, '#555'); }
      return;
    case 'cap': {
      const c = '#f26b1d';
      p.r(4, 0, 8, 4, c); p.r(5, 0, 6, 1, shade(c, 0.2));
      if (side) p.r(9, 3, 5, 1, shade(c, -0.3)); else if (!back) p.r(4, 4, 8, 1, shade(c, -0.3));
      return;
    }
    case 'hardhat': {
      const c = '#facc15';
      p.r(4, 0, 8, 4, c); p.r(3, 3, 10, 1, shade(c, -0.25)); p.r(5, 0, 3, 1, '#fef08a'); p.r(7, 0, 2, 3, shade(c, -0.12));
      return;
    }
    case 'headset':
      p.r(4, 1, 8, 1, '#222');
      if (side) p.r(7, 4, 2, 3, '#222'); else { p.r(3, 5, 2, 3, '#222'); p.r(11, 5, 2, 3, '#222'); if (!back) p.r(4, 8, 3, 1, '#444'); }
      return;
    case 'beanie': {
      const c = '#2563eb';
      p.r(4, 0, 8, 4, c); p.r(4, 3, 8, 1, shade(c, -0.3)); p.r(7, -1, 2, 1, '#fff');
      for (let i = 0; i < 8; i += 2) p.set(4 + i, 1, shade(c, 0.2));
      return;
    }
    case 'bow':
      p.r(side ? 4 : 9, 0, 4, 2, '#ec4899'); p.set(side ? 5 : 10, 0, '#f9a8d4');
      return;
  }
}

function frontBody(p: Pix, a: AvatarConfig, step: number, back: boolean) {
  const skin = a.skin, sd = shade(skin, -0.15);
  const pants = a.pants, shoe = a.shoes, shirt = a.shirt, sh = shade(shirt, -0.22);
  // legs
  const lUp = step === 1 ? 1 : 0, rUp = step === -1 ? 1 : 0;
  p.r(5, 16, 3, 5 - lUp, pants); p.r(8, 16, 3, 5 - rUp, pants);
  p.r(7, 16, 1, 3, shade(pants, -0.25));
  p.r(5, 21 - lUp, 3, 1, shoe); p.r(8, 21 - rUp, 3, 1, shoe);
  // torso + arms
  p.r(4, 10, 8, 7, shirt); p.r(11, 10, 1, 7, sh); p.r(4, 16, 8, 1, sh);
  const la = step === -1 ? 1 : 0, ra = step === 1 ? 1 : 0;
  p.r(3, 11 + la, 1, 3, sh); p.r(3, 14 + la, 1, 2, skin);
  p.r(12, 11 + ra, 1, 3, sh); p.r(12, 14 + ra, 1, 2, skin);
  if (!back) { p.r(7, 10, 2, 1, sd); }
  // head
  p.r(4, 2, 8, 8, skin); p.set(4, 2, null); p.set(11, 2, null); p.set(4, 9, null); p.set(11, 9, null);
  p.r(5, 9, 6, 1, sd);
  p.r(3, 5, 1, 2, skin); p.r(12, 5, 1, 2, skin);
  if (!back) {
    p.r(6, 5, 1, 2, EYE); p.r(9, 5, 1, 2, EYE);
    p.r(7, 8, 2, 1, shade(skin, -0.3));
    p.set(5, 7, shade(skin, -0.06)); p.set(10, 7, shade(skin, -0.06));
  }
}

function sideBody(p: Pix, a: AvatarConfig, step: number) {
  // drawn facing right
  const skin = a.skin, sd = shade(skin, -0.15);
  const pants = a.pants, shoe = a.shoes, shirt = a.shirt, sh = shade(shirt, -0.22);
  if (step === 0) { p.r(6, 16, 4, 5, pants); p.r(6, 21, 5, 1, shoe); }
  else {
    p.r(4, 16, 3, 5, shade(pants, -0.2)); p.r(3, 21, 4, 1, shade(shoe, -0.2));
    p.r(9, 16, 3, 5, pants); p.r(9, 21, 4, 1, shoe);
  }
  p.r(5, 10, 6, 7, shirt); p.r(5, 16, 6, 1, sh);
  const sw = step;
  p.r(7 + sw, 11, 2, 3, sh); p.r(7 + sw, 14, 2, 2, skin);
  p.r(5, 2, 7, 8, skin); p.set(5, 2, null); p.set(11, 2, null); p.set(5, 9, null);
  p.r(12, 5, 1, 2, skin); // nose
  p.r(10, 5, 1, 2, EYE);
  p.r(7, 5, 1, 2, sd); // ear
  p.r(10, 8, 1, 1, shade(skin, -0.3));
}

function frame(a: AvatarConfig, dir: Dir, f: number) {
  const step = f === 1 ? 1 : f === 3 ? -1 : 0;
  const p = new Pix(FW, FH);
  if (dir === 'down' || dir === 'up') {
    if (dir === 'up') { frontBody(p, a, step, true); hairBack(p, a); }
    else { frontBody(p, a, step, false); hairFront(p, a, false); }
  } else {
    sideBody(p, a, step);
    hairFront(p, a, true);
  }
  accessory(p, a, dir);
  // bob
  let out = p;
  if (step !== 0) { out = new Pix(FW, FH); out.blit(p, 0, -1); out.r(0, FH - 1, 0, 0, '#000'); }
  out.outline('#1b1626');
  // ground shadow under the feet (not outlined)
  for (let x = 4; x <= 11; x++) for (const y of [22, 23]) if (out.get(x, y) === null && !(y === 23 && (x === 4 || x === 11))) out.set(x, y, 'rgba(0,0,0,0.28)');
  if (dir === 'left') { const m = new Pix(FW, FH); m.blit(out, 0, 0, true); return m; }
  return out;
}

export const avatarKey = (a: AvatarConfig) => `av_${a.skin}${a.hair}${a.hairStyle}${a.shirt}${a.pants}${a.shoes}${a.accessory}`.replace(/#/g, '');

/** Spritesheet: rows = DIRS, cols = 4 walk frames (stand, step, stand, step). */
export function renderAvatarSheet(a: AvatarConfig): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = FRAME_W * 4; c.height = FRAME_H * 4;
  const ctx = c.getContext('2d')!;
  DIRS.forEach((d, row) => {
    for (let f = 0; f < 4; f++) frame(a, d, f).draw(ctx, f * FRAME_W, row * FRAME_H);
  });
  return c;
}

/** Single frame preview for UI (e.g. avatar editor, directory). */
export function renderAvatarPreview(a: AvatarConfig, dir: Dir = 'down', f = 0, scale = 4) {
  return frame(a, dir, f).toCanvas(scale);
}
