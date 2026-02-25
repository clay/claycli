---
oat_generated: true
oat_generated_at: 2026-02-25
oat_analysis_type: agent-instructions
oat_analysis_mode: full
oat_analysis_providers: [agents_md, claude, codex, cursor]
oat_analysis_commit: c95a1d0
---

# Agent Instructions Analysis: claycli

**Date:** 2026-02-25
**Mode:** full
**Providers:** agents_md, claude, codex, cursor
**Commit:** c95a1d0

## Summary

- **Files evaluated:** 0
- **Coverage:** 0% of assessed directories have instruction files
- **Findings:** 1 Critical, 2 High, 0 Medium, 0 Low
- **Delta scope:** N/A (full analysis)

## Instruction File Inventory

No instruction files found across any provider.

| # | Provider | Format | Path | Lines | Quality |
|---|----------|--------|------|-------|---------|
| — | — | — | — | — | — |

## Findings

### Critical

1. **No instruction files exist in the repository**
   - File: (none)
   - Issue: No AGENTS.md, CLAUDE.md, `.claude/rules/`, `.cursor/rules/`, or `.codex/` instruction files exist. Agents operating in this repository have zero project-specific guidance — they will rely entirely on generic behavior, leading to inconsistent output, wrong commands, and missed conventions.
   - Fix: Create a root `AGENTS.md` as the single source of truth. Run `oat-agent-instructions-apply` to generate instruction files for all active providers (claude, codex, cursor) from the AGENTS.md baseline.

### High

1. **Root directory uncovered — CLI tool with build/test/lint workflow**
   - Directory: `/` (root)
   - Issue: The root contains a Node.js CLI tool (`claycli`) with 60 source files, custom ESLint config, Jest test setup, and CircleCI CI/CD. Without a root instruction file, agents won't know the canonical commands (`npm run lint`, `npm test`), coding conventions (2-space indent, single quotes, strict mode, CommonJS modules), or the project's architecture (lib/ for core, cli/ for entry points).
   - Fix: Create root `AGENTS.md` covering: tech stack (Node.js, CommonJS, Jest, ESLint), canonical commands, code style non-negotiables (from `.eslintrc`), testing patterns (co-located `*.test.js` files, `jest-fetch-mock`, `mock-fs`), and definition of done.

2. **`website/` directory uncovered — different tech stack**
   - Directory: `website/`
   - Issue: The `website/` directory is a Docusaurus 1.x documentation site with its own `package.json` and entirely different build system (`docusaurus-build`, `docusaurus-start`). It uses different commands, different tooling, and deploys via `gh-pages`. This is a distinct tech stack from the root CLI project.
   - Fix: Create a scoped `website/AGENTS.md` covering the Docusaurus build workflow and deployment process, or add a glob-scoped rule for `website/**`.

### Medium

None

### Low

None

## Coverage Gaps

### Directory Coverage

Directories assessed as needing instruction files but currently uncovered.

| # | Directory | Reason | Severity |
|---|-----------|--------|----------|
| 1 | `/` (root) | Has own package.json, public API (CLI tool), significant codebase (60 JS files), custom ESLint/Jest config, CircleCI CI/CD | High |
| 2 | `website/` | Has own package.json, different tech stack (Docusaurus vs Node.js CLI) | High |

Directories assessed but NOT flagged (too small or covered by root):
- `lib/` — 29 files but same stack as root, would be covered by root AGENTS.md
- `cli/` — 15 files but same stack as root, would be covered by root AGENTS.md
- `lib/cmd/compile/` — 9 files, same stack, covered by root
- `lib/cmd/pack/` — 3 files, too small
- `lib/gulp-plugins/` — 2 files, too small
- `docs/` — documentation only, no source code

### Glob-Scoped Rule Opportunities

File-type patterns with recurring conventions that would benefit from targeted rules files.

| # | Pattern | Count | Convention Summary | Severity |
|---|---------|-------|--------------------|----------|
| 1 | `**/*.test.js` | 12 | Jest tests with co-located naming (`foo.test.js` next to `foo.js`), uses `jest-fetch-mock` for HTTP mocking, `mock-fs` for filesystem mocking, `jest-mock-console` for console assertions. Coverage collected automatically. | Medium |
| 2 | `lib/cmd/*.js` | 8 | CLI command modules — each exports functions consumed by yargs CLI handlers. Import/export/config/lint commands with consistent patterns. | Low |

## Cross-Format Consistency

No instruction files exist — cross-format check not applicable.

## Recommendations

Prioritized actions based on findings above.

1. **Create root `AGENTS.md`** — establishes the single source of truth for all agents operating in this repository. Should cover tech stack, canonical commands, code style, testing patterns, and definition of done. (addresses Critical finding #1, High finding #1)
2. **Create `website/AGENTS.md`** — provides distinct guidance for the Docusaurus documentation site which has a different build system and workflow. (addresses High finding #2)
3. **Generate provider-specific files** — once AGENTS.md files exist, generate `.claude/rules/`, `.cursor/rules/*.mdc`, and `.codex/` instruction files for cross-provider coverage. (addresses Critical finding #1)
4. **Consider glob-scoped test rule** — a `**/*.test.js` rule would give agents explicit guidance on test conventions, mocking patterns, and assertion style. (addresses glob opportunity #1)

## Key Project Facts for Instruction File Generation

These facts were gathered during analysis and should inform the `apply` step:

- **Name:** claycli (Clay CLI)
- **Language:** JavaScript (Node.js, CommonJS modules — NOT ESM)
- **Package manager:** npm
- **Test framework:** Jest 24 with `jest-fetch-mock`, `mock-fs`, `jest-mock-console`
- **Linter:** ESLint 7 with `@babel/eslint-parser`
- **CI:** CircleCI
- **Style:** 2-space indent, single quotes, semicolons, strict mode, `1tbs` brace style
- **Complexity limits:** max cyclomatic complexity 8, max nesting depth 4, max params 4
- **Commands:** `npm run lint`, `npm test` (lint + jest), `npm run watch` (jest --watch)
- **Architecture:** `lib/` (core library), `cli/` (yargs-based CLI entry points), `website/` (Docusaurus docs)
- **Build tooling:** Browserify, Webpack 5, Gulp 4, Babel (for compilation features the CLI provides)

## Next Step

Run `oat-agent-instructions-apply` with this artifact to generate or update instruction files.
