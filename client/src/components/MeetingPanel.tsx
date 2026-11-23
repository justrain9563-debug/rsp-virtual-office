import { DoorOpen, Lock, LockOpen, Megaphone, Mic, MicOff, Users, Video, VideoOff, X } from 'lucide-react';
import { privateZones } from '@shared/map';
import { send } from '../net/socket';
import { useStore } from '../store';
import { StatusDot } from './TopBar';

export function MeetingPanel() {
  const peers = useStore((s) => s.peers);
  const players = useStore((s) => s.players);
  const rooms = useStore((s) => s.rooms);
  const selfId = useStore((s) => s.selfId);
  const me = selfId ? players[selfId] : null;
  const set = useStore((s) => s.set);
  const myRoom = me?.zone?.startsWith('room:') ? me.zone.slice(5) : null;

  const counts: Record<string, string[]> = {};
  for (const p of Object.values(players)) if (p.zone?.startsWith('room:')) (counts[p.zone.slice(5)] ??= []).push(p.name);
  const list = Object.values(peers).filter((p) => players[p.id] && p.mode !== 'audience');

  return (
    <aside className="flex w-[22rem] shrink-0 flex-col border-l border-white/10 bg-brand-900/95" data-testid="meeting">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="font-display text-base font-semibold tracking-wide text-white">Meeting</h2>
        <button className="text-slate-500 hover:text-white" onClick={() => set({ rightTab: null })}><X size={16} /></button>
      </div>
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-4">
        <section>
          <h3 className="label">In your conversation</h3>
          {list.length === 0 ? (
            <p className="text-sm text-slate-400">Nobody nearby. Walk up to someone (within {useStore.getState().settings?.proximity.connectRadius ?? 5} tiles) or step into a meeting room to start talking.</p>
          ) : (
            <ul className="space-y-1.5">
              {list.map((p) => {
                const pl = players[p.id];
                return (
                  <li key={p.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5 text-sm">
                    <StatusDot status={pl.status} />
                    <span className="flex-1 truncate">{pl.name}</span>
                    <span className="text-[10px] uppercase text-slate-400">{p.mode === 'room' ? 'room' : p.mode === 'spotlight' ? 'broadcast' : `${Math.round(p.volume * 100)}%`}</span>
                    {pl.mic ? <Mic size={14} className="text-emerald-400" /> : <MicOff size={14} className="text-slate-500" />}
                    {pl.cam ? <Video size={14} className="text-emerald-400" /> : <VideoOff size={14} className="text-slate-500" />}
                    <span className={`h-2 w-2 rounded-full ${p.state === 'connected' ? 'bg-emerald-400' : p.state === 'failed' ? 'bg-red-500' : 'bg-amber-400'}`} title={p.state} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {me && me.role !== 'member' && (
          <section>
            <h3 className="label">Broadcast</h3>
            <button className={`w-full ${me.spotlight ? 'btn-primary' : 'btn-ghost'}`} onClick={() => send('spotlight', !me.spotlight)} data-testid="btn-spotlight">
              <Megaphone size={15} /> {me.spotlight ? 'Stop broadcasting' : 'Speak to the whole office'}
            </button>
            <p className="mt-1 text-xs text-slate-500">Everyone online hears and sees you (like a stage). Turn your mic on first.</p>
          </section>
        )}

        <section>
          <h3 className="label">Meeting rooms</h3>
          <ul className="space-y-2">
            {privateZones().map((z) => {
              const r = rooms[z.id];
              const inside = counts[z.id] ?? [];
              const here = myRoom === z.id;
              return (
                <li key={z.id} className={`rounded-xl p-3 ring-1 ${here ? 'bg-accent-500/10 ring-accent-500/40' : 'bg-white/5 ring-white/5'}`}>
                  <div className="flex items-center gap-2">
                    {r?.locked ? <Lock size={14} className="text-red-400" /> : <Users size={14} className="text-slate-400" />}
                    <span className="flex-1 text-sm font-semibold">{z.name}</span>
                    <span className="text-xs text-slate-400">{inside.length}/{r?.capacity ?? '–'}</span>
                  </div>
                  {inside.length > 0 && <div className="mt-1 truncate text-xs text-slate-400">{inside.join(', ')}</div>}
                  {r?.locked && <div className="mt-1 text-xs text-red-300">Locked{r.lockedBy ? ` by ${r.lockedBy}` : ''}</div>}
                  {r?.locked && !here && inside.length > 0 && (
                    <button className="btn-ghost mt-2 w-full py-1.5 text-xs" onClick={() => send('room:knock', { roomId: z.id })}><DoorOpen size={13} /> Knock</button>
                  )}
                  {here && (
                    <button className="btn-ghost mt-2 w-full py-1.5 text-xs" onClick={() => send('room:lock', { roomId: z.id, locked: !r?.locked })}>
                      {r?.locked ? <><LockOpen size={13} /> Unlock room</> : <><Lock size={13} /> Lock room</>}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Everyone inside a room hears each other; nobody outside can. Walk out of the door to leave. A locked room's door closes; people outside can knock and anyone inside can let them in. Locks clear when a room empties.</p>
        </section>
      </div>
    </aside>
  );
}
