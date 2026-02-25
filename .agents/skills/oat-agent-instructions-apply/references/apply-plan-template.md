---
oat_generated: true
oat_generated_at: {YYYY-MM-DD}
oat_apply_type: agent-instructions
oat_source_analysis: {analysis-artifact-path}
oat_providers: [{providers}]
---

# Agent Instructions Apply Plan

**Date:** {YYYY-MM-DD}
**Source Analysis:** `{analysis-artifact-path}`
**Providers:** {agents_md, claude, cursor, ...}

## Instructions

Review each recommendation below. Mark your decision for each:
- **approve** — generate/update the file as described
- **modify** — approve with changes (add notes)
- **skip** — do not act on this recommendation

## Recommendations

### {N}. {Action}: `{target-file-path}`

| Field | Value |
|---|---|
| Action | {create / update} |
| Provider | {agents_md / claude / cursor / copilot} |
| Format | {AGENTS.md / Claude rule / Cursor rule / Copilot instruction / Copilot shim} |
| Target | `{target-file-path}` |
| Rationale | {Why — references analysis finding #N or coverage gap #N} |
| Template | `{template-file-path}` |

**Context:** {1-2 sentences describing what this file will contain and why it's needed.}

**Decision:** {approve / modify / skip}
**Notes:** {User notes if modifying}

---

{Repeat for each recommendation}

## Summary of Approved Actions

| # | Action | Target | Provider |
|---|--------|--------|----------|
| {N} | {create/update} | `{path}` | {provider} |
| ... | | | |

**Total:** {N} files to create, {N} files to update, {N} skipped

## Proceed?

Confirm to begin generating/updating the approved instruction files.
