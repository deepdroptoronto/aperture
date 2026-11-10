// 🥈 The Silver Cop: The Watcher. Sheds traffic at 503 before the sanctuary collapses.
import type { Request, RequestHandler, Response } from 'express';

export const DEFAULT_BUDGET_BYTES = 224 * 1024 * 1024;
export const DEFAULT_MAX_CONCURRENCY = 64;

/** Per-client defaults: one client may hold a quarter of the slots. */
export const DEFAULT_CLIENT_CONCURRENCY = 16;
/** Sustained requests per second allowed per client. */
export const DEFAULT_CLIENT_RATE = 20;
/** Burst allowance per client, so a normal page load is never throttled. */
export const DEFAULT_CLIENT_BURST = 40;
/** Hard bound on tracked clients, so the limiter cannot itself exhaust memory. */
export const DEFAULT_MAX_CLIENTS = 10_000;

export type ShedReason = 'memory' | 'concurrency' | 'client-rate' | 'client-concurrency';

export interface ShedEvent {
  reason: ShedReason;
  rss: number;
  budgetBytes: number;
  inflight: number;
  maxConcurrency: number;
  path: string;
}

export interface TeardownSink {
  sleepAll(options: { onlyIdle?: boolean; reason?: string }): Promise<unknown>;
}

/**
 * Per-client fairness, keyed by IP (or whatever `key` returns).
 *
 * `req.ip` honours Express's `trust proxy` setting, so behind a load balancer
 * the key is the real client address — but only if `trustProxy` is configured
 * for that hop. With the default (`false`), `X-Forwarded-For` is ignored and
 * cannot be spoofed.
 */
export interface ClientLimits {
  /** Sustained requests per second per client. `0` disables the rate limit. */
  ratePerSecond?: number;
  /** Burst allowance per client. Must be >= 1 when the rate limit is on. */
  burst?: number;
  /** Concurrent admitted requests per client. `0` disables the slot limit. */
  maxConcurrency?: number;
  /** Maximum number of tracked clients (LRU-ish eviction of idle entries). */
  maxClients?: number;
  /** Override the client key. Defaults to `req.ip`. */
  key?: (req: Request) => string;
}

export interface SilverCopOptions {
  budgetBytes?: number;
  maxConcurrency?: number;
  readRss?: () => number;
  /** Where to send the LIFO teardown when the budget is blown. */
  teardown?: TeardownSink;
  /** Per-client fairness. Pass `false` to disable it entirely. */
  clientLimits?: ClientLimits | false;
  onShed?: (event: ShedEvent) => void;
  onTeardownError?: (error: unknown) => void;
  /** Injectable clock so rate limiting is testable without sleeping. */
  now?: () => number;
}

export interface SilverCopStats {
  inflight: number;
  peakInflight: number;
  admitted: number;
  shed: Record<ShedReason, number>;
  lastRss: number;
  budgetBytes: number;
  maxConcurrency: number;
  /** Clients currently tracked by the fairness limiter. */
  clients: number;
}

export interface SilverCop {
  middleware: RequestHandler;
  stats: SilverCopStats;
}

interface ClientState {
  tokens: number;
  updatedAt: number;
  inflight: number;
}

const EMPTY_SHED: Record<ShedReason, number> = {
  memory: 0,
  concurrency: 0,
  'client-rate': 0,
  'client-concurrency': 0,
};

/**
 * 🥈 Silver Cop — the traffic manager.
 *
 * Mount this before any body parser. Rejecting here means the request body was
 * never read, never buffered and never parsed, which is the difference between
 * shedding traffic and melting down while shedding it.
 */
export function createSilverCop(options: SilverCopOptions = {}): SilverCop {
  const budgetBytes = options.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const readRss = options.readRss ?? (() => process.memoryUsage().rss);
  const now = options.now ?? (() => Date.now());

  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) {
    throw new RangeError('budgetBytes must be a positive finite number');
  }
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new RangeError('maxConcurrency must be a positive integer');
  }

  const limits =
    options.clientLimits === false
      ? undefined
      : {
          ratePerSecond: options.clientLimits?.ratePerSecond ?? DEFAULT_CLIENT_RATE,
          burst: options.clientLimits?.burst ?? DEFAULT_CLIENT_BURST,
          maxConcurrency: options.clientLimits?.maxConcurrency ?? DEFAULT_CLIENT_CONCURRENCY,
          maxClients: options.clientLimits?.maxClients ?? DEFAULT_MAX_CLIENTS,
          key: options.clientLimits?.key ?? ((req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown'),
        };

  if (limits) {
    if (!Number.isFinite(limits.ratePerSecond) || limits.ratePerSecond < 0) {
      throw new RangeError('clientLimits.ratePerSecond must be a non-negative finite number');
    }
    if (!Number.isInteger(limits.burst) || limits.burst < 1) {
      throw new RangeError('clientLimits.burst must be a positive integer');
    }
    if (!Number.isInteger(limits.maxConcurrency) || limits.maxConcurrency < 0) {
      throw new RangeError('clientLimits.maxConcurrency must be a non-negative integer');
    }
    if (!Number.isInteger(limits.maxClients) || limits.maxClients < 1) {
      throw new RangeError('clientLimits.maxClients must be a positive integer');
    }
  }

  const stats: SilverCopStats = {
    inflight: 0,
    peakInflight: 0,
    admitted: 0,
    shed: { ...EMPTY_SHED },
    lastRss: 0,
    budgetBytes,
    maxConcurrency,
    clients: 0,
  };

  const clients = new Map<string, ClientState>();
  let teardownRunning = false;

  /**
   * Refreshes recency and refills the bucket. Map insertion order doubles as the
   * eviction order, so every touch re-inserts the key.
   */
  const touchClient = (key: string): ClientState => {
    if (!limits) {
      throw new Error('touchClient called without client limits');
    }
    let state = clients.get(key);
    const timestamp = now();
    if (state) {
      clients.delete(key);
    } else {
      if (clients.size >= limits.maxClients) {
        for (const [candidate, entry] of clients) {
          if (entry.inflight === 0) {
            clients.delete(candidate);
            break;
          }
        }
      }
      state = { tokens: limits.burst, updatedAt: timestamp, inflight: 0 };
    }

    if (limits.ratePerSecond > 0) {
      const elapsedSeconds = Math.max(0, timestamp - state.updatedAt) / 1000;
      state.tokens = Math.min(limits.burst, state.tokens + elapsedSeconds * limits.ratePerSecond);
    }
    state.updatedAt = timestamp;
    clients.set(key, state);
    stats.clients = clients.size;
    return state;
  };

  const shed = (reason: ShedReason, rss: number, req: Request, res: Response): void => {
    stats.shed[reason] += 1;
    options.onShed?.({
      reason,
      rss,
      budgetBytes,
      inflight: stats.inflight,
      maxConcurrency,
      path: req.path,
    });

    // Rate limiting is a 429; capacity shedding is a 503. Both are refusals the
    // client can retry, and neither reads the body.
    const rateLimited = reason === 'client-rate';
    res.statusCode = rateLimited ? 429 : 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '1');
    res.end(
      JSON.stringify({
        error: rateLimited ? 'rate_limited' : 'overloaded',
        reason,
        budgetBytes,
        maxConcurrency,
      }),
    );

    if (reason !== 'memory' || teardownRunning || !options.teardown) {
      return;
    }
    teardownRunning = true;
    void options
      .teardown
      .sleepAll({ onlyIdle: true, reason: 'memory-pressure' })
      .catch((error: unknown) => options.onTeardownError?.(error))
      .finally(() => {
        teardownRunning = false;
      });
  };

  const middleware: RequestHandler = (req, res, next) => {
    const rss = readRss();
    stats.lastRss = rss;

    if (rss > budgetBytes) {
      shed('memory', rss, req, res);
      return;
    }

    // Fairness runs before the global cap: a greedy client is refused here and
    // never consumes a slot another client could have used.
    const client = limits ? touchClient(limits.key(req)) : undefined;
    if (limits && client) {
      if (limits.ratePerSecond > 0 && client.tokens < 1) {
        shed('client-rate', rss, req, res);
        return;
      }
      if (limits.maxConcurrency > 0 && client.inflight >= limits.maxConcurrency) {
        shed('client-concurrency', rss, req, res);
        return;
      }
    }

    if (stats.inflight >= maxConcurrency) {
      shed('concurrency', rss, req, res);
      return;
    }

    if (limits && client) {
      if (limits.ratePerSecond > 0) {
        client.tokens -= 1;
      }
      client.inflight += 1;
    }

    stats.inflight += 1;
    stats.admitted += 1;
    stats.peakInflight = Math.max(stats.peakInflight, stats.inflight);

    let released = false;
    const release = (): void => {
      if (released) {
        return;
      }
      released = true;
      stats.inflight -= 1;
      if (client) {
        client.inflight -= 1;
      }
    };
    res.once('finish', release);
    res.once('close', release);

    next();
  };

  return { middleware, stats };
}
