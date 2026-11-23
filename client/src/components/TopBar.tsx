import { useState } from 'react';
import { ChevronDown, Hammer, LogOut, Settings, Shield, UserPen, Wifi, WifiOff } from 'lucide-react';
import { DEFAULT_BUILD } from './BuildPanel';
import { zoneById } from '@shared/map';
import { STATUSES, statusInfo, type Status } from '@shared/types';
import { api } from '../api';
import { media } from '../media/MediaManager';
import { disconnectSocket, send } from '../net/socket';
import { useStore } from '../store';
import { Logo } from './Logo';

export function zoneName(zone: string | null | undefined) {
  if (!zone) return 'Hallway';
  return zoneById(zone.replace('room:', ''))?.name ?? 'Office';
}

export function StatusDot({ status, className = '' }: { status: Status; className?: string }) {
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-brand-900 ${className}`} style={{ background: statusInfo(status).color }} />;
}

export function TopBar() {
  const me = useStore((s) => s.me);
  const self = useStore((s) => (s.selfId ? s.players[s.selfId] : null));
  const connected = useStore((s) => s.connected);
  const online = useStore((s) => Object.keys(s.players).length);
  const set = useStore((s) => s.set);
  const [open, setOpen] = useState(false);
  const build = useStore((s) => !!s.build);
  const [statusText, setStatusText] = useState(self?.statusText ?? '');
  const status = self?.status ?? me?.status ?? 'available';

  const choose = (s: Status) => {
    send('status', s);
    useStore.getState().setStatus(s);
    setOpen(false);
  };
  const leave = async () => {
    disconnectSocket();
    media.shutdown();
    await api('/leave', { method: 'POST' }).catch(() => {});
    set({ me: null, selfId: null, players: {} });
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-white/10 bg-brand-900 px-4">
      <Logo />
      <div className="hidden h-6 w-px bg-white/10 md:block" />
      <div className="hidden min-w-0 text-sm md:block">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">You are in</div>
        <div className="truncate font-display text-base font-semibold tracking-wide text-white" data-testid="zone">{zoneName(self?.zone)}</div>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-1.5 text-xs text-slate-400" title={connected ? 'Connected' : 'Reconnecting…'}>
        {connected ? <Wifi size={14} className="text-emerald-400" /> : <WifiOff size={14} className="animate-pulse text-amber-400" />}
        <span className="hidden sm:inline">{connected ? `${online} online` : 'Reconnecting…'}</span>
      </div>
      <div className="relative">
        <button className="btn-ghost" onClick={() => setOpen((o) => !o)} data-testid="status-button">
          <StatusDot status={status} /> <span className="hidden sm:inline">{statusInfo(status).label}</span> <ChevronDown size={14} />
        </button>
        {open && (
          <div className="panel absolute right-0 top-11 z-50 w-48 overflow-hidden rounded-xl py-1 shadow-xl">
            {STATUSES.filter((s) => s.id !== 'meeting').map((s) => (
              <button key={s.id} onClick={() => choose(s.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5">
                <StatusDot status={s.id} /> {s.label}
              </button>
            ))}
            <form className="border-t border-white/10 p-2" onSubmit={(e) => { e.preventDefault(); send('status:text', statusText); setOpen(false); }}>
              <input className="input py-1.5 text-xs" maxLength={60} placeholder="What are you up to? (optional)" value={statusText} onChange={(e) => setStatusText(e.target.value)} data-testid="status-text" />
            </form>
            <div className="border-t border-white/10 px-3 py-2 text-[11px] text-slate-500">Do Not Disturb stops automatic conversations.</div>
          </div>
        )}
      </div>
      <button className="btn-ghost" onClick={() => set({ modal: 'profile' })} title="Edit profile & avatar"><UserPen size={16} /></button>
      <button className="btn-ghost" onClick={() => set({ modal: 'devices' })} title="Settings"><Settings size={16} /></button>
      {me?.role === 'admin' && (
        <button className={build ? 'btn-primary' : 'btn-ghost'} onClick={() => set({ build: build ? null : { ...DEFAULT_BUILD }, rightTab: null, card: null })} title="Build mode: change the office layout" data-testid="btn-build">
          <Hammer size={16} /> <span className="hidden lg:inline">{build ? 'Building' : 'Build'}</span>
        </button>
      )}
      {me?.role === 'admin' && <button className="btn-ghost" onClick={() => set({ modal: 'admin' })} title="Admin"><Shield size={16} /> <span className="hidden lg:inline">Admin</span></button>}
      <button className="btn-ghost" onClick={leave} title="Leave the office"><LogOut size={16} /></button>
    </header>
  );
}
