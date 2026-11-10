import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createAperture, type Aperture, type ApertureOptions } from '../src/platinum/engine';

export interface Harness {
  aperture: Aperture;
  url: string;
  close(): Promise<void>;
}

export async function startAperture(options: ApertureOptions): Promise<Harness> {
  const aperture = createAperture(options);
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = aperture.app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const address = server.address() as AddressInfo;

  return {
    aperture,
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await aperture.close();
    },
  };
}

export async function post(url: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return fetch(url, {
    ...init,
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export async function waitFor(predicate: () => boolean, label: string, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export function teardownLog(): string[] {
  return globalThis.__apertureTestLog ?? [];
}
