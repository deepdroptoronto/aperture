import type { Cassette } from '../../src/copper/types';

export const cassette = 'alpha';

export function create(): Cassette<Record<string, unknown>, { cassette: string }> {
  return {
    handle() {
      return { cassette: 'alpha' };
    },
    teardown() {
      (globalThis.__apertureTestLog ??= []).push('alpha');
    },
  };
}
