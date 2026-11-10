import test from 'node:test';
import assert from 'node:assert/strict';
import express, { type Express, type RequestHandler } from 'express';
import {
  ManifestError,
  MissingRouteError,
  RogueRouteError,
  RouteOwnershipError,
  UnprovableRouteError,
} from '../src/errors';
import { collectRoutes, proveRoutes, ROUTE_OWNER } from '../src/gold/proof';
import { defineManifest, type Manifest } from '../src/manifest';
import type { RouteSpec } from '../src/copper/types';

const ok: RequestHandler = (_req, res) => {
  res.end('ok');
};

const coreRoutes = [{ method: 'GET', path: '/health' }];
const harveyRoute: RouteSpec = { method: 'POST', path: '/cassettes/harvey/draft', cassette: 'harvey' };

function owned(cassette: string, handler: RequestHandler = ok): RequestHandler {
  const tagged: RequestHandler = (req, res, next) => handler(req, res, next);
  Object.defineProperty(tagged, ROUTE_OWNER, { value: cassette, enumerable: false });
  return tagged;
}

function baseApp(): Express {
  const app = express();
  app.get('/health', ok);
  return app;
}

test('a clean table proves, and the proof lists core and manifest routes', () => {
  const app = baseApp();
  app.post(harveyRoute.path, owned('harvey'));

  const proof = proveRoutes({ app, coreRoutes, manifestRoutes: [harveyRoute] });

  assert.equal(proof.total, 2);
  assert.deepEqual(proof.core, ['GET /health']);
  assert.deepEqual(proof.manifest, ['POST /cassettes/harvey/draft']);
  assert.ok(proof.verifiedAt > 0);
  assert.equal(collectRoutes(app).length, 2);
});

test('a fresh app has no phantom routes', () => {
  assert.deepEqual(collectRoutes(express()), []);
});

test('refuses to boot when a route exists outside the manifest', () => {
  const app = baseApp();
  app.get('/backdoor', ok);

  assert.throws(
    () => proveRoutes({ app, coreRoutes, manifestRoutes: [] }),
    (error: unknown) => error instanceof RogueRouteError && error.routes.includes('GET /backdoor'),
  );
});

test('refuses to boot on duplicate route registrations', () => {
  const app = baseApp();
  app.get('/health', ok);

  assert.throws(
    () => proveRoutes({ app, coreRoutes, manifestRoutes: [] }),
    (error: unknown) => error instanceof RogueRouteError && error.routes.some((route) => route.includes('registered twice')),
  );
});

test('refuses to boot when a declared route is served by a handler it did not install', () => {
  const app = baseApp();
  app.post(harveyRoute.path, ok);

  assert.throws(
    () => proveRoutes({ app, coreRoutes, manifestRoutes: [harveyRoute] }),
    (error: unknown) => error instanceof RouteOwnershipError && error.routes.length === 1,
  );
});

test('refuses to boot when a declared route is missing', () => {
  const app = baseApp();

  assert.throws(
    () => proveRoutes({ app, coreRoutes, manifestRoutes: [harveyRoute] }),
    (error: unknown) => error instanceof MissingRouteError && error.routes.includes('POST /cassettes/harvey/draft'),
  );
});

test('fails closed on a router mounted at a path it cannot resolve', () => {
  const app = baseApp();
  const router = express.Router();
  router.get('/inside', ok);
  app.use('/api', router);

  assert.throws(() => proveRoutes({ app, coreRoutes, manifestRoutes: [] }), UnprovableRouteError);
});

test('can prove a router mounted at the root', () => {
  const app = baseApp();
  const router = express.Router();
  router.get('/inside', owned('harvey'));
  app.use(router);

  const proof = proveRoutes({
    app,
    coreRoutes,
    manifestRoutes: [{ method: 'GET', path: '/inside', cassette: 'harvey' }],
  });

  assert.deepEqual(proof.manifest, ['GET /inside']);
});

test('manifest validation rejects duplicate, wildcard, empty and misnamed declarations', () => {
  const base: Manifest = {
    version: 1,
    cassettes: [{ name: 'harvey', moduleId: './cassettes/harvey', routes: [{ method: 'POST', path: '/a' }] }],
  };

  assert.throws(
    () =>
      defineManifest({
        ...base,
        cassettes: [...base.cassettes, { name: 'ledger', moduleId: './cassettes/ledger', routes: [{ method: 'POST', path: '/a' }] }],
      }),
    ManifestError,
  );
  assert.throws(
    () => defineManifest({ ...base, cassettes: [{ ...base.cassettes[0]!, routes: [{ method: 'POST', path: '/a/*' }] }] }),
    ManifestError,
  );
  assert.throws(
    () => defineManifest({ ...base, cassettes: [{ ...base.cassettes[0]!, routes: [] }] }),
    ManifestError,
  );
  assert.throws(
    () => defineManifest({ ...base, cassettes: [{ ...base.cassettes[0]!, name: 'Harvey' }] }),
    ManifestError,
  );
  assert.throws(() => defineManifest({ ...base, version: 2 as 1 }), ManifestError);
});

test('a valid manifest is frozen and its paths are normalized', () => {
  const manifest = defineManifest({
    version: 1,
    cassettes: [{ name: 'harvey', moduleId: './cassettes/harvey', routes: [{ method: 'POST', path: '/cassettes/harvey/draft/' }] }],
  });

  assert.ok(Object.isFrozen(manifest));
  assert.equal(manifest.cassettes[0]!.routes[0]!.path, '/cassettes/harvey/draft');
});
