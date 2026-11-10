# Summary

<!-- What changed, and why. Link the issue if there is one. -->

## Tier touched

- [ ] 💎 Platinum
- [ ] 🥇 Gold
- [ ] 🥈 Silver
- [ ] 🥉 Copper
- [ ] 📦 UI cassette (`packages/angel-armor-ui`)
- [ ] Docs / CI / Docker

## Checklist

- [ ] `npm run build` passes
- [ ] `node --test dist/tests/` passes (29 tests at v1.0.0)
- [ ] `npm run verify:ui` passes if `packages/angel-armor-ui` changed
- [ ] Every new route is declared in the manifest (the boot proof must still pass)
- [ ] New cassettes export `{ cassette, create() }` and never receive the app or router
- [ ] Instance state is released in `teardown()` if the cassette keeps any
- [ ] README / ARCHITECTURE updated when behaviour or options changed
- [ ] No new runtime dependencies (React peers only for the UI cassette)

## Behaviour notes

<!-- Anything a reviewer should know: shedding thresholds, new failure modes, migration. -->

## Verification

<!-- Paste the gate output, bench numbers, or a curl transcript. -->
