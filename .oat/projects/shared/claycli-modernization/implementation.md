---
oat_status: in_progress
oat_ready_for: null
oat_blockers: []
oat_last_updated: 2026-02-25
oat_current_task_id: p00-t01
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
| Phase 0: Characterization Tests | pending | 3 | 0/3 |
| Phase 1: Foundation | pending | 5 | 0/5 |
| Phase 2: Bundling Pipeline | pending | 7 | 0/7 |
| Phase 3: Dependency Cleanup | pending | 8 | 0/8 |
| Phase 4: TypeScript Conversion | pending | 9 | 0/9 |

**Total:** 0/32 tasks completed

**Integration Test Checkpoints (HiLL gates):**
- Checkpoint 1 (p02-t07): after P0+P1+P2 — Browserify→Webpack migration
- Checkpoint 2 (p03-t08): after P3 — Highland→async/await
- Checkpoint 3 (p04-t09): after P4 — TypeScript conversion

---

## Phase 0: Characterization Tests

**Status:** pending
**Started:** -

### Phase Summary (fill when phase is complete)

**Outcome (what changed):**
- {2-5 bullets describing user-visible / behavior-level changes delivered in this phase}

**Key files touched:**
- `{path}` - {why}

**Verification:**
- Run: `{command(s)}`
- Result: {pass/fail + notes}

**Notes / Decisions:**
- {trade-offs or deviations discovered during implementation}

### Task p00-t01: Add characterization tests for compile/scripts.js

**Status:** pending
**Commit:** -

**Notes:**
- 502 LOC module with zero tests; being fully rewritten in Phase 2
- Must capture Browserify plugin behavior, ID generation, bucket splitting, cache management

---

### Task p00-t02: Add characterization tests for get-script-dependencies.js

**Status:** pending
**Commit:** -

**Notes:**
- Hard API contract with nymag/sites; 146 LOC, zero tests
- Must capture getDependencies() behavior for all argument combinations

---

### Task p00-t03: Add characterization tests for compile/styles.js

**Status:** pending
**Commit:** -

**Notes:**
- 162 LOC, zero tests; PostCSS upgrade in Phase 2
- Must capture hasChanged() recursive dependency checking

---

### ~~Task p00-t04~~ REMOVED

Removed — `clay pack` was an unreleased experiment. No characterization tests needed.

---

## Phase 1: Foundation (Node, Test Infra, CI)

**Status:** pending
**Started:** -

### Phase Summary (fill when phase is complete)

**Outcome (what changed):**
- {2-5 bullets describing user-visible / behavior-level changes delivered in this phase}

**Key files touched:**
- `{path}` - {why}

**Verification:**
- Run: `{command(s)}`
- Result: {pass/fail + notes}

**Notes / Decisions:**
- {trade-offs or deviations discovered during implementation}

### Task p01-t01: Update Node engine requirements

**Status:** pending
**Commit:** -

**Notes:**
- First task — update `package.json` engines and add `.nvmrc`

---

### Task p01-t02: Upgrade Jest 24 to 29

**Status:** pending
**Commit:** -

**Notes:**
- Major version jump; watch for jsdom→node env default change and timer implementation changes

---

### Task p01-t03: Upgrade ESLint 7 to 9

**Status:** pending
**Commit:** -

**Notes:**
- Requires flat config migration (.eslintrc → eslint.config.js)

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
