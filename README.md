<div align="center">

# 👑 Angel Armor™
### *The 4-Tier Memory-Bounded Plugin Architecture.*

> *"In the legend, the Saints don armor made of divine metals to protect the world from collapse. In Node.js, your server is under siege from memory bloat. **Angel Armor** is the divine armor for your application. It is built in four tiers, each with a sacred duty. The absolute law of the armor: a plugin you never woke up costs zero bytes."*

*Part of the Angel Armor Legacy. Open-sourced by DeepDrop Software Inc. · Created by Angel.*

[![License: MIT + TM](https://img.shields.io/badge/License-MIT%20%2B%20Trademark-yellow.svg)](./LICENSE)
[![Pattern v1.0](https://img.shields.io/badge/Pattern-v1.0-brightgreen.svg)]()
[![Node 18+](https://img.shields.io/badge/Node-18%2B-339933?logo=node.js&logoColor=white)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)]()
[![CI](https://github.com/deepdroptoronto/aperture/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/deepdroptoronto/aperture/actions/workflows/ci.yml)

</div>

---

## 🛡️ The Legend of the Angel Armor

Every modern Node.js plugin system (WordPress, Strapi, Fastify) suffers from the same fatal flaw: **Memory Bloat**. They load every plugin into RAM on every request. Install 200 plugins, and your server OOM-kills at 3 AM.

We fixed it. Inspired by the legendary Knights of the Zodiac, we created **Angel Armor™**. It divides your application into four immutable tiers of armor. The absolute rule of the Legacy: *A plugin you never woke up costs zero bytes.*

This repository is the working reference implementation: an Express gateway where every promise above is enforced by code and covered by a test.

### The Four-Tier Armor

| Tier | Role | What it does |
|---|---|---|
| 💎 **Platinum Engine** | The Immutable Core | Your standard Express server, DB, and Auth. It stays small and never loads plugin code directly. |
| 🥇 **Gold Kernel** | The Security Elite | Enforces boot-time route proofs. Refuses to start if a rogue plugin tries to mount a backdoor route that isn't in the manifest. |
| 🥈 **Silver Cop** | The Traffic Manager | Decoupled Express middleware. Reads RSS memory, sheds traffic *before* body parsing, caps each client's slots and request rate, and triggers LIFO teardowns. |
| 🥉 **Copper Workers** | The Business Logic | The plugins (Cassettes). Zero tracking code. Wake up → do the job → go to sleep. |

## 📼 Everything is a Cassette

The Angel Armor Legacy is built on a single philosophy: **Everything is a Cassette.**

- **The Core Engine** (`src/`) is the Walkman. It handles routing, memory budget, and traffic shedding. It never changes.
- **The UI Cassette** (`packages/angel-armor-ui/`) is the dashboard. It is portable, dependency-free, and can be dropped into any React project.
- **The Copper Workers** (`cassettes.ts`) are the plugins. They wake up, do their job, and go to sleep.

This means you can mix and match functionality without ever rebuilding the core. The engine is stable. The Cassettes are infinite.

---

### ⚖️ Harvey: open mockup vs. Enterprise

The `harvey` cassette shipped in this repository is a **mockup**. It is deterministic string assembly: no model calls, no API keys, no network. It exists to demonstrate the Copper lifecycle — wake, work, sleep — not to sell anything.

The production Harvey used in **Aperture Vault** is not in this repository and is **not** covered by the MIT license. It requires a commercial license from DeepDrop Software Inc. Do not treat the mockup as the product, and do not assume the Enterprise Harvey can be obtained from this source tree.

---

## 🔁 The Request Flow

```text
 ┌──────────────────────────────────────────────────────────────┐
 │  CLIENT  →  "Draft an email"                                 │
 └───────────────────────────────┬──────────────────────────────┘
                                 ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  💎 PLATINUM ENGINE (Immutable Core)                         │
 └───────────────────────────────┬──────────────────────────────┘
                                 ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  🥈 SILVER COP (Traffic Manager)                             │
 │     ├─ Reads RSS Memory. Budget: 224 MiB.                    │
 │     ├─ Concurrency Cap: Max 64 in-flight requests.           │
 │     └─ SHED: Drops at 503 Overloaded BEFORE body parsing.    │
 └───────────────────────────────┬──────────────────────────────┘
                                 ▼  ADMITTED
 ┌──────────────────────────────────────────────────────────────┐
 │  🥇 GOLD KERNEL (Security Router)                            │
 │     ├─ Boot-time route proof against manifest.               │
 │     └─ Refuses server boot if rogue routes are mounted.      │
 └───────────────────────────────┬──────────────────────────────┘
                                 ▼  SIGNED
 ┌──────────────────────────────────────────────────────────────┐
 │  🥉 COPPER WORKER  (e.g. Harvey — AI Sales Cassette)         │
 │     handle(payload) → result                                 │
 └───────────────────────────────┬──────────────────────────────┘
                                 ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  🥈 SILVER COP — WeakMap ensures teardown() runs exactly once│
 │     RAM reclaimed. RSS stays flat.                           │
 └──────────────────────────────────────────────────────────────┘
```

---

## ✅ What is actually enforced

| Promise | Mechanism | Covered by |
|---|---|---|
| A plugin you never woke costs zero bytes | Cassette modules are only `require`d on first invocation | `tests/copper.test.ts`, `tests/engine.test.ts` (health checks never load plugin code) |
| Sleeping reclaims the module | `require.cache` entry is deleted after teardown | `tests/copper.test.ts` |
| `teardown()` runs exactly once | `WeakMap<instance, Promise>` guard, shared by concurrent sleeps | `tests/copper.test.ts` |
| Teardown is LIFO | Activation stack walked in reverse | `tests/copper.test.ts`, `tests/silver.test.ts` |
| Shedding happens before body parsing | Silver Cop is mounted above `express.json()` | `tests/silver.test.ts` (sheds a malformed body with 503, not 400) |
| Rogue routes cannot boot | Gold Kernel proves the live router against the manifest, including handler ownership | `tests/boot.test.ts` |

The three core routes are `GET /health`, `GET /stats` and `GET /__aperture/proof`. `/health` is public; `/stats` and `/__aperture/proof` expose internal telemetry and require `Authorization: Bearer $APERTURE_ADMIN_TOKEN`, and are **disabled (404)** when that token is unset. Everything else must be declared in the manifest or boot is refused.

---

## 🚀 Quick start

<!-- ![Angel Armor Demo](./docs/demo.gif) - Coming soon -->

```bash
npm install
npm run build
npm start
```

```bash
# The gateway wakes Harvey, drafts, and lets it fall idle again
curl -s localhost:3000/cassettes/harvey/draft \
  -H 'content-type: application/json' \
  -d '{"to":"dana@acme.test","company":"Acme Logistics","product":"Aperture","notes":"halving memory spend"}'

# Harvey is warm, Ledger is still cold
curl -s -H "Authorization: Bearer $APERTURE_ADMIN_TOKEN" localhost:3000/stats

# Money math is a second cassette, loaded only when used
curl -s localhost:3000/cassettes/ledger/invoices \
  -H 'content-type: application/json' \
  -d '{"items":[{"description":"Seat","quantity":2,"unitPrice":15.5}],"taxRate":0.13}'
```

---

## 🔌 Writing a cassette

A cassette is plain business logic. There is no router, no middleware and no tracking code — only `handle`, an optional `teardown`, and a name.

```ts
// src/cassettes/harvey.ts
import type { Cassette } from '../copper/types';

export const cassette = 'harvey';

export interface Payload { to?: string; notes?: string }
export interface Draft { to: string; subject: string; body: string }

export function create(): Cassette<Payload, Draft> {
  const cache = new Map<string, Draft>(); // instance state is cheap to discard

  return {
    handle(payload) {
      return { to: payload.to ?? 'there', subject: 'Aperture', body: payload.notes ?? '' };
    },
    teardown() {
      cache.clear();
    },
  };
}
```

Declare it in `src/cassettes.ts`:

```ts
export const cassetteManifest = {
  version: 1,
  cassettes: [
    {
      name: 'harvey',                          // must equal the module's `cassette` export
      moduleId: './cassettes/harvey',          // resolved against the runtime root
      routes: [{ method: 'POST', path: '/cassettes/harvey/draft' }],
    },
  ],
} as const;
```

The kernel mounts that route, tags the handler, and proves the finished table before `listen()` is called. Cassettes never receive the Express app, so they cannot add routes the proof would have to catch.

---

## ⚙️ Engine options

```ts
import { createAperture } from './platinum/engine';
import { cassetteManifest } from './cassettes';

const aperture = createAperture({
  manifest: cassetteManifest,
  budgetBytes: 224 * 1024 * 1024, // RSS ceiling
  maxConcurrency: 64,             // admitted requests
  idleMs: 60_000,                 // sleep idle cassettes
  rootDir: __dirname,             // where moduleIds resolve
  onShed: (event) => console.warn('shed', event.reason),
});
```

| Option | Default | Meaning |
|---|---|---|
| `budgetBytes` | 224 MiB | RSS above this is shed with 503 `overloaded` |
| `maxConcurrency` | 64 | In-flight requests before shedding |
| `clientLimits` | 16 slots/client, 20 req/s, burst 40 | Per-IP fairness; `false` disables it |
| `trustProxy` | `false` | Express `trust proxy`; required to read `X-Forwarded-For` behind a load balancer |
| `readRss` | `process.memoryUsage().rss` | Injectable so pressure is testable |
| `idleMs` | disabled | Idle cassettes are torn down LIFO after this long |
| `jsonLimit` | `1mb` | Body limit for admitted requests |
| `rootDir` | compiled `src/` | Base directory for cassette `moduleId`s |

### Environment variables

The server reads three variables, documented in [`.env.example`](./.env.example). **No API keys are required**: the open-source Harvey cassette makes no model calls and no network requests.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `APERTURE_BUDGET_BYTES` | `234881024` (224 MiB) | RSS ceiling; above it, requests are shed with 503 |
| `APERTURE_MAX_CONCURRENCY` | `64` | In-flight ceiling; above it, requests are shed with 503 |
| `APERTURE_ADMIN_TOKEN` | unset | Bearer token for `/stats` and `/__aperture/proof`; unset disables both (404) |
| `APERTURE_CLIENT_CONCURRENCY` | `16` | Concurrent slots per client IP (`0` disables) |
| `APERTURE_CLIENT_RATE` | `20` | Sustained requests/second per client IP (`0` disables) |
| `APERTURE_CLIENT_BURST` | `40` | Burst allowance per client IP |
| `APERTURE_TRUST_PROXY` | `false` | Express `trust proxy` hop count or CIDR; `false` ignores `X-Forwarded-For` |

`.env` is git-ignored and `.env.example` is the committed template — `cp .env.example .env` to start.

---

## 📦 The Angel Armor UI

The UI layer ships as its own cassette: [packages/angel-armor-ui](packages/angel-armor-ui) is `@deepdrop/angel-armor-ui`, a portable React package with no database, no network calls and no imports from this engine. React and ReactDOM are its only peers.

```bash
npm install ./angel-armor-ui-1.0.0.tar.gz
```

| Component | What it does |
|---|---|
| `Mascot` | Armored mascot with `idle`, `walk` and `celebrate` states; scoped CSS keyframes, reduced-motion aware |
| `WatchPager` | CSS scroll-snap pager with dots, prev/next and arrow-key navigation |
| `MoneyRain` | Canvas 2D celebration overlay, 64 bills, one frame loop, unmounts itself |

Build the distributable cassette with `npm run export:ui` — it validates the package (React-only peers, no engine imports) and writes `dist/angel-armor-ui-1.0.0.tar.gz`. `npm run verify:ui` typechecks the package and server-renders every component as a smoke check.

---

## 🧪 Tests

```bash
npm test   # builds, then runs the suite with node --test
```

- `tests/boot.test.ts` — route proof: rogue routes, duplicate mounts, handler ownership, missing routes, unprovable routers, manifest validation.
- `tests/silver.test.ts` — shed-before-parse, concurrency cap, LIFO reclaim under memory pressure, in-flight cassettes are spared.
- `tests/copper.test.ts` — cold = zero bytes, cache eviction, exactly-once teardown, LIFO order, single-flight wake, contract violations.
- `tests/engine.test.ts` — the full four-tier request path, cold sibling cassettes, 404/502/500 mapping, boot-time misconfiguration.

---

## 📊 Benchmarks

Measured on the 2 vCPU / 3.8 GiB dev VM (Node 26), 6,000 requests with 100 concurrent clients against an admission cap of 8: **1,298 admitted (200), 4,702 shed (503 concurrency), 78.4% shed rate**, peak in-flight 8, and server RSS 67.0 MiB → 82.7 MiB. Second run: 1,212 admitted, 4,788 shed, 79.8%, RSS 67.6 MiB → 79.1 MiB. Reproduce with `npm run bench:flood`; hardware, methodology and raw output are in [benchmarks/README.md](benchmarks/README.md).

---

## ⚠️ Honest limits

- **Reclaim is GC-dependent.** Deleting the module from `require.cache` removes the gateway's last reference; the V8 heap decides when to hand the pages back. The tests assert eviction, not an instantaneous RSS drop.
- **RSS is process-wide.** The budget includes V8 heap growth and buffers of requests already in flight. It is a load-shedding signal, not per-cassette accounting.
- **Cassettes are trusted code.** The proof stops route injection and backdoor mounts; it is not a sandbox. A cassette can still `require('node:child_process')` like any dependency can. Run untrusted plugins in a separate process.
- **Express 4 only.** The proof reads Express 4's router shape and refuses to guess at another major.
- **Single process.** The budget and cap are per instance; a cluster multiplies them.

---

## 📁 Layout

```
src/
  platinum/engine.ts   💎 wiring order: silver → core → body parser → gold
  gold/proof.ts        🥇 router introspection + manifest proof
  gold/kernel.ts       🥇 the only code path that mounts a cassette route
  silver/cop.ts        🥈 RSS + concurrency shedding, LIFO teardown trigger
  copper/loader.ts     🥉 lazy load, wake, sleep, exactly-once teardown
  copper/types.ts      🥉 the cassette contract
  cassettes/           🥉 demo workers (harvey, ledger)
  manifest.ts          manifest schema + validation
```

---

## License

MIT + Common-Law Trademark Notice — see [LICENSE](./LICENSE). Forks are welcome, under a different name.
