import { useState } from 'react';
import { Footprints, Lock, Volume2, X } from 'lucide-react';
import { media } from '../media/MediaManager';
import { useStore } from '../store';
import { zoneName } from './TopBar';

export function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`panel flex max-h-[90vh] w-full flex-col rounded-2xl shadow-2xl ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="font-bold text-white">{title}</h2>
          <button className="text-slate-400 hover:text-white" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="scroll-thin overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Overlays() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismiss);
  const hint = useStore((s) => s.hint);
  const audioBlocked = useStore((s) => s.audioBlocked);
  const me = useStore((s) => (s.selfId ? s.players[s.selfId] : null));
  const rooms = useStore((s) => s.rooms);
  const peerCount = useStore((s) => Object.keys(s.peers).length);
  const mic = useStore((s) => s.mic);
  const cam = useStore((s) => s.cam);
  const set = useStore((s) => s.set);
  const [helpHidden, setHelpHidden] = useState(() => { try { return localStorage.getItem('rsp.help') === '1'; } catch { return false; } });
  const roomId = me?.zone?.startsWith('room:') ? me.zone.slice(5) : null;

  return (
    <>
      {/* toasts */}
      <div className="pointer-events-none absolute bottom-4 right-4 z-40 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-xl px-4 py-3 text-sm shadow-xl ring-1 ${
            t.kind === 'warn' ? 'bg-amber-950/95 text-amber-100 ring-amber-500/30' : t.kind === 'wave' ? 'bg-accent-600/95 text-white ring-accent-300/40' : 'bg-brand-800/95 text-slate-100 ring-white/10'}`}>
            <div className="flex gap-2">
              <span className="flex-1">{t.text}</span>
              <button onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100"><X size={14} /></button>
            </div>
            {t.kind === 'wave' && t.from && (
              <div className="mt-2 flex gap-2">
                <button className="rounded-lg bg-white/20 px-2 py-1 text-xs font-semibold hover:bg-white/30" onClick={() => { set({ walkTo: { id: t.from!, t: Date.now() } }); dismiss(t.id); }}>
                  <Footprints size={12} className="mr-1 inline" />Walk over
                </button>
                <button className="rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/20" onClick={() => set({ locate: { id: t.from!, t: Date.now() } })}>Locate</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* private room banner */}
      {roomId && (
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-xl bg-brand-900/90 px-4 py-2 text-sm shadow-lg ring-1 ring-accent-500/40" data-testid="room-banner">
          {rooms[roomId]?.locked ? <Lock size={14} className="text-red-400" /> : <span className="h-2 w-2 rounded-full bg-accent-400" />}
          <span><b>{zoneName(me?.zone)}</b>: private. Only people in this room can hear you.</span>
        </div>
      )}

      {/* interaction hint */}
      {hint && !roomId && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-xs font-medium text-white">{hint}</div>
      )}

      {/* nudge to turn on devices while in a conversation */}
      {peerCount > 0 && !mic && !cam && (
        <div className="absolute left-1/2 top-[160px] z-20 -translate-x-1/2 whitespace-nowrap rounded-xl bg-brand-900/95 px-4 py-2 text-xs text-slate-200 shadow-lg ring-1 ring-white/10">
          You're near {peerCount === 1 ? 'someone' : `${peerCount} people`}. Turn on your mic or camera below to join in.
        </div>
      )}

      {audioBlocked && (
        <button className="absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-accent-500 px-6 py-4 font-semibold text-white shadow-2xl" onClick={() => media.resumeAudio()}>
          <Volume2 className="mr-2 inline" /> Click to enable sound
        </button>
      )}

      {!helpHidden && (
        <div className="absolute bottom-4 left-4 z-10 max-w-xs rounded-xl bg-brand-900/90 p-3 text-xs text-slate-300 shadow-lg ring-1 ring-white/10">
          <div className="mb-1 flex items-center justify-between font-semibold text-white">How it works
            <button onClick={() => { setHelpHidden(true); try { localStorage.setItem('rsp.help', '1'); } catch { /* ignore */ } }}><X size={14} /></button>
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            <li><b>WASD</b> / arrow keys to walk, or click a spot</li>
            <li>Walk within ~5 tiles of someone to talk. Closer is louder</li>
            <li>Rooms with labels are private meetings</li>
            <li><b>E</b> at an empty desk to claim it</li>
            <li>Mouse wheel to zoom</li>
          </ul>
        </div>
      )}
    </>
  );
}
