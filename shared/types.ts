// Types and constants shared by the client and the server.

export type Dir = 'down' | 'left' | 'right' | 'up';
export type Role = 'admin' | 'manager' | 'member';
export type Status = 'available' | 'busy' | 'meeting' | 'away' | 'dnd';
export type Dept = 'sales' | 'sdr' | 'ops' | 'warehouse' | 'management';

export const STATUSES: { id: Status; label: string; color: string }[] = [
  { id: 'available', label: 'Available', color: '#22c55e' },
  { id: 'busy', label: 'Busy', color: '#f59e0b' },
  { id: 'meeting', label: 'In a Meeting', color: '#8b5cf6' },
  { id: 'away', label: 'Away', color: '#94a3b8' },
  { id: 'dnd', label: 'Do Not Disturb', color: '#ef4444' },
];
export const statusInfo = (s: Status) => STATUSES.find((x) => x.id === s) ?? STATUSES[0];

export const DEPTS: { id: Dept; label: string }[] = [
  { id: 'sales', label: 'Sales' },
  { id: 'sdr', label: 'SDR' },
  { id: 'ops', label: 'Quoting & Operations' },
  { id: 'warehouse', label: 'Warehouse & Shipping' },
  { id: 'management', label: 'Management' },
];
export const deptLabel = (d: string) => DEPTS.find((x) => x.id === d)?.label ?? d;

export type HairStyle = 'short' | 'long' | 'spiky' | 'bun' | 'ponytail' | 'curly' | 'mohawk' | 'bald';
export type Accessory = 'none' | 'glasses' | 'sunglasses' | 'cap' | 'hardhat' | 'headset' | 'beanie' | 'bow';

export interface AvatarConfig {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  pants: string;
  shoes: string;
  accessory: Accessory;
}

export const AVATAR_OPTIONS = {
  skin: ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3a21'],
  hair: ['#1f1a17', '#4a2f1b', '#8b5a2b', '#d6a24a', '#e8d08a', '#b33a1e', '#9ca3af', '#f5f5f4', '#3b82f6', '#ec4899'],
  hairStyle: ['short', 'long', 'spiky', 'bun', 'ponytail', 'curly', 'mohawk', 'bald'] as HairStyle[],
  shirt: ['#123a6b', '#f26b1d', '#16a34a', '#dc2626', '#7c3aed', '#0891b2', '#f5f5f4', '#374151', '#eab308', '#db2777'],
  pants: ['#1e293b', '#334155', '#1d4ed8', '#78350f', '#57534e', '#0f766e', '#111827', '#a8a29e'],
  shoes: ['#111827', '#7c2d12', '#f5f5f4', '#b91c1c'],
  accessory: ['none', 'glasses', 'sunglasses', 'cap', 'hardhat', 'headset', 'beanie', 'bow'] as Accessory[],
};

export function randomAvatar(seed = Math.random()): AvatarConfig {
  let s = Math.floor(seed * 2 ** 31) || 1;
  const r = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  return {
    skin: pick(AVATAR_OPTIONS.skin),
    hair: pick(AVATAR_OPTIONS.hair.slice(0, 7)),
    hairStyle: pick(AVATAR_OPTIONS.hairStyle.slice(0, 7)),
    shirt: pick(AVATAR_OPTIONS.shirt),
    pants: pick(AVATAR_OPTIONS.pants),
    shoes: pick(AVATAR_OPTIONS.shoes),
    accessory: 'none',
  };
}

export function sanitizeAvatar(a: any): AvatarConfig | null {
  if (!a || typeof a !== 'object') return null;
  const hex = (v: any) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  if (![a.skin, a.hair, a.shirt, a.pants, a.shoes].every(hex)) return null;
  if (!AVATAR_OPTIONS.hairStyle.includes(a.hairStyle)) return null;
  if (!AVATAR_OPTIONS.accessory.includes(a.accessory)) return null;
  return { skin: a.skin, hair: a.hair, hairStyle: a.hairStyle, shirt: a.shirt, pants: a.pants, shoes: a.shoes, accessory: a.accessory };
}

export interface PlayerState {
  id: string;
  name: string;
  title: string;
  dept: string;
  role: Role;
  avatar: AvatarConfig;
  x: number; // world px (feet centre)
  y: number;
  dir: Dir;
  moving: boolean;
  status: Status;
  mic: boolean;
  cam: boolean;
  screen: boolean;
  zone: string | null;
  /** short custom status ("Back at 2", "Quoting the Acme order") */
  statusText: string;
  /** raised hand (shown over the avatar and on the video tile) */
  hand: boolean;
  /** id of a locked conversation bubble this person is in, or null */
  bubble: string | null;
  /** broadcasting to the whole office */
  spotlight: boolean;
}

export interface ProximityConfig {
  /** distance (tiles) at which audio/video is at full strength */
  fullRadius: number;
  /** distance (tiles) at which the conversation disconnects */
  connectRadius: number;
  /** max simultaneous peer connections in open areas (mesh limit) */
  maxPeers: number;
}

export const DEFAULT_PROXIMITY: ProximityConfig = { fullRadius: 2, connectRadius: 5, maxPeers: 8 };

export interface PublicSettings {
  officeSign: string;
  welcomeMessage: string;
  proximity: ProximityConfig;
  allowAvatarCustomization: boolean;
  allowNameChange: boolean;
}

export interface RoomState {
  id: string;
  locked: boolean;
  lockedBy: string | null;
  anyoneCanLock: boolean;
  capacity: number;
}

export interface DeskInfo {
  userId: string;
  name: string;
}

export interface ChatMessage {
  id: number;
  channel: string;
  senderId: string | null;
  senderName: string;
  body: string;
  createdAt: string;
  reactions: Record<string, string[]>; // emoji -> user ids
}

/** proximity / room: two-way. spotlight: I listen to a broadcaster. audience: I am the broadcaster, they listen. */
export type PeerMode = 'proximity' | 'room' | 'spotlight' | 'audience';
export interface PeerLink {
  id: string;
  mode: PeerMode;
}

export interface MeUser {
  id: string;
  email: string;
  name: string;
  title: string;
  dept: string;
  role: Role;
  avatar: AvatarConfig;
  status: Status;
  deskId: string | null;
  onboarded: boolean;
}

export const dmChannel = (a: string, b: string) => 'dm:' + [a, b].sort().join(':');
export const REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '✅'];

/** Emotes shown over the avatar (keys 1-6, Z to dance). 'hand' toggles a raised hand. */
export const EMOTES = [
  { id: 'wave', emoji: '👋', key: '1', label: 'Wave' },
  { id: 'heart', emoji: '❤️', key: '2', label: 'Heart' },
  { id: 'party', emoji: '🎉', key: '3', label: 'Celebrate' },
  { id: 'thumbs', emoji: '👍', key: '4', label: 'Thumbs up' },
  { id: 'laugh', emoji: '😂', key: '5', label: 'Laugh' },
  { id: 'hand', emoji: '✋', key: '6', label: 'Raise hand' },
  { id: 'dance', emoji: '🕺', key: 'Z', label: 'Dance' },
  { id: 'coffee', emoji: '☕', key: '', label: 'Coffee' },
  { id: 'snack', emoji: '🍫', key: '', label: 'Snack' },
  { id: 'water', emoji: '💧', key: '', label: 'Water' },
] as const;
export type EmoteId = (typeof EMOTES)[number]['id'];

/** Map objects you can walk up to and press X on. */
export const INTERACTIVE = ['whiteboard', 'tv', 'orderBoard', 'kiosk', 'coffee', 'waterCooler', 'vending', 'clock', 'bookshelf'] as const;
export type InteractiveType = (typeof INTERACTIVE)[number];

export interface Stroke { c: string; w: number; pts: number[] } // pts: x,y pairs normalised 0..1
export interface StickyNote { id: string; text: string; color: string; by: string; at: string }

/** Requests between two people. ring: "can I come talk?" (accept = they come to you). invite: "come join me" (accept = you go to them). */
export type RequestKind = 'ring' | 'invite';
