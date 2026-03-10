# clay build — New Asset Pipeline

> This document covers the **`clay build`** command introduced in claycli 5.1. It explains what changed from the legacy `clay compile` command, why, how they compare, and how to run both side-by-side.

## Table of Contents

1. [Why We Changed It](#1-why-we-changed-it)
2. [Commands At a Glance](#2-commands-at-a-glance)
3. [Architecture: Old vs New](#3-architecture-old-vs-new)
4. [Pipeline Comparison Diagrams](#4-pipeline-comparison-diagrams)
5. [Feature-by-Feature Comparison](#5-feature-by-feature-comparison)
6. [Configuration](#6-configuration)
7. [Running Both Side-by-Side](#7-running-both-side-by-side)
8. [Code References](#8-code-references)
9. [Performance](#9-performance)
10. [Learning Curve](#10-learning-curve)
11. [For Product Managers](#11-for-product-managers)
12. [Tests](#12-tests)
13. [Migration Guide](#13-migration-guide) _(includes optional per-site rollout strategy)_
14. [amphora-html Changes](#14-amphora-html-changes)
15. [Bundler Comparison: esbuild vs Webpack vs Vite](#15-bundler-comparison-esbuild-vs-webpack-vs-vite)

## 1. Why We Changed It

The legacy `clay compile` pipeline was built on **Browserify + Gulp**, tools designed for the 2014–2018 JavaScript ecosystem. Over time these became pain points:

| Problem | Impact |
|---|---|
| Browserify megabundle (all components in one file per alpha-bucket) | Any change = full rebuild of all component JS, slow watch mode |
| Gulp orchestration with 20+ plugins | Complex dependency chain, hard to debug, slow npm install |
| Sequential compilation steps | CSS, JS, templates all ran in series — total time = sum of all steps |
| No shared chunk extraction | If two components shared a dependency, each dragged it in separately via the Browserify registry |
| No tree shaking | Browserify bundled entire CJS modules regardless of how much was used; no support for ESM dependency tree shaking |
| No source maps | Build errors in production pointed to minified line numbers, not source |
| No content-hashed filenames | Static filenames (`article.client.js`) forced full cache invalidation on every deploy |
| Babelify transpilation overhead | Slow even on small changes |
| `_registry.json` + `_ids.json` numeric module graph | Opaque, hard to inspect or extend |
| `_prelude.js` / `_postlude.js` custom runtime | Browserify's own module system loaded on every page, adding baseline overhead |
| `browserify-cache.json` stale cache risk | Corrupted/out-of-sync cache produced builds where old module code was silently served |
| 20+ npm dependencies just for bundling | Large attack surface, slow installs, difficult version management |

The new `clay build` pipeline replaces Browserify/Gulp with **esbuild + PostCSS 8**:

- esbuild bundles JS/Vue in **milliseconds** (not seconds) with native code-splitting and tree shaking for ESM dependencies
- PostCSS 8's programmatic API replaces Gulp's stream-based CSS pipeline
- All build steps (JS, CSS, fonts, templates, vendor, media) run **in parallel**
- A human-readable `_manifest.json` replaces the numeric `_registry.json`/`_ids.json` pair
- Watch mode starts instantly — no initial build, only rebuilds what changed
- **Source maps** generated automatically — errors point to exact source file, line, and column
- **Content-hashed filenames** (`article/client-A1B2C3.js`) — browsers and CDNs cache files forever; only changed files get new URLs on deploy
- **Native ESM** output — no custom `window.require()` runtime, browsers handle imports natively
- **Build-time `process.env.NODE_ENV`** — dead branches like `if (process.env.NODE_ENV !== 'production')` are eliminated at compile time, not runtime
- Dependency footprint reduced from 20+ bundler packages to a handful

## 2. Commands At a Glance

Both commands co-exist. You choose which pipeline to use.

### Legacy pipeline (Browserify + Gulp)

```bash
# One-shot compile
clay compile

# Watch mode
clay compile --watch
```

### New pipeline (esbuild + PostCSS 8)

```bash
# One-shot build
clay build

# Aliases (backward-compatible)
clay b
clay pn           # ← kept so existing Makefiles don't break
clay pack-next    # ← kept for the same reason

# Watch mode
clay build --watch

# Minified production build
clay build --minify
```

Both commands read **`claycli.config.js`** in the root of your Clay instance, but they look at **different config keys** so they never conflict (see [Configuration](#6-configuration)).

## 3. Architecture: Old vs New

### Old: `clay compile` (Browserify + Gulp)

```
clay compile
│
├── scripts.js  ← Browserify megabundler
│   ├── Each component client.js → {name}.client.js  (individual file)
│   ├── Each component model.js  → {name}.model.js + _models-{a-d}.js (bucket in minified mode)
│   ├── Each component kiln.js   → {name}.kiln.js   + _kiln-{a-d}.js  (bucket in minified mode)
│   ├── Shared deps              → {number}.js       + _deps-{a-d}.js  (bucket in minified mode)
│   ├── _prelude.js / _postlude.js ← Browserify custom module runtime (window.require, window.modules)
│   ├── _registry.json  ← numeric module ID graph (e.g. { "12": ["4","7"] })
│   ├── _ids.json       ← module ID to filename map
│   └── _client-init.js ← runtime that calls window.require() on each .client module
│
├── styles.js   ← Gulp + PostCSS 7
│   └── styleguides/**/*.css → public/css/{component}.{styleguide}.css
│
├── templates.js← Gulp + Handlebars precompile
│   └── components/**/template.hbs → public/js/*.template.js
│
├── fonts.js    ← Gulp copy + CSS concat
│   └── styleguides/*/fonts/* → public/fonts/ + public/css/_linked-fonts.*.css
│
└── media.js    ← Gulp copy
    └── components/**/media/* → public/media/
```

**Key runtime behaviour:** `getDependencies()` in view mode walks `_registry.json` for only the components amphora placed on the page — it is page-specific. `_client-init.js` then calls `window.require(key)` for every `.client` key in `window.modules`, which is populated only by the scripts that were served. The subtle issue is that it mounts every loaded `.client` module regardless of whether that component's DOM element is actually present on the page.

### New: `clay build` (esbuild + PostCSS 8)

```
clay build
│
├── scripts.js    ← esbuild (JS + Vue SFCs, code-split)
│   ├── Entry points: every components/**/client.js, model.js, kiln.js
│   │                 (global/js/*.js excluded — bundled into _globals-init)
│   ├── Code-split chunks: shared dependencies extracted automatically
│   ├── _manifest.json ← human-readable entry→file+chunks map
│   ├── .clay/_view-init.js ← generated bootstrap (mounts components, sticky events)
│   ├── .clay/_kiln-edit-init.js ← generated edit-mode aggregator (models + kiln.js)
│   │                               built with splitting:false — single self-contained file
│   └── .clay/_globals-init.js ← generated globals bundle (all global/js/*.js)
│                                 built with splitting:false — single self-contained file,
│                                 avoids the 70-100 tiny chunks esbuild would otherwise produce
│
├── styles.js   ← PostCSS 8 programmatic API (parallel, p-limit 50)
│   └── styleguides/**/*.css → public/css/{component}.{styleguide}.css
│
├── templates.js← Handlebars precompile (parallel, p-limit 20, progress-tracked)
│   └── components/**/template.hbs → public/js/*.template.js
│
├── fonts.js    ← fs-extra copy + CSS concat
│   └── styleguides/*/fonts/* → public/fonts/ + public/css/_linked-fonts.*.css
│
├── vendor.js   ← fs-extra copy
│   └── clay-kiln/dist/*.js → public/js/
│
├── media.js    ← fs-extra copy
│   ├── components/**/media/* → public/media/components/
│   ├── layouts/**/media/*   → public/media/layouts/
│   ├── styleguides/**/media/* → public/media/styleguides/
│   └── sites/**/media/*     → public/media/sites/  ← site-level SVGs, logos, etc.
│
└── client-env.json ← generated by generateClientEnv()
    └── scans source files for process.env.VAR references → client-env.json
        (required by amphora-html's addEnvVars() at render time)
```

**Key runtime behaviour:** `_view-init.js` loads a component's `client.js` **only when that component's element exists in the DOM**. When `stickyEvents` is configured, a sticky-event shim ensures those events are received even by late subscribers.

## 4. Pipeline Comparison Diagrams

Both pipelines share the same source files and produce the same `public/` output. The differences are in *how* the steps are wired together, *how* the JS module system works at runtime, and *how* scripts are resolved and served per page.

### 4a. Build step execution (what runs and in what order)

The most immediately visible difference: sequential vs parallel execution.

**🕐 Legacy — `clay compile` (Browserify + Gulp, ~90s)**

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 60, 'rankSpacing': 70, 'padding': 20}}}%%
flowchart LR
    SRC(["📁 Source Files"]):::src

    L1["📦 JS Bundle<br/>Browserify + Babel<br/>30–60 s"]:::slow
    L2["🎨 CSS<br/>Gulp + PostCSS 7<br/>15–30 s"]:::slow
    L3["📄 Templates<br/>Gulp + Handlebars<br/>10–20 s"]:::med
    L4["🔤 Fonts + 🖼 Media<br/>Gulp copy · 2–5 s"]:::fast

    OUT(["📂 public/"]):::out

    SRC --> L1 -->|"waits"| L2 -->|"waits"| L3 -->|"waits"| L4 --> OUT

    classDef src   fill:#1e293b,color:#94a3b8,stroke:#334155
    classDef out   fill:#1e293b,color:#94a3b8,stroke:#334155
    classDef slow  fill:#7f1d1d,color:#fca5a5,stroke:#991b1b
    classDef med   fill:#78350f,color:#fcd34d,stroke:#92400e
    classDef fast  fill:#14532d,color:#86efac,stroke:#166534
```

**⚡ New — `clay build` (esbuild + PostCSS 8, ~33s)**

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 60, 'rankSpacing': 70, 'padding': 20}}}%%
flowchart LR
    SRC(["📁 Source Files"]):::src

    N0["🖼 Media<br/>fs-extra · ~0.7 s"]:::fast
    N1["📦 JS + Vue<br/>esbuild · ~3 s"]:::vfast
    N2["🎨 CSS<br/>PostCSS 8 · ~32 s"]:::slow
    N3["📄 Templates<br/>Handlebars · ~16 s"]:::med
    N4["🔤 Fonts + 📚 Vendor<br/>fs-extra · ~1 s"]:::fast

    OUT(["📂 public/"]):::out

    SRC --> N0 -->|"all at once"| N1 & N2 & N3 & N4 --> OUT

    classDef src   fill:#1e293b,color:#94a3b8,stroke:#334155
    classDef out   fill:#1e293b,color:#94a3b8,stroke:#334155
    classDef slow  fill:#7f1d1d,color:#fca5a5,stroke:#991b1b
    classDef med   fill:#78350f,color:#fcd34d,stroke:#92400e
    classDef fast  fill:#14532d,color:#86efac,stroke:#166534
    classDef vfast fill:#052e16,color:#4ade80,stroke:#166534
```

**Color guide:** 🔴 slow (&gt;15s) · 🟡 medium (10–20s) · 🟢 fast (&lt;5s) · 🌿 very fast (&lt;3s)

| | `clay compile` | `clay build` | Δ |
|---|---|---|---|
| **Total time** | ~60–120s | ~33s | **~2–3× faster** |
| **Execution** | Sequential — each step waits for the one before it | Parallel — all steps run simultaneously after media | ⚠️ Different shape; same end result |
| **JS tool** | Browserify + Babel (megabundles) | esbuild (code-split per component) | 🔄 Replaced; esbuild is ~10–20× faster than Browserify |
| **CSS tool** | Gulp + PostCSS 7 | PostCSS 8 programmatic API | 🔄 Replaced; same PostCSS plugin ecosystem, newer API |
| **Module graph** | `_registry.json` + `_ids.json` | `_manifest.json` (human-readable) | ⚠️ Different format; same purpose (maps components → files) |
| **Component loader** | `_client-init.js` — mounts every loaded `.client` module, even if its DOM element is absent | `.clay/_view-init.js` — mounts only components whose DOM element is present | ✅ Better; avoids executing component code when the component isn't on the page |
| **JS output** | Per-component files + individual dep files, page-scoped via registry walk | Per-component files + `chunks/` (shared deps extracted once) | ✅ Better; shared deps are downloaded once even when multiple components use them |

### 4b. JS module system architecture (the core architectural shift)

This is the diagram that explains *why* so many other things had to change. The entire difference in `resolve-media.js`, `_view-init`, `_kiln-edit-init`, and `_globals-init` flows from this single architectural difference.

**🕐 Legacy — `clay compile` (Browserify runtime module registry)**

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 60, 'rankSpacing': 70, 'padding': 20}}}%%
flowchart TB
    OS["Source files<br/>components/**/client.js · model.js · kiln.js<br/>global/js/*.js"]:::src

    OB["Browserify megabundler + Babel<br/>_prelude.js / _postlude.js<br/>custom window.require runtime"]:::tool

    OR["_registry.json  — numeric dep graph<br/>_ids.json  — module ID → filename map"]:::artifact

    OI["_client-init.js<br/>calls window.require(key) for every .client<br/>regardless of DOM presence"]:::loader

    OG["_deps-a.js _deps-b.js …  (alpha-bucketed shared deps)<br/>_models-a.js _kiln-a.js …  (alpha-bucketed edit files)"]:::output

    OS -->|"one big bundle per alpha bucket"| OB
    OB -->|"writes"| OR
    OB -->|"generates"| OI
    OB -->|"outputs"| OG

    classDef src      fill:#1e3a5f,color:#93c5fd,stroke:#1d4ed8
    classDef tool     fill:#3b1f6e,color:#c4b5fd,stroke:#7c3aed
    classDef artifact fill:#422006,color:#fcd34d,stroke:#b45309
    classDef loader   fill:#1c2b4a,color:#93c5fd,stroke:#2563eb
    classDef output   fill:#14532d,color:#86efac,stroke:#166534
```

**⚡ New — `clay build` (esbuild static module graph)**

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 60, 'rankSpacing': 70, 'padding': 20}}}%%
flowchart TB
    NS["Source files<br/>components/**/client.js · model.js · kiln.js<br/>global/js/*.js"]:::src

    NG["Pre-generated entry points<br/>.clay/_view-init.js<br/>.clay/_kiln-edit-init.js<br/>.clay/_globals-init.js"]:::gen

    NE["esbuild — native code splitting<br/>no transpile · no runtime registry<br/>ESM import/export wiring"]:::tool

    NM["_manifest.json<br/>{ 'components/article/client':<br/>  { file: 'client-A1B2.js', imports: ['chunks/shared-C3D4.js'] } }"]:::artifact

    NV["_view-init-[hash].js<br/>mounts client.js via dynamic import()<br/>only when the component's DOM element exists"]:::loader

    NK["_kiln-edit-init-[hash].js<br/>registers all model.js + kiln.js<br/>on window.kiln.componentModels<br/>splitting:false — single self-contained file"]:::output

    NGL["_globals-init-[hash].js<br/>all global/js/*.js in one file<br/>splitting:false — 1 request instead of 70–100"]:::output

    NC["public/js/chunks/<br/>content-hashed shared chunks<br/>cacheable forever"]:::output

    NS -->|"entry points"| NG
    NG -->|"feeds"| NE
    NE -->|"writes"| NM
    NE -->|"outputs"| NV
    NE -->|"outputs"| NK
    NE -->|"outputs"| NGL
    NE -->|"extracts shared deps"| NC

    classDef src      fill:#1e3a5f,color:#93c5fd,stroke:#1d4ed8
    classDef gen      fill:#1f3b2a,color:#6ee7b7,stroke:#059669
    classDef tool     fill:#3b1f6e,color:#c4b5fd,stroke:#7c3aed
    classDef artifact fill:#422006,color:#fcd34d,stroke:#b45309
    classDef loader   fill:#1c2b4a,color:#93c5fd,stroke:#2563eb
    classDef output   fill:#14532d,color:#86efac,stroke:#166534
```

**🔁 Same in both pipelines:** CSS (PostCSS plugins → `public/css/`) · Templates (Handlebars precompile → `public/js/*.template.js`) · Fonts (copy + concat → `public/fonts/`) · Media (copy → `public/media/`)

**What this diagram shows:**

| Concern | `clay compile` | `clay build` | Why it matters |
|---|---|---|---|
| **Module registry** | Runtime: `window.modules` populated as scripts evaluate on every page load | Build-time: `_manifest.json` written once; no runtime registry | Old: any file could call `window.require('components/article/model')` at any time. New: wiring is static — esbuild traces it at build time. |
| **Component mounting** | `_client-init.js` calls `window.require()` for every `.client` module whose script was served — runs regardless of DOM | `_view-init.js` scans the DOM first; only `import()`s a component if its element exists | New: component code never runs for components not on the page |
| **Shared dependency handling** | Alpha-bucketed dep files (`_deps-a.js`…) — all or nothing per bucket, static filenames | Named content-hashed chunks in `public/js/chunks/` — exact code extracted by the static graph | New: unchanged shared chunks stay cached across deploys |
| **Edit mode aggregator** | `window.modules` was the aggregator — clay-kiln called `window.require('components/article/model')` at any time | `_kiln-edit-init.js` pre-registers all model/kiln files on `window.kiln.componentModels` at page load; also shims `window.modules = window.modules \|\| {}` for clay-kiln compatibility | New: explicit pre-wiring replaces implicit runtime lookup; `window.modules` shim ensures any published clay-kiln version works without modification |
| **Global scripts** | Individual `<script>` tags per file, ordered by HTML injection | One `_globals-init.js` file, `splitting:false` — prevents 70–100 tiny chunks from overlapping global deps | New: 1 network request instead of 70–100 |
| **Cache strategy** | Static filenames — entire CDN cache invalidated on every deploy | Content-hashed filenames — only changed files get new URLs | New: browsers cache individual files forever; warm loads re-download zero own JS |

### 4c. Per-page script resolution flow (runtime)

How the server decides which JS files to inject into a page response — the `resolve-media.js` path.

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 60, 'rankSpacing': 70, 'padding': 20}}}%%
flowchart TD
    REQ(["HTTP request for a Clay page"]):::req

    AH["amphora-html<br/>sets locals._components = rendered component names"]:::step
    RM["calls resolveMedia(media, locals)"]:::step
    HM{"_manifest.json exists?<br/>hasManifest()"}:::gate

    REQ --> AH --> RM --> HM

    HM -->|"no — clay compile path 🔴"| RO1
    HM -->|"yes — clay build path 🟢"| RN1

    RO1["getDependencies(scripts, assetPath)"]:::old
    RO2["reads _registry.json<br/>walks numeric dep graph<br/>returns static filenames: 123.js, 456.js …"]:::old
    RO3["injects plain script tags<br/>no content hash · no preload hints<br/>full CDN invalidation on every deploy"]:::old
    RO1 --> RO2 --> RO3

    RN1["clayBuild.resolveModuleScripts<br/>(media, assetPath, { edit })"]:::new
    RN2["reads _manifest.json<br/>looks up each rendered component<br/>follows imports[] → hashed chunk URLs"]:::new
    RN3["populates moduleScripts + modulePreloads<br/>omits ?version= — content hash is the cache buster<br/>injects script type=module + link rel=modulepreload"]:::new
    RN1 --> RN2 --> RN3

    classDef req  fill:#1e3a5f,color:#93c5fd,stroke:#1d4ed8
    classDef step fill:#1e293b,color:#94a3b8,stroke:#334155
    classDef gate fill:#422006,color:#fcd34d,stroke:#b45309
    classDef old  fill:#7f1d1d,color:#fca5a5,stroke:#991b1b
    classDef new  fill:#14532d,color:#86efac,stroke:#166534
```

**What `hasManifest()` gives you:** A single boolean that makes the two pipelines fully hot-swappable at runtime. Deploy with `CLAYCLI_BUILD_ENABLED=true` → `_manifest.json` appears → new path activates. Roll back by removing the flag → `_manifest.json` disappears on the next deploy → old path activates. No code changes in the site.

### JavaScript Bundling

| Aspect | `clay compile` (Browserify) | `clay build` (esbuild) |
|---|---|---|
| **Bundler** | Browserify 17 + babelify | esbuild |
| **Transpilation** | Babel (preset-env) | esbuild native (ES2017 target) |
| **Vue SFCs** | `@nymag/vueify` Browserify transform | Custom esbuild plugin (`plugins/vue2.js`) using same underlying `vue-template-compiler` |
| **Bundle strategy** | Per-component files + alpha-bucket dep bundles (`_deps-a-d.js`) | Per-component files + auto-extracted shared `chunks/` |
| **Output filenames** | Static: `article.client.js` | Content-hashed: `components/article/client-A1B2C3.js` |
| **Module runtime** | `_prelude.js` + `_postlude.js` (custom `window.require`) | Native ESM — no runtime overhead |
| **Module graph** | `_registry.json` (numeric IDs) + `_ids.json` | `_manifest.json` (human-readable keys) |
| **Component loader** | `_client-init.js` mounts every `.client` module in `window.modules` (page-scoped, but not DOM-presence-checked) | `_view-init.js` mounts a component only when its DOM element exists |
| **Tree shaking** | None — CJS modules bundled whole; no ESM analysis | For ESM dependencies (packages that ship an ESM build): unused exports eliminated. CJS dependencies (e.g. classic `lodash`) are still bundled whole in both pipelines. |
| **Source maps** | Not generated | Yes — `*.js.map` alongside every output file |
| **Dead code elimination** | `process.env.NODE_ENV` set at runtime; dead branches survive minification | Set at build time via `define` — `if (dev) { ... }` blocks removed in production builds |
| **Full rebuild time** | ~30–60s | ~3–4s |
| **Watch rebuild** | Full rebuild on any change | Incremental: only changed module + its dependents |

> **Same result:** In both cases, the browser receives compiled, browser-compatible JavaScript. Component `client.js` logic runs when the component is on the page.

> **Key difference:** With Browserify, top-level side-effects in a `client.js` (e.g. `new Vue(...)`) run at page load for every component whose scripts were served, regardless of whether that component's DOM element is present. With esbuild + `_view-init.js`, component code runs only when the element is found in the DOM.

### CSS Compilation

| Aspect | `clay compile` (Gulp + PostCSS 7) | `clay build` (PostCSS 8) |
|---|---|---|
| **API** | Gulp stream pipeline | PostCSS programmatic API |
| **Concurrency** | Sequential per-file | Parallel with `p-limit(50)` |
| **PostCSS plugins** | autoprefixer, postcss-import, postcss-mixins, postcss-simple-vars, postcss-nested | Same plugins |
| **Minification** | cssnano (when `CLAYCLI_COMPILE_MINIFIED` set) | cssnano (same flag) |
| **Error handling** | Stream error halts the entire pipeline | Per-file error logged; remaining files continue compiling |
| **Output format** | `public/css/{component}.{styleguide}.css` | **Identical** |
| **Watch: CSS variation rebuild** | Recompiles changed file only | Recompiles all variations of the same component name (e.g. `article.css` change rebuilds `article_amp.css` too) |

> **Same result:** Output CSS files are byte-for-byte identical between pipelines (same PostCSS plugins, same naming convention).

> **Key difference:** In watch mode, `clay compile` ran the full CSS glob on every change and used `gulp-changed` (ctime comparison) to skip files whose output was already up-to-date — it had no awareness of component variants. `clay build` explicitly derives the component prefix from the changed filename (e.g. `text-list_amp.css` → prefix `text-list`) and rebuilds every matching variant (`text-list.css`, `text-list_amp.css`, etc.) across all styleguides in one pass.

### Template Compilation

| Aspect | `clay compile` (Gulp + clayhandlebars) | `clay build` (Node + clayhandlebars) |
|---|---|---|
| **API** | Gulp stream | Direct `fs.readFile` / `hbs.precompile` |
| **Concurrency** | Sequential per-file | Parallel with `p-limit(20)` — up to 20 templates compile concurrently |
| **`{{{ read }}}` file I/O** | `fs.readFileSync` — blocks main thread per token | `fs.readFile` (async) — all tokens within a template read concurrently via `Promise.all` |
| **Output** | `public/js/{name}.template.js` | **Identical** |
| **Minified output** | `_templates-{a-d}.js` (bucketed) | **Identical** |
| **Error handling** | Stream error calls `process.exit(1)` — crashes the entire build on a single bad template | Per-template error logged; remaining templates continue compiling |
| **Missing `{{{ read }}}` file** | `process.exit(1)` — build crashes immediately | Error logged; template compiles with token unreplaced so the missing asset is visible in browser |
| **Progress tracking** | None | `onProgress(done, total)` callback → live % display |

> **Same result:** The `window.kiln.componentTemplates['name'] = ...` assignment format is identical.

### Fonts

| Aspect | `clay compile` | `clay build` |
|---|---|---|
| **Binary fonts** | Gulp copy to `public/fonts/{sg}/` | fs-extra copy, same dest |
| **Font CSS** | Concatenated to `_linked-fonts.{sg}.css` | **Identical** |
| **Asset host substitution** | `$asset-host` / `$asset-path` variables | **Identical** |

> **Same result:** Font CSS and binary output is identical.

### Module / Script Resolution

| Aspect | `clay compile` | `clay build` |
|---|---|---|
| **How scripts are resolved** | `getDependencies(scripts, assetPath)` reads `_registry.json`, walks numeric dep graph | `getDependenciesNextForComponents(assetPath, globalKeys)` reads `_manifest.json`, walks `imports` array |
| **Edit mode scripts** | All `_deps-*.js` + `_models-*.js` + `_kiln-*.js` + templates | `getEditScripts()` returns the single `_kiln-edit-init` bundle + templates |
| **View mode scripts** | Numeric IDs resolved to file paths — one script per dep | `_view-init` + `_globals-init` + their shared chunks — typically 3–5 files total |
| **Global scripts** | Individual files served per registry entry | All `global/js/*.js` bundled into a single `.clay/_globals-init.js` with `splitting:false` — 1 file instead of 70–100 tiny chunks |

> **Same result:** Both pipelines return a list of `<script>` src paths that amphora-html injects into the page.

> **Key difference:** Both pipelines are page-scoped — only scripts for components on the page are served. The difference is granularity: `clay compile` serves individual dep files per the registry walk (with no deduplication across components); `clay build` extracts shared dependencies into chunks so a shared module is downloaded exactly once even when multiple page components use it. Additionally, `clay build` bundles global scripts and the kiln edit-init aggregator as single non-splitting files, keeping the total request count low even with a large codebase.

## 6. Configuration

Both commands read the same `claycli.config.js` at the root of your Clay instance, but use **separate config keys**:

```js
// claycli.config.js

// ─── Shared by BOTH pipelines ────────────────────────────────────────────────

// PostCSS import paths (used by both clay compile and clay build)
module.exports.postcssImportPaths = ['./styleguides'];

// PostCSS plugin customisation hook (used by both pipelines)
module.exports.stylesConfig = function(config) {
  // config.importPaths, config.autoprefixerOptions, config.plugins, config.minify
};

// ─── clay compile only (Browserify) ─────────────────────────────────────────

module.exports.babelTargets = { browsers: ['last 2 versions'] };
module.exports.babelPresetEnvOptions = {};

// ─── clay build only (esbuild) ───────────────────────────────────────────────

module.exports.esbuildConfig = function(config) {
  // Extend esbuild config — e.g. add aliases, define globals, extra entry points.
  // config is the full esbuild BuildOptions object.
  //
  // Example below is from the NYMag Clay instance (nymag/sites claycli.config.js).
  // Your aliases will differ depending on which server-only packages your
  // universal/ services import.
  config.alias = {
    ...config.alias,
    // Redirect server-only packages to browser stubs
    '@sentry/node': path.resolve('./services/client/error-tracking.js'),
  };
};

// ─── clay build only (esbuild) — sticky event shim ──────────────────────────

// List of custom event names to make "sticky" in the generated _view-init.js.
// A sticky event is one that fires exactly once and may fire before a
// component's client.js has loaded (ESM dynamic import race condition).
// When a handler registers for a sticky event after it has already fired,
// the shim replays it in the next microtask.
//
// Criteria for an event to qualify (all three must be true):
//   1. It fires exactly once (or the first firing is the meaningful one).
//   2. It is consumed by code that loads asynchronously via dynamic import().
//   3. It cannot be replaced with a pull-based pattern (e.g. a promise) without
//      changing all consumers.
//
// Long-term pattern: for any qualifying event, the preferred pattern is to expose
// a promise that consumers await or .then() on instead of listening for the
// event. A resolved promise is always "replayable" without any shim. Once all
// consumers have migrated to the promise pattern, remove the event from this
// array. Remove stickyEvents entirely once the array is empty.
//
// Example (from the NYMag Clay instance — nymag/sites):
//   - 'auth:init' — fired once by our auth client side service after the auth network call resolves;
//     consumed by components that need the current auth state. Future pattern:
//     expose auth.onReady() and have components call auth.onReady().then(handler).
module.exports.stickyEvents = ['auth:init'];
```

### Minimal setup for `clay build` (new tooling only)

For a Clay instance that hasn't used the old compile pipeline, you only need:

```js
// claycli.config.js — minimal setup for clay build
'use strict';
const path = require('path');

// PostCSS customisation (optional — defaults work for most sites)
module.exports.stylesConfig = function(config) {
  config.importPaths = ['./styleguides'];
};

// esbuild customisation (optional — only add what you actually need)
module.exports.esbuildConfig = function(config) {
  // Add aliases for server-only packages that get imported in universal code
  // config.alias['server-only-package'] = path.resolve('./browser-stub.js');
};
```

## 7. Running Both Side-by-Side

Both commands are fully independent. You can run either one without affecting the other.

### `CLAYCLI_BUILD_ENABLED` — the single opt-in toggle

`CLAYCLI_BUILD_ENABLED=true` is the one knob that controls everything:

| Where | Effect |
|---|---|
| `.env` (local) | `make compile`, `make watch`, `make assets` pick the new pipeline |
| `Dockerfile` build arg | Installs claycli from the new-pipeline branch; runs `clay build` at image-build time |
| CI workflow build args (e.g. `featurebranch-deploy.yaml`) | CI builds use the new pipeline |
| `resolveMedia.js` | `hasManifest()` returns `true` → new manifest-based script resolution is used |

When `CLAYCLI_BUILD_ENABLED` is **unset** (or not `"true"`), the old `clay compile` pipeline runs everywhere with zero changes needed.

### `GLOBALS_INIT_ENTRY_KEY` — the single global scripts key

All `global/js/*.js` scripts are now bundled together into a single non-splitting file (`.clay/_globals-init.js`). This prevents esbuild's code splitter from producing 70–100 tiny shared chunks from the overlapping global dependencies — all of which would otherwise load as individual `<script type="module">` tags on every page.

In `resolveMedia.js`, use `clayBuild.resolveModuleScripts()` — the single call that handles view/edit branching, `GLOBAL_KEYS`, and `modulePreloads` internally. `GLOBAL_KEYS` is no longer needed in the site:

```js
// services/resolve-media.js — correct (one call, no GLOBAL_KEYS needed)
const clayBuild = require('claycli/lib/cmd/build');

function resolveMedia(media, locals) {
  const assetPath = locals.site.assetHost || locals.site.assetPath;
  // No-op when no manifest present — Browserify sites are unaffected
  clayBuild.resolveModuleScripts(media, assetPath, { edit: locals.edit });
}
```

> **Old pattern (do not use):** Listing individual `global/js/*` keys produced 76+ chunk requests in view mode because esbuild split the shared code between those entry points into many tiny files.
>
> ```js
> // ❌ Old — creates 76+ chunk dependencies
> // (example from the NYMag Clay instance; your global script names could differ)
> const GLOBAL_KEYS = [
>   'global/js/aaa-module-mounting',
>   'global/js/ads',
>   'global/js/facebook',
>   'global/js/cid',
> ];
> ```


### Using Makefile targets (recommended)

```makefile
# Makefile — targets read CLAYCLI_BUILD_ENABLED automatically
# (example from the NYMag Clay instance; adapt target names to your Makefile):
#
#   make compile  →  clay build  (if CLAYCLI_BUILD_ENABLED=true) or clay compile
#   make watch    →  clay build --watch  (if CLAYCLI_BUILD_ENABLED=true) or clay compile --watch
#   make assets   →  clay build --watch  (if CLAYCLI_BUILD_ENABLED=true) or clay compile --watch
```

### Using npm scripts

```json
{
  "scripts": {
    "build:assets":    "npx clay build",
    "watch:assets":    "npx clay build --watch",
    "build:compile":   "npx clay compile",
    "build:pack-next": "npx clay compile",
    "watch:compile":   "npx clay compile --watch"
  }
}
```

### How to switch between pipelines

The only thing that changes between pipelines is which scripts are served by `resolveMedia.js`. `hasManifest()` handles this automatically — it returns `true` only when `_manifest.json` exists (i.e. `clay build` ran), and falls back to the legacy `getDependencies` path otherwise:

```js
// services/resolve-media.js in your Clay instance

// New pipeline
const clayBuild = require('claycli/lib/cmd/build');

function resolveMedia(media, locals) {
  const assetPath = locals.site.assetHost || locals.site.assetPath;

  // resolveModuleScripts is a no-op when no manifest exists, so calling it
  // on a Browserify site is safe — the Browserify fallback below still fires.
  clayBuild.resolveModuleScripts(media, assetPath, { edit: locals.edit });

  if (!clayBuild.hasManifest()) {
    // Fall back to legacy
    // media.scripts = getDependencies(media.scripts, assetPath);
  }
}
```

## 8. Code References

### CLI entry points

| Command | File |
|---|---|
| `clay build` | [`cli/build.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/cli/build.js) |
| `clay compile` | [`cli/compile/`](https://github.com/clay/claycli/tree/jordan/yolo-update/cli/compile) |
| Command routing | [`cli/index.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/cli/index.js) — `b`, `pn`, `pack-next` all alias to `build` |

### Build pipeline modules

| Module | File | Old equivalent |
|---|---|---|
| Orchestrator (JS + all assets) | [`lib/cmd/build/scripts.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/scripts.js) | `lib/cmd/compile/scripts.js` |
| CSS compilation | [`lib/cmd/build/styles.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/styles.js) | `lib/cmd/compile/styles.js` |
| Template compilation | [`lib/cmd/build/templates.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/templates.js) | `lib/cmd/compile/templates.js` |
| Font processing | [`lib/cmd/build/fonts.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/fonts.js) | `lib/cmd/compile/fonts.js` |
| Media copy | [`lib/cmd/build/media.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/media.js) | `lib/cmd/compile/media.js` |
| Vendor (kiln) copy | [`lib/cmd/build/vendor.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/vendor.js) | Part of `lib/cmd/compile/scripts.js` |
| Manifest writer | [`lib/cmd/build/manifest.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/manifest.js) | _(no equivalent — replaces `_registry.json`/`_ids.json`)_ |
| Script dependency resolver | [`lib/cmd/build/get-script-dependencies.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/get-script-dependencies.js) | `lib/cmd/compile/get-script-dependencies.js` |
| **Build module public API** | [`lib/cmd/build/index.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/index.js) | _(new)_ — exports all helpers including `resolveModuleScripts` |

The build module is also re-exported from the top-level programmatic API:

```js
// Access via top-level import (no deep path needed):
const claycli = require('claycli');
claycli.build.resolveModuleScripts(media, assetPath, { edit });
claycli.build.hasManifest();
claycli.build.getEsbuildConfig(options);

// Or continue using the direct path (still works):
const clayBuild = require('claycli/lib/cmd/build');
```

### Key exported functions from [`lib/cmd/build/index.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/index.js)

| Function | Purpose |
|---|---|
| `resolveModuleScripts(media, assetPath, opts)` | Populates `media.moduleScripts` and `media.modulePreloads` for view or edit mode. No-op when no manifest is present — safe to call on Browserify sites. `opts.edit` toggles edit mode; `opts.preloadEditBundle` opts in to preloading the kiln bundle (off by default). |
| `hasManifest()` | Returns `true` when `_manifest.json` exists — use to branch between pipelines. |
| `getDependenciesNextForComponents(assetPath, globalKeys)` | Returns hashed script URLs for `_view-init` + global entry points. Used internally by `resolveModuleScripts`. |
| `getEditScripts(assetPath)` | Returns hashed script URLs for the `_kiln-edit-init` bundle. Used internally by `resolveModuleScripts`. |
| `getModulePreloadHints(assetPath, globalKeys)` | Returns the same URLs as `getDependenciesNextForComponents` for use as `<link rel="modulepreload">` hints. |
| `getEsbuildConfig(opts)` | Returns the full esbuild `BuildOptions` object (after applying any `esbuildConfig` customizer from `claycli.config.js`). |
| `GLOBALS_INIT_ENTRY_KEY` | The manifest key for the single globals bundle (`.clay/_globals-init`). |

### esbuild plugins

| Plugin | File | Purpose |
|---|---|---|
| Vue 2 SFC | [`lib/cmd/build/plugins/vue2.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/plugins/vue2.js) | Compile `.vue` files (replaces `@nymag/vueify` Browserify transform) |
| Browser compat | [`lib/cmd/build/plugins/browser-compat.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/plugins/browser-compat.js) | Stub server-only Node.js modules (`fs`, `http`, `clay-log`, etc.) |
| Service rewrite | [`lib/cmd/build/plugins/service-rewrite.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/plugins/service-rewrite.js) | Rewrite `services/server/` imports to `services/client/` (replaces Browserify `rewriteServiceRequire` transform) |

### Renderer dependency: `amphora-html`

`clay build` requires `amphora-html ≥ 6.0.1-dev.0`. See [Section 14 — amphora-html Changes](#14-amphora-html-changes) for the full list of changes and the reason each was needed.

### Generated files

| File | Generated by | Purpose |
|---|---|---|
| `public/js/_manifest.json` | `lib/cmd/build/manifest.js` | Human-readable entry→file+chunks map. Replaces `_registry.json` + `_ids.json`. Only `import-statement` kind imports are recorded (not `dynamic-import`) so chunk lists accurately reflect files that need separate `<script>` tags. |
| `.clay/_view-init.js` | `generateViewInitEntry()` in `scripts.js` | Synthetic esbuild entry point. Imports every `client.js` and mounts components on the page. Replaces `_client-init.js`. When `stickyEvents` is non-empty, includes the sticky-event shim; sticky event names are driven by `stickyEvents` in `claycli.config.js`. Shim is omitted entirely when the array is absent or empty. |
| `.clay/_kiln-edit-init.js` | `generateKilnEditEntry()` in `scripts.js` | Synthetic esbuild entry point. Imports every `model.js` and `kiln.js` and registers them on `window.kiln.componentModels` / `window.kiln.componentKilnjs`. Also shims `window.modules = window.modules \|\| {}` so clay-kiln's preloader doesn't crash when `window.modules` is absent (it was populated by Browserify; the esbuild pipeline does not create it). Built with `splitting: false` — produces a single self-contained file. |
| `.clay/_globals-init.js` | `generateGlobalsInitEntry()` in `scripts.js` | Synthetic esbuild entry point. Imports all `global/js/*.js` files (excluding `*.test.js`) into a single bundle. Built with `splitting: false` so the browser loads one file instead of the 70–100 tiny shared chunks esbuild's splitter would otherwise create from overlapping global scripts. |
| `client-env.json` | `generateClientEnv()` in `scripts.js` | JSON array of all `process.env.VAR_NAME` identifiers found in source files. Read by `amphora-html`'s `addEnvVars()` at render time to know which `process.env` values to expose to the client.
> **Why `.clay/` exists — and why the old pipeline didn't need it**
>
> Browserify uses a runtime module registry (`window.modules` / `window.require`). Every `client.js`, `model.js`, and `kiln.js` got wrapped in a factory and registered at runtime under a string key. Clay-kiln could call `window.require('components/article/model')` at any time and the registry handed it back — no pre-wiring needed.
>
> esbuild is a static bundler. It only bundles files that are explicitly connected via `import`/`require` at build time. To give esbuild entry points that pull in every component's model, kiln, and global files, `scripts.js` generates three files into `.clay/` on the fly before each build:
>
> - `.clay/_kiln-edit-init.js` — imports every `model.js` + `kiln.js`; built with `splitting: false`
> - `.clay/_view-init.js` — imports every `client.js`; mounts components on DOM presence
> - `.clay/_globals-init.js` — imports all `global/js/*.js`; built with `splitting: false`
>
> esbuild requires real files on disk so it can resolve relative `import` paths and mirror entry points correctly into `public/js/` with stable manifest keys. `.clay/` is that staging area — build artifacts, not source code, so it belongs in `.gitignore`.

### Sticky events and the `stickyEvents` config key

#### The problem — ESM dynamic-import race condition

`clay build` outputs native ESM. Component `client.js` files are loaded via dynamic `import()` inside `_view-init.js`. Because dynamic imports resolve asynchronously, there is a timing window between when the page starts loading and when a component's event handler is registered.

If a publisher fires a one-shot custom event during that window — after the page has started executing but before a component's `client.js` has loaded — the component's `window.addEventListener` call runs too late and the event is silently missed. The component never initializes correctly.

With the old Browserify pipeline this was not a problem: all component code was bundled synchronously into a single file that executed before any global event fired.

#### The current fix — sticky-event shim

`_view-init.js` installs a shim as the very first thing it runs (before any component import can resolve). The shim wraps `window.addEventListener` so that:

1. If a handler registers for an event type that has **already fired**, the handler is called in the next microtask with the stored `event.detail` — a "replay".
2. If the event has **not yet fired**, nothing extra happens; the handler receives it normally when it fires.

This requires **no changes** to the event publisher or to any `client.js` consumer.

#### Which events are sticky — the `stickyEvents` config key

An event qualifies as sticky if it meets all three criteria:

1. **Fires exactly once** (or the first firing is the meaningful one).
2. **Consumed by async code** — component `client.js` files that load via dynamic `import()` and therefore have a race window.
3. **Cannot be replaced with a pull-based pattern** (e.g. a promise or a synchronously-readable value) without changing all consumers.

The list of sticky event names is configured in `claycli.config.js`. The example below is from the NYMag Clay instance (`nymag/sites`) — replace `auth:init` with your own site's event names:

```js
// claycli.config.js (example from nymag/sites)
module.exports.stickyEvents = ['auth:init'];
```

`generateViewInitEntry()` reads this array and emits the corresponding listener registrations into `_view-init.js`. If `stickyEvents` is absent or empty the shim block is omitted entirely — `window.addEventListener` is left unpatched.

claycli itself has no hardcoded knowledge of any consuming repo's event names. The configuration belongs in `claycli.config.js`.

#### Long-term pattern — promises over events

The sticky-event shim is a compatibility bridge, not a design goal. The preferred long-term pattern for any qualifying event is to expose a **promise** that consumers `await` or `.then()` instead of listening for a custom event:

```js
// Instead of:
window.addEventListener('some:event', handler);

// Consumers call:
someService.onReady().then(handler);
```

A resolved promise is always "replayable" — calling `.then()` on an already-resolved promise runs the callback in the next microtask, with no shim required. Once all consumers of a sticky event have migrated to the promise pattern, remove that event name from `stickyEvents`. Remove the key entirely once the array is empty.

### Watch mode (`clay build --watch`)

The watch implementation in `scripts.js` uses **chokidar** for all file types (JS, CSS, fonts, templates) rather than wrapping the build process. Key behaviours:

- **No initial build** on watch start — files are only rebuilt when they change
- **Ready signal** — "Watching for changes" is logged only after all chokidar watchers have emitted `'ready'`
- **CSS variation rebuild** — changing `article.css` rebuilds all `article_*.css` files across all styleguides
- **usePolling: true** — required for Docker + macOS volume mounts where inotify events are unreliable

```js
// lib/cmd/build/scripts.js — watch mode (simplified)
const chokidarOpts = {
  ignoreInitial: true,
  usePolling:    true,
  interval:      100,
  awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 50 },
};
```

## 9. Performance

### Build time comparison (NYMag Clay instance, ~300 components)

| Step | `clay compile` | `clay build` | Notes |
|---|---|---|---|
| **JS bundling** | ~30–60s | ~3–4s | esbuild is written in Go; 10–20× faster than Browserify + Babel |
| **CSS** | ~15–30s (sequential) | ~31s (parallel, p-limit 50, 2845 files) | Same PostCSS plugins; bottleneck is bind-mount I/O in Docker on macOS |
| **Templates** | ~40s (sequential, blocking `readFileSync`) | ~16s (parallel, p-limit 20, async reads) | ~2.5× faster; no longer the build bottleneck |
| **Fonts/vendor/media** | ~2–5s | ~1s | Direct fs-extra copy vs Gulp stream overhead |
| **Total (full build)** | **~60–120s** | **~33s** | **2–4× faster overall** |
| **Watch JS rebuild** | ~30–60s (full rebuild) | ~0.3–1s (incremental) | **60–200× faster** for a single file change |
| **Watch CSS rebuild** | ~15–30s (full glob + ctime filter) | ~1–3s (changed file + variants only) | ~10–15× faster |
| **Watch startup** | ~5–15s (initial build) | ~0.2s (no initial build) | Watchers start instantly |

### Request count (browser)

> Numbers below are measured from the NYMag Clay instance (~300 components). Your counts will scale with codebase size, but the ratios hold.

A key concern when moving to ESM with code splitting is that the number of `<script>` tags injected into the page could balloon. This was addressed by building the two most request-sensitive bundles as non-splitting files and by excluding `model.js` files from the client-side splitting pass:

| Scenario | `clay compile` | `clay build` |
|---|---|---|
| **View mode** | ~31 script requests (bucketed dep files + init) | **~3 script requests** (`_view-init` + `_globals-init` + 1 shared chunk) |
| **Edit mode module scripts** | ~31 (same as view) | **~4 module scripts** (view mode + `_kiln-edit-init`) |
| **Edit mode total (+ templates)** | ~650 | **~624** (620 template scripts needed by Kiln to populate `window.kiln.componentTemplates`) |

The 620 template scripts in edit mode are identical between pipelines — each `*.template.js` file writes `window.kiln.componentTemplates['name'] = html` and is required by Kiln to render component schemas in the editor. This count is determined by the number of components in the codebase, not by the build tool.

### Measured browser performance (NYMag Clay instance)

> Measured against two QA branches running the same codebase on the same infrastructure,
> differing only in which build pipeline was used.

| Metric | `clay compile` | `clay build` | Delta |
|---|---|---|---|
| **FCP (Lighthouse, simulated throttle)** | 2,971 ms | **1,871 ms** | **−37% ✓** |
| **FCP (DevTools unthrottled, warm)** | 664 ms | **312 ms** | **−53% ✓** |
| **LCP (DevTools unthrottled, warm)** | 1,244 ms | **312 ms** | **−75% ✓** |
| **Scripting time (warm load)** | 5,479 ms | **0 ms** | **−100% ✓** |
| **JS re-downloads (warm load)** | ~40 requests | **0 requests** | **−100% ✓** |
| **Total JS gzip** | 6,944 KB | **4,557 KB** | **−34% ✓** |
| **Total page payload (HTML + JS)** | ~7,473 KB gzip | **~4,694 KB** | **−37% ✓** |
| **Inline JS per page load** | 616 KB (uncacheable) | **0 KB** | **−100% ✓** |
| **HTML size** | 1.3 MB | **741 KB** | **−44% ✓** |
| **Content-hashed JS files** | 0 (0%) | **971 (100%)** | **+100 pp ✓** |

> **Repeat visits:** All own JS files are served with `Cache-Control: immutable`. On warm loads
> the browser re-downloads zero own JS — only the HTML. The old build could not benefit from
> immutable caching because its static filenames forced full cache invalidation on every deploy.
>
> **Pending:** Two server-only code leaks (PostCSS ~666 KB gz, node-fetch ~576 KB gz) are still
> bundled into the browser build. Fixing them reduces total JS gzip by a further ~1.2 MB.

### Memory

- `clay compile`: Browserify holds the full dependency graph + all file contents in memory (~300–600 MB for large codebases)
- `clay build`: esbuild is incremental and releases memory between builds (~50–150 MB typical)

### Disk output

- `clay compile`: flat `public/js/` with static filenames. Deploying any JS change requires invalidating the entire CDN cache for all JS files, since filenames never change.
- `clay build`: structured `public/js/components/…` + `public/js/chunks/` with **content-hashed filenames**. Only files that actually changed get new hashes on deploy — unchanged files (shared chunks, unmodified components) keep their old URLs and remain cached on CDN and in browsers indefinitely. This is the gold standard for long-lived caching.

### npm dependency footprint

The move from Browserify/Gulp to esbuild removes a significant number of packages:

| Removed (clay compile) | Added (clay build) |
|---|---|
| `browserify`, `babelify`, `@babel/preset-env` | `esbuild` |
| `gulp`, `highland`, `through2` | `postcss` (programmatic) |
| `browserify-cache-api` | `p-limit` |
| `browserify-extract-registry`, `browserify-extract-ids` | `cssnano` |
| `browserify-global-pack`, `bundle-collapser` | `@vue/component-compiler-utils` |
| `browserify-transform-tools`, `unreachable-branch-transform` | |
| `uglifyify`, `gulp-changed`, `gulp-replace`, `gulp-babel` | |
| `gulp-group-concat`, `gulp-cssmin`, `gulp-if`, `gulp-rename` | |
| `detective-postcss` | |

**Net result:** ~20 packages removed, ~5 added. Fewer packages means faster `npm install`, smaller `node_modules`, reduced supply-chain attack surface, and fewer version-conflict headaches.

## 10. Learning Curve

### For Developers

| Topic | `clay compile` | `clay build` |
|---|---|---|
| **Debugging a build error** | Gulp stack trace through 5+ plugins, hard to attribute to a source file | Direct esbuild error: exact file, line, column |
| **Debugging a runtime error** | Minified stack trace points to bundle line, not source | Source maps (`*.js.map`) generated automatically — browser DevTools show original source |
| **Understanding the output** | `_registry.json` with numeric IDs, requires `_ids.json` to decode | `_manifest.json` is human-readable JSON — open it and immediately understand which files are loaded for which component |
| **Adding a new package** | May require a Browserify transform or browser-field shim in the consuming repo | Add to `esbuildConfig.alias` in `claycli.config.js`, or it is automatically stubbed by `browser-compat.js` |
| **Vue SFCs** | `@nymag/vueify` Browserify transform | Custom esbuild plugin using same `vue-template-compiler` — identical output |
| **Global variables (DS, Eventify)** | Implicit — leaked into scope via Browserify's global module scope | Already defined in claycli's default config via `esbuild define`; no action needed unless adding new globals |
| **Server-only imports in universal code** | `rewriteServiceRequire` Browserify transform | `service-rewrite.js` esbuild plugin (same concept, same enforcement) |
| **`process.env.NODE_ENV`** | Set in `_client-init.js` at runtime — dead branches survive into the bundle | Set via `esbuild define` at build time — `if (process.env.NODE_ENV !== 'production') {}` blocks are eliminated in minified output |
| **Tree shaking** | None — `require('lodash')` pulled in the whole library | For ESM dependencies only — packages that ship an ESM build can be tree-shaken. CJS packages like `lodash` (not `lodash-es`) are still bundled whole. The main dead-code win is `process.env.NODE_ENV` build-time evaluation, not module-format conversion. |
| **Modern JS syntax** | Babel target must be configured separately | Controlled by `target` in `esbuildConfig` (default: Chrome 80+, Firefox 78+, Safari 14+) — `??`, `?.`, class fields all work out of the box |

**What's the same:**
- `claycli.config.js` is the single configuration entry point
- CSS uses the same PostCSS plugins with the same configuration API (`stylesConfig`)
- Output file locations and naming conventions are identical
- `resolveMedia.js` integration is the same pattern (call a function, get script paths)

**What's different:**
- Component code runs lazily (only when the component's DOM element is present) instead of at page load
- JS entry points are explicit per-component files, not a single megabundle shared across all components
- Standard Clay globals (`DS`, `Eventify`, `Fingerprint2`) are already handled in claycli's defaults; only site-specific globals need configuring

### Real-world time savings — watch mode ROI

> **Scenario:** 9 developers, each making 20 JS file changes/day during active development

```
                      | Old (clay compile) | New (clay build) | Saved
Per-change rebuild    | ~45s avg           | ~0.5s avg        | ~44.5s
Per-dev per day       | ~15 min waiting    | ~10s waiting     | ~14.8 min
Team per day (9 devs) | ~135 min (2.25 hr) | ~1.5 min         | ~133 min
Team per week         | ~11.25 hrs         | ~7.5 min         | ~11+ hrs
Team per year         | ~585 hrs           | ~6.5 hrs         | ~578 hrs

At $30/hr fully-loaded eng cost:
  Weekly savings:  ~$337
  Yearly savings:  ~$17,340
```

The bottleneck on most feature work is not writing code — it's waiting for the build. Watch mode eliminates that wait.

### For Site Reliability Engineers

| Concern | `clay compile` | `clay build` |
|---|---|---|
| **Build reproducibility** | `browserify-cache.json` can go stale, silently serving old module code | esbuild rebuilds from scratch every time; no cache file to corrupt |
| **Docker volume mounts** | `chokidar` inotify events unreliable on macOS volume mounts | `usePolling: true` explicitly configured |
| **CI build time** | 60–120s per build | ~33s per build (~63% reduction in CI compute minutes) |
| **Health check** | No built-in indicator | `hasManifest()` returns `true` once a build has completed |
| **Partial builds** | Not supported — full rebuild only | Watch mode rebuilds only changed assets |
| **Output inspection** | `_registry.json` (opaque numeric IDs, requires `_ids.json` to decode) | `_manifest.json` (human-readable JSON, easily `diff`-ed between deploys) |
| **CDN cache management** | Static filenames → must invalidate entire CDN cache on every JS deploy | Content-hashed filenames → only changed files get new URLs; unchanged files stay cached |
| **Rollback safety** | If build fails, `browserify-cache.json` may be left in a partial state | If build fails, the previous `_manifest.json` is untouched; `hasManifest()` continues to serve the last good build |
| **Source maps in production** | Not generated | `*.js.map` files allow production error stacks to point to source lines |
| **Node.js requirement** | Node ≥ 14 | Node ≥ 20 (esbuild requirement) |
| **Error surface** | Errors can be silently swallowed by Gulp stream error handlers | Errors are explicit — build exits non-zero, CI fails fast |

## 11. For Product Managers

### What changed?

The way the codebase is compiled into browser-ready files was modernised. The underlying technology changed from Browserify (2014) to esbuild (2021). The end result — the website pages — looks and behaves identically to users.

### What improved for the engineering team?

1. **Developer velocity:** A developer changing a JS file in watch mode sees their change in ~0.3–1s instead of ~30–60s. CSS changes: ~1–3s instead of ~15–30s. This compounds across every developer, every day.
2. **Build reliability:** No `browserify-cache.json` that can silently serve stale module code after a bad build. Every build is deterministic and reproducible.
3. **Faster CI:** Full builds take ~33s instead of ~90s — roughly a 63% reduction. For teams paying per CI minute (GitHub Actions, CircleCI), this directly reduces infrastructure cost on every pull request and deployment.
4. **Easier debugging:** Build errors show the exact file, line, and column. Source maps are generated automatically, so production error stack traces point to original source lines — not minified bundle line numbers.
5. **Better error resilience:** A single bad template or CSS file no longer crashes the entire build. Errors are logged and the rest of the build continues.
6. **Simpler dependency tree:** ~20 npm packages removed. Faster `npm install`, less supply-chain risk, fewer peer-dependency conflicts.

### What improved for the product — and why it matters to users?

#### Measured performance improvements (NYMag Clay instance)

The table below compares two QA branches running the same codebase on the same infrastructure,
differing only in their JS build pipeline:

| Metric | `clay compile` | `clay build` | Delta |
|---|---|---|---|
| **FCP** (how fast first content appears) | 2,971 ms | **1,871 ms** | **−37% ✓** |
| **HTML per page** | 1.3 MB | **741 KB** | **−44% ✓** |
| **Total JS payload** | 6,944 KB gzip | **4,557 KB gzip** | **−34% ✓** |
| **Total page payload** | ~7,473 KB gzip | **~4,694 KB** | **−37% ✓** |
| **Inline JS per page** (uncacheable) | 616 KB every visit | **0 KB** | **−100% ✓** |
| **JS on warm visits** | re-downloads ~40 files | **0 files** | **−100% ✓** |
| **FCP on warm visit** | 664 ms | **312 ms** | **−53% ✓** |
| **LCP on warm visit** | 1,244 ms | **312 ms** | **−75% ✓** |
| **Scripting time (warm)** | 5,479 ms | **0 ms** | **−100% ✓** |

> **Repeat visits** are the largest win. The old pipeline inlined 616 KB of JS directly into
> every HTML response — uncacheable, paid on every page load by every visitor. The new pipeline
> eliminates the inline blob and serves all JS files with `Cache-Control: immutable` (content
> hashes guarantee the file never changes without a URL change). Returning visitors re-download
> zero own JS.

#### Smaller JavaScript payloads (code splitting)

Both pipelines are page-scoped and both deduplicate shared dependencies — if `article` and `gallery` both depend on lodash, only one copy is served in either pipeline.

The difference is *where and when* that deduplication happens:

- **`clay compile`**: deduplication is a **runtime registry walk** on every page request — `getComputedDeps()` traverses `_registry.json` using a shared `out` object so each dep ID is included exactly once. The result is a list of individual numeric dep files (`123.js`, `456.js`, …) with static filenames.
- **`clay build`**: deduplication happens **at build time** — esbuild physically extracts the shared code into a named chunk file (`chunks/lodash-A1B2C3.js`). The manifest maps each component entry to its chunk list, so `resolveMedia` can serve the right files without any graph traversal at request time.

**Why the build-time approach is better:**
- Shared chunks have **content-hashed filenames** — they can be cached by CDNs and browsers indefinitely, surviving multiple deploys unchanged
- No per-request graph traversal — script resolution is a simple manifest lookup
- The chunk boundaries are visible and human-readable in `_manifest.json`; the old dep graph required both `_registry.json` and `_ids.json` to decode

**Why this matters:**
- Less JavaScript downloaded on every page load
- Less JavaScript parsed and executed by the browser before the page becomes interactive
- Dead code from dev-only branches (`process.env.NODE_ENV` evaluation) is eliminated at build time — React warnings, Vue dev checks, and similar guards are stripped entirely in production builds. ESM dependencies additionally benefit from export-level tree shaking.
- This directly improves **Time to Interactive (TTI)** and **Interaction to Next Paint (INP)** — two metrics Google measures

#### Core Web Vitals and SEO

Google uses [Core Web Vitals](https://web.dev/vitals/) as a direct ranking signal since 2021. The three metrics are:

| Metric | What it measures | Measured impact |
|---|---|---|
| **LCP** (Largest Contentful Paint) | How fast the main content loads | −75% on warm loads (312 ms vs 1,244 ms) from immutable caching; FCP −37% on cold loads from `modulepreload` hints |
| **INP** (Interaction to Next Paint) | How responsive the page feels to clicks/taps | Less JS to parse means the main thread is unblocked sooner; scripting time −100% on warm loads |
| **CLS** (Cumulative Layout Shift) | Whether elements move around unexpectedly | −9% improvement; the 616 KB inline JS blob that caused synchronous layout work is eliminated |

**What drives the JS size reduction:**
- **Dead code elimination** — `process.env.NODE_ENV` is set to `'production'` at build time, stripping dev-only branches from libraries (React warnings, Vue checks, etc.) before they reach the browser. For dependencies that ship an ESM build, unused exports are also eliminated.
- **Better minification** — esbuild's minifier produces tighter output than the old `uglify-js`
- **Dead code elimination** — `process.env.NODE_ENV = 'production'` is baked in, so library dev-mode branches (React warnings, Vue checks, etc.) are stripped entirely
- **No Browserify runtime** — `_prelude.js` and `_postlude.js` (the custom `window.require` runtime) are no longer served on every page

**Honest caveat:** The magnitude of improvement depends on how much dead code and unused exports your bundles currently carry. The caching improvement (content-hashed filenames) is the most consistent and predictable win regardless of codebase size.

Better Core Web Vitals scores can improve organic search rankings. Pages that load faster and respond faster rank higher in Google Search.


#### CDN cache efficiency (infrastructure cost)

The old pipeline used static filenames (`article.client.js`). Every time any JavaScript changed, the entire cache had to be invalidated — browsers and CDNs re-downloaded every JS file, even those that hadn't changed.

The new pipeline uses **content-hashed filenames** (`components/article/client-A1B2C3.js`). Only files that actually changed get a new URL. Unchanged shared chunks, unmodified components, and vendor scripts keep their old URLs and stay cached for months on CDN and in browsers.

**Why this matters:**
- Lower CDN bandwidth cost — most files are cache hits after the first load
- Faster repeat page loads for returning users — cached files are reused across deploys
- On a high-traffic site, this can meaningfully reduce monthly CDN egress costs

#### Faster editing experience (Kiln)

The editing interface (Kiln) loads and feels faster too — not just the published pages.

In edit mode, the browser loads the Kiln interface bundle (`_kiln-plugins.js`) plus all component scripts for the page. Both are affected by this change:

- **Smaller Kiln bundle:** `_kiln-plugins.js` is now compiled with esbuild instead of vueify + Babel. Vue SFCs are compiled directly without the Babel intermediate step, producing a smaller and faster-loading kiln plugins bundle.
- **Smaller component scripts in edit mode:** The same dead code elimination and minification improvements that reduce view-mode payloads apply equally in edit mode — every component's script is smaller.
- **Cached kiln bundle across deploys:** The Kiln bundle now has a content-hashed filename. If no kiln plugins changed between deploys, editors' browsers reuse the cached version — no re-download, instant load.
- **Faster iteration for kiln plugin developers:** A developer working on a kiln plugin in watch mode sees changes in ~0.3–1s instead of ~30–60s. This compounds across every kiln plugin change during a development session.

**Bottom line:** Editors opening a page in Kiln should notice that the interface initialises faster, especially on repeat visits or after a deploy that didn't touch kiln plugins.

#### Operational confidence

- The build either fully succeeds and writes a new `_manifest.json`, or it fails and leaves the previous manifest untouched. There is no partial-success state.
- `hasManifest()` is a single boolean health check: if it returns `true`, a complete build exists and the site can serve scripts.
- Errors exit the build process with a non-zero code, so CI fails loudly instead of silently deploying a broken build.

### What's the risk?

- The old `clay compile` command still works — it's not removed. Teams can switch gradually.
- The new `clay build` produces functionally equivalent output verified by running both on the same codebase.
- A test suite covers all key functions of the new pipeline.

### Timeline / rollout

- Both pipelines are available simultaneously in claycli 5.1+
- Sites opt in to `clay build` by updating their `resolveMedia.js` and Makefile targets
- `clay compile` is preserved indefinitely for backward compatibility

## 12. Tests

Test files for the new pipeline live alongside each source module:

| Test file | What it covers |
|---|---|
| [`lib/cmd/build/manifest.test.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/manifest.test.js) | `writeManifest` — entry key derivation, chunk/import handling, public URL mapping |
| [`lib/cmd/build/styles.test.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/styles.test.js) | `buildStyles` — CSS compilation, `changedFiles` incremental mode, `onProgress`, `onError` routing |
| [`lib/cmd/build/templates.test.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/templates.test.js) | `buildTemplates` — HBS precompile, `onProgress`, error resilience in watch mode, minified bucket mode |
| [`lib/cmd/build/media.test.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/media.test.js) | `copyMedia` — component + layout media copy, count tracking |
| [`lib/cmd/build/get-script-dependencies.test.js`](https://github.com/clay/claycli/blob/jordan/yolo-update/lib/cmd/build/get-script-dependencies.test.js) | `hasManifest`, `getDependenciesNextForComponents` — chunk dedup, `_view-init` ordering, missing-component handling |

Run all new-pipeline tests:

```bash
npx jest lib/cmd/build/
```

Run the full test suite (all claycli tests):

```bash
npm test
```

## 13. Migration Guide

> **Why do any of these steps exist?**
>
> The old `clay compile` pipeline was built on Browserify, which wraps every module in a factory function and registers it in a runtime `window.modules` / `window.require` registry. Because all modules were registered at runtime under string keys, clay-kiln could call `window.require('components/article/model')` at any time and get the module back — no pre-wiring needed. The pipeline also owned a single `_client-init.js` file that mounted all components, and `getDependencies()` returned a flat list of pre-computed script paths baked into `_registry.json`.
>
> esbuild is a static bundler. It only bundles files that are explicitly connected via `import`/`require` at build time. There is no runtime module registry. This means things Browserify handled implicitly at runtime must now be handled explicitly at build time. Each step below exists because of that fundamental shift.

### Step 1 — Install claycli

```bash
npm install claycli@ version TBD
```

### Step 2 — Update `resolveMedia.js`

**Why this step exists:** The old `getDependencies()` function read from `_registry.json` and `_ids.json` — flat lookup files Browserify produced for every build. esbuild produces neither of those files. Instead it writes `_manifest.json`, a content-hashed entry-to-file map. The new `getDependenciesNextForComponents()` reads that manifest and resolves the correct hashed URLs per component. Without this change, `resolve-media.js` would try to read files that no longer exist and serve no scripts.

**Why you didn't need to change this before:** Browserify always produced `_registry.json` and `_ids.json` as part of every `clay compile` run. The API matched those files exactly. Nothing needed to change because the output format never changed.

```js
// Before (clay compile) — reads _registry.json + _ids.json
const clayCompile = require('claycli/lib/cmd/compile');
// ...
return clayCompile.getDependencies(scripts, assetPath);

// After (clay build) — reads _manifest.json
// resolveModuleScripts handles view/edit branching, GLOBAL_KEYS, and modulePreloads
// internally. No GLOBAL_KEYS constant or individual helper imports needed in your site.
const clayBuild = require('claycli/lib/cmd/build');

// In your resolveMedia function:
clayBuild.resolveModuleScripts(media, assetPath, { edit: locals.edit });
// No-op when _manifest.json is absent — Browserify fallback still fires after this call.

// opts.preloadEditBundle (default false) — set to true to add the kiln bundle
// to <link rel="modulepreload"> hints (off by default; kiln bundle is large and
// only used internally):
clayBuild.resolveModuleScripts(media, assetPath, { edit: true, preloadEditBundle: false });
```

### Step 3 — Update Makefile / npm scripts

**Why this step exists:** The Makefile targets (`compile`, `watch`, `assets`) and npm scripts need to call `clay build` instead of `clay compile`. These are the commands humans and CI run — they need to point at the new pipeline.

**Why you didn't need to change this before:** `clay compile` was the only pipeline. There was nothing to switch between.

```makefile
# Example from the NYMag Clay instance — adapt to your own Makefile targets:
compile:
  docker compose exec app npm run build:assets  # was: clay compile

watch:
  docker compose exec app npx clay build --watch  # was: clay compile --watch
```

```json
{
  "scripts": {
    "build:assets": "npx clay build",
    "watch:assets": "npx clay build --watch"
  }
}
```

### Step 4 — Add `.clay/` to `.gitignore`

**Why this step exists:** Before each build, `clay build` generates three synthetic entry files into a `.clay/` directory at the project root:

- `.clay/_kiln-edit-init.js` — imports every `model.js` and `kiln.js` across all components and registers them in `window.kiln.componentModels` / `window.kiln.componentKilnjs`. Built with `splitting: false` — single self-contained file, no chunk dependencies.
- `.clay/_view-init.js` — imports every `client.js` and mounts components on the page. Replaces `_client-init.js` and the old `components/init.js` that consuming repos used to own.
- `.clay/_globals-init.js` — imports all `global/js/*.js` scripts (excluding `*.test.js`). Built with `splitting: false` so all global scripts are delivered in one file instead of 70–100 tiny chunks.

esbuild requires real files on disk as entry points — it resolves all `import` paths relative to the file's location. These generated files need to live at a known project-relative path so that esbuild's `outbase` can mirror them correctly into `public/js/` and the manifest keys remain stable. `.clay/` is that staging area. The files are build-time artifacts, not source code, so they must be excluded from git.

**Why you didn't need this before:** Browserify never needed explicit aggregator entry files. Its runtime `window.modules` registry was populated incrementally as each bundle was evaluated — no pre-generated file that imports everything was required. Clay-kiln just called `window.require()` and the registry handed it the right module.

```gitignore
# Generated by clay build before each esbuild run — not source code:
.clay/
```

### Step 5 — Remove legacy output from `.gitignore` (optional)

The following files are no longer produced by `clay build`. If your `.gitignore` references them you can remove or comment them out:

```gitignore
# These are no longer generated by clay build:
# public/js/_registry.json
# public/js/_ids.json
# public/js/_modules-*.js
# public/js/_deps-*.js
# public/js/_client-init.js
# browserify-cache.json

# New file to ignore (content-hashed manifest written on every build):
public/js/_manifest.json
```

### Step 6 — Fix `global/js/` Dollar-Slice ordering (NYMag Clay instance — apply if relevant to your setup)

**Why this step exists:** This step is specific to Clay instances that use [Dollar Slice](https://github.com/nymag/dollar-slice) (`DS`) and have multiple `global/js/` files that call `DS.service()` or `DS.controller()` without explicitly requiring `dollar-slice` themselves. If your `global/js/` directory doesn't use this pattern, skip this step.

In the NYMag Clay instance, files like `cid.js` and `ads.js` call `DS.service()` using the bare `window.DS` global, which is set by `registerGlobals()` in `aaa-module-mounting.js`. In the old Browserify pipeline these were separate `<script>` tags loaded in the correct order at runtime. In the esbuild pipeline they are all bundled into `_globals-init.js`, and execution order is driven by `require()` order. If any service file is `require()`'d before `aaa-module-mounting.js` sets `window.DS`, the `DS.service()` call crashes silently and the service is never registered — causing downstream features (e.g. ads) to fail without error messages.

**The current fix (add one `require` line per service file):**

For each `global/js/*.js` file that calls `DS.service()` or `DS.controller()` but does not already `require('dollar-slice')`, add an explicit require at the top. The example below uses `cid.js` from the NYMag Clay instance — substitute your own service file names:

```js
// global/js/cid.js — before (NYMag Clay instance example)
DS.service('$cid', function () { ... });

// global/js/cid.js — after
const DS = require('dollar-slice');
DS.service('$cid', function () { ... });
```

This gives esbuild a visible dependency edge so `dollar-slice` is guaranteed to initialize before the service body runs, regardless of import order in `_globals-init.js`. Also reorder `global/js/client.js` to `require('./aaa-module-mounting')` before any service files that depend on `window.DS`.

**The future fix (full ESM refactor of `global/js/`):**

This is the right long-term direction. Convert `aaa-module-mounting.js` and any service files that use `window.DS` to use `import`/`export`. The example below uses the NYMag Clay instance's `cid.js` and `ads.js` as illustration — the pattern applies to any equivalent files in your `global/js/` directory:

```js
// aaa-module-mounting.js (add at end)
export { DS };

// cid.js (NYMag Clay instance example — substitute your service file)
import DS from './aaa-module-mounting';  // or from 'dollar-slice' directly
DS.service('$cid', function () { ... });

// ads.js (NYMag Clay instance example — substitute your service file)
import DS from './aaa-module-mounting';
DS.service('adService', [...]);
```

Benefits:
- esbuild builds a real static module graph — ordering is guaranteed by the import graph, not by runtime side-effects
- **Per-page tree shaking:** pages without ads will not load `adService`; pages without the CID cookie logic will not load `$cid`
- `window.DS` global dependency eliminated for these files

Component `client.js` files that call `window.DS.controller()` (the NYMag Clay instance has ~120 such files) can be migrated independently in a follow-up; they do not block this refactor since they run after `_globals-init` has already executed and `window.DS` is set.

### Optional: Per-site rollout strategy

If your Clay instance serves multiple sites and you want to validate the new pipeline on one site before flipping all of them, you can use `CLAYCLI_BUILD_SITES` to gate the pipeline per site slug.

**When to use this:** Your instance has many sites (5+) and you want incremental validation — migrate one site, observe it in production for a week, then add the next.

**When not to use this:** Your instance serves one or two sites, or you have a robust feature-branch + staging workflow that gives you enough confidence. The dual-pipeline overhead isn't worth it for a short validation window.

#### How it works

`CLAYCLI_BUILD_SITES` is a comma-separated list of site slugs. When set in `resolve-media.js`, each page request checks `locals.site.slug` against the list. Sites in the list are served esbuild output; all others fall back to Browserify.

```js
// services/resolve-media.js
const CLAYCLI_BUILD_SITES = process.env.CLAYCLI_BUILD_SITES
  ? new Set(process.env.CLAYCLI_BUILD_SITES.split(',').map(s => s.trim()))
  : null; // null = all sites use the new pipeline

function useNewPipeline(site) {
  if (!clayBuild.hasManifest()) return false;
  if (CLAYCLI_BUILD_SITES === null) return true;
  return CLAYCLI_BUILD_SITES.has(site.slug);
}
```

Because both pipelines' output must exist simultaneously, the Dockerfile (or CI build step) needs to run both `clay build` and `clay compile` when `CLAYCLI_BUILD_SITES` is set:

```dockerfile
# Run both pipelines during the per-site rollout window
elif [ "$CLAYCLI_BUILD_ENABLED" = "true" ] && [ -n "$CLAYCLI_BUILD_SITES" ]; then
    npm run build:assets && npm run build:pack-next;
```

#### Trade-offs

| Factor | Per-site rollout | Full flip |
|---|---|---|
| **Risk** | Low — one site at a time, instant per-site rollback via env var | Higher — all sites change at once |
| **Rollback** | Remove slug from `CLAYCLI_BUILD_SITES`, no redeploy needed | Revert `CLAYCLI_BUILD_ENABLED`, redeploy |
| **CI build time** | +25–30% (both pipelines run) | No change (single pipeline) |
| **CDN** | Both output sets uploaded, no conflicts (different filenames) | Single output set |
| **Operational complexity** | Two code paths active in `resolve-media.js` during migration | Single code path |
| **Recommended window** | 4–6 weeks maximum | One-shot flip |

#### Suggested migration schedule

1. Enable for one lower-traffic site (e.g. `grubstreet`). Validate pipeline indicator, component mounting, ads, Kiln, auth, and caching over 1–2 weeks.
2. Add 2–3 mid-traffic sites. Observe for another week.
3. Add remaining high-traffic sites.
4. Remove `CLAYCLI_BUILD_SITES` entirely once all sites pass QA — `clay build` becomes the universal pipeline.
5. Drop `clay compile` from the Dockerfile and remove the Browserify build script.

#### Pipeline indicator (optional but recommended)

Add a small self-detecting log to your `global/js/aaa-module-mounting.js` (or equivalent first-running global script) to confirm which pipeline loaded on any given page:

```js
// Fires on every full-page load — no component changes needed
(function logPipeline() {
  var isEsbuild = typeof window.require === 'undefined';
  console.log(
    isEsbuild
      ? '%c[clay pipeline] esbuild (clay build)'
      : '%c[clay pipeline] Browserify (clay compile)',
    isEsbuild ? 'color:#22c55e;font-weight:bold' : 'color:#f59e0b;font-weight:bold'
  );
}());
```

`window.require` is created by Browserify's runtime (`_prelude.js`) and is never present in the esbuild pipeline. This check works regardless of which bundle the script runs in, and correctly detects the active pipeline on the first script execution.

## 14. amphora-html Changes

`clay build` required two additions to `amphora-html` (version `6.0.1-dev.0`, on the `jordan/yolo-update` branch of `nymag/amphora-html`). Neither change affects sites that do not use `clay build` — both are strictly opt-in.

### What changed and why

#### 1. `<script type="module">` and `<link rel="modulepreload">` support

**The problem:** The esbuild pipeline produces native ESM output. The browser needs `<script type="module" src="...">` tags to load ESM files correctly — a plain `<script src="...">` tag does not work because the browser will not interpret `import`/`export` syntax without the `type="module"` attribute. The old `amphora-html` only knew how to emit `<script>`, `<script defer>`, and `<script async>` tags — no `type="module"` variant existed.

Additionally, for `<link rel="modulepreload">` hints (which tell the browser to fetch ESM scripts early, during HTML parsing, before reaching the `<script>` tags at `</body>`), there was no injection mechanism at all.

**What was added to [`lib/media.js`](https://github.com/clay/amphora-html/blob/jordan/yolo-update/lib/media.js):**

- Two new tag constants: `MODULE_SCRIPT_TAG = 'module'` and `MODULEPRELOAD_TAG = 'modulepreload'`
- `injectTags()` now produces `<script type="module" src="...">` and `<link rel="modulepreload" href="...">` tags
- `injectScriptsAndStyles()` now reads `mediaMap.moduleScripts` and `mediaMap.modulePreloads` (populated by `resolveMedia`) and injects them at the correct positions:
  - `modulePreloads` → injected into `<head>` **before CSS**, so the browser can start fetching ESM scripts at the earliest possible moment during HTML parsing
  - `moduleScripts` → injected at `</body>`, same position as legacy `<script>` tags
- `omitCacheBusterOnModules` flag: when enabled, the `?version=` cache-buster query string is **omitted** from module script URLs. Content-hashed filenames (`client-A1B2C3.js`) already provide cache busting — appending `?version=` on top would cause unnecessary cache misses on re-deploys where the file itself didn't change.

**Opt-in via `configure()`:**

Everything is off by default. Activate via `configureRender({ modulepreload: true })` in your renderer setup:

```js
// amphora/renderers.js (from the NYMag Clay instance — github.com/nymag/sites/blob/jordan/yolo-update/amphora/renderers.js)
const html = require('amphora-html');

html.configureRender({
  editAssetTags: {
    styles: process.env.INLINE_EDIT_STYLES === 'true',
    scripts: process.env.INLINE_EDIT_SCRIPTS === 'true',
  },
  // Enable <link rel="modulepreload"> hints in <head> and strip ?version=
  // from content-hashed ESM module URLs.
  // Safe for all sites — has no effect unless resolveMedia populates
  // media.modulePreloads (i.e. only when clay build output is present).
  modulepreload: true,
});
```

Sites not using `clay build` are completely unaffected — `resolveMedia` never populates `modulePreloads` on the Browserify path, so no `<link rel="modulepreload">` tags are ever emitted regardless of the flag.

**Why `modulepreload` hints matter for performance:**

Without preload hints, the browser discovers the three ESM module scripts (`_view-init`, `_globals-init`, shared chunk) only after finishing parsing the entire HTML document (~741 KB in the NYMag Clay instance) and reaching the `<script type="module">` tags at `</body>`. That is a full HTML-parse delay before any JS can start downloading.

With `<link rel="modulepreload" href="...">` in `<head>`, the browser starts fetching these files in parallel with HTML parsing — eliminating the waterfall entirely. This is a nice to have to improve FCP and Speed Index.

#### 2. `locals._components` exposed to `resolveMedia`

**The problem:** `resolveMedia` previously received the `mediaMap` and `locals` objects, but `locals` did not include the list of component names that were actually rendered on the page. This made it impossible for `resolveMedia` to do per-component manifest lookups — which is how `getDependenciesNextForComponents` works internally.

**What was added:** Before calling `resolveMedia`, `injectScriptsAndStyles` now sets:

```js
locals._components = state._components;
```

This exposes the array of rendered component names to the `resolveMedia` callback without requiring access to the full render state object.

#### 3. `res` and `self` passed to `postRender` hooks

**What changed:** `applyPostRenderHooks` now passes the Express `res` object and the component `ref` string to `plugin.postRender`:

```js
// Before:
plugin.postRender(ref, html, locals)

// After:
plugin.postRender(ref, html, locals, res, self)
```

This is a backwards-compatible addition — existing plugins that ignore the extra arguments are unaffected. It enables postRender plugins to set response headers, inspect the request, or identify which component triggered the render without needing a separate mechanism.

### How to install the modified `amphora-html`

The changes are on the `jordan/yolo-update` branch of `nymag/amphora-html`. Install directly from the branch:

```json
// package.json (github.com/nymag/sites/blob/jordan/yolo-update/package.json) — install from GitHub branch (no npm publish needed)
"amphora-html": "github:clay/amphora-html#jordan/yolo-update"
```

Once the changes are merged and published to npm, update `package.json` to the released version and remove the patch file.

---

## 15. Bundler Comparison: esbuild vs Webpack vs Vite

When this pipeline was designed, three serious candidates were evaluated: **esbuild**, **Webpack 5**, and **Vite**. This section records why esbuild was chosen, what each tool would have required, and the concrete trade-offs in the context of Clay's architecture.

### The Clay architectural constraints that drove the decision

Before comparing tools, it helps to list the properties of this codebase that an ideal bundler must handle well. These are non-negotiable — the build system has to fit the codebase, not the other way around.

| Constraint | Detail |
|---|---|
| **Pure CommonJS source** | Every `components/*/client.js`, `services/**/*.js`, and `global/js/*.js` file is written with `'use strict'; require(...)`. No native ESM `import`/`export` in source. |
| **220+ entry points** | One `client.js` per component/layout, all bundled together in a single esbuild pass with shared chunk extraction. |
| **20+ Node.js module stubs** | `fs`, `path`, `stream`, `util`, `events`, `http`, `https`, `buffer`, `crypto`, and more all need to be intercepted at resolve time and replaced with browser-safe stubs or empty objects. |
| **Clay server package stubs** | `amphora-search`, `elasticsearch`, `amphora-event-bus-redis`, and several others are `require()`d transitively by universal services. They must produce empty objects in browser bundles. |
| **`services/server/*` → `services/client/*` rewrite** | Any import that resolves inside `services/server/` must be silently redirected to its `services/client/` counterpart — or fail the build loudly if no counterpart exists. |
| **Non-splitting globals bundle** | `global/js/*.js` files must be bundled into a single file (`_globals-init.js`). Splitting them produces 70–100 tiny shared chunks that each generate a separate `<script>` tag. |
| **Dollar Slice runtime** | The component system uses `window.DS` (Dollar Slice) for dependency injection — not React, Vue, or any framework with HMR support. |
| **Fast watch rebuilds** | The previous Browserify watch cycle was 30–60 seconds. An acceptable replacement needs sub-second incremental rebuilds for day-to-day development. |
| **`_manifest.json` generation** | The render layer (`resolveMedia`, `amphora-html`) reads a JSON manifest at request time to look up content-hashed script URLs. Whatever bundler is used must produce this manifest. |

---

### esbuild

esbuild is a Go-based bundler that compiles JavaScript and TypeScript 10–100× faster than JavaScript-based tools. It was purpose-built for bundling — no dev server, no plugin ecosystem for application frameworks, no HMR.

#### Pros (in Clay's context)

- **Speed.** The full 220+ entry point build completes in ~33 seconds (down from ~90 seconds with Browserify). Incremental watch rebuilds run in 0.3–1 second. Go's parallel execution model is the reason.
- **CJS interop is transparent.** esbuild handles circular `require()`, dynamic `require()`, and `module.exports` patterns without a plugin. This matters because every file in the Clay codebase is CommonJS — there is no ESM source to optimize for.
- **`onResolve` / `onLoad` plugin API perfectly matches the stub pattern.** All three custom plugins (`browserCompatPlugin`, `serviceRewritePlugin`, `clay-vue2`) intercept imports by matching a filter regex and returning a custom namespace or virtual module. This is exactly what esbuild's plugin API is designed for. The implementation is direct: match a pattern, return a stub — no adapters, no wrappers.
- **Native code splitting with a single pass.** 220+ entry points plus shared chunk extraction in one `esbuild.build()` call. The `metafile` output records exactly which entry produced which output file and which shared chunks it imports — the data structure that drives `_manifest.json` generation.
- **`splitting: false` for specific bundles.** The `_globals-init` and `_kiln-edit-init` bundles are built with splitting disabled so they emit a single output file. esbuild makes this trivially configurable per build call.
- **`define` substitutions are first-class.** `process.env.NODE_ENV`, `__dirname`, `__filename`, and the three implicit globals (`DS`, `Eventify`, `Fingerprint2`) are all inlined at build time with zero plugin overhead. Dead branches like `if (process.env.NODE_ENV !== 'production') {}` are eliminated during minification.
- **Minimal dependency footprint.** The entire JS pipeline requires only `esbuild` plus the three custom plugins. Compared to Browserify's 20+ Gulp/plugin chain or Webpack's 15+ loader/plugin list, this is a significant reduction in install time, attack surface, and maintenance burden.

#### Cons (in Clay's context)

- **No HMR.** esbuild has no dev server and no HMR protocol. This is not a meaningful loss because Dollar Slice components do not have a component-level update protocol that HMR could hook into.
- **`minChunkSize` does not exist.** esbuild has no equivalent to Webpack's `optimization.splitChunks.minSize`. The 218 sub-1 KB shared chunks produced by the default splitting algorithm remain in the output. This is an open upstream issue ([esbuild#1128](https://github.com/evanw/esbuild/issues/1128)) — the workaround (a post-build merge plugin) is complex and not yet worth implementing.
- **Tree shaking is ESM-only.** esbuild can tree-shake ESM imports but not CJS `require()` calls. Since the codebase is entirely CJS, dead-code elimination is limited to `process.env.NODE_ENV` branch folding during minification. This would be true of any bundler given the CJS source.
- **No Rollup-style `manualChunks`.** Fine-grained control over which modules land in which chunks is not available. The chunk graph is determined purely by the shared-dependency algorithm.
- **Vue 3 not supported.** The custom `clay-vue2` plugin uses `@vue/component-compiler-utils` and `vue-template-compiler` — the Vue 2 SFC compilation chain. Vue 3's compiler is incompatible. This is not an esbuild limitation per se, but the custom plugin only exists for Vue 2.

---

### Webpack 5

Webpack 5 is the industry-standard JavaScript bundler with the largest plugin ecosystem, Module Federation support, and years of production hardening. It was the most likely alternative to esbuild at the time this pipeline was designed.

#### Pros (in Clay's context)

- **Mature CJS interop.** Webpack 5's CJS handling is battle-tested across millions of projects and handles edge cases (circular requires, dynamic `require()`, conditional `require()`) reliably.
- **`optimization.splitChunks.minSize`.** Webpack has a native threshold for chunk merging that esbuild lacks. Setting `minSize: 4096` would inline chunks smaller than 4 KB back into their importers — the open issue in esbuild's chunk count problem.
- **Vast plugin ecosystem.** `NormalModuleReplacementPlugin` handles the `services/server/*` rewrite pattern. `ProvidePlugin` handles the `window.DS` implicit global injection. Node.js polyfills via `webpack-node-externals` or `resolve.fallback` cover the 20+ built-in stubs. All of these are solved problems with documented solutions.
- **`resolve.alias` with exact-match support.** The Vue full-build redirect (match `vue` exactly, not `vue-router` or `vue/dist/...`) is a standard `resolve.alias` pattern in Webpack.

#### Cons (in Clay's context)

- **Build speed.** Webpack 5 with 220+ entry points, full dependency graphs, and minification would take several minutes for a production build. A realistic estimate based on comparable codebases is 3–8 minutes — 5–15× slower than the current 33-second esbuild build. Incremental watch rebuilds would be 10–30 seconds, not 0.3–1 second.
- **Configuration complexity.** A Webpack config for this codebase would require: `webpack-merge` for env variants, separate config objects for the non-splitting globals bundle, `MiniCssExtractPlugin` for CSS-in-JS from Vue SFCs, `vue-loader` for SFC compilation, `babel-loader` (optional but common), `thread-loader` for parallelism, a custom plugin to write `_manifest.json` from Webpack's stats object (the stats format is significantly more complex than esbuild's metafile), and a full list of `resolve.fallback` entries for all 20+ Node built-ins. The resulting config would be 300–500 lines.
- **`_manifest.json` generation is non-trivial.** Webpack's stats output (the equivalent of esbuild's metafile) is a deeply nested object with compilation-internal IDs, asset objects, chunk groups, and module reasons. Extracting the `{ entry → hashed output file + chunk imports }` mapping that `resolveMedia` needs would require a custom Webpack stats plugin and careful handling of the chunk group graph — meaningfully more complex than reading esbuild's flat `metafile.outputs` map.
- **20+ dependency additions.** Adding Webpack to claycli means adding `webpack`, `webpack-cli`, `webpack-merge`, `webpack-dev-server` (if HMR is wanted), `babel-loader`, `vue-loader`, `css-loader`, `mini-css-extract-plugin`, `html-webpack-plugin` (not needed here but commonly pulled in), `node-polyfill-webpack-plugin`, and several `@webpack-contrib/*` packages. This is the same 20+ dependency problem the Browserify pipeline already suffered from.
- **No meaningful HMR benefit.** Webpack HMR requires the runtime to support hot-reloading module boundaries. Dollar Slice (`DS.controller(...)`) has no hot-replace protocol. Full-page reloads would still be required.

---

### Vite

Vite is a build tool built by the Vue team. It uses **esbuild for dependency pre-bundling and transpilation** in development, and **Rollup for production builds**. Comparing "Vite vs esbuild" is therefore really comparing "Rollup vs esbuild" for production.

#### What Vite actually is in production

```
Vite dev server     →  esbuild (pre-bundles node_modules, transforms files on request)
Vite build          →  Rollup (bundles, tree-shakes, code-splits, produces output files)
```

This distinction matters: Vite's signature feature (instant HMR via native browser ESM) only applies to the development server. The production build uses Rollup, which is a JavaScript bundler with different performance characteristics and a different plugin API than esbuild.

#### Pros (in Clay's context)

- **HMR and instant dev server** — for projects that can use it. Vite's dev server does not bundle files — it serves native ESM on request, making the dev startup nearly instant and individual file changes reflect in the browser in milliseconds without a rebuild cycle. This is Vite's single greatest advantage.
- **Rollup tree shaking** — Rollup's tree shaking is more aggressive than esbuild's for ESM source code. It performs scope analysis across module boundaries and can eliminate dead exports that esbuild's simpler algorithm misses.
- **Rollup `manualChunks`** — the chunk merging problem (218 sub-1 KB chunks) that esbuild cannot solve could be addressed in Rollup via a `manualChunks` function that reads output sizes and merges small modules into their largest importer.
- **First-class Vue 3 support** — `@vitejs/plugin-vue` handles Vue 3 SFCs natively. This would be the right choice for any future Vue 3 migration.

#### Cons (in Clay's context)

- **HMR requires a compatible component runtime.** Vite's HMR protocol requires the framework to implement the `import.meta.hot` API — React does it via Fast Refresh, Vue 3 does it natively. Dollar Slice (`DS.controller(...)`) has no equivalent. Without Dollar Slice HMR support, every file change still requires a full page reload, and the dev server advantage disappears entirely.
- **Vite dev server + CJS source = expensive pre-bundling.** Vite's dev server works by serving native browser ESM. Every CommonJS file must be pre-bundled by esbuild before the browser can execute it. With 220+ entry points, each with their own `require()` chains, the dep pre-bundling step on first page load would be slow and the incremental pre-bundle invalidation on file change would be unreliable. This is a known Vite limitation for large CJS codebases.
- **Production builds use Rollup, which is slower than esbuild.** Rollup is written in JavaScript (with a Rust/WASM core for the parser in Rollup 4). A 220-entry-point build through Rollup would take 2–5 minutes compared to 33 seconds through esbuild. The watch rebuild gap is even larger.
- **All three esbuild plugins must be rewritten as Rollup plugins.** Rollup's plugin API uses `resolveId` / `load` hooks rather than `onResolve` / `onLoad`. The logic is equivalent but every plugin must be ported: the 20+ Node built-in stubs, the clay server package stubs, the `services/server/*` → `services/client/*` rewrite, and the Vue 2 SFC compiler. This is several weeks of work for equivalent functionality.
- **`_manifest.json` generation requires a full rewrite.** The manifest writer reads esbuild's `metafile.outputs` — a flat map of output filename → `{ entryPoint, imports }`. Rollup's equivalent is `bundle` object passed to the `generateBundle` hook, which has a different shape. The manifest writer and the `get-script-dependencies.js` reader are both tightly coupled to the esbuild metafile format. Porting them means understanding both formats deeply and updating `amphora-html` integration at the same time.
- **`@rollup/plugin-commonjs` CJS interop has edge cases.** This plugin converts CommonJS to ESM at build time so Rollup can process it. It handles most patterns correctly, but known failure modes include circular requires (common in large Clay model files), conditional `require()` (where the required path is computed at runtime), and modules that inspect `module.id` or `__filename` at runtime. esbuild handles all of these transparently.

---

### Summary table

| Factor | esbuild | Webpack 5 | Vite (Rollup) |
|---|---|---|---|
| **Full build time** | ~33s | ~3–8 min | ~2–5 min |
| **Watch rebuild time** | 0.3–1s | 10–30s | 1–5s (build); instant (dev server, if HMR works) |
| **CJS source interop** | Transparent | Mature, battle-tested | Plugin-based (`@rollup/plugin-commonjs`), edge cases |
| **Node built-in stubs** | Custom plugin, 20+ stubs, direct `onResolve`/`onLoad` | `resolve.fallback` / `node-polyfill-webpack-plugin` | `resolve.alias` / `vite-plugin-node-stdlib-browser` |
| **`services/server/*` rewrite** | Custom plugin, 2-case resolution | `NormalModuleReplacementPlugin` | Custom Rollup plugin (`resolveId` hook) |
| **220+ entry point splitting** | Native, one pass | Native, one pass | Native (Rollup), one pass |
| **Non-splitting bundle control** | Per-call `splitting: false` | `optimization.splitChunks` exclusions | `manualChunks` override |
| **`minChunkSize` equivalent** | Not available (upstream open) | `optimization.splitChunks.minSize` | `manualChunks` function |
| **`_manifest.json` generation** | Flat metafile, straightforward | Complex stats object, requires custom plugin | `generateBundle` hook, requires rewrite |
| **Vue 2 SFC support** | Custom plugin (`clay-vue2`) | `vue-loader` | No official support (Vue 3 only) |
| **HMR** | No | Yes (with compatible runtime) | Yes (with compatible runtime) |
| **Dollar Slice HMR** | N/A | No | No |
| **Config lines required** | ~100 (including all plugins) | ~400–500 | ~200–300 |
| **New dependencies added** | 1 (`esbuild`) + 3 plugins (in-repo) | ~15 npm packages | ~10 npm packages |
| **Tree shaking** | ESM-only (limited for CJS source) | ESM-only (limited for CJS source) | Aggressive (ESM-only; same CJS limitation) |
| **Build-time dead-code elimination** | `define` substitutions, first-class | `DefinePlugin`, same capability | `define` (Rollup), same capability |

### Why esbuild

The deciding factors were:

1. **Speed.** A 33-second build vs 3–8 minutes is not a marginal improvement — it changes how the development loop feels. Sub-second watch rebuilds mean a changed file reflects in the browser before you switch windows.

2. **The plugin model fits the problem exactly.** Stubbing 20+ Node built-ins and rewriting `services/server/*` imports are intercept-at-resolve-time operations. esbuild's `onResolve` / `onLoad` API was designed for this pattern. Webpack and Rollup can do it too, but require more scaffolding.

3. **CJS interop requires zero configuration.** Because every source file is CommonJS, the bundler needs to handle CJS well — not just for simple cases, but for circular requires, conditional requires, and `module.exports` patterns. esbuild does all of this transparently. Rollup's CJS plugin has documented failure modes for patterns present in this codebase.

4. **HMR provides no benefit here.** Vite's primary advantage is HMR. Dollar Slice does not implement the `import.meta.hot` protocol, so Vite's dev server would require a full page reload on every change — identical to the current watch mode behavior. Adopting Vite would add Rollup's build complexity without gaining the dev server benefit.

5. **The manifest format is already built.** The `_manifest.json` writer and the `get-script-dependencies.js` reader are both tightly coupled to esbuild's metafile format. Both work correctly today. Switching to Webpack or Rollup would require rewriting both, plus corresponding changes to `amphora-html`, for no functional improvement.

### When to reconsider

This decision is correct for the current state of the codebase. Revisit it if:

- **Source files are converted to ESM.** If `components/**/*.js` are rewritten as native ESM modules, Rollup's tree shaking becomes significantly more powerful and Vite's dev server becomes usable. This is a large migration that would need to happen first.
- **Dollar Slice is replaced with a framework that supports HMR.** If components migrate to Vue 3 or React, Vite's HMR becomes a real productivity gain and the dev server advantage materializes.
- **esbuild's chunk merging limitation becomes the primary bottleneck.** If [esbuild#1128](https://github.com/evanw/esbuild/issues/1128) remains unresolved and the tiny-chunk request count proves to be a meaningful performance regression in production measurements, Rollup's `manualChunks` function is a concrete reason to reconsider. This should be evaluated with real RUM data before acting on it.
