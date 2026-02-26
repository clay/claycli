---
oat_status: complete
oat_ready_for: oat-project-implement
oat_blockers: []
oat_last_updated: 2026-02-25
oat_phase: plan
oat_phase_status: complete
oat_plan_hill_phases: [2, 3, 4]
oat_plan_source: imported
oat_import_reference: references/imported-plan.md
oat_import_source_path: /Users/thomas.stang/.claude/plans/gentle-questing-snowflake.md
oat_import_provider: claude
oat_generated: false
---

# Implementation Plan: claycli-modernization

> Execute this plan using `oat-project-implement` (sequential) or `oat-project-subagent-implement` (parallel), with phase checkpoints and review gates.

**Goal:** Modernize claycli from Node 10-14 / Browserify / Highland.js to Node 20+ / Webpack 5 / async-await, then convert to TypeScript. Enable HMR, fast rebuilds, and modern JS in consuming repos (nymag/sites).

**Architecture:** CLI tool (`clay <command>`) + programmatic API. Yargs CLI → command modules → build pipeline (Gulp 4 + Webpack 5) + CMS data operations (REST → async/await).

**Tech Stack:** Node 22, Jest 29, ESLint 9, Webpack 5, Gulp 4, Babel, PostCSS 8, TypeScript (Phase 4)

**Commit Convention:** `{type}({scope}): {description}` - e.g., `chore(p01-t01): update Node engine to >=20`

**Integration Constraints:** See `references/imported-plan.md` § Integration Constraints for hard/soft contracts with nymag/sites. Critical: `getDependencies()` API, `client-env.json` output, output file naming in `public/js/`, `claycli.config.js` API. Note: `getWebpackConfig()` / `clay pack` is a soft contract — nymag/sites confirmed they never use `build:pack` in production. Integration testing targets `npm run build` (`clay compile`) only.

## Planning Checklist

- [x] Confirmed HiLL checkpoints with user
- [x] Set `oat_plan_hill_phases` in frontmatter

**Integration Test Checkpoints:**

| Checkpoint | After Phases | Gate | What to verify |
|---|---|---|---|
| 1 | P0 + P1 + P2 | `npm link` → `npm run build` in nymag/sites | Browserify→Webpack migration produces identical output |
| 2 | P3 | `npm link` → `npm run build` in nymag/sites | `clay compile` still works after Highland→async/await |
| 3 | P4 | `npm link` → `npm run build` in nymag/sites | TypeScript-compiled output is a drop-in replacement |

**nymag/sites location:** `/Users/thomas.stang/code/vox/nymag/sites`
**Integration test command:** `npm run build` (`clay compile`) — skip `build:pack` (unused)

---

## Phase 0: Characterization Tests

### Task p00-t01: Add characterization tests for compile/scripts.js

**Files:**
- Create: `lib/cmd/compile/scripts.test.js`

**Step 1: Write tests (RED→GREEN)**

Write characterization tests that capture current Browserify-based behavior of `scripts.js` (502 LOC). Focus on:
- Entry discovery (globbing for model.js, client.js, kiln.js across components/layouts)
- Module ID assignment and labeling logic (`getModuleId`, `idGenerator`, `labeler`)
- Service require rewriting (server→client)
- Bucket splitting output (alphabetic grouping into `_models-a-d.js`, etc.)
- Registry and IDs output structure (`_registry.json`, `_ids.json`)
- Environment variable extraction (`process.env.X` → `client-env.json`)
- Cache management (ids, registry, files, env)
- Watch mode triggers

Run: `npx jest lib/cmd/compile/scripts.test.js`
Expected: Tests pass against current Browserify implementation (characterizing existing behavior)

**Step 2: Commit**

```bash
git add lib/cmd/compile/scripts.test.js
git commit -m "test(p00-t01): add characterization tests for compile/scripts.js"
```

---

### Task p00-t02: Add characterization tests for get-script-dependencies.js

**Files:**
- Create: `lib/cmd/compile/get-script-dependencies.test.js`

**Step 1: Write tests (RED→GREEN)**

Write tests for `get-script-dependencies.js` (146 LOC) — this is a hard API contract with nymag/sites. Cover:
- `getDependencies(scripts, assetPath, {edit, minify})` — all argument combinations
- `getAllDeps`, `getAllModels`, `getAllKilnjs`, `getAllTemplates` — bucket file globbing
- `idToPublicPath` and `publicPathToID` — bidirectional mapping
- `computeDep` and `getComputedDeps` — dependency resolution from `_registry.json`
- Edit vs view mode differences
- Legacy `_global.js` handling
- `_prelude/_postlude/_client-init` ordering

Run: `npx jest lib/cmd/compile/get-script-dependencies.test.js`
Expected: Tests pass, documenting the exact API contract

**Step 2: Commit**

```bash
git add lib/cmd/compile/get-script-dependencies.test.js
git commit -m "test(p00-t02): add characterization tests for get-script-dependencies API"
```

---

### Task p00-t03: Add characterization tests for compile/styles.js

**Files:**
- Create: `lib/cmd/compile/styles.test.js`

**Step 1: Write tests (RED→GREEN)**

Write tests for `styles.js` (162 LOC). Cover:
- `hasChanged()` — recursive dependency checking via detective-postcss
- Gulp stream pipeline setup (rename, changed file detection)
- CSS variable inlining (asset-host, asset-path)
- PostCSS plugin chain assembly from compilation-helpers config

Run: `npx jest lib/cmd/compile/styles.test.js`
Expected: Tests pass against current PostCSS 7 behavior

**Step 2: Commit**

```bash
git add lib/cmd/compile/styles.test.js
git commit -m "test(p00-t03): add characterization tests for compile/styles.js"
```

---

### ~~Task p00-t04~~ REMOVED

Removed — `clay pack` / `get-webpack-config.js` was an incomplete experiment that never shipped to production. nymag/sites confirmed they don't use `build:pack`. No characterization tests needed for unused code. The pack command's webpack-chain patterns will be used as reference material for Phase 2, not preserved as a contract.

---

## Phase 1: Foundation (Node, Test Infra, CI)

### Task p01-t01: Update Node engine requirements

**Files:**
- Modify: `package.json`
- Create: `.nvmrc`

**Step 1: Verify current state (RED)**

Run: `node -v && cat package.json | grep -A2 engines`
Expected: Shows current Node version and old/missing engine config

**Step 2: Implement (GREEN)**

- Add `"engines": { "node": ">=20" }` to `package.json`
- Create `.nvmrc` with `22`
- Remove any Node 10/12/14 compatibility workarounds if found

**Step 3: Verify**

Run: `npm test`
Expected: Tests pass on Node 22

**Step 4: Commit**

```bash
git add package.json .nvmrc
git commit -m "chore(p01-t01): require Node >=20, add .nvmrc for Node 22"
```

---

### Task p01-t02: Upgrade Jest 24 to 29

**Files:**
- Modify: `package.json`
- Modify: `setup-jest.js`

**Step 1: Verify current state (RED)**

Run: `npx jest --version`
Expected: Shows Jest 24.x

**Step 2: Implement (GREEN)**

- Update `jest` to `^29.x`
- Update `jest-fetch-mock` to latest
- Update `jest-mock-console` to latest
- Update `mock-fs` to latest
- Remove deprecated `testURL` config option (replaced by `testEnvironmentOptions`)
- Fix breaking changes: Jest 26 changed default env from jsdom to node; Jest 27 changed default timer implementation

**Step 3: Verify**

Run: `npm test`
Expected: All test files pass on Jest 29

**Step 4: Commit**

```bash
git add package.json setup-jest.js package-lock.json
git commit -m "chore(p01-t02): upgrade Jest 24 to 29 with updated test helpers"
```

---

### Task p01-t03: Upgrade ESLint 7 to 9

**Files:**
- Modify: `package.json`
- Delete: `.eslintrc`
- Create: `eslint.config.js`

**Step 1: Verify current state (RED)**

Run: `npx eslint --version`
Expected: Shows ESLint 7.x

**Step 2: Implement (GREEN)**

- Update `eslint` to `^9.x`
- Migrate `.eslintrc` JSON → `eslint.config.js` flat config
- Replace or update `@babel/eslint-parser` (ES2022+ is natively supported; keep if needed for specific syntax)
- Fix any new lint violations

**Step 3: Verify**

Run: `npm run lint && npm test`
Expected: Lint clean, tests pass

**Step 4: Commit**

```bash
git add package.json eslint.config.js package-lock.json
git rm .eslintrc
git commit -m "chore(p01-t03): migrate ESLint 7 to 9 flat config"
```

---

### Task p01-t04: Update CI configuration

**Files:**
- Modify: `.circleci/config.yml`

**Step 0: Obtain approval (REQUIRED)**

Per AGENTS.md: "Do not modify `.circleci/` config without approval." Ask the user for explicit approval before making any changes to `.circleci/config.yml`. If approval is not granted, mark this task as blocked and skip to p01-t05.

**Step 1: Verify current state (RED)**

Run: `cat .circleci/config.yml | head -30`
Expected: Shows Node 10/12/14 matrix

**Step 2: Implement (GREEN)**

- Update `.circleci/config.yml` to test on Node 20 and 22
- Update Coveralls integration if needed

**Step 3: Verify**

Run: `npm test` (local verification; CI verification on push)
Expected: Tests pass locally; CI config is syntactically valid

**Step 4: Commit**

```bash
git add .circleci/config.yml
git commit -m "ci(p01-t04): update CI matrix to Node 20 and 22"
```

---

### Task p01-t05: Update AGENTS.md for Phase 1

**Files:**
- Modify: `AGENTS.md`

**Step 1: Implement**

- Update technology stack section to reflect Node 20+, Jest 29, ESLint 9
- Update CI section for Node 20/22

**Step 2: Verify**

Run: `npm run lint`
Expected: No lint errors

**Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(p01-t05): update AGENTS.md for Node 20+, Jest 29, ESLint 9"
```

---

## Phase 2: Bundling Pipeline Modernization

### Task p02-t01: Upgrade PostCSS 7 to 8

**Files:**
- Modify: `package.json`
- Modify: `lib/cmd/compile/styles.js` (162 LOC)
- Modify: `lib/cmd/pack/get-webpack-config.js` (295 LOC)

**Step 1: Write test (RED)**

Run: `npx jest lib/cmd/compile/styles.test.js`
Expected: Tests pass with current PostCSS 7 (baseline)

**Step 2: Implement (GREEN)**

- Update `postcss` to `^8.x`
- Update PostCSS plugins: `postcss-import`, `postcss-mixins`, `postcss-nested`, `postcss-simple-vars` to PostCSS 8-compatible versions
- Update `autoprefixer` to latest (PostCSS 8-compatible)
- Update `gulp-postcss` to latest (PostCSS 8-compatible)
- Update `postcss-loader` to latest
- Verify CSS compilation output is identical

**Step 3: Verify**

Run: `npm test`
Expected: All tests pass, CSS output unchanged

**Step 4: Commit**

```bash
git add package.json package-lock.json lib/cmd/compile/styles.js lib/cmd/pack/get-webpack-config.js
git commit -m "chore(p02-t01): upgrade PostCSS 7 to 8 with all plugins"
```

---

### Task p02-t02: Replace Browserify with Webpack for script compilation

**Files:**
- Rewrite: `lib/cmd/compile/scripts.js` (502 LOC — full rewrite)
- Verify: `lib/cmd/compile/get-script-dependencies.js` (API must NOT change)
- Review: `lib/cmd/compile/_client-init.js`
- Modify: `lib/cmd/pack/get-webpack-config.js` (may share config logic)
- Verify: `lib/compilation-helpers.js` (bucket logic stays)

**Step 1: Write test (RED)**

Ensure existing `scripts.test.js` captures output format expectations:
- `_registry.json` structure (module ID → dependency IDs array)
- `_ids.json` structure (file path → module ID)
- Bucket file naming (`_models-a-d.js`, `_deps-e-h.js`, etc.)
- `client-env.json` generation
- Individual file outputs (`*.client.js`, `*.model.js`, etc.)

Run: `npx jest lib/cmd/compile/scripts.test.js`
Expected: Tests define expected output format (may fail until implementation catches up)

**Step 2: Implement (GREEN)**

Webpack replacement strategy:
- Use `webpack-chain` (already in project) to build config programmatically
- Entry discovery: reuse existing glob logic, create Webpack entry map
- Babel: already configured in `get-webpack-config.js`, extend targets
- Vue: use `vue-loader` (already configured in pack command)
- Server→Client rewrite: `NormalModuleReplacementPlugin` (already in pack)
- Module IDs: Webpack's `optimization.moduleIds` + custom naming
- Bucket splitting: `optimization.splitChunks` with custom `cacheGroups`
- Registry/IDs: custom Webpack plugin emitting `_registry.json` and `_ids.json`
- Env vars: `DotenvPlugin` + `DefinePlugin`
- Vue CSS: `MiniCssExtractPlugin`
- Incremental builds: Webpack 5 `cache: { type: 'filesystem' }`
- Watch mode: Webpack built-in watch
- HMR: `HotModuleReplacementPlugin`

**Dependencies to remove:** `browserify`, `babelify`, `browserify-cache-api`, `browserify-extract-registry`, `browserify-extract-ids`, `browserify-global-pack`, `browserify-transform-tools`, `bundle-collapser`, `unreachable-branch-transform`, `through2`, `@nymag/vueify`, `uglifyify`

**Dependencies to add:** `mini-css-extract-plugin`, potentially `thread-loader`

**Step 3: Verify backward compatibility (CRITICAL)**

Preserved output format:
- `_prelude.js`, `_postlude.js`, `_client-init.js`
- `_registry.json` with identical structure
- `_ids.json` with identical structure
- Bucket files: `_models-a-d.js` through `_models-u-z.js` (same for `_deps-`, `_kiln-`, `_templates-`)
- `_kiln-plugins.js`, `_kiln-plugins.css`, `_global.js`
- `*.client.js`, `*.model.js`, `*.kiln.js`, `*.template.js`
- `client-env.json`

API preservation:
- `get-script-dependencies.js` `getDependencies()` signature unchanged
- `getWebpackConfig()` returns webpack-chain Config with `.toConfig()` and `.entryPoints`

Run: `npm test`
Expected: All tests pass

**Step 4: Integration test with nymag/sites**

`npm link` claycli into nymag/sites (`/Users/thomas.stang/code/vox/nymag/sites`), verify:
- `npm run build` (`clay compile`) completes successfully
- `public/js/` contains expected bucket files (`_models-a-d.js`, `_deps-e-h.js`, etc.)
- `_registry.json` is valid JSON with correct module ID → dependency ID structure
- `_ids.json` is valid JSON with correct file path → module ID structure
- `client-env.json` is generated with env variable names
- `*.template.js`, `*.client.js` files exist for components
- `_kiln-plugins.js` and `_kiln-plugins.css` are generated
- Rebuild times <5 seconds for file changes

Note: Skip `build:pack` (`clay pack`) — nymag/sites does not use it in production. It has pre-existing Webpack 5 polyfill errors unrelated to claycli.

**Step 5: Commit**

```bash
git add lib/cmd/compile/scripts.js package.json package-lock.json
git commit -m "feat(p02-t02): replace Browserify with Webpack 5 for script compilation"
```

---

### Task p02-t03: Update Webpack ecosystem dependencies

**Files:**
- Modify: `package.json`

**Step 1: Implement (GREEN)**

- Update `css-loader`, `style-loader`, `postcss-loader`, `babel-loader` to latest
- Update `webpack-assets-manifest`, `case-sensitive-paths-webpack-plugin`, `dotenv-webpack`
- Update `vue-loader` to latest Webpack 5-compatible version
- Evaluate `moment-locales-webpack-plugin` (consider dropping if moment replaced in Phase 3)

**Step 2: Verify**

Run: `npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(p02-t03): update Webpack ecosystem deps to latest"
```

---

### Task p02-t04: Update Babel browser targets

**Files:**
- Modify: `package.json` (browserslist)
- Modify: relevant config files

**Step 1: Implement (GREEN)**

- Update default `browserslist` from `['> 3%', 'not and_uc > 0']` to modern targets (Chrome 89+, Safari 14+)
- Ensure `claycli.config.js` override mechanism still works

**Step 2: Verify**

Run: `npm test`
Expected: Tests pass, build output uses modern targets

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore(p02-t04): update default browserslist to modern targets"
```

---

### Task p02-t05: Evaluate and document Gulp retention

**Files:**
- No changes (decision documentation only)

**Step 1: Evaluate**

- Gulp 4 is used for templates, fonts, media, and styles compilation
- These are simple stream pipelines — keep Gulp for now
- Browserify removal is the high-value change; Gulp replacement adds risk without benefit

**Step 2: Document**

Add rationale note in plan deviation log if no changes made.

**Step 3: Commit**

No commit needed unless documentation files change.

---

### Task p02-t06: Update AGENTS.md for Phase 2

**Files:**
- Modify: `AGENTS.md`

**Step 1: Implement**

- Update build tooling section (Browserify removed, Webpack consolidated)
- Document new build performance characteristics

**Step 2: Verify**

Run: `npm run lint`
Expected: No lint errors

**Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(p02-t06): update AGENTS.md for Webpack 5 bundling pipeline"
```

---

### Task p02-t07: Integration test checkpoint 1 — nymag/sites

**HiLL Gate:** Pause for user confirmation before proceeding to Phase 3.

**Step 1: Link claycli into nymag/sites**

```bash
cd /Users/thomas.stang/Code/vox/claycli && npm link
cd /Users/thomas.stang/code/vox/nymag/sites && npm link claycli
```

**Step 2: Run build**

```bash
cd /Users/thomas.stang/code/vox/nymag/sites && npm run build
```

Expected: `clay compile` completes successfully (baseline: 1193 files in ~6s)

**Step 3: Verify output**

Check `public/js/` for:
- Bucket files exist: `_models-a-d.js`, `_deps-e-h.js`, etc.
- `_registry.json` is valid JSON with module ID → dependency ID arrays
- `_ids.json` is valid JSON with file path → module ID mapping
- `client-env.json` generated with env variable names
- `*.template.js`, `*.client.js` files exist for components
- `_kiln-plugins.js` and `_kiln-plugins.css` are generated
- `_prelude.js`, `_postlude.js`, `_client-init.js` present

**Step 4: Unlink**

```bash
cd /Users/thomas.stang/code/vox/nymag/sites && npm unlink claycli
cd /Users/thomas.stang/Code/vox/claycli && npm unlink
```

**Step 5: Record results and get user sign-off**

Document pass/fail in implementation.md. This is the highest-risk checkpoint — the Browserify→Webpack migration must produce identical output. Do not proceed to Phase 3 without user confirmation.

---

### Task p02-t08: (review) Fix services/server rewrite path check

**Files:**
- Modify: `lib/cmd/compile/scripts.js`
- Modify: `lib/cmd/compile/scripts.test.js`

**Step 1: Understand the issue**

Review finding: `rewriteServiceRequire()` resolves the full request path (including the service filename) and checks `endsWith('services/server')`. Real requests are typically `../../services/server/foo`, so `absoluteRequirePath` ends with `services/server/foo` and the condition never matches.
Location: `lib/cmd/compile/scripts.js:88`

**Step 2: Fix the path check**

Change the condition from checking if the full resolved path ends with `services/server` to checking if the resolved path contains a `services/server/` directory segment (or the parent directory of the resolved file is `services/server`). The rewrite in `resource.request` should preserve the filename — only replace `services/server` with `services/client` in the path.

Also update the `clientPath` computation to point at the correct client-side file for the existence check.

**Step 3: Add positive rewrite test**

Add a test case to `scripts.test.js` that verifies `rewriteServiceRequire` correctly rewrites `../../services/server/foo` to `../../services/client/foo`.

**Step 4: Verify**

Run: `npx jest lib/cmd/compile/scripts.test.js --no-coverage`
Expected: All tests pass including the new positive rewrite test

Run the inline verification from the review:
```bash
node -e "
var path = require('path');
var scripts = require('./lib/cmd/compile/scripts');
var resource = { request: '../../services/server/foo', context: path.resolve(process.cwd(), 'components', 'article') };
scripts.rewriteServiceRequire(resource);
if (!resource.request.includes('services/client/')) throw new Error('rewrite failed: ' + resource.request);
console.log('OK:', resource.request);
"
```

**Step 5: Commit**

```bash
git add lib/cmd/compile/scripts.js lib/cmd/compile/scripts.test.js
git commit -m "fix(p02-t08): fix services/server rewrite path check for Webpack"
```

---

### Task p02-t09: (review) Populate dependency graph from Webpack module stats

**Files:**
- Modify: `lib/cmd/compile/scripts.js`

**Step 1: Understand the issue**

Review finding: `processModule()` initializes `deps = {}` and never populates it from Webpack module relationships. This produces `_registry.json` entries with no transitive dependencies and Browserify-compatible module wrappers with no require resolution map.
Location: `lib/cmd/compile/scripts.js:389`

The `deps` object in the global-pack format maps required module names to resolved module IDs: `{"./foo": "components/foo/model"}`. This is used at runtime by the `_prelude.js` require shim to resolve `require()` calls. The `registry` array stores the transitive dependency IDs for each module, used by `get-script-dependencies.js` to compute asset bundles.

**Step 2: Build dependency map from Webpack stats**

Webpack's `stats.toJson({ reasons: true })` includes `mod.reasons` — an array of objects describing why each module was included. Use this data (plus the `modules` array itself) to build the dependency graph:

1. First pass: build a map of `filePath → moduleId` for all processed modules
2. Second pass: for each module, examine its `reasons` to find which other modules depend on it, OR use `mod.modules` / `mod.dependencies` if available
3. Alternatively, request `stats.toJson({ modules: true, reasons: true })` and for each module look at `mod.reasons[].moduleIdentifier` to find parent modules, then invert to get `parent → [child deps]`

Populate `deps` with `{ requiredName: resolvedModuleId }` entries. Populate `ctx.subcache.registry[moduleId]` with the array of dependency module IDs.

**Step 3: Verify locally**

Run: `npx jest lib/cmd/compile/scripts.test.js --no-coverage`
Expected: Existing tests still pass

**Step 4: Commit**

```bash
git add lib/cmd/compile/scripts.js
git commit -m "fix(p02-t09): populate dependency graph from Webpack module stats"
```

---

### Task p02-t10: (review) Add buildScripts contract tests for output artifacts

**Files:**
- Modify: `lib/cmd/compile/scripts.test.js`

**Step 1: Understand the issue**

Review finding: `scripts.test.js` only tests helper functions. It does not cover `buildScripts()` output artifacts, which allowed both C1 (empty deps) and C2 (broken rewrite) to ship while unit tests passed.
Location: `lib/cmd/compile/scripts.test.js`

**Step 2: Create minimal fixture project**

Create a temporary fixture directory structure in a `beforeAll` setup:
- `components/foo/client.js` — requires `./model`
- `components/foo/model.js` — simple module
- `components/foo/kiln.js` — simple module
- `services/server/bar.js` — a server-side service
- `services/client/bar.js` — its client-side counterpart

**Step 3: Add contract tests**

Write tests that call `buildScripts()` with the fixture project and assert:
1. **Registry structure:** `_registry.json` exists, has entries, and dependency arrays are non-empty for modules that have `require()` calls
2. **IDs structure:** `_ids.json` exists with `filePath → moduleId` mapping
3. **Bucket files:** at least one bucket file exists (e.g., `_models-*.js`)
4. **Module format:** output files contain `window.modules["id"] = [function(...)` pattern
5. **Service rewrite:** `services/server/bar` require is rewritten to `services/client/bar` in the output
6. **Env vars:** if a fixture module references `process.env.FOO`, `client-env.json` includes `FOO`

**Step 4: Verify**

Run: `npx jest lib/cmd/compile/scripts.test.js --no-coverage`
Expected: All tests pass, including contract tests that validate C1 and C2 fixes

**Step 5: Commit**

```bash
git add lib/cmd/compile/scripts.test.js
git commit -m "test(p02-t10): add buildScripts contract tests for output artifacts"
```

---

### Task p02-t11: (review) Restore --minify behavior for emitted script artifacts

**Files:**
- Modify: `lib/cmd/compile/scripts.js`
- Modify: `lib/cmd/compile/scripts.test.js`

**Step 1: Understand the issue**

Review finding: `options.minify` currently only toggles Webpack optimization, but claycli writes global-pack artifacts from `stats.modules[].source` / `mod.source`, so emitted `public/js/*.js` output is unchanged between minified and non-minified builds.
Location: `lib/cmd/compile/scripts.js:477`

**Step 2: Implement fix**

Restore user-visible `compile --minify` semantics for the emitted global-pack files. Either:
1. Minify the source string written by `formatModule()` when `options.minify` is true, or
2. Refactor output generation to consume Webpack's optimized/minified output for the modules/chunks claycli actually serves.

The chosen approach must preserve the existing global-pack wrapper format and `_registry.json` / `_ids.json` contracts.

**Step 3: Verify**

Run: `npx jest lib/cmd/compile/scripts.test.js --no-coverage`
Expected: Tests pass

Run: `npm test`
Expected: Lint + tests pass

Run a targeted minify contract check (per review artifact repro) to confirm emitted `public/js/*.js` content differs between `minify: false` and `minify: true`.

**Step 4: Commit**

```bash
git add lib/cmd/compile/scripts.js lib/cmd/compile/scripts.test.js
git commit -m "fix(p02-t11): restore minify behavior for emitted script artifacts"
```

---

### Task p02-t12: (review) Fix buildScripts failure signaling on compile errors

**Files:**
- Modify: `lib/cmd/compile/scripts.js`
- Modify: `lib/cmd/compile/scripts.test.js`

**Step 1: Understand the issue**

Review finding: `buildScripts()` collects Webpack compile errors but still emits per-entry success results, allowing a failed compile to be reported as partially successful.
Location: `lib/cmd/compile/scripts.js:544`

**Step 2: Implement fix**

Tighten failure signaling so JavaScript/module compilation errors do not produce success results for the same failed entry. Acceptable approaches:
- fail fast when `stats.toJson().errors` contains real compile errors, or
- preserve non-fatal behavior only for an explicit allowlist of tolerated asset/resource issues while suppressing success entries for failed JS inputs.

Keep the result contract consistent for callers/reporters and avoid writing misleading success outcomes.

**Step 3: Verify**

Run: `npx jest lib/cmd/compile/scripts.test.js --no-coverage`
Expected: Tests pass, including syntax-error failure-path coverage

Run: `npm test`
Expected: Lint + tests pass

Run a targeted syntax-error repro (per review artifact) to confirm `buildScripts()` returns error results without success entries for the same failed build.

**Step 4: Commit**

```bash
git add lib/cmd/compile/scripts.js lib/cmd/compile/scripts.test.js
git commit -m "fix(p02-t12): fix buildScripts failure signaling on compile errors"
```

---

### Task p02-t13: (review) Use synthetic entry keys in createWebpackConfig

**Files:**
- Modify: `lib/cmd/compile/scripts.js`
- Modify: `lib/cmd/compile/scripts.test.js`

**Step 1: Understand the issue**

Review finding: `createWebpackConfig()` uses absolute file paths as entry names (`entry[file] = file`). Webpack interprets the entry name as a path for `output.filename = '[name].js'`, creating extra emitted bundles at `public/js/Users/.../entry.js.js` that leak build-machine paths into output.
Location: `lib/cmd/compile/scripts.js:238`

**Step 2: Implement fix**

Change the entry key from the absolute path to a sanitized/synthetic key. The simplest approach: use the file's index or a hash as the entry key, since claycli doesn't use Webpack's emitted chunks (it reads `stats.modules` and writes its own global-pack files). Keep the absolute path as the entry value.

**Step 3: Verify**

Run: `npx jest lib/cmd/compile/scripts.test.js --no-coverage`
Expected: Tests pass

Run: `npm test`
Expected: Lint + tests pass

Add a contract test assertion that `public/js` contains no nested directories / no files with absolute-path-like names.

**Step 4: Commit**

```bash
git add lib/cmd/compile/scripts.js lib/cmd/compile/scripts.test.js
git commit -m "fix(p02-t13): use synthetic entry keys to prevent path leakage in output"
```

---

### Task p02-t14: (review) Skip file writes on fatal JS compile errors

**Files:**
- Modify: `lib/cmd/compile/scripts.js`
- Modify: `lib/cmd/compile/scripts.test.js`

**Step 1: Understand the issue**

Review finding: When fatal JS compile errors occur, `buildScripts()` suppresses success entries (p02-t12 fix) but still processes modules and writes `_prelude.js`, `_postlude.js`, `_registry.json`, `_ids.json`, and `client-env.json`, leaving `public/js` in an inconsistent state.
Location: `lib/cmd/compile/scripts.js:591`

**Step 2: Implement fix**

After collecting errors and before any file writes, check if there are fatal (non-asset) errors. If so, skip module processing, file writing, and cache/metadata export. Return errors immediately.

**Step 3: Verify**

Run: `npx jest lib/cmd/compile/scripts.test.js --no-coverage`
Expected: Tests pass

Run: `npm test`
Expected: Lint + tests pass

Add a contract test assertion that verifies `public/js` does not exist (or is empty) after a fatal JS compile error.

**Step 4: Commit**

```bash
git add lib/cmd/compile/scripts.js lib/cmd/compile/scripts.test.js
git commit -m "fix(p02-t14): skip file writes on fatal JS compile errors"
```

---

### Task p02-t15: (review) Add terser as direct dependency

**Files:**
- Modify: `package.json`

**Step 1: Understand the issue**

Review finding: `scripts.js` directly imports `terser`, but `package.json` does not declare it in dependencies. It works via hoisting from `terser-webpack-plugin`, but is not guaranteed.

**Step 2: Implement fix**

Add `terser` to `dependencies` in `package.json` with a version range compatible with the currently installed transitive version. Run `npm install` to update `package-lock.json`.

**Step 3: Verify**

Run: `npm test`
Expected: Lint + tests pass

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix(p02-t15): add terser as direct dependency"
```

---

## Phase 3: Dependency Cleanup & Stream Modernization

### Task p03-t01: Expand tests for Highland-based modules before replacement

**Files:**
- Modify: `lib/rest.test.js`
- Modify: `lib/cmd/import.test.js`
- Modify: `lib/cmd/lint.test.js`

**Step 1: Expand rest.test.js**

Current: 29 tests (shallow). Add coverage for:
- SSL agent handling edge cases
- `recursivelyCheckURI` — recursive URI discovery with various depth/failure scenarios
- Elastic query response parsing edge cases (malformed responses, empty results)
- Error wrapping with URL capture
- Base64 URI encoding edge cases

**Step 2: Expand import.test.js**

Current: 26 tests (shallow). Add coverage for:
- YAML bootstrap splitting with duplicate keys
- `@published` auto-publish logic variations
- Malformed YAML bootstrap error handling
- Dispatch vs Bootstrap format detection edge cases

**Step 3: Expand lint.test.js**

Current: 28 tests. Add coverage for:
- Deep recursion cases (components → children → grandchildren)
- Complex child reference resolution
- Error propagation chains through Highland streams
- Schema validation edge cases (deeply nested group field references)

**Step 4: Verify**

Run: `npm test`
Expected: All new and existing tests pass

**Step 5: Commit**

```bash
git add lib/rest.test.js lib/cmd/import.test.js lib/cmd/lint.test.js
git commit -m "test(p03-t01): expand test coverage for Highland-based modules before replacement"
```

---

### Task p03-t02: Replace Highland.js with async/await in rest.js

**Files:**
- Modify: `lib/rest.js` (270 LOC)
- Modify: `lib/rest.test.js`

**Step 1: Write test (RED)**

Update `rest.test.js` to expect Promises instead of Highland streams. Keep existing assertions for correctness, change return type expectations.

Run: `npx jest lib/rest.test.js`
Expected: Tests fail (return type mismatch)

**Step 2: Implement (GREEN)**

- Replace `h(promise)` wrapping with `async/await`, return Promises directly
- Add adapter function that maintains Highland-compatible interface for gradual consumer migration
- Document adapter for removal after all consumers updated

Run: `npx jest lib/rest.test.js`
Expected: Tests pass

**Step 3: Refactor**

Remove Highland import from `rest.js` once adapter is in place.

**Step 4: Verify**

Run: `npm test`
Expected: All tests pass (consumers use adapter)

**Step 5: Commit**

```bash
git add lib/rest.js lib/rest.test.js
git commit -m "refactor(p03-t02): replace Highland with async/await in rest.js"
```

---

### Task p03-t03: Replace Highland.js in lint, export, import commands

**Files:**
- Modify: `lib/cmd/lint.js` (350 LOC)
- Modify: `lib/cmd/export.js` (315 LOC)
- Modify: `lib/cmd/import.js` (245 LOC)
- Modify: corresponding test files

**Step 1: Write test (RED)**

Update test files to expect async generators / Promises instead of Highland streams.

Run: `npx jest lib/cmd/lint.test.js lib/cmd/export.test.js lib/cmd/import.test.js`
Expected: Tests fail (return type changes)

**Step 2: Implement (GREEN)**

- Replace Highland `flatMap`, `ratelimit`, `merge`, `errors` with `async generators` + `p-limit` for concurrency
- Update imports to use Promise-based `rest.js` directly (remove adapter)

Run: `npx jest lib/cmd/lint.test.js lib/cmd/export.test.js lib/cmd/import.test.js`
Expected: Tests pass

**Step 3: Refactor**

- Remove Highland adapter from `rest.js` if all consumers updated
- Remove `highland` from `package.json`

**Step 4: Verify**

Run: `npm test`
Expected: All tests pass, Highland fully removed

**Step 5: Commit**

```bash
git add lib/cmd/lint.js lib/cmd/export.js lib/cmd/import.js lib/rest.js package.json
git commit -m "refactor(p03-t03): replace Highland with async/await in commands"
```

---

### Task p03-t04: Replace isomorphic-fetch with native fetch

**Files:**
- Modify: `lib/rest.js`
- Modify: `setup-jest.js`
- Modify: `package.json`

**Step 1: Write test (RED)**

Run: `npx jest lib/rest.test.js`
Expected: Tests pass (baseline before change)

**Step 2: Implement (GREEN)**

- Remove `require('isomorphic-fetch')` from `rest.js`
- Remove `isomorphic-fetch` from `package.json`
- Update `jest-fetch-mock` usage in tests (may need v4+ or switch to `msw`)
- Update `setup-jest.js`

**Step 3: Verify**

Run: `npm test`
Expected: All tests pass using native fetch

**Step 4: Commit**

```bash
git add lib/rest.js setup-jest.js package.json package-lock.json
git commit -m "refactor(p03-t04): replace isomorphic-fetch with native Node fetch"
```

---

### Task p03-t05: Replace kew with native Promises

**Files:**
- Modify: files using `kew` (search required)
- Modify: `package.json`

**Step 1: Implement (GREEN)**

- Search for `kew` usage across codebase
- Replace with native `Promise`
- Remove `kew` from `package.json`

**Step 2: Verify**

Run: `npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add package.json {files-where-kew-was-replaced}
git commit -m "refactor(p03-t05): replace kew with native Promises"
```

---

### Task p03-t06: Modernize remaining dependencies

**Files:**
- Modify: `package.json`
- Modify: various source files as needed

**Step 1: Evaluate and implement**

Dependency-by-dependency updates (green-red-green for each):
- `chalk` 4 → `picocolors` (chalk v5 is ESM-only; stay CommonJS)
- `yargs` 16 → latest
- `glob` 7 → 10+ (or `fast-glob`)
- `fs-extra` 9 → latest (or native `fs/promises`)
- `update-notifier` 5 → latest (or lighter alternative)
- `get-stdin` 8 → native `process.stdin`
- `base-64` → native `Buffer.from(str).toString('base64')`
- `resolve` → native `require.resolve`
- `uglify-js` → `terser`
- Evaluate `moment` removal (check if only used via webpack plugin)
- Evaluate `lodash` replacement with native JS where simple

**Step 2: Verify**

Run: `npm test` after each dependency update
Expected: All tests pass

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(p03-t06): modernize remaining dependencies"
```

---

### Task p03-t07: Update AGENTS.md for Phase 3

**Files:**
- Modify: `AGENTS.md`

**Step 1: Implement**

- Update patterns section (async/await, native fetch, etc.)
- Remove Highland.js references

**Step 2: Verify**

Run: `npm run lint`
Expected: No lint errors

**Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(p03-t07): update AGENTS.md for async/await and modern deps"
```

---

### Task p03-t08: Integration test checkpoint 2 — nymag/sites

**HiLL Gate:** Pause for user confirmation before proceeding to Phase 4.

**Step 1: Link and build**

```bash
cd /Users/thomas.stang/Code/vox/claycli && npm link
cd /Users/thomas.stang/code/vox/nymag/sites && npm link claycli
npm run build
```

Expected: `clay compile` completes successfully

**Step 2: Smoke test**

- Build output matches checkpoint 1 results
- No regressions from Highland→async/await or dependency modernization

**Step 3: Unlink**

```bash
cd /Users/thomas.stang/code/vox/nymag/sites && npm unlink claycli
cd /Users/thomas.stang/Code/vox/claycli && npm unlink
```

**Step 4: Record results and get user sign-off**

Document pass/fail in implementation.md. Do not proceed to Phase 4 without user confirmation.

---

### Task p03-t09: (review) Restore bounded concurrency in export/import/lint

**Files:**
- Modify: `lib/cmd/export.js`
- Modify: `lib/cmd/import.js`
- Modify: `lib/cmd/lint.js`
- Modify: `lib/cmd/export.test.js`
- Modify: `lib/cmd/import.test.js`
- Modify: `lib/cmd/lint.test.js`
- Create: `lib/concurrency.js`
- Create: `lib/concurrency.test.js`

**Step 1:** Implement inline CJS-compatible pLimit/mapConcurrent (p-limit v5+ is ESM-only)
**Step 2:** Thread concurrency through export/import/lint functions using mapConcurrent
**Step 3:** Change test concurrency from 1000→1 (mock-order-dependent tests)
**Step 4:** Verify and commit

---

### Task p03-t10: (review) Fix import stream/stdin handling regression

**Files:**
- Modify: `lib/cmd/import.js`
- Modify: `lib/cmd/import.test.js`
- Modify: `cli/import.js`

**Step 1:** Add stream detection in parseDispatchSource before object fallback
**Step 2:** Fix CLI stdin fallback to error when get-stdin returns empty
**Step 3:** Add regression tests (stream rejection, Buffer input, empty string)
**Step 4:** Verify and commit

---

### Task p03-t11: (review) Fix gulp-newer to only suppress ENOENT stat errors

**Files:**
- Modify: `lib/gulp-plugins/gulp-newer/index.js`

**Step 1:** Change `.catch(() => null)` to only suppress ENOENT, re-throw others
**Step 2:** Verify and commit

---

## Phase 4: TypeScript Conversion

### Task p04-t01: Set up TypeScript infrastructure

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`
- Modify: `eslint.config.js`

**Step 1: Implement (GREEN)**

- Add `typescript` and `@types/node` as devDependencies
- Create `tsconfig.json` with strict settings
- Configure Jest for TypeScript (`ts-jest` or `@swc/jest`)
- Update ESLint for TypeScript (`@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`)
- Allow `.ts` files alongside `.js` files during incremental migration

**Step 2: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: Tests pass, TypeScript compiles (even with no .ts files yet)

**Step 3: Commit**

```bash
git add package.json tsconfig.json eslint.config.js package-lock.json
git commit -m "chore(p04-t01): set up TypeScript infrastructure"
```

---

### Task p04-t02: Convert leaf modules to TypeScript

**Files:**
- Rename: `lib/types.js` (11 LOC) → `lib/types.ts`
- Rename: `lib/deep-reduce.js` (51 LOC) → `lib/deep-reduce.ts`
- Rename: `lib/config-file-helpers.js` (31 LOC) → `lib/config-file-helpers.ts`
- Rename: `lib/composer.js` (141 LOC) → `lib/composer.ts`

**Step 1: Implement (GREEN)**

Convert each leaf module (no internal dependencies) to TypeScript with proper type annotations.

**Step 2: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: All tests pass, no type errors

**Step 3: Commit**

```bash
git add lib/types.ts lib/deep-reduce.ts lib/config-file-helpers.ts lib/composer.ts
git commit -m "refactor(p04-t02): convert leaf modules to TypeScript"
```

---

### Task p04-t03: Convert utility modules to TypeScript

**Files:**
- Rename: `lib/prefixes.js` (131 LOC) → `lib/prefixes.ts`
- Rename: `lib/compilation-helpers.js` (198 LOC) → `lib/compilation-helpers.ts`
- Rename: `lib/formatting.js` (365 LOC) → `lib/formatting.ts`
- Rename: `lib/reporters/*.js` → `lib/reporters/*.ts`

**Step 1: Implement (GREEN)**

Convert utility modules with proper type annotations for exported APIs.

**Step 2: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: All tests pass, no type errors

**Step 3: Commit**

```bash
git add lib/prefixes.ts lib/compilation-helpers.ts lib/formatting.ts lib/reporters/
git commit -m "refactor(p04-t03): convert utility modules to TypeScript"
```

---

### Task p04-t04: Convert core modules to TypeScript

**Files:**
- Rename: `lib/rest.js` (270 LOC) → `lib/rest.ts`
- Rename: `lib/cmd/config.js` → `lib/cmd/config.ts`
- Rename: `lib/cmd/lint.js` (350 LOC) → `lib/cmd/lint.ts`
- Rename: `lib/cmd/export.js` (315 LOC) → `lib/cmd/export.ts`
- Rename: `lib/cmd/import.js` (245 LOC) → `lib/cmd/import.ts`

**Step 1: Implement (GREEN)**

Convert core modules, define API response types in `rest.ts`.

**Step 2: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: All tests pass, no type errors

**Step 3: Commit**

```bash
git add lib/rest.ts lib/cmd/config.ts lib/cmd/lint.ts lib/cmd/export.ts lib/cmd/import.ts
git commit -m "refactor(p04-t04): convert core modules to TypeScript"
```

---

### Task p04-t05: Convert compile/pack modules to TypeScript

**Files:**
- Rename: `lib/cmd/compile/*.js` → `lib/cmd/compile/*.ts`
- Rename: `lib/cmd/pack/*.js` → `lib/cmd/pack/*.ts`

**Step 1: Implement (GREEN)**

Convert all compile and pack modules to TypeScript.

**Step 2: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: All tests pass, no type errors

**Step 3: Commit**

```bash
git add lib/cmd/compile/ lib/cmd/pack/
git commit -m "refactor(p04-t05): convert compile and pack modules to TypeScript"
```

---

### Task p04-t06: Convert CLI entry points to TypeScript

**Files:**
- Rename: `cli/*.js` → `cli/*.ts`
- Rename: `index.js` → `index.ts`

**Step 1: Implement (GREEN)**

- Convert CLI entry points and main index
- Add proper type exports for programmatic API

**Step 2: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: All tests pass, no type errors

**Step 3: Commit**

```bash
git add cli/ index.ts
git commit -m "refactor(p04-t06): convert CLI entry points to TypeScript"
```

---

### Task p04-t07: Update build and publish configuration

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`

**Step 1: Implement (GREEN)**

- Configure TypeScript to compile to JS for npm publishing
- Ensure `bin` entry still works
- Update `package.json` with `types` field
- Verify published package works as drop-in replacement

**Step 2: Verify**

Run: `npm test && npx tsc --noEmit && npm pack --dry-run`
Expected: Tests pass, types check, package includes compiled JS + type declarations

**Step 3: Commit**

```bash
git add package.json tsconfig.json
git commit -m "chore(p04-t07): configure TypeScript build for npm publishing"
```

---

### Task p04-t08: Update AGENTS.md for Phase 4

**Files:**
- Modify: `AGENTS.md`

**Step 1: Implement**

- Document TypeScript + CommonJS conventions (TS source compiled to CommonJS output via `tsc`)
- Preserve the CommonJS module contract (`require`/`module.exports` at runtime) — this is a repo non-negotiable
- Update all tool versions and patterns (TypeScript, ts-jest/swc, @typescript-eslint)

**Step 2: Verify**

Run: `npm run lint`
Expected: No lint errors

**Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(p04-t08): update AGENTS.md for TypeScript codebase"
```

---

### Task p04-t09: Integration test checkpoint 3 — nymag/sites

**Final integration gate.** Verify TypeScript-compiled output is a drop-in replacement.

**Step 1: Link and build**

```bash
cd /Users/thomas.stang/Code/vox/claycli && npm link
cd /Users/thomas.stang/code/vox/nymag/sites && npm link claycli
npm run build
```

Expected: `clay compile` completes successfully

**Step 2: Verify**

- Build output matches checkpoint 1 and 2 results
- No regressions from TypeScript conversion
- `tsc --noEmit` clean in claycli
- Published package structure correct (`npm pack --dry-run`)

**Step 3: Unlink**

```bash
cd /Users/thomas.stang/code/vox/nymag/sites && npm unlink claycli
cd /Users/thomas.stang/Code/vox/claycli && npm unlink
```

**Step 4: Record results**

Document pass/fail in implementation.md. All 3 checkpoints must pass before final PR.

---

### Task p04-t10: (review) Convert cli/compile/*.js to TypeScript

**Files:**
- Modify: `cli/compile/index.js` → `cli/compile/index.ts`
- Modify: `cli/compile/scripts.js` → `cli/compile/scripts.ts`
- Modify: `cli/compile/styles.js` → `cli/compile/styles.ts`
- Modify: `cli/compile/templates.js` → `cli/compile/templates.ts`
- Modify: `cli/compile/fonts.js` → `cli/compile/fonts.ts`
- Modify: `cli/compile/media.js` → `cli/compile/media.ts`
- Modify: `cli/compile/custom-tasks.js` → `cli/compile/custom-tasks.ts`

**Step 1: Understand the issue**

Review finding: 7 JS files in cli/compile/ not converted to TS. AGENTS.md claims all source is .ts.

**Step 2: Implement fix**

For each file: rename .js → .ts, remove `'use strict'`, add `: any` type annotations to function params and callbacks, convert `module.exports = {...}` to `export = {...}`.

**Step 3: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: All tests pass, types clean

**Step 4: Commit**

```bash
git add cli/compile/
git commit -m "refactor(p04-t10): convert cli/compile files to TypeScript"
```

---

### Task p04-t11: (review) Replace deprecated new Buffer() with Buffer.from()

**Files:**
- Modify: `lib/cmd/compile/templates.ts`
- Modify: `lib/cmd/compile/fonts.ts`

**Step 1: Understand the issue**

Review finding: 5 occurrences of `new Buffer(str)` remain, deprecated since Node 6.

**Step 2: Implement fix**

Replace all `new Buffer(...)` with `Buffer.from(...)` in templates.ts (4 occurrences) and fonts.ts (1 occurrence).

**Step 3: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: All tests pass, no deprecation warnings

**Step 4: Commit**

```bash
git add lib/cmd/compile/templates.ts lib/cmd/compile/fonts.ts
git commit -m "fix(p04-t11): replace deprecated new Buffer() with Buffer.from()"
```

---

### Task p04-t12: (review) Remove unused production dependencies

**Files:**
- Modify: `package.json`

**Step 1: Understand the issue**

Review finding: `dependency-tree`, `exports-loader`, `imports-loader` not imported anywhere.

**Step 2: Implement fix**

Remove all three from `dependencies` in package.json. Run `npm install` to update lockfile.

**Step 3: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: All tests pass, no missing module errors

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(p04-t12): remove unused production dependencies"
```

---

### Task p04-t13: (review) Add proper types to getDependencies() API contract

**Files:**
- Modify: `lib/cmd/compile/get-script-dependencies.ts`

**Step 1: Understand the issue**

Review finding: The hard API contract with nymag/sites uses `any` for all params, providing no type safety to consumers.

**Step 2: Implement fix**

Add a `GetDependenciesOptions` interface and type the public API:
```typescript
interface GetDependenciesOptions {
  edit?: boolean;
  minify?: boolean;
}
function getDependencies(scripts: string[], assetPath: string, options?: GetDependenciesOptions): string[];
```
Type internal helpers where straightforward. Keep `any` only where Highland/lodash types are truly unknown.

**Step 3: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: All tests pass, types clean, no regressions

**Step 4: Commit**

```bash
git add lib/cmd/compile/get-script-dependencies.ts
git commit -m "refactor(p04-t13): add proper types to getDependencies API contract"
```

---

### Task p04-t14: (review) Replace deprecated nodeUrl.parse() with new URL()

**Files:**
- Modify: `lib/rest.ts`
- Modify: `lib/prefixes.ts`

**Step 1: Understand the issue**

Review finding: 4 occurrences of deprecated `url.parse()` in rest.ts (2) and prefixes.ts (2).

**Step 2: Implement fix**

Replace `nodeUrl.parse(url)` with `new URL(url)` and update property access. Handle edge cases where input may not be a full URL (prefixes.ts may receive relative paths).

**Step 3: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: All tests pass, no regressions in URL handling

**Step 4: Commit**

```bash
git add lib/rest.ts lib/prefixes.ts
git commit -m "fix(p04-t14): replace deprecated nodeUrl.parse with new URL()"
```

---

### Task p04-t15: (review) Fix RequestInit type assertion in rest.ts

**Files:**
- Modify: `lib/rest.ts`

**Step 1: Understand the issue**

Review finding: `as RequestInit` silences type error for non-standard `agent` property.

**Step 2: Implement fix**

Create a proper type that extends RequestInit with the `agent` property (Node's undici fetch supports it):
```typescript
interface FetchOptions extends RequestInit {
  agent?: any;
}
```
Remove the `as RequestInit` assertion.

**Step 3: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: Types clean, tests pass

**Step 4: Commit**

```bash
git add lib/rest.ts
git commit -m "fix(p04-t15): replace RequestInit type assertion with proper FetchOptions type"
```

---

### Task p04-t16: (review) Clean up tsconfig.build.json include/exclude

**Files:**
- Modify: `tsconfig.build.json`

**Step 1: Understand the issue**

Review finding: `setup-jest.js` is in both `include` (inherited) and `exclude` (confusing).

**Step 2: Implement fix**

Remove `setup-jest.js` from the `include` array in tsconfig.build.json so it only appears in the base tsconfig.json (for type-checking scope).

**Step 3: Verify**

Run: `npm run build && npm test`
Expected: Build succeeds, tests pass

**Step 4: Commit**

```bash
git add tsconfig.build.json
git commit -m "chore(p04-t16): clean up tsconfig.build.json include/exclude"
```

---

### Task p04-t17: (review) Verify and remove path-browserify if unused

**Files:**
- Modify: `package.json` (if unused)

**Step 1: Understand the issue**

Review finding: `path-browserify` is in production deps but may only have been needed for Browserify. Webpack 5 uses `resolve.fallback` with `path: false`.

**Step 2: Implement fix**

Search for `path-browserify` usage in source. If not imported/required anywhere, remove from dependencies and run `npm install`. If used in a Webpack config, keep it.

**Step 3: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: All tests pass, no missing module errors

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(p04-t17): remove unused path-browserify dependency"
```

---

### Task p04-t18: (review) Fix WHATWG URL migration for schemeless CLI inputs

**Files:**
- Modify: `lib/prefixes.ts`
- Modify: `lib/prefixes.test.js`

**Step 1: Understand the issue**

Review finding: p04-t14 replaced `url.parse()` with `new URL()` in `urlToUri()` and `getExt()` without handling non-absolute inputs. `new URL('domain.com/_pages/foo.html')` throws `Invalid URL`, breaking documented CLI usage like `clay lint domain.com/_pages/foo`. The original `url.parse()` returned a usable pathname for schemeless inputs.

Locations: `lib/prefixes.ts:80` (`urlToUri`), `lib/prefixes.ts:99` (`getExt`)

**Step 2: Implement fix**

Use a fallback base for schemeless URLs, e.g.:
```typescript
function safeParseUrl(url: string) {
  try {
    return new URL(url);
  } catch (_e) {
    return new URL(url, 'http://placeholder');
  }
}
```

Apply to both `urlToUri()` and `getExt()` where `new URL()` is called.

**Step 3: Add regression tests**

Add tests to `lib/prefixes.test.js` for schemeless inputs:
- `urlToUri('domain.com/_components/foo/instances/bar')` → `/_components/foo/instances/bar`
- `getExt('domain.com/_pages/foo.html')` → `.html`
- `getExt('domain.com/_components/foo')` → `''` (no extension)

**Step 4: Verify**

Run: `npx jest lib/prefixes.test.js lib/cmd/lint.test.js --no-coverage`
Expected: All tests pass

Run: `npm test && npx tsc --noEmit`
Expected: Full suite passes, types clean

**Step 5: Commit**

```bash
git add lib/prefixes.ts lib/prefixes.test.js
git commit -m "fix(p04-t18): handle schemeless URLs in prefixes urlToUri/getExt"
```

---

### Task p04-t19: (review) Re-apply bounded concurrency in TypeScript command modules

**Files:**
- Modify: `lib/cmd/export.ts`
- Modify: `lib/cmd/import.ts`
- Modify: `lib/cmd/lint.ts`
- Modify: `cli/lint.ts`

**Step 1: Understand the issue**

Review finding: The p03-t09 fix restored bounded concurrency via `mapConcurrent` in the `.js` command files, but the p04 TypeScript conversion (p04-t04) was based on the pre-fix `.js` versions and reintroduced sequential `for...await` loops. `lib/concurrency.js` exists and is tested but is not imported by the `.ts` files. Additionally, `cli/lint.ts` advertises `--concurrency` but doesn't pass it to the lint function.

Locations: `lib/cmd/export.ts:55`, `lib/cmd/import.ts:73`, `lib/cmd/lint.ts:66`, `cli/lint.ts:14`

**Step 2: Implement fix**

Re-apply the same `mapConcurrent` pattern from the `.js` versions:

1. Import `mapConcurrent` from `../concurrency` (or `../../concurrency` for CLI) in each `.ts` file
2. Replace sequential `for...await` loops with `mapConcurrent(items, concurrency, fn)` calls
3. Thread `concurrency` parameter through `ExportOptions`, `ImportOptions` interfaces and function signatures where missing
4. Fix `cli/lint.ts` to pass `concurrency` from argv to the lint command

Use the committed `.js` versions (on `yolo-update`) as reference for which loops to convert.

**Step 3: Verify**

Run: `npx jest lib/cmd/export.test.js lib/cmd/import.test.js lib/cmd/lint.test.js lib/concurrency.test.js --no-coverage`
Expected: All tests pass

Run: `npm test && npx tsc --noEmit`
Expected: Full suite passes, types clean

**Step 4: Commit**

```bash
git add lib/cmd/export.ts lib/cmd/import.ts lib/cmd/lint.ts cli/lint.ts
git commit -m "fix(p04-t19): re-apply bounded concurrency in TypeScript command modules"
```

---

### Task p04-t20: (review) Guard gulp-newer extra-file comparison for missing dest

**Files:**
- Modify: `lib/gulp-plugins/gulp-newer/index.js`

**Step 1: Understand the issue**

Review finding: The p03-t11 ENOENT fix normalizes missing destination stats to `null`, but at line 227 the `extra` comparison path dereferences `destFileStats[timestamp]` without null-guarding `destFileStats`. On first-run builds (dest missing) with `options.extra`, this throws `TypeError`.

Location: `lib/gulp-plugins/gulp-newer/index.js:227`

**Step 2: Implement fix**

Guard the extra-file comparison:
```js
if (extraFileStats && (!destFileStats || extraFileStats[timestamp] > destFileStats[timestamp])) {
```

**Step 3: Verify**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add lib/gulp-plugins/gulp-newer/index.js
git commit -m "fix(p04-t20): guard gulp-newer extra comparison for missing dest"
```

---

## Deferred Items (Future Improvements)

Items deliberately deferred from this modernization with documented rationale.

### M1: Remove Highland.js from compile modules

**Severity:** Medium
**Rationale:** Highland.js orchestrates Gulp 4 stream pipelines in the compile modules (fonts, styles, templates, scripts, media, custom-tasks, cli/compile/index). Removing it requires rewriting the stream orchestration layer to use Gulp 4 native async completion patterns or Promise.all(). This is effectively its own project phase and is out of scope for this modernization.
**Files affected:** `lib/cmd/compile/{scripts,styles,templates,fonts,media,custom-tasks}.ts`, `cli/compile/index.ts`
**Documented in:** AGENTS.md line 76: "Highland.js streams retained in compile pipeline only"

### m4: babel-plugin-lodash deprecation warning

**Severity:** Minor
**Rationale:** The `isModuleDeclaration` deprecation warning comes from the upstream `babel-plugin-lodash` package calling a deprecated `@babel/types` API. No fix is available on the claycli side — requires an upstream release of babel-plugin-lodash. Does not affect functionality.
**Tracking:** Watch for a new release of `babel-plugin-lodash` that updates to `isImportOrExportDeclaration`.

---

## Reviews

{Track reviews here after running the oat-project-review-provide and oat-project-review-receive skills.}

{Keep both code + artifact rows below. Add additional code rows (p03, p04, etc.) as needed, but do not delete `spec`/`design`.}

| Scope | Type | Status | Date | Artifact |
|-------|------|--------|------|----------|
| p00 | code | pending | - | - |
| p01 | code | pending | - | - |
| p02 | code | fixes_completed | 2026-02-26 | reviews/p02-review-2026-02-26.md |
| p03 | code | fixes_completed | 2026-02-26 | reviews/p03-review-2026-02-26.md |
| p04 | code | fixes_completed | 2026-02-26 | reviews/p04-review-2026-02-26.md |
| final | code | fixes_added | 2026-02-26 | reviews/final-review-2026-02-26-v2.md |
| spec | artifact | pending | - | - |
| design | artifact | pending | - | - |
| plan | artifact | fixes_completed | 2026-02-25 | reviews/artifact-plan-review-2026-02-25.md |

**Status values:** `pending` → `received` → `fixes_added` → `fixes_completed` → `passed`

**Meaning:**
- `received`: review artifact exists (not yet converted into fix tasks)
- `fixes_added`: fix tasks were added to the plan (work queued)
- `fixes_completed`: fix tasks implemented, awaiting re-review
- `passed`: re-review run and recorded as passing (no Critical/Important)

---

## Definition of Completion

When all tasks below are complete, this plan is ready for final code review and merge.

**Scope:**
- Phase 0: 3 tasks - Characterization tests (scripts, get-script-dependencies, styles)
- Phase 1: 5 tasks - Foundation (Node 20+, Jest 29, ESLint 9, CI)
- Phase 2: 15 tasks - Bundling pipeline (PostCSS 8, Browserify→Webpack, ecosystem deps, **integration test checkpoint 1**, review fixes: service rewrite, dep graph, contract tests, minify behavior, failure signaling, entry keys, skip writes on error, terser dep)
- Phase 3: 11 tasks - Dependency cleanup (test expansion, Highland→async/await, native fetch, modern deps, **integration test checkpoint 2**, review fixes: bounded concurrency, import stream handling, gulp-newer ENOENT)
- Phase 4: 20 tasks - TypeScript conversion (setup, leaf→utility→core→compile→CLI→publish, **integration test checkpoint 3**, review fixes: cli/compile TS conversion, Buffer.from, unused deps, getDependencies types, URL.parse, RequestInit type, tsconfig cleanup, path-browserify, schemeless URL fix, bounded concurrency re-apply, gulp-newer extra guard)

**Total: 54 tasks**

---

## References

- Imported Source: `references/imported-plan.md`
- nymag/sites integration: `/Users/thomas.stang/code/vox/nymag/sites`
- Integration Constraints: see imported plan § Integration Constraints
