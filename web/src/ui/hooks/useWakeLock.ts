import { useEffect } from 'react';

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/**
 * Keeps the screen on while `active` (Screen Wake Lock API, Safari 16.4+). The system releases the lock when the
 * page is hidden, so it is requested again whenever the page becomes visible.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!active || !wakeLock) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let disposed = false;

    const acquire = async () => {
      if (disposed || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try {
        const lock = await wakeLock.request('screen');
        if (disposed) {
          void lock.release();
          return;
        }
        sentinel = lock;
      } catch {
        // Not allowed right now (e.g. Low Power Mode); the photographer can still keep the screen on.
      }
    };
    const onVisibilityChange = () => void acquire();

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
    };
  }, [active]);
}
