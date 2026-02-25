---
oat_status: in_progress
oat_ready_for: null
oat_blockers: []
oat_last_updated: 2026-02-25
oat_current_task_id: p01-t04
oat_generated: false
---

# Implementation: claycli-modernization

**Started:** 2026-02-25
**Last Updated:** 2026-02-25

> This document is used to resume interrupted implementation sessions.
>
> Conventions:
> - `oat_current_task_id` always points at the **next plan task to do** (not the last completed task).
> - When all plan tasks are complete, set `oat_current_task_id: null`.
> - Reviews are **not** plan tasks. Track review status in `plan.md` under `## Reviews` (e.g., `| final | code | passed | ... |`).
> - Keep phase/task statuses consistent with the Progress Overview table so restarts resume correctly.
> - Before running the `oat-project-pr-final` skill, ensure `## Final Summary (for PR/docs)` is filled with what was actually implemented.

## Progress Overview

| Phase | Status | Tasks | Completed |
|-------|--------|-------|-----------|
| Phase 0: Characterization Tests | completed | 3 | 3/3 |
| Phase 1: Foundation | in_progress | 5 | 3/5 |
| Phase 2: Bundling Pipeline | pending | 7 | 0/7 |
| Phase 3: Dependency Cleanup | pending | 8 | 0/8 |
| Phase 4: TypeScript Conversion | pending | 9 | 0/9 |

**Total:** 6/32 tasks completed

**Integration Test Checkpoints (HiLL gates):**
- Checkpoint 1 (p02-t07): after P0+P1+P2 — Browserify→Webpack migration
- Checkpoint 2 (p03-t08): after P3 — Highland→async/await
- Checkpoint 3 (p04-t09): after P4 — TypeScript conversion

---

## Phase 0: Characterization Tests

**Status:** in_progress
**Started:** 2026-02-25

### Phase Summary

**Outcome (what changed):**
- Added 104 characterization tests across 3 compile modules (scripts, get-script-dependencies, styles)
- Captured Browserify-based module ID assignment, bucket splitting, and output file mapping contracts
- Captured getDependencies API contract (hard contract with nymag/sites)
- Captured PostCSS-based CSS compilation path transformation and change detection
- Exposed internal functions via test-only exports for all 3 modules

**Key files touched:**
- `lib/cmd/compile/scripts.js` - test-only exports added
- `lib/cmd/compile/scripts.test.js` - 48 tests created
- `lib/cmd/compile/get-script-dependencies.js` - test-only exports added
- `lib/cmd/compile/get-script-dependencies.test.js` - 38 tests created
- `lib/cmd/compile/styles.js` - test-only exports added
- `lib/cmd/compile/styles.test.js` - 18 tests created

**Verification:**
- Run: `npx jest lib/cmd/compile/ --no-coverage`
- Result: 104 passed, 0 failed

**Notes / Decisions:**
- 2 pre-existing test failures in import.test.js (Node 22 JSON error message format change)
- Did not test full compile()/buildScripts() integration (requires Browserify pipeline)
- Used real filesystem for view-mode registry tests (mock-fs incompatible with require())

### Task p00-t01: Add characterization tests for compile/scripts.js

**Status:** completed
**Commit:** 7bed38c

**Outcome (required):**
- Added 48 characterization tests covering all key internal functions
- Exposed getModuleId, idGenerator, getOutfile, rewriteServiceRequire for testing
- Captured module ID assignment for all 7 file types (client, model, kiln, kiln plugins, legacy, deps, other)
- Captured bucket splitting across all 6 alphabetic ranges
- Captured cache/ID-persistence behavior across generator instances

**Files changed:**
- `lib/cmd/compile/scripts.js` - added test-only exports for internal functions
- `lib/cmd/compile/scripts.test.js` - created with 48 characterization tests

**Verification:**
- Run: `npx jest lib/cmd/compile/scripts.test.js --no-coverage`
- Result: 48 passed, 0 failed

**Notes / Decisions:**
- Exposed internal functions via test-only exports (following existing pattern in compilation-helpers.js)
- Did not test buildScripts/compile integration (requires full Browserify pipeline with real filesystem)
- 2 pre-existing test failures in import.test.js (Node 22 JSON error message format change)

---

### Task p00-t02: Add characterization tests for get-script-dependencies.js

**Status:** completed
**Commit:** 5e84641

**Outcome (required):**
- Added 38 characterization tests covering the complete getDependencies API contract
- Exposed 7 internal functions for testing (idToPublicPath, publicPathToID, computeDep, etc.)
- Captured edit-mode vs view-mode behavior differences
- Captured recursive dependency resolution with cycle handling
- Captured legacy dep auto-inclusion in view mode
- Captured glob patterns for minified (bucket) vs unminified (individual) file discovery

**Files changed:**
- `lib/cmd/compile/get-script-dependencies.js` - added test-only exports
- `lib/cmd/compile/get-script-dependencies.test.js` - created with 38 characterization tests

**Verification:**
- Run: `npx jest lib/cmd/compile/get-script-dependencies.test.js --no-coverage`
- Result: 38 passed, 0 failed

**Notes / Decisions:**
- Consolidated view-mode tests into single test to avoid Node require cache collision issues
- Used real fs-extra for registry file creation (mock-fs doesn't work with require())

---

### Task p00-t03: Add characterization tests for compile/styles.js

**Status:** completed
**Commit:** 58be005

**Outcome (required):**
- Added 18 characterization tests covering CSS compilation behavior
- Captured transformPath naming convention (component.styleguide.css)
- Captured hasChanged dependency-aware change detection
- Captured renameFile logic for gulp-rename
- Captured environment variable configuration

**Files changed:**
- `lib/cmd/compile/styles.js` - added test-only exports
- `lib/cmd/compile/styles.test.js` - created with 18 characterization tests

**Verification:**
- Run: `npx jest lib/cmd/compile/styles.test.js --no-coverage`
- Result: 18 passed, 0 failed

**Notes / Decisions:**
- Used real filesystem (fs-extra) for hasChanged tests instead of mock-fs
- Did not test full compile() pipeline (requires real styleguide directory structure with gulp)

---

### ~~Task p00-t04~~ REMOVED

Removed — `clay pack` was an unreleased experiment. No characterization tests needed.

---

## Phase 1: Foundation (Node, Test Infra, CI)

**Status:** in_progress
**Started:** 2026-02-25

### Phase Summary (fill when phase is complete)

### Task p01-t01: Update Node engine requirements

**Status:** completed
**Commit:** e5292fd

**Outcome (required):**
- Added `"engines": { "node": ">=20" }` to package.json
- Created `.nvmrc` with Node 22

**Files changed:**
- `package.json` - added engines field
- `.nvmrc` - created with Node 22

**Verification:**
- Run: `npx jest --no-coverage`
- Result: 339 passed, 2 pre-existing failures

---

### Task p01-t02: Upgrade Jest 24 to 29

**Status:** completed
**Commit:** 431af8c

**Outcome (required):**
- Upgraded Jest 24→29, jest-fetch-mock 1→3, jest-mock-console 0.4→2, mock-fs 4→5
- Fixed deprecated testURL config for Jest 29
- Fixed jest-fetch-mock v3 enableMocks() API
- Fixed jest-mock-console v2 import pattern
- Fixed JSON error message assertions for Node 20+ compatibility
- All 341 tests pass (0 failures, clean baseline)

**Files changed:**
- `package.json` - updated test dependencies and Jest config
- `package-lock.json` - regenerated
- `setup-jest.js` - updated jest-fetch-mock setup for v3
- `lib/compilation-helpers.test.js` - fixed jest-mock-console import
- `lib/cmd/import.test.js` - fixed JSON error message assertions

**Verification:**
- Run: `npx jest --no-coverage`
- Result: 341 passed, 0 failed (clean baseline)

---

### Task p01-t03: Upgrade ESLint 7 to 9

**Status:** completed
**Commit:** 2508455

**Outcome (required):**
- Migrated from ESLint 7 (.eslintrc) to ESLint 9 flat config (eslint.config.js)
- Removed .eslintrc and .eslintignore (content moved to flat config)
- Removed @babel/eslint-parser and @babel/plugin-syntax-dynamic-import (no longer needed)
- Removed deprecated `/* eslint-env */` inline comments from 8 files
- Added browser globals override for _client-init.js and mount-component-modules.js
- Fixed pre-existing lint issues: unused catch vars in styles.js, export.js, import.js
- Added eslint-disable for pre-existing complexity (9 > max 8) in scripts.js compile()

**Files changed:**
- `eslint.config.js` - created (ESLint 9 flat config)
- `.eslintrc` - deleted
- `.eslintignore` - deleted (ignores moved to flat config)
- `package.json` - updated eslint ^9.0.0, added @eslint/js, globals; removed @babel/eslint-parser, @babel/plugin-syntax-dynamic-import
- `package-lock.json` - regenerated
- `cli/index.js` - removed unused eslint-disable directive
- `lib/cmd/compile/_client-init.js` - removed `/* eslint-env browser */`
- `lib/cmd/compile/scripts.js` - added eslint-disable for complexity
- `lib/cmd/compile/scripts.test.js` - removed `/* eslint-env jest */`, fixed max-nested-callbacks
- `lib/cmd/compile/styles.js` - renamed unused catch var
- `lib/cmd/compile/styles.test.js` - removed `/* eslint-env jest */`
- `lib/cmd/compile/get-script-dependencies.test.js` - removed `/* eslint-env jest */`
- `lib/cmd/config.test.js` - removed `/* eslint-env jest */`
- `lib/cmd/export.js` - renamed unused catch var
- `lib/cmd/import.js` - renamed unused catch var
- `lib/cmd/pack/get-webpack-config.js` - removed unused eslint-disable directive
- `lib/cmd/pack/mount-component-modules.js` - removed `/* eslint-env browser */`
- `lib/compilation-helpers.test.js` - removed `/* eslint-env jest */`
- `lib/config-file-helpers.test.js` - removed `/* eslint-env jest */`

**Verification:**
- Run: `npx eslint lib cli index.js && npx jest --no-coverage`
- Result: 0 lint errors, 341 tests passed

**Notes / Decisions:**
- Kept all original rules from .eslintrc verbatim (no new rules added)
- Used `ecmaVersion: 2022` (native ES2022 parsing, no need for babel parser)
- Pre-existing complexity issue in compile() function left as-is with eslint-disable (will be refactored in Phase 2 rewrite)

---

### Task p01-t04: Update CI configuration

**Status:** pending
**Commit:** -

**Notes:**
- Node 20/22 matrix; requires approval per AGENTS.md

---

### Task p01-t05: Update AGENTS.md for Phase 1

**Status:** pending
**Commit:** -

---

## Phase 2: Bundling Pipeline Modernization

**Status:** pending
**Started:** -

### Task p02-t01: Upgrade PostCSS 7 to 8

**Status:** pending
**Commit:** -

---

### Task p02-t02: Replace Browserify with Webpack for script compilation

**Status:** pending
**Commit:** -

**Notes:**
- Largest single task; full rewrite of scripts.js (502 LOC)
- Critical backward compatibility requirements for nymag/sites integration

---

### Task p02-t03: Update Webpack ecosystem dependencies

**Status:** pending
**Commit:** -

---

### Task p02-t04: Update Babel browser targets

**Status:** pending
**Commit:** -

---

### Task p02-t05: Evaluate and document Gulp retention

**Status:** pending
**Commit:** -

---

### Task p02-t06: Update AGENTS.md for Phase 2

**Status:** pending
**Commit:** -

---

### Task p02-t07: Integration test checkpoint 1 — nymag/sites

**Status:** pending
**Commit:** -

**Notes:**
- HiLL gate — highest-risk checkpoint (Browserify→Webpack)
- Must pass before proceeding to Phase 3
- Baseline: 1193 files in ~6s

---

## Phase 3: Dependency Cleanup & Stream Modernization

**Status:** pending
**Started:** -

### Task p03-t01: Expand tests for Highland-based modules before replacement

**Status:** pending
**Commit:** -

**Notes:**
- Expand rest.test.js (29 tests → add SSL, recursive URI, elastic edge cases)
- Expand import.test.js (26 tests → add YAML splitting, @published edge cases)
- Expand lint.test.js (28 tests → add deep recursion, error propagation)

---

### Task p03-t02: Replace Highland.js with async/await in rest.js

**Status:** pending
**Commit:** -

---

### Task p03-t03: Replace Highland.js in lint, export, import commands

**Status:** pending
**Commit:** -

---

### Task p03-t04: Replace isomorphic-fetch with native fetch

**Status:** pending
**Commit:** -

---

### Task p03-t05: Replace kew with native Promises

**Status:** pending
**Commit:** -

---

### Task p03-t06: Modernize remaining dependencies

**Status:** pending
**Commit:** -

---

### Task p03-t07: Update AGENTS.md for Phase 3

**Status:** pending
**Commit:** -

---

### Task p03-t08: Integration test checkpoint 2 — nymag/sites

**Status:** pending
**Commit:** -

**Notes:**
- HiLL gate — verify Highland→async/await didn't break compile
- Must pass before proceeding to Phase 4

---

## Phase 4: TypeScript Conversion

**Status:** pending
**Started:** -

### Task p04-t01: Set up TypeScript infrastructure

**Status:** pending
**Commit:** -

---

### Task p04-t02: Convert leaf modules to TypeScript

**Status:** pending
**Commit:** -

---

### Task p04-t03: Convert utility modules to TypeScript

**Status:** pending
**Commit:** -

---

### Task p04-t04: Convert core modules to TypeScript

**Status:** pending
**Commit:** -

---

### Task p04-t05: Convert compile/pack modules to TypeScript

**Status:** pending
**Commit:** -

---

### Task p04-t06: Convert CLI entry points to TypeScript

**Status:** pending
**Commit:** -

---

### Task p04-t07: Update build and publish configuration

**Status:** pending
**Commit:** -

---

### Task p04-t08: Update AGENTS.md for Phase 4

**Status:** pending
**Commit:** -

---

### Task p04-t09: Integration test checkpoint 3 — nymag/sites

**Status:** pending
**Commit:** -

**Notes:**
- Final integration gate — TypeScript-compiled output must be drop-in replacement
- All 3 checkpoints must pass before final PR

---

## Orchestration Runs

> This section is used by `oat-project-subagent-implement` to log parallel execution runs.
> Each run appends a new subsection — never overwrite prior entries.
> For single-thread execution (via `oat-project-implement`), this section remains empty.

<!-- orchestration-runs-start -->
<!-- orchestration-runs-end -->

---

## Implementation Log

Chronological log of implementation progress.

### 2026-02-25

**Session Start:** -

- [ ] p00-t01: Add characterization tests for compile/scripts.js - pending

**What changed (high level):**
- Plan imported and normalized; implementation not yet started
- Added Phase 0 (characterization tests) and Phase 3 test expansion task

**Decisions:**
- Imported plan from Claude (gentle-questing-snowflake.md)

**Follow-ups / TODO:**
- Begin Phase 1 implementation

**Blockers:**
- None

**Session End:** -

---

### Review Received: plan (artifact)

**Date:** 2026-02-25
**Review artifact:** reviews/artifact-plan-review-2026-02-25.md

**Findings:**
- Critical: 1 (C1: ESM convention conflict — fixed in plan)
- Important: 3 (I1: CI approval gate — fixed; I2: plan review row — already resolved; I3: premature completion — fixed)
- Medium: 0
- Minor: 1 (m1: git add -A TODO — fixed directly, auto-deferred originally)

**Actions taken:** All findings fixed directly in plan.md (artifact review — wording changes only, no implementation tasks needed):
- C1: Rewrote p04-t08 to document TypeScript + CommonJS conventions (not ESM)
- I1: Added approval precondition step to p01-t04
- I2: Plan artifact row already existed (auto-added by review-provide)
- I3: Renamed "Implementation Complete" to "Definition of Completion", removed premature completion claim
- m1: Replaced `git add -A # TODO` with explicit file staging instruction

**Deferred Findings:**
- None (all findings addressed directly)

---

## Deviations from Plan

Document any deviations from the original plan.

| Task | Planned | Actual | Reason |
|------|---------|--------|--------|
| - | - | - | - |

## Test Results

Track test execution during implementation.

| Phase | Tests Run | Passed | Failed | Coverage |
|-------|-----------|--------|--------|----------|
| 0 | - | - | - | - |
| 1 | - | - | - | - |
| 2 | - | - | - | - |
| 3 | - | - | - | - |
| 4 | - | - | - | - |

## Final Summary (for PR/docs)

**What shipped:**
- {capability 1}
- {capability 2}

**Behavioral changes (user-facing):**
- {bullet}

**Key files / modules:**
- `{path}` - {purpose}

**Verification performed:**
- {tests/lint/typecheck/build/manual steps}

**Design deltas (if any):**
- {what changed vs design.md and why}

## References

- Plan: `plan.md`
- Imported Source: `references/imported-plan.md`
