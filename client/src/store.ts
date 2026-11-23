import { create } from 'zustand';
import type { ChatMessage, DeskInfo, Dir, MeUser, PeerMode, PlayerState, PublicSettings, RoomState, Status } from '@shared/types';

/** Fast-changing positions live outside React state (read every frame by the game + media loop). */
export const positions = new Map<string, { x: number; y: number; dir: Dir; moving: boolean }>();

export interface RemotePeer {
  id: string;
  mode: PeerMode;
  state: RTCPeerConnectionState | 'new';
  cam: MediaStream | null;
  screen: MediaStream | null;
  volume: number; // 0..1 effective gain (proximity)
  speaking: boolean;
}

export interface IncomingRequest { id: string; from: string; fromName: string; kind: 'ring' | 'invite' | 'knock'; roomName?: string }

/** Admin build mode: which tool is active and its options. */
export interface BuildState {
  tool: 'object' | 'erase' | 'floor' | 'wall' | 'door' | 'area';
  objType: string;
  variant: number;
  floor: string;
  areaKind: 'open' | 'private';
  areaWalls: boolean;
  dirty: boolean;
}

export interface Toast { id: number; kind: 'ok' | 'warn' | 'info' | 'wave'; text: string; from?: string; ttl?: number }

interface State {
  me: MeUser | null;
  selfId: string | null;
  settings: PublicSettings | null;
  players: Record<string, PlayerState>;
  rooms: Record<string, RoomState>;
  desks: Record<string, DeskInfo>;
  connected: boolean;

  // media
  mic: boolean;
  cam: boolean;
  screen: boolean;
  localCam: MediaStream | null;
  localScreen: MediaStream | null;
  localSpeaking: boolean;
  peers: Record<string, RemotePeer>;
  masterVolume: number;
  audioBlocked: boolean;

  // chat
  messages: Record<string, ChatMessage[]>;
  unread: Record<string, number>;
  activeChannel: string;
  dmChannels: string[];

  // ui
  leftOpen: boolean;
  rightTab: 'chat' | 'meeting' | null;
  expanded: boolean;
  modal: null | 'avatar' | 'devices' | 'admin' | 'profile';
  toasts: Toast[];
  locate: { id: string; t: number } | null;
  walkTo: { id: string; t: number } | null;
  hint: string | null;
  card: { id: string; x: number; y: number } | null;
  openObject: string | null;
  follow: string | null;
  minimap: boolean;
  requests: IncomingRequest[];
  walkTile: { x: number; y: number; t: number } | null;
  build: BuildState | null;
  /** bumps when the office layout changes (map redraw) */
  layoutVersion: number;

  set: (p: Partial<State>) => void;
  patchPlayer: (p: Partial<PlayerState> & { id: string }) => void;
  setPeer: (id: string, p: Partial<RemotePeer> | null) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  addMessage: (m: ChatMessage) => void;
  setStatus: (s: Status) => void;
}

let toastId = 1;

export const useStore = create<State>((set, get) => ({
  me: null,
  selfId: null,
  settings: null,
  players: {},
  rooms: {},
  desks: {},
  connected: false,
  mic: false,
  cam: false,
  screen: false,
  localCam: null,
  localScreen: null,
  localSpeaking: false,
  peers: {},
  masterVolume: 1,
  audioBlocked: false,
  messages: {},
  unread: {},
  activeChannel: 'general',
  dmChannels: [],
  leftOpen: true,
  rightTab: 'chat',
  expanded: false,
  modal: null,
  toasts: [],
  locate: null,
  walkTo: null,
  hint: null,
  card: null,
  openObject: null,
  follow: null,
  minimap: (() => { try { return localStorage.getItem('rsp.minimap') !== '0'; } catch { return true; } })(),
  requests: [],
  walkTile: null,
  build: null,
  layoutVersion: 0,

  set: (p) => set(p),
  patchPlayer: (p) =>
    set((s) => (s.players[p.id] ? { players: { ...s.players, [p.id]: { ...s.players[p.id], ...p } } } : {})),
  setPeer: (id, p) =>
    set((s) => {
      const peers = { ...s.peers };
      if (p === null) delete peers[id];
      else peers[id] = { ...(peers[id] ?? { id, mode: 'proximity', state: 'new', cam: null, screen: null, volume: 0, speaking: false }), ...p };
      return { peers };
    }),
  toast: (t) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }));
    setTimeout(() => get().dismiss(id), t.ttl ?? (t.kind === 'wave' ? 12000 : 4500));
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  addMessage: (m) =>
    set((s) => {
      const list = s.messages[m.channel] ?? [];
      if (list.some((x) => x.id === m.id)) return {};
      const visible = s.rightTab === 'chat' && s.activeChannel === m.channel && document.visibilityState === 'visible';
      const mine = m.senderId === s.selfId;
      return {
        messages: { ...s.messages, [m.channel]: [...list, m] },
        unread: visible || mine ? s.unread : { ...s.unread, [m.channel]: (s.unread[m.channel] ?? 0) + 1 },
        dmChannels: m.channel.startsWith('dm:') && !s.dmChannels.includes(m.channel) ? [m.channel, ...s.dmChannels] : s.dmChannels,
      };
    }),
  setStatus: (s) => {
    const id = get().selfId;
    if (id) get().patchPlayer({ id, status: s });
  },
}));
