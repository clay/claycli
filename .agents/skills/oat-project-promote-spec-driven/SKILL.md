---
name: oat-project-promote-spec-driven
version: 1.0.0
description: Use when a quick or imported project now needs Spec-Driven lifecycle rigor. Backfills missing discovery, spec, and design artifacts in place.
argument-hint: "[--project <name>]"
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion
---

# Promote Project To Spec-Driven Lifecycle

Convert a quick/import workflow project into a Spec-Driven OAT lifecycle project without creating a new project directory.

## Prerequisites

- Active project exists.
- Project currently uses `oat_workflow_mode: quick` or `oat_workflow_mode: import`.

## Mode Assertion

**OAT MODE: Promote Spec-Driven Lifecycle**

**Purpose:** Backfill missing lifecycle artifacts (`discovery.md`, `spec.md`, `design.md`) while preserving existing `plan.md` and execution history.

**BLOCKED Activities:**
- No project recreation/migration to a new path.
- No deletion of existing `plan.md` or `implementation.md` history.

**ALLOWED Activities:**
- Generating missing lifecycle artifacts from templates.
- Deriving artifact drafts from plan and implementation context.
- Updating state metadata and next-step routing.

**Self-Correction Protocol:**
If you catch yourself:
- Replacing existing plan history with a new plan → STOP and preserve current plan.
- Treating promotion as a reset → STOP and continue in-place.

**Recovery:**
1. Keep all existing project artifacts intact.
2. Fill only missing lifecycle documents.
3. Update mode/state fields for Spec-Driven lifecycle routing.

## Progress Indicators (User-Facing)

When executing this skill, provide lightweight progress feedback so the user can tell what’s happening after they confirm.

- Print a phase banner once at start using horizontal separators, e.g.:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OAT ▸ PROMOTE TO SPEC-DRIVEN
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Before multi-step work, print step indicators, e.g.:
  - `[1/4] Checking promotion eligibility…`
  - `[2/4] Inspecting existing artifacts…`
  - `[3/4] Backfilling missing lifecycle artifacts…`
  - `[4/4] Switching to spec-driven mode + reporting…`

## Process

### Step 0: Resolve Active Project

```bash
PROJECT_PATH=$(oat config get activeProject 2>/dev/null || true)
PROJECTS_ROOT="${OAT_PROJECTS_ROOT:-$(oat config get projects.root 2>/dev/null || echo ".oat/projects/shared")}"
PROJECTS_ROOT="${PROJECTS_ROOT%/}"
```

If missing/invalid, ask for project name and set active project pointer.

### Step 1: Validate Promotion Eligibility

Read `"$PROJECT_PATH/state.md"` and verify:
- `oat_workflow_mode` is `quick` or `import`

If already `spec-driven`, report no-op and stop unless user asks for artifact refresh.

### Step 2: Inspect Existing Artifacts

Check for:
- `discovery.md`
- `spec.md`
- `design.md`
- `plan.md`
- `implementation.md`

Classify each as:
- present and usable
- present but template-only
- missing

### Step 3: Backfill Missing Artifacts

For each missing artifact:
- copy from `.oat/templates/{artifact}.md`
- set frontmatter for in-progress draft
- derive initial content from existing `plan.md`, `implementation.md`, and (when available) `references/imported-plan.md`

Backfill policy:
- `discovery.md`: project intent, constraints, decisions already made
- `spec.md`: requirements and acceptance criteria inferred from current plan/tasks
- `design.md`: architecture rationale inferred from implementation/plan

### Step 4: Preserve Existing Plan Provenance

Do not rewrite plan history.

Keep `oat_plan_source` unchanged unless user explicitly requests a new spec-driven-plan regeneration.

If user requests regeneration:
- create a new plan revision section in `plan.md`
- keep imported/quick provenance in references and notes

### Step 5: Switch Project To Spec-Driven Mode

Update `"$PROJECT_PATH/state.md"` frontmatter:
- `oat_workflow_mode: spec-driven`
- keep `oat_workflow_origin` as-is (`native` or `imported`)
- align `oat_phase` and `oat_phase_status` with current actual progress

Recommended default phase after promotion:
- if implementation has not started: `plan` complete
- if implementation has started: `implement` in_progress/complete based on current task state

### Step 6: Report Promotion Outcome

Output:
- artifacts created/updated
- retained provenance fields
- current phase
- recommended next skill (typically `oat-project-implement` or `oat-project-review-provide`)

## Success Criteria

- ✅ Project remains in same directory with history preserved.
- ✅ Missing discovery/spec/design artifacts are backfilled.
- ✅ `state.md` now marks `oat_workflow_mode: spec-driven`.
- ✅ `plan.md` provenance is preserved (`oat_plan_source` unchanged unless user asked to regenerate).
- ✅ Next-step routing is valid for Spec-Driven lifecycle skills.
