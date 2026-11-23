import { ActionGrid } from './PlayerCard';
import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, Search, X } from 'lucide-react';
import { deptLabel, dmChannel, statusInfo, type AvatarConfig, type Status } from '@shared/types';
import { api } from '../api';
import { useStore } from '../store';
import { AvatarCanvas } from './AvatarEditor';
import { StatusDot, zoneName } from './TopBar';

interface DirUser { id: string; name: string; title: string; dept: string; avatar: AvatarConfig; status: Status; online: boolean }

export function Directory() {
  const players = useStore((s) => s.players);
  const selfId = useStore((s) => s.selfId);
  const peers = useStore((s) => s.peers);
  const set = useStore((s) => s.set);
  const [q, setQ] = useState('');
  const [offline, setOffline] = useState<DirUser[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const locate = useStore((s) => s.locate);

  useEffect(() => { if (locate) setSelected(locate.id); }, [locate]);
  useEffect(() => {
    api<DirUser[]>('/users').then(setOffline).catch(() => {});
  }, [Object.keys(players).length]);

  const online = useMemo(() => Object.values(players).sort((a, b) => (a.id === selfId ? -1 : b.id === selfId ? 1 : a.name.localeCompare(b.name))), [players, selfId]);
  const match = (n: string, d: string) => !q || n.toLowerCase().includes(q.toLowerCase()) || deptLabel(d).toLowerCase().includes(q.toLowerCase());
  const away = offline.filter((u) => !players[u.id] && match(u.name, u.dept));

  const openDm = (id: string) => {
    const ch = dmChannel(selfId!, id);
    useStore.setState((s) => ({ rightTab: 'chat', activeChannel: ch, dmChannels: s.dmChannels.includes(ch) ? s.dmChannels : [ch, ...s.dmChannels] }));
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-white/10 bg-brand-900/95" data-testid="directory">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <h2 className="font-display text-base font-semibold tracking-wide text-white">Employee directory</h2>
        <button className="text-slate-500 hover:text-white" onClick={() => set({ leftOpen: false })} title="Hide"><X size={16} /></button>
      </div>
      <div className="relative px-3 pb-2">
        <Search size={14} className="pointer-events-none absolute left-6 top-2.5 text-slate-500" />
        <input className="input pl-8" placeholder="Search people or teams" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-3">
        <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-400">Online · {online.length}</div>
        {online.filter((p) => match(p.name, p.dept)).map((p) => (
          <div key={p.id} className={`rounded-xl ${selected === p.id ? 'bg-white/10' : 'hover:bg-white/5'}`}>
            <button className="flex w-full items-center gap-3 px-2 py-1.5 text-left" onClick={() => { setSelected(selected === p.id ? null : p.id); set({ locate: { id: p.id, t: Date.now() } }); }}>
              <div className="relative h-10 w-8 shrink-0 overflow-hidden">
                <AvatarCanvas avatar={p.avatar} size={2} className="absolute -top-1 left-0" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate text-sm font-semibold text-white">
                  <StatusDot status={p.status} /> <span className="truncate">{p.name}{p.id === selfId && <span className="font-normal text-slate-400"> (you)</span>}</span>{p.hand && <span title="Hand raised">✋</span>}{p.spotlight && <span title="Broadcasting">📢</span>}
                </div>
                <div className="truncate text-xs text-slate-400">{peers[p.id] && peers[p.id].mode !== 'audience' ? <span className="text-accent-300">● Talking with you</span> : p.statusText ? `${p.statusText}` : `${zoneName(p.zone)}`}</div>
              </div>
            </button>
            {selected === p.id && (
              <div className="space-y-2 px-3 pb-3">
                <div className="text-xs text-slate-400">{[p.title, deptLabel(p.dept)].filter(Boolean).join(' · ')} · {statusInfo(p.status).label}</div>
                {p.statusText && <div className="text-xs italic text-slate-300">“{p.statusText}”</div>}
                {p.id !== selfId && <ActionGrid id={p.id} compact />}
              </div>
            )}
          </div>
        ))}
        {away.length > 0 && <div className="mt-3 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Offline · {away.length}</div>}
        {away.map((u) => (
          <div key={u.id} className="group flex items-center gap-3 rounded-xl px-2 py-1.5 opacity-60 hover:bg-white/5 hover:opacity-100">
            <div className="relative h-10 w-8 shrink-0 overflow-hidden grayscale">
              <AvatarCanvas avatar={u.avatar} size={2} className="absolute -top-1 left-0" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-slate-300">{u.name}</div>
              <div className="truncate text-xs text-slate-500">{deptLabel(u.dept)}</div>
            </div>
            <button className="hidden text-slate-400 hover:text-white group-hover:block" title="Message" onClick={() => openDm(u.id)}><MessageSquare size={14} /></button>
          </div>
        ))}
      </div>
    </aside>
  );
}
