// End-to-end server test: real HTTP joins + real Socket.IO clients walking the map.
// Run: npm test   (spawns the server on a temp port with a throwaway database)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioc, type Socket } from 'socket.io-client';
import { TILE, findPath, tileOf } from '../../shared/map';

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-test-'));
let failures = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? '  ✔' : '  ✘'} ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, DATABASE_URL: '', ADMIN_CODE: 'letmein', OFFICE_PASSCODE: 'rsp', SESSION_SECRET: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(d));

async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/healthz')).ok) return; } catch {}
    await sleep(200);
  }
  throw new Error('server did not start');
}

interface Client { name: string; id: string; cookie: string; s: Socket; x: number; y: number; peers: { id: string; mode: string }[]; events: any[]; corrected?: boolean }

async function join(name: string, extra: any = {}): Promise<{ status: number; body: any; cookie: string }> {
  const r = await fetch(BASE + '/api/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, passcode: 'rsp', ...extra }) });
  return { status: r.status, body: await r.json(), cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] };
}

async function connect(name: string, extra: any = {}): Promise<Client> {
  const j = await join(name, extra);
  const s = ioc(BASE, { extraHeaders: { cookie: j.cookie }, transports: ['websocket'] });
  const c: Client = { name, id: j.body.id, cookie: j.cookie, s, x: 0, y: 0, peers: [], events: [] };
  s.on('peers', (p) => { c.peers = p; });
  s.onAny((ev, ...args) => c.events.push([ev, ...args]));
  s.on('correct', (p) => { c.x = p.x; c.y = p.y; c.corrected = true; });
  await new Promise<void>((res, rej) => {
    s.on('init', (init) => {
      const me = init.players.find((p: any) => p.id === c.id);
      c.x = me.x; c.y = me.y;
      res();
    });
    s.on('connect_error', rej);
  });
  return c;
}

/** Walk tile-by-tile at a legal speed, like a real client does. */
async function walkTo(c: Client, tx: number, ty: number) {
  const path = findPath(tileOf(c.x), tileOf(c.y), tx, ty);
  if (!path) throw new Error(`${c.name}: no path to ${tx},${ty}`);
  c.corrected = false;
  for (const t of path) {
    if (c.corrected) throw new Error(c.name + ": blocked by server");
    const gx = t.x * TILE + TILE / 2, gy = t.y * TILE + TILE / 2;
    while (!c.corrected && Math.hypot(gx - c.x, gy - c.y) > 0.5) {
      const d = Math.hypot(gx - c.x, gy - c.y), step = Math.min(8, d);
      c.x += ((gx - c.x) / d) * step; c.y += ((gy - c.y) / d) * step;
      c.s.emit('move', { x: c.x, y: c.y, dir: 'down', moving: true });
      await sleep(30);
    }
  }
  c.s.emit('move', { x: c.x, y: c.y, dir: 'down', moving: false });
  await sleep(400); // let proximity ticks run
}
const linked = (a: Client, b: Client) => a.peers.find((p) => p.id === b.id)?.mode ?? null;

async function main() {
  await waitUp();
  console.log('auth');
  ok((await join('NoPass', { passcode: 'nope' })).status === 403, 'wrong office passcode is rejected');
  ok((await join('', {})).status === 400, 'empty name is rejected');
  const adm = await join('Boss', { adminCode: 'letmein' });
  ok(adm.body.role === 'admin', 'ADMIN_CODE grants admin role');
  ok((await fetch(BASE + '/api/ice')).status === 401, 'ICE/TURN config requires a session');

  console.log('presence + proximity');
  const A = await connect('Travis');
  const B = await connect('Jake');
  await sleep(300);
  ok(A.events.some(([e, p]) => e === 'player:join' && p.id === B.id), 'A sees B join');

  await walkTo(A, 5, 15); // hallway
  await walkTo(B, 25, 15);
  ok(!linked(A, B) && !linked(B, A), 'far apart in the hallway: no conversation');
  const posEvents = B.events.filter(([e]) => e === 'positions').length;
  ok(posEvents > 5, `B received A's movement (${posEvents} position batches)`);

  await walkTo(B, 9, 15); // 4 tiles away
  ok(linked(A, B) === 'proximity' && linked(B, A) === 'proximity', 'within 4 tiles: both linked (proximity)');

  // Signaling relay only between linked players
  const got = new Promise<any>((res) => B.s.once('signal', res));
  A.s.emit('signal', { to: B.id, data: { probe: 1 } });
  const sig = await Promise.race([got, sleep(1000).then(() => null)]);
  ok(sig?.from === A.id && sig?.data?.probe === 1, 'WebRTC signal relayed A -> B while linked');

  await walkTo(B, 20, 15);
  ok(!linked(A, B), 'walking away (11 tiles) disconnects');
  let leaked = false;
  B.s.once('signal', () => { leaked = true; });
  A.s.emit('signal', { to: B.id, data: { probe: 2 } });
  await sleep(400);
  ok(!leaked, 'signal NOT relayed once unlinked');

  console.log('walls');
  await walkTo(A, 5, 11); // Sales, behind the wall at y=13
  await walkTo(B, 5, 15); // hallway below
  ok(!linked(A, B), '4 tiles apart but separated by a wall: no conversation');

  console.log('Do Not Disturb');
  await walkTo(A, 5, 14);
  ok(linked(A, B) === 'proximity', 'adjacent in hallway: linked');
  A.s.emit('status', 'dnd');
  await sleep(400);
  ok(!linked(A, B), 'DND drops the automatic conversation');
  A.s.emit('status', 'available');
  await sleep(400);
  ok(!!linked(A, B), 'back to Available re-links');

  console.log('private rooms');
  const C = await connect('Outsider');
  await walkTo(A, 36, 2); // conference room, far corner
  await walkTo(B, 45, 11); // conference room, opposite corner (~13 tiles)
  await walkTo(C, 40, 14); // hallway right outside the door
  ok(linked(A, B) === 'room', 'same private room links regardless of distance (13 tiles)');
  ok(!linked(C, A) && !linked(C, B), 'player outside the room is not linked to anyone inside');
  const statusUpd = A.events.find(([e, p]) => e === 'player:update' && p.id === B.id && p.status === 'meeting');
  ok(!!statusUpd, 'entering a room auto-sets status to In a Meeting');

  console.log('room lock');
  A.s.emit('room:lock', { roomId: 'conf', locked: true });
  await sleep(200);
  const before = { x: C.x, y: C.y };
  await walkTo(C, 40, 12).catch(() => {});
  ok(C.events.some(([e, t]) => e === 'toast' && /locked/.test(t.text)), 'locked room: outsider gets "locked" notice');
  ok(!linked(C, A), 'locked room: outsider still not linked');
  void before;
  A.s.emit('room:lock', { roomId: 'conf', locked: false });

  console.log('chat');
  const recv = new Promise<any>((res) => B.s.once('chat:message', res));
  A.s.emit('chat:send', { channel: 'general', body: 'Hello office!' });
  const m = await Promise.race([recv, sleep(1000).then(() => null)]);
  ok(m?.body === 'Hello office!' && m?.senderName === 'Travis', 'general chat delivered');
  const dm = 'dm:' + [A.id, B.id].sort().join(':');
  let cSaw = false;
  C.s.on('chat:message', (x: any) => { if (x.channel === dm) cSaw = true; });
  const recvDm = new Promise<any>((res) => B.s.once('chat:message', res));
  A.s.emit('chat:send', { channel: dm, body: 'psst' });
  ok((await Promise.race([recvDm, sleep(1000).then(() => null)]))?.body === 'psst', 'DM delivered to recipient');
  await sleep(200);
  ok(!cSaw, 'DM not delivered to a third person');
  const hist = await new Promise<any[]>((res) => C.s.emit('chat:history', { channel: dm }, res));
  ok(hist.length === 0, 'third person cannot read DM history');
  const hist2 = await new Promise<any[]>((res) => B.s.emit('chat:history', { channel: 'general' }, res));
  ok(hist2.some((x) => x.body === 'Hello office!'), 'general history persisted');

  console.log('emotes + raised hand + custom status');
  const gotEmote = new Promise<any>((res) => A.s.once('emote', res));
  C.s.emit('emote', 'wave');
  ok((await Promise.race([gotEmote, sleep(1000).then(() => null)]))?.id === C.id, 'emote broadcast to everyone');
  C.s.emit('emote', 'hand');
  C.s.emit('status:text', '  Quoting   the Acme order ');
  await sleep(300);
  ok(A.events.some(([e, p]) => e === 'player:update' && p.id === C.id && p.hand === true), 'raised hand is shared');
  ok(A.events.some(([e, p]) => e === 'player:update' && p.id === C.id && p.statusText === 'Quoting the Acme order'), 'custom status text is cleaned and shared');

  console.log('knock on a locked room');
  A.s.emit('room:lock', { roomId: 'conf', locked: true });
  await sleep(200);
  const knock = new Promise<any>((res) => A.s.once('request', res));
  C.s.emit('room:knock', { roomId: 'conf' });
  const kr = await Promise.race([knock, sleep(1000).then(() => null)]);
  ok(kr?.kind === 'knock' && kr?.from === C.id, 'people inside hear the knock');
  C.corrected = false;
  A.s.emit('request:answer', { id: kr?.id, accept: true });
  await sleep(500);
  ok(C.corrected && linked(C, A) === 'room', '"Let them in" brings the knocker inside the locked room');
  A.s.emit('room:lock', { roomId: 'conf', locked: false });

  console.log('nearby chat');
  const D = await connect('Dana');
  const nearbyA = new Promise<any>((res) => A.s.on('chat:message', (x: any) => { if (x.channel === 'nearby') res(x); }));
  let dSaw = false;
  D.s.on('chat:message', (x: any) => { if (x.channel === 'nearby') dSaw = true; });
  C.s.emit('chat:nearby', { body: 'room only' });
  ok((await Promise.race([nearbyA, sleep(1000).then(() => null)]))?.body === 'room only', 'nearby chat reaches people in the same room');
  await sleep(200);
  ok(!dSaw, 'nearby chat does not reach someone elsewhere');

  console.log('ring + teleport');
  const ring = new Promise<any>((res) => A.s.once('request', res));
  D.s.emit('request', { to: A.id, kind: 'ring' });
  const rr = await Promise.race([ring, sleep(1000).then(() => null)]);
  ok(rr?.kind === 'ring' && rr?.from === D.id, 'ring reaches the person');
  D.corrected = false;
  A.s.emit('request:answer', { id: rr?.id, accept: true });
  await sleep(500);
  ok(D.corrected && linked(D, A) === 'room', 'accepting a ring brings the caller next to you');
  const E = await connect('Eli');
  E.corrected = false;
  E.s.emit('teleport', { to: D.id });
  await sleep(500);
  ok(E.corrected && linked(E, D) === 'room', '"Go to" teleports next to a person (into their unlocked room)');

  console.log('locked conversation');
  const F = await connect('Fay');
  const G = await connect('Gus');
  await walkTo(F, 5, 15);
  await walkTo(G, 6, 15);
  ok(linked(F, G) === 'proximity', 'two people chatting in the hallway');
  F.s.emit('convo:lock', true);
  await sleep(300);
  const H = await connect('Hal');
  await walkTo(H, 7, 15);
  ok(!linked(H, F) && !linked(H, G), 'locked conversation: a passer-by cannot join');
  ok(linked(F, G) === 'proximity', 'locked conversation: members still talk');
  F.s.emit('convo:lock', false);
  await sleep(400);
  ok(linked(H, F) === 'proximity', 'unlocked: the passer-by joins');

  console.log('spotlight');
  H.s.emit('spotlight', true);
  await sleep(300);
  ok(H.events.some(([e, t]) => e === 'toast' && /managers and admins/.test(t.text)), 'members cannot broadcast');
  const Boss = await connect('Boss', { adminCode: 'letmein' });
  Boss.s.emit('spotlight', true);
  await sleep(400);
  ok(linked(D, Boss) === 'spotlight' && linked(Boss, D) === 'audience', 'admin broadcast reaches people inside rooms (one-way)');
  ok(linked(F, Boss) !== null, 'admin broadcast reaches people in open areas');
  Boss.s.emit('spotlight', false);
  await sleep(400);
  ok(!linked(D, Boss), 'stopping the broadcast drops the links');

  console.log('build mode (layout)');
  const save = (c: Client, m: any) => new Promise<any>((res) => c.s.emit('layout:save', m, res));
  const layout0 = Boss.events.find(([e]) => e === 'init')?.[1]?.layout;
  ok(layout0?.v === 1 && layout0.tiles.length === 38, 'clients receive the office layout on connect');
  ok(!(await save(H, { layout: layout0 })).ok, 'members cannot change the layout');
  ok(!(await save(Boss, { layout: { ...layout0, tiles: ['bad'] } })).ok, 'malformed layouts are rejected');
  const edited = { ...layout0, objects: [...layout0.objects, { id: 'plant-test', type: 'plant', x: 10, y: 15, w: 1, h: 1, variant: 0, ox: 0 }] };
  const gotLayout = new Promise<any>((res) => A.s.once('layout', res));
  ok((await save(Boss, { layout: edited })).ok, 'admin can save a new layout');
  const lay = await Promise.race([gotLayout, sleep(1000).then(() => null)]);
  ok(lay?.layout.objects.some((o: any) => o.id === 'plant-test'), 'everyone receives the new layout');
  ok((await save(Boss, { reset: true })).ok, 'admin can reset to the default layout');
  for (const c of [D, E, F, G, H, Boss]) c.s.disconnect();

  console.log('reconnect');
  B.s.disconnect();
  await sleep(500);
  ok(!A.events.some(([e, id]) => e === 'player:leave' && id === B.id), 'brief disconnect does not remove the player (grace period)');

  for (const c of [A, C]) c.s.disconnect();
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(() => {
    server.kill();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
  });
