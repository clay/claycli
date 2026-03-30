# Bundler Pipeline Comparison

> **Why did we choose Vite?** This document is a record of the pipelines we evaluated before
> arriving at that decision. Only two pipelines exist in `claycli` today: the legacy
> `clay compile` (Browserify) and the current `clay vite`. The other pipelines described here
> — esbuild and bare Rollup — were tested and discarded. They are documented here purely so
> the reasoning is preserved, not because they are available or will ever be shipped.
>
> For the full technical reference of the Vite pipeline, see [`CLAY-VITE.md`](./CLAY-VITE.md).

---

## Table of Contents

1. [The Legacy: Browserify + Gulp](#1-the-legacy-browserify--gulp)
2. [Attempt 1: esbuild (clay build)](#2-attempt-1-esbuild-clay-build)
3. [Attempt 2: Rollup + esbuild (clay rollup)](#3-attempt-2-rollup--esbuild-clay-rollup)
4. [The Choice: Vite (clay vite)](#4-the-choice-vite-clay-vite)
5. [Measured Performance: Vite vs Browserify](#5-measured-performance-vite-vs-browserify)
6. [Bundler Comparison Matrix](#6-bundler-comparison-matrix)
7. [Why Not the Others](#7-why-not-the-others)
8. [Migration Roadmap](#8-migration-roadmap)

---

## 1. The Legacy: Browserify + Gulp

### What it did

Browserify consumed every `client.js`, `model.js`, and `kiln.js` file as an entry point
and bundled them into alpha-bucketed mega-bundles (`_deps-a.js`, `_kiln-a-d.js`, etc.).
Gulp orchestrated 20+ sequential plugins to wire CSS, templates, fonts, and JS together.
A custom runtime (`_prelude.js` + `_postlude.js`) shipped with every page and registered
all modules in a global `window.modules` map under numeric IDs.

```
Source files
    │
    ▼
Browserify + Babel (30–60 s)
    │   ├── wraps every CJS module in a factory function
    │   ├── assigns numeric IDs
    │   └── emits _deps-a.js, _deps-b.js … (alpha-bucketed)
    │
    ▼
_prelude.js / _postlude.js  ← shipped to every page
_registry.json + _ids.json  ← opaque numeric dep graph
_client-init.js             ← mounts every .client module loaded, DOM or not
```

### Problems

| Problem | Impact |
|---|---|
| Mega-bundles (all components in one bucket) | Any change rebuilt everything; watch mode: 30–60 s |
| Gulp plugin chain (20+ plugins) | Complex dependency graph, version conflicts, slow installs |
| Sequential build steps | CSS, JS, templates all waited on each other; total ≈ sum of all steps |
| No shared chunk extraction | Each component dragged in its own copy of shared deps |
| No tree shaking | Entire CJS modules bundled regardless of what was used |
| No source maps | Production errors pointed to minified line numbers |
| Static filenames | `article.client.js` — full CDN invalidation on every deploy |
| `window.modules` runtime (616 KB/page) | Every page carried uncacheable inlined JS |
| Babelify transpilation | Even tiny changes triggered a full Babel pass |
| `_registry.json` numeric module graph | Opaque, impossible to inspect or extend |
| `browserify-cache.json` | Stale cache silently served old module code |

**Performance baseline (Lighthouse, 3 runs, simulated Moto G Power / slow 4G):**

| Metric | Browserify |
|---|---|
| Perf score | 48 |
| FCP | 2.8 s |
| LCP | 14.3 s |
| TBT | 511 ms |
| TTI | 23.2 s |
| JS transferred | 417 KB |
| Total JS gzip | 6,944 KB |
| Content-hashed files | 0% |
| Inline JS per page | 616 KB (uncacheable) |

---

## 2. Attempt 1: esbuild (`clay build`)

### What it did

esbuild replaced Browserify as the JS bundler and PostCSS 8's programmatic API replaced
Gulp's stream-based CSS pipeline. All build steps ran in parallel. The custom
`window.modules` runtime was replaced with native ESM and a generated `_view-init.js`
bootstrap that dynamically imports component code only when the component's DOM element
is present.

### Strengths

- **Extremely fast.** esbuild is a native Go binary — ~3 s for JS, ~33 s total (was 90–120 s).
- **Parallel steps.** Media, JS, CSS, templates, fonts — all run simultaneously.
- **Native ESM output.** No custom runtime; browsers handle imports natively.
- **Content-hashed filenames.** Unchanged files stay cached across deploys.
- **Human-readable `_manifest.json`.** Replaced the numeric `_registry.json` + `_ids.json`.

### Limitations

- **No `manualChunks` equivalent.** esbuild splits at every shared module boundary regardless
  of size, producing hundreds (500+) of tiny files. Hundreds of tiny HTTP/2 streams add
  parse overhead and delay the LCP image fetch.
- **CJS circular deps.** esbuild inlines all CJS into a flat IIFE scope, which sidesteps
  circular dependency ordering — but CJS modules with runtime initialization order
  dependencies can behave unexpectedly.
- **No chunk size control.** There is no way to say "inline this tiny module into its sole
  importer" without switching to a bundler that exposes a module-graph API.
- **CJS→ESM interop is opaque.** esbuild wraps CJS in its own `__commonJS()` helpers with
  no user-configurable override.

### Lesson learned

esbuild proved that the `_view-init.js` / dynamic import architecture was correct and the
perf wins from native ESM were real. But its lack of a module-graph API made chunk size
management impossible — we needed something built on Rollup.

---

## 3. Attempt 2: Rollup + esbuild (`clay rollup`)

### What it did

Rollup 4 drove the module graph, tree-shaking, and chunk assignment. esbuild served only
as a fast in-process transformer for two sub-tasks: define substitution (Node globals) and
optional minification via `renderChunk`. This is structurally similar to how a Gulp pipeline
would wire Browserify for bundling and then pipe output through a separate minifier — each
tool does one thing it is best at.

### Strengths

- **`manualChunks` control.** Rollup exposes the full module graph via `getModuleInfo()`.
  The custom `viteManualChunksPlugin` walked each module's importer chain and inlined small
  private modules back into their sole consumer. This directly addressed the "500 tiny chunks"
  problem from esbuild.
- **`strictRequires: 'auto'`** in `@rollup/plugin-commonjs` detected circular CJS
  dependencies at build time and wrapped only the participating `require()` calls in lazy
  getters.
- **Explicit plugin ordering.** Every transform step was a named plugin in a defined sequence.

### Why Rollup was not the final answer

Setting up the Rollup pipeline was significantly more complex than expected:

1. **CJS/ESM interop required multiple plugins with specific configuration.** `@rollup/plugin-commonjs`
   with `strictRequires: 'auto'`, `transformMixedEsModules: true`, `requireReturnsDefault: 'preferred'`,
   and a custom `commonjsExclude` list per site. Getting this right without breaking CJS
   circular dependencies required extensive debugging.
2. **Two separate bundler passes in one pipeline.** esbuild handled node_modules pre-bundling
   conceptually, while Rollup handled source — but without Vite's managed `optimizeDeps`
   lifecycle, we had to manually decide what to exclude from `@rollup/plugin-commonjs`.
3. **pyxis-frontend required a safe-wrap plugin** because its internal webpack `eval()`-based
   modules conflicted with `@rollup/plugin-commonjs`'s rewriting. This was a per-package
   exception that added fragility. The fix required patching the dependency itself.
4. **`process.env` in view mode.** Components that worked fine in the esbuild pipeline
   crashed with "process is not defined" under Rollup because the esbuild define transform
   was not firing for all cases. Required adding a custom esbuild-transform Rollup plugin.
5. **No client-env.json generation.** This had to be manually ported, then discovered missing
   at CI build time with a hard error.
6. **Build time: ~40 s** — slower than Vite's ~30 s for the same output, because Rollup's
   JS event loop processes the module graph serially vs Vite's internal optimizations.

The Rollup pipeline produced correct output, but every problem we solved revealed a new one.
With Vite, the same architecture (Rollup for production) was already pre-configured with
correct defaults for exactly this kind of CJS+ESM mixed project.

---

## 4. The Choice: Vite (`clay vite`)

### What Vite adds on top of Rollup

Vite uses Rollup 4 internally for production builds. The key differences from bare Rollup:

| Concern | Bare Rollup (`clay rollup`) | Vite (`clay vite`) |
|---|---|---|
| `node_modules` CJS handling | `@rollup/plugin-commonjs` on everything | esbuild pre-bundler (`optimizeDeps`) converts CJS deps before Rollup sees them |
| CJS circular deps in node_modules | Requires per-package `commonjsExclude` tuning | Handled automatically by pre-bundler |
| pyxis safe-wrap workaround | Required a custom plugin | Not needed — pre-bundler resolves webpack eval() modules |
| Plugin API | Rollup hooks only | Rollup hooks + Vite build extensions (`closeBundle`, `generateBundle`, etc.) — dev-server hooks (`configureServer`, HMR) are not used |
| Dev watch | `rollup.watch()` + chokidar polling | `rollup.watch()` (Rollup incremental rebuild) — **Vite's HMR dev server is not used**; Clay uses a server-rendered architecture (Amphora) that has no Vite dev server in the request path |
| Config surface | Every Rollup option must be threaded manually | One `bundlerConfig()` hook exposes the relevant subset |
| Build speed (production) | ~40 s | ~30 s |
| Vue 3 migration | Would require a custom SFC compiler plugin | `@vitejs/plugin-vue` is first-party and maintained by the Vite team |
| Lightning CSS migration | Manual Rollup plugin | `css: { transformer: 'lightningcss' }` in baseViteConfig |
| Rolldown migration | Not applicable | Direct swap when Rolldown is stable (same plugin API, same config shape) |

### Why `optimizeDeps` was the key insight

The single largest source of friction in the Rollup pipeline was CJS interop for
`node_modules`. Packages like pyxis-frontend, vue, and various utility libraries all
needed special handling. Vite's `optimizeDeps` pre-bundles all `node_modules` via esbuild
*before* Rollup sees them, converting CJS to ESM in one batch. `@rollup/plugin-commonjs`
then only needs to handle project source files — a much smaller surface where the site
developer has full control.

By disabling `optimizeDeps.noDiscovery: true` we further prevented any accidental dep
scanning that could add latency. The result is a clean, predictable build where CJS
complexity is handled at the boundary of `node_modules`, not inside the source graph.

### Why the config API is better

With bare Rollup, any site-level customization required understanding the full Rollup
configuration — input, output, plugins array ordering, commonjsOptions, etc. Bugs like
"my plugin runs before commonjs rewrites the module" were non-obvious.

Vite's `bundlerConfig()` hook in `claycli.config.js` is a minimal, purpose-built API
that exposes only what sites need to customize:

```js
bundlerConfig: config => {
  config.manualChunksMinSize = 8192;   // chunk inlining threshold
  config.alias = { '@sentry/node': '@sentry/browser' }; // simple redirects
  config.define = { DS: 'window.DS' }; // identifier replacements
  config.plugins = [...];               // extra Rollup plugins
  return config;
}
```

Everything else — plugin ordering, Rollup internals, CJS interop settings, output format,
chunk naming, modulepreload polyfill, etc. — is managed by claycli. Sites that never need
to touch these settings simply do not define `bundlerConfig`.

### ESM migration runway

Every CJS compatibility shim in the Vite pipeline is a named, documented item with a clear
"removed when" condition:

| Shim | Removed when |
|---|---|
| `@rollup/plugin-commonjs` | All `.js` files use `import`/`export` |
| `strictRequires: 'auto'` | No CJS circular deps remain |
| `transformMixedEsModules: true` | `.vue` scripts use `import` only |
| `hoistRequires` in vue2Plugin | `.vue` scripts use `import` only |
| `inlineDynamicImports: true` (kiln pass) | Kiln plugins are proper ESM modules |
| Two-pass build | `kilnSplit: true` is enabled |
| `serviceRewritePlugin` | Client/server service contracts are explicit |
| `browserCompatPlugin` | No server-only imports reach the client bundle |

New components can be written as ESM from day one. Existing components migrate one at a time.
When `clientFilesESM: true` is set in `bundlerConfig`, Rollup's native `experimentalMinChunkSize`
replaces the custom `viteManualChunksPlugin` entirely, getting chunk size control for free.

### Future technology path

Vite was chosen specifically because it is the default integration point for:

- **Lightning CSS** — `css: { transformer: 'lightningcss' }` in `baseViteConfig`. Replaces
  PostCSS with Rust-native CSS parsing. One config key, no plugin migration.
- **Vue 3** — `@vitejs/plugin-vue` coexists with the current `viteVue2Plugin`. New components
  use Vue 3; legacy components keep Vue 2 until migrated. Both compile correctly in the same
  build.
- **Rolldown** — the Rust rewrite of Rollup built by the Vite team. Same plugin API, same
  config shape, esbuild-level build speed. The migration will be one `npm install` and a
  config tweak in claycli. Nothing in `claycli.config.js` or any component will need to change.

---

## 5. Measured Performance: Vite vs Browserify

> **About these numbers:** Performance was measured against the Rollup pipeline (`clay rollup`)
> because it was deployed to a feature branch environment first. Since Vite uses Rollup 4
> internally for production builds and produces structurally identical output (same dynamic
> `import()` bootstrap, same `manualChunks` logic, same content-hashed chunk filenames),
> the Rollup production numbers represent what Vite also achieves. Both pipelines:
> - Run the same `viteManualChunksPlugin` logic
> - Produce the same ESM output format
> - Use the same `_manifest.json` → `resolveModuleScripts()` runtime injection
> - Apply the same caching strategy (`Cache-Control: immutable` for content-hashed files)
>
> The one area where Vite may differ slightly: build time is ~25% faster because Vite's
> internal `optimizeDeps` pass means `@rollup/plugin-commonjs` processes less code.
>
> **URLs used for measurement:**
> - **Vite/Rollup:** `https://jordan-yolo-update.dev.nymag.com/` (minification enabled)
> - **Browserify:** `https://alb-fancy-header.dev.nymag.com/` (legacy `alb-fancy-header` branch)
>
> **Note on URL parity:** The two test URLs serve different featurebranch deployments with
> potentially different page content. Focus on JS-specific and timing metrics, not total bytes.

### Core Web Vitals (Lighthouse — simulated throttle, 3 runs avg)

| Metric | Browserify | Vite pipeline | Δ |
|---|---|---|---|
| Perf score | 48 | **50** | **+4%** |
| FCP | 2.8 s | **1.8 s** | **−37%** ✅ |
| LCP | 14.3 s | **11.9 s** | **−17%** ✅ |
| TBT | 511 ms | 565 ms | +11% ⚠ |
| TTI | 23.2 s | 23.2 s | ≈ 0 |
| SI | 6.1 s | 7.1 s | +16% ⚠ |
| TTFB | 346 ms | 340 ms | −2% |
| JS transferred | 417 KB | **478 KB** | +15% ⚠ |

**Interpretation:**

- **FCP −37%** is the headline win. The ESM bootstrap delivers first paint earlier than
  Browserify's monolithic bundle. The browser receives `<link rel="modulepreload">` hints
  in `<head>` and starts fetching the init scripts during HTML parsing — Browserify had no
  preload hints because all JS was inlined in the body.
- **LCP −17%** with minification active. The unminified Rollup/Vite build showed LCP
  regression vs Browserify; minification reverses this. The main driver is code volume: the
  ESM bootstrap and its critical-path chunks are smaller when minified than Browserify's
  single IIFE bundle.
- **TBT +11%** is expected and will improve. Vite emits native ESM modules — each module
  requires its own parse + link phase. Browserify emits a single IIFE (one parse pass, all
  code evaluated up front). As the codebase migrates to ESM, the `__commonJS()` wrapper
  boilerplate shrinks and TBT will improve through better tree-shaking and deferred loading.
- **JS transferred +15%** reflects the Vite build including more entry points per page
  (component chunks loaded on demand) vs Browserify's single monolithic bundle. The per-revisit
  cache story strongly favours Vite.

### Core Web Vitals (WebPageTest — real network, Chrome 143, Dulles VA, 3 runs)

| Metric | Browserify | Vite pipeline | Δ |
|---|---|---|---|
| TTFB | 980 ms | 983 ms | ≈ 0 |
| Start Render | 1,667 ms | **1,633 ms** | **−2%** |
| FCP | 1,658 ms | **1,634 ms** | **−1%** |
| LCP | 4,302 ms | 4,944 ms | +15% ⚠ |
| TBT | 1,416 ms | **1,015 ms** | **−28%** ✅ |
| Speed Index | 4,015 | **3,953** | **−2%** |
| Fully Loaded | 16,869 ms | 21,756 ms | +29% ⚠ |
| Total requests | 195 | 250 | +28% |
| Total bytes | 4.6 MB | 12.1 MB | +163% ⚠ |

**Interpretation:**

- **TBT −28%** is a concrete win under real-network conditions. Minification reduces the parse
  overhead per chunk and eliminates the `__commonJS()` wrapper boilerplate the browser had to
  evaluate on every page load.
- **FCP / Start Render** are marginally faster — consistent with the Lighthouse results.
- **LCP +15%** is the open issue. The primary driver is request count: 250 vs 195. Even on
  HTTP/2, 250 concurrent streams creates depth that can delay the LCP image fetch on slower
  connections. Raising `manualChunksMinSize` in `claycli.config.js` directly reduces chunk
  count. Migrating `client.js` files to ESM also reduces chunk count by eliminating CJS wrapper
  modules that inflate chunk size below the merge threshold.
- **Total bytes 12.1 MB vs 4.6 MB:** This difference is dominated by source maps — Vite emits
  a `.js.map` per chunk and WebPageTest counts all responses including source maps. The actual
  JavaScript the browser executes is **478 KB** per Lighthouse.
- **Fully Loaded +29%:** More HTTP/2 streams settling, but most are cached on repeat visits.

### Bundle structure comparison (local, minified build)

| Metric | Browserify | Vite pipeline |
|---|---|---|
| Total JS files | 2,179 | **307** |
| Total uncompressed | 26,942 KB | **19,469 KB** |
| Total gzip | 6,944 KB | **4,571 KB** |
| Shared chunks | 0 | **297** |
| Content-hashed files | 0% | **~97%** |
| Inline JS per page | 616 KB | **0 KB** |
| Warm-cache 304 rate | 82% | **97%** |

**Notes:**

- Vite's 307 files break down as: 6 template bundles, 2 kiln bundles, 2 bootstrap/init
  `.clay/` files, and 297 shared chunks.
- Total uncompressed is **28% smaller** than Browserify even including source maps. Gzip
  wire size drops **34%**.
- The 97% warm-cache rate vs 82% for Browserify reflects content-hashed filenames: unchanged
  modules are served from browser cache after the first visit. Browserify's static filenames
  forced 304 revalidation for everything on every deploy.
- **616 KB of inline JS per page eliminated.** The Browserify `window.modules` runtime and
  component bundle were inlined into every HTML response. This was uncacheable by definition.

### Build time

| Pipeline | JS build time | Total time |
|---|---|---|
| Browserify + Gulp | 30–60 s | 90–120 s |
| esbuild | ~3 s | ~33 s |
| Rollup + esbuild | ~40 s | ~70 s |
| **Vite** | **~30 s** | **~30 s** (client-env now free via Rollup plugin) |

Vite is faster than bare Rollup because its `optimizeDeps` pass converts `node_modules`
CJS to ESM before Rollup sees them, reducing the number of modules `@rollup/plugin-commonjs`
must process. Build time will improve further as files migrate to native ESM (fewer modules
need CJS wrapping).

---

## 6. Bundler Comparison Matrix

| Capability | Browserify | esbuild | Rollup + esbuild | Vite |
|---|---|---|---|---|
| Build speed | 90–120 s | ~33 s | ~70 s | ~60 s |
| `manualChunks` control | None | None | Full | Full |
| CJS→ESM conversion | N/A (CJS only) | Opaque | Configurable | Managed by `optimizeDeps` |
| CJS circular dep handling | Runtime | Implicit | `strictRequires: 'auto'` | Pre-bundled (automatic) |
| Chunk size inlining | No | No | Yes | Yes + native ESM (`experimentalMinChunkSize`) |
| Tree shaking | No | Yes (ESM only) | Yes | Yes |
| Content-hashed output | No | Yes | Yes | Yes |
| Source maps | No | Yes | Yes | Yes |
| Native ESM output | No | Yes | Yes | Yes |
| `modulepreload` hints | No | Yes * | Yes * | Yes * |
| Vue 3 migration path | No | No | Manual plugin | First-party `@vitejs/plugin-vue` |
| Lightning CSS migration path | No | No | Manual plugin | `css: { transformer: 'lightningcss' }` |
| Rolldown migration path | No | No | No | Drop-in swap (same plugin API) |
| Config API surface | `claycli.config.js` | `claycli.config.js` | All Rollup options exposed | `bundlerConfig()` subset only |
| Dev watch | No | chokidar polling | `rollup.watch()` | `rollup.watch()` (HMR server not used) |
| `node_modules` CJS isolation | N/A | Implicit | Manual `commonjsExclude` | Automatic |
| Setup complexity | Low | Low | High | Medium |
| ESM migration runway | No | Partial | Full | Full + Rolldown-forward-compatible |

\* Implemented at the `amphora-html` layer, not by the bundler directly.

---

## 7. Why Not the Others

### Why not keep Browserify?

The Browserify `window.modules` runtime shipped 616 KB of uncacheable inline JS to every
page. Every deploy invalidated every JS file. No tree shaking, no shared chunk extraction,
no source maps. Build times of 90–120 s made watch mode unusable for local development.

### Why not just use esbuild?

esbuild was the right first step — the `_view-init.js` dynamic-import architecture,
`_manifest.json`, and `Cache-Control: immutable` strategy all came from the esbuild phase
and carried forward unchanged. But esbuild's inability to control chunk size (no
`manualChunks` equivalent) meant the 500+ tiny chunk problem was structural, not fixable
with configuration. We needed Rollup's module graph API.

### Why not stay on Rollup?

Rollup was viable but required managing too many moving parts at once:

- `@rollup/plugin-commonjs` configuration with multiple per-package exceptions
- A custom esbuild-transform plugin just to handle `process.env` defines
- A custom safe-wrap plugin for pyxis-frontend that had to be removed when the dep was patched
- Two parallel build passes with carefully synchronized output
- Manual `client-env.json` generation that was missing at first and discovered at CI time

Every time a new CJS dependency was added to the project, the Rollup pipeline needed updating.
Vite handles this at the `optimizeDeps` boundary automatically.

Additionally, Rollup is not the strategic direction for the frontend ecosystem. The Vite
team is building **Rolldown** as a Rust replacement for Rollup, targeting 10× build speeds
with the same API. Vite will migrate to Rolldown as its production bundler. By choosing Vite
now, the Clay pipeline gets the Rolldown upgrade for free — one `npm install` in claycli.

### Why not Webpack?

Webpack was never seriously considered. Its configuration complexity dwarfs even bare Rollup,
its build speed is 3–5× slower than Vite for this size of codebase, and its ecosystem is
in maintenance mode as projects migrate to Vite. Webpack 5 is still widely used but new
projects in the web ecosystem choose Vite overwhelmingly.

---

## 8. Migration Roadmap

The long-term direction is **`clay vite` with progressive ESM migration**, targeting Rolldown:

| Step | Action | Config change | Benefit |
|---|---|---|---|
| 1 | New components: write as ESM from day one | No config change needed | Future-proof from the start; new code is immediately tree-shakeable and Rolldown-ready |
| 2 | Migrate `model.js` / `kiln.js` to ESM | Set `kilnSplit: true` → collapses to one build pass | Eliminates the second Vite build pass; cuts total build time for the kiln/model bundle |
| 3 | Migrate `client.js` files to ESM | Set `clientFilesESM: true` → switches to `experimentalMinChunkSize`; `@rollup/plugin-commonjs` becomes a no-op per file | Native Rollup chunking replaces custom plugin; smaller chunks, better tree-shaking, reduced TBT |
| 4 | Migrate Vue 2 → Vue 3 | Add `@vitejs/plugin-vue`; remove `viteVue2Plugin` from claycli | Smaller runtime (Vue 3 is ~40% smaller than Vue 2), Composition API, first-party Vite support |
| 5 | Replace PostCSS with Lightning CSS | `css: { transformer: 'lightningcss' }` in `baseViteConfig` | Rust-native CSS parsing — dramatically faster CSS build step; modern syntax support with zero config |
| 6 | Remove `commonjsOptions` entirely | All source is native ESM — no CJS shims needed | Removes all `__commonJS()` wrapper boilerplate from output; smaller bundles, lower TBT, cleaner output |
| 7 | Migrate to Rolldown | One `npm install` in claycli; no site `claycli.config.js` changes | esbuild-level build speed (~10×) with full Rollup plugin compatibility; sub-10 s JS build times |

At step 7, the pipeline is: `vite build` → native ESM output. No CJS shims. No two-pass
build. No PostCSS. No Babel. Sub-10 s build times.

The key architectural decision that makes this roadmap work: **every CJS shim is a
named, temporary scaffold with a clear removal condition.** Nothing is permanent debt.
Each migration step removes something rather than adding something.
