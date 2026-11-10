'use strict';

/**
 * Aperture flood benchmark — server isolated in its own process.
 *
 * The parent generates load; the child runs the gateway and reports its own
 * `process.memoryUsage().rss` over IPC, so client sockets and buffers are not
 * counted as server memory.
 *
 * Three scenarios:
 *   1. global cap only (fairness off) — the published 6,000-request run
 *   2. one greedy client, fairness on — it can only hold its own slots
 *   3. two clients, fairness on — one client's flood does not starve the other
 *
 * Fairness scenarios key clients by `X-Forwarded-For`, so a single load
 * generator can behave as distinct clients.
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
const GLOBAL_CAP = 8;
const CLIENT_SLOTS = 2;

function mib(bytes) {
  return `${(bytes / MIB).toFixed(1)} MiB`;
}

function pct(part, whole) {
  return whole === 0 ? '0.0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

/**
 * Sends a burst through a fixed pool of in-flight requests, tagging each with a
 * client identity when fairness is on.
 */
async function burst(send, { total, concurrency, delayMs, client }) {
  const statuses = [];
  let next = 0;

  const startedAt = performance.now();
  const workers = Array.from({ length: concurrency }, async () => {
    while (next < total) {
      next += 1;
      try {
        statuses.push(await send(delayMs, client));
      } catch {
        statuses.push(0);
      }
    }
  });
  await Promise.all(workers);

  return { statuses, wallMs: performance.now() - startedAt };
}

function tally(statuses) {
  const counts = new Map();
  for (const status of statuses) {
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return counts;
}

/** Boots a server for the duration of `body`, then tears it down. */
async function withServer(env, body) {
  const child = fork(path.join(__dirname, 'flood-server.js'), [], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });

  const pending = new Map();
  let peakRss = 0;

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

  const waitFor = (type, timeoutMs = 30000) =>
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

  try {
    const ready = await waitFor('ready');
    const url = `http://127.0.0.1:${ready.port}/sleepy/run`;

    const send = async (delayMs, client) => {
      const headers = { 'content-type': 'application/json' };
      if (client) {
        headers['x-forwarded-for'] = client;
      }
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ delayMs }),
      });
      await response.arrayBuffer();
      return response.status;
    };

    // Warm the cassette so the run measures shedding, not lazy loading.
    await send(0);
    child.send({ type: 'rss-now' });
    const baselineMessage = await waitFor('rss-now');
    const baseline = baselineMessage ? baselineMessage.rss : ready.rss;
    peakRss = Math.max(peakRss, baseline);

    const result = await body({ send });

    child.send({ type: 'stop' });
    const done = await waitFor('done');
    if (!done) {
      throw new Error('server process did not report final stats');
    }

    return { result, done, baseline, peakRss };
  } finally {
    child.kill('SIGTERM');
  }
}

async function globalCapScenario() {
  const { result, done, baseline, peakRss } = await withServer(
    { FLOOD_CAP: String(CAP), FLOOD_CLIENT_MODE: 'off', FLOOD_DELAY_MS: String(DELAY_MS) },
    ({ send }) => burst(send, { total: TOTAL, concurrency: CONCURRENCY, delayMs: DELAY_MS }),
  );

  const counts = tally(result.statuses);
  const admitted = counts.get(200) ?? 0;
  const shed = counts.get(503) ?? 0;

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
      `network errors      ${counts.get(0) ?? 0}`,
      `shed rate           ${pct(shed, TOTAL)}`,
      '',
      `wall clock          ${result.wallMs.toFixed(0)} ms (${(TOTAL / (result.wallMs / 1000)).toFixed(0)} req/s)`,
      `peak in-flight      ${done.silver.peakInflight}`,
      `server rss baseline ${mib(baseline)}`,
      `server rss peak     ${mib(peakRss)}`,
      `server rss final    ${mib(done.rss)}`,
      `rss delta           ${mib(done.rss - baseline)}`,
      `cassettes warm      ${done.warm.join(', ') || '(none)'}`,
      '',
    ].join('\n'),
  );
}

async function singleGreedyClientScenario() {
  const total = 200;
  const concurrency = 50;
  const client = '198.51.100.10';

  const { result, done } = await withServer(
    {
      FLOOD_CAP: String(GLOBAL_CAP),
      FLOOD_CLIENT_MODE: 'on',
      FLOOD_CLIENT_SLOTS: String(CLIENT_SLOTS),
      FLOOD_CLIENT_RATE: '0',
      FLOOD_TRUST_PROXY: 'true',
    },
    ({ send }) => burst(send, { total, concurrency, delayMs: 25, client }),
  );

  const counts = tally(result.statuses);
  const admitted = counts.get(200) ?? 0;
  const refused = counts.get(503) ?? 0;

  console.log(
    [
      `[fairness] one client · ${CLIENT_SLOTS} slots · cap ${GLOBAL_CAP} · ${total} requests @ ${concurrency} concurrent`,
      `  admitted (200)            ${admitted}`,
      `  refused (503 client slot) ${done.silver.shed['client-concurrency']}`,
      `  refused (429 client rate) ${done.silver.shed['client-rate']}`,
      `  shed by global cap        ${done.silver.shed.concurrency}`,
      `  peak in-flight            ${done.silver.peakInflight} (client share is ${CLIENT_SLOTS})`,
      `  wall clock                ${result.wallMs.toFixed(0)} ms · shed rate ${pct(refused, total)}`,
      '',
    ].join('\n'),
  );
}

async function twoClientScenario() {
  const perClient = 40;
  const concurrency = 20;
  const clients = ['198.51.100.20', '198.51.100.21'];

  const { result, done } = await withServer(
    {
      FLOOD_CAP: String(GLOBAL_CAP),
      FLOOD_CLIENT_MODE: 'on',
      FLOOD_CLIENT_SLOTS: String(CLIENT_SLOTS),
      FLOOD_CLIENT_RATE: '0',
      FLOOD_TRUST_PROXY: 'true',
    },
    async ({ send }) => {
      const runs = await Promise.all(
        clients.map((client) => burst(send, { total: perClient, concurrency, delayMs: 30, client })),
      );
      return { runs };
    },
  );

  console.log(
    `[fairness] two clients · ${CLIENT_SLOTS} slots each · cap ${GLOBAL_CAP} · ${perClient} requests each @ ${concurrency} concurrent`,
  );

  for (const [index, run] of result.runs.entries()) {
    const counts = tally(run.statuses);
    console.log(
      `  client ${clients[index]}  admitted ${counts.get(200) ?? 0} · refused ${counts.get(503) ?? 0} · rate-limited ${counts.get(429) ?? 0}`,
    );
  }

  console.log(`  shed by global cap        ${done.silver.shed.concurrency}`);
  console.log(`  peak in-flight            ${done.silver.peakInflight}`);
  console.log('');
  console.log('(fairness scenarios key clients by X-Forwarded-For; the engine trusts the');
  console.log(' header only because FLOOD_TRUST_PROXY=true in this harness.)');
}

async function main() {
  await globalCapScenario();
  await singleGreedyClientScenario();
  await twoClientScenario();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
