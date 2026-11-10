import type { Cassette } from '../../src/copper/types';

export const cassette = 'gamma';

export function create(): Cassette<Record<string, unknown>, { cassette: string }> {
  return {
    handle() {
      return { cassette: 'gamma' };
    },
    teardown() {
      (globalThis.__apertureTestLog ??= []).push('gamma');
    },
  };
}
