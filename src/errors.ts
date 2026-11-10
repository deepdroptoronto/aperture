/**
 * Error taxonomy for the Angel Armor tiers.
 *
 * Boot failures (manifest, proof) are programming/config errors and are meant to
 * stop the process before it accepts traffic. Runtime failures (contract) are
 * reported to the caller without leaking cassette internals.
 */

export class ApertureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The manifest is malformed or self-contradictory. Boot is refused. */
export class ManifestError extends ApertureError {}

/** The live router contains a route the manifest never declared. Boot is refused. */
export class RogueRouteError extends ApertureError {
  readonly routes: string[];

  constructor(routes: string[]) {
    super(`Refusing to boot: route(s) mounted outside the manifest: ${routes.join(', ')}`);
    this.routes = routes;
  }
}

/** A manifest route was not actually registered. Boot is refused. */
export class MissingRouteError extends ApertureError {
  readonly routes: string[];

  constructor(routes: string[]) {
    super(`Refusing to boot: manifest route(s) were never mounted: ${routes.join(', ')}`);
    this.routes = routes;
  }
}

/** A declared route is served by a handler the kernel did not install. Boot is refused. */
export class RouteOwnershipError extends ApertureError {
  readonly routes: string[];

  constructor(routes: string[]) {
    super(`Refusing to boot: route(s) served by unexpected handlers: ${routes.join(', ')}`);
    this.routes = routes;
  }
}

/** The router shape cannot be introspected, so the proof would be a guess. Fail closed. */
export class UnprovableRouteError extends ApertureError {}

/** A loaded module does not honour the cassette contract (name / create / handle). */
export class CassetteContractError extends ApertureError {
  readonly cassette: string;

  constructor(cassette: string, detail: string) {
    super(`Cassette "${cassette}" violates the contract: ${detail}`);
    this.cassette = cassette;
  }
}
