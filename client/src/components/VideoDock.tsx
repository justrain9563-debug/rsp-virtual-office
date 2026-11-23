import { useEffect, useRef } from 'react';
import { Lock, LockOpen, Maximize2, MicOff, Minimize2, MonitorUp, Volume2 } from 'lucide-react';
import { send } from '../net/socket';
import type { AvatarConfig } from '@shared/types';
import { useStore, type RemotePeer } from '../store';
import { AvatarCanvas } from './AvatarEditor';
import { zoneName } from './TopBar';

function Video({ stream, mirror = false, contain = false }: { stream: MediaStream; mirror?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (v && v.srcObject !== stream) { v.srcObject = stream; v.play().catch(() => {}); }
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={`h-full w-full ${contain ? 'object-contain' : 'object-cover'} ${mirror ? 'video-mirror' : ''}`} />;
}

const STATE_COLOR: Record<string, string> = { connected: 'bg-emerald-400', connecting: 'bg-amber-400', new: 'bg-amber-400', disconnected: 'bg-orange-500', failed: 'bg-red-500', closed: 'bg-slate-500' };

function Tile({ name, avatar, stream, mic, speaking, peer, self, big, hand }: {
  name: string; avatar?: AvatarConfig; stream: MediaStream | null; mic: boolean; speaking: boolean; peer?: RemotePeer; self?: boolean; big?: boolean; hand?: boolean;
}) {
  const fade = peer && peer.mode === 'proximity' ? 0.45 + 0.55 * peer.volume : 1;
  return (
    <div data-testid={self ? 'tile-self' : 'tile-peer'} data-peer={peer?.id} data-state={peer?.state}
      className={`relative overflow-hidden rounded-xl bg-brand-800 shadow-lg ring-2 transition-[opacity,box-shadow] duration-300 ${speaking ? 'ring-emerald-400' : 'ring-white/10'} ${big ? 'aspect-video w-full' : 'h-[120px] w-[160px]'}`}
      style={{ opacity: fade }}>
      {stream ? <Video stream={stream} mirror={self} /> : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-brand-700 to-brand-900">
          {avatar && <AvatarCanvas avatar={avatar} size={big ? 5 : 3} />}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-4 text-xs font-semibold text-white">
        {peer && <span className={`h-2 w-2 rounded-full ${STATE_COLOR[peer.state] ?? 'bg-slate-400'}`} title={`Connection: ${peer.state}`} />}
        <span className="truncate">{peer?.mode === 'spotlight' && '📢 '}{name}{self && ' (you)'}{hand && ' ✋'}</span>
        <span className="flex-1" />
        {!mic && <MicOff size={13} className="text-red-400" />}
        {peer && peer.mode === 'proximity' && mic && (
          <span className="flex items-center gap-0.5 text-[10px] text-slate-300" title="Volume from distance"><Volume2 size={11} />{Math.round(peer.volume * 100)}%</span>
        )}
      </div>
    </div>
  );
}

export function VideoDock() {
  const peers = useStore((s) => s.peers);
  const players = useStore((s) => s.players);
  const selfId = useStore((s) => s.selfId);
  const localCam = useStore((s) => s.localCam);
  const localScreen = useStore((s) => s.localScreen);
  const mic = useStore((s) => s.mic);
  const localSpeaking = useStore((s) => s.localSpeaking);
  const expanded = useStore((s) => s.expanded);
  const set = useStore((s) => s.set);
  const me = selfId ? players[selfId] : null;

  const list = Object.values(peers).filter((p) => players[p.id] && p.mode !== 'audience');
  const proximity = list.some((p) => p.mode === 'proximity');
  if (!list.length && !localCam) return null;
  const inRoom = me?.zone?.startsWith('room:');
  const screens = list.filter((p) => players[p.id]?.screen && p.screen);

  const tiles = (big: boolean) => (
    <>
      <Tile self big={big} name={me?.name ?? 'You'} avatar={me?.avatar} stream={localCam} mic={mic} speaking={localSpeaking} hand={me?.hand} />
      {list.map((p) => {
        const pl = players[p.id];
        return <Tile key={p.id} big={big} name={pl.name} avatar={pl.avatar} stream={pl.cam ? p.cam : null} mic={pl.mic} speaking={p.speaking} peer={p} hand={pl.hand} />;
      })}
    </>
  );

  if (expanded) {
    return (
      <div className="absolute inset-0 z-30 flex flex-col bg-brand-950/80 p-4 backdrop-blur-sm">
        <div className="mb-3 flex items-center gap-3">
          <h3 className="font-display font-semibold tracking-wide text-white">{inRoom ? zoneName(me?.zone) : 'Nearby conversation'}</h3>
          <span className="text-sm text-slate-400">{list.length + 1} people</span>
          <span className="flex-1" />
          <button className="btn-ghost" onClick={() => set({ expanded: false })}><Minimize2 size={16} /> Back to office</button>
        </div>
        <div className="scroll-thin flex min-h-0 flex-1 gap-4 overflow-auto">
          {(screens.length > 0 || localScreen) && (
            <div className="flex min-w-0 flex-[2] flex-col gap-3">
              {localScreen && <ScreenTile name="Your screen" stream={localScreen} />}
              {screens.map((p) => <ScreenTile key={p.id} name={`${players[p.id].name}'s screen`} stream={p.screen!} />)}
            </div>
          )}
          <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">{tiles(true)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-col items-center gap-2 px-3">
      <div className="pointer-events-auto flex max-w-full items-start gap-2 overflow-x-auto rounded-2xl bg-brand-950/40 p-2 backdrop-blur-sm" data-testid="video-dock">
        {tiles(false)}
        <div className="flex flex-col gap-1">
          <button className="btn-ghost h-9 w-9 p-0" title="Expand meeting view" onClick={() => set({ expanded: true })}><Maximize2 size={16} /></button>
          {proximity && !inRoom && (
            <button className={`h-9 w-9 p-0 ${me?.bubble ? 'btn-primary' : 'btn-ghost'}`} data-testid="btn-convo-lock"
              title={me?.bubble ? 'Unlock conversation' : 'Lock conversation: people walking by cannot join'} onClick={() => send('convo:lock', !me?.bubble)}>
              {me?.bubble ? <Lock size={16} /> : <LockOpen size={16} />}
            </button>
          )}
        </div>
      </div>
      {screens.length > 0 && (
        <button className="pointer-events-auto rounded-full bg-accent-500 px-3 py-1 text-xs font-semibold text-white shadow-lg" onClick={() => set({ expanded: true })}>
          <MonitorUp size={12} className="mr-1 inline" /> {players[screens[0].id].name} is sharing their screen. Open
        </button>
      )}
    </div>
  );
}

function ScreenTile({ name, stream }: { name: string; stream: MediaStream }) {
  return (
    <div className="relative min-h-[240px] flex-1 overflow-hidden rounded-xl bg-black ring-1 ring-white/10" data-testid="screen-tile">
      <Video stream={stream} contain />
      <div className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-semibold">{name}</div>
    </div>
  );
}
