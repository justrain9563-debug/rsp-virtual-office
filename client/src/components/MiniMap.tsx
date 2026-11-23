// Mini-map: the whole office with everyone on it. Click to walk there. Toggle with M.
import { useEffect, useRef } from 'react';
import { Map as MapIcon, X } from 'lucide-react';
import { MAP, MAP_H, MAP_W, TILE } from '@shared/map';
import { statusInfo } from '@shared/types';
import { FLOOR_BASE } from '../game/art';
import { positions, useStore } from '../store';

const S = 4; // px per tile

export function MiniMap() {
  const open = useStore((s) => s.minimap);
  const version = useStore((s) => s.layoutVersion);
  const build = useStore((s) => !!s.build);
  const set = useStore((s) => s.set);
  const base = useRef<HTMLCanvasElement | null>(null);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = document.createElement('canvas');
    c.width = MAP_W * S; c.height = MAP_H * S;
    const g = c.getContext('2d')!;
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++) {
        g.fillStyle = MAP.wall[y][x] ? '#1c2434' : FLOOR_BASE[MAP.floor[y][x]];
        g.fillRect(x * S, y * S, S, S);
      }
    g.globalAlpha = 0.55;
    for (const o of MAP.objects) if (o.layer === 'normal' && o.type !== 'chair') { g.fillStyle = '#3b2f2a'; g.fillRect(o.x * S + 1, o.y * S + 1, o.w * S - 2, o.h * S - 2); }
    g.globalAlpha = 1;
    for (const z of MAP.zones) if (z.kind === 'private') { g.strokeStyle = 'rgba(242,107,29,.8)'; g.strokeRect(z.rect.x * S + 0.5, z.rect.y * S + 0.5, z.rect.w * S - 1, z.rect.h * S - 1); }
    base.current = c;
  }, [version]);

  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => {
      const c = ref.current, b = base.current;
      if (!c || !b) return;
      const g = c.getContext('2d')!;
      g.drawImage(b, 0, 0);
      const { players, selfId } = useStore.getState();
      for (const p of Object.values(players)) {
        const pos = positions.get(p.id) ?? p;
        const x = (pos.x / TILE) * S, y = (pos.y / TILE) * S;
        g.fillStyle = p.id === selfId ? '#ffffff' : statusInfo(p.status).color;
        g.beginPath(); g.arc(x, y, p.id === selfId ? 3.5 : 2.6, 0, Math.PI * 2); g.fill();
        if (p.id === selfId) { g.strokeStyle = '#f26b1d'; g.lineWidth = 1.5; g.stroke(); }
      }
    }, 200);
    return () => clearInterval(t);
  }, [open, version]);

  if (build) return null;
  if (!open) {
    return (
      <button className="absolute right-3 top-3 z-20 rounded-xl bg-brand-900/90 p-2 text-slate-200 shadow-lg ring-1 ring-white/10 hover:bg-brand-800" onClick={() => set({ minimap: true })} title="Show map (M)">
        <MapIcon size={18} />
      </button>
    );
  }
  return (
    <div className="absolute right-3 top-3 z-20 rounded-xl bg-brand-900/90 p-1.5 shadow-xl ring-1 ring-white/10 backdrop-blur" data-testid="minimap">
      <div className="mb-1 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <span className="font-display normal-case tracking-normal text-slate-200">Office map</span>
        <button onClick={() => { set({ minimap: false }); try { localStorage.setItem('rsp.minimap', '0'); } catch { /* ignore */ } }} title="Hide (M)"><X size={12} /></button>
      </div>
      <canvas ref={ref} width={MAP_W * S} height={MAP_H * S} className="block w-[200px] cursor-pointer rounded-md sm:w-[240px]" style={{ imageRendering: 'pixelated' }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = Math.floor(((e.clientX - r.left) / r.width) * MAP_W), y = Math.floor(((e.clientY - r.top) / r.height) * MAP_H);
          set({ walkTile: { x, y, t: Date.now() } });
        }} />
    </div>
  );
}
