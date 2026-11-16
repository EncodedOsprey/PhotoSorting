import { Share, SquarePlus, X } from 'lucide-react';
import { useState } from 'react';
import { shouldShowInstallTip } from '../lib/platform';
import { safeLocalStorage } from '../state/planSettings';
import { TileIcon } from './CategoryIcon';

const DISMISSED_KEY = 'photosorting.installTipDismissed.v1';

function wasDismissed(): boolean {
  try {
    return safeLocalStorage()?.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** In Safari on iOS (not yet installed): how to add the app to the Home Screen. */
export function InstallTip() {
  const [visible, setVisible] = useState(() => shouldShowInstallTip() && !wasDismissed());
  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      safeLocalStorage()?.setItem(DISMISSED_KEY, '1');
    } catch {
      // Shows again next time; harmless.
    }
  };

  return (
    <aside className="card banner banner--tip" aria-label="Install tip">
      <TileIcon Icon={SquarePlus} color="#007aff" />
      <p className="banner__text">
        <strong>
          Install: tap Share
          <Share className="banner__inline-icon" aria-label="(the share icon)" />, then Add to Home Screen
        </strong>
        <span>It opens full screen, like an app, and works offline.</span>
      </p>
      <button type="button" className="icon-button" aria-label="Dismiss install tip" onClick={dismiss}>
        <X aria-hidden="true" />
      </button>
    </aside>
  );
}
