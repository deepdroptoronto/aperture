import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { CassetteRuntime } from '../src/copper/loader';
import { CassetteContractError } from '../src/errors';
import type { CassetteRequest } from '../src/copper/types';

const fixtures = path.join(__dirname, 'fixtures');
const alphaPath = require.resolve(path.join(fixtures, 'alpha.js'));
const liarPath = require.resolve(path.join(fixtures, 'liar.js'));

function makeRuntime(now?: () => number): CassetteRuntime {
  return new CassetteRuntime({ rootDir: fixtures, now });
}

function request(cassette: string): CassetteRequest {
  return {
    cassette,
    route: { cassette, method: 'POST', path: `/${cassette}` },
    headers: {},
  };
}

function log(): string[] {
  return globalThis.__apertureTestLog ?? [];
}

beforeEach(() => {
  globalThis.__apertureTestLog = [];
});

test('a never-woken cassette costs zero bytes', async () => {
  const runtime = makeRuntime();

  assert.equal(require.cache[alphaPath], undefined, 'cold module must not be in the require cache');
  assert.equal(runtime.isWarm('alpha'), false);
  assert.equal(runtime.stats.wakes, 0);

  const result = await runtime.invoke('alpha', './alpha', {}, request('alpha'));

  assert.deepEqual(result, { cassette: 'alpha' });
  assert.ok(require.cache[alphaPath], 'the module is only loaded on first invocation');
  assert.equal(runtime.isWarm('alpha'), true);
  assert.equal(runtime.stats.wakes, 1);
});

test('sleeping evicts the module cache entry and tears down exactly once', async () => {
  const runtime = makeRuntime();
  await runtime.invoke('alpha', './alpha', {}, request('alpha'));

  assert.equal(await runtime.sleep('alpha'), true);
  assert.equal(require.cache[alphaPath], undefined, 'evicted module can be collected');
  assert.equal(runtime.isWarm('alpha'), false);
  assert.deepEqual(log(), ['alpha']);

  assert.equal(await runtime.sleep('alpha'), false);
  await runtime.close();
  assert.deepEqual(log(), ['alpha'], 'teardown must not run twice');
});

test('concurrent sleeps and shutdown share one teardown (WeakMap guard)', async () => {
  const runtime = makeRuntime();
  await runtime.invoke('alpha', './alpha', {}, request('alpha'));

  await Promise.all([runtime.close(), runtime.sleepAll(), runtime.sleep('alpha')]);

  assert.deepEqual(log(), ['alpha']);
  assert.equal(runtime.stats.teardownFailures, 0);
});

test('teardown is LIFO: last woken, first freed', async () => {
  const runtime = makeRuntime();
  for (const name of ['alpha', 'beta', 'gamma']) {
    await runtime.invoke(name, `./${name}`, {}, request(name));
  }
  assert.deepEqual(runtime.warmCassettes(), ['alpha', 'beta', 'gamma']);

  const slept = await runtime.sleepAll();

  assert.deepEqual(slept, ['gamma', 'beta', 'alpha']);
  assert.deepEqual(log(), ['gamma', 'beta', 'alpha']);
  assert.deepEqual(runtime.warmCassettes(), []);
});

test('a contract violation is rejected and its module is not left loaded', async () => {
  const runtime = makeRuntime();

  await assert.rejects(
    runtime.invoke('liar', './liar', {}, request('liar')),
    (error: unknown) => error instanceof CassetteContractError && error.cassette === 'liar',
  );

  assert.equal(require.cache[liarPath], undefined);
  assert.equal(runtime.isWarm('liar'), false);
  assert.equal(runtime.stats.wakes, 0);
});

test('a throwing cassette releases its in-flight slot', async () => {
  const runtime = makeRuntime();

  await assert.rejects(runtime.invoke('boom', './boom', {}, request('boom')), /cassette exploded/);
  assert.equal(runtime.isWarm('boom'), true, 'a warm cassette stays warm after a failure');

  assert.equal(await runtime.sleep('boom'), true, 'and can still sleep like an idle one');
  assert.deepEqual(log(), []);
});

test('single-flight wake: concurrent first requests create one instance', async () => {
  const runtime = makeRuntime();

  await Promise.all([
    runtime.invoke('alpha', './alpha', {}, request('alpha')),
    runtime.invoke('alpha', './alpha', {}, request('alpha')),
    runtime.invoke('alpha', './alpha', {}, request('alpha')),
  ]);

  assert.equal(runtime.stats.wakes, 1);
  assert.equal(runtime.stats.invokes, 3);
});

test('sweepIdle only sleeps cassettes that have been quiet long enough', async () => {
  let clock = 1_000;
  const runtime = makeRuntime(() => clock);
  await runtime.invoke('alpha', './alpha', {}, request('alpha'));

  clock += 5_000;
  assert.deepEqual(await runtime.sweepIdle(10_000), []);

  clock += 6_000;
  assert.deepEqual(await runtime.sweepIdle(10_000), ['alpha']);
  assert.deepEqual(log(), ['alpha']);
});

test('a closed runtime refuses new work', async () => {
  const runtime = makeRuntime();
  await runtime.close();

  await assert.rejects(runtime.invoke('alpha', './alpha', {}, request('alpha')), /closed/);
});
