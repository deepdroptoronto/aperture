// 🥉 The Copper Worker: The Mortal. Wakes, works, and returns to dust.
import { createRequire } from 'node:module';
import path from 'node:path';
import { ApertureError, CassetteContractError } from '../errors';
import type { Cassette, CassetteModule, CassetteRequest } from './types';

/** The Node require used for cassette loading. Evicting its cache is the reclaim step. */
const nodeRequire: NodeRequire = createRequire(__filename);

export interface RuntimeStats {
  wakes: number;
  sleeps: number;
  invokes: number;
  teardownFailures: number;
}

export interface SleepOptions {
  /** Skip cassettes with requests in flight (used by memory-pressure shedding). */
  onlyIdle?: boolean;
  reason?: string;
}

export interface RuntimeOptions {
  /** Cassette module ids are resolved against this directory. */
  rootDir: string;
  now?: () => number;
  onError?: (error: unknown, cassette: string) => void;
}

interface WarmEntry {
  instance: Cassette;
  resolvedPath: string;
  inflight: number;
  lastUsed: number;
}

/**
 * 🥉 Copper loader.
 *
 * A cassette is not `require`d until its first request, and its module cache
 * entry is deleted when it sleeps, so a plugin that is never woken costs zero
 * bytes and a plugin that has gone quiet can be reclaimed by the GC.
 */
export class CassetteRuntime {
  readonly stats: RuntimeStats = { wakes: 0, sleeps: 0, invokes: 0, teardownFailures: 0 };

  private readonly rootDir: string;
  private readonly now: () => number;
  private readonly onError: (error: unknown, cassette: string) => void;
  private readonly warm = new Map<string, WarmEntry>();
  /** Activation order. Teardown walks this in reverse (LIFO). */
  private readonly activation: string[] = [];
  private readonly waking = new Map<string, Promise<WarmEntry>>();
  /** instance -> its single teardown promise, so teardown runs exactly once. */
  private readonly teardowns = new WeakMap<object, Promise<void>>();
  private closed = false;

  constructor(options: RuntimeOptions) {
    this.rootDir = options.rootDir;
    this.now = options.now ?? Date.now;
    this.onError = options.onError ?? (() => {});
  }

  isWarm(cassette: string): boolean {
    return this.warm.has(cassette);
  }

  warmCassettes(): string[] {
    return [...this.activation];
  }

  async invoke(cassette: string, moduleId: string, payload: unknown, request: CassetteRequest): Promise<unknown> {
    if (this.closed) {
      throw new ApertureError('Cassette runtime is closed');
    }
    const entry = await this.wake(cassette, moduleId);
    entry.inflight += 1;
    entry.lastUsed = this.now();
    this.stats.invokes += 1;
    try {
      return await entry.instance.handle(payload, request);
    } finally {
      entry.inflight -= 1;
      entry.lastUsed = this.now();
    }
  }

  /** Wakes a cassette (idempotent, single-flight). */
  private async wake(cassette: string, moduleId: string): Promise<WarmEntry> {
    const existing = this.warm.get(cassette);
    if (existing) {
      return existing;
    }
    const pending = this.waking.get(cassette);
    if (pending) {
      return pending;
    }
    const wake = this.load(cassette, moduleId).finally(() => this.waking.delete(cassette));
    this.waking.set(cassette, wake);
    return wake;
  }

  private async load(cassette: string, moduleId: string): Promise<WarmEntry> {
    const resolvedPath = nodeRequire.resolve(path.resolve(this.rootDir, moduleId));
    const loaded = nodeRequire(resolvedPath) as CassetteModule;
    let entry: WarmEntry;
    try {
      if (!loaded || typeof loaded !== 'object' || loaded.cassette !== cassette) {
        throw new CassetteContractError(cassette, `module "${moduleId}" exports cassette "${String((loaded as { cassette?: unknown })?.cassette)}"`);
      }
      if (typeof loaded.create !== 'function') {
        throw new CassetteContractError(cassette, `module "${moduleId}" must export create()`);
      }
      const instance = await loaded.create();
      if (!instance || typeof instance.handle !== 'function') {
        throw new CassetteContractError(cassette, 'create() must return an object with handle()');
      }
      entry = { instance, resolvedPath, inflight: 0, lastUsed: this.now() };
    } catch (error) {
      // A module that cannot honour the contract must not stay in memory.
      delete nodeRequire.cache[resolvedPath];
      throw error;
    }

    this.warm.set(cassette, entry);
    this.activation.push(cassette);
    this.stats.wakes += 1;
    return entry;
  }

  /** Puts one cassette to sleep. Returns false when it was already cold or busy. */
  async sleep(cassette: string, options: SleepOptions = {}): Promise<boolean> {
    const entry = this.warm.get(cassette);
    if (!entry) {
      return false;
    }
    if (options.onlyIdle !== false && entry.inflight > 0) {
      return false;
    }

    this.warm.delete(cassette);
    const index = this.activation.lastIndexOf(cassette);
    if (index >= 0) {
      this.activation.splice(index, 1);
    }

    try {
      await this.runTeardown(entry.instance);
    } catch (error) {
      this.stats.teardownFailures += 1;
      this.onError(error, cassette);
    } finally {
      // Deleting the cache entry is what makes the module reachable by the GC.
      delete nodeRequire.cache[entry.resolvedPath];
    }

    this.stats.sleeps += 1;
    return true;
  }

  /** Tears down warm cassettes in reverse activation order (last woken, first freed). */
  async sleepAll(options: SleepOptions = {}): Promise<string[]> {
    const slept: string[] = [];
    const order = [...this.activation].reverse();
    for (const cassette of order) {
      if (await this.sleep(cassette, options)) {
        slept.push(cassette);
      }
    }
    return slept;
  }

  /** LIFO teardown of cassettes that have been idle for at least `idleMs`. */
  async sweepIdle(idleMs: number): Promise<string[]> {
    const slept: string[] = [];
    const now = this.now();
    const order = [...this.activation].reverse();
    for (const cassette of order) {
      const entry = this.warm.get(cassette);
      if (!entry || entry.inflight > 0 || now - entry.lastUsed < idleMs) {
        continue;
      }
      if (await this.sleep(cassette, { onlyIdle: true, reason: 'idle' })) {
        slept.push(cassette);
      }
    }
    return slept;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.sleepAll({ onlyIdle: false, reason: 'shutdown' });
  }

  /** WeakMap-guarded: concurrent or repeated sleeps share one teardown promise. */
  private runTeardown(instance: Cassette): Promise<void> {
    const existing = this.teardowns.get(instance);
    if (existing) {
      return existing;
    }
    const running = (async () => {
      if (typeof instance.teardown === 'function') {
        await instance.teardown();
      }
    })();
    this.teardowns.set(instance, running);
    return running;
  }
}
