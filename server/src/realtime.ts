// Real-time office: authoritative presence, movement validation, zones,
// proximity conversation groups, WebRTC signaling relay, chat, waves, rooms, desks.
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { DEFAULT_LAYOUT, MAP, TILE, applyLayout, exportLayout, isSolid, spawnPoint, tileOf, validateLayout, zoneById, type Layout } from '../../shared/map';
import { flushObjects, registerObjects } from './objects';
import { evaluatePair, tileDistance, zoneKeyAt } from '../../shared/proximity';
import {
  DEPTS, EMOTES, REACTIONS, STATUSES, type ChatMessage, type DeskInfo, type Dir, type PeerMode, type PlayerState, type RequestKind, type Status,
} from '../../shared/types';
import { rateLimited, uidFromCookieHeader } from './auth';
import { db } from './db';
import { setSetting } from './db';
import { ensureRooms, getUser, rooms, settings } from './state';

interface Conn {
  uid: string;
  socket: Socket | null;
  p: PlayerState;
  lastMoveAt: number;
  peers: Map<string, PeerMode>;
  dirty: boolean;
  autoMeeting: boolean;
  goneTimer: NodeJS.Timeout | null;
}

interface PendingRequest { id: string; from: string; to: string; kind: RequestKind | 'knock'; roomId?: string; expires: number }

const conns = new Map<string, Conn>();
const requests = new Map<string, PendingRequest>();
const bubbles = new Map<string, Set<string>>();
let reqSeq = 1;
const MAX_AUDIENCE = 60;
let desks: Record<string, DeskInfo> = {};
let io: Server;

const MAX_SPEED = 6 * TILE; // px/s, generous vs the client's 4.5 tiles/s
const RECONNECT_GRACE_MS = 10_000;

const roomIdOfZone = (zone: string | null) => (zone?.startsWith('room:') ? zone.slice(5) : null);
const occupancy = (roomId: string) => [...conns.values()].filter((c) => roomIdOfZone(c.p.zone) === roomId).length;
const playerList = () => [...conns.values()].map((c) => c.p);

function toPlayer(row: any, x: number, y: number): PlayerState {
  return {
    id: row.id, name: row.name, title: row.title, dept: row.dept, role: row.role, avatar: row.avatar,
    x, y, dir: 'down', moving: false, status: row.status, mic: false, cam: false, screen: false, zone: zoneKeyAt(x, y),
    statusText: row.status_text ?? '', hand: false, bubble: null, spotlight: false,
  };
}

async function loadDesks() {
  const r = await db.query('SELECT id, name, desk_id FROM users WHERE desk_id IS NOT NULL AND banned=false');
  desks = {};
  for (const row of r.rows) if (MAP.desks.some((d) => d.id === row.desk_id)) desks[row.desk_id] = { userId: row.id, name: row.name };
}

function broadcastUpdate(c: Conn, fields: (keyof PlayerState)[]) {
  const patch: any = { id: c.uid };
  for (const f of fields) patch[f] = c.p[f];
  io.to('all').emit('player:update', patch);
}

// ------------------------------------------------------------------ teleport, bubbles, layout

/** Move `c` to a free tile next to `target`, in the same area. Returns false if there is no space or it is locked. */
function teleportNear(c: Conn, target: Conn, bypassLock = false): boolean {
  const tz = target.p.zone;
  const roomId = roomIdOfZone(tz);
  if (roomId && roomIdOfZone(c.p.zone) !== roomId) {
    const room = rooms.get(roomId);
    if (room?.locked && !bypassLock && c.p.role !== 'admin') { c.socket?.emit('toast', { kind: 'warn', text: `${target.p.name} is in a locked room. Knock to ask to come in.` }); return false; }
    if (room && occupancy(roomId) >= room.capacity) { c.socket?.emit('toast', { kind: 'warn', text: `${zoneById(roomId)?.name} is full.` }); return false; }
  }
  const tx0 = tileOf(target.p.x), ty0 = tileOf(target.p.y);
  const taken = new Set([...conns.values()].filter((o) => o !== c).map((o) => `${tileOf(o.p.x)},${tileOf(o.p.y)}`));
  for (let r = 1; r <= 6; r++)
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const tx = tx0 + i, ty = ty0 + j;
        const x = tx * TILE + TILE / 2, y = ty * TILE + TILE / 2;
        if (isSolid(tx, ty) || taken.has(`${tx},${ty}`) || zoneKeyAt(x, y) !== tz) continue;
        moveTo(c, x, y);
        return true;
      }
  c.socket?.emit('toast', { kind: 'warn', text: `There's no space next to ${target.p.name} right now.` });
  return false;
}

function moveTo(c: Conn, x: number, y: number) {
  c.p.x = x; c.p.y = y; c.p.moving = false;
  c.lastMoveAt = Date.now();
  c.dirty = true;
  c.socket?.emit('correct', { x, y, teleport: true });
  const z = zoneKeyAt(x, y);
  if (z !== c.p.zone) onZoneChange(c, z);
}

function clearBubble(id: string) {
  const b = bubbles.get(id);
  bubbles.delete(id);
  for (const uid of b ?? []) { const o = conns.get(uid); if (o && o.p.bubble === id) { o.p.bubble = null; broadcastUpdate(o, ['bubble']); } }
}
function leaveBubble(c: Conn) {
  const id = c.p.bubble;
  if (!id) return;
  c.p.bubble = null;
  broadcastUpdate(c, ['bubble']);
  const b = bubbles.get(id);
  if (!b) return;
  b.delete(c.uid);
  if (b.size < 2) clearBubble(id);
}

async function setLayout(l: Layout, by: string) {
  applyLayout(l);
  await setSetting('layout', l);
  await ensureRooms();
  await loadDesks();
  io.to('all').emit('layout', { layout: exportLayout(), by });
  io.to('all').emit('rooms', [...rooms.values()]);
  io.to('all').emit('desks', desks);
  // anyone now standing inside a wall or object is moved somewhere free
  for (const c of conns.values()) {
    if (!isSolid(tileOf(c.p.x), tileOf(c.p.y))) { const z = zoneKeyAt(c.p.x, c.p.y); if (z !== c.p.zone) onZoneChange(c, z); continue; }
    const sp = spawnPoint();
    moveTo(c, sp.x, sp.y);
  }
}

// ------------------------------------------------------------------ chat helpers

function channelAllowed(c: Conn, channel: string) {
  if (channel === 'general') return true;
  if (channel.startsWith('dept:')) {
    const d = channel.slice(5);
    return DEPTS.some((x) => x.id === d) && (c.p.dept === d || c.p.role !== 'member');
  }
  const m = /^dm:([\w-]+):([\w-]+)$/.exec(channel);
  return !!m && (m[1] === c.uid || m[2] === c.uid) && m[1] < m[2];
}
function channelAudience(channel: string) {
  if (channel === 'general') return io.to('chan:general');
  if (channel.startsWith('dept:')) return io.to('chan:' + channel);
  const [, a, b] = channel.split(':');
  return io.to([`user:${a}`, `user:${b}`]);
}
async function reactionsFor(ids: number[]) {
  const out: Record<number, Record<string, string[]>> = {};
  if (!ids.length) return out;
  const r = await db.query('SELECT message_id, user_id, emoji FROM reactions WHERE message_id = ANY($1::int[])', [ids]);
  for (const row of r.rows) ((out[row.message_id] ??= {})[row.emoji] ??= []).push(row.user_id);
  return out;
}
const rowToMsg = (row: any, reactions: Record<string, string[]> = {}): ChatMessage => ({
  id: row.id, channel: row.channel, senderId: row.sender_id, senderName: row.sender_name, body: row.body,
  createdAt: new Date(row.created_at).toISOString(), reactions,
});

function joinChannels(c: Conn) {
  const s = c.socket;
  if (!s) return;
  for (const room of s.rooms) if (room.startsWith('chan:dept:')) s.leave(room);
  s.join('chan:general');
  if (c.p.role !== 'member') for (const d of DEPTS) s.join('chan:dept:' + d.id);
  else s.join('chan:dept:' + c.p.dept);
}

// ------------------------------------------------------------------ lifecycle

export function initRealtime(server: HttpServer) {
  io = new Server(server, { maxHttpBufferSize: 256 * 1024, pingInterval: 10_000, pingTimeout: 8_000 });

  io.use(async (socket, next) => {
    const uid = uidFromCookieHeader(socket.handshake.headers.cookie);
    const row = uid ? await getUser(uid) : null;
    if (!row || row.banned) return next(new Error('unauthorized'));
    (socket.data as any).row = row;
    next();
  });

  io.on('connection', (socket) => onConnect(socket).catch((e) => console.error('[rt] connect error', e)));

  setInterval(proximityTick, 150);
  setInterval(positionsTick, 66);
  loadDesks();
  return io;
}

async function onConnect(socket: Socket) {
  const row = (socket.data as any).row;
  const uid: string = row.id;
  let c = conns.get(uid);
  let fresh = false;
  if (c) {
    if (c.goneTimer) { clearTimeout(c.goneTimer); c.goneTimer = null; }
    if (c.socket && c.socket.id !== socket.id) {
      c.socket.emit('kicked', 'You opened the office in another tab or window.');
      c.socket.disconnect(true);
    }
    c.socket = socket;
    c.peers = new Map();
    // Anyone still linked to the old connection drops it now; the next tick re-links with fresh WebRTC sessions.
    for (const o of conns.values()) {
      if (o.uid !== uid && o.peers.delete(uid) && o.socket) o.socket.emit('peers', [...o.peers].map(([id, mode]) => ({ id, mode })));
    }
  } else {
    let x = row.last_x, y = row.last_y;
    const deskSeat = row.desk_id ? MAP.desks.find((d) => d.id === row.desk_id) : null;
    if (deskSeat) { x = deskSeat.seatX; y = deskSeat.seatY; }
    if (typeof x !== 'number' || isSolid(tileOf(x), tileOf(y)) || roomIdOfZone(zoneKeyAt(x, y))) {
      const sp = spawnPoint(); x = sp.x; y = sp.y;
    }
    c = { uid, socket, p: toPlayer(row, x, y), lastMoveAt: Date.now(), peers: new Map(), dirty: false, autoMeeting: false, goneTimer: null };
    if (c.p.status === 'meeting') c.p.status = 'available';
    conns.set(uid, c);
    fresh = true;
  }
  const conn = c;
  socket.join('all');
  socket.join('user:' + uid);
  joinChannels(conn);

  socket.emit('init', {
    selfId: uid, players: playerList(), rooms: [...rooms.values()], settings, desks, layout: exportLayout(),
  });
  if (fresh) socket.broadcast.to('all').emit('player:join', conn.p);
  await db.query('UPDATE users SET last_seen=now() WHERE id=$1', [uid]);

  socket.on('move', (m: { x: number; y: number; dir: Dir; moving: boolean }) => {
    if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
    const now = Date.now();
    const dt = Math.max(0.016, (now - conn.lastMoveAt) / 1000);
    const dist = Math.hypot(m.x - conn.p.x, m.y - conn.p.y);
    const tx = tileOf(m.x), ty = tileOf(m.y);
    let reject = isSolid(tx, ty) || dist > MAX_SPEED * dt + TILE * 1.5;
    const newZone = zoneKeyAt(m.x, m.y);
    const roomId = roomIdOfZone(newZone);
    if (!reject && roomId && newZone !== conn.p.zone) {
      const room = rooms.get(roomId);
      if (room && room.locked && conn.p.role !== 'admin') { reject = true; socket.emit('toast', { kind: 'warn', text: `${zoneById(roomId)?.name} is locked.` }); }
      else if (room && occupancy(roomId) >= room.capacity) { reject = true; socket.emit('toast', { kind: 'warn', text: `${zoneById(roomId)?.name} is full.` }); }
    }
    if (reject) {
      socket.emit('correct', { x: conn.p.x, y: conn.p.y });
      return;
    }
    conn.lastMoveAt = now;
    conn.p.x = m.x; conn.p.y = m.y;
    conn.p.dir = (['down', 'left', 'right', 'up'] as Dir[]).includes(m.dir) ? m.dir : 'down';
    conn.p.moving = !!m.moving;
    conn.dirty = true;
    if (newZone !== conn.p.zone) onZoneChange(conn, newZone);
  });

  socket.on('status', async (s: Status) => {
    if (!STATUSES.some((x) => x.id === s)) return;
    conn.p.status = s;
    conn.autoMeeting = false;
    broadcastUpdate(conn, ['status']);
    await db.query('UPDATE users SET status=$2 WHERE id=$1', [uid, s === 'meeting' ? 'available' : s]);
  });

  socket.on('media', (m: { mic: boolean; cam: boolean; screen: boolean }) => {
    conn.p.mic = !!m?.mic; conn.p.cam = !!m?.cam; conn.p.screen = !!m?.screen;
    broadcastUpdate(conn, ['mic', 'cam', 'screen']);
  });

  // WebRTC signaling is only relayed between players the server has put in the same conversation.
  socket.on('signal', (msg: { to: string; data: unknown }) => {
    if (!msg || typeof msg.to !== 'string') return;
    if (!conn.peers.has(msg.to)) return;
    const target = conns.get(msg.to);
    if (!target?.socket || !target.peers.has(uid)) return;
    if (JSON.stringify(msg.data ?? null).length > 100_000) return;
    target.socket.emit('signal', { from: uid, data: msg.data });
  });

  socket.on('chat:send', async (m: { channel: string; body: string }, ack?: (r: any) => void) => {
    try {
      const body = String(m?.body ?? '').trim().slice(0, 2000);
      if (!body || !channelAllowed(conn, m.channel)) return ack?.({ ok: false });
      if (rateLimited('chat:' + uid, 20, 10_000)) return ack?.({ ok: false, error: 'Slow down a little.' });
      const r = await db.query(
        'INSERT INTO messages(channel, sender_id, sender_name, body) VALUES($1,$2,$3,$4) RETURNING *',
        [m.channel, uid, conn.p.name, body],
      );
      channelAudience(m.channel).emit('chat:message', rowToMsg(r.rows[0]));
      ack?.({ ok: true });
    } catch (e) { console.error(e); ack?.({ ok: false }); }
  });

  socket.on('chat:history', async (m: { channel: string; before?: number }, ack?: (r: any) => void) => {
    if (typeof ack !== 'function' || !channelAllowed(conn, m?.channel)) return ack?.([]);
    const r = await db.query(
      'SELECT * FROM messages WHERE channel=$1 AND ($2::int IS NULL OR id < $2) ORDER BY id DESC LIMIT 60',
      [m.channel, m.before ?? null],
    );
    const reacts = await reactionsFor(r.rows.map((x: any) => x.id));
    ack(r.rows.reverse().map((x: any) => rowToMsg(x, reacts[x.id])));
  });

  socket.on('chat:dms', async (ack?: (r: any) => void) => {
    if (typeof ack !== 'function') return;
    const r = await db.query(
      `SELECT channel, max(id) AS last FROM messages WHERE channel LIKE 'dm:%' AND (channel LIKE $1 OR channel LIKE $2)
       GROUP BY channel ORDER BY last DESC LIMIT 50`,
      [`dm:${uid}:%`, `dm:%:${uid}`],
    );
    ack(r.rows.map((x: any) => x.channel));
  });

  socket.on('chat:react', async (m: { messageId: number; emoji: string }) => {
    if (!REACTIONS.includes(m?.emoji) || !Number.isInteger(m?.messageId)) return;
    const r = await db.query('SELECT channel FROM messages WHERE id=$1', [m.messageId]);
    const channel = r.rows[0]?.channel;
    if (!channel || !channelAllowed(conn, channel)) return;
    const del = await db.query('DELETE FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3 RETURNING 1', [m.messageId, uid, m.emoji]);
    if (!del.rows.length) await db.query('INSERT INTO reactions VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [m.messageId, uid, m.emoji]);
    const reacts = await reactionsFor([m.messageId]);
    channelAudience(channel).emit('chat:reaction', { messageId: m.messageId, channel, reactions: reacts[m.messageId] ?? {} });
  });

  socket.on('wave', (m: { to: string; message?: string }) => {
    const target = conns.get(m?.to);
    if (!target?.socket || target.uid === uid) return;
    if (rateLimited('wave:' + uid, 6, 30_000)) return socket.emit('toast', { kind: 'warn', text: 'Easy on the waving!' });
    if (target.p.status === 'dnd') return socket.emit('toast', { kind: 'warn', text: `${target.p.name} is on Do Not Disturb.` });
    target.socket.emit('wave', { from: uid, fromName: conn.p.name, message: String(m.message ?? '').slice(0, 140) });
    socket.emit('toast', { kind: 'ok', text: `You waved at ${target.p.name} 👋` });
  });

  // ---- emotes, raised hand, custom status
  socket.on('emote', (e: string) => {
    if (!EMOTES.some((x) => x.id === e)) return;
    if (e === 'hand') { conn.p.hand = !conn.p.hand; broadcastUpdate(conn, ['hand']); return; }
    if (rateLimited('emote:' + uid, 12, 6_000)) return;
    io.to('all').emit('emote', { id: uid, e });
  });
  socket.on('status:text', async (t: string) => {
    conn.p.statusText = String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    broadcastUpdate(conn, ['statusText']);
    await db.query('UPDATE users SET status_text=$2 WHERE id=$1', [uid, conn.p.statusText]);
  });

  // ---- teleport / ring / invite / knock
  socket.on('teleport', (m: { to: string }) => {
    const target = conns.get(m?.to);
    if (!target || target.uid === uid) return;
    if (rateLimited('tp:' + uid, 10, 30_000)) return;
    if (target.p.status === 'dnd' && conn.p.role !== 'admin') return socket.emit('toast', { kind: 'warn', text: `${target.p.name} is on Do Not Disturb. Try ringing them instead.` });
    if (target.p.bubble && target.p.bubble !== conn.p.bubble) return socket.emit('toast', { kind: 'warn', text: `${target.p.name} is in a locked conversation.` });
    teleportNear(conn, target);
  });
  socket.on('request', (m: { to: string; kind: RequestKind }) => {
    const target = conns.get(m?.to);
    if (!target?.socket || target.uid === uid || !['ring', 'invite'].includes(m.kind)) return;
    if (rateLimited('req:' + uid, 6, 30_000)) return socket.emit('toast', { kind: 'warn', text: 'Give them a moment to answer.' });
    if (target.p.status === 'dnd') return socket.emit('toast', { kind: 'warn', text: `${target.p.name} is on Do Not Disturb.` });
    const id = String(reqSeq++);
    requests.set(id, { id, from: uid, to: target.uid, kind: m.kind, expires: Date.now() + 60_000 });
    target.socket.emit('request', { id, from: uid, fromName: conn.p.name, kind: m.kind });
    socket.emit('toast', { kind: 'ok', text: m.kind === 'ring' ? `Ringing ${target.p.name}…` : `Invited ${target.p.name} to join you.` });
  });
  socket.on('request:answer', (m: { id: string; accept: boolean }) => {
    const r = requests.get(m?.id);
    if (!r || r.expires < Date.now()) return socket.emit('toast', { kind: 'warn', text: 'That request has expired.' });
    if (r.kind === 'knock' ? roomIdOfZone(conn.p.zone) !== r.roomId : r.to !== uid) return;
    requests.delete(r.id);
    if (r.kind === 'knock') for (const o of conns.values()) if (o.uid !== uid && roomIdOfZone(o.p.zone) === r.roomId) o.socket?.emit('request:closed', r.id);
    const from = conns.get(r.from);
    if (!from) return;
    if (!m.accept) { from.socket?.emit('toast', { kind: 'info', text: `${conn.p.name} can't right now.` }); return; }
    if (r.kind === 'invite') teleportNear(conn, from);
    else teleportNear(from, conn, r.kind === 'knock');
  });
  socket.on('room:knock', (m: { roomId: string }) => {
    const room = rooms.get(m?.roomId);
    if (!room) return;
    const inside = [...conns.values()].filter((o) => o.socket && roomIdOfZone(o.p.zone) === room.id);
    if (!inside.length) return socket.emit('toast', { kind: 'info', text: 'Nobody is inside.' });
    if (rateLimited('knock:' + uid, 4, 30_000)) return socket.emit('toast', { kind: 'warn', text: 'You knocked. Give them a moment.' });
    const id = String(reqSeq++);
    requests.set(id, { id, from: uid, to: '', kind: 'knock', roomId: room.id, expires: Date.now() + 60_000 });
    for (const o of inside) o.socket!.emit('request', { id, from: uid, fromName: conn.p.name, kind: 'knock', roomName: zoneById(room.id)?.name });
    socket.emit('toast', { kind: 'ok', text: `You knocked on ${zoneById(room.id)?.name}. 🚪` });
  });

  // ---- nearby chat (not saved, like Gather's "Nearby" chat)
  socket.on('chat:nearby', (m: { body: string }) => {
    const body = String(m?.body ?? '').trim().slice(0, 1000);
    if (!body || rateLimited('chat:' + uid, 20, 10_000)) return;
    const msg: ChatMessage = { id: -(Date.now() * 100 + Math.floor(Math.random() * 100)), channel: 'nearby', senderId: uid, senderName: conn.p.name, body, createdAt: new Date().toISOString(), reactions: {} };
    const ids = new Set([uid, ...[...conn.peers].filter(([, mode]) => mode === 'proximity' || mode === 'room').map(([id]) => id)]);
    const room = roomIdOfZone(conn.p.zone);
    for (const o of conns.values()) if (room ? roomIdOfZone(o.p.zone) === room : !roomIdOfZone(o.p.zone) && tileDistance(o.p, conn.p) <= settings.proximity.connectRadius + 1) ids.add(o.uid);
    for (const id of ids) io.to('user:' + id).emit('chat:message', msg);
  });

  // ---- lock a conversation in an open area so others can't join
  socket.on('convo:lock', (locked: boolean) => {
    if (!locked) { if (conn.p.bubble) clearBubble(conn.p.bubble); return; }
    if (roomIdOfZone(conn.p.zone)) return socket.emit('toast', { kind: 'warn', text: 'Meeting rooms have their own lock.' });
    const members = [...conn.peers].filter(([, mode]) => mode === 'proximity').map(([id]) => conns.get(id)!).filter(Boolean);
    if (!members.length) return socket.emit('toast', { kind: 'warn', text: 'Walk up to someone first.' });
    for (const o of [conn, ...members]) leaveBubble(o);
    const id = 'b' + reqSeq++;
    bubbles.set(id, new Set([conn.uid, ...members.map((o) => o.uid)]));
    for (const o of [conn, ...members]) { o.p.bubble = id; broadcastUpdate(o, ['bubble']); o.socket?.emit('toast', { kind: 'info', text: `🔒 ${conn.p.name} locked this conversation. Others nearby can't join.` }); }
  });

  // ---- spotlight: broadcast to the whole office (managers and admins)
  socket.on('spotlight', (on: boolean) => {
    if (conn.p.role === 'member') return socket.emit('toast', { kind: 'warn', text: 'Only managers and admins can broadcast to the office.' });
    conn.p.spotlight = !!on;
    broadcastUpdate(conn, ['spotlight']);
  });

  // ---- admin build mode
  socket.on('layout:save', async (m: { layout: unknown; reset?: boolean }, ack?: (r: any) => void) => {
    if (conn.p.role !== 'admin') return ack?.({ ok: false, error: 'Only admins can change the office layout.' });
    try {
      const l = m?.reset ? DEFAULT_LAYOUT : validateLayout(m?.layout);
      if (!l.zones.length) throw new Error('Keep at least one area.');
      await setLayout(l, conn.p.name);
      ack?.({ ok: true });
    } catch (e) { ack?.({ ok: false, error: (e as Error).message }); }
  });

  registerObjects(io, socket, { uid, name: () => conn.p.name, pos: () => conn.p });

  socket.on('room:lock', (m: { roomId: string; locked: boolean }) => {
    const room = rooms.get(m?.roomId);
    if (!room) return;
    if (roomIdOfZone(conn.p.zone) !== room.id) return socket.emit('toast', { kind: 'warn', text: 'Step inside the room to lock or unlock it.' });
    if (!room.anyoneCanLock && conn.p.role === 'member') return socket.emit('toast', { kind: 'warn', text: 'Only managers can lock this room.' });
    room.locked = !!m.locked;
    room.lockedBy = room.locked ? conn.p.name : null;
    io.to('all').emit('rooms', [...rooms.values()]);
  });

  socket.on('desk:claim', async (m: { deskId: string }) => {
    const desk = MAP.desks.find((d) => d.id === m?.deskId);
    if (!desk) return;
    if (desks[desk.id] && desks[desk.id].userId !== uid) return socket.emit('toast', { kind: 'warn', text: `That desk belongs to ${desks[desk.id].name}.` });
    if (tileDistance(conn.p, { x: desk.seatX, y: desk.seatY }) > 3) return socket.emit('toast', { kind: 'warn', text: 'Walk up to the desk to claim it.' });
    await db.query('UPDATE users SET desk_id=NULL WHERE id=$1', [uid]);
    await db.query('UPDATE users SET desk_id=$2 WHERE id=$1', [uid, desk.id]);
    await loadDesks();
    io.to('all').emit('desks', desks);
    socket.emit('toast', { kind: 'ok', text: `Desk ${desk.id} is now yours. You'll start here next time.` });
  });

  socket.on('desk:release', async () => {
    await db.query('UPDATE users SET desk_id=NULL WHERE id=$1', [uid]);
    await loadDesks();
    io.to('all').emit('desks', desks);
  });

  socket.on('disconnect', () => {
    if (conn.socket !== socket) return; // replaced by a newer connection
    conn.socket = null;
    conn.peers = new Map();
    conn.goneTimer = setTimeout(() => removePlayer(uid), RECONNECT_GRACE_MS);
  });
}

async function removePlayer(uid: string) {
  const c = conns.get(uid);
  if (!c) return;
  if (c.goneTimer) clearTimeout(c.goneTimer);
  leaveBubble(c);
  conns.delete(uid);
  io.to('all').emit('player:leave', uid);
  await db.query('UPDATE users SET last_x=$2, last_y=$3, last_seen=now() WHERE id=$1', [uid, c.p.x, c.p.y]).catch(() => {});
}

function onZoneChange(c: Conn, zone: string | null) {
  const wasRoom = roomIdOfZone(c.p.zone);
  const isRoom = roomIdOfZone(zone);
  c.p.zone = zone;
  if (isRoom) leaveBubble(c);
  const fields: (keyof PlayerState)[] = ['zone'];
  if (isRoom && !wasRoom && c.p.status === 'available') { c.p.status = 'meeting'; c.autoMeeting = true; fields.push('status'); }
  else if (!isRoom && wasRoom && c.autoMeeting) {
    if (c.p.status === 'meeting') { c.p.status = 'available'; fields.push('status'); }
    c.autoMeeting = false;
  }
  broadcastUpdate(c, fields);
}

// ------------------------------------------------------------------ ticks

function positionsTick() {
  const batch: [string, number, number, Dir, number][] = [];
  for (const c of conns.values()) {
    if (!c.dirty) continue;
    c.dirty = false;
    batch.push([c.uid, Math.round(c.p.x), Math.round(c.p.y), c.p.dir, c.p.moving ? 1 : 0]);
  }
  if (batch.length) io.to('all').emit('positions', batch);
}

function proximityTick() {
  const live = [...conns.values()].filter((c) => c.socket);
  const cfg = settings.proximity;
  const cands: { a: Conn; b: Conn; mode: PeerMode; d: number }[] = [];
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      let mode = evaluatePair(a.p, b.p, cfg, a.peers.has(b.uid));
      // locked conversation: members only talk to each other; outsiders can't join
      if (mode === 'proximity' && a.p.bubble !== b.p.bubble) mode = null;
      if (mode) cands.push({ a, b, mode, d: mode === 'room' ? -1 : tileDistance(a.p, b.p) });
    }
  // Room links first, then nearest proximity links, capped per player (mesh limit).
  cands.sort((x, y) => x.d - y.d);
  const next = new Map<string, Map<string, PeerMode>>(live.map((c) => [c.uid, new Map()]));
  for (const { a, b, mode } of cands) {
    const na = next.get(a.uid)!, nb = next.get(b.uid)!;
    if (mode === 'proximity' && (na.size >= cfg.maxPeers || nb.size >= cfg.maxPeers)) continue;
    na.set(b.uid, mode);
    nb.set(a.uid, mode);
  }
  // spotlight: one-way broadcast from a manager/admin to everyone not already talking with them
  for (const s of live) {
    if (!s.p.spotlight) continue;
    const ns = next.get(s.uid)!;
    let count = 0;
    for (const l of live) {
      if (l === s || ns.has(l.uid) || count >= MAX_AUDIENCE) continue;
      ns.set(l.uid, 'audience');
      next.get(l.uid)!.set(s.uid, 'spotlight');
      count++;
    }
  }
  // locked conversations: drop members who walked away from everyone else in it
  for (const b of [...bubbles.values()]) {
    for (const id of [...b]) {
      const n = next.get(id);
      if (n && ![...b].some((o) => o !== id && n.get(o) === 'proximity')) { const c = conns.get(id); if (c) leaveBubble(c); }
    }
  }
  for (const c of live) {
    const n = next.get(c.uid)!;
    const changed = n.size !== c.peers.size || [...n].some(([k, v]) => c.peers.get(k) !== v);
    c.peers = n;
    if (changed) c.socket!.emit('peers', [...n].map(([id, mode]) => ({ id, mode })));
  }
  // Locks clear themselves once a room empties.
  let roomsChanged = false;
  for (const [id, r] of requests) if (r.expires < Date.now()) requests.delete(id);
  for (const r of rooms.values()) if (r.locked && occupancy(r.id) === 0) { r.locked = false; r.lockedBy = null; roomsChanged = true; }
  if (roomsChanged) io.to('all').emit('rooms', [...rooms.values()]);
}

// ------------------------------------------------------------------ hooks used by the REST API

export async function refreshUser(uid: string) {
  const row = await getUser(uid);
  const c = conns.get(uid);
  if (!row || !c) return;
  Object.assign(c.p, { name: row.name, title: row.title, dept: row.dept, role: row.role, avatar: row.avatar });
  broadcastUpdate(c, ['name', 'title', 'dept', 'role', 'avatar']);
  joinChannels(c);
  await loadDesks();
  io.to('all').emit('desks', desks);
}

export async function refreshDesks() {
  await loadDesks();
  io?.to('all').emit('desks', desks);
}

export function kickUser(uid: string, reason: string) {
  const c = conns.get(uid);
  if (!c) return;
  c.socket?.emit('kicked', reason);
  c.socket?.disconnect(true);
  removePlayer(uid);
}

export const broadcastSettings = () => io.to('all').emit('settings', settings);
export const broadcastRooms = () => io.to('all').emit('rooms', [...rooms.values()]);
export const onlineIds = () => new Set([...conns.values()].filter((c) => c.socket).map((c) => c.uid));
export const onlineZones = () => Object.fromEntries([...conns.values()].map((c) => [c.uid, c.p.zone]));

export async function shutdownSave() {
  await flushObjects().catch(() => {});
  for (const c of conns.values())
    await db.query('UPDATE users SET last_x=$2, last_y=$3 WHERE id=$1', [c.uid, c.p.x, c.p.y]).catch(() => {});
}
