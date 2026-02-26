# Cursor Rule Frontmatter

Cursor rules live at `.cursor/rules/*.mdc` (or `.md`). They use three frontmatter fields: `description`, `alwaysApply`, and `globs`.

## Always-On

```yaml
---
description: "{Brief purpose — used by agent for relevance decisions}"
alwaysApply: true
---

# {Rule Title}

{Rule body — identical to glob-scoped-rule.md template body}
```

## Glob-Scoped (Auto Attached)

```yaml
---
description: "{Brief purpose}"
alwaysApply: false
globs:
  - "{glob-pattern-1}"
  - "{glob-pattern-2}"
---

# {Rule Title}

{Rule body — identical to glob-scoped-rule.md template body}
```

## Agent Requested (No Globs)

```yaml
---
description: "{Descriptive purpose — agent decides when to apply based on this}"
alwaysApply: false
---

# {Rule Title}

{Rule body — identical to glob-scoped-rule.md template body}
```

## Activation Mode Matrix

| Configuration | Mode |
|---|---|
| `alwaysApply: true` | Always — included in every session |
| `alwaysApply: false` + `globs` set | Auto Attached — included when matching files appear |
| `alwaysApply: false` + `description` (no globs) | Agent Requested — agent decides based on description |
| No frontmatter | Manual — user must @-mention the rule |

## Examples

### TypeScript components

```yaml
---
description: "React component conventions for the frontend"
alwaysApply: false
globs:
  - "src/components/**/*.tsx"
---
```

### Test files

```yaml
---
description: "Testing conventions and patterns"
alwaysApply: false
globs:
  - "**/*.test.ts"
  - "**/*.spec.ts"
---
```

## Reference

- Location: `.cursor/rules/*.mdc` or `.cursor/rules/*.md`
- Naming: kebab-case recommended (e.g., `code-style-guide.mdc`)
- Three frontmatter fields: `description` (string), `alwaysApply` (boolean), `globs` (string or array)
- `@filename.ts` syntax supported for file references within rules
- See `references/docs/cursor-rules-files.md` section 3 for full field reference
