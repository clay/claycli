---
name: oat-project-review-provide
version: 1.0.0
description: Use when completed work in an active OAT project needs a quality gate before merge. Performs a lifecycle-scoped review after a task, phase, or full implementation, unlike oat-review-provide.
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Glob, Grep, Bash(git:*), AskUserQuestion
---

# Request Review

Request and execute a code or artifact review for the current project scope.

## Purpose

Produce an independent review artifact that verifies requirements/design alignment (mode-aware) and code quality.

## Prerequisites

**Required:** Active project with at least one completed task.

## Mode Assertion

**OAT MODE: Review Request**

**Purpose:** Determine review scope and execute a fresh-context review.

## Progress Indicators (User-Facing)

When executing this skill, provide lightweight progress feedback so the user can tell what’s happening after they confirm.

- Print a phase banner once at start using horizontal separators, e.g.:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OAT ▸ PROVIDE REVIEW
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Before multi-step work (scope resolution, file gathering, writing artifact), print 2–5 short step indicators, e.g.:
  - `[1/5] Resolving scope + range…`
  - `[2/5] Collecting files + context…`
  - `[3/5] Checking subagent availability…`
  - `[4/5] Running review…`
  - `[5/5] Writing review artifact…`
- For long-running operations (reviewing large diffs, running verification commands), print a start line and a completion line (duration optional).
- Keep it concise; don’t print a line for every shell command.

**BLOCKED Activities:**
- No code changes during review
- No fixing issues found (that comes in receive-review)

**ALLOWED Activities:**
- Reading artifacts and code
- Running verification commands
- Writing review artifact

## Usage

### With arguments (if supported)

```
oat-project-review-provide code p02          # Code review for phase
oat-project-review-provide code p02-t03      # Code review for task
oat-project-review-provide code final        # Final code review
oat-project-review-provide code base_sha=abc # Review since specific SHA
oat-project-review-provide artifact discovery # Artifact review of discovery.md
oat-project-review-provide artifact spec     # Artifact review of spec.md
oat-project-review-provide artifact design   # Artifact review of design.md
```

### Without arguments

Run the `oat-project-review-provide` skill and it will:
1. Ask review type (code or artifact)
2. Ask scope (task/phase/final/range)
3. Confirm before running

## Process

### Step 0: Resolve Active Project (Hard Requirement)

OAT stores active project context in `.oat/config.local.json` (`activeProject`, local-only).

```bash
PROJECT_PATH=$(oat config get activeProject 2>/dev/null || true)
PROJECTS_ROOT="${OAT_PROJECTS_ROOT:-$(oat config get projects.root 2>/dev/null || echo ".oat/projects/shared")}"
PROJECTS_ROOT="${PROJECTS_ROOT%/}"
```

Validation rules:
- `PROJECT_PATH` must be set and point to an existing directory.
- `"$PROJECT_PATH/state.md"` must exist for mode-aware review validation.

If either check fails, **stop and route**. Do not create/guess project pointers in this skill.

Tell user:
- This is a project-scoped skill and needs an initialized OAT project (`activeProject` in `.oat/config.local.json` + project `state.md`).
- Without project state, review can still proceed via non-project skill: `oat-review-provide`.
- To continue with project workflow instead, run one of:
  - `oat-project-open` (existing project)
  - `oat-project-quick-start` (new quick project)
  - `oat-project-import-plan` (external plan import)

If validation passes, derive `{project-name}` as basename of `PROJECT_PATH`.

### Step 1: Parse Arguments or Ask

**If arguments provided:**
- Parse `$ARGUMENTS[0]` as review type: `code` or `artifact`
- Parse `$ARGUMENTS[1]` as scope token

**If no arguments:**
- Ask: "What type of review? (code / artifact)"
- Ask: "What scope?"
  - For code: `pNN-tNN` task / `pNN` phase / `final` / `base_sha=SHA` / `SHA..HEAD` range
  - For artifact: `discovery` / `spec` / `design` (and optionally `plan`)

### Step 2: Validate Artifacts Exist (Mode-Aware)

Resolve workflow mode from state (default `spec-driven`):

```bash
WORKFLOW_MODE=$(grep "^oat_workflow_mode:" "$PROJECT_PATH/state.md" 2>/dev/null | head -1 | awk '{print $2}')
WORKFLOW_MODE=${WORKFLOW_MODE:-spec-driven}
```

**Required for code review (by mode):**
- `spec-driven`: `spec.md`, `design.md`, `plan.md`
- `quick`: `discovery.md`, `plan.md` (`spec.md`/`design.md` optional if present)
- `import`: `plan.md` (`references/imported-plan.md` recommended, `spec.md`/`design.md` optional)

**Required for artifact review:**
- The artifact being reviewed must exist.
- Upstream dependencies are required only when relevant to that artifact:
  - reviewing `spec` requires `discovery.md`
  - reviewing `design` requires `spec.md`
  - reviewing `plan` in `spec-driven` mode requires `spec.md` + `design.md`
  - reviewing `plan` in `quick/import` mode may use `discovery.md` and/or `references/imported-plan.md` instead

**If missing:** Report missing required artifacts for the current mode and stop if requirements are not met.

### Step 3: Determine Scope and Commits

If review type is `artifact`:
- Interpret the scope token as the artifact name (`discovery`, `spec`, `design`, or `plan`)
- Set `SCOPE_RANGE=""` (no git range required)
- Proceed to Step 5 (metadata); Step 4 uses artifact files, not git diff

If review type is `code`, use the scope resolution below.

**Priority order for scope resolution:**

1. **Explicit user input (preferred):**
   - `base_sha=<sha>` → review range is `<sha>..HEAD`
   - `<sha1>..<sha2>` → exact range review
   - `pNN-tNN` → task scope
   - `pNN` → phase scope
   - `final` → full project review

2. **Automatic phase detection (if invoked at phase boundary):**
   - Derive current phase from plan.md + implementation.md
   - Use commit convention grep to find commits:
     ```bash
     # Task commits: grep for (pNN-tNN)
     git log --oneline --grep="\(p${PHASE}-t" HEAD~50..HEAD

     # Phase commits: grep for (pNN-
     git log --oneline --grep="\(p${PHASE}-" HEAD~50..HEAD
     ```

3. **Fallback (if commit conventions missing/inconsistent):**
   - Prompt user to choose:
     - Provide `base_sha=<sha>`
     - Provide `<sha1>..<sha2>` range
     - Confirm "review merge-base..HEAD" (all changes on branch)

   **Merge-base approach:**
   ```bash
   MERGE_BASE=$(git merge-base origin/main HEAD 2>/dev/null || git merge-base main HEAD 2>/dev/null)
   SCOPE_RANGE="$MERGE_BASE..HEAD"
   ```

### Step 4: Get Files Changed

If review type is `code`, once scope range is determined:

```bash
FILES_CHANGED=$(git diff --name-only "$SCOPE_RANGE" 2>/dev/null)
FILE_COUNT=$(echo "$FILES_CHANGED" | wc -l | tr -d ' ')
```

If review type is `artifact`, the "files in scope" are the artifact(s):

```bash
case "$SCOPE_TOKEN" in
  discovery) FILES_CHANGED=$(printf "%s\n" "$PROJECT_PATH/discovery.md") ;;
  spec) FILES_CHANGED=$(printf "%s\n" "$PROJECT_PATH/spec.md" "$PROJECT_PATH/discovery.md") ;;
  design) FILES_CHANGED=$(printf "%s\n" "$PROJECT_PATH/design.md" "$PROJECT_PATH/spec.md") ;;
  plan)
    if [[ "$WORKFLOW_MODE" == "spec-driven" ]]; then
      FILES_CHANGED=$(printf "%s\n" "$PROJECT_PATH/plan.md" "$PROJECT_PATH/spec.md" "$PROJECT_PATH/design.md")
    elif [[ "$WORKFLOW_MODE" == "quick" ]]; then
      FILES_CHANGED=$(printf "%s\n" "$PROJECT_PATH/plan.md" "$PROJECT_PATH/discovery.md")
    else
      FILES_CHANGED=$(printf "%s\n" "$PROJECT_PATH/plan.md" "$PROJECT_PATH/references/imported-plan.md")
    fi
    ;;
esac
FILE_COUNT=$(echo "$FILES_CHANGED" | wc -l | tr -d ' ')
```

Display to user:
```
Review scope: {scope}
Range: {SCOPE_RANGE} (code reviews only; artifact reviews have no git range)
Files changed: {FILE_COUNT}

{FILE_LIST preview - first 20 files}

Proceed with review?
```

### Step 4.5: Gather Deferred Findings Ledger (Final Scope Only)

If `review type == code` and `scope == final`, gather unresolved deferred findings from prior review cycles.

Preferred sources:
- `implementation.md` sections titled `Deferred Findings (...)`
- prior review artifacts under `reviews/` when implementation notes are incomplete

Build:
- `DEFERRED_MEDIUM_COUNT`
- `DEFERRED_MINOR_COUNT`
- `DEFERRED_LEDGER` (one-line summary per finding with source artifact)

Rules:
- Include this ledger in review metadata so final review explicitly re-evaluates carry-forward debt.
- Final review should call out whether each deferred Medium remains acceptable or should now be fixed.

### Step 5: Prepare Review Metadata Block

Build the "Review Scope" metadata for the reviewer:

```markdown
## Review Scope

**Project:** {PROJECT_PATH}
**Type:** {code|artifact}
**Scope:** {scope}{optional: " (" + SCOPE_RANGE + ")"}
**Date:** {today}

**Artifact Paths:**
- Spec: {PROJECT_PATH}/spec.md (required in spec-driven mode; optional in quick/import)
- Design: {PROJECT_PATH}/design.md (required in spec-driven mode; optional in quick/import)
- Plan: {PROJECT_PATH}/plan.md
- Implementation: {PROJECT_PATH}/implementation.md
- Discovery: {PROJECT_PATH}/discovery.md
- Imported Plan Reference: {PROJECT_PATH}/references/imported-plan.md (optional; import mode)

**Tasks in Scope (code review only):** {task IDs from plan.md matching scope}

**Files Changed ({FILE_COUNT}):**
{FILE_LIST}

**Commits (code review only):**
{git log --oneline for SCOPE_RANGE}

**Deferred Findings Ledger (final scope only):**
- Deferred Medium count: {DEFERRED_MEDIUM_COUNT}
- Deferred Minor count: {DEFERRED_MINOR_COUNT}
{DEFERRED_LEDGER}
```

### Step 6: Execute Review (3-Tier Capability Model)

**Step 6a: Probe Subagent Availability**

Before selecting a tier, announce the probe and its result so the user can see what's happening:

```
[3/5] Checking subagent availability…
  → oat-reviewer: {available | not resolved} ({reason})
  → Selected: Tier {1|2|3} — {Subagent (fresh context) | Fresh session (recommended) | Inline review}
```

Detection logic:
- If the host is Claude Code, use Task-style subagent dispatch with `subagent_type: "oat-reviewer"` and resolve from `.claude/agents/oat-reviewer.md`.
- If the host is Cursor, invoke `oat-reviewer` using Cursor-native explicit invocation (`/oat-reviewer`) or natural mention, and resolve from `.cursor/agents/oat-reviewer.md` (or `.claude/agents/oat-reviewer.md` compatibility path).
- If the host is Codex multi-agent, verify Codex requirements first:
  - `[features] multi_agent = true` is enabled in active Codex config.
  - If explicit role pinning is desired, `agent_type` must be a built-in role (`default`/`worker`/`explorer`) or a custom role declared under `[agents.<name>]`.
  - Codex may also auto-select and spawn agents without explicit role pinning.
- If the runtime can dispatch reviewer work (`subagent_type` in Claude Code, Cursor invocation via `/name` or natural mention, or Codex multi-agent spawn/auto-spawn) → **Tier 1**.
- If the Task tool is not available or subagent dispatch is not supported → **Tier 2**.
- If user explicitly requests inline or confirms they are already in a fresh session → **Tier 3**.

**Step 6b: Tier 1 — Subagent (if available)**

First, pre-compute the review artifact path using Step 7 naming conventions so it can be passed to the subagent.

Then spawn the reviewer:
- Use provider-appropriate dispatch:
  - Claude Code: Task tool with `subagent_type: "oat-reviewer"` (resolves from `.claude/agents/oat-reviewer.md`).
  - Cursor: explicit invocation `/oat-reviewer` (or natural mention) with agent resolved from `.cursor/agents/oat-reviewer.md` or `.claude/agents/oat-reviewer.md` compatibility path.
  - Codex style: ask Codex to spawn agent(s) for review work and wait for all results; optionally pin `agent_type` when a specific built-in/custom role is required.
- Pass the Review Scope metadata block from Step 5 as the prompt
- Include the pre-computed artifact path for the subagent to write to
- Run in background if supported (`run_in_background: true`)

The `oat-reviewer` agent definition contains the full review process, mode contract, severity categories, artifact template, and critical rules. No additional instructions need to be injected.

After the subagent completes:
- Verify the review artifact was written to the expected path
- Continue with Step 9 (plan update) and Step 9.5 (commit)

**Step 6c: Tier 2 — Fresh Session (recommended fallback)**

If subagent not available:
- If user is already in a fresh session (confirmed), proceed to Tier 3.
- If user prefers fresh session: provide instructions and exit.

Instructions for fresh session:
```
To run review in a fresh session:
1. Open a new terminal/session
2. Run the oat-project-review-provide skill with: code {scope}
3. When complete, return to this session
4. Run the oat-project-review-receive skill
```

**Step 6d: Tier 3 — Inline Reset (fallback)**

If user insists on inline review in current session:
- Run "reset protocol":
  1. Re-read required artifacts for current workflow mode from scratch
  2. Read all files in FILES_CHANGED
  3. Apply oat-reviewer checklist inline
  4. Write review artifact

### Step 7: Determine Review Artifact Path

**Naming convention:**
- Phase review: `{PROJECT_PATH}/reviews/pNN-review-YYYY-MM-DD.md`
- Task review: `{PROJECT_PATH}/reviews/pNN-tNN-review-YYYY-MM-DD.md`
- Final review: `{PROJECT_PATH}/reviews/final-review-YYYY-MM-DD.md`
- Range review: `{PROJECT_PATH}/reviews/range-review-YYYY-MM-DD.md`
- Artifact review: `{PROJECT_PATH}/reviews/artifact-{artifact}-review-YYYY-MM-DD.md`

**If file exists for today:** append `-v2`, `-v3`, etc.

```bash
mkdir -p "$PROJECT_PATH/reviews"
```

### Step 8: Write Review Artifact (if Tier 3)

If running inline (Tier 3), execute the review and write artifact.

**Review checklist (from oat-reviewer):**
1. Verify scope (don't review out-of-scope changes)
2. If code review: verify alignment to available requirements sources (`spec`/`design` for spec-driven mode; `discovery`/import reference for quick/import)
3. If code review: verify code quality (correctness, tests, security, maintainability)
4. If artifact review: verify completeness/clarity/readiness of the artifact and its alignment with upstream artifacts
5. Categorize findings (Critical/Important/Medium/Minor)
6. For final scope: explicitly disposition deferred Medium ledger items (fix now vs accept defer)
7. Write artifact with file:line references and fix guidance

**Review artifact template:** (see `.agents/agents/oat-reviewer.md` for full format)

Shared ad-hoc companion reference (non-project mode):
- `.agents/skills/oat-review-provide/references/review-artifact-template.md`

```markdown
---
oat_generated: true
oat_generated_at: {today}
oat_review_scope: {scope}
oat_review_type: {code|artifact}
oat_project: {PROJECT_PATH}
---

# {Code|Artifact} Review: {scope}

**Reviewed:** {today}
**Scope:** {scope description}
**Files reviewed:** {N}
**Commits:** {range}

## Summary

{2-3 sentence summary}

## Findings

### Critical
{findings or "None"}

### Important
{findings or "None"}

### Medium
{findings or "None"}

### Minor
{findings or "None"}

## Spec/Design Alignment

### Requirements Coverage
| Requirement | Status | Notes |
|-------------|--------|-------|
| {ID} | implemented / missing / partial | {notes} |

### Extra Work (not in requirements)
{list or "None"}

## Verification Commands

{commands to verify fixes}

## Recommended Next Step

Run the `oat-project-review-receive` skill to convert findings into plan tasks.
```

### Step 9: Update Plan Reviews Section

After review artifact is written, update `plan.md` `## Reviews` table *if plan.md exists*.

Update or add a row matching `{scope}`:
- `Scope`: `{scope}` (examples: `p02`, `final`, `spec`, `design`)
- `Type`: `code` or `artifact`
- `Status`: `received` (receive-review will decide `fixes_added` vs `passed`; `passed` now requires no unresolved Critical/Important/Medium and final deferred-medium disposition when applicable)
- `Date`: `{today}`
- `Artifact`: `reviews/{filename}.md`

If plan.md is missing (e.g., spec/design review before planning), skip this update and rely on the review artifact + next-step routing.

### Step 9.5: Commit Review Bookkeeping Atomically (Required)

After writing the review artifact and applying the Step 9 Reviews-table update, create an atomic bookkeeping commit.

**Commit scope:**
- Always include the review artifact file: `reviews/{filename}.md`
- Include `plan.md` when Step 9 updated the Reviews table
- Do not include unrelated implementation/code files in this commit

**Commit message:**
- `chore(oat): record {scope} review artifact`

**If the user asks to defer commit:**
- Require explicit user confirmation to proceed without commit
- Warn that uncommitted review bookkeeping can desync workflow routing/restart behavior
- In the summary, clearly state: "bookkeeping not committed (user-approved defer)"

### Step 10: Output Summary

**If subagent used (Tier 1):**
```
Review requested via subagent.

When the reviewer finishes, run the oat-project-review-receive skill to process findings.
```

**If fresh session recommended (Tier 2):**
```
For best review quality, run in a fresh session:

1. Open new terminal/session
2. Run the oat-project-review-provide skill with: code {scope}
3. Return here and run the oat-project-review-receive skill

Or say "inline" to run review in current session (less reliable).
```

**If inline review completed (Tier 3):**
```
Review complete for {project-name}.

Scope: {scope}
Files reviewed: {N}
Findings: {N} critical, {N} important, {N} medium, {N} minor

Review artifact: {path}
Bookkeeping commit: {sha or "deferred with user approval"}

Next: Run the oat-project-review-receive skill to convert findings into plan tasks.
```

## Success Criteria

- Active project resolved
- Review type and scope determined
- Commit range identified
- Files changed list obtained
- Review executed (subagent, fresh session guidance, or inline)
- Review artifact written to correct path
- Plan.md Reviews section updated
- Review artifact + plan bookkeeping committed atomically (or explicitly deferred with user approval)
- For final scope, deferred findings ledger included in reviewer context
- User guided to next step (`oat-project-review-receive`)
