import { useState } from 'react';
import { DEPTS, type MeUser } from '@shared/types';
import { api } from '../api';
import { useStore } from '../store';
import { AvatarEditor } from './AvatarEditor';
import { Modal } from './Overlays';

export function ProfileModal() {
  const me = useStore((s) => s.me)!;
  const settings = useStore((s) => s.settings);
  const set = useStore((s) => s.set);
  const [name, setName] = useState(me.name);
  const [title, setTitle] = useState(me.title);
  const [dept, setDept] = useState(me.dept);
  const [avatar, setAvatar] = useState(me.avatar);
  const [err, setErr] = useState('');
  const admin = me.role === 'admin';
  const canAvatar = admin || settings?.allowAvatarCustomization !== false;
  const canName = admin || settings?.allowNameChange !== false;

  const save = async () => {
    try {
      const body: any = { title, dept };
      if (canName) body.name = name;
      if (canAvatar) body.avatar = avatar;
      const updated = await api<MeUser>('/me', { method: 'PUT', body });
      set({ me: updated, modal: null });
      try {
        const saved = JSON.parse(localStorage.getItem('rsp.profile') || '{}');
        localStorage.setItem('rsp.profile', JSON.stringify({ ...saved, name: updated.name, title, dept, avatar: updated.avatar }));
      } catch { /* ignore */ }
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <Modal title="Your profile" onClose={() => set({ modal: null })}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className="label">Name</label><input className="input" value={name} disabled={!canName} onChange={(e) => setName(e.target.value)} maxLength={32} /></div>
          <div><label className="label">Title</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={48} /></div>
          <div><label className="label">Department</label>
            <select className="input" value={dept} onChange={(e) => setDept(e.target.value)}>{DEPTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select>
          </div>
        </div>
        {canAvatar ? <AvatarEditor value={avatar} onChange={setAvatar} /> : <p className="text-sm text-slate-400">An admin has turned off avatar changes.</p>}
        {err && <div className="text-sm text-red-300">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => set({ modal: null })}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
