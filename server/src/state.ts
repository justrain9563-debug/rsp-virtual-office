// In-memory caches of persistent office state (settings, rooms) plus user helpers.
import { applyLayout, privateZones, validateLayout } from '../../shared/map';
import { loadObjects } from './objects';
import { DEFAULT_PROXIMITY, type MeUser, type PublicSettings, type RoomState } from '../../shared/types';
import { db, getSetting, setSetting } from './db';

export const DEFAULT_SETTINGS: PublicSettings = {
  officeSign: 'RSP SUPPLY',
  welcomeMessage: 'Welcome to RSP Virtual Office',
  proximity: { ...DEFAULT_PROXIMITY },
  allowAvatarCustomization: true,
  allowNameChange: true,
};

export let settings: PublicSettings = { ...DEFAULT_SETTINGS };
export const rooms = new Map<string, RoomState>();

export async function loadState() {
  const saved = await getSetting<Partial<PublicSettings>>('public', {});
  settings = { ...DEFAULT_SETTINGS, ...saved, proximity: { ...DEFAULT_PROXIMITY, ...(saved.proximity ?? {}) } };
  const layout = await getSetting<any>('layout', null);
  if (layout) {
    try { applyLayout(validateLayout(layout)); console.log('[map] using the saved office layout'); }
    catch (e) { console.warn('[map] saved layout ignored:', (e as Error).message); }
  }
  await ensureRooms();
  await loadObjects();
}

/** Makes sure every private area has a rooms row (new rooms appear after layout edits). */
export async function ensureRooms() {
  for (const z of privateZones()) {
    await db.query('INSERT INTO rooms(id) VALUES($1) ON CONFLICT(id) DO NOTHING', [z.id]);
  }
  const r = await db.query('SELECT * FROM rooms');
  for (const row of r.rows) {
    const cur = rooms.get(row.id);
    rooms.set(row.id, { id: row.id, locked: cur?.locked ?? false, lockedBy: cur?.lockedBy ?? null, anyoneCanLock: row.anyone_can_lock, capacity: row.capacity });
  }
}

export async function saveSettings(next: PublicSettings) {
  settings = next;
  await setSetting('public', next);
}

export async function saveRoom(r: RoomState) {
  rooms.set(r.id, r);
  await db.query('UPDATE rooms SET anyone_can_lock=$2, capacity=$3 WHERE id=$1', [r.id, r.anyoneCanLock, r.capacity]);
}

export function rowToMe(row: any): MeUser {
  return {
    id: row.id,
    email: row.email ?? '',
    name: row.name,
    title: row.title,
    dept: row.dept,
    role: row.role,
    avatar: row.avatar,
    status: row.status,
    deskId: row.desk_id,
    onboarded: row.onboarded,
  };
}

export async function getUser(id: string) {
  const r = await db.query('SELECT * FROM users WHERE id=$1', [id]);
  return r.rows[0] ?? null;
}
