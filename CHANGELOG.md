# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-24

### Added

- Core headless `AshlarGrid` engine and `createAshlarGrid` factory with reactive `subscribe` and `getSnapshot` APIs.
- `MasonryLayoutEngine` featuring shortest-column placement, configurable checkpoint snapshots for incremental dirty-index reflows, adaptive rolling-average height estimation, and `O(log(N / C))` per-column binary search viewport queries.
- `ResizeTracker` backed by a single shared raw `ResizeObserver` instance, `WeakMap` element tracking, `borderBoxSize` extraction, sub-pixel epsilon filtering, and `requestAnimationFrame` batch flushing.
- `ScrollTracker` with passive scroll listeners, `requestAnimationFrame` throttling, exponential moving average velocity tracking, and directional lookahead overscan.
- Automatic scroll anchoring when items above the active viewport resize or when container width changes.
- Imperative `scrollToIndex`, `appendItems`, `setItems`, `updateOptions`, `invalidateMeasurement`, `createItemRef`, `flush`, and `destroy` APIs.
- Dual ESM and CommonJS builds with complete TypeScript declaration files and zero runtime dependencies.
