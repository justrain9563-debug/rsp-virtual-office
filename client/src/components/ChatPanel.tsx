import { useEffect, useRef, useState } from 'react';
import { Hash, MessageSquare, Send, SmilePlus, X } from 'lucide-react';
import { DEPTS, REACTIONS, type ChatMessage } from '@shared/types';
import { request, send } from '../net/socket';
import { useStore } from '../store';

const loaded = new Set<string>();

export function channelTitle(ch: string, names: Record<string, string>, selfId: string | null) {
  if (ch === 'general') return 'General';
  if (ch.startsWith('dept:')) return DEPTS.find((d) => d.id === ch.slice(5))?.label ?? ch;
  const other = ch.slice(3).split(':').find((id) => id !== selfId) ?? '';
  return names[other] ?? 'Direct message';
}

export function ChatPanel() {
  const me = useStore((s) => s.me);
  const selfId = useStore((s) => s.selfId);
  const active = useStore((s) => s.activeChannel);
  const messages = useStore((s) => s.messages[active]) ?? [];
  const unread = useStore((s) => s.unread);
  const dms = useStore((s) => s.dmChannels);
  const players = useStore((s) => s.players);
  const set = useStore((s) => s.set);
  const [names, setNames] = useState<Record<string, string>>({});
  const [text, setText] = useState('');
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const channels = ['general', ...(me?.role === 'member' ? [`dept:${me.dept}`] : DEPTS.map((d) => `dept:${d.id}`))];

  useEffect(() => {
    fetch('/api/users').then((r) => r.json()).then((list) => setNames(Object.fromEntries(list.map((u: any) => [u.id, u.name])))).catch(() => {});
  }, [dms.length]);
  const allNames = { ...names, ...Object.fromEntries(Object.values(players).map((p) => [p.id, p.name])) };

  useEffect(() => {
    if (!loaded.has(active)) {
      loaded.add(active);
      request<ChatMessage[]>('chat:history', { channel: active }).then((hist) => {
        useStore.setState((s) => {
          const live = s.messages[active] ?? [];
          const ids = new Set(hist.map((m) => m.id));
          return { messages: { ...s.messages, [active]: [...hist, ...live.filter((m) => !ids.has(m.id))] } };
        });
      });
    }
    useStore.setState((s) => ({ unread: { ...s.unread, [active]: 0 } }));
  }, [active, messages.length]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length, active]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    send('chat:send', { channel: active, body }, (r: any) => { if (!r?.ok && r?.error) useStore.getState().toast({ kind: 'warn', text: r.error }); });
    setText('');
  };

  const ChannelBtn = ({ ch, icon }: { ch: string; icon: React.ReactNode }) => (
    <button onClick={() => set({ activeChannel: ch })}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${active === ch ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5'}`}>
      {icon}<span className="flex-1 truncate">{channelTitle(ch, allNames, selfId)}</span>
      {!!unread[ch] && active !== ch && <span className="rounded-full bg-accent-500 px-1.5 text-[10px] font-bold text-white">{unread[ch]}</span>}
    </button>
  );

  return (
    <aside className="flex w-[22rem] shrink-0 flex-col border-l border-white/10 bg-brand-900/95" data-testid="chat">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-bold text-white">Chat</h2>
        <button className="text-slate-500 hover:text-white" onClick={() => set({ rightTab: null })}><X size={16} /></button>
      </div>
      <div className="max-h-44 shrink-0 space-y-0.5 overflow-y-auto border-b border-white/10 p-2 scroll-thin">
        {channels.map((ch) => <ChannelBtn key={ch} ch={ch} icon={<Hash size={14} className="text-slate-500" />} />)}
        {dms.map((ch) => <ChannelBtn key={ch} ch={ch} icon={<MessageSquare size={14} className="text-slate-500" />} />)}
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && <div className="py-8 text-center text-sm text-slate-500">No messages yet. Say hi! 👋</div>}
        {messages.map((m, i) => {
          const grouped = i > 0 && messages[i - 1].senderId === m.senderId && new Date(m.createdAt).getTime() - new Date(messages[i - 1].createdAt).getTime() < 5 * 60_000;
          return (
            <div key={m.id} className={`group relative ${grouped ? '-mt-2' : ''}`}>
              {!grouped && (
                <div className="flex items-baseline gap-2">
                  <span className={`text-sm font-semibold ${m.senderId === selfId ? 'text-accent-300' : 'text-white'}`}>{m.senderName}</span>
                  <span className="text-[10px] text-slate-500">{new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                </div>
              )}
              <div className="whitespace-pre-wrap break-words text-sm text-slate-200">{m.body}</div>
              {Object.keys(m.reactions).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(m.reactions).map(([e, ids]) => (
                    <button key={e} onClick={() => send('chat:react', { messageId: m.id, emoji: e })}
                      className={`rounded-full px-1.5 py-0.5 text-xs ${ids.includes(selfId!) ? 'bg-accent-500/30 ring-1 ring-accent-400' : 'bg-white/10'}`}>
                      {e} {ids.length}
                    </button>
                  ))}
                </div>
              )}
              <button className="absolute -top-1 right-0 hidden rounded bg-brand-800 p-1 text-slate-400 hover:text-white group-hover:block" onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)} title="React">
                <SmilePlus size={14} />
              </button>
              {pickerFor === m.id && (
                <div className="absolute right-0 top-5 z-10 flex gap-1 rounded-lg bg-brand-800 p-1 shadow-xl ring-1 ring-white/10">
                  {REACTIONS.map((e) => <button key={e} className="rounded px-1 hover:bg-white/10" onClick={() => { send('chat:react', { messageId: m.id, emoji: e }); setPickerFor(null); }}>{e}</button>)}
                </div>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-white/10 p-3">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${channelTitle(active, allNames, selfId)}`} maxLength={2000} data-testid="chat-input" />
        <button className="btn-primary px-3" disabled={!text.trim()}><Send size={16} /></button>
      </form>
    </aside>
  );
}
