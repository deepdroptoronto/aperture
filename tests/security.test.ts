import test from 'node:test';
import assert from 'node:assert/strict';
import { cassetteManifest } from '../src/cassettes';
import { startAperture } from './helpers';

const ADMIN = 'admin-token-for-tests-0123456789';
const auth = { authorization: `Bearer ${ADMIN}` };

function assertBaselineHeaders(response: Response, label: string): void {
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff', `${label}: nosniff`);
  assert.equal(response.headers.get('x-frame-options'), 'DENY', `${label}: frame options`);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer', `${label}: referrer policy`);
  assert.equal(
    response.headers.get('content-security-policy'),
    "default-src 'none'; frame-ancestors 'none'",
    `${label}: CSP`,
  );
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin', `${label}: CORP`);
  assert.equal(response.headers.get('x-powered-by'), null, `${label}: x-powered-by must be absent`);
}

test('baseline headers are present on success, 404 and shed 503 responses', async (t) => {
  const healthy = await startAperture({ manifest: cassetteManifest, adminToken: ADMIN });
  t.after(() => healthy.close());

  assertBaselineHeaders(await fetch(`${healthy.url}/health`), '200');
  assertBaselineHeaders(await fetch(`${healthy.url}/nope`), '404');

  const pressured = await startAperture({
    manifest: cassetteManifest,
    adminToken: ADMIN,
    budgetBytes: 1024,
    readRss: () => 2048,
  });
  t.after(() => pressured.close());

  const shed = await fetch(`${pressured.url}/health`);
  assert.equal(shed.status, 503);
  assertBaselineHeaders(shed, '503');
});

test('admin routes reject a missing or wrong bearer token', async (t) => {
  const harness = await startAperture({ manifest: cassetteManifest, adminToken: ADMIN });
  t.after(() => harness.close());

  const missing = await fetch(`${harness.url}/stats`);
  assert.equal(missing.status, 401);
  assert.match(missing.headers.get('www-authenticate') ?? '', /^Bearer /);
  assert.deepEqual(await missing.json(), { error: 'unauthorized' });

  const wrong = await fetch(`${harness.url}/__aperture/proof`, {
    headers: { authorization: 'Bearer not-the-token' },
  });
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), { error: 'unauthorized' });

  const basicScheme = await fetch(`${harness.url}/stats`, {
    headers: { authorization: `Basic ${ADMIN}` },
  });
  assert.equal(basicScheme.status, 401);
});

test('a valid bearer token unlocks stats and proof, with no-store', async (t) => {
  const harness = await startAperture({ manifest: cassetteManifest, adminToken: ADMIN });
  t.after(() => harness.close());

  const stats = await fetch(`${harness.url}/stats`, { headers: auth });
  assert.equal(stats.status, 200);
  assert.equal(stats.headers.get('cache-control'), 'no-store');
  const statsBody = (await stats.json()) as { silver: { maxConcurrency: number }; runtime: { warm: string[] } };
  assert.equal(statsBody.silver.maxConcurrency, 64);
  assert.deepEqual(statsBody.runtime.warm, []);

  const proof = await fetch(`${harness.url}/__aperture/proof`, { headers: auth });
  assert.equal(proof.status, 200);
  assert.equal(((await proof.json()) as { total: number }).total, 5);

  // The scheme is matched case-insensitively, the token is not.
  const lower = await fetch(`${harness.url}/stats`, { headers: { authorization: `bearer ${ADMIN}` } });
  assert.equal(lower.status, 200);
});

test('admin routes are absent, not merely locked, when no token is configured', async (t) => {
  const harness = await startAperture({ manifest: cassetteManifest });
  t.after(() => harness.close());

  for (const path of ['/stats', '/__aperture/proof']) {
    const response = await fetch(`${harness.url}${path}`);
    assert.equal(response.status, 404, `${path} must not exist`);
    assert.deepEqual(await response.json(), { error: 'not_found', path });
  }

  assert.equal((await fetch(`${harness.url}/health`)).status, 200);

  // An empty token is treated as "not configured", not as an empty password.
  const blank = await startAperture({ manifest: cassetteManifest, adminToken: '   ' });
  t.after(() => blank.close());
  assert.equal((await fetch(`${blank.url}/stats`)).status, 404);
});

test('a wrong-length token fails closed without crashing the process', async (t) => {
  const harness = await startAperture({ manifest: cassetteManifest, adminToken: ADMIN });
  t.after(() => harness.close());

  for (const token of ['x', 'a'.repeat(200)]) {
    const response = await fetch(`${harness.url}/stats`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 401);
  }

  assert.equal((await fetch(`${harness.url}/health`)).status, 200);
});
