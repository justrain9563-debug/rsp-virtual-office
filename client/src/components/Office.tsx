import { useEffect } from 'react';
import { media } from '../media/MediaManager';
import { connectSocket, disconnectSocket } from '../net/socket';
import { useStore } from '../store';
import { AdminPanel } from './AdminPanel';
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
          <Overlays />
        </main>
        {rightTab === 'chat' && <ChatPanel />}
        {rightTab === 'meeting' && <MeetingPanel />}
      </div>
      <ControlBar />
      {modal === 'devices' && <DevicesModal />}
      {modal === 'admin' && <AdminPanel />}
      {(modal === 'profile' || modal === 'avatar') && <ProfileModal />}
    </div>
  );
}
