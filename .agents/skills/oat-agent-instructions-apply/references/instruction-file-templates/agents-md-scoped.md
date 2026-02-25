# Scoped AGENTS.md Template

Use this template when generating an AGENTS.md for a subdirectory (package, service, module). This supplements the root AGENTS.md with directory-specific guidance.

## Template

```markdown
# {Package/Module Name}

## Commands

- `{test-command}` - Run tests for this package
- `{build-command}` - Build this package
- `{lint-command}` - Lint this package
- {Any package-specific commands}

## Architecture

{2-3 sentences describing this module's purpose, boundaries, and how it fits into the larger project.}

### Key Files
- `{file}` - {purpose}
- `{file}` - {purpose}

### Technology Stack
- **Runtime:** {e.g., Node.js 22, Python 3.12}
- **Framework:** {e.g., Express, FastAPI}
- **Testing:** {e.g., Vitest, pytest}

## Conventions

### Patterns
- {Key patterns specific to this directory — e.g., "all handlers follow the Controller pattern"}

### Non-Negotiables
- {Security or data handling rules specific to this module}
- {Error handling conventions that differ from root}

## Definition of Done

- [ ] Tests pass (`{test-command}`)
- [ ] Lint clean (`{lint-command}`)
- [ ] Type check passes (`{type-check-command}`)
```

## Guidance

- Target: 40–150 lines
- Only create when the directory has genuinely different stack, workflow, or domain requirements
- Do NOT duplicate root-level guidance — only add what's different
- Commands should be runnable from the package directory
- Inherits from root AGENTS.md by default; this file adds or overrides
