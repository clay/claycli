# Claude Rule Frontmatter

Claude Code rules live at `.claude/rules/*.md`. They use `paths` as the only frontmatter field.

## Unconditional (Always-On)

No frontmatter needed — plain markdown files without `---` delimiters are always loaded.

```markdown
# {Rule Title}

{Rule body — identical to glob-scoped-rule.md template body}
```

## Conditional (Path-Scoped)

Uses `paths` frontmatter — an array of glob patterns.

```yaml
---
paths:
  - "{glob-pattern-1}"
  - "{glob-pattern-2}"
---

# {Rule Title}

{Rule body — identical to glob-scoped-rule.md template body}
```

## Examples

### Single glob

```yaml
---
paths:
  - "src/api/**/*.ts"
---
```

### Multiple globs

```yaml
---
paths:
  - "src/**/*.test.ts"
  - "tests/**/*.ts"
---
```

### Brace expansion

```yaml
---
paths:
  - "src/**/*.{ts,tsx}"
---
```

## Reference

- Location: `.claude/rules/*.md`
- Subdirectories supported and recursively discovered
- Symlinks supported
- Only documented frontmatter field: `paths` (array of glob strings)
- Activation: rule loads when Claude reads files matching any pattern in `paths`
- See `references/docs/rules-files.md` section 2.5 for full details
