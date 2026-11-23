// Browser end-to-end test: real Edge/Chrome sessions, real WebRTC, fake camera/mic
// devices (Chrome's built-in test pattern + beep). Covers the 16-step checklist.
//   npm run build && npm run test:e2e
// Env: BROWSER=msedge|chrome (default msedge), HEADED=1 to watch, BASE_URL to test a deployed site.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 3150;
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;
const shots = path.join(root, '.qa');
fs.mkdirSync(shots, { recursive: true });
let failures = 0;
const ok = (c, m) => { console.log(`${c ? '  ✔' : '  ✘'} ${m}`); if (!c) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server;
if (!process.env.BASE_URL) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-e2e-'));
  server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: path.join(root, 'server'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, DATABASE_URL: '', ADMIN_CODE: '', OFFICE_PASSCODE: '', SESSION_SECRET: 'e2e' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await sleep(200); }
}

const browser = await chromium.launch({
  channel: process.env.BROWSER || 'msedge',
  headless: !process.env.HEADED,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--autoplay-policy=no-user-gesture-required'],
});

async function person(name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${name} page error]`, e.message));
  await page.goto(BASE);
  await page.fill('#name', name);
  await page.click('button:has-text("Enter the office")');
  await page.waitForFunction(() => window.__rsp?.scene && window.__rsp.store.getState().selfId);
  const id = await page.evaluate(() => window.__rsp.store.getState().selfId);
  return { name, page, id };
}
const walk = async (p, x, y) => {
  await p.page.evaluate(([x, y]) => window.__rsp.scene.walkToTile(x, y), [x, y]);
  await p.page.waitForFunction(([x, y]) => {
    const r = window.__rsp; const pos = r.positions.get(r.store.getState().selfId);
    return pos && Math.floor(pos.x / 32) === x && Math.floor(pos.y / 32) === y && !pos.moving;
  }, [x, y], { timeout: 30000 });
  await sleep(700); // proximity tick + connection
};
const peerInfo = (p, otherId) => p.page.evaluate(async (oid) => {
  const r = window.__rsp; const s = r.store.getState(); const peer = r.media.peers.get(oid);
  if (!peer) return null;
  let audioBytes = 0, audioLevel = 0, videoFrames = 0, videoW = 0;
  const stats = await peer.pc.getStats();
  stats.forEach((st) => {
    if (st.type === 'inbound-rtp' && st.kind === 'audio') { audioBytes += st.bytesReceived; audioLevel = Math.max(audioLevel, st.audioLevel ?? 0); }
    if (st.type === 'inbound-rtp' && st.kind === 'video') { videoFrames += st.framesDecoded ?? 0; videoW = Math.max(videoW, st.frameWidth ?? 0); }
  });
  return { state: peer.pc.connectionState, mode: peer.mode, volume: peer.audioEl.volume, audioBytes, audioLevel, videoFrames, videoW, storeMode: s.peers[oid]?.mode };
}, otherId);
const waitConnected = (p, oid) => p.page.waitForFunction((oid) => window.__rsp.media.peers.get(oid)?.pc.connectionState === 'connected', oid, { timeout: 20000 }).then(() => true, () => false);

try {
  console.log('1-3  sign in + shared office');
  const A = await person('Travis');
  const B = await person('Jake');
  await sleep(800);
  ok(await A.page.evaluate((id) => !!window.__rsp.store.getState().players[id], B.id), 'A sees B in the office');
  ok(await B.page.evaluate((id) => !!window.__rsp.store.getState().players[id], A.id), 'B sees A in the office');
  await A.page.screenshot({ path: path.join(shots, 'lobby.png') });

  console.log('4-5  WASD movement is synced');
  await walk(A, 20, 15); await walk(B, 45, 15);
  const before = await B.page.evaluate((id) => ({ ...window.__rsp.positions.get(id) }), A.id);
  await A.page.locator('canvas').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await A.page.evaluate(() => window.__rsp.scene.path = []);
  await A.page.keyboard.down('d'); await sleep(700); await A.page.keyboard.up('d'); await sleep(500);
  const after = await B.page.evaluate((id) => ({ ...window.__rsp.positions.get(id) }), A.id);
  ok(after.x - before.x > 40, `B saw A move right with D key (${Math.round(before.x)} → ${Math.round(after.x)})`);

  console.log('turn devices on');
  for (const p of [A, B]) { await p.page.click('[data-testid=btn-mic]'); await p.page.click('[data-testid=btn-cam]'); }
  await sleep(800);
  ok(await A.page.evaluate(() => window.__rsp.store.getState().mic && window.__rsp.store.getState().cam), 'A mic + camera on (permission granted)');
  ok((await peerInfo(A, B.id)) === null, 'far apart (≈20 tiles): no conversation');

  console.log('6-8  approach → live video + audio');
  await walk(A, 42, 15); // 3 tiles from B
  const conA = await waitConnected(A, B.id), conB = await waitConnected(B, A.id);
  ok(conA && conB, 'WebRTC connected automatically on both sides');
  await sleep(2500);
  const nearB = await peerInfo(B, A.id);
  ok(nearB?.videoFrames > 10 && nearB?.videoW > 0, `B decodes A's live video (${nearB?.videoFrames} frames, ${nearB?.videoW}px wide)`);
  ok(nearB?.audioBytes > 2000, `B receives A's microphone audio (${nearB?.audioBytes} bytes, level ${nearB?.audioLevel?.toFixed(3)})`);
  ok(await B.page.locator(`[data-testid=tile-peer][data-peer="${A.id}"] video`).count() === 1, 'B sees A\'s video tile in the floating panel');
  await B.page.screenshot({ path: path.join(shots, 'conversation.png') });

  console.log('9-10 volume follows distance');
  const v3 = nearB.volume;
  await walk(A, 44, 15); // 1 tile
  const v1 = (await peerInfo(B, A.id)).volume;
  await walk(A, 40, 15); // 5 tiles
  const v5 = (await peerInfo(B, A.id))?.volume ?? 0;
  ok(v1 > v3 && v1 > 0.95, `closer is louder (3 tiles ${v3.toFixed(2)} → 1 tile ${v1.toFixed(2)})`);
  ok(v5 < v3 && v5 > 0, `further is quieter (3 tiles ${v3.toFixed(2)} → 5 tiles ${v5.toFixed(2)})`);

  console.log('11   out of range disconnects');
  await walk(A, 30, 15);
  await sleep(500);
  ok((await peerInfo(A, B.id)) === null && (await peerInfo(B, A.id)) === null, 'conversation closed on both sides');
  ok(await B.page.locator('[data-testid=tile-peer]').count() === 0, 'video tile removed');

  console.log('12-13 private room');
  const C = await person('Outsider');
  await walk(A, 36, 2); await walk(B, 45, 11); await walk(C, 40, 14);
  ok(await waitConnected(A, B.id), 'A and B connected inside the conference room ~13 tiles apart');
  const roomInfo = await peerInfo(A, B.id);
  ok(roomInfo?.mode === 'room' && roomInfo.volume > 0.95, `room mode at full volume (${roomInfo?.volume.toFixed(2)})`);
  ok((await peerInfo(C, A.id)) === null && (await peerInfo(C, B.id)) === null, 'outsider in the hallway has no connection to anyone inside');
  ok(await A.page.locator('[data-testid=room-banner]').count() === 1, 'private-room banner shown');
  await A.page.screenshot({ path: path.join(shots, 'room.png') });

  console.log('14   mute');
  await A.page.click('[data-testid=btn-mic]');
  await sleep(600);
  const micTrackNull = await A.page.evaluate((id) => window.__rsp.media.peers.get(id).pc.getTransceivers()[0].sender.track === null, B.id);
  ok(micTrackNull, 'muted: A no longer sends any microphone track');
  ok(await B.page.evaluate((id) => window.__rsp.store.getState().players[id].mic === false, A.id), 'B sees A as muted');

  console.log('15   camera off');
  await A.page.click('[data-testid=btn-cam]');
  await sleep(600);
  ok(await A.page.evaluate((id) => window.__rsp.media.peers.get(id).pc.getTransceivers()[1].sender.track === null, B.id), 'camera off: A no longer sends video');
  ok(await B.page.locator(`[data-testid=tile-peer][data-peer="${A.id}"] video`).count() === 0, 'B shows A\'s avatar instead of video');

  console.log('16   screen share');
  await A.page.click('[data-testid=btn-screen]');
  await sleep(3000);
  const sharing = await A.page.evaluate(() => window.__rsp.store.getState().screen);
  if (!sharing) console.log('  ! screen picker could not be automated in this browser mode; test manually');
  else {
    const sf = await B.page.evaluate(async (id) => {
      const peer = window.__rsp.media.peers.get(id); let w = 0;
      (await peer.pc.getStats()).forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'video') w = Math.max(w, s.frameWidth ?? 0); });
      return { w, flag: window.__rsp.store.getState().players[id].screen };
    }, A.id);
    ok(sf.flag && sf.w > 0, `B receives A's screen share (${sf.w}px wide)`);
    await B.page.click('text=is sharing their screen').catch(() => {});
    await sleep(800);
    await B.page.screenshot({ path: path.join(shots, 'screenshare.png') });
  }
  ok(true, `screenshots in ${shots}`);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  server?.kill();
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}
