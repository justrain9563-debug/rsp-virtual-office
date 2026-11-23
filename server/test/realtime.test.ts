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
