// Owns the analysis engine and the cache of analyzed photos (outside React state, so going back to adjust the
// criteria never re-analyzes a photo).
import type { AnalysisFailure, AnalysisProgress, AnalyzedPhoto, PhotoAnalyzer } from '../../analysis/types';
import { safeLocalStorage } from './planSettings';
import type { SelectedPhoto } from './photoSelection';

export type AnalyzerFactory = () => Promise<PhotoAnalyzer>;

export type RunOutcome = { status: 'done' } | { status: 'cancelled' } | { status: 'error'; message: string };

export interface RunCallbacks {
  /** The engine has to be loaded first (downloaded on first use). */
  onEngineLoading?: () => void;
  /** The engine is ready and `total` photos are being analyzed. */
  onAnalysisStart?: (total: number) => void;
  onProgress?: (progress: AnalysisProgress) => void;
}

const ENGINE_LOADED_KEY = 'photosorting.engineLoaded.v1';
export const ENGINE_FALLBACK_ERROR = 'The photo analysis engine couldn’t be loaded. Check your connection and try again.';

/** Whether the engine has loaded on this device before (the service worker also precaches its files for offline use). */
export function engineLoadedBefore(storage: Pick<Storage, 'getItem'> | undefined = safeLocalStorage()): boolean {
  try {
    return storage?.getItem(ENGINE_LOADED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberEngineLoaded(storage: Pick<Storage, 'setItem'> | undefined = safeLocalStorage()) {
  try {
    storage?.setItem(ENGINE_LOADED_KEY, '1');
  } catch {
    // Only affects the wording of the loading message.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : ENGINE_FALLBACK_ERROR;
}

export class AnalysisController {
  /** Analyzed photos by fileKey. */
  readonly photos = new Map<string, AnalyzedPhoto>();
  /** Files that couldn't be analyzed, by fileKey. */
  readonly failures = new Map<string, AnalysisFailure>();
  private analyzer: Promise<PhotoAnalyzer> | null = null;
  private ready = false;
  private abort: AbortController | null = null;
  private running: Promise<RunOutcome> | null = null;
  private readonly createAnalyzer: AnalyzerFactory;
  private readonly release: (photo: AnalyzedPhoto) => void;
  private readonly listeners = new Set<() => void>();
  private processed: ReadonlySet<string> = new Set();

  constructor(createAnalyzer: AnalyzerFactory, release: (photo: AnalyzedPhoto) => void) {
    this.createAnalyzer = createAnalyzer;
    this.release = release;
  }

  get engineReady(): boolean {
    return this.ready;
  }

  /** For useSyncExternalStore: called whenever the set of processed photos changes. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Keys of photos analyzed or failed so far (a new Set after every change). */
  readonly processedKeys = (): ReadonlySet<string> => this.processed;

  private changed(): void {
    this.processed = new Set([...this.photos.keys(), ...this.failures.keys()]);
    for (const listener of this.listeners) listener();
  }

  /** Selected photos that have neither been analyzed nor failed yet. */
  missing(selection: readonly SelectedPhoto[]): SelectedPhoto[] {
    return selection.filter((photo) => !this.photos.has(photo.key) && !this.failures.has(photo.key));
  }

  /** Forgets photos that are no longer selected and frees their thumbnails. */
  retain(keys: ReadonlySet<string>): void {
    let removed = false;
    for (const [key, photo] of this.photos) {
      if (keys.has(key)) continue;
      this.release(photo);
      this.photos.delete(key);
      removed = true;
    }
    for (const key of [...this.failures.keys()]) {
      if (keys.has(key)) continue;
      this.failures.delete(key);
      removed = true;
    }
    if (removed) this.changed();
  }

  /** Stops any analysis and forgets everything (keeps the loaded engine). */
  clear(): void {
    this.cancel();
    for (const photo of this.photos.values()) this.release(photo);
    this.photos.clear();
    this.failures.clear();
    this.changed();
  }

  cancel(): void {
    this.abort?.abort();
  }

  /** Resolves once no analysis is running (after cancel(): once the photo in progress is finished and cached). */
  async idle(): Promise<void> {
    await this.running;
  }

  /**
   * Analyzes the photos of `selection` that aren't in the cache yet and adds them to it. Resolves 'cancelled' as
   * soon as cancel() is called while the engine is still loading (loading continues in the background, for next
   * time); during analysis it waits for the photo in progress and keeps everything analyzed so far. A new run
   * cancels the previous one and starts once it has finished, so runs never overlap, and a cancel() while waiting
   * for it stops the new run too.
   */
  async run(selection: readonly SelectedPhoto[], callbacks: RunCallbacks = {}): Promise<RunOutcome> {
    this.cancel();
    const abort = new AbortController();
    this.abort = abort;
    const previous = this.running;
    const running = (async (): Promise<RunOutcome> => {
      await previous?.catch(() => undefined);
      if (abort.signal.aborted) return { status: 'cancelled' };
      const files = this.missing(selection);
      if (files.length === 0) return { status: 'done' };
      return this.execute(files, abort.signal, callbacks);
    })();
    this.running = running;
    try {
      return await running;
    } finally {
      if (this.abort === abort) this.abort = null;
      if (this.running === running) this.running = null;
    }
  }

  private async execute(files: readonly SelectedPhoto[], signal: AbortSignal, callbacks: RunCallbacks): Promise<RunOutcome> {
    let analyzer: PhotoAnalyzer;
    try {
      if (!this.ready) callbacks.onEngineLoading?.();
      const loaded = await Promise.race([this.engine(), aborted(signal)]);
      if (!loaded) return { status: 'cancelled' };
      analyzer = loaded;
    } catch (error) {
      return { status: 'error', message: errorMessage(error) };
    }
    if (signal.aborted) return { status: 'cancelled' };

    callbacks.onAnalysisStart?.(files.length);
    try {
      const outcome = await analyzer.analyze(
        files.map(({ file, order }) => ({ file, order })),
        { signal, onProgress: callbacks.onProgress },
      );
      for (const photo of outcome.photos) {
        const previous = this.photos.get(photo.key);
        if (previous && previous !== photo) this.release(previous);
        this.photos.set(photo.key, photo);
      }
      for (const failure of outcome.failures) this.failures.set(failure.key, failure);
      if (outcome.photos.length > 0 || outcome.failures.length > 0) this.changed();
      return outcome.cancelled || signal.aborted ? { status: 'cancelled' } : { status: 'done' };
    } catch (error) {
      this.resetEngine();
      return { status: 'error', message: errorMessage(error) };
    }
  }

  /** The loaded engine; a failed load is forgotten so Retry starts over. */
  private engine(): Promise<PhotoAnalyzer> {
    if (!this.analyzer) {
      const loading = (async () => {
        const analyzer = await this.createAnalyzer();
        try {
          await analyzer.init();
        } catch (error) {
          analyzer.close();
          throw error;
        }
        this.ready = true;
        rememberEngineLoaded();
        return analyzer;
      })();
      this.analyzer = loading;
      loading.catch(() => {
        if (this.analyzer === loading) this.analyzer = null;
      });
    }
    return this.analyzer;
  }

  private resetEngine(): void {
    const analyzer = this.analyzer;
    this.analyzer = null;
    this.ready = false;
    analyzer?.then(
      (loaded) => loaded.close(),
      () => undefined,
    );
  }
}

function aborted(signal: AbortSignal): Promise<null> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve(null);
    else signal.addEventListener('abort', () => resolve(null), { once: true });
  });
}
