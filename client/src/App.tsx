import { useEffect, useState } from 'react';
import type { MeUser, PublicSettings } from '@shared/types';
import { api } from './api';
import { JoinScreen } from './components/JoinScreen';
import { Office } from './components/Office';
import { useStore } from './store';

export interface AppConfig { passcodeRequired: boolean; domainRestricted: boolean; settings: PublicSettings }

export default function App() {
  const me = useStore((s) => s.me);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await api<AppConfig>('/config');
        setConfig(cfg);
        useStore.getState().set({ settings: cfg.settings });
        const m = await api<MeUser>('/me').catch(() => null);
        // Returning visitors with a finished profile go straight in.
        if (m && m.onboarded) useStore.getState().set({ me: m });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="pixel animate-pulse text-xs text-brand-200">Loading the office…</div>
      </div>
    );
  }
  if (!me) return <JoinScreen config={config} />;
  return <Office />;
}
