# Root AGENTS.md Template

Use this template when generating a root-level AGENTS.md file. This is the canonical, provider-agnostic instruction file — all providers read it.

## Template

```markdown
# {Project Name}

## Development Commands

### Essential Commands
- `{install-command}` - Install dependencies
- `{dev-command}` - Start development server
- `{build-command}` - Build for production
- `{test-command}` - Run tests
- `{lint-command}` - Lint code

### Additional Commands
- {Any project-specific commands}

## Architecture Overview

{2-4 sentences describing the project structure, key modules, and how they relate.}

### Key Directories
- `{dir/}` - {purpose}
- `{dir/}` - {purpose}

### Technology Stack
- **Runtime:** {e.g., Node.js 22, Python 3.12}
- **Framework:** {e.g., Next.js 15, FastAPI}
- **Build:** {e.g., Turborepo, Webpack}
- **Testing:** {e.g., Vitest, pytest}

## Code Conventions

### Style
- {Key style rules — formatting, naming, imports}

### Patterns
- {Key architectural patterns — e.g., "prefer composition over inheritance"}

### Non-Negotiables
- {Security rules, access control patterns}
- {Data handling requirements}
- {Error handling conventions}

## Definition of Done

- [ ] Tests pass (`{test-command}`)
- [ ] Lint clean (`{lint-command}`)
- [ ] Type check passes (`{type-check-command}`)
- [ ] Build succeeds (`{build-command}`)
```

## Guidance

- Target: <300 lines (hard max 500)
- Canonical commands should appear in the first screenful
- Non-negotiables (security, data handling) should be near the top
- Don't duplicate content that belongs in scoped files
- This file is read by ALL providers — keep it provider-agnostic
