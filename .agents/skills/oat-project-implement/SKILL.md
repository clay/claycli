---
name: oat-project-implement
version: 1.0.0
description: Use when plan.md is ready for execution. Implements plan tasks sequentially with TDD discipline and state tracking.
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash(git:*), Glob, Grep, AskUserQuestion
---

# Implementation Phase

Execute the implementation plan task-by-task with full state tracking.

## Prerequisites

**Required:** Complete implementation plan. If missing, run the `oat-project-plan` skill first.

## Mode Assertion

**OAT MODE: Implementation**

**Purpose:** Execute plan tasks with TDD discipline, track progress, handle blockers.

## Progress Indicators (User-Facing)

When executing this skill, provide lightweight progress feedback so the user can tell what’s happening after they confirm.

- Print a phase banner once at start using horizontal separators, e.g.:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OAT ▸ IMPLEMENT
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- For each task, announce a compact header before doing work:
  - `OAT ▸ IMPLEMENT {task_id}: {task_name}`
- Before multi-step “bookkeeping” work (updating artifacts/state, verification, committing, dashboard refresh), print 2–5 short step indicators, e.g.:
  - `[1/4] Updating implementation.md + state.md…`
  - `[2/4] Running verification…`
  - `[3/4] Committing…`
  - `[4/4] Refreshing dashboard…`
- For long-running operations (tests/lint/type-check/build, reviews, large diffs), print a start line and a completion line (duration optional).
- Keep it concise; don’t print a line for every shell command.

**BLOCKED Activities:**
- No skipping tasks
- No changing plan structure
- No scope expansion

**ALLOWED Activities:**
- Executing tasks in order
- Making minor adaptations within task scope
- Logging decisions and issues
- Marking blockers for user review

**Self-Correction Protocol:**
If you catch yourself:
- Skipping ahead in tasks → STOP (execute in order)
- Expanding scope → STOP (log as "deferred")
- Changing plan structure → STOP (update plan.md first)

**Recovery:**
1. Acknowledge the deviation
2. Return to current task
3. Document in implementation.md

## Process

### Step 0: Resolve Active Project

OAT stores active project context in `.oat/config.local.json` (`activeProject`, local-only).

```bash
PROJECT_PATH=$(oat config get activeProject 2>/dev/null || true)
PROJECTS_ROOT="${OAT_PROJECTS_ROOT:-$(oat config get projects.root 2>/dev/null || echo ".oat/projects/shared")}"
PROJECTS_ROOT="${PROJECTS_ROOT%/}"
```

**If `PROJECT_PATH` is missing/invalid:**
- Ask the user for `{project-name}`
- Set `PROJECT_PATH` to `${PROJECTS_ROOT}/{project-name}`
- Write it for future phases:
  ```bash
  mkdir -p .oat
  oat config set activeProject "$PROJECT_PATH"
  ```

**If `PROJECT_PATH` is valid:** derive `{project-name}` as the directory name (basename of the path).

### Step 0.5: Execution Mode Redirect Guard

Read execution mode from `"$PROJECT_PATH/state.md"` frontmatter:

```bash
EXEC_MODE=$(grep "^oat_execution_mode:" "$PROJECT_PATH/state.md" 2>/dev/null | awk '{print $2}')
EXEC_MODE="${EXEC_MODE:-single-thread}"
```

If `EXEC_MODE` is `subagent-driven`:
- Tell the user: `Execution mode is subagent-driven. Use oat-project-subagent-implement instead.`
- STOP (do not proceed with sequential implementation)

### Step 1: Check Plan Complete

```bash
cat "$PROJECT_PATH/plan.md" | head -10 | grep "oat_status:"
```

**Required frontmatter:**
- `oat_status: complete`
- `oat_ready_for: oat-project-implement`

**If not complete:** Block and ask user to finish plan first.

### Step 2: Read Plan Document

Read `"$PROJECT_PATH/plan.md"` completely to understand:
- All phases and tasks
- File changes per task
- Verification commands
- Commit messages

### Step 2.5: Confirm Plan HiLL Checkpoints

Read `oat_plan_hill_phases` from `"$PROJECT_PATH/plan.md"` frontmatter and validate it.

- **Valid format:** JSON-like array of phase IDs (e.g., `["p01","p03"]`)
- **Invalid format examples:** scalar string, malformed array, unknown phase IDs

Determine whether this is a first implementation run:
- If `"$PROJECT_PATH/implementation.md"` does not exist, treat as first run.
- If it exists but still has template placeholders and no completed task evidence, treat as first run.

Prompt behavior:
- **If `oat_plan_hill_phases` is missing/empty/invalid:** ask user to confirm checkpoint phases before any task execution.
- **If first run and `oat_plan_hill_phases` is valid:** ask user to confirm keep/change.
- **If resuming and `oat_plan_hill_phases` is valid:** do not re-ask; print active checkpoint config and continue.

When user confirms/changes:
- Update `"$PROJECT_PATH/plan.md"` frontmatter `oat_plan_hill_phases` to the confirmed value before executing tasks.
- Keep the value stable for the rest of the run unless the user explicitly requests a change.

### Step 3: Check Implementation State

Check if implementation already started:

```bash
cat "$PROJECT_PATH/implementation.md" 2>/dev/null | head -20
```

**If exists and has progress:**
- Read `oat_current_task_id` from frontmatter (e.g., "p01-t03")
- Validate the task pointer:
  - If `oat_current_task_id` points at a task already marked `completed` in the body, advance to the **next incomplete** task (first `pending` / `in_progress` / `blocked` entry).
  - If all tasks are completed, skip ahead to finalization (Step 11+).
- Resume from the resolved task
- Ask user: "Resume from {task_id}, or start fresh (overwrite implementation.md)?"

**Stale-state reconciliation (approval required):**
- Before executing tasks, cross-check `plan.md` Reviews status with `implementation.md` + `state.md`.
- If `plan.md` shows a scope as `passed` but `implementation.md` / `state.md` still says "awaiting re-review" (or leaves `oat_current_task_id` / `oat_current_task` as `null` while future plan tasks are still incomplete), treat this as bookkeeping drift.
- Resolve the next task from plan order (first incomplete non-review task after the passed scope), then ask:
  - "Detected bookkeeping drift: review is passed in plan.md, but state artifacts still show awaiting re-review. Update artifacts and continue from {next_task_id}?"
- Only if the user approves:
  - Update `implementation.md` frontmatter `oat_current_task_id: {next_task_id}`
  - Update `state.md` frontmatter `oat_current_task: {next_task_id}` and refresh stale "awaiting re-review" wording
  - Update implementation review notes "Next" guidance to continue implementation (not re-review)
- If the user declines:
  - Do not auto-edit bookkeeping; pause and ask whether to proceed manually or stop.

**If doesn't exist:**
- Initialize from template (Step 4)

**Important:** Never overwrite an existing `implementation.md` without explicit user confirmation (and warn that draft logs will be lost).

### Step 4: Initialize Implementation Document

Copy template: `.oat/templates/implementation.md` → `"$PROJECT_PATH/implementation.md"`

Update frontmatter:
```yaml
---
oat_status: in_progress
oat_ready_for: null
oat_blockers: []
oat_last_updated: {today}
oat_current_task_id: p01-t01  # Stable task ID from plan
---
```

Initialize project state so other skills (e.g., `oat-project-progress`) reflect that implementation has started:
- In `"$PROJECT_PATH/state.md"` frontmatter:
  - `oat_phase: implement`
  - `oat_phase_status: in_progress`
  - `oat_current_task: p01-t01`

### Step 5: Execute Current Task

For the current task in plan.md:

**5a. Announce task:**
```
Starting {task_id}: {Task Name}
Files: {file list}
```

**5b. Follow steps exactly:**
- Read each step from plan
- Execute as specified
- Run verification commands

**5c. Apply TDD discipline:**
1. Write test first (if applicable)
2. Run tests → expect red
3. Write implementation
4. Run tests → expect green
5. Refactor if needed

**5d. Handle issues:**
- If step unclear → ask user
- If verification fails → debug and retry
- If blocked → mark task as blocked, note reason

### Step 6: Commit Task

After task verification passes:

```bash
git add {files from plan}
git commit -m "{commit message from plan}"
```

Store commit SHA for implementation.md.

### Step 7: Update Implementation State

After each task:

**Update frontmatter:**
```yaml
oat_current_task_id: {next_task_id}  # e.g., p01-t02
oat_last_updated: {today}
```

**Update task entry:**
```markdown
### Task {task_id}: {Task Name}

**Status:** completed
**Commit:** {sha}

**Outcome (required):**
- {2-5 bullets describing what materially changed}

**Files changed:**
- `{path}` - {why}

**Verification:**
- Run: `{command(s)}`
- Result: {pass/fail + notes}

**Notes / Decisions:**
- {gotchas, trade-offs, design deltas}
```

**Update progress overview table.**

Keep project state in sync after each task (recommended source of truth for “where are we?” across sessions):
- Update `"$PROJECT_PATH/state.md"` frontmatter:
  - `oat_phase: implement`
  - `oat_phase_status: in_progress`
  - `oat_current_task: {next_task_id}`
  - `oat_last_commit: {sha}`

**If executing review-generated tasks** (task title prefixed with `(review)`):
- Ensure `implementation.md` stays accurate:
  - The “Review Received” section reflects whether findings were deferred vs converted to tasks
  - The “Next” line is updated once review fix tasks are complete (don’t leave “Next: execute fix tasks” after they’re done)
- Keep `plan.md` internally consistent:
  - If `## Implementation Complete` contains phase/task totals, update totals when review fix tasks are added (via `oat-project-review-receive`) or removed.
- Review status lifecycle:
  - When review-generated fix tasks are added, the Reviews table should be `fixes_added`.
  - After all fix tasks are implemented, update the Reviews table to `fixes_completed` (not `passed`).
  - Only set `passed` after a re-review is run and processed via `oat-project-review-receive` with no Critical/Important findings.

**Review-fix completion bookkeeping (required):**
- When you complete the last outstanding review-fix task:
  1. Update the relevant `plan.md` `## Reviews` row from `fixes_added` → `fixes_completed` and set Date to `{today}`.
     - If multiple rows are `fixes_added`, ask the user which scope you just addressed (or choose the matching phase if obvious).
  2. Update `plan.md` `## Implementation Complete` totals (phase counts + total tasks) so summaries reflect the additional fix work.
  3. Update `implementation.md` so it’s unambiguous that tasks are complete and the project is awaiting re-review:
     - `oat_current_task_id: null` (reviews are not tasks)
     - “Next” guidance should say “request re-review” (not “execute fix tasks”).
  4. Update `{PROJECT_PATH}/state.md` to reflect the correct “awaiting re-review” posture:
     - `oat_phase: implement`
     - `oat_phase_status: in_progress` (until the re-review passes)
     - `oat_current_task: null`

### Step 8: Check Plan Phase Completion

When all tasks in current plan phase complete (e.g., all p01-* tasks done):

**Update frontmatter:**
```yaml
oat_current_task_id: {first_task_of_next_phase}  # e.g., p02-t01
```

**Plan phase checkpoint:**
At the end of each plan phase (p01, p02, etc.), check `oat_plan_hill_phases` in plan.md:

- **If `oat_plan_hill_phases` is empty or missing:** Stop at every phase boundary (default behavior)
- **If `oat_plan_hill_phases` has values:** Only stop at listed phases (e.g., `["p01", "p04"]`)
  - To stop only at the end of implementation, set it to the **last plan phase ID** (e.g., `["p03"]`).

When stopping:
- Output phase summary (tasks completed, commits made)
- Ask user: "Phase {N} ({phase_name}) complete. Continue to next phase?"
- Wait for user approval before proceeding to next plan phase

**Restart safety (required):**
- At the end of each task and at each phase boundary, ensure `implementation.md` is persisted and internally consistent:
  - `oat_current_task_id` points at the next task to do (or `null` when complete)
  - Phase status sections match the progress overview table
  - The implementation log reflects what was actually completed

**Phase summaries (required):**
- When a plan phase completes (p01, p02, etc.), update the “Phase Summary” section in `implementation.md` for that phase:
  - Outcome (behavior-level)
  - Key files touched (paths)
  - Verification run
  - Notable decisions/deviations

**Note on HiLL types:**
- **Workflow HiLL** (`oat_hill_checkpoints` in state.md): Gates between workflow phases (discovery → spec → design → plan → implement). Checked by oat-project-progress router.
- **Plan phase checkpoints** (`oat_plan_hill_phases` in plan.md): Gates at plan phase boundaries during implementation. Default: stop at every phase. Configure to stop only at specific phases.

### Step 9: Repeat Until Complete

Continue Steps 5-8 until all plan phases complete.

**Batch execution:**
- Default: Execute tasks one at a time
- If user requests: Execute N tasks before checking in
- Stop at configured plan phase boundaries for review

### Step 10: Handle Blockers

If a task cannot be completed:

**Mark as blocked:**
```yaml
oat_blockers:
  - task_id: {task_id}  # e.g., p01-t03
    reason: "{description}"
    since: {date}
```

**Update task status:**
```markdown
### Task {task_id}: {Task Name}

**Status:** blocked
**Blocker:** {description}
```

**Notify user:**
```
Task {task_id} blocked: {reason}

Options:
1. Resolve blocker and continue
2. Skip task (mark as deferred)
3. Modify plan to address blocker
```

### Step 11: Mark Implementation Complete

When all plan tasks are complete (i.e., there is no next incomplete `pNN-tNN` task):

**Update “Final Summary” (required):**
- Before requesting final review / running `oat-project-pr-final`, update the `## Final Summary (for PR/docs)` section in `"$PROJECT_PATH/implementation.md"`:
  - What shipped (capabilities, behavior-level)
  - Key files/modules touched
  - Verification performed (tests/lint/typecheck/build/manual)
  - Design deltas (if any)
- This should reflect **what was actually implemented**, including any deviations from design and any review-fix work.

Update frontmatter:
```yaml
---
oat_status: complete
oat_ready_for: null
oat_blockers: []
oat_last_updated: {today}
oat_current_task_id: null
---
```

**Important:** `oat_current_task_id` should never point at an already-completed task. If all tasks are done, set it to `null` and proceed to the final review gate.

### Step 12: Update Project State

Update `"$PROJECT_PATH/state.md"` so other skills reflect task completion and review gating:

**Frontmatter updates:**
- `oat_current_task: null`
- `oat_last_commit: {final_commit_sha}`
- `oat_blockers: []`
- `oat_phase: implement`
- `oat_phase_status: in_progress` (until final review passes)
- **If** `"implement"` is in `oat_hill_checkpoints`: append `"implement"` to `oat_hill_completed` array

**Note:** Only append to `oat_hill_completed` when the phase is configured as a HiLL gate.

Update content:
```markdown
## Current Phase

Implementation - Tasks complete; awaiting final review.

## Progress

- ✓ Discovery complete
- ✓ Specification complete
- ✓ Design complete
- ✓ Plan complete
- ✓ Implementation tasks complete
- ⧗ Awaiting final review
```

### Step 13: Final Verification

Run project-wide verification:

```bash
# Run tests
pnpm test

# Run lint
pnpm lint

# Run type check
pnpm type-check

# Run build
pnpm build
```

All must pass before proceeding.

### Step 14: Trigger Final Review

**At the final plan phase boundary, a code review is required before PR.**

Check if final review already completed (preferred source of truth: plan.md Reviews table):
```bash
FINAL_ROW=$(grep -E "^\\|\\s*final\\s*\\|" "$PROJECT_PATH/plan.md" 2>/dev/null | head -1)
echo "$FINAL_ROW"
```

**If final review row exists and status is `passed`:**
- Example row:
  - `| final | code | passed | 2026-01-28 | reviews/final-review-2026-01-28.md |`
- Check:
  ```bash
  echo "$FINAL_ROW" | grep -qE "^\\|\\s*final\\s*\\|.*\\|\\s*passed\\s*\\|" && echo "passed"
  ```
- Skip to Step 15 (PR prompt)

**If final review is not marked `passed`:**
- Tell user: "All tasks complete. Final review required before PR."
- Offer review options (3-tier capability model):

```
Implementation complete. Final review required.

Review options:
1. Run review in this session via a subagent (recommended if provider supported)
2. Run review in a fresh session and return to this session to receive review
3. Run review inline

To run in a separate session use: oat-project-review-provide code final
```

**After user chooses:**
- If subagent (option 1): Agent spawns the review via Task tool — no command needed from user
- If fresh session (option 2): User runs `oat-project-review-provide code final` in a separate session, then returns here
- If inline (option 3): Agent executes the review directly per oat-project-review-provide skill
- After review: User runs `oat-project-review-receive` to process findings
- If Critical/Important findings: Fix tasks added, re-run the `oat-project-implement` skill
- Loop until final review passes (max 3 cycles per oat-project-review-receive)

**After final review is marked `passed`:**
- Update `"$PROJECT_PATH/state.md"` frontmatter:
  - `oat_phase: implement`
  - `oat_phase_status: complete`
  - Append `"implement"` to `oat_hill_completed` (only if configured as a HiLL gate)
- Update state content to “Implementation complete”.
- Update `"$PROJECT_PATH/plan.md"`:
  - Set the `final` review row status to `passed` (if not already)
  - Ensure `## Implementation Complete` totals reflect any review fix tasks that were added
- Update `"$PROJECT_PATH/implementation.md"`:
  - Ensure `oat_current_task_id: null`
  - Ensure the “Review Received” section reflects completed fixes and points to the next action (PR) rather than “execute fix tasks”

### Step 15: Prompt for PR

After final review passes (no Critical/Important findings):

```
Final review passed for {project-name}.

All tasks complete and verified. Ready to create PR.

Options:
1. Open PR now (will generate PR description from OAT artifacts)
2. Exit (create PR manually later)

Choose:
```

**If user chooses to open PR:**
- Prefer using the `oat-project-pr-final` skill to generate a final PR description from OAT artifacts:
  ```
  oat-project-pr-final
  ```
- If the environment cannot run skills for any reason, fall back to manual PR creation:
  ```
  To create PR manually:
  1. Push branch: git push -u origin {branch}
  2. Create PR with summary from implementation.md
  3. Reference: spec.md, design.md for context
  ```

### Step 16: Output Summary

```
Implementation complete for {project-name}.

Summary:
- Phases: {N} completed
- Tasks: {N} completed
- Commits: {N} created

Final verification:
- Tests: ✓ passing
- Lint: ✓ clean
- Types: ✓ valid
- Build: ✓ success

Final review:
- Status: ✓ passed
- Artifact: reviews/final-review-{date}.md

Next: Create PR or run the oat-project-pr-final skill (when available)
```

## Success Criteria

- All tasks executed in order
- TDD discipline followed
- Each task has a commit
- Implementation.md tracks all progress
- Final verification passes
- Final review passes (no Critical/Important findings)
- No unresolved blockers
