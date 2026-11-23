import { useEffect, useRef, useState } from 'react';
import { Shuffle } from 'lucide-react';
import { AVATAR_OPTIONS, randomAvatar, type AvatarConfig, type Dir } from '@shared/types';
import { renderAvatarPreview } from '../game/avatar';

export function AvatarCanvas({ avatar, size = 4, dir = 'down', animate = false, className = '' }: { avatar: AvatarConfig; size?: number; dir?: Dir; animate?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [f, setF] = useState(0);
  useEffect(() => {
    if (!animate) return;
    const t = setInterval(() => setF((x) => (x + 1) % 4), 160);
    return () => clearInterval(t);
  }, [animate]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.replaceChildren(renderAvatarPreview(avatar, dir, f, size));
  }, [avatar, size, dir, f]);
  return <div ref={ref} className={className} style={{ width: 16 * size, height: 24 * size }} />;
}

const LABELS: Record<string, string> = {
  short: 'Short', long: 'Long', spiky: 'Spiky', bun: 'Bun', ponytail: 'Ponytail', curly: 'Curly', mohawk: 'Mohawk', bald: 'Bald',
  none: 'None', glasses: 'Glasses', sunglasses: 'Shades', cap: 'RSP cap', hardhat: 'Hard hat', headset: 'Headset', beanie: 'Beanie', bow: 'Bow',
};

function Swatches({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-label={c}
          className={`h-6 w-6 rounded-md border-2 transition ${value === c ? 'scale-110 border-accent-400' : 'border-white/10 hover:border-white/40'}`}
          style={{ background: c }} />
      ))}
    </div>
  );
}
function Chips<T extends string>({ value, options, onChange }: { value: T; options: T[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)}
          className={`rounded-md px-2 py-1 text-xs font-medium ${value === o ? 'bg-accent-500 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
          {LABELS[o] ?? o}
        </button>
      ))}
    </div>
  );
}

export function AvatarEditor({ value, onChange }: { value: AvatarConfig; onChange: (a: AvatarConfig) => void }) {
  const [dir, setDir] = useState<Dir>('down');
  const set = (k: keyof AvatarConfig) => (v: any) => onChange({ ...value, [k]: v });
  return (
    <div className="flex flex-col gap-5 sm:flex-row">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-40 w-36 items-center justify-center rounded-xl bg-[repeating-conic-gradient(#1b4a82_0_25%,#123a6b_0_50%)] bg-[length:16px_16px] ring-1 ring-white/10">
          <AvatarCanvas avatar={value} size={5} dir={dir} animate />
        </div>
        <div className="flex gap-1">
          {(['down', 'left', 'right', 'up'] as Dir[]).map((d) => (
            <button key={d} type="button" onClick={() => setDir(d)} className={`h-7 w-7 rounded text-xs ${dir === d ? 'bg-accent-500' : 'bg-white/5 hover:bg-white/10'}`}>
              {{ down: '↓', left: '←', right: '→', up: '↑' }[d]}
            </button>
          ))}
        </div>
        <button type="button" className="btn-ghost text-xs" onClick={() => onChange(randomAvatar())}><Shuffle size={14} /> Randomize</button>
      </div>
      <div className="grid flex-1 gap-3">
        <div><span className="label">Skin tone</span><Swatches value={value.skin} options={AVATAR_OPTIONS.skin} onChange={set('skin')} /></div>
        <div><span className="label">Hair style</span><Chips value={value.hairStyle} options={AVATAR_OPTIONS.hairStyle} onChange={set('hairStyle')} /></div>
        <div><span className="label">Hair colour</span><Swatches value={value.hair} options={AVATAR_OPTIONS.hair} onChange={set('hair')} /></div>
        <div><span className="label">Shirt</span><Swatches value={value.shirt} options={AVATAR_OPTIONS.shirt} onChange={set('shirt')} /></div>
        <div><span className="label">Pants</span><Swatches value={value.pants} options={AVATAR_OPTIONS.pants} onChange={set('pants')} /></div>
        <div><span className="label">Shoes</span><Swatches value={value.shoes} options={AVATAR_OPTIONS.shoes} onChange={set('shoes')} /></div>
        <div><span className="label">Accessory</span><Chips value={value.accessory} options={AVATAR_OPTIONS.accessory} onChange={set('accessory')} /></div>
      </div>
    </div>
  );
}
