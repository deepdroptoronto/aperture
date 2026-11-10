// 🥈 The Silver Cop: The Watcher. Sheds traffic at 503 before the sanctuary collapses.
import type { Request, RequestHandler, Response } from 'express';

export const DEFAULT_BUDGET_BYTES = 224 * 1024 * 1024;
export const DEFAULT_MAX_CONCURRENCY = 64;

export type ShedReason = 'memory' | 'concurrency';

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

export interface SilverCopOptions {
  budgetBytes?: number;
  maxConcurrency?: number;
  readRss?: () => number;
  /** Where to send the LIFO teardown when the budget is blown. */
  teardown?: TeardownSink;
  onShed?: (event: ShedEvent) => void;
  onTeardownError?: (error: unknown) => void;
}

export interface SilverCopStats {
  inflight: number;
  peakInflight: number;
  admitted: number;
  shed: Record<ShedReason, number>;
  lastRss: number;
  budgetBytes: number;
  maxConcurrency: number;
}

export interface SilverCop {
  middleware: RequestHandler;
  stats: SilverCopStats;
}

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

  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) {
    throw new RangeError('budgetBytes must be a positive finite number');
  }
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new RangeError('maxConcurrency must be a positive integer');
  }

  const stats: SilverCopStats = {
    inflight: 0,
    peakInflight: 0,
    admitted: 0,
    shed: { memory: 0, concurrency: 0 },
    lastRss: 0,
    budgetBytes,
    maxConcurrency,
  };

  let teardownRunning = false;

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

    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '1');
    res.end(JSON.stringify({ error: 'overloaded', reason, budgetBytes, maxConcurrency }));

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
    if (stats.inflight >= maxConcurrency) {
      shed('concurrency', rss, req, res);
      return;
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
    };
    res.once('finish', release);
    res.once('close', release);

    next();
  };

  return { middleware, stats };
}
