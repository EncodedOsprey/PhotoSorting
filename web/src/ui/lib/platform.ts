// Platform detection for iOS-specific hints.

interface NavigatorLike {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}

const currentNavigator = (): NavigatorLike | undefined =>
  typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { standalone?: boolean });

/** iPhone, iPod or iPad (iPadOS reports itself as a Mac, but Macs have no touch screen). */
export function isIOS(nav: NavigatorLike | undefined = currentNavigator()): boolean {
  if (!nav) return false;
  if (/iPhone|iPad|iPod/i.test(nav.userAgent)) return true;
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
}

/** Running from the Home Screen rather than in a Safari tab. */
export function isStandalone(
  nav: NavigatorLike | undefined = currentNavigator(),
  matchMedia: ((query: string) => { matches: boolean }) | undefined = typeof window === 'undefined'
    ? undefined
    : window.matchMedia?.bind(window),
): boolean {
  if (nav?.standalone === true) return true;
  try {
    return matchMedia?.('(display-mode: standalone)').matches ?? false;
  } catch {
    return false;
  }
}

export function shouldShowInstallTip(nav: NavigatorLike | undefined = currentNavigator(), standalone = isStandalone(nav)): boolean {
  return isIOS(nav) && !standalone;
}
