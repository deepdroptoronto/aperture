# Architecture

How the four tiers fit together, what each one is allowed to do, and where the
guarantees are enforced in code.

---

## The Legend of the Armor

> In the legend, the Saints don armor made of divine metals to protect the world
> from collapse. In Node.js, the server is under siege from memory bloat. Angel
> Armor is the divine armor for your application: four tiers, each with one
> sacred duty, and one absolute law — *a plugin you never woke up costs zero
> bytes.*

The four metals map to four responsibilities, and the mapping is not decoration:
each tier is only allowed to do the thing its metal stands for.

- **💎 Platinum — The Divine Core.** The sovereign of the sanctuary. It never
  fights: it loads no plugin code and owns no business route. Its duty is to hold
  the sanctuary together by wiring the other three tiers in one immutable order.
- **🥇 Gold — The Elite.** The golden guard of the gates. Every route is a gate,
  and no gate opens without proof. The manifest is the law; a gate that is not
  written in it cannot exist, and the guard checks the finished gatehouse before
  the doors are ever opened to the public.
- **🥈 Silver — The Watcher.** The silver sentinels read the battlefield (RSS
  sampling) and count the crowd at the gates (in-flight requests). When the
  sanctuary is about to collapse, they shed the weight with a 503 — before a
  single request body is buffered or parsed.
- **🥉 Copper — The Mortal.** The bronze workers. They burn their cosmo (RAM)
  only when a request wakes them, do the job, and return to dust (teardown plus
  module eviction), leaving nothing behind for the next shift.

This is an analogy drawn from classic armor legends. Angel Armor is an
independent pattern; it is not affiliated with, endorsed by, or derived from any
manga, anime, or game franchise.

---

## The tiers as code

| Tier | File | Owns | Forbidden |
|---|---|---|---|
| 💎 Platinum | `src/platinum/engine.ts` | Wiring order, core routes, lifecycle | Loading cassette modules |
| 🥇 Gold | `src/gold/proof.ts`, `src/gold/kernel.ts` | Route mounting, boot proof | Loading cassette modules |
| 🥈 Silver | `src/silver/cop.ts` | Admission, shedding, teardown trigger | Reading or parsing bodies |
| 🥉 Copper | `src/copper/loader.ts`, `src/copper/types.ts` | Lazy load, invoke, teardown | Routing, mounting, touching the app |

The manifest (`src/manifest.ts`) is the single source of truth for what may
exist. `src/cassettes.ts` is this repo's manifest.

---

## Request lifecycle, in wiring order

1. **Silver Cop** runs first. It samples RSS and the in-flight count. Over
   budget or over the cap, it answers `503 {"error":"overloaded","reason":…}`
   with `Retry-After: 1` and stops the chain. The body is never touched.
2. **Core routes** (`GET /health`, `GET /stats`, `GET /__aperture/proof`) are
   served without loading any plugin code.
3. **Body parsing** (`express.json`) runs only for admitted requests.
4. **Gold route** matches a manifest route and calls the runtime with the
   cassette name and its module id.
5. **Copper wake** `require`s the module on first use, validates the contract
   (`cassette` name, `create()`, `handle()`), and caches the instance.
6. **Business logic** runs in `handle(payload, request)`, with no access to the
   app or router.
7. **Response** is returned as `{ cassette, result }`.
8. **Teardown** happens on idle sweep, memory pressure (LIFO, idle cassettes
   only), or shutdown: `teardown()` once, then the `require` cache entry is
   deleted so the module becomes collectable.

---

## The four invariants

| Invariant | Enforcement | Test |
|---|---|---|
| A cassette you never woke costs zero bytes | Module is `require`d only on first invocation | `tests/copper.test.ts`, `tests/engine.test.ts` |
| No route exists outside the manifest | `proveRoutes()` reads the live Express router, compares method+path against manifest + core allowlist, and verifies each handler carries the kernel's owner tag | `tests/boot.test.ts` |
| Shedding happens before parsing | Silver is mounted above `express.json()`, so a shed request never reaches the parser | `tests/silver.test.ts` |
| `teardown()` runs exactly once | `WeakMap<instance, Promise>` memoises the teardown; LIFO order comes from the activation stack | `tests/copper.test.ts` |

Boot refusals are thrown, not logged: `ManifestError`, `RogueRouteError`,
`RouteOwnershipError`, `MissingRouteError`, `UnprovableRouteError`. The process
never reaches `listen()`. A router mounted at a path cannot be proven, so the
proof fails closed rather than guessing.

---

## Failure modes

| Symptom | Response |
|---|---|
| RSS above `budgetBytes` | 503 `overloaded`, reason `memory`; idle cassettes torn down LIFO |
| In-flight at `maxConcurrency` | 503 `overloaded`, reason `concurrency` |
| Cassette throws | 500 `cassette_failed`, message not leaked |
| Module violates the contract | 502 `cassette_contract` with the cassette name; module evicted |
| Malformed JSON on an admitted request | 400 `invalid_json` |
| Unknown route or wrong method | 404 `not_found` |
| Rogue / stolen / missing route at boot | Process refuses to start |

---

## Extension points

- **A new cassette:** implement `{ cassette, create() }` returning
  `{ handle, teardown? }`, declare it in the manifest, done. No edits to the
  engine.
- **A new tier policy:** `createAperture` accepts `budgetBytes`,
  `maxConcurrency`, `idleMs`, `readRss`, `jsonLimit`, and `rootDir`; all are
  injectable, which is what makes the tests deterministic.
- **The UI cassette:** `packages/angel-armor-ui` is deliberately outside the
  engine's dependency graph. It imports nothing from `src/`, and the export
  script fails if it ever does.

---

## Non-goals

The armor is load-shedding and route-proofing, not a sandbox. Detailed limits —
GC-dependent reclamation, process-wide RSS, trusted cassette code, Express 4
only, single-process budget — are listed in the README's "Honest limits".
