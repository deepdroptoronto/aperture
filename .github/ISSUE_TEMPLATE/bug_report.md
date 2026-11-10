---
name: Bug report
about: Something behaves differently from what the docs promise
title: '[bug] '
labels: bug
assignees: ''
---

## What happened

<!-- One or two sentences. What did you expect, and what did you get? -->

## Reproduction

<!-- Smallest steps, request, or code that triggers it. A payload helps. -->

```bash
# commands or a curl that reproduces it
```

## Which tier is involved?

- [ ] 💎 Platinum (engine wiring, startup, config)
- [ ] 🥇 Gold (manifest validation, route proof)
- [ ] 🥈 Silver (shedding, RSS budget, concurrency cap, teardown)
- [ ] 🥉 Copper (lazy load, cassette contract, `handle`)
- [ ] 📦 UI cassette (`@deepdrop/angel-armor-ui`)
- [ ] Docs / CI / Docker

## Is it a shed response?

If you are seeing `503 {"error":"overloaded"}`, paste the full body and the
reason (`memory` or `concurrency`), plus the output of:

```bash
curl -s localhost:3000/stats
curl -s localhost:3000/__aperture/proof
```

## Environment

- Node version (`node -v`):
- Commit or package version:
- OS / container image:
- Cassette name (if relevant):

## Checks you already ran

- [ ] `npm run build` passes
- [ ] `node --test dist/tests/` passes
- [ ] The route is declared in the manifest

## Logs

<!-- Stack traces, server output, anything from onShed / onError. -->
