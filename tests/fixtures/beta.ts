import type { Cassette } from '../../src/copper/types';

export const cassette = 'beta';

export function create(): Cassette<Record<string, unknown>, { cassette: string }> {
  return {
    handle() {
      return { cassette: 'beta' };
    },
    teardown() {
      (globalThis.__apertureTestLog ??= []).push('beta');
    },
  };
}
