// Cooperative scheduling for long main-thread work.

/** Thrown inside an analysis when its AbortSignal fires; never surfaces to callers. */
export class AnalysisCancelled extends Error {
  constructor() {
    super('Analysis cancelled');
    this.name = 'AnalysisCancelled';
  }
}

/**
 * Resolves in a new macrotask, letting the browser repaint and handle input (e.g. a Cancel tap) first.
 * MessageChannel instead of setTimeout: not clamped to 4 ms and not throttled in background tabs.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/**
 * Returns a checkpoint for long synchronous loops: it yields to the event loop when at least `sliceMs` passed
 * since the last yield, then throws AnalysisCancelled if `signal` was aborted meanwhile.
 */
export function createCheckpoint(signal: AbortSignal | undefined, sliceMs: number): () => Promise<void> {
  let last = performance.now();
  return async () => {
    if (performance.now() - last >= sliceMs) {
      await yieldToEventLoop();
      last = performance.now();
    }
    if (signal?.aborted) throw new AnalysisCancelled();
  };
}
