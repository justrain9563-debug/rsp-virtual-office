import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { media } from '../media/MediaManager';
import { askNotificationPermission } from '../notify';
import { useStore } from '../store';
import { Modal } from './Overlays';

export function DevicesModal() {
  const set = useStore((s) => s.set);
  const localCam = useStore((s) => s.localCam);
  const mic = useStore((s) => s.mic);
  const localSpeaking = useStore((s) => s.localSpeaking);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [chosen, setChosen] = useState({ ...media.devices });
  const videoRef = useRef<HTMLVideoElement>(null);

  const refresh = () => media.listDevices().then(setDevices);
  useEffect(() => { refresh(); }, [mic, localCam]);
  useEffect(() => { if (videoRef.current) videoRef.current.srcObject = localCam; }, [localCam]);

  const pick = (kind: 'audioIn' | 'videoIn' | 'audioOut', id: string) => {
    setChosen((c) => ({ ...c, [kind]: id }));
    media.chooseDevice(kind, id);
  };
  const list = (k: MediaDeviceKind) => devices.filter((d) => d.kind === k);
  const unlabeled = devices.length > 0 && devices.every((d) => !d.label);
  const sinkSupported = 'setSinkId' in HTMLMediaElement.prototype;

  const Select = ({ kind, k, label }: { kind: 'audioIn' | 'videoIn' | 'audioOut'; k: MediaDeviceKind; label: string }) => (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={chosen[kind] ?? ''} onChange={(e) => pick(kind, e.target.value)}>
        <option value="">System default</option>
        {list(k).map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${label} ${i + 1}`}</option>)}
      </select>
    </div>
  );

  return (
    <Modal title="Audio, video & notifications" onClose={() => set({ modal: null })}>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-4">
          {unlabeled && <p className="rounded-lg bg-white/5 p-2 text-xs text-slate-400">Turn on your mic or camera once so the browser shows device names.</p>}
          <Select kind="audioIn" k="audioinput" label="Microphone" />
          <Select kind="videoIn" k="videoinput" label="Camera" />
          {sinkSupported ? <Select kind="audioOut" k="audiooutput" label="Speakers" /> : <p className="text-xs text-slate-500">This browser can't choose speakers; it uses the system default.</p>}
          <div>
            <span className="label">Mic level</span>
            <div className="h-2 overflow-hidden rounded bg-white/10"><div className={`h-full bg-emerald-400 transition-all ${localSpeaking ? 'w-3/4' : mic ? 'w-[6%]' : 'w-0'}`} /></div>
          </div>
          <button className="btn-ghost w-full" onClick={askNotificationPermission}><Bell size={14} /> Enable desktop notifications</button>
        </div>
        <div>
          <span className="label">Camera preview</span>
          <div className="aspect-video overflow-hidden rounded-xl bg-black/50 ring-1 ring-white/10">
            {localCam ? <video ref={videoRef} autoPlay muted playsInline className="video-mirror h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-slate-500">Camera is off</div>}
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn-ghost flex-1" onClick={() => media.setMic(!mic)}>{mic ? 'Turn mic off' : 'Turn mic on'}</button>
            <button className="btn-ghost flex-1" onClick={() => media.setCam(!localCam)}>{localCam ? 'Turn camera off' : 'Turn camera on'}</button>
          </div>
          <p className="mt-3 text-xs text-slate-500">Your mic and camera are only sent to people standing near you or in the same meeting room. Nothing is recorded.</p>
        </div>
      </div>
    </Modal>
  );
}
