// Scene-level "modern pixel" effects: lighting layers, glows, particles and post-processing.
// OfficeScene owns gameplay; this owns atmosphere. Everything is optional and can be
// turned down with the graphics quality setting (Settings → Graphics).
import Phaser from 'phaser';
import { MAP, TILE } from '@shared/map';
import {
  LM, buildLights, contactShadowCanvas, currentAmbience, getQuality, glowCanvas, pixelCanvas, renderLightmap, renderShafts,
  shadowCanvas, type Ambience, type Light,
} from './lighting';

/** Depth bands. World objects sort by y (0..~1300); these sit above them. */
export const DEPTH = { contactShadows: -4.5, dust: -1, light: 100000, glow: 100001, motes: 100002, tags: 150000 } as const;

const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;

export class OfficeFX {
  readonly quality = getQuality();
  private lights: Light[] = buildLights();
  private amb: Ambience = currentAmbience();
  private lightImg?: Phaser.GameObjects.Image;
  private shaftImg?: Phaser.GameObjects.Image;
  private glows: { img: Phaser.GameObjects.Image; light: Light; base: number }[] = [];
  private motes: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private dust?: Phaser.GameObjects.Particles.ParticleEmitter;
  private lastDust = new Map<string, number>();

  constructor(private scene: Phaser.Scene) {}

  create() {
    const s = this.scene;
    const linear = (key: string) => s.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
    const tex = (key: string, c: HTMLCanvasElement) => { if (s.textures.exists(key)) s.textures.remove(key); s.textures.addCanvas(key, c); };

    tex('fx_glow', glowCanvas()); linear('fx_glow');
    tex('fx_shadow', shadowCanvas()); linear('fx_shadow');
    tex('fx_px', pixelCanvas(2));
    tex('fx_px4', pixelCanvas(4));

    tex('fx_contact', contactShadowCanvas()); linear('fx_contact');
    s.add.image(0, 0, 'fx_contact').setOrigin(0, 0).setDepth(DEPTH.contactShadows);

    this.lightImg = s.add.image(0, 0, '__WHITE').setOrigin(0, 0).setDepth(DEPTH.light).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.shaftImg = s.add.image(0, 0, '__WHITE').setOrigin(0, 0).setDepth(DEPTH.glow).setBlendMode(Phaser.BlendModes.ADD);
    this.applyAmbience();

    // additive glow halos on things that emit light
    for (const L of this.lights) {
      if (L.kind === 'ceiling' || L.kind === 'window') continue;
      const size = L.kind === 'screen' ? L.r * 1.1 : L.r * 1.3;
      const img = s.add.image(L.x, L.y, 'fx_glow').setDepth(DEPTH.glow).setBlendMode(Phaser.BlendModes.ADD)
        .setTint(hex(L.color)).setDisplaySize(size, size * (L.kind === 'screen' ? 0.7 : 1));
      const base = L.kind === 'lamp' ? 0.6 : L.kind === 'screen' ? 0.42 : 0.32;
      this.glows.push({ img, light: L, base });
      if (L.flicker && this.quality === 'high') {
        s.tweens.add({ targets: img, scaleX: img.scaleX * 1.06, scaleY: img.scaleY * 1.06, duration: 1400 + Math.random() * 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Math.random() * 1500 });
      }
    }
    this.applyGlowAlpha();

    if (this.quality === 'high') {
      this.createParticles();
      this.createPostFX();
    }

    // follow the real clock: re-light when morning → day → evening → night changes
    s.time.addEvent({ delay: 60_000, loop: true, callback: () => {
      const next = currentAmbience();
      if (next.name !== this.amb.name) { this.amb = next; this.applyAmbience(); this.applyGlowAlpha(); }
    } });
  }

  get ambience() { return this.amb; }

  private applyAmbience() {
    const s = this.scene;
    for (const k of ['fx_light', 'fx_shafts']) if (s.textures.exists(k)) s.textures.remove(k);
    s.textures.addCanvas('fx_light', renderLightmap(this.lights, this.amb))!.setFilter(Phaser.Textures.FilterMode.LINEAR);
    s.textures.addCanvas('fx_shafts', renderShafts(this.lights, this.amb))!.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.lightImg!.setTexture('fx_light').setScale(LM);
    this.shaftImg!.setTexture('fx_shafts').setScale(LM).setAlpha(0.55);
  }

  private applyGlowAlpha() {
    const k = this.amb.lampStrength;
    for (const g of this.glows) g.img.setAlpha(g.base * (0.25 + k * 0.75));
  }

  private createParticles() {
    const s = this.scene;
    // dust motes drifting in sunbeams
    for (const L of this.lights) {
      if (!L.shaft || L.shaft.len < 0) continue;
      const { w, len } = L.shaft;
      const e = s.add.particles(0, 0, 'fx_px', {
        emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(L.x - w / 2 + len * 0.1, L.y + 10, w + len * 0.2, len * 0.75) } as any,
        lifespan: { min: 3500, max: 7000 },
        speedX: { min: -3, max: 5 }, speedY: { min: -4, max: 4 },
        alpha: { values: [0, 0.75, 0.75, 0] } as any,
        tint: hex(this.amb.sunColor),
        frequency: 450, quantity: 1, maxAliveParticles: 14,
        blendMode: Phaser.BlendModes.ADD,
      }).setDepth(DEPTH.motes);
      this.motes.push(e);
    }
    // steam from the coffee machine
    for (const o of MAP.objects.filter((o) => o.type === 'coffee')) {
      s.add.particles(o.x * TILE + 20, o.y * TILE - 26, 'fx_px4', {
        lifespan: { min: 1400, max: 2200 }, speedY: { min: -16, max: -9 }, speedX: { min: -4, max: 4 },
        scale: { start: 0.6, end: 2.2 }, alpha: { values: [0, 0.4, 0] } as any, tint: 0xffffff,
        frequency: 260, quantity: 1,
      }).setDepth(o.y * TILE + TILE);
    }
    // footstep puffs (emitted manually)
    this.dust = s.add.particles(0, 0, 'fx_px4', {
      lifespan: 420, speed: { min: 6, max: 18 }, angle: { min: 200, max: 340 }, gravityY: 20,
      scale: { start: 0.9, end: 0.1 }, alpha: { start: 0.45, end: 0 }, tint: 0xd9cdb8, emitting: false,
    }).setDepth(DEPTH.dust);
  }

  private createPostFX() {
    const cam = this.scene.cameras.main;
    if (this.scene.renderer.type !== Phaser.WEBGL || !cam.postFX) return;
    cam.postFX.addBloom(0xffffff, 0.8, 0.8, 1, 0.22, 3);
    const cm = cam.postFX.addColorMatrix();
    cm.saturate(0.12, true);
    cm.contrast(0.06, true);
    cam.postFX.addVignette(0.5, 0.5, 0.92, 0.22);
  }

  /** Called every frame for each avatar: kicks up little dust puffs while walking. */
  footstep(id: string, x: number, y: number, moving: boolean, time: number) {
    if (!this.dust || !moving) return;
    const last = this.lastDust.get(id) ?? 0;
    if (time - last < 210) return;
    this.lastDust.set(id, time);
    this.dust.emitParticleAt(x + (Math.random() * 8 - 4), y - 1, 2);
  }

  /** Sparkle when someone teleports in. */
  burst(x: number, y: number) {
    if (this.quality !== 'high') return;
    const e = this.scene.add.particles(x, y - 20, 'fx_px4', {
      lifespan: 600, speed: { min: 30, max: 90 }, scale: { start: 1, end: 0 }, alpha: { start: 1, end: 0 },
      tint: [0xffd166, 0xffffff, 0xf26b1d], blendMode: Phaser.BlendModes.ADD, emitting: false,
    }).setDepth(DEPTH.motes);
    e.explode(24);
    this.scene.time.delayedCall(900, () => e.destroy());
  }

  /** Soft drop shadow for a character (added to its container). */
  avatarShadow() {
    return this.scene.add.image(1, -2, 'fx_shadow').setDisplaySize(30, 11);
  }
}
