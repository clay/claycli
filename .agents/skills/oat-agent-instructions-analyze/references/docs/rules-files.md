# Rules and Instruction Files — Cross-Provider Deep Dive

> Research synthesis compiled 2026-02-19 from official provider documentation.
> For provider-specific links, see [provider-reference.md](./provider-reference.md).
> For the generalized instruction file playbook, see [agent-instruction.md](./agent-instruction.md).

---

## Table of Contents

1. [What This Document Covers](#1-what-this-document-covers)
2. [Claude Code](#2-claude-code)
3. [Cursor](#3-cursor)
4. [GitHub Copilot](#4-github-copilot)
5. [Cross-Provider Comparison](#5-cross-provider-comparison)
6. [Quantitative Data: Sizes, Limits, Token Budgets](#6-quantitative-data-sizes-limits-token-budgets)
7. [Context Engineering Principles](#7-context-engineering-principles)
8. [Best Practices (Cross-Provider Consensus)](#8-best-practices-cross-provider-consensus)
9. [Anti-Patterns](#9-anti-patterns)
10. [Portability Strategy](#10-portability-strategy)
11. [Sources](#11-sources)

---

## 1. What This Document Covers

This document provides a deep, provider-specific reference for **rules files and instruction files** — the mechanisms each tool uses to give persistent, scoped context to AI coding agents. It complements `agent-instruction.md` (the generalized playbook) by going deeper into how each tool actually works.

**Scope:** Claude Code rules & memory, Cursor rules, Copilot instructions. Copilot is included here (rather than only in agent-instruction.md) because its scoped instruction files (`.instructions.md` with `applyTo` globs) function more like rules than like traditional agent instructions — they activate conditionally based on file patterns, just like Claude's path-scoped rules and Cursor's glob-attached rules.

**Out of scope:** Skills, subagents, hooks, plugins (see their respective guides).

---

## 2. Claude Code

### 2.1 File Hierarchy

Source: [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory) (official)

Claude Code loads instruction files from a 6-level hierarchy:

| Memory Type | Location | Purpose | Shared With |
|---|---|---|---|
| **Managed policy** | macOS: `/Library/Application Support/ClaudeCode/CLAUDE.md`; Linux: `/etc/claude-code/CLAUDE.md` | Organization-wide instructions managed by IT/DevOps | All users in org |
| **Project memory** | `./CLAUDE.md` **or** `./.claude/CLAUDE.md` | Team-shared instructions for the project | Team (git) |
| **Project rules** | `./.claude/rules/*.md` | Modular, topic-specific project instructions | Team (git) |
| **User memory** | `~/.claude/CLAUDE.md` | Personal preferences for all projects | Just you |
| **Project local** | `./CLAUDE.local.md` | Personal project-specific preferences | Just you |
| **Auto memory** | `~/.claude/projects/<project>/memory/` | Claude's automatic notes and learnings | Just you |

Both `./CLAUDE.md` and `./.claude/CLAUDE.md` are valid project memory locations. `CLAUDE.local.md` is automatically gitignored.

### 2.2 Discovery and Loading

**Upward recursion at launch:**
> "Claude Code reads memories recursively: starting in the cwd, Claude Code recurses up to (but not including) the root directory `/` and reads any CLAUDE.md or CLAUDE.local.md files it finds."

**Downward discovery on demand:**
> "Claude will also discover CLAUDE.md nested in subtrees under your current working directory. Instead of loading them at launch, they are only included when Claude reads files in those subtrees."

- **Loaded at launch:** All CLAUDE.md files in the directory hierarchy **above** the working directory
- **Loaded on demand:** CLAUDE.md files in **child** directories, only when Claude reads files there
- **Auto memory:** First 200 lines of `MEMORY.md` loaded at startup; topic files read on demand

The `--add-dir` flag gives Claude access to extra directories. CLAUDE.md from those dirs is NOT loaded unless `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` is set.

### 2.3 @-Import Syntax

CLAUDE.md files can import additional files using `@path/to/import`:

```markdown
@AGENTS.md
@docs/git-instructions.md
@~/.claude/my-project-instructions.md
```

Key behaviors:
- Relative paths resolve **relative to the file containing the import**, not the working directory
- Absolute and `@~/` home paths supported
- Recursive imports supported, **max depth of 5 hops**
- NOT evaluated inside markdown code spans or code blocks
- First-time imports trigger a one-time approval dialog per project (cannot be re-prompted if declined)
- For worktrees: use `@~/.claude/my-project-instructions.md` since `CLAUDE.local.md` only exists in one worktree

### 2.4 Override and Merge Semantics

> "More specific instructions take precedence over broader ones."

Precedence (highest to lowest):
1. **Managed policy** (cannot be overridden)
2. **Project rules** (`.claude/rules/*.md`) — same priority as `.claude/CLAUDE.md`
3. **Project memory** (`./CLAUDE.md`)
4. **User memory** (`~/.claude/CLAUDE.md`)
5. **Project local** (`./CLAUDE.local.md`)
6. **Auto memory**

> "User-level rules are loaded before project rules, giving project rules higher priority."

Settings precedence is separate: Managed > CLI args > Local > Project > User. Permission evaluation: deny first, then ask, then allow. First matching rule wins.

### 2.5 Modular Rules (`.claude/rules/`)

All `.md` files in `.claude/rules/` are automatically loaded as project memory. Subdirectories are fully supported and recursively discovered. Symlinks are supported; circular symlinks handled gracefully.

**Unconditional rules** (no frontmatter) load on every session.

**Conditional rules** use `paths` frontmatter — the only documented frontmatter field for rules:

```yaml
---
paths:
  - "src/api/**/*.ts"
  - "src/**/*.{ts,tsx}"
---

# API Development Rules
- All API endpoints must include input validation
```

User-level rules go in `~/.claude/rules/` and apply to all projects (lower priority than project rules).

### 2.6 AGENTS.md Support

**AGENTS.md is NOT natively supported by Claude Code** (GitHub issue #6235 has 2,700+ upvotes, still open). The recommended workaround is a one-line `CLAUDE.md`:

```markdown
@AGENTS.md
```

This leverages @-import. Alternative: symlink `ln -s AGENTS.md CLAUDE.md`.

### 2.7 Skills vs CLAUDE.md vs Rules

Source: [code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices) (official)

| Mechanism | Always loaded | On-demand | Best for |
|---|---|---|---|
| **CLAUDE.md** | Yes | No | Broad project conventions loaded every session |
| **Rules (no paths)** | Yes | No | Focused topic files always relevant to project |
| **Rules (w/ paths)** | No | Yes | File-type-specific conventions |
| **Skills** | Description only | Full content | Domain knowledge, reusable workflows, tasks |
| **Auto memory** | 200 lines | Rest | Claude's own learnings and project patterns |

> "CLAUDE.md is loaded every session, so only include things that apply broadly. For domain knowledge or workflows that are only relevant sometimes, use skills instead."

---

## 3. Cursor

### 3.1 Rule Types

Source: [cursor.com/docs/context/rules](https://cursor.com/docs/context/rules) (official)

Rules provide system-level instructions to Cursor's Agent:

> "Large language models don't retain memory between completions. Rules provide persistent, reusable context at the prompt level."

> "Rule contents are included at the start of the model context."

### 3.2 File Format (.mdc)

Cursor supports `.md` and `.mdc` extensions:

> "Use `.mdc` files with frontmatter to specify `description` and `globs` for more control over when rules are applied."

```yaml
---
description: "Python coding guidelines for backend services"
alwaysApply: false
globs: ["src/**/*.ts", "lib/**/*.ts"]
---

# Rule Title
Rule content in markdown format.
```

Rules support `@filename.ts` syntax to reference files without duplicating content.

### 3.3 Frontmatter Fields — Complete Reference

The official documentation defines **three** frontmatter fields:

| Field | Type | Purpose |
|---|---|---|
| `description` | string | Concise explanation; used by Agent to decide relevance |
| `alwaysApply` | boolean | When `true`, rule included in every session |
| `globs` | string or string[] | File patterns for auto-attachment |

**Activation mode is derived from the combination:**

| Configuration | Resulting Mode |
|---|---|
| `alwaysApply: true` | **Always** — included in every session |
| `alwaysApply: false` + `globs` set | **Auto Attached** — included when matching files appear |
| `alwaysApply: false` + `description` (no globs) | **Agent Requested** — Agent decides based on description |
| No frontmatter / none set | **Manual** — user must @-mention the rule |

> **Note:** `agentRequested` and `manual` are NOT official frontmatter fields — those behaviors are achieved through combinations of the three real fields above.

### 3.4 Rule Scopes

**Project Rules:** `.cursor/rules/` directory, version-controlled, supports subdirectories.

**User Rules:** Configured in **Cursor Settings** UI (Settings > General > Rules for AI). NOT file-system-based — there is no `~/.cursor/rules/` directory. Apply only to Agent (Chat), not to Inline Edit or Cursor Tab.

**Team Rules:** Dashboard-managed, available on Team/Enterprise plans. Can be enforced to prevent user disabling.

### 3.5 AGENTS.md — First-Class Support

Cursor natively reads AGENTS.md:

> "AGENTS.md is a simple markdown file for defining agent instructions. Place it in your project root as an alternative to `.cursor/rules`."

Nested AGENTS.md in subdirectories is supported with hierarchical precedence (more specific wins).

| Aspect | AGENTS.md | .cursor/rules |
|---|---|---|
| Format | Plain markdown | .mdc with frontmatter |
| Activation control | Always on | Four activation modes |
| Glob targeting | No | Yes |
| Cross-tool compat | Yes (Claude, Codex, etc.) | Cursor-specific |

### 3.6 Precedence

> "Rules are applied in this order: Team Rules → Project Rules → User Rules. All applicable rules are merged; earlier sources take precedence when guidance conflicts."

### 3.7 Legacy .cursorrules

> "The `.cursorrules` (legacy) file in your project root is still supported but will be deprecated. We recommend migrating to Project Rules or to AGENTS.md."

### 3.8 Cursor 2.2+ Folder Format (RULE.md)

Source: community references (not confirmed in primary official docs)

As of Cursor 2.2, new rules are created as folders: `.cursor/rules/<name>/RULE.md`. Legacy `.mdc` files continue to work. This is the Cursor UI's default for *new* rules, not a change to how rules are read.

### 3.9 Notepads vs Rules

| Aspect | Rules | Notepads |
|---|---|---|
| Activation | Automatic (various modes) | Manual (@-reference only) |
| Storage | File system (`.cursor/rules/`) | Cursor UI (Explorer sidebar) |
| Version control | Yes (project rules) | No — local to Cursor instance |
| Team sharing | Via repo (project) or dashboard (team) | Not shareable |
| Token usage | Always-on rules consume tokens every session | Only when referenced |

Use rules for standards that should apply automatically. Use notepads for on-demand reference material.

### 3.10 Limitations

Rules only apply to **Agent (Chat)**. They do NOT affect:
- Cursor Tab (autocomplete suggestions)
- Inline Edit (Cmd/Ctrl+K) — for user rules specifically
- Other AI features beyond Agent

---

## 4. GitHub Copilot

### 4.1 Repository-Level Instructions

Source: [docs.github.com](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot) (official)

**File:** `.github/copilot-instructions.md` — always-on, automatically included in every chat request.

> "The instructions in the file(s) are available for use by Copilot as soon as you save the file(s). Instructions are automatically added to requests that you submit to Copilot."

Format: plain Markdown. Whitespace between instructions is ignored. VS Code `/init` command can auto-generate this file. Recommended max: **~1,000 lines**.

### 4.2 Scoped Instruction Files

**Pattern:** `.github/instructions/<NAME>.instructions.md` — activated by file pattern matching (similar to Claude rules and Cursor glob rules).

**Frontmatter — all supported fields:**

| Field | Required | Description |
|---|---|---|
| `applyTo` | No | Glob pattern(s), comma-separated. Relative to workspace root. |
| `description` | No | Short description shown on hover (VS Code). Enables semantic matching when no `applyTo`. |
| `name` | No | Display name in UI (VS Code). Defaults to filename. |
| `excludeAgent` | No | Prevents use by a specific agent. Values: `"code-review"` or `"coding-agent"`. |

```yaml
---
applyTo: "**/*.ts,**/*.tsx"
excludeAgent: "code-review"
---

When writing TypeScript code in this repository...
```

Scoped instructions are **additive** — they combine with (not replace) the main `copilot-instructions.md`:

> "If the path you specify matches a file that Copilot is working on, and a repository-wide custom instructions file also exists, then the instructions from both files are used."

### 4.3 Prompt Files

Source: [code.visualstudio.com](https://code.visualstudio.com/docs/copilot/customization/prompt-files) (official)

**Pattern:** `.github/prompts/<NAME>.prompt.md` — **manually invoked** task templates, fundamentally different from instructions:

> "Unlike custom instructions that apply automatically, you invoke prompt files manually in chat."

Instructions = rules/standards (always-on or pattern-matched). Prompt files = tasks/workflows (manually invoked via `/name`).

**Frontmatter fields:** `name`, `description`, `argument-hint`, `agent`, `model`, `tools`.
Body supports file references (`[name](path)` or `#file:path`), tool references (`#tool:name`), and variable syntax (`${workspaceFolder}`, `${selection}`, `${input:varName}`).

### 4.4 Custom Agent Files

**Pattern:** `*.agent.md` — custom agents with rich frontmatter.

| Field | Required | Description |
|---|---|---|
| `description` | **Yes** | Agent purpose and capabilities |
| `name` | No | Display name |
| `target` | No | `vscode` or `github-copilot` (defaults to both) |
| `tools` | No | List of tool names; defaults to all |
| `infer` | No | Auto-selection based on task context (default: `true`) |
| `mcp-servers` | No | Additional MCP servers (org/enterprise only for direct config) |
| `metadata` | No | Key-value annotation |

Body max: **30,000 characters.**

### 4.5 AGENTS.md Support

Copilot reads AGENTS.md natively. The full list of supported instruction file types:

- `/.github/copilot-instructions.md`
- `/.github/instructions/**/*.instructions.md`
- `**/AGENTS.md`
- `/CLAUDE.md`
- `/GEMINI.md`

VS Code settings: `chat.useAgentsMdFile` (root), `chat.useNestedAgentsMdFiles` (subfolders, experimental).

The coding agent reads `**/AGENTS.md` anywhere in the repo — **nearest file takes precedence** based on proximity to files being edited.

### 4.6 Precedence

> "Personal instructions take the highest priority. Repository instructions come next, and then organization instructions are prioritized last. However, all sets of relevant instructions are provided to Copilot."

1. **Personal** (highest) — via github.com/copilot interface
2. **Repository** — copilot-instructions.md + matching scoped files + AGENTS.md
3. **Organization** (lowest) — via org settings; GitHub.com only (not IDEs), public preview

### 4.7 Coding Agent Environment

**File:** `.github/workflows/copilot-setup-steps.yml` — GitHub Actions workflow for pre-installing dependencies.

> "The job MUST be called `copilot-setup-steps` or it will not be picked up by Copilot."

Must be on the default branch. Timeout capped at 59 minutes. The coding agent has read-only repo access and can only push to `copilot/` branches.

### 4.8 Feature Support Matrix

| Feature | copilot-instructions.md | *.instructions.md | AGENTS.md | Organization |
|---|---|---|---|---|
| Chat (GitHub.com) | Yes | Yes | — | Yes |
| Chat (VS Code) | Yes | Yes | Yes | No |
| Code review | Yes | Yes (configurable) | — | Yes |
| Coding agent | Yes | Yes | Yes | Yes |
| **Code completions** | **No** | **No** | **No** | **No** |

> Custom instructions "are not taken into account for inline suggestions as you type in the editor."

### 4.9 VS Code Settings

| Setting | Purpose |
|---|---|
| `chat.instructionsFilesLocations` | Where to find instruction files |
| `chat.promptFilesLocations` | Where to find prompt files |
| `chat.includeApplyingInstructions` | Enable pattern-based matching |
| `chat.useAgentsMdFile` | Enable AGENTS.md detection |
| `chat.useNestedAgentsMdFiles` | Enable nested AGENTS.md (experimental) |
| `chat.useClaudeMdFile` | Enable CLAUDE.md detection |

---

## 5. Cross-Provider Comparison

### 5.1 File Pattern Scoping

All three providers support file-pattern-based activation — this is the unifying "rules" concept:

| Provider | Mechanism | Frontmatter field | Pattern syntax |
|---|---|---|---|
| Claude Code | `.claude/rules/*.md` | `paths` (array) | Glob: `**/*.ts`, `{src,lib}/**/*.ts` |
| Cursor | `.cursor/rules/*.mdc` | `globs` (string or array) | Glob: `*.tsx`, `src/**/*.ts` |
| Copilot | `.github/instructions/*.instructions.md` | `applyTo` (comma-separated) | Glob: `**/*.ts,**/*.tsx` |

### 5.2 Activation Modes

| Mode | Claude Code | Cursor | Copilot |
|---|---|---|---|
| Always on | Rules without `paths` / CLAUDE.md | `alwaysApply: true` | copilot-instructions.md |
| File-pattern scoped | Rules with `paths` | `globs` set | `applyTo` globs |
| Agent-determined | Skills (via description) | Agent Requested (via description) | N/A (description enables semantic matching in VS Code) |
| Manual invocation | Skills with `disable-model-invocation` | Manual @-mention | Prompt files (`/name`) |

### 5.3 Precedence Comparison

| Provider | Precedence (highest → lowest) |
|---|---|
| Claude Code | Managed > Project rules ≈ Project memory > User memory > Project local > Auto memory |
| Cursor | Team > Project > User |
| Copilot | Personal > Repository > Organization |

### 5.4 AGENTS.md Support

| Provider | Native support | Nested | Import mechanism |
|---|---|---|---|
| Claude Code | **No** (use `@AGENTS.md` import) | N/A | `@path` in CLAUDE.md |
| Cursor | **Yes** (first-class) | Yes (hierarchical) | N/A — read directly |
| Copilot | **Yes** (`**/AGENTS.md`) | Yes (nearest wins) | N/A — read directly |
| Codex | **Yes** (primary format) | Yes (override pattern) | N/A — native |

---

## 6. Quantitative Data: Sizes, Limits, Token Budgets

### Hard Limits (Documented)

| Provider | Limit | Source |
|---|---|---|
| Codex | 32 KiB combined instruction files | OpenAI Codex docs (official) |
| Copilot | ~1,000 lines max per file | GitHub docs (official) |
| Copilot agents | 30,000 chars per agent body | GitHub docs (official) |
| Claude Code | Skill descriptions: 2% of context window (~16,000 chars fallback) | Claude Code docs (official) |
| Cursor | No documented hard limit; 500 lines recommended | Cursor docs (official) |

### Practical Sizing

| Metric | Target | Source type |
|---|---|---|
| Root instruction file | 60–500 lines (300 good target) | Practitioner consensus |
| Scoped rules / .mdc files | Under 50–80 lines each | Community consensus |
| SKILL.md / prompt files | Under 500 lines; move reference to supporting files | Official (Claude) |
| Total instruction budget | Under 32 KiB as safe cross-provider ceiling | Official (Codex) |
| Fresh monorepo session cost | ~20k tokens (10% of 200k budget) | Practitioner ([Shrivu Shankar](https://blog.sshh.io/p/how-i-use-every-claude-code-feature)) |
| LLM instruction adherence | Degrades significantly above 150–200 instructions | [Builder.io](https://www.builder.io/c/docs/ai-instruction-best-practices) (non-official) |

---

## 7. Context Engineering Principles

Source: [Anthropic Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (official)

1. **Context is a finite resource with diminishing returns.** Attention budget constraints mean more context does not equal better results.

2. **Pursue the minimal set** of information that fully outlines expected behavior. Start minimal, add based on observed failures.

3. **Use progressive disclosure.** Always-on rules should be minimal; domain knowledge should load on demand via skills or scoped rules.

4. **Few-shot examples over exhaustive edge case lists.** "Examples are the pictures worth a thousand words."

5. **Structural format.** Organize instructions into distinct sections using Markdown headers. Put critical rules near the top (positional recall bias).

Source: [Martin Fowler](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html) (reputable engineering source)

Context loading strategies:
- **LLM-controlled**: Agent decides when context is needed (skills, agent-requested rules)
- **Human-triggered**: Explicit activation via commands (manual rules, prompt files)
- **Deterministic**: Tool-driven events (hooks, auto-attached rules)

---

## 8. Best Practices (Cross-Provider Consensus)

These practices converge across official docs from Anthropic, GitHub, and Cursor, plus reputable engineering sources.

### What to Include

- Build, test, lint commands the agent cannot guess
- Code style rules that differ from language defaults
- Repository etiquette (branch naming, PR conventions)
- Architectural decisions specific to the project
- Developer environment quirks (required env vars)
- Common gotchas or non-obvious behaviors
- The "WHY" behind conventions (improves edge case handling)
- Three-tier boundaries: Always / Ask First / Never

### What to Exclude

- Anything the agent can figure out by reading code
- Standard language conventions the agent already knows
- Detailed API documentation (link instead)
- Code style that a linter enforces — "never send an LLM to do a linter's job" ([Builder.io](https://www.builder.io/blog/agents-md), non-official)
- Information that changes frequently
- Long explanations or tutorials
- One-off task-specific instructions (pollute long-term context)

### Writing Style

- Use concrete, specific language; avoid vague instructions
- Provide real-world examples from the actual codebase
- Use markdown headings for clear section organization
- Keep instructions short and self-contained
- Use emphasis ("IMPORTANT", "YOU MUST") sparingly for critical rules (Claude official)
- Provide alternatives ("use Y instead") rather than only prohibitions ("never use X")

### Iterative Development

- Start small; add rules based on what the agent gets wrong, not as comprehensive manuals
- "Each addition should solve a real problem you have encountered, not theoretical concerns" ([Addy Osmani](https://addyosmani.com/blog/good-spec/), non-official)
- Treat instruction files like code: review when things go wrong, prune regularly, version control
- "If Claude keeps doing something you don't want despite having a rule against it, the file is probably too long" (Claude official)

---

## 9. Anti-Patterns

### Content Anti-Patterns

1. **Over-specified instruction files**: Too long; agent ignores critical rules lost in noise. Fix: ruthlessly prune.
2. **Vague instructions**: "Most agent files fail because they're too vague." ([Addy Osmani](https://addyosmani.com/blog/good-spec/), non-official) Fix: be specific with examples.
3. **Auto-generated instruction files**: These are high-leverage documents requiring careful manual curation.
4. **Stale rules**: Rules that don't match current framework/API versions cause deprecated code generation.
5. **Kitchen sink sessions**: Mixing unrelated tasks pollutes context. Fix: clear between tasks. (Claude official)
6. **Dumping entire documentation**: Without summarization, this overwhelms the agent. Fix: link to docs instead.

### Structural Anti-Patterns

7. **Copy/pasting root content into scoped files**: Creates drift. Fix: use imports or references.
8. **Circular imports or deep include chains**: Fix: max 5 hops (Claude), keep flat.
9. **Relying on subtle tool-specific precedence**: Different tools merge differently. Fix: design so intent is clear regardless of tool.
10. **Over-scoping monorepos into dozens of tiny files**: Fix: scope only where real divergence exists.

---

## 10. Portability Strategy

### The Fragmentation Problem

Each tool has its own format: Claude (`CLAUDE.md` + `.claude/`), Cursor (`.cursor/rules/*.mdc`), Copilot (`.github/copilot-instructions.md` + `.github/instructions/`), Codex (`AGENTS.md`), Junie (`.junie/guidelines.md`). This creates maintenance burden and content drift.

### AGENTS.md as Convergence Point

AGENTS.md (stewarded by the Linux Foundation's Agentic AI Foundation) has 60,000+ repos and 20+ compatible tools. It serves as the lowest-common-denominator standard — the "EditorConfig for coding agents." It cannot express tool-specific features (glob scoping, skill metadata, hooks) but works for shared content.

### Recommended Layered Approach

1. **Canonical content** in AGENTS.md or a shared source directory
2. **Tool-specific adapters** that import/sync from the canonical source
3. **Tool-specific extensions** for features that don't port (Claude rules with `paths`, Cursor `globs`, Copilot `applyTo`)

The three-tier discovery pattern (global > project root > nested/scoped) is consistent across all providers and provides a natural adapter surface.

---

## 11. Sources

### Official Documentation (Highest Reliability)

- [Claude Code Memory Docs](https://code.claude.com/docs/en/memory) — CLAUDE.md hierarchy, @-imports, rules, auto memory
- [Claude Code Settings](https://code.claude.com/docs/en/settings) — Settings hierarchy, permissions
- [Claude Code Best Practices](https://code.claude.com/docs/en/best-practices) — What to include/exclude, anti-patterns
- [Claude Code Skills](https://code.claude.com/docs/en/skills) — Skills vs rules vs CLAUDE.md
- [Cursor Rules Docs](https://cursor.com/docs/context/rules) — .mdc format, frontmatter, activation modes, AGENTS.md, precedence
- [GitHub Copilot Custom Instructions](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot) — File format, scoped instructions, precedence
- [VS Code Copilot Customization](https://code.visualstudio.com/docs/copilot/customization/custom-instructions) — VS Code settings, AGENTS.md, CLAUDE.md support
- [VS Code Prompt Files](https://code.visualstudio.com/docs/copilot/customization/prompt-files) — Prompt file format and frontmatter
- [GitHub Copilot Custom Agents Reference](https://docs.github.com/en/copilot/reference/custom-agents-configuration) — Agent file format
- [GitHub Copilot Coding Agent Environment](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment) — copilot-setup-steps.yml
- [GitHub Copilot Organization Instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-organization-instructions) — Org-level settings
- [Anthropic Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — Foundational principles
- [AGENTS.md Specification](https://agents.md/) — Cross-tool standard, governance
- [OpenAI Codex AGENTS.md Guide](https://developers.openai.com/codex/guides/agents-md/) — 32KiB limit, hierarchy, override pattern
- [Feature Request: AGENTS.md in Claude Code — Issue #6235](https://github.com/anthropics/claude-code/issues/6235) — Current status

### Reputable Engineering Blogs (High Reliability)

- [Martin Fowler — Context Engineering for Coding Agents](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html) — Context loading strategies taxonomy
- [Addy Osmani — How to Write a Good Spec for AI Agents](https://addyosmani.com/blog/good-spec/) — Spec structure, boundary tiers
- [Builder.io — Skills vs Rules vs Commands](https://www.builder.io/blog/agent-skills-rules-commands) — Taxonomy, progressive disclosure
- [Builder.io — AGENTS.md Guide](https://www.builder.io/blog/agents-md) — Practical tips, safety permissions
- [Trigger.dev — How to Write Great Cursor Rules](https://trigger.dev/blog/cursor-rules) — .mdc best practices
- [.NET Blog — Prompt Files and Instructions Files Explained](https://devblogs.microsoft.com/dotnet/prompt-files-and-instructions-files-explained/) — Copilot prompt files vs instructions

### Practitioner Reports (Medium-High Reliability)

- [Shrivu Shankar — How I Use Every Claude Code Feature](https://blog.sshh.io/p/how-i-use-every-claude-code-feature) — 13KB CLAUDE.md in practice, 20k token startup cost
- [HumanLayer — Writing a Good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md) — 300-line target, 100 instruction max
- [Arun Iyer — Instruction Files for AI Coding Assistants](https://aruniyer.github.io/blog/agents-md-instruction-files.html) — Cross-tool comparison

### Research

- [ManyIFEval — "Curse of Instructions"](https://openreview.net/forum?id=R6q67CDBCH) — Instruction count vs compliance
- ["Lost in the Middle"](https://arxiv.org/abs/2307.03172) — Positional recall bias
- [Context Degradation — Chroma Research](https://research.trychroma.com/context-rot) — Long-context precision loss
