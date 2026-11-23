// Admin build mode: change the office layout (floors, walls, furniture, doors, rooms and areas).
import { useEffect, useMemo, useState } from 'react';
import { Brush, DoorOpen, Eraser, Hammer, LayoutGrid, Save, Square, Trash2, Undo2, X } from 'lucide-react';
import { FLOORS, MAP, OBJ_DEFS, applyLayout, exportLayout, type Floor, type ObjType } from '@shared/map';
import { DEPTS } from '@shared/types';
import { bus } from '../bus';
import * as editor from '../game/editor';
import { FLOOR_BASE, renderObject } from '../game/art';
import { request, serverLayout } from '../net/socket';
import { useStore, type BuildState } from '../store';

const GROUPS: { name: string; types: ObjType[] }[] = [
  { name: 'Work', types: ['desk', 'execDesk', 'chair', 'confTable', 'roundTable', 'smallTable', 'filing', 'printer', 'bookshelf', 'kiosk', 'reception'] },
  { name: 'Lounge', types: ['couch', 'armchair', 'plant', 'bigplant', 'lamp', 'rug', 'mat', 'trash'] },
  { name: 'Kitchen', types: ['coffee', 'counter', 'fridge', 'vending', 'waterCooler'] },
  { name: 'Walls', types: ['window', 'whiteboard', 'tv', 'clock', 'logo', 'welcome', 'deptSign', 'orderBoard', 'elecPanel', 'glassDoor'] },
  { name: 'Warehouse', types: ['rack', 'pallet', 'spool', 'shipTable', 'conveyor', 'forklift', 'handTruck', 'transformer', 'dock', 'floorLine'] },
];
const NAMES: Partial<Record<ObjType, string>> = {
  execDesk: 'Manager desk', confTable: 'Meeting table', roundTable: 'Round table', smallTable: 'Side table', bigplant: 'Tall plant', waterCooler: 'Water cooler',
  deptSign: 'Dept sign', orderBoard: 'Orders board', elecPanel: 'Electrical panel', glassDoor: 'Front door', shipTable: 'Packing table', handTruck: 'Hand truck', floorLine: 'Floor line', tv: 'TV',
};
const FLOOR_NAMES: Record<string, string> = { wood: 'Wood', woodDark: 'Dark wood', carpetBlue: 'Blue carpet', carpetTeal: 'Teal carpet', carpetGray: 'Grey carpet', carpetWine: 'Wine carpet', carpetGreen: 'Green carpet', tile: 'Tile', concrete: 'Concrete', marble: 'Marble' };
const label = (t: ObjType) => NAMES[t] ?? t.charAt(0).toUpperCase() + t.slice(1);

export const DEFAULT_BUILD: BuildState = { tool: 'object', objType: 'desk', variant: 0, floor: 'carpetBlue', areaKind: 'private', areaWalls: true, dirty: false };

export function BuildPanel() {
  const b = useStore((s) => s.build);
  const set = useStore((s) => s.set);
  const version = useStore((s) => s.layoutVersion); // re-render after edits
  const [area, setArea] = useState({ name: 'New meeting room', dept: '' });
  const [pending, setPending] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const thumbs = useMemo(() => {
    const out: Partial<Record<ObjType, string>> = {};
    for (const g of GROUPS) for (const t of g.types) {
      const d = OBJ_DEFS[t];
      out[t] = renderObject({ id: 't', type: t, x: 0, y: 0, w: d.w, h: d.h, solid: d.solid, layer: d.layer, tall: d.tall ?? 0, variant: 0, ox: 0, label: t === 'deptSign' ? 'SIGN' : t === 'logo' ? 'RSP SUPPLY' : undefined }).toDataURL();
    }
    return out;
  }, []);

  // the scene reports a dragged rectangle for the area tool
  useEffect(() => bus.on('build:area', (r: { x: number; y: number; w: number; h: number }) => setPending(r)), []);

  if (!b) return null;
  const upd = (p: Partial<BuildState>) => set({ build: { ...b, ...p } });
  const bump = () => useStore.setState((s) => ({ layoutVersion: s.layoutVersion + 1, build: s.build ? { ...s.build, dirty: true } : null }));

  const exit = () => {
    if (b.dirty && !confirm('Leave build mode and throw away unsaved changes?')) return;
    if (b.dirty && serverLayout) { applyLayout(serverLayout); useStore.setState((s) => ({ layoutVersion: s.layoutVersion + 1 })); }
    editor.resetUndo();
    set({ build: null });
  };
  const save = async () => {
    setSaving(true);
    const r = await request<{ ok: boolean; error?: string }>('layout:save', { layout: exportLayout() });
    setSaving(false);
    if (!r?.ok) return useStore.getState().toast({ kind: 'warn', text: r?.error ?? 'Could not save.' });
    useStore.getState().toast({ kind: 'ok', text: 'Office layout saved. Everyone sees it now.' });
    editor.resetUndo();
    set({ build: { ...useStore.getState().build!, dirty: false } });
  };
  const reset = async () => {
    if (!confirm('Put the original RSP office layout back? This replaces the current layout for everyone.')) return;
    const r = await request<{ ok: boolean; error?: string }>('layout:save', { reset: true });
    if (!r?.ok) return useStore.getState().toast({ kind: 'warn', text: r?.error ?? 'Could not reset.' });
    editor.resetUndo();
    set({ build: { ...useStore.getState().build!, dirty: false } });
  };

  const Tool = ({ id, icon, text }: { id: BuildState['tool']; icon: React.ReactNode; text: string }) => (
    <button onClick={() => upd({ tool: id })} className={`flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] font-semibold ${b.tool === id ? 'bg-accent-500 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>{icon}{text}</button>
  );

  return (
    <aside className="flex w-[22rem] shrink-0 flex-col border-l border-white/10 bg-brand-900/95" data-testid="build-panel">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold tracking-wide text-white"><Hammer size={16} className="text-accent-400" /> Build mode</h2>
        <button className="text-slate-500 hover:text-white" onClick={exit} title="Leave build mode"><X size={16} /></button>
      </div>
      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-3">
        <div className="grid grid-cols-6 gap-1">
          <Tool id="object" icon={<LayoutGrid size={16} />} text="Items" />
          <Tool id="floor" icon={<Brush size={16} />} text="Floor" />
          <Tool id="wall" icon={<Square size={16} />} text="Wall" />
          <Tool id="door" icon={<DoorOpen size={16} />} text="Door" />
          <Tool id="area" icon={<LayoutGrid size={16} />} text="Room" />
          <Tool id="erase" icon={<Eraser size={16} />} text="Erase" />
        </div>
        <p className="rounded-lg bg-white/5 p-2 text-xs text-slate-400">
          {b.tool === 'object' && 'Click the map to place. R rotates/changes style. Right-click removes. Wall items (windows, TVs, whiteboards) go on walls.'}
          {b.tool === 'floor' && 'Click or drag to paint floor. Painting over a wall opens it up.'}
          {b.tool === 'wall' && 'Click or drag to build walls. Walls block movement and sound.'}
          {b.tool === 'door' && 'Click a wall to cut a doorway with a door. Doors into private rooms close and turn red when the room is locked; people outside can knock (X).'}
          {b.tool === 'area' && 'Set the name and type below, then drag a rectangle on the map. Private rooms are meetings: everyone inside hears each other and can lock the door.'}
          {b.tool === 'erase' && 'Click an item to remove it.'}
          {' '}Ctrl+Z undoes.
        </p>

        {b.tool === 'object' && GROUPS.map((g) => (
          <section key={g.name}>
            <h3 className="label">{g.name}</h3>
            <div className="grid grid-cols-4 gap-1.5">
              {g.types.map((t) => (
                <button key={t} onClick={() => upd({ objType: t, tool: 'object' })} title={label(t)}
                  className={`flex flex-col items-center gap-1 rounded-lg p-1.5 text-[10px] leading-tight ${b.objType === t ? 'bg-accent-500/25 ring-2 ring-accent-400' : 'bg-white/5 hover:bg-white/10'}`}>
                  <span className="flex h-10 w-full items-center justify-center"><img src={thumbs[t]} alt="" className="max-h-10 max-w-full" style={{ imageRendering: 'pixelated' }} /></span>
                  <span className="truncate text-slate-300">{label(t)}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {b.tool === 'object' && (
          <div className="flex items-center gap-2 text-xs text-slate-300">Style
            {[0, 1, 2, 3].map((v) => <button key={v} onClick={() => upd({ variant: v })} className={`h-7 w-7 rounded-md ${b.variant === v ? 'bg-accent-500 text-white' : 'bg-white/5'}`}>{v + 1}</button>)}
          </div>
        )}

        {(b.tool === 'floor' || b.tool === 'area') && (
          <section>
            <h3 className="label">Floor</h3>
            <div className="grid grid-cols-5 gap-1.5">
              {FLOORS.map((f) => (
                <button key={f} onClick={() => upd({ floor: f })} title={FLOOR_NAMES[f]} className={`h-10 rounded-md ring-2 ${b.floor === f ? 'ring-accent-400' : 'ring-transparent'}`} style={{ background: FLOOR_BASE[f as Floor] }} />
              ))}
            </div>
            <div className="mt-1 text-xs text-slate-400">{FLOOR_NAMES[b.floor]}</div>
          </section>
        )}

        {b.tool === 'area' && (
          <section className="space-y-2">
            <h3 className="label">New room or area</h3>
            <input className="input" value={area.name} onChange={(e) => setArea({ ...area, name: e.target.value })} placeholder="Name" maxLength={40} />
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/5 p-1">
              {(['private', 'open'] as const).map((k) => (
                <button key={k} onClick={() => upd({ areaKind: k })} className={`rounded-md py-1.5 text-xs font-semibold ${b.areaKind === k ? 'bg-accent-500 text-white' : 'text-slate-300'}`}>{k === 'private' ? 'Private meeting room' : 'Open area'}</button>
              ))}
            </div>
            <select className="input" value={area.dept} onChange={(e) => setArea({ ...area, dept: e.target.value })}>
              <option value="">No department</option>
              {DEPTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={b.areaWalls} onChange={(e) => upd({ areaWalls: e.target.checked })} /> Build walls around it (add a door after)</label>
          </section>
        )}

        <section>
          <h3 className="label">Rooms & areas</h3>
          <ul className="space-y-1">
            {MAP.zones.map((z) => (
              <li key={z.id + ':' + version} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5 text-xs">
                <span className={`h-2 w-2 shrink-0 rounded-full ${z.kind === 'private' ? 'bg-accent-400' : 'bg-sky-400'}`} />
                <input className="min-w-0 flex-1 bg-transparent text-slate-200 outline-none focus:text-white" defaultValue={z.name} maxLength={40}
                  onBlur={(e) => { if (e.target.value !== z.name) { editor.snapshot(); editor.updateArea(z.id, { name: e.target.value }); bump(); } }} />
                <button className="rounded px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/10" title="Switch between private room and open area"
                  onClick={() => { editor.snapshot(); editor.updateArea(z.id, { kind: z.kind === 'private' ? 'open' : 'private' }); bump(); }}>{z.kind === 'private' ? 'private' : 'open'}</button>
                <button className="text-slate-500 hover:text-red-300" title="Remove area (keeps floor and walls)" onClick={() => { editor.snapshot(); editor.removeArea(z.id); bump(); }}><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="space-y-2 border-t border-white/10 p-3">
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={() => { if (editor.undo()) bump(); }} disabled={!editor.canUndo()}><Undo2 size={15} /> Undo</button>
          <button className="btn-primary flex-[2]" onClick={save} disabled={saving || !b.dirty}><Save size={15} /> {saving ? 'Saving…' : b.dirty ? 'Save for everyone' : 'Saved'}</button>
        </div>
        <button className="w-full text-center text-[11px] text-slate-500 hover:text-slate-300" onClick={reset}>Reset to the original office layout</button>
      </div>

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="panel w-80 rounded-2xl p-4 shadow-2xl">
            <h3 className="mb-2 font-display text-lg text-white">Create “{area.name}”?</h3>
            <p className="mb-3 text-sm text-slate-300">{pending.w}×{pending.h} tiles · {b.areaKind === 'private' ? 'private meeting room' : 'open area'}{b.areaWalls ? ' · with walls' : ''}.</p>
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setPending(null)}>Cancel</button>
              <button className="btn-primary flex-1" onClick={() => {
                editor.snapshot();
                editor.addArea(pending, area.name, b.areaKind, area.dept || undefined, b.areaWalls, b.floor as Floor);
                setPending(null);
                bump();
                if (b.areaWalls) { upd({ tool: 'door', dirty: true }); useStore.getState().toast({ kind: 'info', text: 'Now click its wall to add a door.' }); }
              }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
