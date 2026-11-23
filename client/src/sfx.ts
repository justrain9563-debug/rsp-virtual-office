// 8-bit sound effects made with WebAudio square/triangle waves (no audio files).
let ctx: AudioContext | null = null;
const KEY = 'rsp.sfx';
export const sfxEnabled = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
export const setSfxEnabled = (on: boolean) => { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ } };

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', vol = 0.05) {
  const c = ctx!;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start); o.stop(c.currentTime + start + dur + 0.02);
}
function play(notes: [number, number, number][], type: OscillatorType = 'square', vol = 0.05) {
  if (!sfxEnabled()) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    for (const [f, s, d] of notes) tone(f, s, d, type, vol);
  } catch { /* no audio */ }
}
export const sfx = {
  join: () => play([[523, 0, 0.09], [784, 0.08, 0.14]], 'square', 0.035),
  leave: () => play([[659, 0, 0.09], [440, 0.08, 0.14]], 'square', 0.03),
  message: () => play([[880, 0, 0.06], [1175, 0.05, 0.08]], 'triangle', 0.06),
  emote: () => play([[988, 0, 0.05], [1319, 0.04, 0.07]], 'triangle', 0.04),
  ring: () => play([[784, 0, 0.12], [988, 0.12, 0.12], [784, 0.3, 0.12], [988, 0.42, 0.12]], 'square', 0.045),
  knock: () => play([[110, 0, 0.08], [110, 0.16, 0.08]], 'triangle', 0.2),
  click: () => play([[1568, 0, 0.03]], 'square', 0.02),
};
