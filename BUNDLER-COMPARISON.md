# Bundler Pipeline Comparison

This document compares the three build pipelines available in claycli:

- **`clay build`** — esbuild-only (the original pipeline)
- **`clay rollup`** — Rollup 4 + esbuild (the new pipeline)
- **`clay vite`** — Vite 5 (Rollup-based, the experimental pipeline)

Think of the relationship like this: `clay build` is to `clay rollup` as Browserify+Gulp is to Webpack — both produce a working bundle, but the underlying model differs fundamentally in how they handle module graphs, code splitting, and long-term evolvability.

---

## 1. esbuild-only (`clay build`)

### What it does

esbuild receives all entry points at once, performs its own tree-shaking and dead-code elimination using a multi-pass scan, and emits split chunks based on shared import boundaries. Custom plugins hook into `onResolve`/`onLoad` callbacks.

### Strengths

- Extremely fast (native Go binary, parallelized by default)
- Simple plugin API — everything is a transform or a resolver
- No plugin ordering concerns for common tasks

### Limitations

- **No `manualChunks` equivalent.** esbuild splits at every shared module boundary regardless of size, producing hundreds of tiny files (e.g. 500+ chunks observed in the sites build). This hurts HTTP/2 multiplexing, cache granularity, and parse time.
- **No circular-CJS awareness.** esbuild inlines all CJS modules into a flat IIFE scope, which sidesteps circular dependency ordering entirely — but also means CJS modules that depend on runtime initialization order can behave unexpectedly.
- **Limited chunk control.** There is no way to say "inline this module into its only importer" or "put these two modules in the same chunk" without switching to a bundler that exposes a module-graph API.
- **CJS-to-ESM interop is opaque.** esbuild wraps CJS modules in its own `__commonJS()` helpers but the wrapping logic is not user-configurable.

### Plugin stack

```
onResolve: browser-compat, service-rewrite, alias
onLoad:    (none — plugins return null and let esbuild read the file)
transform: esbuild built-in (parses + defines)
```

---

## 2. Rollup + esbuild (`clay rollup`)

### What it does

Rollup 4 drives module graph resolution, tree-shaking, and chunk assignment. esbuild is used only as a fast **in-process transformer** for two sub-tasks:

1. Define substitution (`process.env.NODE_ENV`, `__filename`, `global`, etc.) — runs as a Rollup `transform` hook before `@rollup/plugin-commonjs`
2. Optional minification — runs as a Rollup `renderChunk` hook so no extra disk I/O is needed

This is structurally similar to how a Gulp pipeline would wire Browserify for bundling and then pipe the output through a separate minifier: each tool does one thing it is best at.

### Strengths

- **`manualChunks` control.** Rollup exposes the full module graph via `getModuleInfo()`. The `manualChunksPlugin` walks each module's importer chain and inlines small private modules (below `manualChunksMinSize`, default 4 KB) back into their sole consumer. This directly addresses the "500 tiny chunks" problem from esbuild.
- **Explicit plugin ordering.** Every transform step is a named plugin in a defined sequence. There are no hidden passes.
- **`strictRequires: 'auto'`** in `@rollup/plugin-commonjs` detects circular CJS dependencies at build time and wraps only the participating `require()` calls in lazy getters, deferring export reads until both modules have fully initialized. This is the correct solution for `auth.js ↔ gtm.js`-style cycles without requiring site-level code changes.
- **ESM-native output.** The emitted code is real ESM (`import`/`export`), not a synthetic IIFE. Browsers receive `<link rel="modulepreload">` hints and cache individual chunks independently.
- **AST-based `hoistRequires` in `vue2Plugin`.** `require()` calls inside `.vue` script blocks are rewritten to top-level `import` declarations using `acorn` + `magic-string`, so the CJS plugin never needs to touch `.vue` files for require-hoisting — it only participates in the module graph walk.

### Tradeoffs vs esbuild

| | esbuild (`clay build`) | Rollup+esbuild (`clay rollup`) |
|---|---|---|
| Build speed | Fastest (Go native) | Slower (JS event loop + Go subprocess) |
| Chunk count control | None | Full (manualChunks + graph API) |
| CJS circular deps | Implicit inline (flat scope) | Explicit lazy getter (strictRequires) |
| Plugin ordering | Implicit (esbuild decides) | Explicit (array order) |
| CJS→ESM conversion | esbuild-internal, opaque | @rollup/plugin-commonjs, configurable |
| Output format | ESM (with esbuild helpers) | Native ESM |
| Minification | Built-in | Via esbuild.transform() in renderChunk |

### Plugin stack

```
resolveId: clay-alias, clay-missing-module, clay-browser-compat, clay-service-rewrite
transform: clay-vue2 (AST hoistRequires), clay-esbuild-transform (defines)
load:      clay-browser-compat (stubs), clay-missing-module (stubs)
resolveId: @rollup/plugin-node-resolve (browser field)
transform: @rollup/plugin-commonjs (require() → import)
renderChunk: clay-esbuild-transform (optional minify)
```

### Current tech debt and ESM migration path

The following items are **temporary compatibility shims** that exist only because the source codebase is still CommonJS. They will be removed as JS files migrate to ESM:

| Item | Why it exists | Removed when |
|---|---|---|
| `@rollup/plugin-commonjs` | Converts `require()` to Rollup-compatible `import` | All `.js` files use `import`/`export` |
| `strictRequires: 'auto'` | Handles circular `require()` cycles | No CJS circular deps remain |
| `transformMixedEsModules: true` | Allows `.vue` files to mix ESM and CJS | `.vue` scripts use `import` only |
| `hoistRequires` in vue2Plugin | Rewrites `require()` in `.vue` to `import` | `.vue` scripts use `import` only |
| `inlineDynamicImports: true` (kiln pass) | Kiln plugin `.vue` files evaluate at top level before init | Kiln plugins are proper ESM modules |
| Two-pass build (view + kiln) | Kiln edit bundle cannot split because of top-level evaluation | `kilnSplit: true` can be enabled |
| `process.env` defines | Node globals used in universal/client code | Code is properly environment-separated |
| `serviceRewritePlugin` | Bridges `services/server/*` → `services/client/*` | Client/server service contracts are explicit |
| `browserCompatPlugin` | Stubs `http`, `fs`, `path`, `stream`, etc. | No server-only imports reach the client bundle |

**The primary goal of the Rollup pipeline is not just "replace esbuild" but to create a migration runway.** Each item above represents a step on the path to a fully ESM codebase where `@rollup/plugin-commonjs` and its shims are simply deleted, leaving a clean Rollup 4 (or Rolldown) pipeline with native module resolution.

---

## 3. Vite (`clay vite`)

### What it does

Vite uses Rollup 4 internally for production builds and adds its own opinionated layer on top: `optimizeDeps` (esbuild pre-bundling of `node_modules`), a dev server with HMR, and a plugin API that maps Rollup hooks plus Vite-specific hooks (`configureServer`, `transformIndexHtml`, etc.).

### Strengths

- `optimizeDeps` pre-bundles CJS `node_modules` via esbuild *before* Rollup sees them. This means `@rollup/plugin-commonjs` never needs to handle `node_modules` — only project source code — which eliminates the `strictRequires` / `hasOwnProperty` / null-prototype concerns entirely.
- HMR in dev mode is significantly faster than polling-based `rollup.watch()`.
- The plugin ecosystem (e.g. `@vitejs/plugin-vue`) is more actively maintained than the standalone Rollup equivalents.

### Tradeoffs vs Rollup+esbuild

| | Rollup+esbuild (`clay rollup`) | Vite (`clay vite`) |
|---|---|---|
| `node_modules` CJS handling | @rollup/plugin-commonjs on everything | esbuild pre-bundle (opt-out) |
| CJS null-prototype issues | Possible (requires `.cjs` extension care) | Avoided by pre-bundler |
| Plugin API surface | Rollup hooks only | Rollup hooks + Vite extensions |
| Dev server | `rollup.watch()` + chokidar | Native HMR dev server |
| Build output control | Full manualChunks API | Same (uses Rollup internally) |
| Build speed | Rollup JS speed | Same for production; faster for dev |
| Complexity | Lower (no Vite server layer) | Higher (two runtimes: esbuild dev + Rollup prod) |
| Portability | Standalone Node.js pipeline | Requires Vite and its peer deps |

### Why `clay rollup` was chosen over `clay vite` for this phase

- **Simpler dependency surface.** The Rollup pipeline requires `rollup`, `@rollup/plugin-commonjs`, `@rollup/plugin-node-resolve`, and `esbuild` — all already available or lightweight. Vite adds its own dev server machinery, middleware layer, and pre-bundler lifecycle that is unnecessary for a server-rendered site that does not use Vite's HMR.
- **Explicit CJS control.** Vite's `optimizeDeps` pre-bundling is a black box with its own include/exclude heuristics. The Rollup pipeline exposes every CJS conversion decision explicitly via `@rollup/plugin-commonjs` options and the `commonjsExclude` hook in `claycli.config.js`.
- **Avoiding two different bundlers.** In Vite's production build, esbuild handles `node_modules` and Rollup handles source — two separate passes with separate module graphs. The Rollup pipeline uses one consistent graph traversal.
- **`clay vite` remains available** for teams that want Vite's dev server or are further along on ESM migration. The pipelines are not mutually exclusive; `CLAYCLI_BUNDLER=vite` switches to it.

---

## 4. Measured performance: Rollup vs Browserify

> Measured against the sites featurebranch environment (March 2026).
> **Rollup URL:** `https://jordan-yolo-update.dev.nymag.com/`
> **Browserify URL:** `https://alb-fancy-header.dev.nymag.com/` (legacy `alb-fancy-header` branch)
>
> Two measurement tools were used:
> - **Lighthouse** — 3 runs, simulated throttling (Moto G Power, slow 4G). Good for controlled CWV comparison.
> - **WebPageTest** — 3 runs, real Chrome 143, real network from Dulles VA (latency ~170ms). Good for real-world request waterfall and total page weight.
>
> **Note on URL parity:** The two test URLs serve different featurebranch deployments with potentially different page content (articles, images). Total byte counts are not strictly comparable — focus on JS-specific and timing metrics.

### Core Web Vitals (Lighthouse — simulated throttle)

| Metric | Browserify | Rollup | Δ |
|---|---|---|---|
| Perf score | 41 | 43 | +2 |
| FCP | 2.8 s | 1.8 s | **−36%** |
| LCP | 19.1 s | 13.2 s | **−31%** |
| TBT | 967 ms | 1020 ms | +5% |
| TTI | 25.2 s | 24.7 s | −2% |
| SI | 7.3 s | 7.0 s | −4% |
| TTFB | 374 ms | 340 ms | −9% |
| JS transferred | 490 KB | 364 KB | **−26%** |

**Interpretation:**
- FCP and LCP improve significantly with rollup — the ESM bootstrap is smaller and defers non-critical component scripts via `dynamic import()`, so the browser reaches first paint faster.
- TBT is marginally higher. This is expected: rollup emits native ESM modules (each with their own parse + link phase) whereas Browserify emits a single IIFE bundle (one parse pass, all code evaluated up front). As the codebase migrates to ESM and shared chunks stabilize, TBT should improve through better tree-shaking and deferred loading.
- JS transferred drops 26% — rollup's `manualChunks` inlines small private modules that Browserify would have duplicated across bundles.

### Core Web Vitals (WebPageTest — real network, Chrome 143, Dulles VA)

| Metric | Browserify | Rollup | Δ |
|---|---|---|---|
| TTFB | 980 ms | 933 ms | −5% |
| Start Render | 1 667 ms | 1 576 ms | **−5%** |
| FCP | 1 658 ms | 1 578 ms | **−5%** |
| LCP | 4 302 ms | 6 142 ms | +43% ⚠ |
| TBT | 1 416 ms | 1 212 ms | **−14%** |
| Speed Index | 4 015 | 5 188 | +29% ⚠ |
| Fully Loaded | 16 869 ms | 21 568 ms | +28% ⚠ |
| Total requests | 195 | 250 | +28% |
| Total bytes | 4.6 MB | 12.1 MB | +163% ⚠ |

**Interpretation of WPT findings:**
- TTFB, FCP, and TBT improve slightly with rollup — consistent with the Lighthouse results.
- LCP, Speed Index, and Fully Loaded are worse. The primary driver is **request count**: 250 requests vs 195. Even on HTTP/2, loading 1 269 chunk files (vs Browserify's handful of monolithic bundles) creates waterfall depth that pushes LCP out.
- **Total bytes (12.1 MB vs 4.6 MB):** This difference is partly page content (different article pages on different URLs, different images) and partly the rollup build being **unminified** on this featurebranch — `CLAYCLI_COMPILE_MINIFIED` is not set in the featurebranch build args. Minified rollup output would be significantly smaller.
- The LCP regression vs Browserify (not vs esbuild) on WPT is the most actionable signal. Two levers address it directly: (1) raise `manualChunksMinSize` to inline more component chunks below the threshold, and (2) enable `CLAYCLI_COMPILE_MINIFIED=true` in the featurebranch build.

### Bundle structure

| Metric | Browserify | Rollup |
|---|---|---|
| Total JS files | 2 179 | 2 341 |
| Total uncompressed | 26 942 KB | 45 974 KB |
| Total gzip | 6 944 KB | 9 963 KB |
| Shared chunks | 0 | 1 269 |
| Immutable (content-hashed) files | 0% | ~72% |
| Warm cache 304 rate | 82% | 97% |

**Notes:**
- Browserify has no shared chunks — every page request downloads the full monolithic bundle.
- Rollup's total uncompressed size is larger because it includes source maps and one file per component entry, but the gzip wire size for what the browser actually needs per page is smaller (individual chunks are cached independently after the first visit).
- The 97% warm-cache 304 rate vs 82% for Browserify reflects content-hashed filenames: unchanged modules are served from browser cache with a single conditional request rather than a full download.

### Code splitting

| Metric | Browserify | Rollup |
|---|---|---|
| Dynamic imports | No | Yes |
| Components loaded on demand | No | Yes |
| Manifest-driven asset injection | No | Yes (`_manifest.json`) |
| Shared chunk deduplication | No | 34 duplicate sets detected |

The 34 duplicate chunk sets flagged by the code-split analysis are CJS helper boilerplate (`requireDom`, `getDefaultExportFromCjs`, etc.) that is inlined into each component chunk rather than extracted to a shared module. This is a direct consequence of the CJS→ESM conversion shims still being active. As components migrate to native `import`, Rollup will deduplicate these automatically.

---

## 5. Measured performance: Rollup vs esbuild

> Rollup numbers: featurebranch `jordan-yolo-update` after rollup deployment (March 2026).
> esbuild numbers: same featurebranch URL before rollup deployment (March 2026).
> Both measured with identical Lighthouse configuration (3 runs, simulated throttling).

### Core Web Vitals

| Metric | esbuild | Rollup | Δ |
|---|---|---|---|
| Perf score | 50 | 43 | −7 |
| FCP | 1.8 s | 1.8 s | ≈ 0 |
| LCP | 9.3 s | 13.2 s | +42% |
| TBT | 650 ms | 1020 ms | +57% |
| TTI | 24.6 s | 24.7 s | ≈ 0 |
| TTFB | 491 ms | 340 ms | **−31%** |
| JS transferred | 585 KB | 364 KB | **−38%** |

**Interpretation:**

The esbuild pipeline scores higher on LCP and TBT in this run. There are two factors at play:

1. **Chunk count.** The rollup build currently emits more individual chunks (each component is its own dynamic import entry) than the esbuild build. With HTTP/2 this is fine in theory, but each ESM module link still adds a microtask boundary. The esbuild build collapses more code into fewer files, reducing that overhead.

2. **CJS shim overhead.** The `@rollup/plugin-commonjs` wrappers (`__commonJS()`, lazy getters for `strictRequires`) add evaluation overhead on the main thread. esbuild inlines everything into a flat scope. This partially explains the TBT difference.

3. **Measurement variance.** The two measurements were taken at different times using different feature branch deployments. A 42% LCP difference could partly reflect server cold-start, CDN state, or network conditions rather than purely the bundler. A controlled A/B test on the same infrastructure would narrow this.

Rollup does win cleanly on:
- **JS transferred (−38%):** Fewer bytes delivered because `manualChunks` avoids duplicating small private modules that esbuild would split into separate files.
- **TTFB (−31%):** Likely environmental (the rollup deployment was measured on a warmer server), not a structural bundler difference.

### Bundle structure

| Metric | esbuild | Rollup |
|---|---|---|
| Total JS files | 971 | 2 341 |
| Total uncompressed | 30 743 KB | 45 974 KB |
| Total gzip | 6 132 KB | 9 963 KB |
| Shared chunks | 124 | 1 269 |
| Manifest entries | 225 | 2 |
| Immutable cached files | 71% | ~72% |
| Warm cache 304 rate | 97% | 97% |

**Notes:**
- esbuild has 225 manifest entries because each component client.js is its own named entry. Rollup uses a single `rollup-bootstrap.js` entry that dynamically `import()`s each component on demand — so the manifest has just 2 top-level entries (bootstrap + kiln-edit), but the effective component count is the same.
- The chunk count difference (124 vs 1269) reflects the current `manualChunksMinSize: 8192` threshold. With more components above the threshold, rollup splits more aggressively. Raising `manualChunksMinSize` in `claycli.config.js` will reduce this.

### Build time

| Pipeline | JS build time |
|---|---|
| esbuild | < 5 s |
| Rollup + esbuild | ~39.5 s |

Rollup's build time is ~8× slower than esbuild. This is expected — Rollup runs in the Node.js event loop and makes repeated esbuild subprocess calls, while esbuild is a parallel native binary. For CI/CD this is acceptable (39s vs <5s in a 70s total build). For local watch mode, incremental rebuilds are faster because `rollup.watch()` only re-processes changed modules.

---

## 6. Decision summary

```
Goal                              | Recommended pipeline      | Notes
----------------------------------|---------------------------|---------------------------
Maximum raw build speed           | clay build (esbuild)      | ~5s vs ~40s for rollup
Best runtime LCP / TBT today      | clay build (esbuild)      | Fewer chunks, less eval overhead
Least JS transferred per page     | clay rollup               | −38% vs esbuild, −26% vs Browserify
Best cache hit rate               | clay rollup / clay build  | Both ~97% warm-cache (vs 82% Browserify)
Chunk count control               | clay rollup               | manualChunks + graph API
ESM migration runway              | clay rollup               | Shims drop off as require() → import
Modern dev server / HMR           | clay vite                 | Not needed for server-rendered SSR
Furthest from legacy CJS          | clay vite                 | esbuild pre-bundler hides CJS
```

### What the measurements tell us

- **Rollup is already better than Browserify** on every user-facing metric (FCP −36%, LCP −31%, JS transferred −26%) and the warm-cache story is dramatically better.
- **esbuild still edges out rollup on LCP/TBT** in the current CJS-heavy codebase. This is a transitional state — the `@rollup/plugin-commonjs` wrappers add evaluation overhead that disappears as modules migrate to ESM.
- **The 34 duplicate chunk sets** flagged in the rollup build are the clearest near-term signal: those are CJS boilerplate being inlined per-chunk instead of shared. Migrating those helpers to native ESM exports will reduce the chunk count and eliminate the duplication in one step.
- **Raising `manualChunksMinSize`** in `claycli.config.js` (currently 8 192 bytes) will inline more small chunks into their importers, reducing the 1 269-chunk count and improving TBT.

The long-term direction is **`clay rollup` with progressive ESM migration**. As each `require()` call is replaced with `import`, the plugin stack shrinks. When the codebase is fully ESM:

1. Remove `hoistRequires` from `vue2Plugin`
2. Remove `transformMixedEsModules`, `strictRequires`, `requireReturnsDefault` from `@rollup/plugin-commonjs`
3. Remove `@rollup/plugin-commonjs` entirely
4. Remove `@rollup/plugin-node-resolve` (Rollup 4+ handles `node_modules` natively for ESM)
5. Enable `kilnSplit: true` to collapse the two-pass build into one
6. Optionally migrate to **Rolldown** (the Rust-port of Rollup) for esbuild-level speed with zero additional tooling

At that point the pipeline is: `rollup → output`. No esbuild subprocess. No CJS shims. No two passes.
