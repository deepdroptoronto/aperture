# Benchmarks

Two harnesses live in [`bench/`](../bench):

| Script | Command | What it measures |
|---|---|---|
| `bench/shed.js` | `npm run bench` | Controlled admission: a burst above the cap, steady load under it, and a memory-budget shed |
| `bench/flood.js` | `npm run bench:flood` | A 6,000-request flood against an **isolated** server process, with that process's RSS sampled over IPC |

Every number below was produced by these scripts, on the machine described here.
Nothing is quoted from a different environment.

## The hardware

| | |
|---|---|
| CPU | 2 vCPU (shared cloud instance) |
| Memory | 3.8 GiB |
| Kernel | Linux 6.1.102 |
| Node (measured) | v26.13.0 |
| Node (CI) | 20 |

Throughput and RSS are properties of this machine and this Node version. The
admitted/shed split additionally depends on cassette latency, the admission cap
and client concurrency — all of which the harness exposes as environment
variables so you can re-measure rather than trust a table.

## The methodology

`npm run bench:flood` runs a load generator in the parent process and the
gateway in a **separate child process**:

1. The child boots the engine with `maxConcurrency: 8` and the default
   `budgetBytes` of 224 MiB, and listens on an ephemeral loopback port.
2. The parent sends one warm-up request, so cold-start module loading is
   excluded from the measurement.
3. The parent records the child's RSS baseline, then fires **6,000** `POST`
   requests at the cassette route with **100** concurrent clients. Each admitted
   request spends 5 ms in the cassette.
4. The child samples `process.memoryUsage().rss` every 50 ms and reports it over
   IPC; the parent tracks the peak. The load generator's own sockets and buffers
   live in the parent, so they are **not** counted as server memory.
5. 200 and 503 responses are counted, and 503s are split by reason from
   `silver.stats.shed` (`memory` vs `concurrency`).
6. The child reports final RSS plus `silver`/`runtime` stats, then shuts down
   through the normal LIFO teardown path.

### Why the cassette is a stand-in

The flood targets [`bench/cassettes/sleepy.js`](../bench/cassettes/sleepy.js), a
cassette with configurable latency, rather than the shipped Harvey cassette.
Harvey answers instantly; with no service time the run becomes purely
throughput-bound and nearly every request is admitted, which tests nothing about
shedding. The 5 ms latency is what creates queueing pressure against 8 slots.
The route shape (`POST`, JSON payload, single cassette) is identical.

Per-client fairness is disabled here (`clientLimits: false`) so the single load
generator's bucket cannot throttle the run before the global admission cap does.
The shed rate below therefore measures the **global** cap alone; per-client
behaviour is covered by `tests/fairness.test.ts`.

Per-client fairness is disabled here (`clientLimits: false`) so that a single
load generator's bucket does not throttle the run before the global admission
cap does. The shed rate below therefore measures the **global** cap alone;
per-client behaviour is covered by `tests/fairness.test.ts`.

### What this does and does not prove

- It proves the concurrency cap holds under a sustained 100-client flood, that
  overflow is shed as `503` with `reason: "concurrency"`, and that server RSS
  stays bounded well under the 224 MiB budget.
- It does **not** prove zero allocation or a perfectly flat RSS line. RSS is
  process-wide and includes V8 heap growth and connection churn, and no GC is
  forced (`--expose-gc` is not used). The claim is bounded growth, not zero
  growth.
- Memory-pressure shedding is a separate scenario: run [3] of `npm run bench`
  reports RSS above the budget and asserts that all traffic is shed before any
  body is parsed. The flood's memory-shed count is 0 by design, because RSS
  never approaches the budget.

## The results

Two consecutive runs, identical parameters (6,000 requests, 100 clients, cap 8,
5 ms cassette latency):

| Metric | Run 1 | Run 2 |
|---|---|---|
| Requests | 6,000 | 6,000 |
| Client concurrency | 100 | 100 |
| Admission cap | 8 | 8 |
| Admitted (200) | **1,298** | **1,212** |
| Shed (503, concurrency) | **4,702** | **4,788** |
| Shed (503, memory) | 0 | 0 |
| Shed rate | **78.4%** | **79.8%** |
| Wall clock | 2,320 ms (2,586 req/s) | 2,367 ms (2,535 req/s) |
| Peak in-flight | **8** | **8** |
| Server RSS baseline | 67.0 MiB | 67.6 MiB |
| Server RSS peak | 80.9 MiB | 79.1 MiB |
| Server RSS final | 82.7 MiB | 79.1 MiB |
| RSS delta | +15.7 MiB | +11.5 MiB |

Raw output of run 1:

```text
Aperture flood benchmark — isolated server process
server     node v26.13.0 · 2 vCPU · 3.8 GiB RAM
client     this parent process (excluded from server RSS)

requests            6000
client concurrency  100
admission cap       8
cassette latency    5 ms

admitted (200)      1298
shed (503)          4702
  memory reason     0
  concurrency       4702
network errors      0
shed rate           78.4%

wall clock          2320 ms (2586 req/s)
peak in-flight      8
server rss baseline 67.0 MiB
server rss peak     80.9 MiB
server rss final    82.7 MiB
rss delta           15.7 MiB
cassettes warm      sleepy
```

Peak in-flight sits exactly at the cap in both runs: the gateway admits 8 and
refuses the rest, rather than admitting more and degrading. The admitted count
is bounded by the cassette's service rate (8 slots × 5 ms), not by the 6,000
requests offered.

### Reference: controlled shed bench

`npm run bench`, same machine, one run:

```text
[1] concurrency cap 8 · burst 200 · 25ms cassette latency
    admitted (200):        42
    shed (503 concurrency): 158
    shed rate:             79.0%
    peak in-flight:        8

[2] concurrency cap 8 · steady 4 concurrent · 100 requests
    admitted (200):        100
    shed (503):            0
    shed rate:             0.0%

[3] memory budget 224 MiB · rss reported budget+1 · 25 requests
    shed (503 memory):     25
    admitted:              0
    shed rate:             100.0%
    cassettes woken:       0
```

Run [2] is the control: under the cap, nothing is shed. Run [3] is the only
place memory shedding is asserted, and it is deliberately deterministic.

## The command

```bash
npm ci
npm run bench:flood
```

Override the parameters to test different pressures:

```bash
FLOOD_TOTAL=6000 FLOOD_CONCURRENCY=100 FLOOD_CAP=8 FLOOD_DELAY_MS=5 npm run bench:flood
```

And the controlled harness:

```bash
npm run bench
```

Both build the project first, then run against `dist/`. CI runs `npm run bench`
on Node 20; the flood harness is available locally but is not part of the CI
gate.
