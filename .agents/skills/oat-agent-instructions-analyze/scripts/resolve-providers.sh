#!/usr/bin/env bash
# resolve-providers.sh — Resolve active providers for instruction file analysis
#
# Usage:
#   resolve-providers.sh [--providers claude,cursor,...] [--non-interactive]
#
# Resolution hierarchy:
#   1. Explicit --providers argument (comma-separated)
#   2. .oat/sync/config.json → providers.{name}.enabled
#   3. Auto-detection fallback (scan for provider directories)
#   4. Interactive confirmation (if TTY and not --non-interactive)
#
# Output: newline-separated list of provider names (always includes agents_md)
#
# Provider mapping:
#   agents_md → always included (AGENTS.md is canonical)
#   claude    → CLAUDE.md + .claude/rules/*.md
#   cursor    → .cursor/rules/*.mdc, .cursor/rules/*.md
#   copilot   → .github/copilot-instructions.md, .github/instructions/*.instructions.md
#   cline     → .cline/rules/*
#   codex     → reads AGENTS.md natively (no additional files)

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SYNC_CONFIG="${REPO_ROOT}/.oat/sync/config.json"

EXPLICIT_PROVIDERS=""
NON_INTERACTIVE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --providers)
      EXPLICIT_PROVIDERS="$2"
      shift 2
      ;;
    --non-interactive)
      NON_INTERACTIVE=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# Always start with agents_md
providers=("agents_md")

resolve_from_explicit() {
  IFS=',' read -ra items <<< "$EXPLICIT_PROVIDERS"
  for item in "${items[@]}"; do
    item="$(echo "$item" | tr -d '[:space:]')"
    if [[ -n "$item" && "$item" != "agents_md" ]]; then
      providers+=("$item")
    fi
  done
}

resolve_from_sync_config() {
  if [[ ! -f "$SYNC_CONFIG" ]] || ! jq empty "$SYNC_CONFIG" 2>/dev/null; then
    return 1
  fi

  local found=false
  for provider in claude cursor copilot cline codex; do
    local enabled
    enabled=$(jq -r --arg p "$provider" '.providers[$p].enabled // false' "$SYNC_CONFIG" 2>/dev/null)
    if [[ "$enabled" == "true" ]]; then
      providers+=("$provider")
      found=true
    fi
  done

  $found
}

resolve_from_auto_detect() {
  # Scan for provider directories
  [[ -d "${REPO_ROOT}/.claude" || -f "${REPO_ROOT}/CLAUDE.md" ]] && providers+=("claude")
  [[ -d "${REPO_ROOT}/.cursor" ]] && providers+=("cursor")
  [[ -d "${REPO_ROOT}/.github/instructions" || -f "${REPO_ROOT}/.github/copilot-instructions.md" ]] && providers+=("copilot")
  [[ -d "${REPO_ROOT}/.cline" ]] && providers+=("cline")
}

interactive_confirm() {
  if $NON_INTERACTIVE || [[ ! -t 0 ]]; then
    return
  fi

  # Show detected providers and ask about additional ones
  local detected
  detected=$(printf '%s\n' "${providers[@]}" | sort -u | grep -v '^agents_md$' || true)

  if [[ -n "$detected" ]]; then
    echo "Detected providers: agents_md $(echo "$detected" | tr '\n' ' ')" >&2
  else
    echo "Detected providers: agents_md (no provider-specific formats found)" >&2
  fi

  echo "" >&2
  echo "Available providers: claude, cursor, copilot, cline, codex" >&2
  echo -n "Add any additional providers? (comma-separated, or Enter to skip): " >&2
  read -r additional

  if [[ -n "$additional" ]]; then
    IFS=',' read -ra items <<< "$additional"
    for item in "${items[@]}"; do
      item="$(echo "$item" | tr -d '[:space:]')"
      if [[ -n "$item" && "$item" != "agents_md" ]]; then
        providers+=("$item")
      fi
    done
  fi
}

# Resolution hierarchy
if [[ -n "$EXPLICIT_PROVIDERS" ]]; then
  # 1. Explicit argument overrides everything
  resolve_from_explicit
elif resolve_from_sync_config; then
  # 2. Sync config found and had providers
  :
else
  # 3. Auto-detection fallback
  resolve_from_auto_detect
fi

# 4. Interactive confirmation (unless --non-interactive)
interactive_confirm

# Deduplicate and output
printf '%s\n' "${providers[@]}" | sort -u
