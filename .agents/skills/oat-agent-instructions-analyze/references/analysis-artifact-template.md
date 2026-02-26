---
oat_generated: true
oat_generated_at: {YYYY-MM-DD}
oat_analysis_type: agent-instructions
oat_analysis_mode: {full|delta}
oat_analysis_providers: [{providers}]
oat_analysis_commit: {commitHash}
---

# Agent Instructions Analysis: {repo-name}

**Date:** {YYYY-MM-DD}
**Mode:** {full|delta}
**Providers:** {agents_md, claude, cursor, ...}
**Commit:** {short-hash}

## Summary

- **Files evaluated:** {N}
- **Coverage:** {N}% of assessed directories have instruction files
- **Findings:** {N} Critical, {N} High, {N} Medium, {N} Low
- **Delta scope:** {N/A or "N files changed since {base-commit}"}

## Instruction File Inventory

| # | Provider | Format | Path | Lines | Quality |
|---|----------|--------|------|-------|---------|
| 1 | agents_md | AGENTS.md | `AGENTS.md` | {N} | {pass/issues} |
| 2 | agents_md | AGENTS.md | `packages/cli/AGENTS.md` | {N} | {pass/issues} |
| 3 | claude | CLAUDE.md | `CLAUDE.md` | {N} | {pass/issues} |
| ... | | | | | |

## Findings

### Critical

{Findings that actively mislead agents or miss security non-negotiables.}

None | {numbered list}

1. **{Title}**
   - File: `{path}:{line}`
   - Issue: {description}
   - Fix: {specific guidance}

### High

{Significant gaps — important directories without coverage, major drift.}

None | {numbered list}

### Medium

{Quality issues — over size budget, duplication, stale commands, cross-format body divergence.}

None | {numbered list}

### Low

{Polish — could be better structured, minor staleness.}

None | {numbered list}

## Coverage Gaps

### Directory Coverage

Directories assessed as needing instruction files but currently uncovered.

| # | Directory | Reason | Severity |
|---|-----------|--------|----------|
| 1 | `{path/}` | {Has own package.json / distinct domain / ...} | {High/Medium} |
| ... | | | |

{Or: "No directory coverage gaps identified."}

### Glob-Scoped Rule Opportunities

File-type patterns with recurring conventions that would benefit from targeted rules files. These are cross-cutting concerns that span multiple directories — best addressed with glob-scoped rules rather than directory-level AGENTS.md files.

| # | Pattern | Count | Convention Summary | Severity |
|---|---------|-------|--------------------|----------|
| 1 | `{glob}` | {N} | {brief description of conventions agents should follow} | {Medium/Low} |
| ... | | | | |

{Or: "No glob-scoped rule opportunities identified."}

## Cross-Format Consistency

{For repos with multiple providers: body divergence between glob-scoped rules targeting the same paths.}

| Rule Target | Claude Body Hash | Cursor Body Hash | Copilot Body Hash | Status |
|-------------|-----------------|-----------------|-------------------|--------|
| `{glob}` | {hash/N/A} | {hash/N/A} | {hash/N/A} | {match/diverged} |

{Or: "Single provider — cross-format check not applicable."}

## Recommendations

Prioritized actions based on findings above.

1. **{Action}** — {rationale} (addresses finding #{N})
2. **{Action}** — {rationale} (addresses gap #{N})
3. ...

## Next Step

Run `oat-agent-instructions-apply` with this artifact to generate or update instruction files.
