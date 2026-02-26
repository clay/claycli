---
oat_status: in_progress
oat_ready_for: null
oat_blockers: []
oat_last_updated: YYYY-MM-DD
oat_generated: false
oat_template: true
oat_template_name: spec
---

# Specification: {Project Name}

## Phase Guardrails (Specification)

Specification is for requirements and acceptance criteria, not design/implementation details.

- Avoid concrete deliverables (specific scripts, file paths, function names).
- Keep the “High-Level Design” section to architecture shape and component boundaries only.
- If a design detail comes up, record it under **Open Questions** for `oat-project-design`.

## Problem Statement

{Clear description of the problem being solved}

## Goals

### Primary Goals
- {Goal 1}
- {Goal 2}

### Secondary Goals
- {Nice-to-have 1}

## Non-Goals

- {Explicitly out of scope 1}
- {Explicitly out of scope 2}

## Requirements

### Functional Requirements

**FR1: {Requirement Name}**
- **Description:** {What the system must do}
- **Acceptance Criteria:**
  - {Criterion 1}
  - {Criterion 2}
- **Priority:** P0 / P1 / P2

### Non-Functional Requirements

**NFR1: {Requirement Name}**
- **Description:** {Performance, security, usability requirement}
- **Acceptance Criteria:**
  - {Measurable criterion}
- **Priority:** P0 / P1 / P2

## Constraints

- {Technical constraint 1}
- {Business constraint 1}

## Dependencies

- {External system 1}
- {Existing component 1}

## High-Level Design (Proposed)

{Brief proposed approach - 2-3 paragraphs}

**Key Components:**
- {Component 1} - {Brief description}

**Alternatives Considered:**
- {Alternative 1} - {Why rejected}

*Design-related open questions are tracked in the [Open Questions](#open-questions) section below.*

## Success Metrics

- {Measurable metric 1}
- {Measurable metric 2}

## Requirement Index

{Traceability matrix for tracking requirements through implementation}

| ID | Description | Priority | Verification | Planned Tasks |
|----|-------------|----------|--------------|---------------|
| FR1 | {Brief description} | P0 | {method: pointer} | {To be filled by oat-project-plan} |
| FR2 | {Brief description} | P1 | {method: pointer} | {To be filled by oat-project-plan} |
| NFR1 | {Brief description} | P0 | {method: pointer} | {To be filled by oat-project-plan} |

**Notes:**
- ID: Unique requirement identifier (FR# for functional, NFR# for non-functional)
- Description: Brief 1-sentence summary of the requirement
- Priority: P0 (must have) / P1 (should have) / P2 (nice to have)
- Verification: How this will be verified — format is `method: pointer`
  - **method**: unit, integration, e2e, manual, perf (can combine: `unit + integration`)
  - **pointer**: brief scope hint for design phase
  - **Examples**: `unit: auth token validation`, `e2e: login flow`, `unit + integration: API contract`, `perf: cache latency`
- Planned Tasks: Filled in during planning phase to ensure traceability

## Open Questions

{Questions that need resolution before or during design/planning}

- **{Category}:** {Question}
- **{Category}:** {Question}

## Assumptions

{Assumptions we're making that need validation during design/implementation}

- {Assumption 1}
- {Assumption 2}

## Risks

{Potential risks and mitigation strategies}

- **{Risk Name}:** {Description}
  - **Likelihood:** Low / Medium / High
  - **Impact:** Low / Medium / High
  - **Mitigation:** {Strategy}

## References

- Discovery: `discovery.md`
- Knowledge Base: `.oat/repo/knowledge/project-index.md`
