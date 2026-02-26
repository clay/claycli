---
name: oat-project-import-plan
version: 1.0.0
description: Use when you have an external markdown plan to execute with OAT. Preserves the source plan and normalizes it into canonical plan.md format.
argument-hint: "<path-to-plan.md> [--provider codex|cursor|claude] [--project <name>]"
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion
---

# Import External Plan

Import a markdown plan from an external coding provider and normalize it into OAT project artifacts.

## Prerequisites

- External plan exists as a local markdown file.
- OAT repository scaffolding is available.

## Mode Assertion

**OAT MODE: Plan Import**

**Purpose:** Preserve the original plan and generate a runnable canonical `plan.md` for OAT execution.

**BLOCKED Activities:**
- No destructive edits to the imported source file.
- No implementation code changes.

**ALLOWED Activities:**
- Creating/updating project artifacts.
- Plan normalization into OAT task structure.
- Updating project state metadata for import mode.

**Self-Correction Protocol:**
If you catch yourself:
- Mutating source plan content in-place → STOP; copy source first.
- Producing prose-only plan without runnable tasks → STOP and normalize to `pNN-tNN` tasks.

**Recovery:**
1. Preserve source in `references/imported-plan.md`.
2. Regenerate canonical `plan.md` in OAT structure.

## Progress Indicators (User-Facing)

When executing this skill, provide lightweight progress feedback so the user can tell what’s happening after they confirm.

- Print a phase banner once at start using horizontal separators, e.g.:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OAT ▸ IMPORT PLAN
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Before multi-step work, print step indicators, e.g.:
  - `[1/5] Resolving project + source plan…`
  - `[2/5] Preserving imported source…`
  - `[3/5] Normalizing plan to OAT task structure…`
  - `[4/5] Updating project metadata + state…`
  - `[5/5] Refreshing dashboard…`

## Process

### Step 0: Resolve Active Project

```bash
PROJECT_PATH=$(oat config get activeProject 2>/dev/null || true)
PROJECTS_ROOT="${OAT_PROJECTS_ROOT:-$(oat config get projects.root 2>/dev/null || echo ".oat/projects/shared")}"
PROJECTS_ROOT="${PROJECTS_ROOT%/}"
```

If no valid active project exists:
- Use `--project` if provided, else ask user.
- Resolve `TARGET_PROJECT_PATH="${PROJECTS_ROOT}/{project-name}"`.
- If `TARGET_PROJECT_PATH/state.md` exists, set:
  ```bash
  oat config set activeProject "$TARGET_PROJECT_PATH"
  PROJECT_PATH="$TARGET_PROJECT_PATH"
  ```
- Otherwise create an import-mode scaffold (which sets active project by default):
  ```bash
  oat project new "{project-name}" --mode import
  PROJECT_PATH="$TARGET_PROJECT_PATH"
  ```

### Step 1: Resolve and Validate Source Plan Path

Inputs:
- source path from `$ARGUMENTS`
- optional provider hint from `--provider`

If source path is not provided, discover likely recent plans first. The discovery script checks both provider plan directories and this repository's external plan directory by default:
- `.oat/repo/reference/external-plans/`

```bash
bash .agents/skills/oat-project-import-plan/scripts/find-recent-provider-plans.sh --hours 24
```

Optional: extend discovery roots via `OAT_PROVIDER_PLAN_DIRS` (colon-separated):

```bash
export OAT_PROVIDER_PLAN_DIRS="$HOME/custom-plans:$HOME/tmp/provider-plans"
```

Then ask user to either:
- choose one of the listed files (by number), or
- provide a manual file path.

Validation rules:
- File must exist.
- File extension must be `.md` (or user explicitly confirms nonstandard markdown extension).
- File must contain non-empty content.

### Step 2: Preserve Imported Source

Create references directory if missing:

```bash
mkdir -p "$PROJECT_PATH/references"
cp "{source-path}" "$PROJECT_PATH/references/imported-plan.md"
```

Never overwrite an existing source snapshot without user confirmation.
If already present, write timestamped copy:
- `references/imported-plan-YYYY-MM-DD-HHMM.md`

### Step 3: Normalize Into Canonical OAT plan.md

Create/update `"$PROJECT_PATH/plan.md"` using `.oat/templates/plan.md` and map imported content into the canonical structure. Apply `oat-project-plan-writing` invariants after mapping:
- `## Phase N`
- `### Task pNN-tNN` (stable task IDs)
- Step structure (RED/GREEN/Refactor/Verify/Commit)
- Required sections: `## Reviews`, `## Implementation Complete`, `## References`
- Review table preservation rules (never delete existing rows)

Normalization rules:
- Preserve original intent and ordering from source.
- Generate stable task IDs per `oat-project-plan-writing` format (`pNN-tNN`).
- Where source lacks test/verify details, add explicit TODO-style placeholders with clear expected output.
- Keep tasks executable and atomic.

### Step 4: Update Plan Metadata

Set frontmatter in `"$PROJECT_PATH/plan.md"`:
- `oat_status: complete`
- `oat_ready_for: oat-project-implement`
- `oat_phase: plan`
- `oat_phase_status: complete`
- `oat_plan_source: imported`
- `oat_import_reference: references/imported-plan.md`
- `oat_import_source_path: {source-path}`
- `oat_import_provider: {codex|cursor|claude|null}`

### Step 5: Update Project State

Set `"$PROJECT_PATH/state.md"` frontmatter:
- `oat_workflow_mode: import`
- `oat_workflow_origin: imported`
- `oat_phase: plan`
- `oat_phase_status: complete`
- `oat_current_task: null`

### Step 5.5: Ensure Active Project Pointer

Import mode must leave the imported project as active for immediate execution.

Validate target project before writing pointer:

```bash
if [[ ! -f "$PROJECT_PATH/state.md" ]]; then
  echo "Error: Project missing state.md: $PROJECT_PATH/state.md" >&2
  exit 1
fi
```

```bash
oat config set activeProject "$PROJECT_PATH"
oat state refresh
```

If `activeProject` in local config already exists with a different path, treat this as a project switch and note it in output.

### Step 6: Ensure Implementation Artifact Exists

If missing, scaffold from template:
- `.oat/templates/implementation.md` → `"$PROJECT_PATH/implementation.md"`

Initialize pointer to first plan task ID.

### Step 7: Output Next Action

Report:
- source imported path
- normalized phases/tasks count
- first task ID
- active project pointer path
- dashboard refresh status
- next options:
  - `oat-project-implement` (sequential, default)
  - `oat-project-subagent-implement` (parallel with autonomous review gates)

## Success Criteria

- ✅ Imported markdown preserved at `references/imported-plan.md`.
- ✅ Canonical `plan.md` generated with OAT task structure.
- ✅ `plan.md` metadata marks `oat_plan_source: imported`.
- ✅ `state.md` marks `oat_workflow_mode: import`.
- ✅ `implementation.md` is present and resumable.
- ✅ `activeProject` in `.oat/config.local.json` points to the imported project.
- ✅ `.oat/state.md` has been refreshed after pointer update.
