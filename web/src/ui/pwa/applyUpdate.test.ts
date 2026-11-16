import { describe, expect, it, vi } from 'vitest';
import { applyUpdate, UPDATE_RELOAD_FALLBACK_MS, type UpdateEnvironment } from './applyUpdate';

function fakeEnvironment() {
  const listeners: Array<() => void> = [];
  const timers: Array<{ callback: () => void; ms: number }> = [];
  const env: UpdateEnvironment = {
    container: { addEventListener: vi.fn((_type: string, listener: () => void) => listeners.push(listener)) } as unknown as UpdateEnvironment['container'],
    reload: vi.fn(),
    setTimeout: (callback, ms) => timers.push({ callback, ms }),
  };
  return { env, controllerChange: () => listeners.forEach((listener) => listener()), timers };
}

const waitingRegistration = { waiting: {} as ServiceWorker };

describe('applyUpdate', () => {
  it('activates the waiting version and reloads once it controls the page, even on a first visit', async () => {
    const { env, controllerChange, timers } = fakeEnvironment();
    const activate = vi.fn(async () => {});

    applyUpdate(waitingRegistration, activate, env);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(env.container?.addEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function), { once: true });
    expect(env.reload).not.toHaveBeenCalled();

    controllerChange();
    expect(env.reload).toHaveBeenCalledTimes(1);
    timers[0].callback();
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads right away when another tab already activated the update', () => {
    const { env } = fakeEnvironment();
    const activate = vi.fn(async () => {});

    applyUpdate({ waiting: null }, activate, env);
    expect(env.reload).toHaveBeenCalledTimes(1);
    expect(activate).not.toHaveBeenCalled();
  });

  it('still reloads if the new version doesn’t take control in time or can’t be activated', async () => {
    const slow = fakeEnvironment();
    applyUpdate(waitingRegistration, async () => {}, slow.env);
    expect(slow.timers).toEqual([{ callback: expect.any(Function), ms: UPDATE_RELOAD_FALLBACK_MS }]);
    slow.timers[0].callback();
    expect(slow.env.reload).toHaveBeenCalledTimes(1);

    const failing = fakeEnvironment();
    applyUpdate(waitingRegistration, () => Promise.reject(new Error('gone')), failing.env);
    await vi.waitFor(() => expect(failing.env.reload).toHaveBeenCalledTimes(1));
  });
});
