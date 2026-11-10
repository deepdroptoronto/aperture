import type { Cassette } from '../../src/copper/types';

/** Declares a different name than the manifest expects. */
export const cassette = 'impostor';

export function create(): Cassette<Record<string, unknown>, null> {
  return {
    handle() {
      return null;
    },
  };
}
