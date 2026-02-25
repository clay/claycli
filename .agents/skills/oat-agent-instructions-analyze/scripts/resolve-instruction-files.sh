#!/usr/bin/env bash
# resolve-instruction-files.sh — Discover instruction files by provider
#
# Usage:
#   resolve-providers.sh --non-interactive | resolve-instruction-files.sh
#   resolve-instruction-files.sh --providers agents_md,claude,cursor
#
# Input: newline-separated provider names (stdin or --providers arg)
# Output: tab-separated "provider\tpath" per line, sorted
#
# File patterns per provider:
#   agents_md → **/AGENTS.md
#   claude    → **/CLAUDE.md, .claude/rules/*.md
#   cursor    → .cursor/rules/*.mdc, .cursor/rules/*.md
#   copilot   → .github/copilot-instructions.md, .github/instructions/*.instructions.md
#   cline     → .cline/rules/*

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Exclusion: prune directories named node_modules, .worktrees, .git, .oat
# that are direct children of REPO_ROOT (not ancestors in the path to REPO_ROOT).
# This prevents false exclusion when the worktree itself lives under a .worktrees/ directory.
find_exclude() {
  find "$REPO_ROOT" "$@" \
    -not -path "${REPO_ROOT}/node_modules/*" \
    -not -path "${REPO_ROOT}/.worktrees/*" \
    -not -path "${REPO_ROOT}/.git/*" \
    -not -path "${REPO_ROOT}/.oat/*" \
    -not -path "*/node_modules/*" \
    2>/dev/null || true
}

# Parse providers from --providers arg or stdin
PROVIDERS=()
if [[ "${1:-}" == "--providers" ]]; then
  IFS=',' read -ra PROVIDERS <<< "${2:-}"
else
  # Read from stdin
  while IFS= read -r line; do
    line="$(echo "$line" | tr -d '[:space:]')"
    [[ -n "$line" ]] && PROVIDERS+=("$line")
  done
fi

if [[ ${#PROVIDERS[@]} -eq 0 ]]; then
  echo "Error: no providers specified. Pipe from resolve-providers.sh or use --providers." >&2
  exit 1
fi

discover_agents_md() {
  find_exclude -name 'AGENTS.md' | while read -r f; do
    local rel="${f#"$REPO_ROOT"/}"
    printf 'agents_md\t%s\n' "$rel"
  done
}

discover_claude() {
  # CLAUDE.md files
  find_exclude -name 'CLAUDE.md' | while read -r f; do
    local rel="${f#"$REPO_ROOT"/}"
    printf 'claude\t%s\n' "$rel"
  done

  # Claude rules
  if [[ -d "${REPO_ROOT}/.claude/rules" ]]; then
    find "${REPO_ROOT}/.claude/rules" -name '*.md' -type f 2>/dev/null | while read -r f; do
      local rel="${f#"$REPO_ROOT"/}"
      printf 'claude\t%s\n' "$rel"
    done
  fi
}

discover_cursor() {
  if [[ -d "${REPO_ROOT}/.cursor/rules" ]]; then
    find "${REPO_ROOT}/.cursor/rules" \( -name '*.mdc' -o -name '*.md' \) -type f 2>/dev/null | while read -r f; do
      local rel="${f#"$REPO_ROOT"/}"
      printf 'cursor\t%s\n' "$rel"
    done
  fi
}

discover_copilot() {
  # Root copilot instructions
  if [[ -f "${REPO_ROOT}/.github/copilot-instructions.md" ]]; then
    printf 'copilot\t%s\n' ".github/copilot-instructions.md"
  fi

  # Scoped instructions
  if [[ -d "${REPO_ROOT}/.github/instructions" ]]; then
    find "${REPO_ROOT}/.github/instructions" -name '*.instructions.md' -type f 2>/dev/null | while read -r f; do
      local rel="${f#"$REPO_ROOT"/}"
      printf 'copilot\t%s\n' "$rel"
    done
  fi
}

discover_cline() {
  if [[ -d "${REPO_ROOT}/.cline/rules" ]]; then
    find "${REPO_ROOT}/.cline/rules" -type f 2>/dev/null | while read -r f; do
      local rel="${f#"$REPO_ROOT"/}"
      printf 'cline\t%s\n' "$rel"
    done
  fi
}

# Run discovery for each provider
for provider in "${PROVIDERS[@]}"; do
  case "$provider" in
    agents_md)  discover_agents_md ;;
    claude)     discover_claude ;;
    cursor)     discover_cursor ;;
    copilot)    discover_copilot ;;
    cline)      discover_cline ;;
    codex)      ;; # codex reads AGENTS.md natively, no additional files
    *)          echo "Warning: unknown provider '$provider', skipping" >&2 ;;
  esac
done | sort -t$'\t' -k1,1 -k2,2
