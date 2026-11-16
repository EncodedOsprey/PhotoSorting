import { describe, expect, it, vi } from 'vitest';
import type { AnalysisOutcome, AnalyzedPhoto, PhotoAnalyzer } from '../../analysis/types';
import { AnalysisController } from './analysisController';
import type { SelectedPhoto } from './photoSelection';

const selected = (key: string, order: number): SelectedPhoto => ({ key, order, file: new File(['x'], `${key}.jpg`) });

const analyzed = (key: string): AnalyzedPhoto => ({
  key,
  file: new File(['x'], `${key}.jpg`),
  name: `${key}.jpg`,
  order: 0,
  capturedAt: null,
  width: 10,
  height: 10,
  thumbnailUrl: `blob:${key}`,
  metrics: { faces: [], sharpness: 1, exposure: 1, aesthetics: null, isUtility: false },
  faces: [],
  descriptor: new Float32Array(4),
});

function fakeAnalyzer(overrides: Partial<PhotoAnalyzer> = {}): PhotoAnalyzer {
  return {
    init: vi.fn(async () => {}),
    analyze: vi.fn(async (files: Parameters<PhotoAnalyzer['analyze']>[0]): Promise<AnalysisOutcome> => ({
      photos: files.filter(({ file }) => !file.name.startsWith('bad')).map(({ file }) => analyzed(file.name.replace('.jpg', ''))),
      failures: files.filter(({ file }) => file.name.startsWith('bad')).map(({ file }) => ({ key: file.name.replace('.jpg', ''), name: file.name, reason: 'Broken' })),
      cancelled: false,
    })),
    close: vi.fn(),
    ...overrides,
  };
}

describe('AnalysisController', () => {
  it('caches results so only new photos are analyzed, and frees photos that are no longer selected', async () => {
    const analyzer = fakeAnalyzer();
    const release = vi.fn();
    const controller = new AnalysisController(async () => analyzer, release);
    const selection = [selected('a', 0), selected('bad', 1)];
    const onEngineLoading = vi.fn();
    const listener = vi.fn();
    controller.subscribe(listener);

    expect(await controller.run(selection, { onEngineLoading })).toEqual({ status: 'done' });
    expect(onEngineLoading).toHaveBeenCalledTimes(1);
    expect([...controller.photos.keys()]).toEqual(['a']);
    expect([...controller.failures.keys()]).toEqual(['bad']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect([...controller.processedKeys()].sort()).toEqual(['a', 'bad']);

    const more = [...selection, selected('c', 2)];
    expect(controller.missing(more).map((p) => p.key)).toEqual(['c']);
    const onAnalysisStart = vi.fn();
    await controller.run(more, { onEngineLoading, onAnalysisStart });
    expect(onAnalysisStart).toHaveBeenCalledWith(1);
    expect(vi.mocked(analyzer.analyze).mock.lastCall?.[0].map(({ file }) => file.name)).toEqual(['c.jpg']);
    expect(onEngineLoading).toHaveBeenCalledTimes(1);
    expect(analyzer.init).toHaveBeenCalledTimes(1);
    expect(await controller.run(more)).toEqual({ status: 'done' });
    expect(analyzer.analyze).toHaveBeenCalledTimes(2);

    controller.retain(new Set(['c']));
    expect([...controller.photos.keys()]).toEqual(['c']);
    expect(controller.failures.size).toBe(0);
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ key: 'a' }));

    controller.clear();
    expect(controller.photos.size).toBe(0);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('returns right away when cancelled while the engine loads, keeping the engine for next time', async () => {
    let finishInit = () => {};
    const analyzer = fakeAnalyzer({ init: vi.fn(() => new Promise<void>((resolve) => (finishInit = resolve))) });
    const controller = new AnalysisController(async () => analyzer, vi.fn());
    const run = controller.run([selected('a', 0)]);
    await Promise.resolve();
    controller.cancel();
    expect(await run).toEqual({ status: 'cancelled' });
    expect(analyzer.analyze).not.toHaveBeenCalled();

    finishInit();
    expect(await controller.run([selected('a', 0)])).toEqual({ status: 'done' });
    expect(analyzer.init).toHaveBeenCalledTimes(1);
  });

  it('reports engine errors and loads a fresh engine on retry', async () => {
    const broken = fakeAnalyzer({ init: vi.fn(async () => Promise.reject(new Error('No network'))) });
    const working = fakeAnalyzer();
    const factory = vi.fn<() => Promise<PhotoAnalyzer>>().mockResolvedValueOnce(broken).mockResolvedValueOnce(working);
    const controller = new AnalysisController(factory, vi.fn());

    expect(await controller.run([selected('a', 0)])).toEqual({ status: 'error', message: 'No network' });
    expect(broken.close).toHaveBeenCalled();
    expect(controller.engineReady).toBe(false);

    expect(await controller.run([selected('a', 0)])).toEqual({ status: 'done' });
    expect(controller.engineReady).toBe(true);
  });

  it('keeps photos analyzed before a cancel', async () => {
    const controller = new AnalysisController(
      async () =>
        fakeAnalyzer({
          analyze: vi.fn(async () => ({ photos: [analyzed('a')], failures: [], cancelled: true })),
        }),
      vi.fn(),
    );
    expect(await controller.run([selected('a', 0), selected('b', 1)])).toEqual({ status: 'cancelled' });
    expect(controller.missing([selected('a', 0), selected('b', 1)]).map((p) => p.key)).toEqual(['b']);
  });

  it('idle() waits for a cancelled run to finish and cache the photo in progress', async () => {
    let finish = () => {};
    const analyzer = fakeAnalyzer({
      analyze: vi.fn(
        () =>
          new Promise<AnalysisOutcome>((resolve) => {
            finish = () => resolve({ photos: [analyzed('a')], failures: [], cancelled: true });
          }),
      ),
    });
    const controller = new AnalysisController(async () => analyzer, vi.fn());
    const selection = [selected('a', 0), selected('b', 1)];
    const run = controller.run(selection);
    await vi.waitFor(() => expect(analyzer.analyze).toHaveBeenCalled());

    controller.cancel();
    let idle = false;
    const waiting = controller.idle().then(() => (idle = true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(idle).toBe(false);

    finish();
    await waiting;
    expect(controller.missing(selection).map((p) => p.key)).toEqual(['b']);
    expect(await run).toEqual({ status: 'cancelled' });
    await expect(controller.idle()).resolves.toBeUndefined();
  });

  it('a Cancel right after restarting stops the new run too, and runs never overlap', async () => {
    let active = 0;
    let maxActive = 0;
    const finishers: Array<() => void> = [];
    const analyzer = fakeAnalyzer({
      // Analyzes the first file, then stops if cancelled meanwhile (like the real engine between photos).
      analyze: vi.fn((files: Parameters<PhotoAnalyzer['analyze']>[0], options?: Parameters<PhotoAnalyzer['analyze']>[1]) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        return new Promise<AnalysisOutcome>((resolve) => {
          finishers.push(() => {
            active -= 1;
            const cancelled = options?.signal?.aborted ?? false;
            const done = cancelled ? files.slice(0, 1) : files;
            resolve({ photos: done.map(({ file }) => analyzed(file.name.replace('.jpg', ''))), failures: [], cancelled });
          });
        });
      }),
    });
    const controller = new AnalysisController(async () => analyzer, vi.fn());
    const selection = [selected('a', 0), selected('b', 1), selected('c', 2)];

    // Find, Cancel, Find, Cancel, all while the first photo is still being analyzed.
    const first = controller.run(selection);
    await vi.waitFor(() => expect(analyzer.analyze).toHaveBeenCalledTimes(1));
    controller.cancel();
    const second = controller.run(selection);
    controller.cancel();
    finishers[0]();
    expect(await first).toEqual({ status: 'cancelled' });
    expect(await second).toEqual({ status: 'cancelled' });
    await controller.idle();
    expect(analyzer.analyze).toHaveBeenCalledTimes(1);

    // Find, Cancel, Find, Cancel, Find: only the last run analyzes, once the photo in progress is done.
    const third = controller.run(selection);
    await vi.waitFor(() => expect(analyzer.analyze).toHaveBeenCalledTimes(2));
    controller.cancel();
    const fourth = controller.run(selection);
    controller.cancel();
    const fifth = controller.run(selection);
    finishers[1]();
    expect(await third).toEqual({ status: 'cancelled' });
    expect(await fourth).toEqual({ status: 'cancelled' });
    await vi.waitFor(() => expect(analyzer.analyze).toHaveBeenCalledTimes(3));
    finishers[2]();
    expect(await fifth).toEqual({ status: 'done' });
    expect(controller.missing(selection)).toEqual([]);
    expect(maxActive).toBe(1);
  });
});
