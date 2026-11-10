// 💎 The Platinum Engine: The Divine Core. Immutable.
import path from 'node:path';
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import { CassetteRuntime } from '../copper/loader';
import { CassetteContractError } from '../errors';
import { createKernel } from '../gold/kernel';
import type { MountProof } from '../gold/proof';
import { defineManifest, type Manifest } from '../manifest';
import { createSilverCop, type SilverCop, type ShedEvent } from '../silver/cop';

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
    teardown: { sleepAll: (sleepOptions) => runtime.sleepAll(sleepOptions) },
    onShed: options.onShed,
    onTeardownError: (error) => options.onError?.(error),
  });

  const app = express();
  app.disable('x-powered-by');

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

  for (const route of CORE_GET_ROUTES) {
    app.get(route, coreHandlers[route]);
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
