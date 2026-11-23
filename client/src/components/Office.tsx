import { useEffect } from 'react';
import { media } from '../media/MediaManager';
import { connectSocket, disconnectSocket } from '../net/socket';
import { useStore } from '../store';
import { AdminPanel } from './AdminPanel';
import { BuildPanel } from './BuildPanel';
import { MiniMap } from './MiniMap';
import { ObjectModal } from './ObjectModal';
import { PlayerCard } from './PlayerCard';
import { send } from '../net/socket';
import { ChatPanel } from './ChatPanel';
import { ControlBar } from './ControlBar';
import { DevicesModal } from './DevicesModal';
import { Directory } from './Directory';
import { GameView } from './GameView';
import { MeetingPanel } from './MeetingPanel';
import { Overlays } from './Overlays';
import { ProfileModal } from './ProfileModal';
import { TopBar } from './TopBar';
import { VideoDock } from './VideoDock';

export function Office() {
  const leftOpen = useStore((s) => s.leftOpen);
  const rightTab = useStore((s) => s.rightTab);
  const modal = useStore((s) => s.modal);
  const selfId = useStore((s) => s.selfId);
  const build = useStore((s) => !!s.build);
  const openObject = useStore((s) => s.openObject);

  // auto-away: 10 minutes without input and not in a conversation → Away; back on activity
  useEffect(() => {
    let last = Date.now(), auto = false;
    const active = () => {
      last = Date.now();
      const st = useStore.getState();
      const me = st.selfId ? st.players[st.selfId] : null;
      if (auto && me?.status === 'away') { send('status', 'available'); st.setStatus('available'); }
      auto = false;
    };
    const evs = ['keydown', 'pointermove', 'pointerdown', 'wheel'];
    evs.forEach((e) => window.addEventListener(e, active, { passive: true }));
    const t = window.setInterval(() => {
      const st = useStore.getState();
      const me = st.selfId ? st.players[st.selfId] : null;
      if (!me || auto || me.status !== 'available' || Object.keys(st.peers).length) return;
      if (Date.now() - last > 10 * 60_000) { auto = true; send('status', 'away'); st.setStatus('away'); }
    }, 30_000);
    return () => { evs.forEach((e) => window.removeEventListener(e, active)); clearInterval(t); };
  }, []);

  useEffect(() => {
    media.init();
    connectSocket();
    const unlock = () => media.resumeAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => { disconnectSocket(); media.shutdown(); window.removeEventListener('pointerdown', unlock); };
  }, []);

  return (
    <div className="flex h-full flex-col bg-brand-950">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {leftOpen && <Directory />}
        <main className="relative min-w-0 flex-1 overflow-hidden">
          {selfId ? <GameView /> : <div className="flex h-full items-center justify-center text-sm text-slate-400">Connecting to the office…</div>}
          <VideoDock />
          <MiniMap />
          <PlayerCard />
          <Overlays />
        </main>
        {build ? <BuildPanel /> : <>
          {rightTab === 'chat' && <ChatPanel />}
          {rightTab === 'meeting' && <MeetingPanel />}
        </>}
      </div>
      <ControlBar />
      {openObject && <ObjectModal />}
      {modal === 'devices' && <DevicesModal />}
      {modal === 'admin' && <AdminPanel />}
      {(modal === 'profile' || modal === 'avatar') && <ProfileModal />}
    </div>
  );
}
