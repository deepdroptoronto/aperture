// 💎 The Platinum Engine: The Divine Core. Immutable.
import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import express, { type ErrorRequestHandler, type Express, type Request, type RequestHandler } from 'express';
import { CassetteRuntime } from '../copper/loader';
import { CassetteContractError } from '../errors';
import { createKernel } from '../gold/kernel';
import type { MountProof } from '../gold/proof';
import { defineManifest, type Manifest } from '../manifest';
import { createSilverCop, type ClientLimits, type SilverCop, type ShedEvent } from '../silver/cop';

export interface ApertureOptions {
  manifest: Manifest;
  /** RSS ceiling in bytes. Default 224 MiB. */
  budgetBytes?: number;
  /** Max concurrent admitted requests. Default 64. */
  maxConcurrency?: number;
  /** Base directory for cassette module ids. Defaults to the compiled `src` directory. */
  rootDir?: string;
  /** Defaults to `process.memoryUsage().rss`. Injectable so pressure can be tested. */
  readRss?: () => number;
  /** Put cassettes to sleep after this much idle time. Disabled by default. */
  idleMs?: number;
  /** Body limit for the Platinum core. Default `1mb`. */
  jsonLimit?: string;
  /**
   * Bearer token that unlocks `GET /stats` and `GET /__aperture/proof`.
   * Unset (or an empty string) disables both routes entirely, so admin data is
   * never exposed by accident.
   */
  adminToken?: string;
  /**
   * Express `trust proxy` setting. Leave `false` (default) behind no proxy: a
   * client could otherwise spoof `X-Forwarded-For` and bypass per-IP limits.
   */
  trustProxy?: boolean | number | string;
  /** Per-client fairness limits. Pass `false` to disable. */
  clientLimits?: ClientLimits | false;
  onShed?: (event: ShedEvent) => void;
  onError?: (error: unknown, cassette?: string) => void;
}

export interface Aperture {
  app: Express;
  proof: MountProof;
  runtime: CassetteRuntime;
  silver: SilverCop;
  close(): Promise<void>;
}

const CORE_GET_ROUTES = ['/health', '/stats', '/__aperture/proof'] as const;

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Extracts the token from a `Bearer` authorization header, case-insensitively. */
function presentedBearer(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string') {
    return undefined;
  }
  const separator = header.indexOf(' ');
  if (separator < 0) {
    return undefined;
  }
  if (header.slice(0, separator).toLowerCase() !== 'bearer') {
    return undefined;
  }
  const token = header.slice(separator + 1).trim();
  return token === '' ? undefined : token;
}

function isBodyParseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { type?: unknown; status?: unknown };
  if (candidate.type === 'entity.parse.failed') {
    return true;
  }
  return error instanceof SyntaxError && candidate.status === 400;
}

/**
 * 💎 Platinum Engine — the immutable core.
 *
 * Wiring order is the architecture:
 *   1. Silver Cop      (shed on RSS / concurrency, before any body is read)
 *   2. core routes     (health, stats, proof)
 *   3. body parser     (only admitted requests pay for it)
 *   4. Gold Kernel     (mounts the manifest, then proves the table)
 */
export function createAperture(options: ApertureOptions): Aperture {
  const startedAt = Date.now();
  const manifest = defineManifest(options.manifest);

  const runtime = new CassetteRuntime({
    rootDir: options.rootDir ?? path.resolve(__dirname, '..'),
    onError: (error, cassette) => options.onError?.(error, cassette),
  });

  const silver = createSilverCop({
    budgetBytes: options.budgetBytes,
    maxConcurrency: options.maxConcurrency,
    readRss: options.readRss,
    clientLimits: options.clientLimits,
    teardown: { sleepAll: (sleepOptions) => runtime.sleepAll(sleepOptions) },
    onShed: options.onShed,
    onTeardownError: (error) => options.onError?.(error),
  });

  const app = express();
  app.disable('x-powered-by');
  // Must be set before any middleware reads req.ip.
  app.set('trust proxy', options.trustProxy ?? false);

  const adminToken = options.adminToken?.trim() ? options.adminToken.trim() : undefined;

  // Headers first, so even a shed 503 or a 404 carries them.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });

  // Tier 2 first: nothing below this line sees a request that was shed.
  app.use(silver.middleware);

  let proof: MountProof | undefined;

  const coreHandlers: Record<(typeof CORE_GET_ROUTES)[number], RequestHandler> = {
    '/health': (_req, res) => {
      res.json({ status: 'ok', tier: 'platinum', uptimeMs: Date.now() - startedAt, pid: process.pid });
    },
    '/stats': (_req, res) => {
      res.json({
        silver: silver.stats,
        runtime: { ...runtime.stats, warm: runtime.warmCassettes() },
      });
    },
    '/__aperture/proof': (_req, res) => {
      res.json(proof ?? { verifiedAt: 0, core: [], manifest: [], total: 0 });
    },
  };

  const requireAdmin: RequestHandler = (req, res, next) => {
    if (!adminToken) {
      res.status(404).json({ error: 'not_found', path: req.path });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    const presented = presentedBearer(req);
    // Compare digests: equal length regardless of input, so the comparison is
    // constant-time and a wrong-length token cannot throw.
    if (!presented || !timingSafeEqual(digest(presented), digest(adminToken))) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="aperture"');
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };

  for (const route of CORE_GET_ROUTES) {
    app.get(route, ...(route === '/health' ? [coreHandlers[route]] : [requireAdmin, coreHandlers[route]]));
  }

  app.use(express.json({ limit: options.jsonLimit ?? '1mb' }));

  // Tier 1: mount + prove. A failure here throws before the process listens.
  const kernel = createKernel({
    app,
    manifest,
    runtime,
    coreRoutes: CORE_GET_ROUTES.map((route) => ({ method: 'GET', path: route })),
    onError: options.onError,
  });
  proof = kernel.proof;

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', path: req.path });
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (isBodyParseError(error)) {
      res.status(400).json({ error: 'invalid_json' });
      return;
    }
    if (error instanceof CassetteContractError) {
      res.status(502).json({ error: 'cassette_contract', cassette: error.cassette });
      return;
    }
    options.onError?.(error);
    res.status(500).json({ error: 'cassette_failed' });
  };
  app.use(errorHandler);

  let idleTimer: NodeJS.Timeout | undefined;
  if (options.idleMs !== undefined && options.idleMs > 0) {
    const idleMs = options.idleMs;
    idleTimer = setInterval(() => {
      void runtime.sweepIdle(idleMs).catch((error: unknown) => options.onError?.(error));
    }, Math.max(1000, Math.floor(idleMs / 2)));
    idleTimer.unref();
  }

  return {
    app,
    proof,
    runtime,
    silver,
    async close() {
      if (idleTimer) {
        clearInterval(idleTimer);
        idleTimer = undefined;
      }
      await runtime.close();
    },
  };
}
