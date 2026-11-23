// Visual check: starts the built server, walks around and saves screenshots to .qa/look-*.png
// at several times of day. Use after changing art/lighting.
//   npm run build && npm run shots           (HEADED=1 to watch, BROWSER=chrome for Chrome)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 3151;
const BASE = `http://localhost:${PORT}`;
const out = path.join(root, '.qa');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: path.join(root, 'server'),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-shots-')), DATABASE_URL: '', ADMIN_CODE: '', OFFICE_PASSCODE: '', SESSION_SECRET: 'shots' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await sleep(200); }

const browser = await chromium.launch({ channel: process.env.BROWSER || 'msedge', headless: !process.env.HEADED });
const errors = [];
try {
  for (const time of (process.env.TIMES || 'day,night').split(',')) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${time}: ${e.message}`));
    await page.goto(`${BASE}/?time=${time}`);
    await page.fill('#name', `Shot ${time}`);
    await page.click('button:has-text("Enter the office")');
    await page.waitForFunction(() => window.__rsp?.scene && window.__rsp.store.getState().selfId);
    await page.click('button:has-text("Save")').catch(() => {});
    await page.evaluate(() => window.__rsp.store.getState().set({ leftOpen: false, rightTab: null, modal: null }));
    const spots = { hall: [27, 15], sales: [9, 10], breakroom: [38, 24], warehouse: [53, 30], lobby: [7, 25] };
    for (const [name, [x, y]] of Object.entries(spots)) {
      await page.evaluate(([x, y]) => window.__rsp.scene.walkToTile(x, y), [x, y]);
      await page.waitForFunction(([x, y]) => {
        const r = window.__rsp; const p = r.positions.get(r.store.getState().selfId);
        return p && Math.floor(p.x / 32) === x && Math.floor(p.y / 32) === y && !p.moving;
      }, [x, y], { timeout: 40000 }).catch(() => console.log('  (could not reach', name + ')'));
      await sleep(1200);
      const file = path.join(out, `look-${time}-${name}.png`);
      await page.screenshot({ path: file, timeout: 60000 });
      console.log('saved', path.relative(root, file));
    }
    if (time === (process.env.TIMES || 'day,night').split(',')[0]) await featureShots(page, ctx);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.log('page errors:\n' + errors.join('\n')); process.exit(1); }

/** Gather-style features: second person + action card, emote, whiteboard, locked door, build mode. */
async function featureShots(page, ctx) {
  const shot = async (name) => { const f = path.join(out, `feature-${name}.png`); await page.screenshot({ path: f, timeout: 60000 }); console.log('saved', path.relative(root, f)); };
  const walk = async (x, y) => {
    await page.evaluate(([x, y]) => window.__rsp.scene.walkToTile(x, y), [x, y]);
    await page.waitForFunction(([x, y]) => { const r = window.__rsp; const p = r.positions.get(r.store.getState().selfId); return p && Math.floor(p.x / 32) === x && Math.floor(p.y / 32) === y && !p.moving; }, [x, y], { timeout: 40000 }).catch(() => {});
    await sleep(800);
  };
  // a second person walks up
  const p2 = await ctx.browser().newContext({ viewport: { width: 1000, height: 700 } }).then((c) => c.newPage());
  await p2.goto(BASE);
  await p2.fill('#name', 'Travis');
  await p2.click('button:has-text("Enter the office")');
  await p2.waitForFunction(() => window.__rsp?.scene && window.__rsp.store.getState().selfId);
  await p2.click('button:has-text("Save")').catch(() => {});
  await walk(27, 15);
  await p2.evaluate(() => window.__rsp.scene.walkToTile(29, 15));
  await sleep(4000);
  // action card on the other person
  const box = await page.evaluate(() => {
    const r = window.__rsp; const s = r.store.getState(); const other = Object.keys(s.players).find((id) => id !== s.selfId);
    const p = r.positions.get(other); const cam = r.scene.cameras.main;
    return { x: (p.x - cam.worldView.x) * cam.zoom, y: (p.y - 20 - cam.worldView.y) * cam.zoom };
  });
  const canvas = await page.$('[data-testid=game] canvas');
  const cb = await canvas.boundingBox();
  await page.mouse.click(cb.x + box.x, cb.y + box.y);
  await sleep(500);
  await p2.keyboard.press('3');
  await p2.keyboard.press('6');
  await sleep(400);
  await shot('card-and-emote');
  await page.keyboard.press('Escape');
  // whiteboard
  await walk(12, 1);
  await page.keyboard.press('x');
  await sleep(1200);
  const wb = await page.$('[data-testid=whiteboard]');
  if (wb) {
    const b = await wb.boundingBox();
    await page.mouse.move(b.x + 100, b.y + 100); await page.mouse.down();
    for (let i = 0; i < 30; i++) await page.mouse.move(b.x + 100 + i * 12, b.y + 100 + Math.sin(i / 3) * 40);
    await page.mouse.up();
  }
  await shot('whiteboard');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__rsp.store.getState().set({ openObject: null }));
  // locked meeting room door
  await p2.evaluate(() => window.__rsp.scene.walkToTile(40, 9));
  await sleep(6000);
  await p2.evaluate(() => window.__rsp.socket?.emit?.('room:lock', { roomId: 'conf', locked: true }));
  await p2.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Lock room/.test(x.textContent)); if (!b) window.__rsp.store.getState().set({ rightTab: 'meeting' }); });
  await sleep(500);
  await p2.click('button:has-text("Lock room")').catch(() => {});
  await walk(40, 15);
  await sleep(800);
  await shot('locked-door');
  // build mode
  await page.click('[data-testid=btn-build]').catch(() => {});
  await sleep(1500);
  await shot('build-mode');
  await p2.context().close();
}
