import { io, type Socket } from 'socket.io-client';
import type { ChatMessage, PeerLink, PlayerState } from '@shared/types';
import { positions, useStore } from '../store';
import { media } from '../media/MediaManager';
import { notify } from '../notify';

let socket: Socket | null = null;

export const send = (ev: string, ...args: any[]) => socket?.emit(ev, ...args);
export const request = <T>(ev: string, data?: any) =>
  new Promise<T>((res) => (data === undefined ? socket?.emit(ev, res) : socket?.emit(ev, data, res)));

/** Callback the game scene registers to receive server position corrections. */
export const correction = { handler: null as null | ((x: number, y: number) => void) };

export function connectSocket() {
  if (socket) return socket;
  const st = useStore.getState;
  socket = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });

  socket.on('connect', () => st().set({ connected: true }));
  socket.on('disconnect', () => {
    st().set({ connected: false });
    media.setPeers([]); // all calls end; server re-links after reconnect
  });
  socket.on('connect_error', (e) => {
    if (e.message === 'unauthorized') { socket?.disconnect(); socket = null; st().set({ me: null }); }
  });

  socket.on('init', (d: { selfId: string; players: PlayerState[]; rooms: any[]; settings: any; desks: any }) => {
    const players: Record<string, PlayerState> = {};
    const mine = positions.get(d.selfId);
    for (const p of d.players) {
      players[p.id] = p;
      if (p.id !== d.selfId || !mine) positions.set(p.id, { x: p.x, y: p.y, dir: p.dir, moving: p.moving });
    }
    st().set({ selfId: d.selfId, players, settings: d.settings, desks: d.desks, rooms: Object.fromEntries(d.rooms.map((r) => [r.id, r])) });
    // tell others our current media state after (re)connecting
    send('media', { mic: st().mic, cam: st().cam, screen: st().screen });
    const me = players[d.selfId];
    if (me && st().me && me.status !== st().me!.status) send('status', st().me!.status);
    request<string[]>('chat:dms').then((dms) => st().set({ dmChannels: dms }));
  });

  socket.on('player:join', (p: PlayerState) => {
    positions.set(p.id, { x: p.x, y: p.y, dir: p.dir, moving: p.moving });
    useStore.setState((s) => ({ players: { ...s.players, [p.id]: p } }));
  });
  socket.on('player:leave', (id: string) => {
    positions.delete(id);
    useStore.setState((s) => {
      const players = { ...s.players };
      delete players[id];
      return { players };
    });
  });
  socket.on('player:update', (p: Partial<PlayerState> & { id: string }) => {
    st().patchPlayer(p);
    if (p.id === st().selfId && st().me) {
      const me = { ...st().me! };
      for (const k of ['name', 'title', 'dept', 'role', 'avatar', 'status'] as const) if (p[k] !== undefined) (me as any)[k] = p[k];
      st().set({ me });
    }
  });
  socket.on('positions', (batch: [string, number, number, any, number][]) => {
    const self = st().selfId;
    for (const [id, x, y, dir, moving] of batch) {
      if (id === self) continue;
      positions.set(id, { x, y, dir, moving: !!moving });
    }
  });
  socket.on('correct', (p: { x: number; y: number }) => correction.handler?.(p.x, p.y));
  socket.on('peers', (list: PeerLink[]) => media.setPeers(list));
  socket.on('signal', (m: { from: string; data: any }) => media.onSignal(m.from, m.data));
  socket.on('rooms', (rooms: any[]) => st().set({ rooms: Object.fromEntries(rooms.map((r) => [r.id, r])) }));
  socket.on('desks', (desks: any) => st().set({ desks }));
  socket.on('settings', (settings: any) => st().set({ settings }));
  socket.on('toast', (t: { kind: any; text: string }) => st().toast(t));
  socket.on('kicked', (reason: string) => {
    st().toast({ kind: 'warn', text: reason, ttl: 60000 });
    socket?.disconnect();
    socket = null;
    media.shutdown();
    st().set({ me: null });
  });
  socket.on('wave', (w: { from: string; fromName: string; message: string }) => {
    st().toast({ kind: 'wave', text: `${w.fromName} waved at you 👋${w.message ? ` "${w.message}"` : ''}`, from: w.from });
    notify(`${w.fromName} waved at you 👋`, w.message || 'Walk over to say hi.');
  });
  socket.on('chat:message', (m: ChatMessage) => {
    st().addMessage(m);
    if (m.senderId !== st().selfId && m.channel.startsWith('dm:')) notify(`Message from ${m.senderName}`, m.body);
  });
  socket.on('chat:reaction', (r: { messageId: number; channel: string; reactions: Record<string, string[]> }) => {
    useStore.setState((s) => {
      const list = s.messages[r.channel];
      if (!list) return {};
      return { messages: { ...s.messages, [r.channel]: list.map((m) => (m.id === r.messageId ? { ...m, reactions: r.reactions } : m)) } };
    });
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
