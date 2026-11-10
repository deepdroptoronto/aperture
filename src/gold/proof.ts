// 🥇 The Gold Kernel: The Elite. No route mounts without proof.
import { createRequire } from 'node:module';
import type { Express } from 'express';
import { MissingRouteError, RogueRouteError, RouteOwnershipError, UnprovableRouteError } from '../errors';
import { normalizePath, routeKey } from '../manifest';
import type { RouteSpec } from '../copper/types';

/** Set on every handler the kernel installs; the proof reads it back. */
export const ROUTE_OWNER: unique symbol = Symbol.for('aperture.route-owner');

const MAX_ROUTER_DEPTH = 8;

export interface CoreRoute {
  method: string;
  path: string;
}

export interface MountedRoute {
  method: string;
  path: string;
  owner: string | undefined;
}

export interface MountProof {
  verifiedAt: number;
  /** Routes the Platinum core is allowed to own. */
  core: string[];
  /** Routes the manifest declared, as `METHOD /path`. */
  manifest: string[];
  total: number;
}

interface RouteLayer {
  path?: unknown;
  methods?: Record<string, boolean>;
  stack?: Array<{ handle?: unknown }>;
}

interface LayerLike {
  name?: string;
  route?: RouteLayer;
  handle?: { stack?: LayerLike[] };
  regexp?: { fast_slash?: boolean };
}

const nodeRequire: NodeRequire = createRequire(__filename);
let expressMajor: number | undefined;

function supportedExpressMajor(): number {
  if (expressMajor === undefined) {
    try {
      const pkg = nodeRequire('express/package.json') as { version?: string };
      const major = Number.parseInt(String(pkg.version ?? '4').split('.')[0] ?? '4', 10);
      expressMajor = Number.isInteger(major) ? major : 4;
    } catch {
      expressMajor = 4;
    }
  }
  return expressMajor;
}

function appStack(app: Express): LayerLike[] {
  const router = (app as unknown as { _router?: { stack?: LayerLike[] } })._router;
  if (router && Array.isArray(router.stack)) {
    return router.stack;
  }
  // Express 4 creates `_router` lazily on the first route/middleware, so a
  // missing router means a provably empty table. Any other Express major uses a
  // different shape; refuse rather than guess at it.
  const major = supportedExpressMajor();
  if (major !== 4) {
    throw new UnprovableRouteError(`Route proof supports Express 4 only (found ${major}.x); refusing to guess at the route table`);
  }
  return [];
}

function walk(stack: LayerLike[], prefix: string, out: MountedRoute[], depth: number): void {
  if (depth > MAX_ROUTER_DEPTH) {
    throw new UnprovableRouteError('Router nesting is too deep to prove');
  }

  for (const layer of stack) {
    if (layer.route) {
      const routePath = layer.route.path;
      if (typeof routePath !== 'string') {
        throw new UnprovableRouteError('Route paths must be literal strings to be provable');
      }
      const full = normalizePath(prefix === '' ? routePath : `${prefix}${routePath}`);
      const methods = layer.route.methods ?? {};
      const handlers = layer.route.stack ?? [];
      const handle = handlers[handlers.length - 1]?.handle as Record<symbol, unknown> | undefined;
      const owner = handle?.[ROUTE_OWNER];
      for (const method of Object.keys(methods)) {
        if (method === '_all') {
          continue;
        }
        out.push({
          method: method.toUpperCase(),
          path: full,
          owner: typeof owner === 'string' ? owner : undefined,
        });
      }
      continue;
    }

    const nested = layer.handle?.stack;
    if (layer.name === 'router' && Array.isArray(nested)) {
      // A router mounted at a path cannot be resolved back to a literal prefix
      // reliably, so we fail closed instead of claiming a proof we cannot make.
      if (!layer.regexp?.fast_slash) {
        throw new UnprovableRouteError('Routers must be mounted at the root to be provable; mount manifest routes on the app instead');
      }
      walk(nested, prefix, out, depth + 1);
    }
  }
}

/** Reads the live route table out of Express. */
export function collectRoutes(app: Express): MountedRoute[] {
  const routes: MountedRoute[] = [];
  walk(appStack(app), '', routes, 0);
  return routes;
}

export interface ProveOptions {
  app: Express;
  coreRoutes: ReadonlyArray<CoreRoute>;
  manifestRoutes: ReadonlyArray<RouteSpec>;
  now?: () => number;
}

/**
 * 🥇 Gold Kernel proof.
 *
 * Compares what is actually mounted against what the manifest (plus the small
 * core allowlist) says may exist. Anything extra, anything missing, and
 * anything served by a handler the kernel did not install is a boot failure.
 */
export function proveRoutes(options: ProveOptions): MountProof {
  const actual = collectRoutes(options.app);

  const expected = new Map<string, string | null>();
  for (const route of options.coreRoutes) {
    expected.set(routeKey(route.method, route.path), null);
  }
  for (const route of options.manifestRoutes) {
    expected.set(routeKey(route.method, route.path), route.cassette);
  }

  const seen = new Set<string>();
  const rogue: string[] = [];
  const stolen: string[] = [];

  for (const route of actual) {
    const key = routeKey(route.method, route.path);
    if (!expected.has(key)) {
      rogue.push(key);
      continue;
    }
    if (seen.has(key)) {
      rogue.push(`${key} (registered twice)`);
      continue;
    }
    seen.add(key);

    const owner = expected.get(key) ?? null;
    if ((route.owner ?? null) !== owner) {
      stolen.push(`${key} (expected ${owner ?? 'core'}, found ${route.owner ?? 'unowned'})`);
    }
  }

  if (rogue.length > 0) {
    throw new RogueRouteError(rogue);
  }
  if (stolen.length > 0) {
    throw new RouteOwnershipError(stolen);
  }

  const missing = [...expected.keys()].filter((key) => !seen.has(key));
  if (missing.length > 0) {
    throw new MissingRouteError(missing);
  }

  return {
    verifiedAt: (options.now ?? Date.now)(),
    core: options.coreRoutes.map((route) => routeKey(route.method, route.path)),
    manifest: options.manifestRoutes.map((route) => routeKey(route.method, route.path)),
    total: expected.size,
  };
}

