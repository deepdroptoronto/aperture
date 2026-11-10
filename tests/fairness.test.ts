import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { Manifest } from '../src/manifest';
import { createAperture } from '../src/platinum/engine';
import { post, startAperture, waitFor } from './helpers';

const fixtures = path.join(__dirname, 'fixtures');
const MIB = 1024 * 1024;
const LOW_RSS = 20 * MIB;

const slowManifest: Manifest = {
  version: 1,
  cassettes: [{ name: 'slow', moduleId: './slow', routes: [{ method: 'POST', path: '/slow/run' }] }],
};

function from(ip: string): Record<string, string> {
  return { 'x-forwarded-for': ip };
}

test('one client cannot hold more than its share of slots', async (t) => {
  const harness = await startAperture({
    manifest: slowManifest,
    rootDir: fixtures,
    maxConcurrency: 8,
    readRss: () => LOW_RSS,
    clientLimits: { maxConcurrency: 2, ratePerSecond: 0 },
  });
  t.after(() => harness.close());

  const responses = await Promise.all(
    Array.from({ length: 6 }, () => post(`${harness.url}/slow/run`, { delayMs: 150 })),
  );
  const admitted = responses.filter((response) => response.status === 200);
  const refused = responses.filter((response) => response.status === 503);

  assert.equal(admitted.length, 2, 'exactly the client share is admitted');
  assert.equal(refused.length, 4, 'the rest are refused, not queued');
  for (const response of refused) {
    assert.equal(((await response.json()) as { reason: string }).reason, 'client-concurrency');
  }
  assert.equal(harness.aperture.silver.stats.shed['client-concurrency'], 4);
  assert.equal(harness.aperture.silver.stats.peakInflight, 2, 'the global cap of 8 was never reached');
});

test('a client over its request rate gets 429, and is not counted as admitted', async (t) => {
  const harness = await startAperture({
    manifest: slowManifest,
    rootDir: fixtures,
    maxConcurrency: 8,
    readRss: () => LOW_RSS,
    clientLimits: { ratePerSecond: 0.001, burst: 2, maxConcurrency: 0 },
  });
  t.after(() => harness.close());

  assert.equal((await post(`${harness.url}/slow/run`, { delayMs: 0 })).status, 200);
  assert.equal((await post(`${harness.url}/slow/run`, { delayMs: 0 })).status, 200);

  const limited = await post(`${harness.url}/slow/run`, { delayMs: 0 });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '1');
  assert.deepEqual(
    (({ error, reason }) => ({ error, reason }))(
      (await limited.json()) as { error: string; reason: string },
    ),
    { error: 'rate_limited', reason: 'client-rate' },
  );
  assert.equal(harness.aperture.silver.stats.shed['client-rate'], 1);
  assert.equal(harness.aperture.silver.stats.admitted, 2);
});

test('distinct proxied clients get independent buckets', async (t) => {
  const harness = await startAperture({
    manifest: slowManifest,
    rootDir: fixtures,
    trustProxy: true,
    maxConcurrency: 8,
    readRss: () => LOW_RSS,
    clientLimits: { maxConcurrency: 1, ratePerSecond: 0 },
  });
  t.after(() => harness.close());

  const busy = post(`${harness.url}/slow/run`, { delayMs: 200 }, { headers: from('10.0.0.1') });
  await waitFor(() => harness.aperture.silver.stats.inflight === 1, 'first client admitted');

  const greedyAgain = await post(`${harness.url}/slow/run`, { delayMs: 0 }, { headers: from('10.0.0.1') });
  assert.equal(greedyAgain.status, 503);
  assert.equal(((await greedyAgain.json()) as { reason: string }).reason, 'client-concurrency');

  const otherClient = await post(`${harness.url}/slow/run`, { delayMs: 0 }, { headers: from('10.0.0.2') });
  assert.equal(otherClient.status, 200, 'a different client is unaffected');

  assert.equal((await busy).status, 200);
});

test('X-Forwarded-For is ignored when trustProxy is off, so it cannot be spoofed', async (t) => {
  const harness = await startAperture({
    manifest: slowManifest,
    rootDir: fixtures,
    maxConcurrency: 8,
    readRss: () => LOW_RSS,
    clientLimits: { maxConcurrency: 1, ratePerSecond: 0 },
  });
  t.after(() => harness.close());

  const busy = post(`${harness.url}/slow/run`, { delayMs: 200 }, { headers: from('10.0.0.1') });
  await waitFor(() => harness.aperture.silver.stats.inflight === 1, 'first client admitted');

  const spoofed = await post(`${harness.url}/slow/run`, { delayMs: 0 }, { headers: from('203.0.113.9') });
  assert.equal(spoofed.status, 503, 'a forged header must not mint a new bucket');
  assert.equal(((await spoofed.json()) as { reason: string }).reason, 'client-concurrency');

  assert.equal((await busy).status, 200);
});

test('the tracked-client map is bounded', async (t) => {
  const harness = await startAperture({
    manifest: slowManifest,
    rootDir: fixtures,
    trustProxy: true,
    maxConcurrency: 8,
    readRss: () => LOW_RSS,
    clientLimits: { maxConcurrency: 0, ratePerSecond: 0, maxClients: 2 },
  });
  t.after(() => harness.close());

  for (const ip of ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4', '10.0.0.5']) {
    assert.equal((await post(`${harness.url}/slow/run`, { delayMs: 0 }, { headers: from(ip) })).status, 200);
  }

  assert.ok(harness.aperture.silver.stats.clients <= 2, 'idle clients are evicted');
});

test('invalid fairness configuration fails at boot', () => {
  assert.throws(
    () => createAperture({ manifest: slowManifest, clientLimits: { maxConcurrency: -1 } }),
    RangeError,
  );
  assert.throws(
    () => createAperture({ manifest: slowManifest, clientLimits: { ratePerSecond: -1 } }),
    RangeError,
  );
  assert.throws(
    () => createAperture({ manifest: slowManifest, clientLimits: { burst: 0 } }),
    RangeError,
  );
  assert.throws(
    () => createAperture({ manifest: slowManifest, clientLimits: { maxClients: 0 } }),
    RangeError,
  );
});
