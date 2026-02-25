---
oat_status: complete
oat_ready_for: null
oat_blockers: []
oat_last_updated: 2026-02-25
oat_generated: false
---

# Discovery: claycli-modernization

## Phase Guardrails (Discovery)

Discovery is for requirements and decisions, not implementation details.

- Prefer outcomes and constraints over concrete deliverables (no specific scripts, file paths, or function names).
- If an implementation detail comes up, capture it as an **Open Question** for design (or a constraint), not as a deliverable list.

## Initial Request

Modernize claycli — the CLI/build tool for Clay CMS — from its current Node 10-14 era tooling to modern equivalents. The tool currently constrains consuming repositories (primarily nymag/sites) to old JavaScript patterns, slow builds (1-2 minute bundling), and no HMR support. Target: ~24 hours of focused work across phased, independently-landable changes.

## Codebase Profile

- ~3,400 LOC of non-test code across 43 files
- 12 co-located test files
- Two fundamentally different concerns: CMS data operations (config, lint, import, export) and asset bundling (compile, pack)
- Primary consuming repo: `nymag/sites` — 609 components, already on Node >=20, modern browser targets (Chrome 89+, Safari 14+)

## Clarifying Questions

### Question 1: Browserify replacement strategy

**Q:** How do you feel about replacing Browserify entirely? The compile/scripts.js (502 LOC) is the most complex module — it uses Browserify with 8 custom plugins for a very specific bundling strategy (alphabetic bucket splitting, module registry extraction). Alternatives: Webpack consolidation, esbuild/Vite, or keep Browserify and just update around it.

**A:** User asked if esbuild/Vite would be too much extra work.

**Decision:** Consolidate on Webpack 5. It's already in the project (the `pack` command uses it with webpack-chain). Replicating custom Browserify behavior in Webpack plugins is straightforward — code splitting, chunk naming, and manifest generation are first-class Webpack features. esbuild/Vite would mean writing Rollup plugins for deep bundle manipulation, fighting the tool. Future migration from Webpack to Vite is well-trodden if needed later.

### Question 2: Bundle output format compatibility

**Q:** Do the consuming repositories actually depend on the specific bundle output format — the alphabetic bucket files, `_registry.json`, `_ids.json`? Or could the output format change as long as components still load correctly?

**A:** "Don't know yet."

**Decision:** Design for backward-compatible output by default. The bundle format can be modernized later once the team confirms what's flexible. This is the safe default.

### Question 3: Highland.js replacement strategy

**Q:** Highland.js is used extensively in the CMS data commands (lint, import, export) for streaming data processing. How aggressive should we be about replacing it?

**A:** Replace with Node streams (recommended approach).

**Decision:** Replace Highland with native Node streams/async iterators and async/await. The library is low-maintenance and the patterns map cleanly to modern Node APIs.

### Question 4: Build speed / HMR

**Q:** (User raised) Colleagues report 1-2 minute build times with no HMR support. How do we fix this?

**A:** This is a primary pain point driving the modernization.

**Decision:** Phase 2 (Webpack consolidation) naturally solves this:
- Webpack 5 persistent filesystem cache: first build similar speed, subsequent builds 2-5 seconds
- HMR (already partially implemented in pack command's dev config): <1 second hot patches
- Watch mode with incremental compilation: only recompiles changed modules
- Optional thread-loader for parallel Babel transforms

### Question 5: Agent instruction files

**Q:** Should we set up AGENTS.md/CLAUDE.md for this repo as part of Phase 1?

**A:** Yes, that was already done (commit d826809).

**Decision:** Agent config files are in place. Plan includes updating AGENTS.md after each phase to keep it current.

## Options Considered

### Option A: Webpack 5 consolidation for bundling

**Description:** Replace Browserify with Webpack 5, which is already in the project for the `pack` command.

**Pros:**
- Already in the project (webpack-chain, vue-loader, babel-loader all configured)
- Mature plugin API for custom behavior (bucket splitting, registry extraction)
- Built-in persistent filesystem cache for fast rebuilds
- Built-in HMR support
- Well-documented migration paths

**Cons:**
- Still a substantial rewrite of scripts.js (502 LOC)
- Webpack config complexity

### Option B: esbuild/Vite for bundling

**Description:** Replace Browserify with esbuild or Vite for faster builds.

**Pros:**
- Faster raw build speed
- Modern DX

**Cons:**
- Not already in the project — adds a new tool alongside Webpack (pack command)
- Rollup plugin API less suited to deep bundle manipulation (bucket splitting, registry extraction)
- Would require writing custom Rollup plugins for all 8 Browserify behaviors
- Fighting the tool rather than using it

**Chosen:** A (Webpack 5 consolidation)

**Summary:** Webpack 5 is already in the project and its plugin API naturally supports all the custom bundling behaviors. The speed improvement comes from persistent caching and HMR, not raw bundler speed. Future migration to Vite is straightforward from Webpack if needed.

### Option C: Keep Browserify, update around it

**Description:** Leave Browserify in place, update everything else.

**Pros:**
- Lowest risk for the bundling pipeline
- Less work

**Cons:**
- Doesn't solve the build speed problem (primary pain point)
- Doesn't enable HMR
- Browserify ecosystem is abandoned — security risk over time
- Keeps two bundlers in the project

**Chosen:** Not chosen — doesn't address the primary motivation.

## Key Decisions

1. **Bundling strategy:** Consolidate on Webpack 5, replacing Browserify. Preserve backward-compatible output format until consuming repos confirm what can change.
2. **Stream library:** Replace Highland.js with native Node streams/async-await. Update `rest.js` first with adapter, then migrate consumers, then remove adapter.
3. **Phasing:** 4 independent phases (Foundation → Bundling → Dependencies → TypeScript), each landable as its own PR/branch.
4. **Node target:** Node >=20 (with .nvmrc targeting 22 LTS). Drop all Node 10/12/14 support.
5. **Gulp retention:** Keep Gulp 4 for templates, fonts, media, and styles — these are simple stream pipelines. Replacing Gulp adds risk without significant benefit. Browserify removal is the high-value change.
6. **CommonJS retention:** Stay CommonJS through Phases 1-3. Phase 4 (TypeScript) may introduce ESM but the compiled output must remain consumable.
7. **Test coverage first:** Add characterization tests for untested high-risk modules before modifying them. 74% of source files (34 of 46) have no tests. The 4 most critical gaps are all in the compile/pack pipeline that Phase 2 rewrites.
8. **Jest over Vitest:** Stay on Jest (upgrade to 29). Vitest is ESM-first and the codebase stays CommonJS through Phases 1-3; the 3 Jest-specific test helpers (jest-fetch-mock, mock-fs, jest-mock-console) would all need replacements. Vitest could be revisited after TypeScript conversion in a future Phase 5.

## Constraints

- **`getDependencies()` API contract:** nymag/sites imports this directly via `require('claycli/lib/cmd/compile/get-script-dependencies').getDependencies`. Called on every page render. Function signature must not change.
- **`getWebpackConfig()` API contract:** nymag/sites imports this for HMR setup. Must return a webpack-chain Config object with `.toConfig()` and `.entryPoints`.
- **`client-env.json` output:** nymag/sites renderers.js requires this at startup. Must be generated by `clay compile`.
- **Output file naming in `public/js/`:** `_prelude.js`, `_postlude.js`, `_client-init.js`, `_registry.json`, `_ids.json`, bucket files (`_models-?-?.js`, `_deps-?-?.js`, `_kiln-?-?.js`, `_templates-?-?.js`), `_kiln-plugins.js`, `_kiln-plugins.css`, `_global.js`, `*.template.js`, `*.client.js`.
- **`claycli.config.js` API:** `babelTargets`, `autoprefixerOptions`, `postcssImportPaths`, `packConfig(config)` callback, `plugins` (PostCSS), `babelPresetEnvOptions`.
- **CI config:** Do not modify `.circleci/` without approval (per AGENTS.md).
- **Publish scripts:** Do not modify `package.json` publish/release scripts without approval.
- **CommonJS:** All code must use `require`/`module.exports` (per AGENTS.md) through Phases 1-3.

## Success Criteria

- `npm test` passes on Node 22 after each phase
- Build times drop from 1-2 minutes to <5 seconds for incremental rebuilds
- HMR works for component development in nymag/sites
- `npm link` into nymag/sites produces identical output format (bucket files, registry, IDs)
- All 5 hard integration contracts with nymag/sites preserved
- Zero breaking changes for consuming repos

## Out of Scope

- Changing nymag/sites code (coordinated changes deferred)
- Replacing Gulp 4 (low risk/reward ratio)
- ESM conversion (may come with TypeScript in Phase 4, but not a goal)
- Changing the CLI interface or command names
- Changing the `claycli.config.js` API surface

## Deferred Ideas

- **Vite/esbuild migration** — Webpack 5 solves the immediate problems; revisit if build speed is still insufficient after persistent caching + HMR
- **Gulp removal** — Simple stream pipelines that work fine; not worth the risk during this modernization
- **Bundle format modernization** — Once team confirms which output patterns consuming repos actually depend on, bucket splitting and registry format could be simplified
- **Lodash removal** — Evaluate during Phase 3 but don't force it; babel-plugin-lodash already optimizes imports
- **Vitest migration** — Vitest's native TypeScript support and speed would be compelling after Phase 4 (TypeScript conversion), but Jest 29 is fine for CommonJS. Revisit as a Phase 5 polish task.

## Open Questions

- **Bundle format flexibility:** Which specific output files does nymag/sites actually read at runtime vs. build time? Knowing this would let us simplify the output in a future iteration.
- **moment usage:** Is `moment` used directly in claycli code or only as a dependency for consuming projects? Determines whether it can be dropped or just made optional.
- **kew usage:** Listed as dependency but actual usage needs verification before replacement.

## Assumptions

- nymag/sites is the primary (possibly only) production consumer of claycli
- The team is willing to update nymag/sites' `package.json` to point to a new claycli version after each phase
- Integration testing via `npm link` is sufficient to validate backward compatibility
- Node 20+ is acceptable as the minimum (nymag/sites already runs >=20)

## Risks

- **Low test coverage on high-change modules:** 74% of source files have zero tests. The 4 modules most critical to the modernization — `compile/scripts.js` (502 LOC, full rewrite), `compile/get-script-dependencies.js` (146 LOC, API contract), `compile/styles.js` (162 LOC, PostCSS upgrade), `pack/get-webpack-config.js` (295 LOC, config sharing) — all have zero tests. Existing tests on `rest.js`, `import.js`, and `lint.js` are shallow relative to their complexity.
  - **Likelihood:** High
  - **Impact:** High (regressions undetectable without tests)
  - **Mitigation:** Phase 0 adds characterization tests for all 4 critical untested modules before any modifications. Existing tests for Highland-based modules are expanded at the start of Phase 3.

- **Browserify→Webpack output mismatch:** The custom bundling behavior (bucket splitting, registry extraction) may have subtle edge cases not covered by existing tests.
  - **Likelihood:** Medium
  - **Impact:** High (would break nymag/sites builds)
  - **Mitigation:** Comprehensive integration testing with `npm link` into nymag/sites; compare output file-by-file before/after. Phase 0 characterization tests capture exact current behavior.

- **Highland removal cascading failures:** `rest.js` return type change (Highland stream → Promise) affects all consumers simultaneously.
  - **Likelihood:** Low (well-tested modules)
  - **Impact:** Medium
  - **Mitigation:** Adapter pattern — update `rest.js` with Highland-compatible adapter first, migrate consumers one by one, then remove adapter

- **Jest 24→29 breaking changes:** Multiple major versions with default changes (jsdom→node environment, timer implementation).
  - **Likelihood:** Medium
  - **Impact:** Low (test-only, easy to fix)
  - **Mitigation:** Update incrementally, fix breakages as they appear

## Next Steps

Plan has been imported and normalized. Ready for `oat-project-implement` (sequential) or `oat-project-subagent-implement` (parallel).
