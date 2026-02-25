---
name: oat-project-spec
version: 1.0.0
description: Use when discovery is complete and the project needs a formal requirements baseline. Transforms discovery output into structured specification artifacts.
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash(git:*), Glob, Grep, AskUserQuestion
---

# Specification Phase

Transform discovery insights into a formal specification with detailed requirements and acceptance criteria.

## Prerequisites

**Required:** Complete discovery document. If missing, run the `oat-project-discover` skill first.

## Mode Assertion

**OAT MODE: Specification**

**Purpose:** Transform discovery insights into formal, structured requirements with clear acceptance criteria.

## Progress Indicators (User-Facing)

When executing this skill, provide lightweight progress feedback so the user can tell what’s happening after they confirm.

- Print a phase banner once at start using horizontal separators, e.g.:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OAT ▸ SPEC
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Before multi-step work, print step indicators, e.g.:
  - `[1/5] Validating discovery + reading context…`
  - `[2/5] Drafting requirements…`
  - `[3/5] Refining with user…`
  - `[4/5] Running quality gate checks…`
  - `[5/5] Updating state + committing…`

**BLOCKED Activities:**
- ❌ No implementation code
- ❌ No detailed design (component internals, data structures)
- ❌ No implementation plans or task breakdowns
- ❌ No technology selections beyond what's in discovery
- ❌ No concrete deliverables list (specific scripts, file paths, function names)

**ALLOWED Activities:**
- ✅ Formalizing requirements from discovery
- ✅ Defining acceptance criteria
- ✅ Assigning priorities (P0/P1/P2)
- ✅ High-level design approach (architecture pattern, not implementation)
- ✅ Identifying dependencies and constraints

**Self-Correction Protocol:**
If you catch yourself:
- Writing implementation code → STOP
- Designing component internals → STOP (save for design phase)
- Breaking down into implementation tasks → STOP (save for plan phase)
- Selecting specific libraries/frameworks → STOP (unless already decided in discovery)

**Recovery:**
1. Acknowledge the deviation
2. Return to requirements language ("the system must...")
3. Move detailed design/implementation notes to "Open Questions" for `oat-project-design`

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

### Step 1: Check Discovery Complete

```bash
cat "$PROJECT_PATH/discovery.md" | head -10 | grep "oat_status:"
```

**Required frontmatter:**
- `oat_status: complete`
- `oat_ready_for: oat-project-spec`

**If not complete:** Block and ask user to finish discovery first.

### Step 2: Read Discovery Document

Read `"$PROJECT_PATH/discovery.md"` completely to understand:
- Initial request and context
- All clarifying Q&A
- Options considered and chosen approach
- Key decisions made
- Constraints identified
- Success criteria defined
- Items explicitly out of scope

### Step 3: Validate Discovery Content

**Minimum viable requirements check:**

Verify discovery includes:
- ✅ **Chosen approach** in "Options Considered" with clear rationale
- ✅ **Constraints** section (not empty)
- ✅ **Success Criteria** section (measurable outcomes)
- ✅ **Out of Scope** section (boundaries defined)

**If any missing:**
- Do NOT proceed with spec
- Report what's missing to user
- Send user back to `oat-project-discover` to complete

**Why:** Prevents "formalized vagueness" - a spec is only as good as the discovery it's based on.

### Step 4: Read Relevant Knowledge

Read for context:
- `.oat/repo/knowledge/project-index.md`
- `.oat/repo/knowledge/architecture.md`
- `.oat/repo/knowledge/integrations.md` (for dependencies)
- `.oat/repo/knowledge/concerns.md` (for constraints)

### Step 5: Initialize Specification Document

Copy template: `.oat/templates/spec.md` → `"$PROJECT_PATH/spec.md"`

Update frontmatter:
```yaml
---
oat_status: in_progress
oat_ready_for: null
oat_blockers: []
oat_last_updated: {today}
---
```

### Step 6: Draft Problem Statement

Transform from discovery:
- **Initial Request** → Core problem
- **Clarifying Questions** → Context and nuances
- **Key Decisions** → Scope boundaries

Write 2-4 paragraphs clearly describing the problem being solved.

### Step 7: Define Goals

**Primary Goals:** Must-have outcomes (from Key Decisions + Success Criteria)
**Secondary Goals:** Nice-to-have outcomes (from Success Criteria marked as optional)

Use clear, measurable language.

### Step 8: Define Non-Goals

Copy from discovery "Out of Scope" section, adding:
- Explicit boundaries
- Future considerations
- Related work intentionally excluded

### Step 9: Draft Requirements

Transform Key Decisions and Success Criteria into structured requirements.

**Functional Requirements (FR):**
```markdown
**FR1: {Requirement Name}**
- **Description:** {What the system must do}
- **Acceptance Criteria:**
  - {Testable criterion 1}
  - {Testable criterion 2}
- **Priority:** P0 / P1 / P2
```

**Non-Functional Requirements (NFR):**
```markdown
**NFR1: {Requirement Name}**
- **Description:** {Performance, security, usability requirement}
- **Acceptance Criteria:**
  - {Measurable criterion}
- **Priority:** P0 / P1 / P2
```

**Priorities:**
- **P0:** Must have - blocks launch
- **P1:** Should have - important but not blocking
- **P2:** Nice to have - future enhancement

Start with draft requirements, then iterate with user in Step 10.

### Step 10: Refine Requirements with User

**Iterative process:**
1. Present draft requirements
2. Ask: "Are these requirements complete? Any missing or unclear?"
3. Update spec.md with refinements
4. Update frontmatter: `oat_last_updated: {today}`
5. Repeat until user confirms completeness

**Focus areas:**
- Acceptance criteria are testable
- Priorities are clear
- Edge cases covered
- Dependencies identified

### Step 11: Document Constraints

Copy from discovery "Constraints" section, adding:
- Technical constraints (from architecture.md, concerns.md)
- Business constraints
- Timeline constraints
- Resource constraints

### Step 12: Identify Dependencies

From knowledge base and discovery:
- External systems (from integrations.md)
- Existing components (from architecture.md)
- Third-party libraries
- Infrastructure requirements

### Step 13: Draft High-Level Design

Transform "Options Considered" into design proposal:

```markdown
## High-Level Design (Proposed)

{2-3 paragraph overview of chosen approach}

**Key Components:**
- {Component 1} - {Brief description}
- {Component 2} - {Brief description}

**Alternatives Considered:**
- {Alternative 1} - {Why rejected}
- {Alternative 2} - {Why rejected}

**Open Questions:**
- {Question needing resolution}
```

Keep high-level - detailed design comes in next phase.

**Guardrail:** Do not name specific scripts/files/functions here. Describe components and responsibilities only.

### Step 14: Define Success Metrics

Transform "Success Criteria" into measurable metrics:
- Performance metrics (response time, throughput)
- Quality metrics (error rate, test coverage)
- User metrics (adoption, satisfaction)
- Business metrics (cost savings, revenue impact)

### Step 15: Populate Requirement Index

Create traceability matrix in spec.md "Requirement Index" section:

**For each requirement (FR and NFR):**
| Column | Content |
|--------|---------|
| ID | FR1, FR2, NFR1, etc. (sequential) |
| Description | Brief 1-sentence summary |
| Priority | P0/P1/P2 from requirement |
| Verification | `method: pointer` — how this will be verified |
| Planned Tasks | Leave as "TBD - see plan.md" |

**Verification column format:** `method: pointer`
- **method** — test level or verification type:
  - `unit` — isolated unit tests
  - `integration` — tests spanning components/services
  - `e2e` — end-to-end user flow tests
  - `manual` — human verification required
  - `perf` — performance/load testing
- **pointer** — brief scope hint for the design phase:
  - Good: `unit: auth token validation`, `e2e: login flow`, `perf: API latency`
  - Bad: `see acceptance criteria` (too vague)

**Why this matters:**
- Enables tracing from requirements → tests → tasks → implementation
- Prevents "lost requirements" during execution
- Supports `oat-project-plan` in breaking down work systematically
- Gives design phase clear guidance on test strategy per requirement

### Step 16: Spec Quality Gate

Before marking complete, run through this quality checklist:

**Completeness Check:**
- [ ] All P0 requirements have testable acceptance criteria
- [ ] All P0 requirements have priorities assigned
- [ ] All P0 requirements have a Verification entry in the Requirement Index (not blank/TBD)
- [ ] Dependencies are identified
- [ ] Constraints are documented
- [ ] Success metrics are measurable

**Quality Check:**
- [ ] Acceptance criteria are specific (not vague like "works well")
- [ ] No obvious edge cases missing
- [ ] No contradictions between requirements
- [ ] NFRs have quantifiable targets (not just "fast" or "secure")
- [ ] High-level design aligns with requirements

**Boundary Check:**
- [ ] Out-of-scope items clearly documented
- [ ] No feature creep in requirements

**If any checks fail:**
- Fix the issues before proceeding
- Update `oat_last_updated: {today}`

**If all checks pass:**
- Proceed to Step 17

### Step 17: Human-in-the-Loop Lifecycle (HiLL) Gate (If Configured)

Read `"$PROJECT_PATH/state.md"` frontmatter:
- `oat_hill_checkpoints`
- `oat_hill_completed`

If `"spec"` is in `oat_hill_checkpoints`, require explicit user approval before advancing.

**Approval prompt (required):**
- "Specification artifact is ready. Approve spec and unlock `oat-project-design`?"

**Optional independent review path:**
- If user wants fresh-context artifact review first, run:
  - `oat-project-review-provide artifact spec`

**If user does not approve yet:**
- Keep spec frontmatter as:
  - `oat_status: in_progress`
  - `oat_ready_for: null`
- Keep project state as in-progress for spec.
- Do **not** append `"spec"` to `oat_hill_completed`.
- Stop and report: "Specification draft saved; awaiting HiLL approval."

If spec is not configured as a HiLL checkpoint, or user explicitly approves, continue to Step 18.

### Step 18: Mark Specification Complete

Update frontmatter:
```yaml
---
oat_status: complete
oat_ready_for: oat-project-design
oat_blockers: []
oat_last_updated: {today}
---
```

### Step 19: Update Project State

Update `"$PROJECT_PATH/state.md"`:

**Frontmatter updates:**
- `oat_current_task: null`
- `oat_last_commit: {commit_sha_from_step_20}`
- `oat_blockers: []`
- `oat_phase: spec`
- `oat_phase_status: complete`
- **If** `"spec"` is in `oat_hill_checkpoints`: append `"spec"` to `oat_hill_completed` array

**Note:** Only append to `oat_hill_completed` when the phase is configured as a HiLL gate.

Update content:
```markdown
## Current Phase

Specification - Ready for design phase

## Progress

- ✓ Discovery complete
- ✓ Specification complete
- ⧗ Awaiting design phase
```

### Step 20: Commit Specification

**Note:** This shows what users will do when USING oat-project-spec.
During implementation of OAT itself, use standard commit format.

```bash
git add "$PROJECT_PATH/"
git commit -m "docs: complete specification for {project-name}

Requirements:
- {N} functional requirements (P0: {n}, P1: {n}, P2: {n})
- {N} non-functional requirements (P0: {n}, P1: {n}, P2: {n})

Ready for design phase"
```

### Step 21: Output Summary

```
Specification phase complete for {project-name}.

Created:
- {N} functional requirements
- {N} non-functional requirements
- High-level design approach
- Success metrics

Next: Create detailed design with the oat-project-design skill
```

## Success Criteria

- All requirements have clear acceptance criteria
- Priorities assigned to all requirements
- Dependencies identified
- High-level design approach documented
- Success metrics defined and measurable
- User confirmed specification is complete
