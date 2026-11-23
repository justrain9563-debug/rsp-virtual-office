import { useEffect, useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { zoneById } from '@shared/map';
import { DEPTS, type PublicSettings, type RoomState } from '@shared/types';
import { api } from '../api';
import { useStore } from '../store';
import { Modal } from './Overlays';

interface AdminUser {
  id: string; name: string; email: string; title: string; dept: string; role: string; deskId: string | null;
  banned: boolean; online: boolean; location: string | null; lastSeen: string | null;
}

export function AdminPanel() {
  const set = useStore((s) => s.set);
  const selfId = useStore((s) => s.selfId);
  const [tab, setTab] = useState<'people' | 'rooms' | 'settings' | 'invite'>('people');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [rooms, setRooms] = useState<RoomState[]>([]);
  const [desks, setDesks] = useState<{ id: string; dept: string }[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [msg, setMsg] = useState('');

  const load = async () => {
    setUsers(await api('/admin/users'));
    const s = await api<{ settings: PublicSettings; rooms: RoomState[]; desks: { id: string; dept: string }[] }>('/admin/settings');
    setSettings(s.settings); setRooms(s.rooms); setDesks(s.desks);
  };
  useEffect(() => { load().catch((e) => setMsg(e.message)); }, []);

  const run = async (fn: () => Promise<any>, ok = 'Saved') => {
    try { await fn(); setMsg(ok); await load(); } catch (e: any) { setMsg(e.message); }
    setTimeout(() => setMsg(''), 2500);
  };
  const patchUser = (id: string, body: any) => run(() => api(`/admin/users/${id}`, { method: 'PATCH', body }));
  const takenDesks = new Map(users.filter((u) => u.deskId).map((u) => [u.deskId!, u.name]));
  const url = window.location.origin;

  const Tab = ({ id, label }: { id: typeof tab; label: string }) => (
    <button onClick={() => setTab(id)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === id ? 'bg-accent-500 text-white' : 'text-slate-300 hover:bg-white/5'}`}>{label}</button>
  );

  return (
    <Modal title="Admin" wide onClose={() => set({ modal: null })}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tab id="people" label={`Employees (${users.length})`} />
        <Tab id="rooms" label="Meeting rooms" />
        <Tab id="settings" label="Office settings" />
        <Tab id="invite" label="Invite people" />
        <span className="flex-1" />
        {msg && <span className="text-sm text-accent-300">{msg}</span>}
      </div>

      {tab === 'people' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-400">
              <tr><th className="p-2">Employee</th><th className="p-2">Role</th><th className="p-2">Department</th><th className="p-2">Desk</th><th className="p-2">Status</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={`border-t border-white/5 ${u.banned ? 'opacity-50' : ''}`}>
                  <td className="p-2">
                    <div className="font-semibold text-white">{u.name}{u.id === selfId && ' (you)'}</div>
                    <div className="text-xs text-slate-400">{u.email || 'no email'}{u.title ? ` · ${u.title}` : ''}</div>
                  </td>
                  <td className="p-2">
                    <select className="input py-1" value={u.role} disabled={u.id === selfId} onChange={(e) => patchUser(u.id, { role: e.target.value })}>
                      <option value="member">Member</option><option value="manager">Manager</option><option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="p-2">
                    <select className="input py-1" value={u.dept} onChange={(e) => patchUser(u.id, { dept: e.target.value })}>
                      {DEPTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                    </select>
                  </td>
                  <td className="p-2">
                    <select className="input py-1" value={u.deskId ?? ''} onChange={(e) => patchUser(u.id, { deskId: e.target.value || null })}>
                      <option value="">No desk</option>
                      {desks.map((d) => <option key={d.id} value={d.id}>{d.id}{takenDesks.has(d.id) && takenDesks.get(d.id) !== u.name ? ` (${takenDesks.get(d.id)})` : ''}</option>)}
                    </select>
                  </td>
                  <td className="p-2 text-xs">
                    {u.banned ? <span className="text-red-300">Removed</span> : u.online ? <span className="text-emerald-300">Online{u.location ? ` · ${u.location}` : ''}</span> : <span className="text-slate-400">Offline</span>}
                  </td>
                  <td className="whitespace-nowrap p-2 text-right">
                    {u.id !== selfId && (
                      <>
                        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => patchUser(u.id, { banned: !u.banned })}>{u.banned ? 'Restore access' : 'Remove access'}</button>
                        <button className="btn-ghost ml-1 px-2 py-1 text-xs text-red-300" title="Delete account" onClick={() => confirm(`Delete ${u.name}'s account and messages' author link?`) && run(() => api(`/admin/users/${u.id}`, { method: 'DELETE' }), 'Deleted')}><Trash2 size={13} /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'rooms' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {rooms.map((r) => (
            <div key={r.id} className="rounded-xl bg-white/5 p-4">
              <div className="mb-3 font-semibold">{zoneById(r.id)?.name ?? r.id}</div>
              <label className="mb-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={r.anyoneCanLock} onChange={(e) => run(() => api(`/admin/rooms/${r.id}`, { method: 'PUT', body: { anyoneCanLock: e.target.checked } }))} />
                Anyone inside can lock it (otherwise managers/admins only)
              </label>
              <label className="mb-2 flex items-center gap-2 text-sm">
                Capacity
                <input type="number" min={2} max={16} className="input w-20 py-1" defaultValue={r.capacity} onBlur={(e) => run(() => api(`/admin/rooms/${r.id}`, { method: 'PUT', body: { capacity: +e.target.value } }))} />
              </label>
              <button className="btn-ghost text-xs" onClick={() => run(() => api(`/admin/rooms/${r.id}`, { method: 'PUT', body: { locked: !r.locked } }))}>{r.locked ? 'Unlock now' : 'Lock now'}</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'settings' && settings && (
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => api('/admin/settings', { method: 'PUT', body: settings })); }}>
          <div><label className="label">Lobby sign text</label><input className="input" maxLength={14} value={settings.officeSign} onChange={(e) => setSettings({ ...settings, officeSign: e.target.value })} /></div>
          <div><label className="label">Welcome message</label><input className="input" maxLength={80} value={settings.welcomeMessage} onChange={(e) => setSettings({ ...settings, welcomeMessage: e.target.value })} /></div>
          <div><label className="label">Full-volume distance (tiles)</label><input type="number" step={0.5} min={0} max={6} className="input" value={settings.proximity.fullRadius} onChange={(e) => setSettings({ ...settings, proximity: { ...settings.proximity, fullRadius: +e.target.value } })} /></div>
          <div><label className="label">Conversation range (tiles)</label><input type="number" step={0.5} min={1} max={12} className="input" value={settings.proximity.connectRadius} onChange={(e) => setSettings({ ...settings, proximity: { ...settings.proximity, connectRadius: +e.target.value } })} /></div>
          <div><label className="label">Max people per open-area conversation</label><input type="number" min={1} max={16} className="input" value={settings.proximity.maxPeers} onChange={(e) => setSettings({ ...settings, proximity: { ...settings.proximity, maxPeers: +e.target.value } })} /></div>
          <div className="space-y-2 pt-5">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.allowAvatarCustomization} onChange={(e) => setSettings({ ...settings, allowAvatarCustomization: e.target.checked })} /> Employees can change their avatar</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.allowNameChange} onChange={(e) => setSettings({ ...settings, allowNameChange: e.target.checked })} /> Employees can change their name</label>
          </div>
          <div className="sm:col-span-2"><button className="btn-primary">Save settings</button></div>
        </form>
      )}

      {tab === 'invite' && (
        <div className="space-y-4 text-sm text-slate-300">
          <p>Send coworkers this link. They type their name, pick a character and walk in.</p>
          <div className="flex gap-2">
            <input className="input font-mono" readOnly value={url} />
            <button className="btn-primary" onClick={() => { navigator.clipboard.writeText(url); setMsg('Link copied'); }}><Copy size={14} /> Copy</button>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-slate-400">
            <li>To keep strangers out, set an <code className="text-slate-200">OFFICE_PASSCODE</code> on the server (Render → Environment) and share it with the link.</li>
            <li>To only allow company emails, set <code className="text-slate-200">ALLOWED_EMAIL_DOMAINS=rspsupply.com</code>.</li>
            <li>Give someone admin rights from the Employees tab, or share the <code className="text-slate-200">ADMIN_CODE</code>.</li>
            <li>Use "Remove access" to kick someone out and stop them from coming back.</li>
          </ul>
        </div>
      )}
    </Modal>
  );
}
