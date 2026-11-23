import { Mic, MicOff, MonitorUp, MonitorX, MessageSquare, Users, Video, VideoOff, Volume2, VolumeX, DoorOpen, PanelLeft } from 'lucide-react';
import { media } from '../media/MediaManager';
import { useStore } from '../store';

function Ctl({ on, onClick, iconOn, iconOff, label, danger = false, testid }: { on: boolean; onClick: () => void; iconOn: React.ReactNode; iconOff: React.ReactNode; label: string; danger?: boolean; testid?: string }) {
  return (
    <button onClick={onClick} data-testid={testid} aria-pressed={on} title={label}
      className={`flex min-w-[64px] flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-[11px] font-semibold transition ${
        on ? 'bg-white/10 text-white hover:bg-white/15' : danger ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'text-slate-300 hover:bg-white/5'}`}>
      {on ? iconOn : iconOff}
      <span>{label}</span>
    </button>
  );
}

export function ControlBar() {
  const mic = useStore((s) => s.mic);
  const cam = useStore((s) => s.cam);
  const screen = useStore((s) => s.screen);
  const vol = useStore((s) => s.masterVolume);
  const rightTab = useStore((s) => s.rightTab);
  const leftOpen = useStore((s) => s.leftOpen);
  const unread = useStore((s) => Object.values(s.unread).reduce((a, b) => a + b, 0));
  const peers = useStore((s) => Object.keys(s.peers).length);
  const set = useStore((s) => s.set);

  return (
    <footer className="flex h-[68px] shrink-0 items-center gap-2 border-t border-white/10 bg-brand-900 px-3">
      <Ctl on={leftOpen} onClick={() => set({ leftOpen: !leftOpen })} iconOn={<PanelLeft size={18} />} iconOff={<PanelLeft size={18} />} label="People" />
      <div className="flex-1" />
      <Ctl testid="btn-mic" on={mic} danger onClick={() => media.setMic(!mic)} iconOn={<Mic size={18} />} iconOff={<MicOff size={18} />} label={mic ? 'Mute' : 'Unmute'} />
      <Ctl testid="btn-cam" on={cam} danger onClick={() => media.setCam(!cam)} iconOn={<Video size={18} />} iconOff={<VideoOff size={18} />} label={cam ? 'Stop video' : 'Start video'} />
      <Ctl testid="btn-screen" on={screen} onClick={() => media.setScreen(!screen)} iconOn={<MonitorX size={18} />} iconOff={<MonitorUp size={18} />} label={screen ? 'Stop share' : 'Share screen'} />
      <div className="mx-1 flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2" title="Speaker volume">
        <button onClick={() => set({ masterVolume: vol > 0 ? 0 : 1 })} className="text-slate-300 hover:text-white">{vol > 0 ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
        <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => set({ masterVolume: +e.target.value })} className="w-20 accent-accent-500" aria-label="Speaker volume" />
      </div>
      <div className="flex-1" />
      <Ctl on={rightTab === 'meeting'} onClick={() => set({ rightTab: rightTab === 'meeting' ? null : 'meeting' })}
        iconOn={<Users size={18} />} iconOff={<span className="relative"><Users size={18} />{peers > 0 && <span className="absolute -right-2 -top-1 rounded-full bg-accent-500 px-1 text-[9px] text-white">{peers}</span>}</span>} label="Meeting" />
      <Ctl on={rightTab === 'chat'} onClick={() => set({ rightTab: rightTab === 'chat' ? null : 'chat' })}
        iconOn={<MessageSquare size={18} />} iconOff={<span className="relative"><MessageSquare size={18} />{unread > 0 && <span className="absolute -right-2 -top-1 rounded-full bg-accent-500 px-1 text-[9px] text-white">{unread}</span>}</span>} label="Chat" />
      <Ctl on={false} onClick={() => set({ locate: { id: useStore.getState().selfId!, t: Date.now() } })} iconOn={<DoorOpen size={18} />} iconOff={<DoorOpen size={18} />} label="Find me" />
    </footer>
  );
}
