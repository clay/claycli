---
name: oat-review-receive
version: 1.0.0
description: Use when processing review findings outside project context. Converts local review artifacts into actionable task lists.
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion
---

# Review Receive (Ad-hoc Local)

Process local review artifacts into a normalized findings register and generate actionable standalone tasks.

## Prerequisites

- A review artifact exists locally (`.md`).
- User wants ad-hoc triage without mutating OAT project lifecycle artifacts.

## Mode Assertion

**OAT MODE: Review Receive**

**Purpose:** Parse local review findings, classify severity consistently, triage disposition with user input, and generate a task list.

**BLOCKED Activities:**
- No implementation/code changes.
- No `plan.md`, `state.md`, or `implementation.md` lifecycle mutations.
- No silent dismissal/defer decisions.

**ALLOWED Activities:**
- Locating review artifacts.
- Parsing markdown findings into normalized records.
- Presenting findings counts and summaries.
- Interactive triage (`convert`, `defer`, `dismiss`).
- Writing standalone task-list output.

**Self-Correction Protocol:**
If you catch yourself:
- Editing project lifecycle docs in ad-hoc mode -> STOP and revert to task-list output only.
- Triaging without presenting a findings overview first -> STOP and show overview before disposition prompts.
- Skipping Medium finding rationale when proposing deferral -> STOP and collect explicit rationale.

**Recovery:**
1. Re-locate review artifact from the path provided or last known location.
2. Re-parse findings from the artifact (idempotent — no state mutation in ad-hoc mode).
3. Resume triage from the first un-dispositioned finding.

## Progress Indicators (User-Facing)

Print this banner once at start:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 OAT ▸ REVIEW RECEIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use these step indicators:
- `[1/4] Locating review artifact...`
- `[2/4] Parsing findings...`
- `[3/4] Triaging findings...`
- `[4/4] Generating task list...`

## Findings Model

Normalize every finding to this shape:

```yaml
finding:
  id: "C1" | "I1" | "M1" | "m1"
  severity: critical | important | medium | minor
  title: string
  file: string | null
  line: number | null
  body: string
  fix_guidance: string | null
  source: local_artifact
  source_ref: string
```

Severity conventions:
- `critical`: Missing P0 requirements, security vulnerabilities, broken behavior.
- `important`: Missing P1 requirements, major error-handling or maintainability gaps.
- `medium`: P2 issues with meaningful impact.
- `minor`: Low-impact polish/documentation/style issues.

ID conventions:
- Critical: `C1`, `C2`, ...
- Important: `I1`, `I2`, ...
- Medium: `M1`, `M2`, ...
- Minor: `m1`, `m2`, ...

## Process

### Step 1: Locate Review Artifact

Artifact source priority:
1. Explicit path from `$ARGUMENTS`
2. Most recent file under `.oat/repo/reviews/`
3. Most recent file under `.oat/projects/local/orphan-reviews/`

Discovery command example:

```bash
ls -t .oat/repo/reviews/*.md .oat/projects/local/orphan-reviews/*.md 2>/dev/null | head -20
```

If multiple candidates are plausible, present a numbered list and ask the user to pick one.

Validation:
- File exists and is readable.
- Extension is `.md` (or confirm nonstandard markdown extension).
- Content is non-empty.

### Step 2: Parse Findings

Parse by severity sections/headings using case-insensitive matching:
- `Critical`
- `Important`
- `Medium`
- `Minor`

Compatibility rule:
- If artifact uses a 3-tier model (no Medium section), treat Medium as zero findings.

Extraction guidance per finding item:
- Derive `title` from first concise clause/line.
- Extract `file` + `line` if present in common patterns (`path:line`, fenced diff context, inline references).
- Populate `body` with the finding detail.
- Populate `fix_guidance` when explicit fix direction exists.
- Set `source: local_artifact`.
- Set `source_ref` to the artifact path.

### Step 3: Present Findings Overview

Before asking for dispositions, print:
- Total counts per severity.
- A compact finding register grouped by severity, each showing:
  - `id`
  - `title`
  - `file:line` (or `-`)

Example summary:

```text
Critical: 1
Important: 2
Medium: 1
Minor: 3
```

If there are zero findings across all severities, output a clean result and stop.

### Step 4: Interactive Triage

For each finding, ask for disposition:
- `convert` -> create standalone task entry
- `defer` -> keep out of current task list, record reason
- `dismiss` -> close without task, record reason

Default suggestions:
- Critical -> `convert`
- Important -> `convert`
- Medium -> `convert` (propose `defer` only with concrete rationale)
- Minor -> `defer`

Rules:
- Require explicit rationale for `defer` or `dismiss`.
- Do not silently skip findings.

### Step 5: Generate Task List Output

Generate standalone markdown tasks (no plan task IDs):

```markdown
- [ ] [critical] Fix auth bypass in token validator (`src/auth/token.ts:91`) - Enforce issuer/audience validation.
```

Output modes:
- Inline (default)
- File output path (if user requests), for example:
  - `.oat/projects/local/orphan-reviews/review-tasks-YYYY-MM-DD.md`

Also output deferred and dismissed findings with reasons.

## Output Contract

At completion, report:
- Artifact path used
- Counts by severity
- Number converted/deferred/dismissed
- Task list location (`inline` or file path)

## Success Criteria

- Local artifact resolved and validated.
- Findings parsed into 4-tier normalized structure.
- Findings overview displayed before triage.
- Every finding dispositioned with rationale where needed.
- Standalone task list generated in requested output mode.
- Skill remains within content budget (`<=500` lines).
