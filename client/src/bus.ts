// Tiny event bus for one-off events that don't belong in React state (emotes, whiteboard strokes...).
type Fn = (...a: any[]) => void;
const map = new Map<string, Set<Fn>>();
export const bus = {
  on(ev: string, fn: Fn) { (map.get(ev) ?? map.set(ev, new Set()).get(ev)!).add(fn); return () => { map.get(ev)?.delete(fn); }; },
  emit(ev: string, ...a: any[]) { map.get(ev)?.forEach((fn) => fn(...a)); },
};
