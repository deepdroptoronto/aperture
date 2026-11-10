import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { cassetteManifest } from '../src/cassettes';
import { ManifestError } from '../src/errors';
import { createAperture } from '../src/platinum/engine';
import type { Manifest } from '../src/manifest';
import { post, startAperture } from './helpers';

const ADMIN = 'engine-test-admin-token';
const auth = { authorization: `Bearer ${ADMIN}` };

const harveyPath = require.resolve(path.join(__dirname, '..', 'src', 'cassettes', 'harvey.js'));
const ledgerPath = require.resolve(path.join(__dirname, '..', 'src', 'cassettes', 'ledger.js'));

const draft = {
  to: 'dana@acme.test',
  company: 'Acme Logistics',
  product: 'Aperture',
  notes: 'cutting memory spend in half without a rewrite',
};

test('a request flows through all four tiers and wakes only the cassette it needs', async (t) => {
  const harness = await startAperture({ manifest: cassetteManifest, adminToken: ADMIN });
  t.after(() => harness.close());

  const health = await fetch(`${harness.url}/health`);
  assert.equal(health.status, 200);
  assert.equal(((await health.json()) as { tier: string }).tier, 'platinum');
  assert.equal(require.cache[harveyPath], undefined, 'health must not load plugin code');

  const response = await post(`${harness.url}/cassettes/harvey/draft`, draft);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { cassette: string; result: { subject: string; body: string; draftedBy: string } };
  assert.equal(body.cassette, 'harvey');
  assert.equal(body.result.draftedBy, 'harvey');
  assert.match(body.result.subject, /Acme Logistics/);
  assert.match(body.result.body, /cutting memory spend in half/);
  assert.ok(require.cache[harveyPath], 'harvey is loaded on first use');
  assert.equal(require.cache[ledgerPath], undefined, 'other cassettes stay cold');

  const stats = (await (await fetch(`${harness.url}/stats`, { headers: auth })).json()) as {
    silver: { inflight: number; admitted: number; budgetBytes: number };
    runtime: { wakes: number; warm: string[] };
  };
  // The /stats request itself is admitted, so it is counted as in flight.
  assert.equal(stats.silver.inflight, 1);
  assert.equal(stats.runtime.wakes, 1);
  assert.deepEqual(stats.runtime.warm, ['harvey']);

  const invoice = await post(`${harness.url}/cassettes/ledger/invoices`, {
    items: [
      { description: 'Seat', quantity: 2, unitPrice: 15.5 },
      { description: 'Support', quantity: 1, unitPrice: 99 },
    ],
    taxRate: 0.13,
  });
  assert.equal(invoice.status, 200);
  const totals = (await invoice.json()) as { result: { subtotalCents: number; taxCents: number; totalCents: number } };
  assert.equal(totals.result.subtotalCents, 13_000);
  assert.equal(totals.result.taxCents, 1_690);
  assert.equal(totals.result.totalCents, 14_690);

  await harness.aperture.close();
  assert.equal(require.cache[harveyPath], undefined, 'shutdown reclaims plugin modules');
  assert.equal(require.cache[ledgerPath], undefined);
  assert.deepEqual(harness.aperture.runtime.warmCassettes(), []);
});

test('the boot proof covers core and manifest routes', async (t) => {
  const harness = await startAperture({ manifest: cassetteManifest, adminToken: ADMIN });
  t.after(() => harness.close());

  assert.deepEqual(harness.aperture.proof.core, ['GET /health', 'GET /stats', 'GET /__aperture/proof']);
  assert.deepEqual(harness.aperture.proof.manifest, [
    'POST /cassettes/harvey/draft',
    'POST /cassettes/ledger/invoices',
  ]);

  const published = (await (await fetch(`${harness.url}/__aperture/proof`, { headers: auth })).json()) as { total: number };
  assert.equal(published.total, 5);
});

test('unknown routes and wrong methods are 404s', async (t) => {
  const harness = await startAperture({ manifest: cassetteManifest });
  t.after(() => harness.close());

  assert.equal((await fetch(`${harness.url}/nope`)).status, 404);
  assert.equal((await fetch(`${harness.url}/cassettes/harvey/draft`)).status, 404);
});

test('a cassette failure is reported generically', async (t) => {
  const harness = await startAperture({ manifest: cassetteManifest });
  t.after(() => harness.close());

  const response = await post(`${harness.url}/cassettes/ledger/invoices`, { items: [] });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'cassette_failed' });
});

test('a contract violation surfaces as 502, not as plugin internals', async (t) => {
  const manifest: Manifest = {
    version: 1,
    cassettes: [{ name: 'liar', moduleId: './liar', routes: [{ method: 'POST', path: '/liar/run' }] }],
  };
  const harness = await startAperture({ manifest, rootDir: path.join(__dirname, 'fixtures') });
  t.after(() => harness.close());

  const response = await post(`${harness.url}/liar/run`, {});
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'cassette_contract', cassette: 'liar' });
});

test('boot-time configuration errors throw instead of listening', () => {
  assert.throws(() => createAperture({ manifest: cassetteManifest, budgetBytes: -1 }), RangeError);
  assert.throws(() => createAperture({ manifest: cassetteManifest, maxConcurrency: 0 }), RangeError);

  const duplicate: Manifest = {
    version: 1,
    cassettes: [
      { name: 'harvey', moduleId: './cassettes/harvey', routes: [{ method: 'POST', path: '/same' }] },
      { name: 'ledger', moduleId: './cassettes/ledger', routes: [{ method: 'POST', path: '/same' }] },
    ],
  };
  assert.throws(() => createAperture({ manifest: duplicate }), ManifestError);
});
