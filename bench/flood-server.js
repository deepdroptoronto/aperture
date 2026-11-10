'use strict';

/**
 * Server process for the flood benchmark.
 *
 * Runs in its own Node process so the load generator's sockets and buffers never
 * pollute the RSS numbers it reports over IPC.
 */

const path = require('node:path');
const { createAperture } = require('../dist/src/index.js');

const MIB = 1024 * 1024;

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

const aperture = createAperture({
  manifest: MANIFEST,
  rootDir: path.join(__dirname, 'cassettes'),
  maxConcurrency: Number(process.env.FLOOD_CAP ?? 8),
  budgetBytes: 224 * MIB,
  // Fairness would throttle a single load generator long before the global cap,
  // so it is disabled here: this harness measures the global admission cap.
  clientLimits: false,
});

const server = aperture.app.listen(0, '127.0.0.1', () => {
  if (process.send) {
    process.send({ type: 'ready', port: server.address().port, pid: process.pid, rss: process.memoryUsage().rss });
  }
});

const sampler = setInterval(() => {
  if (process.send) {
    process.send({ type: 'rss', rss: process.memoryUsage().rss });
  }
}, 50);
sampler.unref();

let stopping = false;

async function shutdown() {
  if (stopping) {
    return;
  }
  stopping = true;
  clearInterval(sampler);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
  await aperture.close();
}

process.on('message', (message) => {
  if (!message || typeof message !== 'object') {
    return;
  }
  if (message.type === 'rss-now') {
    if (process.send) {
      process.send({ type: 'rss-now', rss: process.memoryUsage().rss });
    }
    return;
  }
  if (message.type === 'stop') {
    const report = {
      type: 'done',
      rss: process.memoryUsage().rss,
      silver: aperture.silver.stats,
      runtime: aperture.runtime.stats,
      warm: aperture.runtime.warmCassettes(),
    };
    if (process.send) {
      process.send(report);
    }
    void shutdown().then(() => process.exit(0));
  }
});

process.once('SIGTERM', () => {
  void shutdown().then(() => process.exit(0));
});
