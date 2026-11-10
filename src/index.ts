export { createAperture } from './platinum/engine';
export type { Aperture, ApertureOptions } from './platinum/engine';

export { createSilverCop, DEFAULT_BUDGET_BYTES, DEFAULT_MAX_CONCURRENCY } from './silver/cop';
export type { SilverCop, SilverCopOptions, SilverCopStats, ShedEvent, ShedReason } from './silver/cop';

export { createKernel } from './gold/kernel';
export type { GoldenKernel, KernelOptions } from './gold/kernel';
export { collectRoutes, proveRoutes, ROUTE_OWNER } from './gold/proof';
export type { CoreRoute, MountedRoute, MountProof, ProveOptions } from './gold/proof';

export { CassetteRuntime } from './copper/loader';
export type { RuntimeOptions, RuntimeStats, SleepOptions } from './copper/loader';
export type { Cassette, CassetteModule, CassetteRequest, HttpMethod, RouteSpec } from './copper/types';

export { cassetteNames, defineManifest, manifestRoutes, normalizePath, routeKey } from './manifest';
export type { CassetteSpec, Manifest } from './manifest';

export {
  ApertureError,
  CassetteContractError,
  ManifestError,
  MissingRouteError,
  RogueRouteError,
  RouteOwnershipError,
  UnprovableRouteError,
} from './errors';
