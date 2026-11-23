// Windows for interactive objects: shared whiteboard, TV (website / video embed), sticky-note boards.
import { useEffect, useRef, useState } from 'react';
import { Eraser, ExternalLink, Pencil, Plus, Trash2, X } from 'lucide-react';
import { MAP } from '@shared/map';
import type { StickyNote, Stroke } from '@shared/types';
import { bus } from '../bus';
import { request, send } from '../net/socket';
import { useStore } from '../store';
import { Modal } from './Overlays';

interface Opened { ok: boolean; error?: string; type: string; strokes: Stroke[]; notes: StickyNote[]; embed: string }

const TITLES: Record<string, string> = { whiteboard: 'Whiteboard', tv: 'TV screen', orderBoard: 'Orders board', bookshelf: 'Team bulletin' };

export function ObjectModal() {
  const id = useStore((s) => s.openObject);
  const set = useStore((s) => s.set);
  const [data, setData] = useState<Opened | null>(null);
  const obj = MAP.objects.find((o) => o.id === id);

  useEffect(() => {
    if (!id) return;
    setData(null);
    request<Opened>('obj:open', { id }).then((r) => {
      if (!r?.ok) { useStore.getState().toast({ kind: 'warn', text: r?.error ?? 'Could not open that.' }); set({ openObject: null }); return; }
      setData(r);
    });
    return () => { send('obj:close', { id }); };
  }, [id]);

  if (!id || !obj) return null;
  const close = () => set({ openObject: null });
  const title = TITLES[obj.type] ?? 'Object';
  return (
    <Modal title={title} onClose={close} wide>
      {!data ? <div className="py-16 text-center text-sm text-slate-400">Opening…</div>
        : obj.type === 'whiteboard' ? <Whiteboard id={id} initial={data.strokes} />
        : obj.type === 'tv' ? <Tv id={id} initial={data.embed} />
        : <Notes id={id} initial={data.notes} kind={obj.type} />}
    </Modal>
  );
}

// ------------------------------------------------------------------ whiteboard

const PENS = ['#111827', '#2563eb', '#dc2626', '#16a34a', '#f26b1d', '#7c3aed'];

function Whiteboard({ id, initial }: { id: string; initial: Stroke[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([...initial]);
  const [color, setColor] = useState(PENS[0]);
  const [width, setWidth] = useState(4);
  const [eraser, setEraser] = useState(false);
  const cur = useRef<Stroke | null>(null);

  const draw = (s: Stroke, g: CanvasRenderingContext2D, W: number, H: number) => {
    g.strokeStyle = s.c; g.lineWidth = s.w * (W / 1200); g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i < s.pts.length; i += 2) { const x = s.pts[i] * W, y = s.pts[i + 1] * H; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
    if (s.pts.length === 2) g.lineTo(s.pts[0] * W + 0.1, s.pts[1] * H);
    g.stroke();
  };
  const redraw = () => {
    const c = ref.current; if (!c) return;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    for (const s of strokes.current) draw(s, g, c.width, c.height);
  };
  useEffect(() => {
    redraw();
    const offs = [
      bus.on('board:stroke', (m: { id: string; stroke: Stroke }) => { if (m.id !== id) return; strokes.current.push(m.stroke); const c = ref.current; if (c) draw(m.stroke, c.getContext('2d')!, c.width, c.height); }),
      bus.on('board:clear', (m: { id: string }) => { if (m.id !== id) return; strokes.current = []; redraw(); }),
    ];
    return () => offs.forEach((o) => o());
  }, [id]);

  const pt = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  const down = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    cur.current = { c: eraser ? '#ffffff' : color, w: eraser ? 28 : width, pts: pt(e) };
  };
  const move = (e: React.PointerEvent) => {
    const s = cur.current; const c = ref.current;
    if (!s || !c) return;
    const [x, y] = pt(e);
    const g = c.getContext('2d')!;
    g.strokeStyle = s.c; g.lineWidth = s.w * (c.width / 1200); g.lineCap = 'round';
    g.beginPath(); g.moveTo(s.pts[s.pts.length - 2] * c.width, s.pts[s.pts.length - 1] * c.height); g.lineTo(x * c.width, y * c.height); g.stroke();
    if (s.pts.length < 3998) s.pts.push(x, y);
  };
  const up = () => {
    const s = cur.current; cur.current = null;
    if (!s) return;
    strokes.current.push(s);
    send('board:stroke', { id, stroke: s });
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {PENS.map((c) => (
          <button key={c} onClick={() => { setColor(c); setEraser(false); }} className={`h-7 w-7 rounded-full ring-2 ${color === c && !eraser ? 'ring-accent-400' : 'ring-white/10'}`} style={{ background: c }} aria-label={`Pen ${c}`} />
        ))}
        <span className="mx-1 h-6 w-px bg-white/10" />
        {[2, 4, 8, 14].map((w) => (
          <button key={w} onClick={() => { setWidth(w); setEraser(false); }} className={`flex h-7 w-7 items-center justify-center rounded-lg ${width === w && !eraser ? 'bg-white/15' : 'bg-white/5'}`} title={`Size ${w}`}>
            <span className="rounded-full bg-white" style={{ width: w + 2, height: w + 2 }} />
          </button>
        ))}
        <button className={`btn-ghost px-2 py-1 text-xs ${eraser ? 'ring-2 ring-accent-400' : ''}`} onClick={() => setEraser(!eraser)}><Eraser size={14} /> Eraser</button>
        <span className="flex-1" />
        <span className="hidden text-xs text-slate-400 sm:inline"><Pencil size={12} className="mr-1 inline" />Everyone at this board sees it live.</span>
        <button className="btn-ghost px-2 py-1 text-xs text-red-300" onClick={() => { if (confirm('Clear the whole whiteboard for everyone?')) send('board:clear', { id }); }}><Trash2 size={14} /> Clear</button>
      </div>
      <canvas ref={ref} width={1200} height={675} className="aspect-video w-full cursor-crosshair touch-none rounded-xl bg-white shadow-inner" style={{ imageRendering: 'auto' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-testid="whiteboard" />
    </div>
  );
}

// ------------------------------------------------------------------ TV

function Tv({ id, initial }: { id: string; initial: string }) {
  const [url, setUrl] = useState(initial);
  const [draft, setDraft] = useState(initial);
  useEffect(() => bus.on('embed', (m: { id: string; url: string }) => { if (m.id === id) { setUrl(m.url); setDraft(m.url); } }), [id]);
  return (
    <div>
      <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send('embed:set', { id, url: draft }); }}>
        <input className="input" placeholder="Paste a YouTube link, a dashboard, slides or any https:// page" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn-primary whitespace-nowrap">Show on TV</button>
        {url && <a className="btn-ghost" href={url} target="_blank" rel="noreferrer" title="Open in a new tab"><ExternalLink size={16} /></a>}
      </form>
      {url ? (
        <iframe src={url} title="TV" className="aspect-video w-full rounded-xl bg-black ring-1 ring-white/10" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-black/60 text-sm text-slate-400 ring-1 ring-white/10">Nothing on yet. Paste a link above; everyone who opens this TV sees it.</div>
      )}
      <p className="mt-2 text-xs text-slate-500">Some websites refuse to be shown inside other pages. If it stays blank, use the open-in-new-tab button.</p>
    </div>
  );
}

// ------------------------------------------------------------------ sticky notes

const NOTE_COLORS = ['#fde047', '#f9a8d4', '#86efac', '#93c5fd', '#fdba74'];

function Notes({ id, initial, kind }: { id: string; initial: StickyNote[]; kind: string }) {
  const [notes, setNotes] = useState(initial);
  const [text, setText] = useState('');
  const [color, setColor] = useState(NOTE_COLORS[0]);
  useEffect(() => bus.on('notes', (m: { id: string; notes: StickyNote[] }) => { if (m.id === id) setNotes(m.notes); }), [id]);
  return (
    <div>
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { send('notes:add', { id, text, color }); setText(''); } }}>
        <input className="input flex-1" maxLength={280} placeholder={kind === 'orderBoard' ? 'Add an order note (PO, customer, due date…)' : 'Share a note, link or shout-out'} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex items-center gap-1">{NOTE_COLORS.map((c) => <button type="button" key={c} onClick={() => setColor(c)} className={`h-7 w-7 rounded ${color === c ? 'ring-2 ring-white' : ''}`} style={{ background: c }} aria-label="Note colour" />)}</div>
        <button className="btn-primary"><Plus size={16} /> Add note</button>
      </form>
      {notes.length === 0 && <div className="py-10 text-center text-sm text-slate-400">No notes yet.</div>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {notes.map((n, i) => (
          <div key={n.id} className="group relative min-h-[120px] rounded-sm p-3 pb-6 text-sm text-slate-900 shadow-lg" style={{ background: n.color, transform: `rotate(${((i * 37) % 5) - 2}deg)` }}>
            <div className="whitespace-pre-wrap break-words">{linkify(n.text)}</div>
            <div className="absolute bottom-1.5 left-3 text-[10px] text-slate-700/80">{n.by} · {new Date(n.at).toLocaleDateString()}</div>
            <button className="absolute right-1 top-1 hidden rounded p-0.5 text-slate-700 hover:bg-black/10 group-hover:block" onClick={() => send('notes:remove', { id, noteId: n.id })} title="Remove"><X size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function linkify(t: string) {
  return t.split(/(https?:\/\/\S+)/g).map((part, i) => (/^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer" className="underline">{part}</a> : part));
}
