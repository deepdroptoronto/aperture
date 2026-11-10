# The UI Cassette

The UI layer of the Angel Armor legacy, packaged as a cassette: portable React
components with **zero database, zero network calls, zero global state, and zero
imports from the Aperture engine**. Two peer dependencies only — `react` and
`react-dom`.

Drop it into any React app. It has no opinion about your router, your styling
system, your data layer, or where it is mounted.

## Install

```bash
npm install ./angel-armor-ui-1.0.0.tar.gz
npm install react react-dom   # peer dependencies, if not already present
# import { Mascot, WatchPager, MoneyRain } from '@deepdrop/angel-armor-ui'
```

The tarball is the physical cassette: it contains `package.json`, this README
and `src/`. Ship it into BookPilot, 1TicketPunch, or anything else that can
compile TSX.

## Requirements

- React 18 or 19 (both are supported).
- A bundler that compiles TSX (Next.js, Vite, Remix, Rspack, and so on). The
  package ships source on purpose: no build artefacts, no duplicated React, no
  bundler-specific output to debug.
- Components that animate use only CSS; `MoneyRain` draws to a canvas. Nothing
  reads from `window` at module scope, so server rendering is safe.

## Components

### `Mascot`

The armored mascot, with three states and scoped animations.

```tsx
import { Mascot } from '@deepdrop/angel-armor-ui';

<Mascot state="celebrate" size={120} accent="#22d3ee" />
```

| Prop | Type | Default | Notes |
|---|---|---|---|
| `state` | `'idle' \| 'walk' \| 'celebrate'` | `'idle'` | Selects the animation set |
| `size` | `number` | `96` | Edge length in px |
| `label` | `string` | per-state text | `aria-label` override |
| `color` | `string` | `#e8ecf5` | Shield and leg colour |
| `accent` | `string` | `#eab308` | Trim, emblem, sparkles |
| `disableAnimations` | `boolean` | `false` | Static pose |

Keyframes are scoped to the instance, so two mascots never share or leak styles.
`prefers-reduced-motion: reduce` disables animation automatically.

### `WatchPager`

A CSS scroll-snap pager. The browser owns the scroll; the component keeps the
index in sync, and adds arrow keys, dots and prev/next controls.

```tsx
import { WatchPager } from '@deepdrop/angel-armor-ui';

<WatchPager
  pages={invoices}
  ariaLabel="Recent invoices"
  renderPage={(invoice) => <InvoiceCard invoice={invoice} />}
  onIndexChange={(index) => prefetch(invoices[index + 1])}
/>
```

| Prop | Type | Default | Notes |
|---|---|---|---|
| `pages` | `readonly T[]` | — | Data, not elements |
| `renderPage` | `(page, index) => ReactNode` | — | Render callback |
| `initialIndex` | `number` | `0` | Clamped to range |
| `gap` | `number` | `12` | Slide gap, also used for scroll maths |
| `showControls` | `boolean` | `true` | Prev/next buttons |
| `showDots` | `boolean` | `true` | Tab-style dot controls |
| `onIndexChange` | `(index) => void` | — | Fires on scroll, click and key |

### `MoneyRain`

A Canvas 2D celebration overlay: 64 bills, one frame loop, and it unmounts
itself when the burst ends.

```tsx
import { MoneyRain } from '@deepdrop/angel-armor-ui';

<MoneyRain active={paid} durationMs={2600} onComplete={() => setPaid(false)} />
```

| Prop | Type | Default | Notes |
|---|---|---|---|
| `active` | `boolean` | `true` | Toggle the burst |
| `durationMs` | `number` | `2600` | Lifetime before auto-unmount |
| `count` | `number` | `64` | Particle count |
| `onComplete` | `() => void` | — | Fired exactly once |
| `zIndex` | `number` | `60` | Overlay stacking |
| `respectReducedMotion` | `boolean` | `true` | Skip animation entirely |

The canvas is `position: fixed`, `pointer-events: none` and `aria-hidden`, so it
never blocks clicks or appears in the accessibility tree. The `requestAnimationFrame`
loop and the resize listener are both cancelled on unmount.

## Purity guarantees

- No `dependencies`, only `peerDependencies` (`react`, `react-dom`).
- No imports outside `src/` of this package.
- No `fetch`, no storage, no cookies, no analytics, no environment variables.
- No build step required to consume it — but none of the sources touch Node
  APIs, so any React renderer can use them.

## Exporting the cassette

From the repository root:

```bash
npm run export:ui
```

This validates the package (no stray dependencies, no imports from the engine)
and writes `dist/angel-armor-ui-1.0.0.tar.gz`.
