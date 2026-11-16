import { useEffect, useState } from 'react';
import { loadSettings, saveSettings, type PlanSettings } from '../state/planSettings';

/** Plan settings loaded from localStorage once and saved after every change. */
export function usePersistentSettings() {
  const [settings, setSettings] = useState<PlanSettings>(() => loadSettings());
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);
  return [settings, setSettings] as const;
}
