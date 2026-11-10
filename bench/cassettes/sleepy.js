'use strict';

/**
 * Benchmark cassette: holds the request open so the concurrency cap can be
 * observed. Plain CommonJS because the loader `require`s cassettes directly.
 */

module.exports.cassette = 'sleepy';

module.exports.create = function create() {
  return {
    handle(payload) {
      const requested = Number(payload && payload.delayMs);
      const delayMs = Number.isFinite(requested) ? Math.min(Math.max(requested, 0), 2000) : 0;
      return new Promise((resolve) => {
        setTimeout(() => resolve({ slept: delayMs }), delayMs);
      });
    },
  };
};
