# Copilot Instructions Shim Template

Use this template when generating `.github/copilot-instructions.md`. This is a minimal pointer to AGENTS.md, not a content-bearing file.

## Why This Shim Exists

GitHub Copilot reads AGENTS.md natively, but only when enabled via the VS Code setting `chat.useAgentsMdFile` (default: off). The `.github/copilot-instructions.md` file is always read — no setting required.

This shim ensures Copilot users who haven't enabled the AGENTS.md setting still get baseline project instructions.

## Template

```markdown
<!--
  This file exists for GitHub Copilot compatibility.

  Copilot can read AGENTS.md natively, but only when the VS Code setting
  "chat.useAgentsMdFile" is enabled (default: off). This shim ensures
  baseline project instructions are always available to Copilot regardless
  of user settings.

  Canonical project instructions live in AGENTS.md at the repository root.
  Do not add detailed instructions here — keep this as a minimal pointer.
-->

See AGENTS.md in the repository root for project conventions and instructions.
```

## Guidance

- Keep this file minimal — it's a pointer, not a content file
- The HTML comment explains why the shim exists (for future maintainers)
- Do not duplicate AGENTS.md content here
- Copilot's scoped instructions (`.github/instructions/*.instructions.md`) handle glob-targeted rules separately
- This file is always-on for Copilot chat — no frontmatter needed
