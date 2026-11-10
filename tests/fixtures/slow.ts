import type { Cassette } from '../../src/copper/types';

export const cassette = 'slow';

export interface SlowPayload {
  delayMs?: number;
}

export function create(): Cassette<SlowPayload, { slept: number }> {
  return {
    handle(payload) {
      const requested = Number(payload.delayMs ?? 0);
      const delayMs = Number.isFinite(requested) ? Math.min(Math.max(requested, 0), 2000) : 0;
      return new Promise((resolve) => {
        setTimeout(() => resolve({ slept: delayMs }), delayMs);
      });
    },
    teardown() {
      (globalThis.__apertureTestLog ??= []).push('slow');
    },
  };
}
