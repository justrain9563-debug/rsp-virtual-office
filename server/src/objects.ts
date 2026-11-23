// Interactive objects (Gather-style "press X"): shared whiteboards, sticky-note boards and
// TVs that show a website or video. State is kept in memory and saved to the settings table.
import type { Server, Socket } from 'socket.io';
import { MAP, TILE } from '../../shared/map';
import type { StickyNote, Stroke } from '../../shared/types';
import { getSetting, setSetting } from './db';

interface ObjectState {
  boards: Record<string, Stroke[]>;
  notes: Record<string, StickyNote[]>;
  embeds: Record<string, string>;
}

let state: ObjectState = { boards: {}, notes: {}, embeds: {} };
let saveTimer: NodeJS.Timeout | null = null;

export async function loadObjects() {
  state = { boards: {}, notes: {}, embeds: {}, ...(await getSetting<Partial<ObjectState>>('objects', {})) };
}
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; setSetting('objects', state).catch((e) => console.error('[objects] save', e)); }, 2000);
}
export const flushObjects = () => setSetting('objects', state);

const objectOf = (id: unknown) => (typeof id === 'string' ? MAP.objects.find((o) => o.id === id) : undefined);
const near = (pos: { x: number; y: number }, id: string) => {
  const o = objectOf(id);
  if (!o) return false;
  const cx = Math.max(o.x * TILE, Math.min(pos.x, (o.x + o.w) * TILE));
  const cy = Math.max(o.y * TILE, Math.min(pos.y, (o.y + o.h) * TILE));
  return Math.hypot(pos.x - cx, pos.y - cy) <= TILE * 3.5;
};
const COLOR = /^#[0-9a-f]{6}$/i;

/** YouTube watch / share links become embeddable; anything else must be http(s). */
export function normaliseEmbed(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const yt = u.hostname.replace(/^www\.|^m\./, '');
  let vid: string | null = null;
  if (yt === 'youtube.com' && u.pathname === '/watch') vid = u.searchParams.get('v');
  else if (yt === 'youtu.be') vid = u.pathname.slice(1);
  else if (yt === 'youtube.com' && u.pathname.startsWith('/shorts/')) vid = u.pathname.split('/')[2];
  if (vid && /^[\w-]{6,20}$/.test(vid)) return `https://www.youtube.com/embed/${vid}`;
  return u.toString().slice(0, 500);
}

export function registerObjects(io: Server, socket: Socket, me: { uid: string; name: () => string; pos: () => { x: number; y: number } }) {
  socket.on('obj:open', (m: { id: string }, ack?: (r: any) => void) => {
    const o = objectOf(m?.id);
    if (!o || typeof ack !== 'function') return;
    if (!near(me.pos(), o.id)) return ack({ ok: false, error: 'Walk up to it first.' });
    socket.join('obj:' + o.id);
    ack({ ok: true, type: o.type, strokes: state.boards[o.id] ?? [], notes: state.notes[o.id] ?? [], embed: state.embeds[o.id] ?? '' });
  });
  socket.on('obj:close', (m: { id: string }) => { if (typeof m?.id === 'string') socket.leave('obj:' + m.id); });

  const inRoom = (id: string) => socket.rooms.has('obj:' + id);

  socket.on('board:stroke', (m: { id: string; stroke: Stroke }) => {
    const s = m?.stroke;
    if (!inRoom(m?.id) || !s || !COLOR.test(s.c) || !Array.isArray(s.pts) || s.pts.length < 2 || s.pts.length > 4000) return;
    if (!s.pts.every((v) => typeof v === 'number' && v >= -0.05 && v <= 1.05)) return;
    const stroke: Stroke = { c: s.c, w: Math.max(1, Math.min(40, Number(s.w) || 3)), pts: s.pts.map((v) => Math.round(v * 10000) / 10000) };
    const list = (state.boards[m.id] ??= []);
    list.push(stroke);
    if (list.length > 1500) list.splice(0, list.length - 1500);
    socket.to('obj:' + m.id).emit('board:stroke', { id: m.id, stroke });
    save();
  });
  socket.on('board:clear', (m: { id: string }) => {
    if (!inRoom(m?.id)) return;
    state.boards[m.id] = [];
    io.to('obj:' + m.id).emit('board:clear', { id: m.id, by: me.name() });
    save();
  });

  socket.on('notes:add', (m: { id: string; text: string; color: string }) => {
    if (!inRoom(m?.id)) return;
    const text = String(m.text ?? '').trim().slice(0, 280);
    if (!text) return;
    const list = (state.notes[m.id] ??= []);
    if (list.length >= 60) return socket.emit('toast', { kind: 'warn', text: 'This board is full. Remove a note first.' });
    list.push({ id: Math.random().toString(36).slice(2, 10), text, color: COLOR.test(m.color) ? m.color : '#fde047', by: me.name(), at: new Date().toISOString() });
    io.to('obj:' + m.id).emit('notes', { id: m.id, notes: list });
    save();
  });
  socket.on('notes:remove', (m: { id: string; noteId: string }) => {
    if (!inRoom(m?.id)) return;
    state.notes[m.id] = (state.notes[m.id] ?? []).filter((n) => n.id !== m.noteId);
    io.to('obj:' + m.id).emit('notes', { id: m.id, notes: state.notes[m.id] });
    save();
  });

  socket.on('embed:set', (m: { id: string; url: string }) => {
    if (!inRoom(m?.id)) return;
    const url = normaliseEmbed(m.url);
    if (url === null) return socket.emit('toast', { kind: 'warn', text: 'That link does not look right (it must start with https://).' });
    state.embeds[m.id] = url;
    io.to('obj:' + m.id).emit('embed', { id: m.id, url, by: me.name() });
    save();
  });
}
