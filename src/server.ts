import { cassetteManifest } from './cassettes';
import { createAperture } from './platinum/engine';
import {
  createSilverCop,
  DEFAULT_BUDGET_BYTES,
  DEFAULT_CLIENT_BURST,
  DEFAULT_CLIENT_CONCURRENCY,
  DEFAULT_CLIENT_RATE,
  DEFAULT_MAX_CONCURRENCY,
} from './silver/cop';

const port = Number(process.env.PORT ?? 3000);

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number, received "${raw}"`);
  }
  return parsed;
}

/** `true`/`false`, a hop count, or an Express trust-proxy string (CIDR, `loopback`). */
function trustProxyFromEnv(): boolean | number | string {
  const raw = process.env.APERTURE_TRUST_PROXY?.trim();
  if (!raw || raw === 'false') {
    return false;
  }
  if (raw === 'true') {
    return true;
  }
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

const budgetBytes = numberFromEnv('APERTURE_BUDGET_BYTES', DEFAULT_BUDGET_BYTES);
const maxConcurrency = numberFromEnv('APERTURE_MAX_CONCURRENCY', DEFAULT_MAX_CONCURRENCY);
const clientLimits = {
  ratePerSecond: numberFromEnv('APERTURE_CLIENT_RATE', DEFAULT_CLIENT_RATE),
  burst: numberFromEnv('APERTURE_CLIENT_BURST', DEFAULT_CLIENT_BURST),
  maxConcurrency: numberFromEnv('APERTURE_CLIENT_CONCURRENCY', DEFAULT_CLIENT_CONCURRENCY),
};
const trustProxy = trustProxyFromEnv();
const adminToken = process.env.APERTURE_ADMIN_TOKEN?.trim() || undefined;

const aperture = createAperture({
  manifest: cassetteManifest,
  budgetBytes,
  maxConcurrency,
  adminToken,
  trustProxy,
  clientLimits,
  idleMs: 60_000,
  onShed: (event) => {
    console.warn(
      `[silver] shed ${event.reason} on ${event.path} (rss=${(event.rss / 1024 / 1024).toFixed(1)}MiB, inflight=${event.inflight})`,
    );
  },
  onError: (error, cassette) => {
    console.error(`[aperture] ${cassette ? `cassette ${cassette}: ` : ''}`, error);
  },
});

console.log(
  `[gold] proof verified: ${aperture.proof.total} routes (${aperture.proof.core.length} core, ${aperture.proof.manifest.length} manifest)`,
);
for (const route of aperture.proof.manifest) {
  console.log(`[gold]   ${route}`);
}

const server = aperture.app.listen(port, () => {
  console.log(`[platinum] Aperture Cassette Gateway listening on http://localhost:${port}`);
  console.log(`[silver] budget ${(budgetBytes / 1024 / 1024).toFixed(0)} MiB, max ${maxConcurrency} in-flight`);
  console.log(
    `[silver] per-client: ${clientLimits.maxConcurrency} slot(s), ${clientLimits.ratePerSecond} req/s (burst ${clientLimits.burst}); trust proxy ${String(trustProxy)}`,
  );
  console.log(
    adminToken
      ? '[platinum] /stats and /__aperture/proof require APERTURE_ADMIN_TOKEN'
      : '[platinum] admin routes disabled (set APERTURE_ADMIN_TOKEN to enable)',
  );
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[platinum] ${signal} received, stopping`);

  // A slow client must not hold the process open past the orchestrator's grace
  // period, and idle keep-alive sockets would otherwise keep `close` pending.
  const force = setTimeout(() => {
    console.error('[platinum] shutdown exceeded 10s, exiting');
    process.exit(1);
  }, 10_000);
  force.unref();

  server.closeIdleConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await aperture.close();
  clearTimeout(force);
  console.log(`[copper] all cassettes asleep: ${aperture.runtime.stats.sleeps} teardown(s)`);
}

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
