'use strict';

/**
 * Aperture shed benchmark.
 *
 * Measures what the Silver Cop actually admits and sheds, printed as plain
 * numbers rather than assertions:
 *   1. a burst far above the concurrency cap
 *   2. steady load below the cap (shedding must not be blanket)
 *   3. a memory budget that is over the line by construction
 *
 * Run with `npm run bench` (builds first, then executes against dist/).
 */

const path = require('node:path');
const { createAperture } = require('../dist/src/index.js');

const CASSETTES = path.join(__dirname, 'cassettes');
const MANIFEST = {
  version: 1,
  cassettes: [
    {
      name: 'sleepy',
      moduleId: './sleepy',
      routes: [{ method: 'POST', path: '/sleepy/run' }],
    },
  ],
};

async function boot(options) {
  const aperture = createAperture({ manifest: MANIFEST, rootDir: CASSETTES, ...options });
  const server = await new Promise((resolve, reject) => {
    const listening = aperture.app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const { port } = server.address();
  return {
    aperture,
    server,
    url: `http://127.0.0.1:${port}/sleepy/run`,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve()));
      await aperture.close();
    },
  };
}

function request(url, delayMs) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ delayMs }),
  }).then((response) => response.status);
}

function summarize(statuses) {
  const counts = new Map();
  for (const status of statuses) {
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return counts;
}

function format(map, key) {
  return String(map.get(key) ?? 0);
}

async function burst(harness, total, delayMs) {
  const startedAt = performance.now();
  const statuses = await Promise.all(
    Array.from({ length: total }, () =>
      request(harness.url, delayMs).catch(() => 0),
    ),
  );
  return { statuses, wallMs: performance.now() - startedAt };
}

async function pool(total, concurrency, task) {
  let next = 0;
  const statuses = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (next < total) {
      const index = next++;
      statuses.push(await task(index));
    }
  });
  await Promise.all(workers);
  return statuses;
}

function pct(part, whole) {
  return whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

async function main() {
  const lines = [];
  const push = (line) => {
    lines.push(line);
    console.log(line);
  };

  push(`Aperture shed benchmark`);
  push(`node ${process.version} · ${new Date().toISOString()}`);
  push('');

  // 1. Burst above the cap.
  {
    const cap = 8;
    const total = 200;
    const harness = await boot({ maxConcurrency: cap, budgetBytes: 224 * 1024 * 1024 });
    try {
      // Warm the cassette first so the burst measures shedding, not lazy loading.
      await request(harness.url, 0);
      const { statuses, wallMs } = await burst(harness, total, 25);
      const counts = summarize(statuses);
      const admitted = counts.get(200) ?? 0;
      const shed = counts.get(503) ?? 0;
      push(`[1] concurrency cap ${cap} · burst ${total} · 25ms cassette latency`);
      push(`    admitted (200):        ${admitted}`);
      push(`    shed (503 concurrency): ${shed}`);
      push(`    other:                 ${counts.get(0) ?? 0} network errors`);
      push(`    shed rate:             ${pct(shed, total)}`);
      push(`    wall clock:            ${wallMs.toFixed(1)} ms (${(total / (wallMs / 1000)).toFixed(0)} req/s)`);
      push(`    peak in-flight:        ${harness.aperture.silver.stats.peakInflight}`);
      push(`    shed counter:          ${harness.aperture.silver.stats.shed.concurrency}`);
      push('');
    } finally {
      await harness.close();
    }
  }

  // 2. Steady load under the cap: nothing should be shed.
  {
    const cap = 8;
    const total = 100;
    const harness = await boot({ maxConcurrency: cap, budgetBytes: 224 * 1024 * 1024 });
    try {
      const startedAt = performance.now();
      const statuses = await pool(total, 4, () => request(harness.url, 5).catch(() => 0));
      const wallMs = performance.now() - startedAt;
      const counts = summarize(statuses);
      const admitted = counts.get(200) ?? 0;
      const shed = counts.get(503) ?? 0;
      push(`[2] concurrency cap ${cap} · steady 4 concurrent · ${total} requests`);
      push(`    admitted (200):        ${admitted}`);
      push(`    shed (503):            ${shed}`);
      push(`    shed rate:             ${pct(shed, total)}`);
      push(`    wall clock:            ${wallMs.toFixed(1)} ms (${(total / (wallMs / 1000)).toFixed(0)} req/s)`);
      push('');
    } finally {
      await harness.close();
    }
  }

  // 3. Memory: budget is exceeded by construction, so admission is impossible.
  {
    const budgetBytes = 224 * 1024 * 1024;
    const total = 25;
    const harness = await boot({
      maxConcurrency: 64,
      budgetBytes,
      readRss: () => budgetBytes + 1,
    });
    try {
      const { statuses, wallMs } = await burst(harness, total, 0);
      const counts = summarize(statuses);
      const shed = counts.get(503) ?? 0;
      push(`[3] memory budget ${(budgetBytes / 1024 / 1024).toFixed(0)} MiB · rss reported budget+1 · ${total} requests`);
      push(`    shed (503 memory):     ${shed}`);
      push(`    admitted:              ${counts.get(200) ?? 0}`);
      push(`    shed rate:             ${pct(shed, total)}`);
      push(`    wall clock:            ${wallMs.toFixed(1)} ms`);
      push(`    cassettes woken:       ${harness.aperture.runtime.stats.wakes} (shedding never wakes a worker)`);
      push('');
    } finally {
      await harness.close();
    }
  }

  console.log('(scenarios are controlled: cap and RSS are injected, so the numbers describe');
  console.log(' the shed logic itself, not this machine\'s throughput.)');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
