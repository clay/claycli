---
name: oat-project-quick-start
version: 1.0.0
description: Use when a task is small enough for quick mode or rapid iteration is preferred. Scaffolds a lightweight OAT project from discovery directly to a runnable plan.
argument-hint: "<project-name>"
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion
---

# Quick Start Project

Create or resume a project in **quick mode** and produce a runnable `plan.md` with minimal ceremony.

## Prerequisites

- A repository initialized for OAT (`.oat/` and `.agents/` exist).
- User has a feature request or task objective to execute.

## Mode Assertion

**OAT MODE: Quick Start**

**Purpose:** Capture intent quickly (`discovery.md`) and generate an execution-ready `plan.md` for `oat-project-implement`.

**BLOCKED Activities:**
- No spec-driven spec/design authoring unless user explicitly asks to promote to the spec-driven workflow.
- No implementation code changes.

**ALLOWED Activities:**
- Project scaffolding and project pointer updates.
- Lightweight discovery conversation and decisions capture.
- Plan generation with stable task IDs and verification commands.

**Self-Correction Protocol:**
If you catch yourself:
- Expanding into spec-driven lifecycle documentation → STOP and keep scope to quick workflow artifacts.
- Writing implementation code → STOP and return to plan authoring.

**Recovery:**
1. Re-focus on quick workflow outcome (`discovery.md` + `plan.md`).
2. Route implementation to `oat-project-implement`.

## Progress Indicators (User-Facing)

When executing this skill, provide lightweight progress feedback so the user can tell what’s happening after they confirm.

- Print a phase banner once at start using horizontal separators, e.g.:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OAT ▸ QUICK START
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Before multi-step work, print step indicators, e.g.:
  - `[1/5] Scaffolding quick-mode project…`
  - `[2/5] Capturing discovery decisions…`
  - `[3/5] Generating execution plan…`
  - `[4/5] Initializing implementation tracker…`
  - `[5/5] Refreshing dashboard…`

## Process

### Step 0: Resolve Active Project

```bash
PROJECT_PATH=$(oat config get activeProject 2>/dev/null || true)
PROJECTS_ROOT="${OAT_PROJECTS_ROOT:-$(oat config get projects.root 2>/dev/null || echo ".oat/projects/shared")}"
PROJECTS_ROOT="${PROJECTS_ROOT%/}"
```

If no valid active project exists:
- Read `{project-name}` from `$ARGUMENTS`, or ask user.
- Create project via the same scaffolding path used by `oat-project-new`:

```bash
oat project new "{project-name}" --mode quick
```

This guarantees:
- standard artifact scaffolding from `.oat/templates/`
- `activeProject` update in `.oat/config.local.json`
- repo dashboard refresh (`.oat/state.md`) via existing scaffolder behavior

### Step 1: Set Quick Workflow Metadata

Update `"$PROJECT_PATH/state.md"` frontmatter:
- `oat_workflow_mode: quick`
- `oat_workflow_origin: native`
- `oat_phase: discovery`
- `oat_phase_status: in_progress`

### Step 2: Capture Discovery (Quick)

If `"$PROJECT_PATH/discovery.md"` is missing, create it from `.oat/templates/discovery.md` first.

Use `"$PROJECT_PATH/discovery.md"` and capture:
- initial request
- key decisions
- constraints
- out-of-scope
- success criteria

Keep this concise and outcome-oriented.

### Step 3: Generate Plan Directly

Create/update `"$PROJECT_PATH/plan.md"` from `.oat/templates/plan.md`.

Required frontmatter updates:
- `oat_status: complete`
- `oat_ready_for: oat-project-implement`
- `oat_phase: plan`
- `oat_phase_status: complete`
- `oat_plan_source: quick`
- `oat_import_reference: null`
- `oat_import_source_path: null`
- `oat_import_provider: null`

Plan requirements — apply `oat-project-plan-writing` canonical format invariants:
- Stable task IDs (`pNN-tNN`)
- Verification step per task
- Atomic commit message per task
- Required sections: `## Reviews`, `## Implementation Complete`, `## References`
- Review table preservation rules (never delete existing rows)

### Step 4: Sync Project State

Update `"$PROJECT_PATH/state.md"`:
- `oat_phase: plan`
- `oat_phase_status: complete`
- `oat_current_task: null`
- set `oat_hill_checkpoints: []` for quick mode to avoid spec/design gate confusion

Recommended quick-mode gate defaults:
- keep implementation phase checkpoints via `oat_plan_hill_phases`
- do not require discovery/spec/design artifact review rows to be passed before implementation

### Step 5: Initialize Implementation Tracking

Ensure `"$PROJECT_PATH/implementation.md"` exists and frontmatter is resumable:
- `oat_status: in_progress`
- `oat_current_task_id: p01-t01` (or first task in plan)

### Step 6: Refresh Repo Dashboard

Always regenerate the repo dashboard after quick-start updates (including resume path):

```bash
oat state refresh
```

### Step 7: Output Next Action

Report:
- workflow mode (`quick`)
- total phases/tasks generated
- first task ID
- next options:
  - `oat-project-implement` (sequential, default)
  - `oat-project-subagent-implement` (parallel with autonomous review gates)
- dashboard location: `.oat/state.md` (confirm it was regenerated)

## Success Criteria

- ✅ Active project exists and pointer is valid.
- ✅ `state.md` marks `oat_workflow_mode: quick`.
- ✅ `discovery.md` contains quick discovery decisions.
- ✅ `plan.md` is complete and executable (`oat_ready_for: oat-project-implement`).
- ✅ `implementation.md` is initialized for resumable execution.
