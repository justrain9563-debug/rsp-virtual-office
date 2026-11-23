import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bool = (v: string | undefined, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

export const env = {
  root,
  port: Number(process.env.PORT ?? 3001),
  /** Serve HTTPS with a self-signed cert (for testing across machines on a LAN without a proxy). */
  https: bool(process.env.HTTPS),
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(root, '.data')),
  databaseUrl: process.env.DATABASE_URL || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  /** If set, people must type this passcode to enter the office. */
  officePasscode: process.env.OFFICE_PASSCODE || '',
  /** If set, typing this code on the join screen makes you an admin. */
  adminCode: process.env.ADMIN_CODE || '',
  /** Comma-separated emails that always get the admin role. */
  adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  /** Comma-separated email domains allowed to join (empty = anyone). */
  allowedDomains: (process.env.ALLOWED_EMAIL_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  stunUrls: (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean),
  turnUrls: (process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean),
  turnUsername: process.env.TURN_USERNAME || '',
  turnCredential: process.env.TURN_CREDENTIAL || '',
  /** coturn "use-auth-secret" shared secret: short-lived credentials are minted per user. */
  turnSecret: process.env.TURN_SECRET || '',
  secureCookies: bool(process.env.SECURE_COOKIES, !!process.env.RENDER || bool(process.env.HTTPS)),
};
