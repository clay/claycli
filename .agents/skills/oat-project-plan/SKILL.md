---
name: oat-project-plan
version: 1.0.0
description: Use when design.md is complete and executable implementation tasks are needed. Breaks design into bite-sized TDD tasks in canonical plan.md format.
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash(git:*), Glob, Grep, AskUserQuestion
---

# Planning Phase

Transform detailed design into an executable implementation plan with bite-sized tasks.

## Prerequisites

This skill is the plan authoring path for **spec-driven** projects only. Quick and import modes have dedicated entry skills that produce `plan.md` directly.

Read `oat_workflow_mode` from `{PROJECT_PATH}/state.md` (default: `spec-driven`):

- **`spec-driven`**: Complete design document required (`design.md` with `oat_status: complete`). If missing, run the `oat-project-design` skill first. Proceed with planning.
- **`quick`**: **Stop.** Plan is already produced by the quick workflow. Tell the user: "Plan already produced by quick workflow. Run `oat-project-implement` to begin execution."
- **`import`**: **Stop.** If a normalized `plan.md` exists, tell the user: "Imported plan is ready. Run `oat-project-implement` to begin execution." If no `plan.md` exists, tell the user: "Run `oat-project-import-plan` to import and normalize the external plan first."

## Plan Format Contract

When creating or editing `plan.md`, follow `oat-project-plan-writing` canonical format rules. This includes stable task IDs (`pNN-tNN`), required sections (`## Reviews`, `## Implementation Complete`, `## References`), required frontmatter keys (`oat_plan_source`, `oat_plan_hill_phases`, `oat_status`, `oat_ready_for`), and review table preservation rules.

## Mode Assertion

**OAT MODE: Planning**

**Purpose:** Break design into executable tasks with exact files, signatures/test cases, and commands. Spec-driven only — quick and import modes stop-and-route.

## Progress Indicators (User-Facing)

When executing this skill, provide lightweight progress feedback so the user can tell what’s happening after they confirm.

- Print a phase banner once at start using horizontal separators, e.g.:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OAT ▸ PLAN
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Before multi-step work (drafting/finalizing/committing), print 2–5 short step indicators, e.g.:
  - `[1/4] Reading design + context…`
  - `[2/4] Drafting phases + tasks…`
  - `[3/4] Finalizing plan + rollups…`
  - `[4/4] Updating state + committing…`
- For any operation that may take noticeable time (e.g., reading large artifacts), print a start line and a completion line (duration optional).
- Keep it concise; don’t print a line for every shell command.

**BLOCKED Activities:**
- No implementation code
- No changing design decisions
- No scope expansion

**ALLOWED Activities:**
- Breaking design into phases
- Creating bite-sized tasks (2-5 minutes each)
- Specifying exact files and interface signatures
- Defining test cases and verification commands
- Planning test-first approach

**Self-Correction Protocol:**
If you catch yourself:
- Writing actual implementation → STOP
- Changing architecture decisions → STOP (send back to design)
- Adding new features → STOP (flag for next cycle)
- Needing implementation details that aren't covered by the design → STOP (ask the user whether to update the design, then re-run the `oat-project-plan` skill)

**Recovery:**
1. Acknowledge the deviation
2. Return to planning language ("Task N will...")
3. Keep implementation details at pseudocode/interface level
4. Keep code blocks short (signatures/outlines only)

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

### Step 1: Determine Workflow Mode and Route

```bash
WORKFLOW_MODE=$(grep "^oat_workflow_mode:" "$PROJECT_PATH/state.md" 2>/dev/null | awk '{print $2}')
WORKFLOW_MODE="${WORKFLOW_MODE:-spec-driven}"
```

**Mode: `quick`** — **STOP.** Print:
```
⚠️  This project uses quick mode. Plan is produced by the quick workflow.
    Run the `oat-project-implement` skill to begin execution.
```
Exit skill.

**Mode: `import`** — **STOP.** Check if `"$PROJECT_PATH/plan.md"` exists:
- If yes: Print: "Imported plan is ready. Run `oat-project-implement` to begin execution."
- If no: Print: "Run `oat-project-import-plan` to import and normalize the external plan first."
Exit skill.

**Mode: `spec-driven`** — Continue to Step 2.

### Step 2: Check Design Complete

```bash
cat "$PROJECT_PATH/design.md" | head -10 | grep "oat_status:"
```

Required frontmatter: `oat_status: complete`, `oat_ready_for: oat-project-plan`.
If not complete: Block and ask user to finish design first.

### Step 3: Read Design Document

Read `"$PROJECT_PATH/design.md"` completely to understand:
- Architecture overview and components
- Data models and schemas
- API designs and interfaces
- Implementation phases from design
- Testing strategy
- Security and performance considerations

### Step 4: Read Knowledge Base for Context

Read for implementation context:
- `.oat/repo/knowledge/conventions.md` - Code patterns to follow
- `.oat/repo/knowledge/testing.md` - Testing patterns
- `.oat/repo/knowledge/stack.md` - Available tools and dependencies

### Step 5: Initialize Plan Document

Check whether a plan already exists at `"$PROJECT_PATH/plan.md"`.

**If `"$PROJECT_PATH/plan.md"` exists:**
- Read it first (treat it as a draft).
- Ask the user:
  - **Resume** (default): continue editing the existing plan in place
  - **View**: show the existing plan and stop
  - **Overwrite**: replace with a fresh copy of the template (warn about losing draft edits)
- If resuming: ensure the document contains the required sections from the template (at minimum: `## Reviews`, `## Implementation Complete`, `## References`). If any are missing, add them using the template headings (do not delete existing content).

**If `"$PROJECT_PATH/plan.md"` does not exist:**
- Copy template: `.oat/templates/plan.md` → `"$PROJECT_PATH/plan.md"`

Update frontmatter:
```yaml
---
oat_status: in_progress
oat_ready_for: null
oat_blockers: []
oat_last_updated: {today}
oat_phase: plan
oat_phase_status: in_progress
oat_generated: false
oat_template: false
---
```

### Step 6: Define Phases

Break design implementation phases into plan phases.

**Phase structure:**
- Each phase delivers a complete, testable milestone
- Phases should be 1-3 days of work
- Later phases can depend on earlier phases
- End each phase with verification

### Step 7: Break Into Tasks

For each phase, create bite-sized tasks.

**Task characteristics:**
- 2-5 minutes to complete
- Single responsibility
- Clear verification
- Atomic commit

**No implementation code (important):**
- Prefer **pseudocode**, **interfaces**, and **bullet steps** over full implementations.
- If the task is a shell script, include **function names + responsibilities** and only minimal “shape” snippets (aim for <10 lines per code block).
- If a longer snippet would be useful, replace internals with `{...}` placeholders and document behavior/edge cases in prose.

**Task IDs:** Use stable IDs in format `p{phase}-t{task}` (e.g., `p01-t03`).

**Task template:**
```markdown
### Task p{NN}-t{NN}: {Task Name}

**Files:**
- Create: `{path/to/new.ts}`
- Modify: `{path/to/existing.ts}`

**Step 1: Write test (RED)**
{Test code or test case description}

**Step 2: Implement (GREEN)**
{Interface signatures or implementation outline}

**Step 3: Refactor**
{Optional cleanup}

**Step 4: Verify**
Run: `{command}`
Expected: {output}

**Step 5: Commit**
```bash
git add {files}
git commit -m "feat(p{NN}-t{NN}): {description}"
```
```

### Step 8: Apply TDD Discipline

For each task that involves code:

1. **Test first:** Write test before implementation
2. **Red:** Verify test fails
3. **Green:** Implement minimal code to pass
4. **Refactor:** Clean up while tests pass

**Task order for features:**
1. Write test file
2. Run tests (red)
3. Write implementation
4. Run tests (green)
5. Commit

### Step 9: Specify Exact Details

For each task, include:
- **Files:** Exact paths for create/modify/delete
- **Signatures:** Interface definitions, function signatures, type declarations
- **Test cases:** Test file paths and test descriptions (pseudocode OK for test bodies)
- **Commands:** Exact verification commands
- **Commit:** Conventional commit message with task ID (e.g., `feat(p01-t03): ...`)

**Avoid:**
- Vague instructions ("update the file")
- Missing verification steps
- Bundled unrelated changes
- Full implementation code (leave that for oat-project-implement)

### Step 10: Update Requirement Index

Go back to spec.md and fill in the "Planned Tasks" column in the Requirement Index:

For each requirement (FR/NFR):
- List the stable task IDs that implement it
- Example: "p01-t03, p02-t01, p02-t05"

This creates traceability: Requirement → Tasks → Implementation

### Step 10.1: Keep Reviews Table Rows

Follow the review table preservation rules from `oat-project-plan-writing`:
- Include both **code** rows (p01/p02/…/final) and **artifact** rows (`spec`, `design`)
- Add additional rows as needed (e.g., p03), but never delete existing rows

**Why stable IDs:** Using `p01-t03` instead of "Task 3" prevents broken references when tasks are inserted or reordered.

### Step 11: Configure Plan Phase Checkpoints

Ask user: "During implementation, should I stop for review at every phase boundary, or only at specific phases?"

**Options:**
- **Every phase** (default): Leave `oat_plan_hill_phases: []` - stop at end of every plan phase
- **Only the end**: Set `oat_plan_hill_phases` to the **last plan phase ID** (e.g., `["p03"]`) - stop only at the end of implementation
- **Specific phases**: Set `oat_plan_hill_phases: ["p01", "p04"]` - only stop at listed phases

Update plan.md frontmatter with user's choice.

**Required plan body update (do not skip):**
- In `## Planning Checklist`, mark:
  - `[x] Confirmed HiLL checkpoints with user`
  - `[x] Set oat_plan_hill_phases in frontmatter`

If `## Planning Checklist` is missing (older plans), add it before finalizing and then check both items.

### Step 12: Review Plan with User

Present plan summary:
- Number of phases
- Tasks per phase
- Key milestones
- HiLL checkpoints configured

Ask: "Does this breakdown make sense? Any tasks missing?"

Iterate until user confirms.

### Step 13: Mark Plan Complete

Before setting `oat_status: complete`, verify:
- `oat_plan_hill_phases` is explicitly set in frontmatter (empty array is valid for "every phase")
- `## Planning Checklist` exists
- both HiLL checklist items are checked (`[x]`)

Update frontmatter:
```yaml
---
oat_status: complete
oat_ready_for: oat-project-implement
oat_blockers: []
oat_last_updated: {today}
---
```

### Step 14: Update Project State

Update `"$PROJECT_PATH/state.md"`:

**Frontmatter updates:**
- `oat_current_task: null`
- `oat_last_commit: {commit_sha_from_step_15}`
- `oat_blockers: []`
- `oat_phase: plan`
- `oat_phase_status: complete`
- **If** `"plan"` is in `oat_hill_checkpoints`: append `"plan"` to `oat_hill_completed` array

**Note:** Only append to `oat_hill_completed` when the phase is configured as a HiLL gate.

Update content:
```markdown
## Current Phase

Planning - Ready for implementation

## Progress

- ✓ Discovery complete
- ✓ Specification complete
- ✓ Design complete
- ✓ Plan complete
- ⧗ Awaiting implementation
```

### Step 15: Commit Plan

```bash
git add "$PROJECT_PATH/"
git commit -m "docs: complete implementation plan for {project-name}

Phases:
- Phase 1: {description} ({N} tasks)
- Phase 2: {description} ({N} tasks)

Total: {N} tasks

Ready for implementation"
```

### Step 16: Output Summary

```
Planning phase complete for {project-name}.

Phases:
- Phase 1: {description} ({N} tasks)
- Phase 2: {description} ({N} tasks)

Total: {N} tasks

Next: Choose your implementation approach:
- oat-project-implement — Sequential task execution (default)
- oat-project-subagent-implement — Parallel worktree execution with autonomous review gates
```

## Success Criteria

- All design components covered by tasks
- Tasks are bite-sized (2-5 minutes)
- TDD discipline applied to code tasks
- Each task has clear verification
- Requirement Index updated with task mappings
- User confirmed plan is complete
