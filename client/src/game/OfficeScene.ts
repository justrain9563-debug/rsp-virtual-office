import Phaser from 'phaser';
import {
  MAP, MAP_H, MAP_W, TILE, boxBlocked, findPath, nearestFree, privateZones, tileOf, zoneById, zoneAt, type MapObject,
} from '@shared/map';
import { tileDistance, zoneKeyAt } from '@shared/proximity';
import { statusInfo, type Dir, type PlayerState } from '@shared/types';
import { correction, send } from '../net/socket';
import { positions, useStore } from '../store';
import { OBJECT_PAD, renderBackground, renderObject } from './art';
import { DIRS, FRAME_H, FRAME_W, avatarKey, renderAvatarSheet } from './avatar';

const SPEED = 4.5 * TILE; // px per second
const SEND_MS = 66;

interface Avatar {
  id: string;
  c: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  dot: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Ellipse;
  mic: Phaser.GameObjects.Text;
  key: string;
  name: string;
  status: string;
  x: number;
  y: number;
}

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
  private unsub: (() => void)[] = [];
  private lastHint: string | null = null;
  private lastLocate = 0;
  private lastWalkTo = 0;
  private clickMarker!: Phaser.GameObjects.Ellipse;

  constructor() { super('office'); }

  create() {
    const bg = this.textures.addCanvas('bg', renderBackground())!;
    this.add.image(0, 0, bg).setOrigin(0, 0).setDepth(-10);

    const sign = useStore.getState().settings?.officeSign ?? 'RSP SUPPLY';
    for (const o of MAP.objects) {
      const key = 'obj_' + o.id;
      this.textures.addCanvas(key, renderObject(o, o.type === 'logo' ? sign : o.label));
      const pad = OBJECT_PAD(o);
      const img = this.add.image(o.x * TILE + o.ox - pad, (o.y + o.h) * TILE + pad, key).setOrigin(0, 1);
      img.setDepth(o.layer === 'floor' ? -5 : o.layer === 'wall' ? -4 : o.type === 'chair' ? o.y * TILE + 6 : (o.y + o.h) * TILE - 2);
      if (o.type === 'logo') this.signObjs.push({ obj: o, img });
    }

    // room occupancy labels + lock shading
    for (const z of privateZones()) {
      const r = z.rect;
      const shade = this.add.rectangle(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE, 0xef4444, 0.1).setOrigin(0, 0).setDepth(-3).setVisible(false);
      this.lockShades.set(z.id, shade);
      const label = this.add.text((r.x + r.w / 2) * TILE, r.y * TILE + 4, '', {
        fontFamily: 'Inter, sans-serif', fontSize: '11px', color: '#ffffff', backgroundColor: 'rgba(8,28,53,0.72)', padding: { x: 5, y: 2 },
      }).setOrigin(0.5, 0).setDepth(r.y * TILE + 8).setAlpha(0.9).setResolution(2);
      this.roomLabels.set(z.id, label);
    }

    this.marker = this.add.text(0, 0, '▼', { fontSize: '22px', color: '#f26b1d', stroke: '#081c35', strokeThickness: 4 }).setOrigin(0.5, 1).setDepth(200000).setVisible(false);
    this.clickMarker = this.add.ellipse(0, 0, 22, 10).setStrokeStyle(2, 0xf26b1d, 0.9).setDepth(-2).setVisible(false);

    // input
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,E', false) as any;
    this.input.keyboard!.on('keydown-E', () => { if (!typing()) this.interact(); });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.button !== 0) return;
      (document.activeElement as HTMLElement | null)?.blur?.();
      const tx = tileOf(p.worldX), ty = tileOf(p.worldY);
      const hit = [...this.avatars.values()].find((a) => a.id !== this.selfId && Math.abs(a.x - p.worldX) < 14 && p.worldY < a.y + 4 && p.worldY > a.y - FRAME_H);
      if (hit) { useStore.getState().set({ locate: { id: hit.id, t: Date.now() }, leftOpen: true }); }
      this.walkToTile(tx, ty);
    });
    this.input.on('wheel', (_p: any, _o: any, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.5, 2.5));
    });

    const cam = this.cameras.main;
    cam.setBounds(-TILE * 4, -TILE * 2, (MAP_W + 8) * TILE, (MAP_H + 4) * TILE);
    cam.setZoom(Phaser.Math.Clamp(this.scale.width / (26 * TILE), 0.7, 1.6));
    cam.setRoundPixels(true);
    cam.setBackgroundColor('#0b1220');

    correction.handler = (x, y) => {
      positions.set(this.selfId!, { ...(positions.get(this.selfId!) ?? { dir: 'down', moving: false }), x, y });
      this.path = [];
    };

    this.syncPlayers();
    this.unsub.push(useStore.subscribe((s, prev) => {
      if (s.players !== prev.players || s.selfId !== prev.selfId) this.syncPlayers();
      if (s.rooms !== prev.rooms) this.updateRooms();
      if (s.desks !== prev.desks) this.updateDesks();
      if (s.settings?.officeSign !== prev.settings?.officeSign) this.updateSign();
      if (s.locate && s.locate.t !== this.lastLocate) { this.lastLocate = s.locate.t; this.locate(s.locate.id); }
      if (s.walkTo && s.walkTo.t !== this.lastWalkTo) { this.lastWalkTo = s.walkTo.t; this.walkToPlayer(s.walkTo.id); }
    }));
    this.updateRooms();
    this.updateDesks();
    const dbg = (window as any).__rsp;
    if (dbg) dbg.scene = this; // used by the automated browser test (tools/e2e.mjs)
    this.time.addEvent({ delay: 400, loop: true, callback: () => this.updateRoomLabels() });
    this.events.once('shutdown', () => { this.unsub.forEach((u) => u()); correction.handler = null; });
  }

  private get selfId() { return useStore.getState().selfId; }

  // ------------------------------------------------------------------ players

  private ensureTexture(p: PlayerState) {
    const key = avatarKey(p.avatar);
    if (!this.textures.exists(key)) {
      this.textures.addSpriteSheet(key, renderAvatarSheet(p.avatar) as any, { frameWidth: FRAME_W, frameHeight: FRAME_H });
      DIRS.forEach((d, row) => {
        this.anims.create({ key: `${key}_${d}`, frames: this.anims.generateFrameNumbers(key, { frames: [row * 4 + 1, row * 4, row * 4 + 3, row * 4] }), frameRate: 9, repeat: -1 });
      });
    }
    return key;
  }

  private syncPlayers() {
    const { players, selfId } = useStore.getState();
    for (const [id, a] of this.avatars) if (!players[id]) { a.c.destroy(); this.avatars.delete(id); }
    for (const p of Object.values(players)) {
      let a = this.avatars.get(p.id);
      const key = this.ensureTexture(p);
      if (!a) {
        const pos = positions.get(p.id) ?? { x: p.x, y: p.y };
        const ring = this.add.ellipse(0, -2, 30, 12).setStrokeStyle(2, 0x22c55e, 1).setVisible(false);
        const sprite = this.add.sprite(0, 0, key, 0).setOrigin(0.5, 0.95);
        const label = this.add.text(5, -FRAME_H - 2, '', {
          fontFamily: 'Inter, sans-serif', fontSize: '11px', fontStyle: '600', color: '#ffffff', backgroundColor: 'rgba(8,15,30,0.72)', padding: { x: 4, y: 2 },
        }).setOrigin(0.5, 1).setResolution(2);
        const dot = this.add.circle(0, 0, 3.5, 0x22c55e).setStrokeStyle(1, 0x081c35);
        const mic = this.add.text(0, 0, '', { fontSize: '10px' }).setOrigin(0, 1).setResolution(2);
        const c = this.add.container(pos.x, pos.y, [ring, sprite, label, dot, mic]);
        a = { id: p.id, c, sprite, label, dot, ring, mic, key: '', name: '', status: '', x: pos.x, y: pos.y };
        this.avatars.set(p.id, a);
        if (p.id === selfId) {
          this.cameras.main.startFollow(c, true, 0.12, 0.12);
          this.cameras.main.centerOn(pos.x, pos.y);
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
      a.mic.setText(p.mic ? '' : '🔇').setPosition(a.label.x + a.label.width / 2 + 2, a.label.y);
      a.mic.setVisible(!p.mic && (p.cam || p.id === selfId || !!useStore.getState().peers[p.id]));
    }
  }

  // ------------------------------------------------------------------ rooms & desks

  private updateRooms() {
    const { rooms } = useStore.getState();
    for (const [id, shade] of this.lockShades) shade.setVisible(!!rooms[id]?.locked);
    this.updateRoomLabels();
  }

  private updateRoomLabels() {
    const { rooms, players } = useStore.getState();
    const counts: Record<string, number> = {};
    for (const p of Object.values(players)) if (p.zone?.startsWith('room:')) counts[p.zone.slice(5)] = (counts[p.zone.slice(5)] ?? 0) + 1;
    for (const [id, label] of this.roomLabels) {
      const z = zoneById(id)!;
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
          fontFamily: 'Inter, sans-serif', fontSize: '9px', color: '#081c35', backgroundColor: 'rgba(255,255,255,0.8)', padding: { x: 2, y: 0 },
        }).setOrigin(0.5, 1).setDepth((d.y + 1) * TILE - 1).setResolution(2);
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

  walkToTile(tx: number, ty: number) {
    const self = this.selfId && positions.get(this.selfId);
    if (!self) return;
    const blocked = this.blockedFor();
    const dest = nearestFree(tx, ty, blocked);
    if (!dest) return;
    const path = findPath(tileOf(self.x), tileOf(self.y), dest.x, dest.y, blocked);
    if (!path) { useStore.getState().toast({ kind: 'warn', text: "Can't get there from here." }); return; }
    this.path = path;
    this.clickMarker.setPosition(dest.x * TILE + TILE / 2, dest.y * TILE + TILE / 2 + 6).setVisible(true);
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

  private interact() {
    const self = this.selfId && positions.get(this.selfId);
    if (!self) return;
    const { desks } = useStore.getState();
    const desk = MAP.desks.find((d) => tileDistance(self, { x: d.seatX, y: d.seatY }) < 1.6);
    if (desk) {
      if (!desks[desk.id]) send('desk:claim', { deskId: desk.id });
      else if (desks[desk.id].userId === this.selfId) send('desk:release');
    }
  }

  update(time: number, deltaMs: number) {
    const selfId = this.selfId;
    const dt = Math.min(deltaMs, 100) / 1000;
    if (selfId) this.updateSelf(selfId, time, dt);
    const { peers, localSpeaking, players } = useStore.getState();

    for (const a of this.avatars.values()) {
      const pos = positions.get(a.id);
      if (!pos) continue;
      if (a.id === selfId) { a.x = pos.x; a.y = pos.y; }
      else {
        const k = 1 - Math.pow(0.0001, dt); // frame-rate independent smoothing
        a.x += (pos.x - a.x) * k; a.y += (pos.y - a.y) * k;
        if (Math.hypot(pos.x - a.x, pos.y - a.y) > TILE * 4) { a.x = pos.x; a.y = pos.y; }
      }
      a.c.setPosition(Math.round(a.x), Math.round(a.y)).setDepth(a.y);
      const anim = `${a.key}_${pos.dir}`;
      if (pos.moving) { if (a.sprite.anims.currentAnim?.key !== anim || !a.sprite.anims.isPlaying) a.sprite.play(anim, true); }
      else { a.sprite.stop(); a.sprite.setFrame(DIRS.indexOf(pos.dir) * 4); }
      const speaking = a.id === selfId ? localSpeaking : !!peers[a.id]?.speaking;
      const linked = !!peers[a.id];
      a.ring.setVisible(speaking || linked).setStrokeStyle(2, speaking ? 0x22c55e : 0xf26b1d, speaking ? 1 : 0.55);
      const p = players[a.id];
      if (p) a.mic.setVisible(!p.mic && (p.cam || a.id === selfId || linked));
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
    let vx = 0, vy = 0;
    if (!typing()) {
      const k = this.keys;
      if (k.A.isDown || k.LEFT.isDown) vx -= 1;
      if (k.D.isDown || k.RIGHT.isDown) vx += 1;
      if (k.W.isDown || k.UP.isDown) vy -= 1;
      if (k.S.isDown || k.DOWN.isDown) vy += 1;
    }
    if (vx || vy) { this.path = []; this.clickMarker.setVisible(false); }
    else if (this.path.length) {
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
      const me = useStore.getState().players[selfId];
      if (me && me.zone !== z) useStore.getState().patchPlayer({ id: selfId, zone: z });
    }

    // interaction hint
    const { desks } = useStore.getState();
    const desk = MAP.desks.find((d) => tileDistance(pos, { x: d.seatX, y: d.seatY }) < 1.6);
    let hint: string | null = null;
    if (desk) {
      const owner = desks[desk.id];
      hint = !owner ? `Press E to claim desk ${desk.id}` : owner.userId === selfId ? `Your desk (${desk.id}) · press E to release` : `${owner.name}'s desk`;
    }
    if (hint !== this.lastHint) { this.lastHint = hint; useStore.getState().set({ hint }); }
  }
}

function typing() {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
