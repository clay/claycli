# Copilot Scoped Instruction Frontmatter

Copilot scoped instructions live at `.github/instructions/*.instructions.md`. They use `applyTo` as the primary activation field.

## Glob-Scoped

```yaml
---
applyTo: "{glob-pattern-1},{glob-pattern-2}"
---

# {Rule Title}

{Rule body — identical to glob-scoped-rule.md template body}
```

## With Optional Fields

```yaml
---
applyTo: "{glob-pattern}"
description: "{Brief purpose — shown on hover in VS Code}"
---

# {Rule Title}

{Rule body — identical to glob-scoped-rule.md template body}
```

## Frontmatter Fields

| Field | Required | Description |
|---|---|---|
| `applyTo` | No | Glob pattern(s), comma-separated. Relative to workspace root. |
| `description` | No | Short description shown on hover (VS Code). Enables semantic matching when no `applyTo`. |
| `name` | No | Display name in UI (VS Code). Defaults to filename. |
| `excludeAgent` | No | Prevents use by a specific agent. Values: `"code-review"` or `"coding-agent"`. |

## Examples

### TypeScript files

```yaml
---
applyTo: "**/*.ts,**/*.tsx"
---
```

### Scoped to directory

```yaml
---
applyTo: "src/api/**/*.ts"
description: "API development conventions"
---
```

### Exclude from code review

```yaml
---
applyTo: "**/*.test.ts"
excludeAgent: "code-review"
---
```

## Reference

- Location: `.github/instructions/*.instructions.md`
- Scoped instructions are additive — they combine with (not replace) `copilot-instructions.md`
- `applyTo` uses comma-separated globs (not arrays like Claude/Cursor)
- See `references/docs/rules-files.md` section 4.2 for full details
