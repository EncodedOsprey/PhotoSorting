import { useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { applyUpdate } from './applyUpdate';

const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Registers the service worker. A new version waits until the photographer taps Reload on the update banner
 * (never in the middle of an analysis); `reload` activates it and reloads this page.
 */
export function useAppUpdate() {
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const {
    needRefresh: [updateAvailable],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      registrationRef.current = registration;
      if (!registration) return;
      window.setInterval(() => {
        if (navigator.onLine === false || registration.installing) return;
        registration.update().catch(() => {
          // Offline or server unreachable: try again at the next check.
        });
      }, UPDATE_CHECK_MS);
    },
    onNeedReload() {
      // Another tab applied the update. Leave this page alone (it may be analyzing); its banner reloads it.
    },
  });
  return {
    updateAvailable,
    reload: () => applyUpdate(registrationRef.current, () => updateServiceWorker()),
  };
}
