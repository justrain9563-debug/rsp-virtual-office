// Proximity audio/video over WebRTC.
//
// The server decides who is in a conversation (`peers` events) and only relays
// signaling between those pairs. For each linked pair we open one
// RTCPeerConnection with three fixed transceivers: [0] mic, [1] camera, [2] screen.
// Because the transceivers are fixed, turning devices on/off is a replaceTrack()
// with no renegotiation. The peer with the smaller id always makes the offer, so
// offers never collide ("glare"). Each connection has a session id (sid) so stale
// messages from an earlier connection between the same two people are ignored.
//
// Volume is applied locally every 100ms from the two avatars' distance, so voices
// get louder/quieter smoothly as people walk; in private rooms everyone is at full volume.
import { tileDistance, volumeForDistance } from '@shared/proximity';
import type { PeerLink, PeerMode } from '@shared/types';
import { send } from '../net/socket';
import { positions, useStore } from '../store';

interface Peer {
  id: string;
  sid: string;
  offerer: boolean;
  pc: RTCPeerConnection;
  mode: PeerMode;
  audioEl: HTMLAudioElement;
  pendingIce: RTCIceCandidateInit[];
  gain: number;
  analyser: AnalyserNode | null;
  restarts: number;
  discTimer: number | null;
  closed: boolean;
}

const DEVICE_KEY = 'rsp.devices';
const loadDevices = () => {
  try { return JSON.parse(localStorage.getItem(DEVICE_KEY) || '{}'); } catch { return {}; }
};

class MediaManager {
  iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  micTrack: MediaStreamTrack | null = null;
  camTrack: MediaStreamTrack | null = null;
  screenTrack: MediaStreamTrack | null = null;
  peers = new Map<string, Peer>();
  ctx: AudioContext | null = null;
  localAnalyser: AnalyserNode | null = null;
  devices: { audioIn?: string; videoIn?: string; audioOut?: string } = loadDevices();
  holder: HTMLDivElement | null = null;
  private loop: number | null = null;

  private get st() { return useStore.getState(); }

  async init() {
    try {
      const r = await fetch('/api/ice');
      if (r.ok) this.iceServers = (await r.json()).iceServers;
    } catch { /* keep default STUN */ }
    if (!this.holder) {
      this.holder = document.createElement('div');
      this.holder.style.display = 'none';
      document.body.appendChild(this.holder);
    }
    if (this.loop === null) this.loop = window.setInterval(() => this.tick(), 100);
  }

  private audioCtx() {
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { return null; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private analyserFor(track: MediaStreamTrack) {
    const ctx = this.audioCtx();
    if (!ctx) return null;
    try {
      const src = ctx.createMediaStreamSource(new MediaStream([track]));
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      return an;
    } catch { return null; }
  }

  private level(an: AnalyserNode | null) {
    if (!an) return 0;
    const buf = new Uint8Array(an.fftSize);
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += (v - 128) * (v - 128);
    return Math.sqrt(sum / buf.length) / 128;
  }

  // ------------------------------------------------------------ local devices

  private publishMediaState() {
    const { mic, cam, screen } = this.st;
    send('media', { mic, cam, screen });
  }

  async setMic(on: boolean) {
    if (on && !this.micTrack) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: this.devices.audioIn ? { ideal: this.devices.audioIn } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        this.micTrack = s.getAudioTracks()[0];
        this.micTrack.onended = () => this.setMic(false);
        this.localAnalyser = this.analyserFor(this.micTrack);
      } catch (e) {
        this.deviceError('microphone', e);
        return;
      }
    } else if (!on && this.micTrack) {
      this.micTrack.stop();
      this.micTrack = null;
      this.localAnalyser = null;
    }
    this.st.set({ mic: !!this.micTrack });
    this.attachAll();
    this.publishMediaState();
  }

  async setCam(on: boolean) {
    if (on && !this.camTrack) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: this.devices.videoIn ? { ideal: this.devices.videoIn } : undefined, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 20, max: 24 } },
        });
        this.camTrack = s.getVideoTracks()[0];
        this.camTrack.onended = () => this.setCam(false);
      } catch (e) {
        this.deviceError('camera', e);
        return;
      }
    } else if (!on && this.camTrack) {
      this.camTrack.stop();
      this.camTrack = null;
    }
    this.st.set({ cam: !!this.camTrack, localCam: this.camTrack ? new MediaStream([this.camTrack]) : null });
    this.attachAll();
    this.publishMediaState();
  }

  async setScreen(on: boolean) {
    if (on && !this.screenTrack) {
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 12, max: 15 } }, audio: false });
        this.screenTrack = s.getVideoTracks()[0];
        this.screenTrack.contentHint = 'detail';
        this.screenTrack.onended = () => this.setScreen(false);
      } catch (e: any) {
        if (e?.name !== 'NotAllowedError') this.deviceError('screen', e);
        return;
      }
    } else if (!on && this.screenTrack) {
      this.screenTrack.stop();
      this.screenTrack = null;
    }
    this.st.set({ screen: !!this.screenTrack, localScreen: this.screenTrack ? new MediaStream([this.screenTrack]) : null });
    this.attachAll();
    this.publishMediaState();
  }

  private deviceError(what: string, e: any) {
    const name = e?.name ?? '';
    const text =
      name === 'NotAllowedError' ? `Your browser blocked the ${what}. Click the camera/lock icon in the address bar to allow it.`
      : name === 'NotFoundError' ? `No ${what} was found.`
      : name === 'NotReadableError' ? `The ${what} is in use by another app.`
      : !window.isSecureContext ? `The ${what} needs HTTPS (or localhost).`
      : `Couldn't start the ${what}: ${e?.message ?? e}`;
    this.st.toast({ kind: 'warn', text, ttl: 8000 });
  }

  async listDevices() {
    try { return await navigator.mediaDevices.enumerateDevices(); } catch { return []; }
  }

  async chooseDevice(kind: 'audioIn' | 'videoIn' | 'audioOut', id: string) {
    this.devices[kind] = id;
    try { localStorage.setItem(DEVICE_KEY, JSON.stringify(this.devices)); } catch { /* ignore */ }
    if (kind === 'audioOut') { for (const p of this.peers.values()) this.applySink(p.audioEl); return; }
    if (kind === 'audioIn' && this.micTrack) { await this.setMic(false); await this.setMic(true); }
    if (kind === 'videoIn' && this.camTrack) { await this.setCam(false); await this.setCam(true); }
  }

  private applySink(el: HTMLAudioElement) {
    const id = this.devices.audioOut;
    if (id && 'setSinkId' in el) (el as any).setSinkId(id).catch(() => {});
  }

  /** Called after a user gesture if the browser blocked autoplay. */
  resumeAudio() {
    this.audioCtx();
    for (const p of this.peers.values()) p.audioEl.play().catch(() => {});
    this.st.set({ audioBlocked: false });
  }

  // ------------------------------------------------------------ peers

  setPeers(list: PeerLink[]) {
    const want = new Map(list.map((l) => [l.id, l.mode]));
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.closePeer(id);
    for (const [id, mode] of want) {
      const p = this.peers.get(id);
      if (p) { p.mode = mode; this.st.setPeer(id, { mode }); }
      else this.createPeer(id, mode);
    }
  }

  private createPeer(id: string, mode: PeerMode, sid?: string): Peer {
    const selfId = this.st.selfId!;
    const offerer = selfId < id;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.volume = 0;
    this.applySink(audioEl);
    this.holder?.appendChild(audioEl);
    const peer: Peer = {
      id, sid: sid ?? (offerer ? Math.random().toString(36).slice(2) : ''), offerer, pc, mode, audioEl,
      pendingIce: [], gain: 0, analyser: null, restarts: 0, discTimer: null, closed: false,
    };
    this.peers.set(id, peer);
    this.st.setPeer(id, { mode, state: 'new', cam: null, screen: null, volume: 0, speaking: false });

    pc.onicecandidate = (e) => {
      if (e.candidate) send('signal', { to: id, data: { sid: peer.sid, candidate: e.candidate.toJSON() } });
    };
    pc.ontrack = (e) => this.onTrack(peer, e);
    pc.onconnectionstatechange = () => this.onState(peer);

    if (offerer) {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
      this.attach(peer);
      this.makeOffer(peer, false);
    }
    return peer;
  }

  private async makeOffer(peer: Peer, iceRestart: boolean) {
    try {
      const offer = await peer.pc.createOffer({ iceRestart });
      if (peer.closed) return;
      await peer.pc.setLocalDescription(offer);
      send('signal', { to: peer.id, data: { sid: peer.sid, sdp: peer.pc.localDescription } });
    } catch (e) { console.warn('[media] offer failed', e); }
  }

  async onSignal(from: string, data: any) {
    if (!data || typeof data.sid !== 'string') return;
    let peer = this.peers.get(from);
    try {
      if (data.sdp?.type === 'offer') {
        if (peer && peer.offerer) return; // we are the offerer for this pair; ignore
        if (peer && peer.sid && peer.sid !== data.sid) { const mode = peer.mode; this.closePeer(from, true); peer = this.createPeer(from, mode, data.sid); }
        if (!peer) peer = this.createPeer(from, 'proximity', data.sid);
        peer.sid = data.sid;
        await peer.pc.setRemoteDescription(data.sdp);
        for (const t of peer.pc.getTransceivers()) t.direction = 'sendrecv';
        this.attach(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        send('signal', { to: from, data: { sid: peer.sid, sdp: peer.pc.localDescription } });
        await this.flushIce(peer);
      } else if (data.sdp?.type === 'answer') {
        if (!peer || peer.sid !== data.sid || peer.pc.signalingState !== 'have-local-offer') return;
        await peer.pc.setRemoteDescription(data.sdp);
        await this.flushIce(peer);
        this.applyBitrates(peer);
      } else if (data.candidate) {
        if (!peer || peer.sid !== data.sid) return;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
        else peer.pendingIce.push(data.candidate);
      }
    } catch (e) { console.warn('[media] signal error', e); }
  }

  private async flushIce(peer: Peer) {
    const list = peer.pendingIce.splice(0);
    for (const c of list) await peer.pc.addIceCandidate(c).catch(() => {});
  }

  private onTrack(peer: Peer, e: RTCTrackEvent) {
    const idx = peer.pc.getTransceivers().indexOf(e.transceiver);
    const stream = new MediaStream([e.track]);
    if (idx === 0) {
      peer.audioEl.srcObject = stream;
      peer.audioEl.play().catch(() => this.st.set({ audioBlocked: true }));
      peer.analyser = this.analyserFor(e.track);
    } else if (idx === 1) this.st.setPeer(peer.id, { cam: stream });
    else if (idx === 2) this.st.setPeer(peer.id, { screen: stream });
  }

  private onState(peer: Peer) {
    const s = peer.pc.connectionState;
    this.st.setPeer(peer.id, { state: s });
    if (s === 'connected') {
      peer.restarts = 0;
      if (peer.discTimer) { clearTimeout(peer.discTimer); peer.discTimer = null; }
      this.applyBitrates(peer);
    }
    if (!peer.offerer || peer.closed) return;
    if (s === 'failed') this.recover(peer);
    if (s === 'disconnected' && !peer.discTimer) {
      peer.discTimer = window.setTimeout(() => {
        peer.discTimer = null;
        if (peer.pc.connectionState === 'disconnected') this.recover(peer);
      }, 4000);
    }
  }

  /** ICE restart a couple of times, then rebuild the connection from scratch. */
  private recover(peer: Peer) {
    peer.restarts++;
    if (peer.restarts <= 2) {
      peer.pc.restartIce();
      this.makeOffer(peer, true);
    } else {
      const { id, mode } = peer;
      this.closePeer(id, true);
      this.createPeer(id, mode);
    }
  }

  private attach(peer: Peer) {
    const trs = peer.pc.getTransceivers();
    if (trs.length < 3) return;
    trs[0].sender.replaceTrack(this.micTrack).catch(() => {});
    trs[1].sender.replaceTrack(this.camTrack).catch(() => {});
    trs[2].sender.replaceTrack(this.screenTrack).catch(() => {});
  }

  private attachAll() {
    for (const p of this.peers.values()) this.attach(p);
  }

  private applyBitrates(peer: Peer) {
    const trs = peer.pc.getTransceivers();
    const set = async (i: number, maxBitrate: number) => {
      const sender = trs[i]?.sender;
      if (!sender) return;
      const params = sender.getParameters();
      if (!params.encodings?.length) return;
      params.encodings[0].maxBitrate = maxBitrate;
      await sender.setParameters(params).catch(() => {});
    };
    set(1, 450_000);
    set(2, 1_500_000);
  }

  private closePeer(id: string, keepStore = false) {
    const p = this.peers.get(id);
    if (!p) return;
    p.closed = true;
    if (p.discTimer) clearTimeout(p.discTimer);
    try { p.pc.close(); } catch { /* ignore */ }
    p.audioEl.srcObject = null;
    p.audioEl.remove();
    this.peers.delete(id);
    if (!keepStore) this.st.setPeer(id, null);
  }

  // ------------------------------------------------------------ volume + speaking loop

  private tick() {
    const st = this.st;
    const self = st.selfId ? positions.get(st.selfId) : null;
    const cfg = st.settings?.proximity;
    const master = st.masterVolume;
    for (const p of this.peers.values()) {
      const other = positions.get(p.id);
      let target = 0;
      if (p.mode === 'room') target = 1;
      else if (self && other && cfg) target = volumeForDistance(tileDistance(self, other), cfg);
      p.gain += (target - p.gain) * 0.35;
      if (Math.abs(target - p.gain) < 0.01) p.gain = target;
      p.audioEl.volume = Math.max(0, Math.min(1, p.gain * master));
      const remoteMic = st.players[p.id]?.mic;
      const speaking = !!remoteMic && this.level(p.analyser) > 0.04;
      const prev = st.peers[p.id];
      if (prev && (Math.abs(prev.volume - p.gain) > 0.02 || prev.speaking !== speaking)) st.setPeer(p.id, { volume: p.gain, speaking });
    }
    const localSpeaking = !!this.micTrack && this.level(this.localAnalyser) > 0.04;
    if (localSpeaking !== st.localSpeaking) st.set({ localSpeaking });
  }

  shutdown() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.micTrack?.stop(); this.camTrack?.stop(); this.screenTrack?.stop();
    this.micTrack = this.camTrack = this.screenTrack = null;
    this.st.set({ mic: false, cam: false, screen: false, localCam: null, localScreen: null, peers: {} });
  }
}

export const media = new MediaManager();
(window as any).__rsp = { media, store: useStore, positions };
