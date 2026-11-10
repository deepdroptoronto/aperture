import type { Express, RequestHandler } from 'express';
import type { CassetteRuntime } from '../copper/loader';
import type { HttpMethod, RouteSpec } from '../copper/types';
import { manifestRoutes, type Manifest } from '../manifest';
import { proveRoutes, ROUTE_OWNER, type CoreRoute, type MountProof } from './proof';

export interface GoldenKernel {
  readonly proof: MountProof;
  /** Re-runs the proof against the live router. Throws if anything changed. */
  reprove(): MountProof;
}

export interface KernelOptions {
  app: Express;
  manifest: Manifest;
  runtime: CassetteRuntime;
  coreRoutes: ReadonlyArray<CoreRoute>;
  now?: () => number;
  onError?: (error: unknown, cassette: string | undefined) => void;
}

type Register = (path: string, handler: RequestHandler) => void;

const REGISTER: Record<HttpMethod, (app: Express) => Register> = {
  GET: (app) => (path, handler) => app.get(path, handler),
  POST: (app) => (path, handler) => app.post(path, handler),
  PUT: (app) => (path, handler) => app.put(path, handler),
  PATCH: (app) => (path, handler) => app.patch(path, handler),
  DELETE: (app) => (path, handler) => app.delete(path, handler),
};

function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * 🥇 Gold Kernel — the security router.
 *
 * It owns the only code path that mounts a manifest route, tags each handler so
 * ownership is verifiable, and proves the finished table before the process is
 * allowed to listen.
 */
export function createKernel(options: KernelOptions): GoldenKernel {
  const { app, manifest, runtime } = options;
  const routes = manifestRoutes(manifest);
  const moduleIds = new Map(manifest.cassettes.map((cassette) => [cassette.name, cassette.moduleId]));

  for (const route of routes) {
    const moduleId = moduleIds.get(route.cassette);
    if (moduleId === undefined) {
      throw new Error(`Manifest route ${route.method} ${route.path} references unknown cassette "${route.cassette}"`);
    }

    const handler = asyncHandler(async (req, res) => {
      const payload: unknown = req.body ?? {};
      const result = await runtime.invoke(route.cassette, moduleId, payload, {
        cassette: route.cassette,
        route,
        headers: req.headers,
      });
      if (res.headersSent) {
        return;
      }
      res.status(200).json({ cassette: route.cassette, result });
    });

    Object.defineProperty(handler, ROUTE_OWNER, { value: route.cassette, enumerable: false });
    REGISTER[route.method](app)(route.path, handler);
  }

  const prove = (): MountProof =>
    proveRoutes({
      app,
      coreRoutes: options.coreRoutes,
      manifestRoutes: routes,
      now: options.now,
    });

  // Boot-time proof. Throwing here means the process never reaches listen().
  const proof = prove();

  return {
    proof,
    reprove: prove,
  };
}

export type { RouteSpec };
