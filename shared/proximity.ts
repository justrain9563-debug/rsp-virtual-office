// Proximity rules shared by server (who may connect) and client (how loud).
import { TILE, lineOfSight, tileOf, zoneAtPx } from './map';
import type { PeerMode, ProximityConfig, Status } from './types';

export interface ProxPlayer { x: number; y: number; zone: string | null; status: Status }

/** Extra tiles of range before an existing conversation drops (stops flapping at the edge). */
export const HYSTERESIS = 0.75;

export const tileDistance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y) / TILE;

/**
 * Audio gain for an open-area conversation.
 *   d <= fullRadius(+0.5)          -> 1.0  (0-2 tiles: full)
 *   fullRadius .. connectRadius    -> linear fade 1.0 -> 0.15 (3-5 tiles)
 *   beyond (hysteresis band)       -> 0.15 -> 0 just before disconnect
 */
export function volumeForDistance(d: number, cfg: ProximityConfig) {
  const full = cfg.fullRadius + 0.5;
  const edge = cfg.connectRadius + 0.5;
  if (d <= full) return 1;
  if (d <= edge) return 1 - ((d - full) / (edge - full)) * 0.85;
  const end = edge + HYSTERESIS;
  if (d >= end) return 0;
  return 0.15 * (1 - (d - edge) / (end - edge));
}

/** Decide whether two players should be in a conversation. */
export function evaluatePair(a: ProxPlayer, b: ProxPlayer, cfg: ProximityConfig, wasConnected: boolean): PeerMode | null {
  const za = a.zone, zb = b.zone;
  const privA = za !== null && za.startsWith('room:');
  const privB = zb !== null && zb.startsWith('room:');
  // Private rooms: everyone inside the same room talks, nobody outside hears.
  if (privA || privB) return privA && privB && za === zb ? 'room' : null;
  // Open areas: Do Not Disturb blocks automatic conversations.
  if (a.status === 'dnd' || b.status === 'dnd') return null;
  const d = tileDistance(a, b);
  const limit = cfg.connectRadius + 0.5 + (wasConnected ? HYSTERESIS : 0);
  if (d > limit) return null;
  if (!lineOfSight(tileOf(a.x), tileOf(a.y), tileOf(b.x), tileOf(b.y))) return null;
  return 'proximity';
}

/** Zone key used for proximity: private rooms are prefixed so they can't be confused with open areas. */
export function zoneKeyAt(x: number, y: number) {
  const z = zoneAtPx(x, y);
  if (!z) return null;
  return z.kind === 'private' ? 'room:' + z.id : z.id;
}
