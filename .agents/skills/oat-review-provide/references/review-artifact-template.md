# Ad-Hoc Review Artifact Template

Use this template for non-project commit-range reviews.

```markdown
---
oat_generated: true
oat_generated_at: YYYY-MM-DD
oat_review_type: code
oat_review_scope: {scope}
oat_review_scope_mode: {files|unstaged|staged|range}
oat_project: null
oat_review_mode: ad_hoc
---

# Code Review: {scope}

**Reviewed:** YYYY-MM-DD
**Range:** {SCOPE_RANGE}
**Files reviewed:** {N}

## Summary

{2-3 sentence summary}

## Findings

### Critical

{None or list}

### Important

{None or list}

### Minor

{None or list}

## Verification Commands

```bash
{command 1}
{command 2}
```

## Next Step

- If this review should feed an OAT project lifecycle, import/attach it to that project and run `oat-project-review-receive`.
- Otherwise, apply fixes directly and re-run `oat-review-provide` for a follow-up pass.
```
