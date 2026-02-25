---
name: oat-project-progress
version: 1.0.0
description: Use when resuming work, checking status, or unsure which OAT skill to run next. Evaluates project progress and routes to the appropriate next step.
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Glob, Grep, Bash(git:*), AskUserQuestion
---

# Progress Router

Check knowledge base status, project progress, and get recommendations for next steps.

## Progress Indicators (User-Facing)

When executing this skill, provide lightweight progress feedback so the user can tell what’s happening after they confirm.

- Print a phase banner once at start using horizontal separators, e.g.:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OAT ▸ PROGRESS
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Before multi-step work, print step indicators, e.g.:
  - `[1/4] Checking knowledge base…`
  - `[2/4] Scanning project status…`
  - `[3/4] Determining next steps…`
  - `[4/4] Refreshing dashboard…`

## Usage

Run `oat-project-progress` at any time to:
- Check if knowledge base exists and is fresh
- See current project status
- Get recommended next skill

## Process

### Step 1: Check Knowledge Base Exists

```bash
EXISTING_MD=$(find .oat/repo/knowledge -name "*.md" -type f 2>/dev/null | head -1)
```

**If `$EXISTING_MD` is empty:**
```
⚠️  No knowledge base found.

Run the oat-repo-knowledge-index skill first to generate codebase analysis.
```
**Exit here.**

### Step 2: Check Knowledge Staleness

Extract frontmatter from `.oat/repo/knowledge/project-index.md`:

```bash
SOURCE_MERGE_BASE_SHA=$(grep "^oat_source_main_merge_base_sha:" .oat/repo/knowledge/project-index.md | awk '{print $2}')
GENERATED_AT=$(grep "^oat_generated_at:" .oat/repo/knowledge/project-index.md | awk '{print $2}')
```

**Calculate staleness:**

1. **Age check:**
```bash
# Skip if date is missing or invalid
if [ -n "$GENERATED_AT" ] && echo "$GENERATED_AT" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
  if date -j -f "%Y-%m-%d" "$GENERATED_AT" +%s >/dev/null 2>&1; then
    GENERATED_TS=$(date -j -f "%Y-%m-%d" "$GENERATED_AT" +%s)
  else
    GENERATED_TS=$(date -d "$GENERATED_AT" +%s 2>/dev/null || echo "")
  fi
  if [ -n "$GENERATED_TS" ]; then
    DAYS_OLD=$(( ($(date +%s) - $GENERATED_TS) / 86400 ))
  fi
fi
```

2. **Git diff check:**
```bash
if [ -n "$SOURCE_MERGE_BASE_SHA" ]; then
  FILES_CHANGED=$(git diff --numstat "$SOURCE_MERGE_BASE_SHA..HEAD" 2>/dev/null | wc -l | tr -d ' ')
  CHANGES_SUMMARY=$(git diff --shortstat "$SOURCE_MERGE_BASE_SHA..HEAD" 2>/dev/null)
fi
```

**Staleness thresholds:**
- Age: >7 days old
- Changes: >20 files changed

**If stale:**
```
⚠️  Knowledge base may be stale.

Generated: {GENERATED_AT} ({DAYS_OLD} days ago)
Changes since: {FILES_CHANGED} files changed
{CHANGES_SUMMARY}

Consider running the oat-repo-knowledge-index skill to refresh.
```

### Step 3: List Projects (Highlight Active Project)

OAT stores active project context in `.oat/config.local.json` (`activeProject`, local-only).

```bash
ACTIVE_PROJECT_PATH=$(oat config get activeProject 2>/dev/null || true)
PROJECTS_ROOT="${OAT_PROJECTS_ROOT:-$(oat config get projects.root 2>/dev/null || echo ".oat/projects/shared")}"
PROJECTS_ROOT="${PROJECTS_ROOT%/}"
```

**If `ACTIVE_PROJECT_PATH` is set and valid (directory exists):**
```
Active Project: {basename(ACTIVE_PROJECT_PATH)} ({ACTIVE_PROJECT_PATH})
```

**If `ACTIVE_PROJECT_PATH` is missing/invalid:** show:
```
Active Project: (not set)
```

```bash
ls -d "$PROJECTS_ROOT"/*/ 2>/dev/null
```

**If no projects:**
```
No active projects.

Start a new project:
  oat-project-new - Create a spec-driven project scaffold
  oat-project-quick-start - Start a quick workflow project
  oat-project-import-plan - Import an external markdown plan into OAT
```
**Continue to Step 6 (show available skills).**

### Step 4: For Each Project, Show Status

Read `{project}/state.md` frontmatter:
- `oat_phase` - Current phase
- `oat_phase_status` - in_progress or complete
- `oat_workflow_mode` - spec-driven | quick | import
- `oat_blockers` - Any blockers
- `oat_hill_checkpoints` - Configured gates (e.g., `["discovery", "spec", "design"]`)
- `oat_hill_completed` - Completed HiLL checkpoints

**Display format:**
```
📁 {project-name}
   Active: {yes/no}
   Mode: {oat_workflow_mode}
   Phase: {oat_phase} ({oat_phase_status})
   HiLL Gates: {oat_hill_checkpoints}
   Completed: {oat_hill_completed as checkmarks}
   HiLL Pending: {yes/no for current phase}
   Blockers: {oat_blockers or "None"}
   Next: {recommended_skill}
```

### Step 5: Determine Next Skill

Based on project state, recommend next action.

Read `oat_workflow_mode` from `state.md` frontmatter:
- `spec-driven` (default if missing)
- `quick`
- `import`

Read `oat_execution_mode` from `state.md` frontmatter:
- `single-thread` (default if missing)
- `subagent-driven`

**HiLL override (apply before phase routing):**
- If current `oat_phase` is listed in `oat_hill_checkpoints` **and** not listed in `oat_hill_completed`, the phase's HiLL gate is still pending.
- In that case, do **not** advance to the next phase even if `oat_phase_status: complete`.
- Recommend continuing the current phase skill to capture explicit approval:
  - discovery gate pending -> `oat-project-discover`
  - spec gate pending -> `oat-project-spec`
  - design gate pending -> `oat-project-design`

Routing matrix by mode:

**Spec-Driven mode (`oat_workflow_mode: spec-driven`):**

| oat_phase | oat_phase_status | Next Skill |
|-----------|------------------|------------|
| discovery | in_progress | Continue `oat-project-discover` |
| discovery | complete | `oat-project-spec` |
| spec | in_progress | Continue `oat-project-spec` |
| spec | complete | `oat-project-design` |
| design | in_progress | Continue `oat-project-design` |
| design | complete | `oat-project-plan` |
| plan | in_progress | Continue `oat-project-plan` |
| plan | complete | `oat-project-subagent-implement` when `oat_execution_mode: subagent-driven`, otherwise `oat-project-implement` |
| implement | in_progress | Continue `oat-project-subagent-implement` when `oat_execution_mode: subagent-driven`, otherwise `oat-project-implement` |
| implement | complete | Ready for final review / PR |

**Quick mode (`oat_workflow_mode: quick`):**

| oat_phase | oat_phase_status | Next Skill |
|-----------|------------------|------------|
| discovery | in_progress | Continue `oat-project-discover` |
| discovery | complete | `oat-project-plan` |
| plan | in_progress | Continue `oat-project-plan` |
| plan | complete | `oat-project-subagent-implement` when `oat_execution_mode: subagent-driven`, otherwise `oat-project-implement` |
| implement | in_progress | Continue `oat-project-subagent-implement` when `oat_execution_mode: subagent-driven`, otherwise `oat-project-implement` |
| implement | complete | Ready for final review / PR |

**Import mode (`oat_workflow_mode: import`):**

| oat_phase | oat_phase_status | Next Skill |
|-----------|------------------|------------|
| plan | in_progress | Continue `oat-project-import-plan` |
| plan | complete | `oat-project-subagent-implement` when `oat_execution_mode: subagent-driven`, otherwise `oat-project-implement` |
| implement | in_progress | Continue `oat-project-subagent-implement` when `oat_execution_mode: subagent-driven`, otherwise `oat-project-implement` |
| implement | complete | Ready for final review / PR |

**If blockers exist:**
```
⚠️  Blocker: {blocker description}

Address blocker before continuing.
```

Execution-mode note:
- Keep `oat_ready_for` in `plan.md` canonical (`oat-project-implement`).
- Runtime routing at plan completion is controlled by `oat_execution_mode` in `state.md`.

### Step 6: Show Available Skills

```
OAT Workflow Skills:

Knowledge:
  oat-repo-knowledge-index             - Generate/refresh codebase knowledge base

Workflow:
  oat-project-quick-start       - Start a quick workflow (discover -> plan -> implement)
  oat-project-import-plan       - Import an external markdown plan and normalize plan.md
  oat-project-promote-spec-driven - Promote quick/import project to spec-driven lifecycle
  oat-project-discover          - Start discovery phase (requirements gathering)
  oat-project-spec              - Create specification from discovery
  oat-project-design            - Create technical design from spec
  oat-project-plan              - Create implementation plan from design (spec-driven mode)
  oat-project-implement         - Execute implementation plan
  oat-project-subagent-implement - Execute implementation plan with subagent orchestration

Status:
  oat-project-progress          - Check project progress (this skill)

Reviews:
  oat-project-review-provide    - Request a fresh-context code/artifact review (writes review artifact)
  oat-project-review-receive    - Convert review findings into plan tasks (gap closure)

PRs:
  oat-project-pr-progress       - Create a progress PR description (phase-scoped)
  oat-project-pr-final          - Create the final project PR description (after final review)
```

### Step 7: Output Summary

Combine all information:

```
OAT Progress Report
===================

Knowledge Base:
  Status: {✓ Fresh / ⚠️ Stale / ❌ Missing}
  Generated: {date}
  Changes since: {N} files

Active Projects:
{project summaries}

Next Step: {recommendation}
```

### Step 8: Regenerate Dashboard

After all progress checks, regenerate the repo state dashboard:

```bash
oat state refresh
```

## Success Criteria

- Knowledge base status clearly shown
- All active projects listed with status
- Clear next-step recommendations
- Blockers highlighted prominently
