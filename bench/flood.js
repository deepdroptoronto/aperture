'use strict';

/**
 * Aperture flood benchmark — server isolated in its own process.
 *
 * The parent generates load; the child runs the gateway and reports its own
 * `process.memoryUsage().rss` over IPC, so client sockets and buffers are not
 * counted as server memory.
 *
 * Env:
 *   FLOOD_TOTAL=6000  FLOOD_CONCURRENCY=100  FLOOD_CAP=8  FLOOD_DELAY_MS=5
 *
 * Run with `npm run bench:flood`.
 */

const { fork } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const TOTAL = Number(process.env.FLOOD_TOTAL ?? 6000);
const CONCURRENCY = Number(process.env.FLOOD_CONCURRENCY ?? 100);
const CAP = Number(process.env.FLOOD_CAP ?? 8);
const DELAY_MS = Number(process.env.FLOOD_DELAY_MS ?? 5);
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

function mib(bytes) {
  return `${(bytes / MIB).toFixed(1)} MiB`;
}

async function send(url, delayMs) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ delayMs }),
  });
  await response.arrayBuffer();
  return response.status;
}

function main() {
  const child = fork(path.join(__dirname, 'flood-server.js'), [], {
    env: { ...process.env, FLOOD_CAP: String(CAP) },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });

  let peakRss = 0;
  const pending = new Map();

  child.on('message', (message) => {
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.type === 'rss') {
      peakRss = Math.max(peakRss, message.rss);
      return;
    }
    const resolver = pending.get(message.type);
    if (resolver) {
      pending.delete(message.type);
      resolver(message);
    }
  });

  child.once('exit', (code) => {
    for (const resolver of pending.values()) {
      resolver(null);
    }
    if (code !== 0 && code !== null) {
      console.error(`[flood] server exited with code ${code}`);
      process.exitCode = 1;
    }
  });

  const waitFor = (type, timeoutMs = 20000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(type);
        reject(new Error(`timed out waiting for the server to report "${type}"`));
      }, timeoutMs);
      pending.set(type, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });

  return (async () => {
    const ready = await waitFor('ready');
    if (!ready) {
      throw new Error('server process did not become ready');
    }

    const url = `http://127.0.0.1:${ready.port}/sleepy/run`;

    // Warm the cassette so the run measures shedding, not lazy loading.
    await send(url, 0);
    child.send({ type: 'rss-now' });
    const baselineMessage = await waitFor('rss-now');
    const baseline = baselineMessage ? baselineMessage.rss : ready.rss;
    peakRss = Math.max(peakRss, baseline);

    const statuses = new Map();
    let next = 0;

    const startedAt = performance.now();
    const worker = async () => {
      while (next < TOTAL) {
        next += 1;
        try {
          const status = await send(url, DELAY_MS);
          statuses.set(status, (statuses.get(status) ?? 0) + 1);
        } catch {
          statuses.set(0, (statuses.get(0) ?? 0) + 1);
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    const wallMs = performance.now() - startedAt;

    child.send({ type: 'stop' });
    const done = await waitFor('done');
    if (!done) {
      throw new Error('server process did not report final stats');
    }

    const count = (status) => statuses.get(status) ?? 0;
    const admitted = count(200);
    const shed = count(503);
    const errors = count(0);

    console.log(
      [
        'Aperture flood benchmark — isolated server process',
        `server     node ${process.version} · ${os.cpus().length} vCPU · ${(os.totalmem() / GIB).toFixed(1)} GiB RAM`,
        'client     this parent process (excluded from server RSS)',
        '',
        `requests            ${TOTAL}`,
        `client concurrency  ${CONCURRENCY}`,
        `admission cap       ${CAP}`,
        `cassette latency    ${DELAY_MS} ms`,
        '',
        `admitted (200)      ${admitted}`,
        `shed (503)          ${shed}`,
        `  memory reason     ${done.silver.shed.memory}`,
        `  concurrency       ${done.silver.shed.concurrency}`,
        `network errors      ${errors}`,
        `shed rate           ${TOTAL === 0 ? '0.0%' : `${((shed / TOTAL) * 100).toFixed(1)}%`}`,
        '',
        `wall clock          ${wallMs.toFixed(0)} ms (${(TOTAL / (wallMs / 1000)).toFixed(0)} req/s)`,
        `peak in-flight      ${done.silver.peakInflight}`,
        `server rss baseline ${mib(baseline)}`,
        `server rss peak     ${mib(peakRss)}`,
        `server rss final    ${mib(done.rss)}`,
        `rss delta           ${mib(done.rss - baseline)}`,
        `cassettes warm      ${done.warm.join(', ') || '(none)'}`,
      ].join('\n'),
    );
  })().finally(() => {
    child.kill('SIGTERM');
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
