import type { IncomingHttpHeaders } from 'node:http';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteSpec {
  readonly method: HttpMethod;
  readonly path: string;
  /** Cassette that owns this route. */
  readonly cassette: string;
}

/**
 * Everything a cassette is allowed to know about the request. No `app`, no
 * router, no require hook: a cassette cannot mount routes, so it cannot widen
 * the attack surface the Gold Kernel just proved.
 */
export interface CassetteRequest {
  readonly cassette: string;
  readonly route: RouteSpec;
  readonly headers: IncomingHttpHeaders;
}

/**
 * The Copper Worker contract. This is the *entire* integration surface: a
 * cassette is plain business logic with no gateway tracking code.
 */
export interface Cassette<P = unknown, R = unknown> {
  handle(payload: P, request: CassetteRequest): R | Promise<R>;
  /** Optional cleanup. The runtime calls this at most once per instance. */
  teardown?(): void | Promise<void>;
}

/** Shape a cassette module must export. Loaded lazily, on first invocation. */
export interface CassetteModule<P = unknown, R = unknown> {
  readonly cassette: string;
  create(): Cassette<P, R> | Promise<Cassette<P, R>>;
}
