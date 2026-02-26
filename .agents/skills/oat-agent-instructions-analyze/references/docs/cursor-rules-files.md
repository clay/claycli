# Cursor Rules System -- Deep Research Synthesis

> **Research date:** 2026-02-19
> **Primary source:** Official Cursor documentation at `cursor.com/docs/context/rules`
> **Secondary sources:** Community references, cross-validated (see Source Index)

---

## Table of Contents

1. [Overview and Architecture](#1-overview-and-architecture)
2. [File Format Specification (.mdc)](#2-file-format-specification-mdc)
3. [Frontmatter Fields -- Complete Reference](#3-frontmatter-fields----complete-reference)
4. [Rule Types and Activation Modes](#4-rule-types-and-activation-modes)
5. [Rule Scopes: Project, User, and Team](#5-rule-scopes-project-user-and-team)
6. [AGENTS.md Integration](#6-agentsmd-integration)
7. [Rule Precedence and Loading](#7-rule-precedence-and-loading)
8. [Legacy .cursorrules File](#8-legacy-cursorrules-file)
9. [Cursor 2.2+ Folder-Based Format (RULE.md)](#9-cursor-22-folder-based-format-rulemd)
10. [Notepads vs Rules](#10-notepads-vs-rules)
11. [Best Practices from Official Docs](#11-best-practices-from-official-docs)
12. [Limitations](#12-limitations)
13. [Source Index](#13-source-index)

---

## 1. Overview and Architecture

**Source: cursor.com/docs/context/rules (official)**

Rules provide system-level instructions to Cursor's Agent. The official documentation explains the core rationale:

> "Large language models don't retain memory between completions. Rules provide persistent, reusable context at the prompt level."

When rules are activated:

> "Rule contents are included at the start of the model context."

Rules bundle prompts and instructions that persist across chat sessions, removing the need to repeat project conventions, style preferences, or architectural constraints in every interaction.

---

## 2. File Format Specification (.mdc)

**Source: cursor.com/docs/context/rules (official), community references**

### Supported Extensions

The official documentation states:

> "Cursor supports `.md` and `.mdc` extensions. Use `.mdc` files with frontmatter to specify `description` and `globs` for more control over when rules are applied."

- **`.mdc` files** -- Markdown with YAML frontmatter for structured metadata control
- **`.md` files** -- Plain markdown without frontmatter; simpler but less activation control

### File Structure

An `.mdc` file has two sections:

1. **YAML frontmatter** (delimited by `---`) containing metadata
2. **Markdown body** containing the rule instructions

```yaml
---
description: "Brief explanation of rule purpose"
alwaysApply: false
globs: ["src/**/*.ts", "lib/**/*.ts"]
---

# Rule Title

Rule content in markdown format.

- Instruction one
- Instruction two

## Code Examples

Reference files with @filename.ts syntax.
```

### File References

Rules support the `@filename.ts` syntax to include external files in the rule context, enabling templates and reusable code snippets without duplicating content.

### Naming Convention

Community best practice (mer.vin source):

- Use **kebab-case**: `code-style-guide.mdc`
- Choose descriptive names indicating purpose
- Group related rules: `code-style-javascript.mdc`, `code-style-python.mdc`

---

## 3. Frontmatter Fields -- Complete Reference

**Source: cursor.com/docs/context/rules (official)**

The official documentation defines **three** frontmatter fields. No additional fields are documented.

### `description` (string)

- **Purpose:** A concise explanation of the rule's purpose.
- **Used by:** The Agent, to determine whether to apply the rule when in "Apply Intelligently" (agent-requested) mode.
- **Required for:** "Apply Intelligently" type rules -- without a description, the Agent has no basis for deciding relevance.
- **Example:** `description: "Python coding guidelines for backend services"`

### `alwaysApply` (boolean)

- **Purpose:** Controls whether the rule is automatically included in every chat session.
- **Values:** `true` or `false`
- **When `true`:** The rule is included in every chat session regardless of context. Any `globs` listed are parsed but effectively ignored in this mode.
- **When `false`:** The Agent decides based on the `description` field and/or `globs` pattern.
- **Official quote:** "The rule will be applied to every chat session."

### `globs` (string or string array)

- **Purpose:** File path patterns determining when the rule is automatically attached.
- **Format:** Standard glob patterns.
- **Examples:** `"*.tsx"`, `["src/**/*.ts", "lib/**/*.ts"]`, `"src/components/**/*"`
- **Behavior:** "Auto-applies when matching files are referenced" in conversation.

### Activation Mode Matrix

The activation mode is determined by the **combination** of frontmatter fields:

| Configuration | Resulting Mode |
|---|---|
| `alwaysApply: true` | **Always** -- included in every session |
| `alwaysApply: false` + `globs` set | **Auto Attached** -- included when matching files appear |
| `alwaysApply: false` + `description` set (no globs) | **Agent Requested** -- Agent decides based on description |
| No frontmatter / none of the above | **Manual** -- user must @-mention the rule |

### Fields NOT in Official Documentation

The following field names appear in some community discussions but are **not confirmed in official Cursor documentation** as of this research date:

- **`agentRequested`** -- not an official frontmatter field. Agent-requested behavior is achieved by setting `alwaysApply: false` with a `description` and no `globs`.
- **`manual`** -- not an official frontmatter field. Manual mode is the default when no activation metadata is present.

The official docs use a UI-based "type dropdown" in the Cursor Settings interface to control rule type, which maps to the three frontmatter fields above.

---

## 4. Rule Types and Activation Modes

**Source: cursor.com/docs/context/rules (official)**

The official documentation defines four application modes:

### Always Apply

> "Apply to every chat session."

- **Frontmatter:** `alwaysApply: true`
- **Use case:** Universal project standards, architectural constraints, language preferences.
- **Behavior:** Included in context for every Agent interaction regardless of what files are being discussed.

### Apply Intelligently (Agent Requested)

> "When Agent decides it's relevant based on description."

- **Frontmatter:** `alwaysApply: false`, `description` set, no `globs`
- **Use case:** Rules that are only relevant in certain conversational contexts.
- **Behavior:** The Agent reads the rule's `description` and decides whether to load the full rule content into context. This is a two-step process: the Agent first sees descriptions of available rules, then requests full content for relevant ones.

### Apply to Specific Files (Auto Attached)

> "When file matches a specified pattern."

- **Frontmatter:** `globs` set with file patterns
- **Use case:** Language-specific or directory-specific conventions.
- **Behavior:** Automatically included when files matching the glob pattern are referenced in the conversation.

### Apply Manually

> "When @-mentioned in chat (e.g., `@my-rule`)."

- **Frontmatter:** None of the activation fields set (or no frontmatter at all).
- **Use case:** Specialized rules needed only on demand.
- **Behavior:** User explicitly invokes the rule by typing `@rule-name` in the chat.

---

## 5. Rule Scopes: Project, User, and Team

**Source: cursor.com/docs/context/rules (official)**

### Project Rules

> "Stored in `.cursor/rules`, version-controlled and scoped to your codebase."

- **Location:** `.cursor/rules/` directory in the project root.
- **Format:** `.mdc` or `.md` files.
- **Version control:** Yes -- intended to be committed to the repository.
- **Scope:** Applies to all users working on the project.
- **Organization:** Can use subdirectories for hierarchical organization.

```
.cursor/rules/
  code-style.mdc
  testing.mdc
  frontend/
    components.mdc
    styling.mdc
```

### User Rules

> "Global to your Cursor environment. Used by Agent (Chat)."

- **Location:** Configured in **Cursor Settings** (Settings > General > Rules for AI).
- **Storage:** Managed through the Cursor Settings UI, **not** a file-system directory.
- **Scope:** Apply across all projects for the individual user.
- **Format:** Plain text entered in the settings interface.
- **Important limitation:** "User Rules are not applied to Inline Edit (Cmd/Ctrl+K). They are only used by Agent (Chat)."

**Note:** The official documentation does NOT specify a `~/.cursor/rules/` directory for user rules. User rules are managed exclusively through the Cursor Settings UI. Multiple community sources confirm this -- user rules are not file-based.

### Team Rules

> "Team-wide rules managed from the dashboard. Available on Team and Enterprise plans."

- **Location:** Cursor team dashboard (cloud-managed).
- **Scope:** Organization-wide, apply to all team members.
- **Enforcement options:**
  - Enable rules immediately vs. draft status.
  - Require enforcement to prevent users from disabling them.
- **Access:** Administrators manage through the Cursor dashboard.

---

## 6. AGENTS.md Integration

**Source: cursor.com/docs/context/rules (official)**

Cursor natively supports AGENTS.md as a first-class alternative to `.cursor/rules`:

> "AGENTS.md is a simple markdown file for defining agent instructions. Place it in your project root as an alternative to `.cursor/rules`."

### Key Characteristics

- **Format:** Plain markdown, no frontmatter required.
- **Location:** Project root or subdirectories.
- **Nested support:** Official documentation confirms: "Nested AGENTS.md support in subdirectories is now available."
- **Hierarchy:** Instructions from nested files combine hierarchically with more specific instructions taking precedence.

```
project/
  AGENTS.md           # Global project instructions
  frontend/AGENTS.md  # Frontend-specific instructions
  backend/AGENTS.md   # Backend-specific instructions
```

### AGENTS.md vs .cursor/rules

| Aspect | AGENTS.md | .cursor/rules |
|---|---|---|
| Format | Plain markdown | .mdc with frontmatter |
| Activation control | Always on | Four activation modes |
| Glob targeting | No | Yes |
| Agent-requested | No | Yes |
| Complexity | Simple | More configurable |
| Cross-tool compatibility | Works with Claude Code, Windsurf, etc. | Cursor-specific |

AGENTS.md is positioned as "a simple alternative" for projects that do not need fine-grained activation control. It is also the recommended format for cross-tool compatibility since Claude Code, Windsurf, and other AI coding tools also read AGENTS.md.

---

## 7. Rule Precedence and Loading

**Source: cursor.com/docs/context/rules (official)**

### Precedence Order

The official documentation specifies a clear precedence chain:

> "Rules are applied in this order: Team Rules -> Project Rules -> User Rules. All applicable rules are merged; earlier sources take precedence when guidance conflicts."

**Highest to lowest priority:**

1. **Team Rules** -- organization-wide, managed by admins
2. **Project Rules** -- `.cursor/rules/` directory and AGENTS.md
3. **User Rules** -- individual user settings

### Discovery and Loading

Rules are discovered through:

1. **Manual creation:** "New Cursor Rule" command in the command palette.
2. **Cursor Settings:** Settings > Rules, Commands interface.
3. **File system scanning:** Cursor scans `.cursor/rules/` and project root for AGENTS.md.
4. **Remote import:** Rules can be imported from GitHub repositories.
5. **Agent Skills:** Treated as agent-decided rules.

### Merging Behavior

All applicable rules from all scopes are merged together. When conflicting guidance exists between scopes, the higher-precedence source wins. Within the same scope, all matching rules are included (there is no documented mechanism for one project rule to override another project rule).

---

## 8. Legacy .cursorrules File

**Source: cursor.com/docs/context/rules (official)**

### Current Status

> "The `.cursorrules` (legacy) file in your project root is still supported but will be deprecated."

### Migration Path

> "We recommend migrating to Project Rules or to AGENTS.md."

The legacy `.cursorrules` file:

- Located at the **project root** (not in `.cursor/rules/`).
- Single file, no frontmatter support.
- No activation mode control (always applied).
- Still functional as of this writing but deprecated since Cursor ~0.45.
- Will be removed in a future version.

### Migration Strategy

1. Move content from `.cursorrules` to one or more `.mdc` files in `.cursor/rules/`.
2. Add appropriate frontmatter to control activation.
3. Alternatively, rename to `AGENTS.md` if simple always-on behavior is sufficient.
4. Delete the `.cursorrules` file.

---

## 9. Cursor 2.2+ Folder-Based Format (RULE.md)

**Source: awesome-cursor-rules-mdc GitHub reference, community reports**

**Important caveat:** This information comes from community sources, not the primary official documentation page. It may reflect beta/preview behavior or a format transition in progress.

As of Cursor version 2.2, a new folder-based rule format was introduced:

> "As of 2.2, `.mdc` cursor rules will remain functional however all new rules will now be created as folders in `.cursor/rules`."

### New Structure

Instead of individual `.mdc` files, each rule becomes a **folder** containing a `RULE.md` file:

```
.cursor/rules/
  code-style/
    RULE.md
  testing/
    RULE.md
  frontend-components/
    RULE.md
```

### RULE.md Format

The `RULE.md` file uses the same frontmatter fields (`description`, `globs`, `alwaysApply`) and markdown body as `.mdc` files. The folder structure provides:

- Better organization and maintainability.
- Potential for rule-specific assets alongside the RULE.md.
- Improved readability in file explorers.

### Backward Compatibility

Legacy `.mdc` files continue to work. The change affects how the Cursor UI creates **new** rules (via "New Cursor Rule" command), not how existing rules are read.

---

## 10. Notepads vs Rules

**Source: Community articles (adamtheautomator.com, frontendmasters.com)**

### What Notepads Are

Notepads are persistent repositories for coding instructions and context within Cursor. They function as reusable context documents accessible from the Explorer sidebar that can be referenced in chat conversations.

Unlike temporary chat sessions where context vanishes:

> "This context is temporary though. Close your editor or start a new chat, and these rules disappear. That's where Notepads come in."

### Key Differences from Rules

| Aspect | Rules | Notepads |
|---|---|---|
| Activation | Automatic (various modes) | Manual (@-reference only) |
| Storage | File system (`.cursor/rules/`) or Settings | Cursor UI (Explorer sidebar) |
| Version control | Yes (project rules) | No -- local to Cursor instance |
| Sharing | Via repo (project) or dashboard (team) | Not shareable across team members |
| Scope | System-level instructions | Reference material and context |
| Token usage | Always-on rules consume tokens every session | Only when explicitly referenced |

### When to Use Each

**Use Rules when:**
- Standards should apply automatically.
- Instructions should be version-controlled.
- Team-wide enforcement is needed.
- Behavior should be consistent across all sessions.

**Use Notepads when:**
- Context is needed only on demand.
- Content is personal or not team-wide.
- You want to minimize token usage.
- Storing reference material, templates, or architectural notes.

### How to Reference Notepads

Type `@notepad-name` in chat to include a notepad's content in the conversation context.

---

## 11. Best Practices from Official Docs

**Source: cursor.com/docs/context/rules (official)**

### Size and Scope

> "Keep rules under 500 lines."

> "Split large rules into multiple, composable rules."

### Quality Principles

> "Good rules are focused, actionable, and scoped."

> "Provide concrete examples or referenced files."

> "Avoid vague guidance. Write rules like clear internal docs."

> "Reference files instead of copying their contents -- this keeps rules short" and prevents staleness.

### Philosophy

> "Start simple. Add rules only when you notice Agent making the same mistake repeatedly."

### What to Avoid

The official documentation explicitly warns against:

> "Copying entire style guides: Use a linter instead."

> "Documenting every possible command: Agent knows common tools."

> "Adding instructions for edge cases that rarely apply."

> "Duplicating what's already in your codebase: Point to canonical examples."

### Rule Organization Recommendations

1. **One purpose per file** -- each rule should address a single concern.
2. **Use glob patterns** for language-specific or directory-specific rules rather than making everything always-on.
3. **Use Agent Requested mode** for rules that are only sometimes relevant to save context window space.
4. **Include code examples** showing both correct and incorrect patterns.
5. **Reference files** with `@filename` syntax instead of copying content.

---

## 12. Limitations

**Source: cursor.com/docs/context/rules (official)**

### Feature Scope

Rules do NOT apply to:
- **Cursor Tab** (autocomplete suggestions).
- **Other AI features** beyond Agent (Chat).

### User Rules Specifically

> "User Rules are not applied to Inline Edit (Cmd/Ctrl+K). They are only used by Agent (Chat)."

### Context Window

Rules consume context window space. Always-on rules with large content reduce the available context for actual code and conversation. This is a practical reason to:
- Keep rules concise.
- Use targeted activation modes (globs, agent-requested) instead of always-on.
- Split large rule sets into composable pieces.

No specific maximum size is documented beyond the "500 lines" recommendation.

---

## 13. Source Index

### Primary Official Source

- **Cursor Rules Documentation** -- `https://cursor.com/docs/context/rules`
  - Fetched via `markdown.new` proxy and direct URL on 2026-02-19.
  - Contains: rule types, frontmatter fields, precedence, AGENTS.md, legacy support, best practices, limitations.

### Community and Secondary Sources

- [awesome-cursor-rules-mdc reference](https://github.com/sanjeed5/awesome-cursor-rules-mdc/blob/main/cursor-rules-reference.md) -- Cursor 2.2 folder-based format details
- [Cursor IDE Rules Deep Dive (mer.vin)](https://mer.vin/2025/12/cursor-ide-rules-deep-dive/) -- Technical specification details, naming conventions
- [Cursor Rules (cursor101.com)](https://cursor101.com/cursor/rules) -- User rules location, glob patterns
- [Cursor Notepads for Coding Standards (adamtheautomator.com)](https://adamtheautomator.com/cursor-notepads-coding-standards/) -- Notepads functionality and usage
- [Notepads course (frontendmasters.com)](https://frontendmasters.com/courses/pro-ai/notepads/) -- Notepads vs rules comparison
- [What are Cursor Rules (workos.com)](https://workos.com/blog/what-are-cursor-rules) -- User rules storage clarification
- [Cursor AI Complete Guide 2025 (medium.com)](https://medium.com/@hilalkara.dev/cursor-ai-complete-guide-2025-real-experiences-pro-tips-mcps-rules-context-engineering-6de1a776a8af) -- General overview
- [Cursor AI Rules Guide 2026 (promptxl.com)](https://promptxl.com/cursor-ai-rules-guide-2026/) -- Modern setup practices

### Notes on URL Structure

- `docs.cursor.com/context/rules` now redirects (308 Permanent Redirect) to `cursor.com/docs`. The canonical documentation URL is `cursor.com/docs/context/rules`.
- `docs.cursor.com/context/rules-for-ai` also redirects to `cursor.com/docs`. There is no separate "rules-for-ai" page; the functionality has been consolidated into the main rules documentation.
