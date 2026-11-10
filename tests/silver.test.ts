import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { Manifest } from '../src/manifest';
import { post, startAperture, teardownLog, waitFor } from './helpers';

const fixtures = path.join(__dirname, 'fixtures');
const MIB = 1024 * 1024;
const LOW_RSS = 20 * MIB;

beforeEach(() => {
  globalThis.__apertureTestLog = [];
});

const slowManifest: Manifest = {
  version: 1,
  cassettes: [{ name: 'slow', moduleId: './slow', routes: [{ method: 'POST', path: '/slow/run' }] }],
};

const pairManifest: Manifest = {
  version: 1,
  cassettes: [
    { name: 'alpha', moduleId: './alpha', routes: [{ method: 'POST', path: '/alpha/run' }] },
    { name: 'beta', moduleId: './beta', routes: [{ method: 'POST', path: '/beta/run' }] },
  ],
};

test('sheds on memory before the body parser ever runs', async (t) => {
  let pressure = true;
  const harness = await startAperture({
    manifest: slowManifest,
    rootDir: fixtures,
    budgetBytes: 224 * MIB,
    readRss: () => (pressure ? 300 * MIB : LOW_RSS),
  });
  t.after(() => harness.close());

  // Deliberately malformed JSON: if the body parser ran we would get a 400.
  const shed = await post(`${harness.url}/slow/run`, '{"delayMs": 0');
  assert.equal(shed.status, 503);
  assert.equal(shed.headers.get('retry-after'), '1');
  const shedBody = (await shed.json()) as { error: string; reason: string };
  assert.equal(shedBody.error, 'overloaded');
  assert.equal(shedBody.reason, 'memory');
  assert.equal(harness.aperture.runtime.isWarm('slow'), false, 'shedding must not wake a cassette');

  pressure = false;
  const admitted = await post(`${harness.url}/slow/run`, '{"delayMs": 0');
  assert.equal(admitted.status, 400);
  assert.equal(((await admitted.json()) as { error: string }).error, 'invalid_json');
});

test('caps in-flight requests and sheds the overflow', async (t) => {
  const harness = await startAperture({
    manifest: slowManifest,
    rootDir: fixtures,
    maxConcurrency: 1,
    readRss: () => LOW_RSS,
  });
  t.after(() => harness.close());

  const first = post(`${harness.url}/slow/run`, { delayMs: 200 });
  await waitFor(() => harness.aperture.silver.stats.inflight === 1, 'first request admitted');

  const overflow = await post(`${harness.url}/slow/run`, { delayMs: 0 });
  assert.equal(overflow.status, 503);
  assert.equal(((await overflow.json()) as { reason: string }).reason, 'concurrency');

  const firstResponse = await first;
  assert.equal(firstResponse.status, 200);
  assert.deepEqual(((await firstResponse.json()) as { result: unknown }).result, { slept: 200 });

  await waitFor(() => harness.aperture.silver.stats.inflight === 0, 'in-flight counter drained');
  assert.equal(harness.aperture.silver.stats.peakInflight, 1);
  assert.equal(harness.aperture.silver.stats.admitted, 1);
  assert.equal(harness.aperture.silver.stats.shed.concurrency, 1);
});

test('memory pressure tears warm cassettes down in LIFO order', async (t) => {
  let pressure = false;
  const harness = await startAperture({
    manifest: pairManifest,
    rootDir: fixtures,
    budgetBytes: 224 * MIB,
    readRss: () => (pressure ? 300 * MIB : LOW_RSS),
  });
  t.after(() => harness.close());

  assert.equal((await post(`${harness.url}/alpha/run`, {})).status, 200);
  assert.equal((await post(`${harness.url}/beta/run`, {})).status, 200);
  assert.deepEqual(harness.aperture.runtime.warmCassettes(), ['alpha', 'beta']);

  pressure = true;
  const shed = await post(`${harness.url}/alpha/run`, {});
  assert.equal(shed.status, 503);

  await waitFor(() => harness.aperture.runtime.warmCassettes().length === 0, 'all cassettes asleep');
  assert.deepEqual(teardownLog(), ['beta', 'alpha']);
});

test('a cassette with a request in flight is not torn down by memory pressure', async (t) => {
  let pressure = false;
  const harness = await startAperture({
    manifest: slowManifest,
    rootDir: fixtures,
    budgetBytes: 224 * MIB,
    readRss: () => (pressure ? 300 * MIB : LOW_RSS),
  });
  t.after(() => harness.close());

  const busy = post(`${harness.url}/slow/run`, { delayMs: 200 });
  await waitFor(() => harness.aperture.runtime.isWarm('slow'), 'slow cassette woken');

  pressure = true;
  const shed = await post(`${harness.url}/slow/run`, { delayMs: 0 });
  assert.equal(shed.status, 503);

  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(harness.aperture.runtime.isWarm('slow'), true, 'busy cassette survives the shed');

  pressure = false;
  assert.equal((await busy).status, 200);
  assert.equal(harness.aperture.runtime.isWarm('slow'), true, 'still warm until the next shed');

  // Now that it is idle, the next pressure event reclaims it.
  pressure = true;
  assert.equal((await post(`${harness.url}/slow/run`, { delayMs: 0 })).status, 503);
  await waitFor(() => harness.aperture.runtime.isWarm('slow') === false, 'idle cassette reclaimed');
});
