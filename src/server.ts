import { cassetteManifest } from './cassettes';
import { createAperture } from './platinum/engine';
import { DEFAULT_BUDGET_BYTES, DEFAULT_MAX_CONCURRENCY } from './silver/cop';

const port = Number(process.env.PORT ?? 3000);
const budgetBytes = Number(process.env.APERTURE_BUDGET_BYTES ?? DEFAULT_BUDGET_BYTES);
const maxConcurrency = Number(process.env.APERTURE_MAX_CONCURRENCY ?? DEFAULT_MAX_CONCURRENCY);

const aperture = createAperture({
  manifest: cassetteManifest,
  budgetBytes,
  maxConcurrency,
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
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[platinum] ${signal} received, stopping`);
  server.close();
  await aperture.close();
  console.log(`[copper] all cassettes asleep: ${aperture.runtime.stats.sleeps} teardown(s)`);
}

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
