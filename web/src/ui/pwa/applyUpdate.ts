// Applies a waiting app update when the photographer taps Reload.

export interface UpdateEnvironment {
  container: Pick<ServiceWorkerContainer, 'addEventListener'> | undefined;
  reload: () => void;
  setTimeout: (callback: () => void, ms: number) => unknown;
}

/** Reload anyway if the new version hasn't taken control by then, so the tap always does something. */
export const UPDATE_RELOAD_FALLBACK_MS = 4000;

/**
 * Activates the waiting version (`activate` posts SKIP_WAITING) and reloads this page once that version controls
 * it. Doesn't rely on the page having been controlled when it loaded (true on a first visit). If no version is
 * waiting anymore (another tab already activated it), reloads right away.
 */
export function applyUpdate(
  registration: Pick<ServiceWorkerRegistration, 'waiting'> | undefined,
  activate: () => Promise<void>,
  env: UpdateEnvironment = browserEnvironment(),
): void {
  if (!registration?.waiting || !env.container) {
    env.reload();
    return;
  }
  let reloaded = false;
  const reloadOnce = () => {
    if (reloaded) return;
    reloaded = true;
    env.reload();
  };
  env.container.addEventListener('controllerchange', reloadOnce, { once: true });
  env.setTimeout(reloadOnce, UPDATE_RELOAD_FALLBACK_MS);
  activate().catch(reloadOnce);
}

function browserEnvironment(): UpdateEnvironment {
  return {
    container: typeof navigator === 'undefined' ? undefined : navigator.serviceWorker,
    reload: () => window.location.reload(),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  };
}
