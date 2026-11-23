// Sessions: a signed JWT in an httpOnly cookie. Anyone with the link can join by
// name; OFFICE_PASSCODE optionally gates entry and ADMIN_CODE grants the admin role.
// The session/identity layer is isolated here so Microsoft Entra ID (OIDC) can be
// added later as another way to obtain the same session cookie.
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { parse as parseCookie } from 'cookie';
import { db, getSetting, setSetting } from './db';
import { env } from './env';
import { getUser } from './state';

export const COOKIE = 'rsp_session';
let secret = '';

export async function initAuth() {
  if (env.sessionSecret) secret = env.sessionSecret;
  else {
    secret = await getSetting<string>('session_secret', '');
    if (!secret) {
      secret = crypto.randomBytes(48).toString('hex');
      await setSetting('session_secret', secret);
    }
  }
}

export function signSession(uid: string) {
  return jwt.sign({ uid }, secret, { expiresIn: '60d' });
}

export function uidFromCookieHeader(header: string | undefined): string | null {
  if (!header) return null;
  const token = parseCookie(header)[COOKIE];
  if (!token) return null;
  try {
    const p = jwt.verify(token, secret) as { uid?: string };
    return typeof p.uid === 'string' ? p.uid : null;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, uid: string) {
  res.cookie(COOKIE, signSession(uid), {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.secureCookies,
    maxAge: 60 * 24 * 3600 * 1000,
    path: '/',
  });
}

export interface AuthedRequest extends Request {
  user?: any;
}

export async function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  const uid = uidFromCookieHeader(req.headers.cookie);
  const user = uid ? await getUser(uid) : null;
  if (!user || user.banned) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
}

// Simple fixed-window rate limiter (per key).
const hits = new Map<string, { n: number; t: number }>();
export function rateLimited(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.t > windowMs) { hits.set(key, { n: 1, t: now }); return false; }
  h.n++;
  return h.n > max;
}

export const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

export async function countUsers() {
  const r = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM users');
  return Number(r.rows[0].n);
}
