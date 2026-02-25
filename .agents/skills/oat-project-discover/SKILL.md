---
name: oat-project-discover
version: 1.0.0
description: Use when starting a project or when requirements are still unclear. Runs structured discovery to gather requirements, constraints, and context.
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash(git:*), Glob, Grep, AskUserQuestion
---

# Discovery Phase

Gather requirements and understand the problem space through natural collaborative dialogue.

## Prerequisites

**Required:** Knowledge base must exist. If missing, run the `oat-repo-knowledge-index` skill first.

## Mode Assertion

**OAT MODE: Discovery**

**Purpose:** Gather requirements and understand the problem space through structured dialogue.

## Progress Indicators (User-Facing)

When executing this skill, provide lightweight progress feedback so the user can tell what’s happening after they confirm.

- Print a phase banner once at start using horizontal separators, e.g.:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OAT ▸ DISCOVERY
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Before multi-step work, print step indicators, e.g.:
  - `[1/5] Resolving project + checking knowledge base…`
  - `[2/5] Initializing discovery document…`
  - `[3/5] Running interactive discovery…`
  - `[4/5] Documenting decisions + boundaries…`
  - `[5/5] Updating state + committing…`

**BLOCKED Activities:**
- ❌ No code writing
- ❌ No design documents
- ❌ No implementation plans
- ❌ No technical specifications
- ❌ No concrete deliverables list (specific scripts, file paths, function names)

**ALLOWED Activities:**
- ✅ Asking clarifying questions
- ✅ Exploring approaches and trade-offs
- ✅ Documenting decisions and constraints
- ✅ Reading knowledge base for context

**Self-Correction Protocol:**
If you catch yourself:
- Writing code or implementation details → STOP
- Drafting technical designs → STOP
- Creating detailed plans → STOP

**Recovery:**
1. Acknowledge the deviation
2. Return to asking questions about requirements
3. Document the insight in discovery.md without implementation details (use "Open Questions" for design if needed)

## Process

### Step 1: Resolve Active Project (or Create a New One)

OAT stores active project context in `.oat/config.local.json` (`activeProject`, local-only).

**Recommendation:** Prefer creating projects via the `oat-project-new` skill (scaffolds all artifacts up front). `oat-project-new` is the canonical "create project" step; this discovery skill should not be responsible for directory/template scaffolding.

```bash
PROJECT_PATH=$(oat config get activeProject 2>/dev/null || true)
PROJECTS_ROOT="${OAT_PROJECTS_ROOT:-$(oat config get projects.root 2>/dev/null || echo ".oat/projects/shared")}"
PROJECTS_ROOT="${PROJECTS_ROOT%/}"
```

**If `PROJECT_PATH` is set and valid (directory exists):**
- Derive `project-name` from the directory name (basename of the path)
- Read `{PROJECT_PATH}/state.md` (if it exists) and show current status
- Ask user:
  - **Continue** with active project, or
  - **Switch projects**:
    - Existing project: run the `oat-project-open` skill
    - New project: run the `oat-project-new` skill
  - Stop here until the user has selected/created the intended project.

**If `PROJECT_PATH` is missing/invalid:**
- Tell the user an active project is required for discovery.
- Offer:
  - New project: run the `oat-project-new` skill with `{project-name}`
  - Existing project: run the `oat-project-open` skill
- Stop here until `activeProject` in `.oat/config.local.json` is set to a valid project directory.

### Step 2: Check Knowledge Base Exists

```bash
test -f .oat/repo/knowledge/project-index.md
```

**If missing:** Block and require the `oat-repo-knowledge-index` skill first.

### Step 3: Check Knowledge Staleness

Extract frontmatter values from `.oat/repo/knowledge/project-index.md`:

```bash
# Extract SHAs and generation date from frontmatter
SOURCE_HEAD_SHA=$(grep "^oat_source_head_sha:" .oat/repo/knowledge/project-index.md | awk '{print $2}')
SOURCE_MERGE_BASE_SHA=$(grep "^oat_source_main_merge_base_sha:" .oat/repo/knowledge/project-index.md | awk '{print $2}')
GENERATED_AT=$(grep "^oat_generated_at:" .oat/repo/knowledge/project-index.md | awk '{print $2}')

# Get current state
CURRENT_HEAD=$(git rev-parse HEAD)
CURRENT_MERGE_BASE=$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD)
```

**Enhanced staleness check:**

1. **Age check:** Compare `$GENERATED_AT` vs today (warn if >7 days)
   ```bash
   # Skip age check if GENERATED_AT is missing or invalid
   if [ -n "$GENERATED_AT" ] && echo "$GENERATED_AT" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
     # macOS: use date -j -f, Linux: use date -d
     if date -j -f "%Y-%m-%d" "$GENERATED_AT" +%s >/dev/null 2>&1; then
       GENERATED_TS=$(date -j -f "%Y-%m-%d" "$GENERATED_AT" +%s)
     else
       GENERATED_TS=$(date -d "$GENERATED_AT" +%s 2>/dev/null || echo "")
     fi

     if [ -n "$GENERATED_TS" ]; then
       DAYS_OLD=$(( ($(date +%s) - $GENERATED_TS) / 86400 ))
     else
       DAYS_OLD="unknown"
     fi
   else
     DAYS_OLD="unknown"
   fi
   ```

2. **Git diff check:** Compare recorded index HEAD to current HEAD
   ```bash
   # Use --numstat for reliable file count (one line per file)
   if [ -n "$SOURCE_HEAD_SHA" ]; then
     FILES_CHANGED=$(git diff --numstat "$SOURCE_HEAD_SHA..HEAD" 2>/dev/null | wc -l | tr -d ' ')
     # Also get summary for display
     CHANGES_SUMMARY=$(git diff --shortstat "$SOURCE_HEAD_SHA..HEAD" 2>/dev/null)
   else
     FILES_CHANGED="unknown"
     CHANGES_SUMMARY=""
   fi
   ```

**Staleness thresholds:**
- Age: >7 days old
- Changes: >20 files changed

**If stale (age or changes exceed thresholds):**
- Display prominent warning with specifics (days old, files changed)
- Show `$CHANGES_SUMMARY` if available
- Recommend the `oat-repo-knowledge-index` skill to refresh
- Ask user: "Continue with stale knowledge or refresh first?"

**If unable to determine staleness (missing SHAs/dates):**
- Warn that staleness could not be verified
- Recommend refreshing knowledge base to ensure accuracy

### Step 4: Initialize State

Copy template: `.oat/templates/state.md` → `"$PROJECT_PATH/state.md"`

Update frontmatter:
```yaml
---
oat_phase: discovery
oat_phase_status: in_progress
---
```

Update content:
- Replace `{Project Name}` with actual project name
- Set **Started:** to today's date
- Update **Artifacts** section with actual project path

### Step 5: Initialize Discovery Document

Copy template: `.oat/templates/discovery.md` → `"$PROJECT_PATH/discovery.md"`

Update with user's initial request.

### Step 6: Read Relevant Knowledge

Read for context:
- `.oat/repo/knowledge/project-index.md`
- `.oat/repo/knowledge/architecture.md`
- `.oat/repo/knowledge/conventions.md`
- `.oat/repo/knowledge/concerns.md`

### Step 7: Infer Gray Areas

Based on the initial request and knowledge base context, infer 3-5 "gray areas" - topics that need clarification.

**Examples of gray areas:**
- **Scope:** What features are in/out of scope?
- **Integration:** How does this interact with existing systems?
- **Data:** What data needs to be stored/accessed?
- **Users:** Who will use this and how?
- **Performance:** What are the scale/latency requirements?
- **Security:** What are the auth/privacy requirements?
- **Testing:** What testing approach is needed?

Present as multi-select question using AskUserQuestion tool:
```
Which areas should we explore during discovery?
(Select all that apply)

□ {Gray area 1}
□ {Gray area 2}
□ {Gray area 3}
□ {Gray area 4}
□ {Gray area 5}
```

This focuses the conversation on what matters most to the user.

### Step 8: Ask Clarifying Questions

**For each selected gray area:**
- Ask targeted questions one at a time
- After each answer:
  1. Add to discovery.md "Clarifying Questions" section
  2. Update frontmatter: `oat_last_updated: {today}`

**Question quality:**
- Open-ended where possible
- Domain-aware (reference knowledge base context)
- Focused on decisions, not implementation details

### Step 9: Explore Approaches

Propose 2-3 approaches with pros/cons. Document in discovery.md "Options Considered".

When an approach is selected, add a "Summary" line explaining the choice.

**Handle scope creep:**
- If user suggests additional features during discussion → add to "Deferred Ideas"
- If uncertainty arises → add to "Open Questions"
- Keep discovery focused on the core problem

### Step 10: Document Decisions and Boundaries

Update discovery.md sections:

**Required:**
- **Key Decisions:** What was decided and why
- **Constraints:** Technical, business, timeline limits
- **Success Criteria:** How we'll know it's done
- **Out of Scope:** What we're explicitly not doing

**Capture during conversation:**
- **Deferred Ideas:** Features/improvements for later (prevents scope creep)
- **Open Questions:** Unresolved questions (flag for spec phase)
- **Assumptions:** What we're assuming is true (needs validation)
- **Risks:** Potential problems identified (helps planning)

**Keep it outcome-level:**
- Avoid naming specific scripts/files/commands as deliverables in discovery.
- If you need to preserve an implementation thought, record it as an Open Question for design.

### Step 11: Human-in-the-Loop Lifecycle (HiLL) Gate (If Configured)

Read `"$PROJECT_PATH/state.md"` frontmatter:
- `oat_hill_checkpoints`
- `oat_hill_completed`

If `"discovery"` is in `oat_hill_checkpoints`, require explicit user approval before advancing.

**Approval prompt (required):**
- "Discovery artifact is ready. Approve discovery and unlock `oat-project-spec`?"

**Optional independent review path:**
- If user wants fresh-context artifact review first, run:
  - `oat-project-review-provide artifact discovery`

**If user does not approve yet:**
- Keep discovery frontmatter as:
  - `oat_status: in_progress`
  - `oat_ready_for: null`
- Keep project state as in-progress for discovery.
- Do **not** append `"discovery"` to `oat_hill_completed`.
- Stop and report: "Discovery draft saved; awaiting HiLL approval."

If discovery is not configured as a HiLL checkpoint, or user explicitly approves, continue to Step 12.

### Step 12: Mark Discovery Complete

Update frontmatter:
```yaml
---
oat_status: complete
oat_ready_for: oat-project-spec
---
```

### Step 13: Update Project State

Update `"$PROJECT_PATH/state.md"`:

**Frontmatter updates:**
- `oat_phase: discovery`
- `oat_phase_status: complete`
- **If** `"discovery"` is in `oat_hill_checkpoints`: append `"discovery"` to `oat_hill_completed` array

**Note:** Only append to `oat_hill_completed` when the phase is configured as a HiLL gate. This keeps `oat_hill_completed` meaning "HiLL gates passed" rather than "phases completed" (which is tracked by `oat_phase` and `oat_phase_status`).

**Content updates:**
- Set **Last Updated:** to today
- Update **Artifacts** section: Discovery status to "complete"
- Update **Progress** section

### Step 14: Commit Discovery

**Note:** This shows what users will do when USING oat-project-discover.
During implementation of OAT itself, use standard commit format.

```bash
git add "$PROJECT_PATH/"
git commit -m "docs: complete discovery for {project-name}

Key decisions:
- {Decision 1}
- {Decision 2}

Ready for specification phase"
```

### Step 15: Output Summary

```
Discovery phase complete for {project-name}.

Next: Create specification with the oat-project-spec skill
```
