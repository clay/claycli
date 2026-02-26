---
name: oat-project-design
version: 1.0.0
description: Use when discovery and specification are complete and implementation-ready decisions are needed. Produces detailed technical design artifacts, including architecture and interfaces.
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash(git:*), Glob, Grep, AskUserQuestion
---

# Design Phase

Transform specification requirements into a detailed technical design with architecture, components, and implementation strategy.

## Prerequisites

**Required:** Complete specification document. If missing, run the `oat-project-spec` skill first.

## Progress Indicators (User-Facing)

When executing this skill, provide lightweight progress feedback so the user can tell what’s happening after they confirm.

- Print a phase banner once at start using horizontal separators, e.g.:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OAT ▸ DESIGN
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Before multi-step work, print step indicators, e.g.:
  - `[1/5] Validating spec + reading context…`
  - `[2/5] Drafting architecture overview…`
  - `[3/5] Designing components + data models…`
  - `[4/5] Reviewing design with user…`
  - `[5/5] Updating state + committing…`

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

### Step 1: Check Specification Complete

```bash
cat "$PROJECT_PATH/spec.md" | head -10 | grep "oat_status:"
```

**Required frontmatter:**
- `oat_status: complete`
- `oat_ready_for: oat-project-design`

**If not complete:** Block and ask user to finish specification first.

### Step 2: Read Specification Document

Read `"$PROJECT_PATH/spec.md"` completely to understand:
- Problem statement and goals
- All functional requirements (FR)
- All non-functional requirements (NFR)
- Constraints and dependencies
- High-level design proposal
- Success metrics

### Step 3: Read Knowledge Base for Design Context

Read for architectural context and conventions:
- `.oat/repo/knowledge/project-index.md` - Overview
- `.oat/repo/knowledge/architecture.md` - Existing patterns
- `.oat/repo/knowledge/stack.md` - Technologies available
- `.oat/repo/knowledge/conventions.md` - Code patterns to follow
- `.oat/repo/knowledge/integrations.md` - External services
- `.oat/repo/knowledge/concerns.md` - Issues to avoid

**Purpose:** Ensure design aligns with existing architecture and follows established patterns.

### Step 4: Initialize Design Document

Copy template: `.oat/templates/design.md` → `"$PROJECT_PATH/design.md"`

Update frontmatter:
```yaml
---
oat_status: in_progress
oat_ready_for: null
oat_blockers: []
oat_last_updated: {today}
oat_generated: false
oat_template: false
---
```

### Step 5: Draft Architecture Overview

Based on spec's high-level design + knowledge base architecture:

**System Context:**
- How this fits into existing architecture
- What components it interacts with
- Boundaries of this change

**Key Components:**
- List main components needed
- Define responsibilities
- Show relationships

**Data Flow:**
- How data moves through the system
- Entry points and exit points
- Transformation steps

Update design.md Architecture section.

### Step 6: Design Components

For each component identified:

**Component Details:**
```markdown
### {Component Name}

**Purpose:** {Single responsibility}

**Responsibilities:**
- {Specific task 1}
- {Specific task 2}

**Interfaces:**
{Code signatures following conventions.md patterns}

**Dependencies:**
- {What it depends on}

**Design Decisions:**
- {Why this approach}
```

Follow patterns from conventions.md. Use stack.md technologies.

### Step 7: Define Data Models

For each entity/model needed:

**Model Schema:**
- Define fields and types
- Validation rules
- Storage approach (from architecture.md patterns)

**Considerations:**
- Align with existing models (from architecture.md)
- Follow naming conventions (from conventions.md)
- Address NFR requirements (performance, security)

### Step 8: Design APIs

For each API endpoint or interface:

**Specification:**
- Method and path
- Request/response schemas
- Error handling approach
- Authorization requirements

**Considerations:**
- Follow API patterns from architecture.md
- Align with integrations.md external API patterns
- Address security NFRs

### Step 9: Address Security Considerations

Based on NFRs + concerns.md:

**Required sections:**
- Authentication approach
- Authorization model
- Data protection (encryption, PII)
- Input validation strategy
- Threat mitigation

Reference security patterns from conventions.md and concerns.md.

### Step 10: Address Performance Considerations

Based on NFRs + concerns.md:

**Required sections:**
- Scalability approach
- Caching strategy
- Database optimization
- Resource limits

Reference performance patterns from concerns.md.

### Step 11: Define Error Handling

**Error Strategy:**
- Error categories and handling
- Retry logic
- Logging approach (follow conventions.md patterns)

### Step 12: Define Testing Strategy

Based on spec success metrics + testing.md:

**Step 12a: Create Requirement-to-Test Mapping**

Pull from spec.md Requirement Index and expand:

| ID | Verification | Key Scenarios |
|----|--------------|---------------|
| {from spec} | {method from spec} | {scenarios seeded from pointer + design} |

For each requirement:
1. Copy the ID from spec.md
2. Copy the **method** (left side of `method: pointer`) into Verification
3. Use the **pointer** (right side) to seed Key Scenarios
4. Expand scenarios based on component design decisions
5. Note if multiple test levels apply (e.g., "unit + integration")

**Step 12b: Define Test Levels**

- Unit tests: scope and coverage target
- Integration tests: key scenarios and test environment
- E2E tests: critical user paths

Follow testing patterns from testing.md.

**Why mapping matters:**
- Ensures every requirement has a verification plan
- Feeds directly into `oat-project-plan` task breakdown
- Prevents "untested requirements" gaps

### Step 13: Plan Deployment

**Deployment Strategy:**
- Build process (from stack.md)
- Deployment steps
- Rollback plan
- Configuration approach
- Monitoring and alerts

### Step 14: Plan Migrations

If changes require migrations:

**Migration Plan:**
- Database migrations
- Data migrations
- Breaking changes handling
- Rollback strategy

### Step 15: Identify Implementation Phases

Break work into phases:

**Phase Structure:**
```markdown
### Phase 1: {Phase Name}

**Goal:** {What this achieves}

**Tasks:**
- {High-level task 1}
- {High-level task 2}

**Verification:** {How to verify completion}
```

Keep phases manageable (1-3 days of work each).

### Step 16: Document Open Questions

Track unresolved design questions:
- Decisions needing user input
- Technical uncertainties
- Performance unknowns

### Step 17: Assess Risks

For each significant risk:

**Risk Assessment:**
```markdown
- **{Risk Name}:** {Probability} | {Impact}
  - **Mitigation:** {How to reduce}
  - **Contingency:** {Backup plan}
```

### Step 18: Review Design with User

**Review Points:**
1. Architecture aligns with requirements
2. Component responsibilities clear
3. Data models cover all entities
4. APIs meet functional requirements
5. Security addresses NFRs
6. Performance addresses NFRs
7. Testing strategy adequate
8. Implementation phases reasonable

**Iterate:** Make refinements based on feedback, update `oat_last_updated`.

### Step 19: Human-in-the-Loop Lifecycle (HiLL) Gate (If Configured)

Read `"$PROJECT_PATH/state.md"` frontmatter:
- `oat_hill_checkpoints`
- `oat_hill_completed`

If `"design"` is in `oat_hill_checkpoints`, require explicit user approval before advancing.

**Approval prompt (required):**
- "Design artifact is ready. Approve design and unlock `oat-project-plan`?"

**Optional independent review path:**
- If user wants fresh-context artifact review first, run:
  - `oat-project-review-provide artifact design`

**If user does not approve yet:**
- Keep design frontmatter as:
  - `oat_status: in_progress`
  - `oat_ready_for: null`
- Keep project state as in-progress for design.
- Do **not** append `"design"` to `oat_hill_completed`.
- Stop and report: "Design draft saved; awaiting HiLL approval."

If design is not configured as a HiLL checkpoint, or user explicitly approves, continue to Step 20.

### Step 20: Mark Design Complete

Update frontmatter:
```yaml
---
oat_status: complete
oat_ready_for: oat-project-plan
oat_blockers: []
oat_last_updated: {today}
---
```

### Step 21: Update Project State

Update `"$PROJECT_PATH/state.md"`:

**Frontmatter updates:**
- `oat_current_task: null`
- `oat_last_commit: {commit_sha_from_step_22}`
- `oat_blockers: []`
- `oat_phase: design`
- `oat_phase_status: complete`
- **If** `"design"` is in `oat_hill_checkpoints`: append `"design"` to `oat_hill_completed` array

**Note:** Only append to `oat_hill_completed` when the phase is configured as a HiLL gate.

Update content:
```markdown
## Current Phase

Design - Ready for implementation planning

## Progress

- ✓ Discovery complete
- ✓ Specification complete
- ✓ Design complete
- ⧗ Awaiting implementation plan
```

### Step 22: Commit Design

**Note:** This shows what users will do when USING oat-project-design.
During implementation of OAT itself, use standard commit format.

```bash
git add "$PROJECT_PATH/"
git commit -m "docs: complete design for {project-name}

Architecture:
- {N} components
- {Key architectural decision}

Implementation:
- {N} phases planned
- {Estimated complexity}

Ready for implementation planning"
```

### Step 23: Output Summary

```
Design phase complete for {project-name}.

Architecture:
- {N} components defined
- {N} data models specified
- {N} API endpoints designed

Next: Create implementation plan with the oat-project-plan skill
```

## Success Criteria

- Architecture aligns with existing patterns (from architecture.md)
- Components follow conventions (from conventions.md)
- All functional requirements addressed
- All non-functional requirements addressed
- Testing strategy covers success metrics
- Implementation phases are clear and manageable
- Risks identified with mitigation strategies
- User confirmed design is complete
