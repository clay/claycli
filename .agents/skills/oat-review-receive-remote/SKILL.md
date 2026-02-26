---
name: oat-review-receive-remote
version: 1.0.0
description: Use when processing GitHub PR review comments outside project context. Fetches PR comments via agent-reviews and converts them into actionable task lists.
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion
---

# Remote Review Receive (Ad-hoc GitHub PR)

Process unresolved GitHub PR review feedback into normalized findings and standalone tasks without requiring an active OAT project.

## Prerequisites

- `npx agent-reviews` is available.
- GitHub authentication is configured (`GITHUB_TOKEN`, `.env.local`, or `gh` auth context).
- User wants ad-hoc triage outside project lifecycle artifact mutation.

## Mode Assertion

**OAT MODE: Review Receive**

**Purpose:** Fetch unresolved PR comments, classify findings into standard severities, triage dispositions, and produce standalone tasks.

**BLOCKED Activities:**
- No implementation/code changes.
- No `plan.md`, `state.md`, or `implementation.md` lifecycle mutations.
- No auto-replies on GitHub without explicit user confirmation.

**ALLOWED Activities:**
- Resolve PR scope.
- Fetch unresolved PR comments via `agent-reviews`.
- Normalize and classify findings.
- Interactive triage and task-list generation.
- Optional explicit replies to processed comments.

**Self-Correction Protocol:**
If you catch yourself:
- Replying on GitHub without explicit user confirmation -> STOP and present reply content for approval first.
- Editing project lifecycle artifacts (`plan.md`, `state.md`, `implementation.md`) in ad-hoc mode -> STOP and revert to task-list output only.
- Skipping the findings overview before triage prompts -> STOP and show overview first.

## Progress Indicators (User-Facing)

Print this banner once at start:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 OAT ▸ REMOTE REVIEW RECEIVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use step indicators:
- `[1/6] Resolving PR...`
- `[2/6] Fetching comments...`
- `[3/6] Classifying findings...`
- `[4/6] Triaging findings...`
- `[5/6] Generating task list...`
- `[6/6] Posting replies (optional)...`

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
  source: github_pr
  source_ref: string
  comment_id: string | number
```

Severity conventions:
- `critical`: Broken behavior, security risk, or missing P0 requirement.
- `important`: Missing P1 requirement, major robustness issue.
- `medium`: Meaningful but non-blocking quality/maintainability issue.
- `minor`: Cosmetic/style/documentation issue.

## Process

### Step 1: Resolve PR Number

PR resolution order:
1. `--pr <N>` from `$ARGUMENTS`
2. Auto-detect via `agent-reviews` current-branch resolution

Ask user to confirm resolved PR number before fetching comments.

### Step 2: Fetch Unresolved Comments

Run:

```bash
npx agent-reviews --json --unresolved --pr <N>
```

Expected: JSON payload with unresolved review comments and metadata.

If command fails:
- Capture error details.
- Route user through troubleshooting (auth, network, permissions, invalid PR).

If no unresolved comments are returned:
- Report clean status and stop.

### Step 3: Classify and Normalize Findings

For each item in JSON:
- Capture `type` (`review_comment`, `issue_comment`, `review`).
- Map location fields (`path`, `line`) when present.
- Use comment body + context to assign severity (`critical`, `important`, `medium`, `minor`).
- Treat `CHANGES_REQUESTED` review state as a strong hint toward `important+`, not an automatic override.
- Normalize into the shared findings model.

ID assignment per severity bucket:
- Critical: `C1`, `C2`, ...
- Important: `I1`, `I2`, ...
- Medium: `M1`, `M2`, ...
- Minor: `m1`, `m2`, ...

### Step 4: Present Findings Overview and Triage

Before triage prompts, output:
- Counts per severity
- Compact register: `id`, `title`, `file:line`, `source_ref`

Disposition options per finding:
- `convert` (default for critical/important/medium)
- `defer` (default for minor)
- `dismiss`

Rules:
- Require rationale for `defer`/`dismiss`.
- For medium deferral, require concrete rationale (duplicate, dependency, explicit out-of-scope follow-up, risky churn).

### Step 5: Generate Standalone Task List

Task entry format:

```markdown
- [ ] [important] Add null-guard in OAuth callback parser (`packages/auth/src/callback.ts:142`) - Validate provider payload before dereference.
```

Output modes:
- Inline (default)
- File output path (if user requests)

Also output deferred and dismissed lists with reasons.

### Step 6: Optional GitHub Reply Posting

After task generation, ask:

`Reply to processed comments on GitHub? [yes/no]`

If yes, reply per finding disposition:
- Convert: `npx agent-reviews --reply <id> "Acknowledged - tracking as task"`
- Defer: `npx agent-reviews --reply <id> "Deferred: <reason>"`
- Dismiss: `npx agent-reviews --reply <id> "Won't fix: <reason>"`

Never send replies without explicit user approval.

## Troubleshooting

- Auth failure: verify `GITHUB_TOKEN` and repository access.
- No PR detected: pass explicit `--pr <N>`.
- No unresolved comments found: confirm you are targeting the correct PR and unresolved filter.
- Network/rate limit errors: retry after backoff and report blocked state if persistent.

## Output Contract

At completion, report:
- PR number
- Severity counts
- Converted/deferred/dismissed counts
- Task list output location (`inline` or file path)
- Whether replies were posted

## Success Criteria

- PR scope resolved and confirmed.
- Unresolved comments fetched from GitHub.
- Findings normalized with consistent 4-tier severities.
- Triage completed with explicit rationale capture for deferred/dismissed findings.
- Standalone task list generated.
- Optional replies posted only with user approval.
