import Phaser from 'phaser';
import {
  MAP, MAP_H, MAP_W, OBJ_DEFS, TILE, boxBlocked, findPath, nearestFree, privateZones, tileOf, zoneById, zoneAt,
  type Floor, type MapObject, type ObjType,
} from '@shared/map';
import { tileDistance, zoneKeyAt } from '@shared/proximity';
import { EMOTES, INTERACTIVE, statusInfo, type Dir, type PlayerState } from '@shared/types';
import { bus } from '../bus';
import { correction, send } from '../net/socket';
import { sfx } from '../sfx';
import { positions, useStore } from '../store';
import { OBJECT_PAD, renderBackground, renderObject } from './art';
import { DIRS, FRAME_H, FRAME_W, avatarKey, renderAvatarSheet } from './avatar';
import * as editor from './editor';
import { DEPTH, OfficeFX } from './fx';

/** Modern pixel UI font (falls back to Inter until loaded). */
export const PIXEL_FONT = '"Pixelify Sans", Inter, sans-serif';

const SPEED = 4.5 * TILE; // px per second
const SEND_MS = 66;

interface Avatar {
  id: string;
  c: Phaser.GameObjects.Container;
  /** name tag, kept above the lighting layer so it stays readable */
  tag: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  dot: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Ellipse;
  badges: Phaser.GameObjects.Text;
  key: string;
  name: string;
  status: string;
  x: number;
  y: number;
  danceUntil: number;
}

interface Chair { cx: number; ty: number; variant: number; depth: number }

/** Survives scene restarts (layout edits) so the camera doesn't jump. */
let savedCam: { x: number; y: number; zoom: number } | null = null;

export class OfficeScene extends Phaser.Scene {
  private avatars = new Map<string, Avatar>();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private path: { x: number; y: number }[] = [];
  private lastSent = 0;
  private sentState = '';
  private dir: Dir = 'down';
  private moving = false;
  private following = true;
  private marker!: Phaser.GameObjects.Text;
  private markerUntil = 0;
  private roomLabels = new Map<string, Phaser.GameObjects.Text>();
  private lockShades = new Map<string, Phaser.GameObjects.Rectangle>();
  private deskLabels = new Map<string, Phaser.GameObjects.Text>();
  private signObjs: { obj: MapObject; img: Phaser.GameObjects.Image }[] = [];
  private objImgs = new Map<string, Phaser.GameObjects.Image>();
  private doors: { o: MapObject; img: Phaser.GameObjects.Image; room: string | null; locked: boolean }[] = [];
  private chairs: Chair[] = [];
  private unsub: (() => void)[] = [];
  private lastHint: string | null = null;
  private lastLocate = 0;
  private lastWalkTo = 0;
  private lastWalkTile = 0;
  private clickMarker!: Phaser.GameObjects.Ellipse;
  private fx!: OfficeFX;
  private focus: MapObject | null = null;
  private followAt = 0;
  // build mode
  private grid?: Phaser.GameObjects.Graphics;
  private ghost?: Phaser.GameObjects.Graphics;
  private buildLabels: Phaser.GameObjects.Text[] = [];
  private dragStart: { x: number; y: number } | null = null;
  private painted = new Map<string, { x: number; y: number }>();

  constructor() { super('office'); }

  private tex(key: string, canvas: HTMLCanvasElement) {
    if (this.textures.exists(key)) this.textures.remove(key);
    return this.textures.addCanvas(key, canvas)!;
  }

  create() {
    // fresh state (create() runs again after every layout change)
    this.avatars = new Map(); this.roomLabels = new Map(); this.lockShades = new Map(); this.deskLabels = new Map();
    this.signObjs = []; this.buildLabels = []; this.grid = undefined; this.ghost = undefined; this.objImgs = new Map(); this.doors = []; this.chairs = []; this.unsub = []; this.path = [];
    this.focus = null; this.lastHint = null;

    this.add.image(0, 0, this.tex('bg', renderBackground())).setOrigin(0, 0).setDepth(-10);
    this.fx = new OfficeFX(this);
    this.fx.create();

    const sign = useStore.getState().settings?.officeSign ?? 'RSP SUPPLY';
    for (const o of MAP.objects) {
      const key = 'obj_' + o.id;
      this.tex(key, renderObject(o, o.type === 'logo' ? sign : o.type === 'door' ? 'open' : o.label));
      const pad = OBJECT_PAD(o);
      const img = this.add.image(o.x * TILE + o.ox - pad, (o.y + o.h) * TILE + pad, key).setOrigin(0, 1);
      img.setDepth(o.layer === 'floor' ? -5 : o.layer === 'wall' ? -4 : o.type === 'chair' ? o.y * TILE + 6 : (o.y + o.h) * TILE - 2);
      this.objImgs.set(o.id, img);
      if (o.type === 'logo') this.signObjs.push({ obj: o, img });
      if (o.type === 'door') this.doors.push({ o, img, room: doorRoom(o), locked: false });
      if (o.type === 'chair') this.chairs.push({ cx: o.x * TILE + o.ox + TILE / 2, ty: o.y, variant: o.variant, depth: o.y * TILE + 6 });
    }

    // room occupancy labels + lock shading
    for (const z of privateZones()) {
      const r = z.rect;
      const shade = this.add.rectangle(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE, 0xef4444, 0.08).setOrigin(0, 0).setDepth(-3).setVisible(false);
      this.lockShades.set(z.id, shade);
      const label = this.add.text((r.x + r.w / 2) * TILE, r.y * TILE + 4, '', {
        fontFamily: PIXEL_FONT, fontSize: '12px', fontStyle: '500', color: '#ffffff', backgroundColor: 'rgba(8,28,53,0.78)', padding: { x: 6, y: 3 },
      }).setOrigin(0.5, 0).setDepth(DEPTH.tags + r.y * TILE).setAlpha(0.9).setResolution(2);
      this.roomLabels.set(z.id, label);
    }

    this.marker = this.add.text(0, 0, '▼', { fontSize: '22px', color: '#f26b1d', stroke: '#081c35', strokeThickness: 4 }).setOrigin(0.5, 1).setDepth(200000).setVisible(false);
    this.clickMarker = this.add.ellipse(0, 0, 22, 10).setStrokeStyle(2, 0xf26b1d, 0.9).setDepth(-2).setVisible(false);

    // input
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as any;
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    this.input.on('wheel', (_p: any, _o: any, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.4, 2.5));
    });

    const cam = this.cameras.main;
    cam.setBounds(-TILE * 4, -TILE * 2, (MAP_W + 8) * TILE, (MAP_H + 4) * TILE);
    cam.setZoom(savedCam?.zoom ?? Phaser.Math.Clamp(this.scale.width / (26 * TILE), 0.7, 1.6));
    cam.setRoundPixels(true);
    cam.setBackgroundColor('#0b1220');

    correction.handler = (x, y, teleport) => {
      const me = positions.get(this.selfId!);
      positions.set(this.selfId!, { ...(me ?? { dir: 'down', moving: false }), x, y });
      this.path = [];
      if (teleport) {
        this.cameras.main.centerOn(x, y - 20);
        this.fx.burst(x, y);
        sfx.emote();
      }
    };

    this.syncPlayers();
    if (savedCam) { cam.stopFollow(); cam.setScroll(savedCam.x, savedCam.y); const me = this.avatars.get(this.selfId!); if (me) cam.startFollow(me.c, true, 0.12, 0.12); }
    this.unsub.push(useStore.subscribe((s, prev) => {
      if (s.players !== prev.players || s.selfId !== prev.selfId) this.syncPlayers();
      if (s.rooms !== prev.rooms) this.updateRooms();
      if (s.desks !== prev.desks) this.updateDesks();
      if (s.settings?.officeSign !== prev.settings?.officeSign) this.updateSign();
      if (s.locate && s.locate.t !== this.lastLocate) { this.lastLocate = s.locate.t; this.locate(s.locate.id); }
      if (s.walkTo && s.walkTo.t !== this.lastWalkTo) { this.lastWalkTo = s.walkTo.t; this.walkToPlayer(s.walkTo.id); }
      if (s.walkTile && s.walkTile.t !== this.lastWalkTile) { this.lastWalkTile = s.walkTile.t; this.walkToTile(s.walkTile.x, s.walkTile.y); }
      if (s.layoutVersion !== prev.layoutVersion) this.rebuild();
      if (!!s.build !== !!prev.build) this.drawBuildOverlay();
    }));
    this.unsub.push(bus.on('emote', (m: { id: string; e: string }) => this.showEmote(m.id, m.e)));
    this.updateRooms();
    this.updateDesks();
    this.drawBuildOverlay();
    const dbg = (window as any).__rsp;
    if (dbg) dbg.scene = this; // used by the automated browser tests (tools/e2e.mjs)
    this.time.addEvent({ delay: 400, loop: true, callback: () => this.updateRoomLabels() });
    this.events.once('shutdown', () => {
      const c = this.cameras.main;
      savedCam = { x: c.scrollX, y: c.scrollY, zoom: c.zoom };
      this.unsub.forEach((u) => u());
      correction.handler = null;
      this.input.keyboard?.removeAllListeners();
    });
  }

  private get selfId() { return useStore.getState().selfId; }

  /** Redraw everything after the layout changed (build mode edit or server update). */
  private rebuild() { this.scene.restart(); }

  // ------------------------------------------------------------------ input

  private onKey(e: KeyboardEvent) {
    if (typing() || e.repeat) return;
    const st = useStore.getState();
    const k = e.key.toLowerCase();
    if (st.build) {
      if ((e.ctrlKey || e.metaKey) && k === 'z') { if (editor.undo()) this.afterEdit(); return; }
      if (k === 'r') { st.set({ build: { ...st.build, variant: (st.build.variant + 1) % 4 } }); return; }
    }
    if (k === 'escape') { st.set({ card: null, openObject: null }); return; }
    if (k === 'e') return this.interactDesk();
    if (k === 'x') return this.interactObject();
    if (k === 'm') { const v = !st.minimap; try { localStorage.setItem('rsp.minimap', v ? '1' : '0'); } catch { /* ignore */ } st.set({ minimap: v }); return; }
    const em = EMOTES.find((x) => x.key && x.key.toLowerCase() === k);
    if (em) send('emote', em.id);
  }

  private pointerTile(p: Phaser.Input.Pointer) { return { x: tileOf(p.worldX), y: tileOf(p.worldY) }; }

  private onPointerDown(p: Phaser.Input.Pointer) {
    (document.activeElement as HTMLElement | null)?.blur?.();
    const st = useStore.getState();
    if (st.build) return this.buildDown(p);
    if (p.button !== 0) return;
    if (st.card) st.set({ card: null });
    const hit = [...this.avatars.values()].find((a) => a.id !== this.selfId && Math.abs(a.x - p.worldX) < 14 && p.worldY < a.y + 4 && p.worldY > a.y - FRAME_H);
    if (hit) { st.set({ card: { id: hit.id, x: p.x, y: p.y } }); return; }
    const t = this.pointerTile(p);
    // clicking an interactive object walks to it and opens it
    const obj = MAP.objects.find((o) => (INTERACTIVE as readonly string[]).includes(o.type) && t.x >= o.x && t.x < o.x + o.w && t.y >= o.y && t.y < o.y + o.h);
    if (obj && this.focus === obj) return this.interactObject();
    if (st.follow) st.set({ follow: null });
    this.walkToTile(t.x, obj && obj.layer === 'wall' ? t.y + 1 : t.y);
  }

  private onPointerMove(p: Phaser.Input.Pointer) {
    const b = useStore.getState().build;
    if (!b || !this.ghost) return;
    const t = this.pointerTile(p);
    this.drawGhost(t.x, t.y);
    if (p.isDown && (b.tool === 'floor' || b.tool === 'wall')) this.painted.set(`${t.x},${t.y}`, t);
  }

  private onPointerUp(p: Phaser.Input.Pointer) {
    const b = useStore.getState().build;
    if (!b) return;
    const t = this.pointerTile(p);
    if ((b.tool === 'floor' || b.tool === 'wall') && this.painted.size) {
      editor.snapshot();
      editor.paintTiles([...this.painted.values()], b.tool, b.floor as Floor);
      this.painted.clear();
      this.afterEdit();
    } else if (b.tool === 'area' && this.dragStart) {
      const x = Math.min(this.dragStart.x, t.x), y = Math.min(this.dragStart.y, t.y);
      const w = Math.abs(t.x - this.dragStart.x) + 1, h = Math.abs(t.y - this.dragStart.y) + 1;
      this.dragStart = null;
      if (w < 2 || h < 2) { useStore.getState().toast({ kind: 'warn', text: 'Drag across at least 2×2 tiles to draw an area.' }); this.drawGhost(t.x, t.y); return; }
      bus.emit('build:area', { x, y, w, h });
    }
  }

  // ------------------------------------------------------------------ build mode

  private buildDown(p: Phaser.Input.Pointer) {
    const b = useStore.getState().build!;
    const t = this.pointerTile(p);
    const toast = useStore.getState().toast;
    if (p.button === 2 || b.tool === 'erase') {
      editor.snapshot();
      if (editor.eraseAt(t.x, t.y)) this.afterEdit(); else editor.undo();
      return;
    }
    if (b.tool === 'floor' || b.tool === 'wall') { this.painted.clear(); this.painted.set(`${t.x},${t.y}`, t); this.drawGhost(t.x, t.y); return; }
    if (b.tool === 'area') { this.dragStart = t; return; }
    const type = (b.tool === 'door' ? 'door' : b.objType) as ObjType;
    editor.snapshot();
    const err = editor.placeObject(type, t.x, t.y, b.variant);
    if (err) { editor.undo(); toast({ kind: 'warn', text: err }); return; }
    this.afterEdit();
  }

  /** Re-render after an edit. */
  private afterEdit() {
    const st = useStore.getState();
    if (st.build) st.set({ build: { ...st.build, dirty: true } });
    useStore.setState((s) => ({ layoutVersion: s.layoutVersion + 1 }));
  }

  private drawBuildOverlay() {
    this.grid?.destroy(); this.ghost?.destroy(); this.grid = undefined; this.ghost = undefined;
    this.buildLabels.forEach((t) => t.destroy()); this.buildLabels = [];
    if (!useStore.getState().build) return;
    const g = this.grid = this.add.graphics().setDepth(DEPTH.tags - 1);
    g.lineStyle(1, 0xffffff, 0.07);
    for (let x = 0; x <= MAP_W; x++) g.lineBetween(x * TILE, 0, x * TILE, MAP_H * TILE);
    for (let y = 0; y <= MAP_H; y++) g.lineBetween(0, y * TILE, MAP_W * TILE, y * TILE);
    for (const z of MAP.zones) {
      g.lineStyle(2, z.kind === 'private' ? 0xf26b1d : 0x4aa3df, 0.8);
      g.strokeRect(z.rect.x * TILE + 1, z.rect.y * TILE + 1, z.rect.w * TILE - 2, z.rect.h * TILE - 2);
      this.buildLabels.push(this.add.text(z.rect.x * TILE + 4, z.rect.y * TILE + z.rect.h * TILE - 4, `${z.name}${z.kind === 'private' ? ' (private)' : ''}`, {
        fontFamily: PIXEL_FONT, fontSize: '11px', color: '#fff', backgroundColor: z.kind === 'private' ? 'rgba(242,107,29,.85)' : 'rgba(42,93,156,.85)', padding: { x: 3, y: 1 },
      }).setOrigin(0, 1).setDepth(DEPTH.tags).setResolution(2));
    }
    this.ghost = this.add.graphics().setDepth(DEPTH.tags + 1);
  }

  private drawGhost(tx: number, ty: number) {
    const b = useStore.getState().build;
    const g = this.ghost;
    if (!b || !g) return;
    g.clear();
    let w = 1, h = 1, color = 0xffffff;
    if (b.tool === 'object' || b.tool === 'door') { const d = OBJ_DEFS[(b.tool === 'door' ? 'door' : b.objType) as ObjType]; w = d.w; h = d.h; color = 0xf26b1d; }
    if (b.tool === 'erase') color = 0xef4444;
    if (b.tool === 'area' && this.dragStart) {
      const x = Math.min(this.dragStart.x, tx), y = Math.min(this.dragStart.y, ty);
      g.fillStyle(0x4aa3df, 0.18).fillRect(x * TILE, y * TILE, (Math.abs(tx - this.dragStart.x) + 1) * TILE, (Math.abs(ty - this.dragStart.y) + 1) * TILE);
      g.lineStyle(2, 0x4aa3df, 1).strokeRect(x * TILE, y * TILE, (Math.abs(tx - this.dragStart.x) + 1) * TILE, (Math.abs(ty - this.dragStart.y) + 1) * TILE);
      return;
    }
    for (const t of this.painted.values()) g.fillStyle(b.tool === 'wall' ? 0x1f2937 : 0xffffff, 0.45).fillRect(t.x * TILE, t.y * TILE, TILE, TILE);
    g.lineStyle(2, color, 0.95).strokeRect(tx * TILE, ty * TILE, w * TILE, h * TILE);
    g.fillStyle(color, 0.12).fillRect(tx * TILE, ty * TILE, w * TILE, h * TILE);
  }

  // ------------------------------------------------------------------ players

  private ensureTexture(p: PlayerState) {
    const key = avatarKey(p.avatar);
    if (!this.textures.exists(key)) {
      this.textures.addSpriteSheet(key, renderAvatarSheet(p.avatar) as any, { frameWidth: FRAME_W, frameHeight: FRAME_H });
      DIRS.forEach((d, row) => {
        if (!this.anims.exists(`${key}_${d}`))
          this.anims.create({ key: `${key}_${d}`, frames: this.anims.generateFrameNumbers(key, { frames: [row * 4 + 1, row * 4, row * 4 + 3, row * 4] }), frameRate: 9, repeat: -1 });
      });
    }
    return key;
  }

  private syncPlayers() {
    const { players, selfId, peers } = useStore.getState();
    for (const [id, a] of this.avatars) if (!players[id]) { a.c.destroy(); a.tag.destroy(); this.avatars.delete(id); }
    for (const p of Object.values(players)) {
      let a = this.avatars.get(p.id);
      const key = this.ensureTexture(p);
      if (!a) {
        const pos = positions.get(p.id) ?? { x: p.x, y: p.y };
        const ring = this.add.ellipse(0, -2, 30, 12).setStrokeStyle(2, 0x22c55e, 1).setVisible(false);
        const sprite = this.add.sprite(0, 0, key, 0).setOrigin(0.5, 0.95);
        const label = this.add.text(5, -FRAME_H - 2, '', {
          fontFamily: PIXEL_FONT, fontSize: '12px', fontStyle: '600', color: '#ffffff', backgroundColor: 'rgba(8,15,30,0.78)', padding: { x: 5, y: 2 },
        }).setOrigin(0.5, 1).setResolution(2);
        const dot = this.add.circle(0, 0, 3.5, 0x22c55e).setStrokeStyle(1, 0x081c35);
        const badges = this.add.text(0, 0, '', { fontSize: '11px' }).setOrigin(0, 1).setResolution(2);
        const c = this.add.container(pos.x, pos.y, [this.fx.avatarShadow(), ring, sprite]);
        const tag = this.add.container(pos.x, pos.y, [label, dot, badges]);
        a = { id: p.id, c, tag, sprite, label, dot, ring, badges, key: '', name: '', status: '', x: pos.x, y: pos.y, danceUntil: 0 };
        this.avatars.set(p.id, a);
        if (p.id === selfId) {
          this.cameras.main.startFollow(c, true, 0.12, 0.12);
          if (!savedCam) this.cameras.main.centerOn(pos.x, pos.y);
        }
      }
      if (a.key !== key) { a.key = key; a.sprite.setTexture(key, DIRS.indexOf(p.dir) * 4); }
      if (a.name !== p.name || a.status !== p.status) {
        a.name = p.name; a.status = p.status;
        a.label.setText(p.name);
        if (p.id === selfId) a.label.setColor('#ffd2b0');
        a.dot.setFillStyle(Phaser.Display.Color.HexStringToColor(statusInfo(p.status).color).color);
        a.dot.setPosition(a.label.x - a.label.width / 2 - 6, a.label.y - a.label.height / 2);
      }
      const showMute = !p.mic && (p.cam || p.id === selfId || !!peers[p.id]);
      a.badges.setText(`${p.spotlight ? '📢' : ''}${p.hand ? '✋' : ''}${p.bubble ? '🔒' : ''}${showMute ? '🔇' : ''}`)
        .setPosition(a.label.x + a.label.width / 2 + 2, a.label.y);
    }
  }

  private showEmote(id: string, e: string) {
    const a = this.avatars.get(id);
    const em = EMOTES.find((x) => x.id === e);
    if (!a || !em) return;
    if (e === 'dance') { a.danceUntil = this.time.now + 3200; return; }
    const self = this.selfId && positions.get(this.selfId);
    if (self && tileDistance(self, a) < 8) sfx.emote();
    const txt = this.add.text(0, 0, em.emoji, { fontSize: '20px' }).setOrigin(0.5).setResolution(2);
    const bg = this.add.graphics();
    bg.fillStyle(0xffffff, 0.96).fillRoundedRect(-17, -16, 34, 30, 8);
    bg.fillTriangle(-5, 13, 5, 13, 0, 20);
    bg.lineStyle(2, 0x081c35, 1).strokeRoundedRect(-17, -16, 34, 30, 8);
    const bubble = this.add.container(a.x, a.y - FRAME_H - 30, [bg, txt]).setDepth(DEPTH.tags + 5000).setScale(0.2);
    this.tweens.add({ targets: bubble, scale: 1, duration: 220, ease: 'Back.easeOut' });
    this.tweens.add({ targets: bubble, y: bubble.y - 22, alpha: 0, delay: 1700, duration: 700, ease: 'Sine.easeIn', onComplete: () => bubble.destroy() });
    this.time.addEvent({ delay: 16, repeat: 120, callback: () => { if (bubble.active) bubble.x = a.x; } });
  }

  // ------------------------------------------------------------------ rooms, doors & desks

  private updateRooms() {
    const { rooms } = useStore.getState();
    for (const [id, shade] of this.lockShades) shade.setVisible(!!rooms[id]?.locked);
    for (const d of this.doors) {
      const locked = !!(d.room && rooms[d.room]?.locked);
      if (locked === d.locked) continue;
      d.locked = locked;
      const key = `obj_${d.o.id}_${locked ? 'locked' : 'open'}`;
      if (!this.textures.exists(key)) this.textures.addCanvas(key, renderObject(d.o, locked ? 'locked' : 'open'));
      d.img.setTexture(key);
      this.tweens.add({ targets: d.img, alpha: { from: 0.4, to: 1 }, duration: 250 });
    }
    this.updateRoomLabels();
  }

  private updateRoomLabels() {
    const { rooms, players } = useStore.getState();
    const counts: Record<string, number> = {};
    for (const p of Object.values(players)) if (p.zone?.startsWith('room:')) counts[p.zone.slice(5)] = (counts[p.zone.slice(5)] ?? 0) + 1;
    for (const [id, label] of this.roomLabels) {
      const z = zoneById(id);
      if (!z) continue;
      const n = counts[id] ?? 0;
      const t = `${rooms[id]?.locked ? '🔒 ' : ''}${z.name}${n ? `  ·  ${n} inside` : ''}`;
      if (label.text !== t) label.setText(t);
    }
  }

  private updateDesks() {
    const { desks } = useStore.getState();
    for (const d of MAP.desks) {
      const owner = desks[d.id];
      let t = this.deskLabels.get(d.id);
      if (!t) {
        t = this.add.text((d.x + 1) * TILE, d.y * TILE + TILE - 3, '', {
          fontFamily: PIXEL_FONT, fontSize: '10px', color: '#081c35', backgroundColor: 'rgba(255,255,255,0.85)', padding: { x: 3, y: 0 },
        }).setOrigin(0.5, 1).setDepth(DEPTH.tags).setResolution(2);
        this.deskLabels.set(d.id, t);
      }
      t.setText(owner ? owner.name.split(' ')[0] : '').setVisible(!!owner);
    }
  }

  private updateSign() {
    const sign = useStore.getState().settings?.officeSign ?? 'RSP SUPPLY';
    for (const s of this.signObjs) {
      const key = `obj_${s.obj.id}_${Date.now()}`;
      this.textures.addCanvas(key, renderObject(s.obj, sign));
      s.img.setTexture(key);
    }
  }

  // ------------------------------------------------------------------ movement

  private blockedFor() {
    const { rooms, players, selfId } = useStore.getState();
    const me = selfId ? players[selfId] : null;
    const myRoom = me?.zone?.startsWith('room:') ? me.zone.slice(5) : null;
    const isAdmin = me?.role === 'admin';
    const counts: Record<string, number> = {};
    for (const p of Object.values(players)) if (p.zone?.startsWith('room:')) counts[p.zone.slice(5)] = (counts[p.zone.slice(5)] ?? 0) + 1;
    return (tx: number, ty: number) => {
      const z = zoneAt(tx, ty);
      if (!z || z.kind !== 'private' || z.id === myRoom) return false;
      const r = rooms[z.id];
      if (!r) return false;
      return (r.locked && !isAdmin) || (counts[z.id] ?? 0) >= r.capacity;
    };
  }

  walkToTile(tx: number, ty: number, quiet = false) {
    const self = this.selfId && positions.get(this.selfId);
    if (!self) return;
    const blocked = this.blockedFor();
    const dest = nearestFree(tx, ty, blocked);
    if (!dest) return;
    const path = findPath(tileOf(self.x), tileOf(self.y), dest.x, dest.y, blocked);
    if (!path) { if (!quiet) useStore.getState().toast({ kind: 'warn', text: "Can't get there from here. If it's a locked room, knock on its door (X)." }); return; }
    this.path = path;
    if (!quiet) this.clickMarker.setPosition(dest.x * TILE + TILE / 2, dest.y * TILE + TILE / 2 + 6).setVisible(true);
    this.following = true;
    this.cameras.main.startFollow(this.avatars.get(this.selfId!)!.c, true, 0.12, 0.12);
  }

  private walkToPlayer(id: string) {
    const target = positions.get(id);
    if (!target) return;
    this.walkToTile(tileOf(target.x), tileOf(target.y) + 1);
  }

  private locate(id: string) {
    const target = this.avatars.get(id);
    if (!target) return;
    const cam = this.cameras.main;
    if (id !== this.selfId) {
      cam.stopFollow();
      this.following = false;
      cam.pan(target.x, target.y - 20, 600, 'Sine.easeInOut');
    }
    this.markerUntil = this.time.now + 3500;
    this.marker.setData('id', id).setVisible(true);
    this.time.delayedCall(3500, () => {
      if (!this.following) { this.following = true; const me = this.avatars.get(this.selfId!); if (me) cam.startFollow(me.c, true, 0.08, 0.08); }
    });
  }

  private interactDesk() {
    const self = this.selfId && positions.get(this.selfId);
    if (!self) return;
    const { desks } = useStore.getState();
    const desk = MAP.desks.find((d) => tileDistance(self, { x: d.seatX, y: d.seatY }) < 1.6);
    if (desk) {
      if (!desks[desk.id]) send('desk:claim', { deskId: desk.id });
      else if (desks[desk.id].userId === this.selfId) send('desk:release');
    }
  }

  /** Press X: use the highlighted object (whiteboard, TV, board…) or knock on a locked door. */
  private interactObject() {
    const o = this.focus;
    if (!o) return;
    const st = useStore.getState();
    sfx.click();
    if (o.type === 'door') { const d = this.doors.find((d) => d.o === o); if (d?.room) send('room:knock', { roomId: d.room }); return; }
    switch (o.type) {
      case 'kiosk': st.set({ leftOpen: true }); st.toast({ kind: 'info', text: 'Directory opened on the left. Pick someone to locate, ring or follow.' }); return;
      case 'coffee': send('emote', 'coffee'); st.toast({ kind: 'ok', text: 'Fresh coffee. ☕' }); return;
      case 'waterCooler': send('emote', 'water'); st.toast({ kind: 'ok', text: 'Stay hydrated! 💧' }); return;
      case 'vending': send('emote', 'snack'); st.toast({ kind: 'ok', text: 'Snack break. 🍫' }); return;
      case 'clock': st.toast({ kind: 'info', text: `It's ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).` }); return;
      default: st.set({ openObject: o.id });
    }
  }

  private findFocus(pos: { x: number; y: number }): MapObject | null {
    const { rooms } = useStore.getState();
    let best: MapObject | null = null, bestD = TILE * 1.4;
    for (const o of MAP.objects) {
      const door = o.type === 'door' ? this.doors.find((d) => d.o === o) : null;
      if (!(INTERACTIVE as readonly string[]).includes(o.type) && !(door?.room && rooms[door.room]?.locked)) continue;
      if (door && zoneKeyAt(pos.x, pos.y) === 'room:' + door.room) continue;
      const cx = Phaser.Math.Clamp(pos.x, o.x * TILE, (o.x + o.w) * TILE);
      const cy = Phaser.Math.Clamp(pos.y, o.y * TILE, (o.y + o.h) * TILE);
      const d = Math.hypot(pos.x - cx, pos.y - cy);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  private setFocus(o: MapObject | null) {
    if (o === this.focus) return;
    const prev = this.focus && this.objImgs.get(this.focus.id);
    if (prev) { prev.preFX?.clear(); prev.clearTint(); }
    this.focus = o;
    const img = o && this.objImgs.get(o.id);
    if (img) {
      if (img.preFX && this.fx.quality === 'high') img.preFX.addGlow(0xffd166, 3, 0, false, 0.1, 10);
      else img.setTint(0xfff3c4);
    }
  }

  update(time: number, deltaMs: number) {
    const selfId = this.selfId;
    const dt = Math.min(deltaMs, 100) / 1000;
    if (selfId) this.updateSelf(selfId, time, dt);
    const { peers, localSpeaking } = useStore.getState();

    for (const a of this.avatars.values()) {
      const pos = positions.get(a.id);
      if (!pos) continue;
      if (a.id === selfId) { a.x = pos.x; a.y = pos.y; }
      else {
        const k = 1 - Math.pow(0.0001, dt); // frame-rate independent smoothing
        a.x += (pos.x - a.x) * k; a.y += (pos.y - a.y) * k;
        if (Math.hypot(pos.x - a.x, pos.y - a.y) > TILE * 4) { a.x = pos.x; a.y = pos.y; }
      }
      // sitting: idle on a chair → face the desk/table and sink into the seat
      const chair = !pos.moving ? this.chairs.find((c) => Math.abs(c.cx - a.x) < 12 && c.ty === tileOf(a.y - 4)) : undefined;
      let depth = a.y, dir = pos.dir, sy = 0;
      if (chair) {
        dir = (['up', 'down', 'right', 'left'] as Dir[])[chair.variant] ?? 'up';
        sy = chair.variant === 0 ? 2 : 5;
        depth = chair.variant === 0 ? chair.depth - 1 : chair.depth + 1;
      }
      const dancing = time < a.danceUntil;
      if (dancing) { dir = DIRS[Math.floor(time / 160) % 4]; sy = -Math.abs(Math.sin(time / 110)) * 6; }
      a.c.setPosition(Math.round(a.x), Math.round(a.y)).setDepth(depth);
      a.sprite.y = Math.round(sy);
      if (chair && chair.variant !== 0) a.sprite.setCrop(0, 0, FRAME_W, FRAME_H - 9);
      else if (a.sprite.isCropped) a.sprite.setCrop();
      a.tag.setPosition(Math.round(a.x), Math.round(a.y + (chair ? sy : 0))).setDepth(DEPTH.tags + a.y);
      this.fx.footstep(a.id, a.x, a.y, !!pos.moving && Math.hypot(pos.x - a.x, pos.y - a.y) < TILE, time);
      const anim = `${a.key}_${pos.dir}`;
      if (pos.moving && !dancing) { if (a.sprite.anims.currentAnim?.key !== anim || !a.sprite.anims.isPlaying) a.sprite.play(anim, true); }
      else { a.sprite.stop(); a.sprite.setFrame(DIRS.indexOf(dir) * 4); }
      const peer = peers[a.id];
      const speaking = a.id === selfId ? localSpeaking : !!peer?.speaking;
      const linked = !!peer && peer.mode !== 'audience';
      a.ring.setVisible(speaking || linked).setStrokeStyle(2, speaking ? 0x22c55e : 0xf26b1d, speaking ? 1 : 0.55);
    }

    if (this.marker.visible) {
      const t = this.avatars.get(this.marker.getData('id'));
      if (!t || time > this.markerUntil) this.marker.setVisible(false);
      else this.marker.setPosition(t.x, t.y - FRAME_H - 18 - Math.abs(Math.sin(time / 180)) * 6);
    }
  }

  private updateSelf(selfId: string, time: number, dt: number) {
    const pos = positions.get(selfId);
    if (!pos) return;
    const st = useStore.getState();
    let vx = 0, vy = 0;
    if (!typing()) {
      const k = this.keys;
      if (k.A.isDown || k.LEFT.isDown) vx -= 1;
      if (k.D.isDown || k.RIGHT.isDown) vx += 1;
      if (k.W.isDown || k.UP.isDown) vy -= 1;
      if (k.S.isDown || k.DOWN.isDown) vy += 1;
    }
    if (vx || vy) {
      this.path = []; this.clickMarker.setVisible(false);
      if (st.follow) { st.set({ follow: null }); st.toast({ kind: 'info', text: 'Stopped following.' }); }
    } else if (st.follow && time - this.followAt > 350) {
      // follow: keep walking to a tile next to the person
      this.followAt = time;
      const t = positions.get(st.follow);
      if (!t || !st.players[st.follow]) st.set({ follow: null });
      else if (tileDistance(pos, t) > 1.8) {
        const end = this.path[this.path.length - 1];
        if (!end || Math.hypot(end.x - tileOf(t.x), end.y - tileOf(t.y)) > 1.5) this.walkToTile(tileOf(t.x), tileOf(t.y) + 1, true);
      }
    }
    if (!vx && !vy && this.path.length) {
      const t = this.path[0];
      const gx = t.x * TILE + TILE / 2, gy = t.y * TILE + TILE / 2;
      const dx = gx - pos.x, dy = gy - pos.y;
      if (Math.hypot(dx, dy) < 3) { pos.x = gx; pos.y = gy; this.path.shift(); if (!this.path.length) this.clickMarker.setVisible(false); }
      else { vx = Math.abs(dx) > 2 ? Math.sign(dx) : 0; vy = Math.abs(dy) > 2 ? Math.sign(dy) : 0; }
    }
    const len = Math.hypot(vx, vy);
    this.moving = len > 0;
    if (len) {
      vx /= len; vy /= len;
      const blocked = this.blockedFor();
      const step = SPEED * dt;
      let mx = vx * step, my = vy * step;
      if (this.path.length) {
        const t = this.path[0];
        mx = Phaser.Math.Clamp(t.x * TILE + TILE / 2 - pos.x, -Math.abs(mx), Math.abs(mx));
        my = Phaser.Math.Clamp(t.y * TILE + TILE / 2 - pos.y, -Math.abs(my), Math.abs(my));
      }
      if (!boxBlocked(pos.x + mx, pos.y, blocked)) pos.x += mx;
      else if (this.path.length) pos.x += mx; // path tiles are known-walkable
      if (!boxBlocked(pos.x, pos.y + my, blocked)) pos.y += my;
      else if (this.path.length) pos.y += my;
      this.dir = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 'left' : 'right') : vy < 0 ? 'up' : 'down';
      if (!this.following) {
        this.following = true;
        this.cameras.main.startFollow(this.avatars.get(selfId)!.c, true, 0.12, 0.12);
      }
      if (st.card) st.set({ card: null });
    }
    pos.dir = this.dir;
    pos.moving = this.moving;

    const state = `${Math.round(pos.x)},${Math.round(pos.y)},${pos.dir},${pos.moving}`;
    if (state !== this.sentState && time - this.lastSent >= SEND_MS) {
      this.sentState = state;
      this.lastSent = time;
      send('move', { x: pos.x, y: pos.y, dir: pos.dir, moving: pos.moving });
      // optimistic zone update so UI (room banner) reacts instantly
      const z = zoneKeyAt(pos.x, pos.y);
      const me = st.players[selfId];
      if (me && me.zone !== z) st.patchPlayer({ id: selfId, zone: z });
    }

    // what can I interact with?
    const focus = st.build ? null : this.findFocus(pos);
    this.setFocus(focus);
    const { desks } = st;
    const desk = MAP.desks.find((d) => tileDistance(pos, { x: d.seatX, y: d.seatY }) < 1.6);
    let hint: string | null = null;
    if (focus) hint = focus.type === 'door' ? `Press X to knock on ${zoneById(this.doors.find((d) => d.o === focus)?.room)?.name ?? 'the door'}` : `Press X to ${ACTION[focus.type] ?? 'use this'}`;
    else if (desk) {
      const owner = desks[desk.id];
      hint = !owner ? `Press E to claim desk ${desk.id}` : owner.userId === selfId ? `Your desk (${desk.id}) · press E to release` : `${owner.name}'s desk`;
    }
    if (hint !== this.lastHint) { this.lastHint = hint; st.set({ hint }); }
  }
}

const ACTION: Partial<Record<string, string>> = {
  whiteboard: 'draw on the whiteboard', tv: 'watch / share on the TV', orderBoard: 'open the orders board', bookshelf: 'open the team bulletin',
  kiosk: 'open the directory', coffee: 'grab a coffee', waterCooler: 'get some water', vending: 'grab a snack', clock: 'check the time',
};

/** The private room a door leads into (checks the tiles on each side of it). */
function doorRoom(o: MapObject): string | null {
  const around: [number, number][] = [];
  for (let i = o.x; i < o.x + o.w; i++) around.push([i, o.y - 1], [i, o.y + 1], [i, o.y]);
  around.push([o.x - 1, o.y], [o.x + o.w, o.y]);
  for (const [x, y] of around) { const z = zoneAt(x, y); if (z?.kind === 'private') return z.id; }
  return null;
}

function typing() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
