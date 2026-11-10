import type { Cassette } from '../../src/copper/types';

export const cassette = 'boom';

export function create(): Cassette<Record<string, unknown>, never> {
  return {
    handle() {
      throw new Error('cassette exploded');
    },
  };
}
