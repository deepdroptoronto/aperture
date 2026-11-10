import type { Manifest } from './manifest';

/**
 * The cassette table. This is the only place a route may be declared: if it is
 * not here, the Gold Kernel will refuse to boot.
 */
export const cassetteManifest: Manifest = {
  version: 1,
  cassettes: [
    {
      name: 'harvey',
      moduleId: './cassettes/harvey',
      routes: [{ method: 'POST', path: '/cassettes/harvey/draft' }],
    },
    {
      name: 'ledger',
      moduleId: './cassettes/ledger',
      routes: [{ method: 'POST', path: '/cassettes/ledger/invoices' }],
    },
  ],
};
