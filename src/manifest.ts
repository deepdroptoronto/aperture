import { ManifestError } from './errors';
import type { HttpMethod, RouteSpec } from './copper/types';

export interface CassetteRouteDeclaration {
  readonly method: HttpMethod;
  readonly path: string;
}

export interface CassetteSpec {
  /** Must match the `cassette` export of the module. */
  readonly name: string;
  /** Module id resolved relative to the runtime root, e.g. `./cassettes/harvey`. */
  readonly moduleId: string;
  readonly routes: ReadonlyArray<CassetteRouteDeclaration>;
}

export interface Manifest {
  readonly version: 1;
  readonly cassettes: ReadonlyArray<CassetteSpec>;
}

const METHODS: ReadonlyArray<HttpMethod> = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Canonical route path. Rejects wildcards and regexp groups: the Silver Cop and
 * Gold Kernel reason about literal paths, so a route it cannot name is a route
 * it cannot prove.
 */
export function normalizePath(routePath: string): string {
  if (typeof routePath !== 'string' || routePath.trim() === '') {
    throw new ManifestError('Route path must be a non-empty string');
  }
  if (!routePath.startsWith('/')) {
    throw new ManifestError(`Route path "${routePath}" must start with "/"`);
  }
  if (routePath.includes('*') || routePath.includes('(') || routePath.includes(')')) {
    throw new ManifestError(`Route path "${routePath}" must be literal (no wildcards or regexp groups)`);
  }
  const trimmed = routePath.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export function routeKey(method: string, routePath: string): string {
  return `${method.toUpperCase()} ${normalizePath(routePath)}`;
}

/** Validates the manifest and returns a frozen copy. Throws `ManifestError`. */
export function defineManifest(manifest: Manifest): Manifest {
  if (!manifest || manifest.version !== 1) {
    throw new ManifestError('Manifest must declare version 1');
  }
  if (!Array.isArray(manifest.cassettes)) {
    throw new ManifestError('Manifest cassettes must be an array');
  }

  const names = new Set<string>();
  const moduleIds = new Set<string>();
  const routes = new Set<string>();

  for (const cassette of manifest.cassettes) {
    if (!cassette || typeof cassette.name !== 'string' || !NAME_PATTERN.test(cassette.name)) {
      throw new ManifestError(`Invalid cassette name "${String(cassette?.name)}" (expected ${NAME_PATTERN})`);
    }
    if (names.has(cassette.name)) {
      throw new ManifestError(`Duplicate cassette name "${cassette.name}"`);
    }
    names.add(cassette.name);

    if (typeof cassette.moduleId !== 'string' || !cassette.moduleId.startsWith('.')) {
      throw new ManifestError(`Cassette "${cassette.name}" must declare a relative moduleId (got "${String(cassette.moduleId)}")`);
    }
    if (moduleIds.has(cassette.moduleId)) {
      throw new ManifestError(`Duplicate moduleId "${cassette.moduleId}"`);
    }
    moduleIds.add(cassette.moduleId);

    if (!Array.isArray(cassette.routes) || cassette.routes.length === 0) {
      throw new ManifestError(`Cassette "${cassette.name}" declares no routes and could never be woken`);
    }

    for (const route of cassette.routes) {
      if (!METHODS.includes(route.method)) {
        throw new ManifestError(`Cassette "${cassette.name}" declares unsupported method "${String(route.method)}"`);
      }
      const key = routeKey(route.method, route.path);
      if (routes.has(key)) {
        throw new ManifestError(`Route ${key} is declared more than once`);
      }
      routes.add(key);
    }
  }

  return Object.freeze({
    version: 1 as const,
    cassettes: Object.freeze(
      manifest.cassettes.map((cassette) =>
        Object.freeze({
          name: cassette.name,
          moduleId: cassette.moduleId,
          routes: Object.freeze(
            cassette.routes.map((route: CassetteRouteDeclaration) =>
              Object.freeze({ method: route.method, path: normalizePath(route.path) }),
            ),
          ),
        }),
      ),
    ),
  });
}

/** Flattens the manifest into the route table the kernel mounts. */
export function manifestRoutes(manifest: Manifest): RouteSpec[] {
  const out: RouteSpec[] = [];
  for (const cassette of manifest.cassettes) {
    for (const route of cassette.routes) {
      out.push({ method: route.method, path: normalizePath(route.path), cassette: cassette.name });
    }
  }
  return out;
}

export function cassetteNames(manifest: Manifest): string[] {
  return manifest.cassettes.map((cassette) => cassette.name);
}
