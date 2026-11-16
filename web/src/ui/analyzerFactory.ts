import type { PhotoAnalyzer } from '../analysis/types';

/**
 * Creates the analysis engine. The engine module (MediaPipe) is loaded on demand so the Setup screen opens fast.
 * In development, `?mock=1` swaps in a fake engine (removed from production builds).
 */
export async function loadAnalyzer(): Promise<PhotoAnalyzer> {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('mock')) {
    const { createMockAnalyzer } = await import('./dev/mockAnalyzer');
    return createMockAnalyzer(new URLSearchParams(window.location.search));
  }
  const { createPhotoAnalyzer } = await import('../analysis/analyzer');
  return createPhotoAnalyzer();
}
