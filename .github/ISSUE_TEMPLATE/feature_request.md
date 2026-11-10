---
name: Feature request
about: Propose a cassette, a tier policy, or a UI component
title: '[feat] '
labels: enhancement
assignees: ''
---

## Problem

<!-- What can you not do today? Concrete use case beats a wish list. -->

## Proposed change

<!-- API sketch, manifest entry, or behaviour you have in mind. -->

## Which tier does it touch?

- [ ] 💎 Platinum (engine wiring, options, lifecycle)
- [ ] 🥇 Gold (manifest schema, route proof)
- [ ] 🥈 Silver (admission, shedding, teardown policy)
- [ ] 🥉 Copper (cassette contract, loader)
- [ ] 📦 UI cassette
- [ ] Docs / CI / tooling

## Route impact

- [ ] This adds no HTTP route
- [ ] This adds route(s), declared in the manifest as `METHOD /path`

> The Gold Kernel refuses to boot on any route that is not in the manifest, so a
> feature that needs a route must say so here.

## Cost when unused

A cassette you never wake must cost zero bytes. If this change keeps state
outside an instance (module-level caches, timers, listeners), explain how it is
released.

## Alternatives considered

<!-- Existing options (`budgetBytes`, `maxConcurrency`, `idleMs`, `readRss`)? -->
