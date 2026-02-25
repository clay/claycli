# Agent Instruction Files Standard

## Practical Playbook (Generalized Edition)

**Generated:** 2026-02-16T16:20:50.389314 UTC

This document is a generalized, cross-tool version of an internal AGENTS.md standard playbook.

It is intended to be embedded in repositories as a human- and agent-readable reference for:

- How to structure **AGENTS.md**
- How to structure **CLAUDE.md**
- How to use **Claude modular rules** (`.claude/rules/*.md`)
- How to use **Cursor rules** (`.cursor/rules/*.md` / `.mdc`)
- How to align with **GitHub Copilot** instructions
- How to remain compatible with **OpenAI Codex** AGENTS.md loading behavior

**Out of scope:** automation wiring (CI bots, scheduled agents, workflow orchestration).
**Skills specifications:** intentionally separate (see `agents-md-skills-spec.md`).

---

## Table of Contents

1. What These Files Are
2. Why This Matters
3. Research-Informed Constraints
4. Hierarchy, Traversal, and Override Semantics
5. Composition Strategies (Import, Symlink, Parallel)
6. Size and Cognitive Load Budgets
7. Root File Structure (Playbook)
8. Project Structure Guidance
9. Testing Guidance
10. Examples
11. Safety and Permissions
12. Domain Rules (Optional)
13. Scoped Files (When and How)
14. Modular Rules (Claude and Cursor)
15. Copilot Notes
16. Anti-Patterns
17. Final Quality Checklist
18. References

---

# 1. What These Files Are

Agent instruction files are structured Markdown documents that provide operational context to AI coding agents working in a repository.

They are **not** README replacements and they are **not** task prompts.

They should encode:

- Executable workflows (exact commands)
- Concrete conventions (dos/don'ts)
- Boundaries and approvals (what's risky)
- Stable architecture orientation (capabilities over brittle paths)

Common instruction surfaces:

- `AGENTS.md` (open ecosystem pattern)
- `AGENTS.override.md` (Codex per-directory override pattern)
- `CLAUDE.md` (Claude Code project instructions; may be nested)
- `CLAUDE.local.md` (Claude local overrides; may exist at multiple levels)
- `.claude/rules/*.md` (Claude topic rules)
- `.cursor/rules/*.md` / `.mdc` (Cursor rules)
- `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md` (Copilot)

---

# 2. Why This Matters

AI coding agents operate probabilistically. When repository context is implicit, fragmented, or stale, agents will guess.

Consequences:

- Wrong commands, wrong scripts, wrong environments
- Convention drift and inconsistent code
- Higher review burden
- Wasted tokens and longer loops
- Silent correctness drift over time

A good instruction system reduces "context entropy" and improves first-pass change quality.

---

# 3. Research-Informed Constraints

These design constraints are supported by empirical findings about instruction following and long-context behavior.

## 3.1 Instruction Overload

ManyIFEval ("Curse of Instructions"): as instruction count rises, compliance drops.

**Implication:** keep global rules short; scope where possible; avoid giant root files.

## 3.2 Positional Recall Bias

"Lost in the Middle": models recall content at the beginning and end more reliably than mid-context.

**Implication:** put canonical commands and non-negotiables near the top.

## 3.3 Context Degradation

Long contexts degrade retrieval precision ("context rot"-style effects).

**Implication:** treat tokens as scarce; avoid duplication; prefer links to deeper docs.

---

# 4. Hierarchy, Traversal, and Override Semantics

## 4.1 Directory Traversal Model (Conceptual)

Most tools determine applicable instruction files by:

1. Finding a project root (often Git root)
2. Walking down to the current working directory
3. Checking each directory for instruction files
4. Layering general to specific

## 4.2 Per-Directory File Types

At any directory level, you may have:

- A **primary** instruction file (e.g., `AGENTS.md`, `CLAUDE.md`)
- A **shared override** file (e.g., `AGENTS.override.md`) -- **version controlled**
- A **local override** file (e.g., `CLAUDE.local.md`) -- **typically not version controlled**
- Tool-specific modular rules (e.g., `.claude/rules/*.md`, `.cursor/rules/*.md`)

These may appear in user scope, repo root, or nested subdirectories.

## 4.3 Shared vs Local Overrides (Explicit)

### Shared override files (version controlled)

Example: `/apps/web/AGENTS.override.md`

- Committed and reviewed like code
- Used to specialize subtree behavior
- Should be minimal and explicit (avoid copying root)

### Local override files (not version controlled)

Example: `/apps/web/CLAUDE.local.md`

- Developer-specific, local-only
- Useful for experimentation/workflow tuning
- Must **not** encode team policy
- Must **not** override security non-negotiables

### Global user overrides (high blast radius)

Example: `~/.codex/AGENTS.override.md`

- Affects multiple repos
- Use sparingly and temporarily
- Easy to forget

## 4.4 "One Meaningful File per Directory" (Design Rule)

Codex explicitly states it includes at most one file per directory (override preferred). Other tools merge differently.

**To stay portable across tools:** design so that only one meaningful primary/override applies per directory, and keep overrides explicit.

## 4.5 Precedence Rules

Within a directory:

1. Shared override (if present)
2. Else primary file

Across directories:

- Deeper (more specific) overrides higher-level guidance

If import/include syntax is used, later content overrides earlier content.

## 4.6 Tool Variance Warning

Codex, Claude, Cursor, and Copilot do not implement identical merging. Avoid relying on subtle undocumented precedence behavior.

---

# 5. Composition Strategies (Import, Symlink, Parallel)

Choose one strategy to reduce drift.

## 5.1 Import / Include (Preferred when supported)

Some tools support import/include syntax.

Example (Claude Code):

```markdown
# CLAUDE.md
@AGENTS.md

# Claude-specific additions
- Use .claude/rules for topic-specific rules.
```

Guidelines:

- Imports at the top
- Tool-specific additions after imports
- Avoid deep import chains
- Never allow circular imports

## 5.2 Symbolic Links (Fallback)

If import isn't supported, symlinks can unify files:

- `CLAUDE.md` -> `AGENTS.md`
- `.github/copilot-instructions.md` -> `AGENTS.md`

Caveats:

- Verify OS compatibility (esp. Windows)
- Verify tools resolve symlinks properly
- Avoid partial duplication alongside symlinks

## 5.3 Parallel Files (Least preferred)

If neither import nor symlink works:

- Keep the canonical file minimal
- Link instead of copy/paste
- Audit regularly for divergence

---

# 6. Size and Cognitive Load Budgets

Root files:

- Target <300 lines
- Hard max 500 lines

Scoped files:

- 40-150 lines

Modular rules:

- Prefer <80 lines
- One topic per file

### Provider Hard Limits

| Provider | Limit | Source |
|----------|-------|--------|
| Codex | 32 KiB combined instruction files | OpenAI Codex docs (official) |
| Copilot | ~1,000 lines max per instruction file | GitHub docs (official) |
| Copilot agents | 30,000 chars per agent body | GitHub docs (official) |
| Claude Code | Skill descriptions: 2% of context window (~16,000 chars fallback) | Claude Code docs (official) |
| Cursor | No documented hard limit; 500 lines recommended | Cursor docs (official) |

Use 32 KiB as a safe cross-provider ceiling for total combined instruction content.

**Salience rule:** canonical commands and non-negotiables should appear in the first screenful.

---

# 7. Root File Structure (Playbook)

This structure applies to `AGENTS.md` and `CLAUDE.md` (at repo root).

## 7.1 Project Snapshot (Essential)

2-4 lines: what this repo is + major stack + unusual constraints.

## 7.2 Canonical Commands (Essential)

Agents should never guess commands.

Include:

- install/bootstrap
- dev
- build
- test (fast)
- test (CI/full)
- lint/format
- typecheck

Example:

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm test:ci
pnpm lint
pnpm typecheck
```

If commands require env vars/services, say so explicitly.

## 7.3 Definition of Done (Essential)

Make completion objective:

- Tests pass
- Lint/typecheck pass
- CI-equivalent checks pass
- No debug logs
- Docs updated when needed

## 7.4 Non-Negotiables (Essential)

Put near the top. Examples:

- Never commit secrets
- Do not edit generated directories
- Do not modify deploy/CI without approval
- Do not bypass type checks

Conflict priority: **Security > Correctness > CI Integrity > Performance > Style**

## 7.5 Code Style & Conventions (Essential)

Prefer enforceable rules and "Do / Don't" lists.

## 7.6 Project Structure (Recommended)

Describe capabilities (stable) over brittle paths (volatile).

## 7.7 Testing (Recommended)

Explain how to run scoped tests and CI-equivalent tests.

## 7.8 Examples (Recommended)

Point to preferred patterns and known legacy pitfalls.

## 7.9 Safety & Permissions (Recommended)

Explicit "allowed" vs "ask first" boundaries.

## 7.10 PR/Commit Standards (Recommended)

Define PR expectations, title format, CI requirements.

## 7.11 Domain Concepts (Optional)

Only stable terminology and invariants.

## 7.12 When Stuck (Recommended)

Ask clarifying questions; propose a plan before large changes.

---

# 8. Project Structure Guidance

## 8.1 Prefer capabilities over brittle paths

Good:

- "GraphQL schema lives in the API package."
- "Shared UI components live in the UI package."

Risky:

- "Edit src/components/layout/Header.tsx."

## 8.2 Avoid encoding temporary migration states

Instruction files should describe steady state. Mark legacy explicitly if needed.

---

# 9. Testing Guidance

## 9.1 Provide runnable commands

Include fast and full/CI variants.

## 9.2 Document scoping patterns

Examples:

```bash
pnpm --filter web test
pnpm test path/to/file.spec.ts
```

## 9.3 Clarify expectations

State what requires tests (features, bug fixes) and what is optional.

---

# 10. Examples

Examples reduce ambiguity and improve adherence.

Include:

- A preferred implementation pattern
- A discouraged legacy pattern
- Naming conventions

Keep examples small and high-signal.

---

# 11. Safety and Permissions

Separate:

- **Allowed without approval:** read files, lint, typecheck, unit tests
- **Ask first:** deps, migrations, CI/CD, deploy configs, deleting files

Label destructive commands explicitly.

---

# 12. Domain Rules (Optional)

Include only stable domain constraints. Avoid volatile naming, in-flight migrations, and temporary business rules.

---

# 13. Scoped Files (When and How)

Create scoped files when a subtree has:

- Different tech stack/runtime
- Different build/test workflow
- Stricter security boundaries
- Materially different architecture patterns

Do **not** create scoped files for minor style differences.

Rules:

- Scoped files must not duplicate root
- Override only where divergence exists
- Keep within size budget

---

# 14. Modular Rules (Claude and Cursor)

## 14.1 Claude modular rules: `.claude/rules/*.md`

Use for topic scoping:

- Testing rules
- CI rules
- Security rules
- Formatting rules

Guidelines:

- One topic per file
- Keep atomic and short
- Avoid duplication with root unless overriding

## 14.2 Cursor rules: `.cursor/rules/*.md` / `.mdc`

Use for directory/topic scoping.

Guidelines:

- Concise, atomic files
- Avoid duplication with root instructions
- Keep rule sets narrow and enforceable

## 14.3 Copilot scoped instructions: `.github/instructions/*.instructions.md`

Copilot's scoped instruction files function like rules — they activate conditionally based on file patterns.

Frontmatter fields:

| Field | Description |
|-------|-------------|
| `applyTo` | Glob pattern(s), comma-separated. Relative to workspace root. |
| `description` | Short description; enables semantic matching when no `applyTo`. |
| `name` | Display name in VS Code UI. Defaults to filename. |
| `excludeAgent` | Prevents use by a specific agent (`"code-review"` or `"coding-agent"`). |

Guidelines:

- Scoped instructions are **additive** — they combine with (not replace) `copilot-instructions.md`
- When multiple files match, VS Code combines them with no guaranteed order
- Use `excludeAgent` to prevent code review from applying coding-focused instructions (and vice versa)
- Keep within the ~1,000 line per-file recommendation

---

# 15. Copilot Notes

## 15.1 Instruction Types

| Type | Location | Activation | Purpose |
|------|----------|------------|---------|
| **Repository instructions** | `.github/copilot-instructions.md` | Always-on | Repo-wide conventions |
| **Scoped instructions** | `.github/instructions/*.instructions.md` | `applyTo` glob match | File-type or area-specific rules |
| **Prompt files** | `.github/prompts/*.prompt.md` | Manual (`/name` in chat) | Reusable task templates |
| **Agent files** | `*.agent.md` | Auto or manual | Custom agent definitions |
| **AGENTS.md** | `**/AGENTS.md` | Always-on | Cross-tool instructions |

Instructions = rules/standards (always-on or pattern-matched). Prompt files = tasks/workflows (manually invoked). Keep this distinction clear.

## 15.2 Composability

- Scoped instructions are **additive** to `copilot-instructions.md`, not replacements.
- AGENTS.md is read natively alongside Copilot's own instruction files.
- Avoid conflicts between Copilot instructions and AGENTS/CLAUDE content.
- Prefer a single canonical policy and compose rather than duplicate.

## 15.3 Limitations

- Custom instructions do **not** affect inline code completions (autocomplete).
- Organization instructions (public preview) are limited to GitHub.com chat, code review, and coding agent — not IDE chat.

---

# 16. Anti-Patterns

Avoid:

- >500 lines
- Burying non-negotiables mid-file
- README duplication
- Copy/pasting root content into scoped files
- Circular imports or deep include chains
- Silent precedence inversions
- Task-specific instructions that don't generalize
- Volatile paths that drift with refactors
- Over-scoping monorepos into dozens of tiny files

---

# 17. Final Quality Checklist

Before merging instruction changes:

- [ ] Commands are correct and runnable.
- [ ] Non-negotiables and canonical commands are near the top.
- [ ] No duplication across root/scoped/rule files.
- [ ] Scoped files only exist for real divergence.
- [ ] Overrides are intentional and minimal.
- [ ] No circular imports.
- [ ] File sizes within budgets.
- [ ] Precedence is clear (and tool variance is not relied upon).

---

# 18. References

### Official Documentation

- AGENTS.md ecosystem: <https://agents.md/>
- OpenAI Codex AGENTS.md guide: <https://developers.openai.com/codex/guides/agents-md/>
- Claude Code memory & rules: <https://code.claude.com/docs/en/memory>
- Claude Code best practices: <https://code.claude.com/docs/en/best-practices>
- Cursor rules: <https://cursor.com/docs/context/rules>
- Copilot custom instructions: <https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot>
- Copilot custom agents reference: <https://docs.github.com/en/copilot/reference/custom-agents-configuration>
- VS Code custom instructions: <https://code.visualstudio.com/docs/copilot/customization/custom-instructions>
- VS Code prompt files: <https://code.visualstudio.com/docs/copilot/customization/prompt-files>
- Anthropic context engineering: <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>

### Research

- ManyIFEval ("Curse of Instructions"): <https://openreview.net/forum?id=R6q67CDBCH>
- "Lost in the Middle": <https://arxiv.org/abs/2307.03172>
- Context degradation ("Context Rot"): <https://research.trychroma.com/context-rot>
