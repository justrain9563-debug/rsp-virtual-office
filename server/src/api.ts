import crypto from 'node:crypto';
import express from 'express';
import { MAP, zoneById } from '../../shared/map';
import { DEPTS, randomAvatar, sanitizeAvatar, type PublicSettings } from '../../shared/types';
import {
  COOKIE, countUsers, rateLimited, requireAdmin, requireUser, safeEqual, setSessionCookie, uidFromCookieHeader,
  type AuthedRequest,
} from './auth';
import { db } from './db';
import { env } from './env';
import { broadcastRooms, broadcastSettings, kickUser, onlineIds, onlineZones, refreshDesks, refreshUser } from './realtime';
import { getUser, rooms, rowToMe, saveRoom, saveSettings, settings } from './state';

export const api = express.Router();
api.use(express.json({ limit: '64kb' }));

const cleanName = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 32);
const cleanText = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
const validDept = (d: unknown) => DEPTS.some((x) => x.id === d);

api.get('/config', (_req, res) => {
  res.json({ passcodeRequired: !!env.officePasscode, domainRestricted: env.allowedDomains.length > 0, settings });
});

/** Enter the office. Creates a user (or updates the one in the session cookie). */
api.post('/join', async (req: AuthedRequest, res) => {
  const ip = req.ip ?? 'x';
  if (rateLimited('join:' + ip, 20, 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
  const b = req.body ?? {};
  const name = cleanName(b.name);
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  const email = cleanText(b.email, 120).toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'That email address looks wrong.' });
  const adminCode = String(b.adminCode ?? '');
  const isAdminCode = !!env.adminCode && !!adminCode && safeEqual(adminCode, env.adminCode);
  if (adminCode && !isAdminCode) return res.status(403).json({ error: 'That admin code is not right.' });
  if (env.officePasscode && !isAdminCode && !safeEqual(String(b.passcode ?? ''), env.officePasscode))
    return res.status(403).json({ error: 'Wrong office passcode.' });
  if (env.allowedDomains.length && !isAdminCode) {
    const domain = email.split('@')[1] ?? '';
    if (!env.allowedDomains.includes(domain)) return res.status(403).json({ error: `Use your company email (${env.allowedDomains.join(', ')}).` });
  }
  const avatar = sanitizeAvatar(b.avatar) ?? randomAvatar();
  const dept = validDept(b.dept) ? b.dept : 'sales';
  const title = cleanText(b.title, 48);

  const existingId = uidFromCookieHeader(req.headers.cookie);
  const existing = existingId ? await getUser(existingId) : null;
  if (existing?.banned) return res.status(403).json({ error: 'Your access to the office was removed by an admin.' });

  let id: string;
  if (existing) {
    id = existing.id;
    const role = isAdminCode ? 'admin' : existing.role;
    await db.query('UPDATE users SET name=$2, email=COALESCE(NULLIF($3,\'\'), email), role=$4, last_seen=now() WHERE id=$1', [id, name, email, role]);
  } else {
    id = crypto.randomUUID();
    // With no ADMIN_CODE configured (local dev), the very first person in becomes admin.
    const role = isAdminCode || (!env.adminCode && (await countUsers()) === 0) ? 'admin' : 'member';
    await db.query(
      'INSERT INTO users(id, email, name, title, dept, role, avatar) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [id, email || null, name, title, dept, role, JSON.stringify(avatar)],
    );
  }
  setSessionCookie(res, id);
  await refreshUser(id);
  res.json(rowToMe(await getUser(id)));
});

api.post('/leave', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

api.get('/me', requireUser, (req: AuthedRequest, res) => res.json(rowToMe(req.user)));

api.put('/me', requireUser, async (req: AuthedRequest, res) => {
  const u = req.user, b = req.body ?? {};
  const isAdmin = u.role === 'admin';
  const next = { name: u.name, title: u.title, dept: u.dept, avatar: u.avatar, onboarded: u.onboarded, email: u.email };
  if (b.name !== undefined) {
    if (!settings.allowNameChange && !isAdmin && u.onboarded) return res.status(403).json({ error: 'Name changes are turned off by an admin.' });
    next.name = cleanName(b.name) || u.name;
  }
  if (b.avatar !== undefined) {
    if (!settings.allowAvatarCustomization && !isAdmin && u.onboarded) return res.status(403).json({ error: 'Avatar changes are turned off by an admin.' });
    next.avatar = sanitizeAvatar(b.avatar) ?? u.avatar;
  }
  if (b.title !== undefined) next.title = cleanText(b.title, 48);
  if (b.dept !== undefined && validDept(b.dept)) next.dept = b.dept;
  if (b.onboarded === true) next.onboarded = true;
  await db.query(
    'UPDATE users SET name=$2, title=$3, dept=$4, avatar=$5::jsonb, onboarded=$6 WHERE id=$1',
    [u.id, next.name, next.title, next.dept, JSON.stringify(next.avatar), next.onboarded],
  );
  await refreshUser(u.id);
  res.json(rowToMe(await getUser(u.id)));
});

/** ICE servers for WebRTC. TURN credentials are only handed to signed-in users. */
api.get('/ice', requireUser, (req: AuthedRequest, res) => {
  const ice: RTCIceServerLike[] = [];
  if (env.stunUrls.length) ice.push({ urls: env.stunUrls });
  if (env.turnUrls.length) {
    if (env.turnSecret) {
      const username = `${Math.floor(Date.now() / 1000) + 12 * 3600}:${req.user.id}`;
      const credential = crypto.createHmac('sha1', env.turnSecret).update(username).digest('base64');
      ice.push({ urls: env.turnUrls, username, credential });
    } else ice.push({ urls: env.turnUrls, username: env.turnUsername, credential: env.turnCredential });
  }
  res.json({ iceServers: ice });
});
interface RTCIceServerLike { urls: string[]; username?: string; credential?: string }

/** Employee directory (everyone who has ever joined, online first). */
api.get('/users', requireUser, async (_req, res) => {
  const r = await db.query('SELECT id, name, title, dept, role, avatar, status, desk_id, last_seen FROM users WHERE banned=false ORDER BY name');
  const online = onlineIds();
  res.json(r.rows.map((u: any) => ({
    id: u.id, name: u.name, title: u.title, dept: u.dept, role: u.role, avatar: u.avatar, status: u.status,
    deskId: u.desk_id, lastSeen: u.last_seen, online: online.has(u.id),
  })));
});

// ------------------------------------------------------------------ admin

const admin = express.Router();
admin.use(requireUser, requireAdmin);

admin.get('/users', async (_req, res) => {
  const r = await db.query('SELECT * FROM users ORDER BY banned, name');
  const online = onlineIds(), zones = onlineZones();
  res.json(r.rows.map((u: any) => ({
    ...rowToMe(u), banned: u.banned, lastSeen: u.last_seen, createdAt: u.created_at, online: online.has(u.id),
    location: zones[u.id] ? zoneById(zones[u.id]!.replace('room:', ''))?.name ?? null : null,
  })));
});

admin.patch('/users/:id', async (req: AuthedRequest, res) => {
  const target = await getUser(req.params.id);
  if (!target) return res.status(404).json({ error: 'No such employee' });
  const b = req.body ?? {};
  if (b.role !== undefined) {
    if (!['admin', 'manager', 'member'].includes(b.role)) return res.status(400).json({ error: 'Bad role' });
    if (target.id === req.user.id && b.role !== 'admin') return res.status(400).json({ error: "You can't demote yourself." });
    await db.query('UPDATE users SET role=$2 WHERE id=$1', [target.id, b.role]);
  }
  if (b.dept !== undefined && validDept(b.dept)) await db.query('UPDATE users SET dept=$2 WHERE id=$1', [target.id, b.dept]);
  if (b.title !== undefined) await db.query('UPDATE users SET title=$2 WHERE id=$1', [target.id, cleanText(b.title, 48)]);
  if (b.name !== undefined && cleanName(b.name)) await db.query('UPDATE users SET name=$2 WHERE id=$1', [target.id, cleanName(b.name)]);
  if (b.deskId !== undefined) {
    if (b.deskId !== null && !MAP.desks.some((d) => d.id === b.deskId)) return res.status(400).json({ error: 'No such desk' });
    if (b.deskId) await db.query('UPDATE users SET desk_id=NULL WHERE desk_id=$1', [b.deskId]);
    await db.query('UPDATE users SET desk_id=$2 WHERE id=$1', [target.id, b.deskId]);
    await refreshDesks();
  }
  if (b.banned !== undefined) {
    if (target.id === req.user.id) return res.status(400).json({ error: "You can't remove yourself." });
    await db.query('UPDATE users SET banned=$2, desk_id=CASE WHEN $2 THEN NULL ELSE desk_id END WHERE id=$1', [target.id, !!b.banned]);
    if (b.banned) { kickUser(target.id, 'An admin removed your access to the office.'); await refreshDesks(); }
  }
  await refreshUser(target.id);
  res.json({ ok: true });
});

admin.delete('/users/:id', async (req: AuthedRequest, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You can't delete yourself." });
  kickUser(req.params.id, 'An admin removed your account.');
  await db.query('DELETE FROM users WHERE id=$1', [req.params.id]);
  await refreshDesks();
  res.json({ ok: true });
});

admin.get('/settings', (_req, res) => res.json({ settings, rooms: [...rooms.values()], desks: MAP.desks.map((d) => ({ id: d.id, dept: d.dept })) }));

admin.put('/settings', async (req, res) => {
  const b = req.body ?? {};
  const p = b.proximity ?? {};
  const num = (v: any, lo: number, hi: number, d: number) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  const next: PublicSettings = {
    officeSign: cleanText(b.officeSign ?? settings.officeSign, 24) || 'RSP SUPPLY',
    welcomeMessage: cleanText(b.welcomeMessage ?? settings.welcomeMessage, 80) || 'Welcome to RSP Virtual Office',
    allowAvatarCustomization: b.allowAvatarCustomization ?? settings.allowAvatarCustomization,
    allowNameChange: b.allowNameChange ?? settings.allowNameChange,
    proximity: {
      fullRadius: num(p.fullRadius, 0, 6, settings.proximity.fullRadius),
      connectRadius: num(p.connectRadius, 1, 12, settings.proximity.connectRadius),
      maxPeers: Math.round(num(p.maxPeers, 1, 16, settings.proximity.maxPeers)),
    },
  };
  if (next.proximity.connectRadius < next.proximity.fullRadius) next.proximity.connectRadius = next.proximity.fullRadius;
  await saveSettings(next);
  broadcastSettings();
  res.json(next);
});

admin.put('/rooms/:id', async (req, res) => {
  const r = rooms.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'No such room' });
  const b = req.body ?? {};
  if (b.anyoneCanLock !== undefined) r.anyoneCanLock = !!b.anyoneCanLock;
  if (b.capacity !== undefined) r.capacity = Math.min(16, Math.max(2, Math.round(+b.capacity) || r.capacity));
  if (b.locked !== undefined) { r.locked = !!b.locked; r.lockedBy = r.locked ? 'Admin' : null; }
  await saveRoom(r);
  broadcastRooms();
  res.json(r);
});

api.use('/admin', admin);

