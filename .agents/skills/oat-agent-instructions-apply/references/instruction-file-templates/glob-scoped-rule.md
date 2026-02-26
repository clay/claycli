# Glob-Scoped Rule Body Template

Use this template for the **body content** of glob-scoped rules. This body is shared identically across all providers (Claude, Cursor, Copilot) — only the frontmatter differs per provider.

See `frontmatter/` for provider-specific frontmatter examples.

## Template

```markdown
# {Rule Title}

{1-2 sentences describing what this rule covers and when it applies.}

## Conventions

- {Convention 1 — e.g., "All components must export a default function component"}
- {Convention 2}
- {Convention 3}

## Patterns

{Describe expected patterns for files matching this rule's glob.}

- {Pattern 1 — e.g., "Use `describe`/`it` blocks, not `test` blocks"}
- {Pattern 2}

## Examples

{Optional: include a short before/after or canonical example.}

### Correct

```{lang}
{example}
```

### Incorrect

```{lang}
{counter-example}
```
```

## Guidance

- Target: <80 lines (body only, excluding frontmatter)
- Write for the specific file pattern — don't repeat general project conventions
- Keep instructions concrete and actionable, not aspirational
- This body is used verbatim across Claude rules, Cursor rules, and Copilot instructions
- Only the frontmatter wrapper changes per provider (see `frontmatter/` directory)
