// Gather-style action card that opens when you click someone in the office or the directory.
import { BellRing, Footprints, Hand, LocateFixed, MessageSquare, UserPlus, Users, Zap } from 'lucide-react';
import { dmChannel, deptLabel, statusInfo } from '@shared/types';
import { send } from '../net/socket';
import { useStore } from '../store';
import { AvatarCanvas } from './AvatarEditor';
import { StatusDot, zoneName } from './TopBar';

/** Actions you can take on another person. Shared by the card and the directory. */
export function personActions(id: string) {
  const st = useStore.getState();
  const close = () => st.set({ card: null });
  return {
    follow: () => { st.set({ follow: id, card: null }); st.toast({ kind: 'info', text: `Following ${st.players[id]?.name}. Move to stop.` }); },
    teleport: () => { send('teleport', { to: id }); close(); },
    ring: () => { send('request', { to: id, kind: 'ring' }); close(); },
    invite: () => { send('request', { to: id, kind: 'invite' }); close(); },
    wave: () => { send('wave', { to: id }); close(); },
    locate: () => { st.set({ locate: { id, t: Date.now() }, card: null }); },
    walk: () => { st.set({ walkTo: { id, t: Date.now() }, card: null }); },
    message: () => {
      const ch = dmChannel(st.selfId!, id);
      st.set({ rightTab: 'chat', activeChannel: ch, dmChannels: st.dmChannels.includes(ch) ? st.dmChannels : [ch, ...st.dmChannels], card: null });
    },
  };
}

export function ActionGrid({ id, compact = false }: { id: string; compact?: boolean }) {
  const a = personActions(id);
  const B = ({ onClick, icon, label, title }: { onClick: () => void; icon: React.ReactNode; label: string; title: string }) => (
    <button className={`btn-ghost ${compact ? 'px-2 py-1.5 text-xs' : 'px-2 py-2 text-xs'} justify-start`} onClick={onClick} title={title}>{icon} {label}</button>
  );
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <B onClick={a.walk} icon={<Footprints size={13} />} label="Walk to" title="Walk over to them" />
      <B onClick={a.teleport} icon={<Zap size={13} />} label="Go to" title="Teleport next to them" />
      <B onClick={a.follow} icon={<Users size={13} />} label="Follow" title="Keep walking behind them" />
      <B onClick={a.ring} icon={<BellRing size={13} />} label="Ring" title="Ask to talk. If they accept you jump next to them" />
      <B onClick={a.invite} icon={<UserPlus size={13} />} label="Invite here" title="Ask them to come to you" />
      <B onClick={a.wave} icon={<Hand size={13} />} label="Wave" title="Send a wave" />
      <B onClick={a.message} icon={<MessageSquare size={13} />} label="Message" title="Direct message" />
      <B onClick={a.locate} icon={<LocateFixed size={13} />} label="Locate" title="Show where they are" />
    </div>
  );
}

export function PlayerCard() {
  const card = useStore((s) => s.card);
  const p = useStore((s) => (s.card ? s.players[s.card.id] : null));
  if (!card || !p) return null;
  const left = Math.max(8, Math.min(card.x + 16, window.innerWidth - 330));
  const top = Math.max(8, card.y - 120);
  return (
    <div className="panel absolute z-40 w-72 rounded-2xl p-3 shadow-2xl" style={{ left, top }} data-testid="player-card" onMouseDown={(e) => e.stopPropagation()}>
      <div className="mb-2 flex items-center gap-3">
        <div className="relative h-12 w-10 shrink-0 overflow-hidden rounded-lg bg-brand-800">
          <AvatarCanvas avatar={p.avatar} size={2} className="absolute left-1 top-0" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate font-display text-base font-semibold text-white"><StatusDot status={p.status} /> {p.name} {p.hand && '✋'}</div>
          <div className="truncate text-xs text-slate-400">{[p.title, deptLabel(p.dept)].filter(Boolean).join(' · ')}</div>
          <div className="truncate text-xs text-slate-400">{statusInfo(p.status).label} · {zoneName(p.zone)}</div>
        </div>
      </div>
      {p.statusText && <div className="mb-2 rounded-lg bg-white/5 px-2 py-1 text-xs italic text-slate-300">“{p.statusText}”</div>}
      <ActionGrid id={p.id} />
    </div>
  );
}
