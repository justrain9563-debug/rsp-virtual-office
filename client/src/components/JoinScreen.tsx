import { useState } from 'react';
import { DoorOpen, KeyRound, ShieldCheck } from 'lucide-react';
import { DEPTS, randomAvatar, sanitizeAvatar, type AvatarConfig, type MeUser } from '@shared/types';
import { api } from '../api';
import type { AppConfig } from '../App';
import { useStore } from '../store';
import { AvatarEditor } from './AvatarEditor';
import { Logo } from './Logo';

const SAVED = 'rsp.profile';
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED) || '{}'); } catch { return {}; }
}

export function JoinScreen({ config }: { config: AppConfig | null }) {
  const saved = loadSaved();
  const [name, setName] = useState<string>(saved.name ?? '');
  const [email, setEmail] = useState<string>(saved.email ?? '');
  const [dept, setDept] = useState<string>(saved.dept ?? 'sales');
  const [title, setTitle] = useState<string>(saved.title ?? '');
  const [avatar, setAvatar] = useState<AvatarConfig>(sanitizeAvatar(saved.avatar) ?? randomAvatar());
  const [passcode, setPasscode] = useState('');
  const [adminCode, setAdminCode] = useState('');
  const [showAdmin, setShowAdmin] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      let me = await api<MeUser>('/join', { body: { name, email, dept, title, avatar, passcode, adminCode: adminCode || undefined } });
      me = await api<MeUser>('/me', { method: 'PUT', body: { name, title, dept, avatar, onboarded: true } });
      try { localStorage.setItem(SAVED, JSON.stringify({ name, email, dept, title, avatar })); } catch { /* ignore */ }
      useStore.getState().set({ me });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const welcome = config?.settings.welcomeMessage ?? 'Welcome to RSP Virtual Office';

  return (
    <div className="flex h-full overflow-auto bg-brand-950 bg-[radial-gradient(ellipse_at_top_left,#1b4a82_0%,transparent_55%),radial-gradient(ellipse_at_bottom_right,#3a1d0c_0%,transparent_50%)]">
      <div className="m-auto grid w-full max-w-5xl gap-8 p-6 lg:grid-cols-[1fr_1.25fr]">
        <div className="flex flex-col justify-center gap-6">
          <Logo size="lg" />
          <h1 className="pixel text-xl leading-relaxed text-white sm:text-2xl">{welcome}</h1>
          <p className="text-slate-300">
            Walk around the RSP Supply office as your 8-bit self. Stroll up to a coworker and your
            camera and mic connect automatically. Walk away and the conversation fades out.
          </p>
          <ul className="space-y-2 text-sm text-slate-400">
            <li>🎧 Proximity voice &amp; video: no meeting links</li>
            <li>🚪 Private rooms for meetings and one-on-ones</li>
            <li>💬 Office, department and direct-message chat</li>
            <li>🔒 Mic and camera stay <b className="text-slate-200">off</b> until you turn them on</li>
          </ul>
        </div>

        <form onSubmit={submit} className="panel space-y-5 rounded-2xl p-6 shadow-2xl">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="name">Your name</label>
              <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Travis Smith" maxLength={32} required autoFocus />
            </div>
            <div>
              <label className="label" htmlFor="email">Work email {config?.domainRestricted ? '' : <span className="normal-case text-slate-500">(optional)</span>}</label>
              <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@rspsupply.com" required={config?.domainRestricted} />
            </div>
            <div>
              <label className="label" htmlFor="dept">Department</label>
              <select id="dept" className="input" value={dept} onChange={(e) => setDept(e.target.value)}>
                {DEPTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="title">Job title <span className="normal-case text-slate-500">(optional)</span></label>
              <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Account Executive" maxLength={48} />
            </div>
          </div>

          <div>
            <span className="label">Your character</span>
            <AvatarEditor value={avatar} onChange={setAvatar} />
          </div>

          {config?.passcodeRequired && (
            <div>
              <label className="label" htmlFor="pass"><KeyRound size={12} className="mr-1 inline" />Office passcode</label>
              <input id="pass" type="password" className="input" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Ask your manager" required={!adminCode} />
            </div>
          )}
          {showAdmin ? (
            <div>
              <label className="label" htmlFor="admin"><ShieldCheck size={12} className="mr-1 inline" />Admin code</label>
              <input id="admin" type="password" className="input" value={adminCode} onChange={(e) => setAdminCode(e.target.value)} />
            </div>
          ) : (
            <button type="button" onClick={() => setShowAdmin(true)} className="text-xs text-slate-500 hover:text-slate-300">I have an admin code</button>
          )}

          {error && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{error}</div>}
          <button className="btn-primary w-full py-3 text-base" disabled={busy || !name.trim()}>
            <DoorOpen size={18} /> {busy ? 'Opening the door…' : 'Enter the office'}
          </button>
        </form>
      </div>
    </div>
  );
}
