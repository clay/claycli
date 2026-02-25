---
name: oat-project-review-receive-remote
version: 1.0.0
description: Use when processing GitHub PR review comments within project context. Fetches PR comments, creates plan tasks, and updates project artifacts.
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion
---

# Project Remote Review Receive

Fetch unresolved GitHub PR feedback and convert it into review-fix tasks inside the active OAT project.

## Prerequisites

- Active OAT project with `plan.md` and `implementation.md`.
- `npx agent-reviews` is available.
- GitHub authentication configured (`GITHUB_TOKEN`, `.env.local`, or `gh` auth).

## Mode Assertion

**OAT MODE: Review Receive**

**Purpose:** In project scope, ingest remote PR feedback, triage findings, create executable plan tasks, and update implementation state for resumable fix execution.

**BLOCKED Activities:**
- No direct code implementation in this mode.
- No silent finding deferrals/dismissals.
- No plan task ID reuse or re-numbering.

**ALLOWED Activities:**
- Active project resolution.
- Remote PR comment ingestion/classification.
- Findings triage.
- Plan/implementation/state bookkeeping updates.
- Optional GitHub replies tied to dispositions.

**Self-Correction Protocol:**
If you catch yourself:
- Making code changes in receive mode -> STOP and return to triage/bookkeeping only.
- Reusing existing task IDs instead of generating next sequential `pNN-tNN` -> STOP and recalculate the next available ID.
- Posting GitHub replies without explicit user approval -> STOP and present reply content for confirmation first.

## Progress Indicators (User-Facing)

Print this banner once at start:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 OAT ▸ PROJECT REMOTE REVIEW RECEIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use step indicators:
- `[1/8] Resolving project...`
- `[2/8] Resolving PR...`
- `[3/8] Fetching comments...`
- `[4/8] Classifying findings...`
- `[5/8] Triaging findings...`
- `[6/8] Updating project artifacts...`
- `[7/8] Enforcing cycle limit...`
- `[8/8] Posting replies (optional)...`

## Findings Model

Normalize findings as:

```yaml
finding:
  id: "C1" | "I1" | "M1" | "m1"
  severity: critical | important | medium | minor
  title: string
  file: string | null
  line: number | null
  body: string
  fix_guidance: string | null
  source: github_pr
  source_ref: string
  comment_id: string | number
```

## Process

### Step 0: Resolve Active Project

```bash
PROJECT_PATH=$(oat config get activeProject 2>/dev/null || true)
PROJECTS_ROOT="${OAT_PROJECTS_ROOT:-$(oat config get projects.root 2>/dev/null || echo ".oat/projects/shared")}"
PROJECTS_ROOT="${PROJECTS_ROOT%/}"
```

Validation:
- `PROJECT_PATH` exists
- `plan.md` exists
- `implementation.md` exists
- `state.md` exists

If missing, ask user to choose/fix active project before continuing.

### Step 1: Resolve PR Number

Resolution order:
1. `--pr <N>` from `$ARGUMENTS`
2. auto-detect via `agent-reviews`

Confirm resolved PR number with user.

### Step 2: Fetch Unresolved PR Comments

```bash
npx agent-reviews --json --unresolved --pr <N>
```

If no unresolved comments:
- Report clean status.
- Update `plan.md` review row for scoped entry to `passed` when applicable.
- Stop.

### Step 3: Classify and Normalize Findings

For each comment:
- capture `type`, `path`, `line`, `url`, and comment body.
- classify severity using 4-tier model.
- use review state (e.g., `CHANGES_REQUESTED`) as a hint, not a hard override.
- assign stable IDs by severity bucket (`C`, `I`, `M`, `m`).

### Step 4: Present Findings Overview and Triage

Before prompting dispositions, print:
- counts per severity
- compact register (`id`, `title`, `file:line`, `source_ref`)

Disposition options:
- `convert` (default for critical/important/medium)
- `defer` (default for minor)
- `dismiss`

Require rationale for `defer`/`dismiss`.

### Step 5: Convert Findings to Plan Tasks

For each converted finding:
- Determine next stable `pNN-tNN` IDs from current plan.
- Create tasks using heading format:
  - `### Task pNN-tNN: (review) <title>`
- Include standard 4-step execution structure:
  - analyze failure context
  - implement fix
  - verify targeted behavior
  - verify project commands from plan
- Use commit template:
  - `fix(pNN-tNN): <description>`

### Step 6: Update Project Artifacts

Update `plan.md`:
- Append inserted review-fix task sections in correct phase order.
- Update `## Reviews` row for remote scope:
  - status `fixes_added` when tasks were added
  - status `passed` when no actionable findings remain
  - date set to today
  - artifact `github-pr #<N>`
- Update `## Implementation Complete` totals.

Update `implementation.md`:
- Add "Remote Review Received" section with:
  - date
  - PR number
  - severity counts
  - new task IDs
  - deferred/dismissed notes
- Set `oat_current_task_id` to first new review-fix task ID when tasks were added.
- If no new tasks: keep current task pointer unchanged or set `null` if all work is complete.

Update `state.md`:
- `oat_phase: implement`
- `oat_phase_status: in_progress`
- `oat_current_task: <first-new-task-id|null>`

### Step 7: Enforce Review Cycle Limit and Route Next Action

Track review cycles for the same scope.
- Maximum: 3 receive cycles.
- If limit reached, block and ask user whether to escalate scope or resolve manually.

Route next action:
- If tasks added: `oat-project-implement`
- If no tasks and review passed: continue toward finalization/PR flow

### Step 8: Optional GitHub Replies

Ask user whether to reply to processed comments.
If yes:
- Convert: `npx agent-reviews --reply <id> "Tracking as task pNN-tNN"`
- Defer: `npx agent-reviews --reply <id> "Deferred: <reason>"`
- Dismiss: `npx agent-reviews --reply <id> "Won't fix: <reason>"`

Never post replies without explicit user approval.

## Output Contract

At completion, report:
- project path
- PR number
- findings by severity
- converted/deferred/dismissed counts
- created task IDs (if any)
- updated review status
- next recommended action

## Success Criteria

- Active project resolved and validated.
- Remote PR feedback fetched and normalized.
- Findings triaged with explicit dispositions.
- Plan tasks created with stable IDs when needed.
- `plan.md`, `implementation.md`, and `state.md` updated consistently.
- Review cycle guard and next-action routing applied.
