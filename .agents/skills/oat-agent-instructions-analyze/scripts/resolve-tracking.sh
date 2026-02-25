#!/usr/bin/env bash
# resolve-tracking.sh — Read/write/init .oat/tracking.json
#
# Usage:
#   resolve-tracking.sh init
#   resolve-tracking.sh read <operation>
#   resolve-tracking.sh root
#   resolve-tracking.sh write <operation> <commitHash> <baseBranch> <mode> [--artifact-path <path>] [formats...]
#
# Schema (flat top-level keys per backlog convention):
#   {
#     "version": 1,
#     "<operation>": {
#       "lastRunAt": "ISO 8601",
#       "commitHash": "...",
#       "baseBranch": "...",
#       "mode": "full|delta",
#       "formats": ["agents_md", ...],
#       "artifactPath": "..."
#     }
#   }
#
# Write protocol: optimistic per-key merge. Each writer reads the file,
# updates only its own operation key, and writes back.
#
# NOTE: write() normalizes commitHash/baseBranch to the repository root branch tip
# (origin/main, origin/master, etc.) at write time so the stored commit remains
# resolvable even when feature-branch commits are rebased or squashed.

set -euo pipefail

# Resolve repo root and tracking file path
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TRACKING_FILE="${REPO_ROOT}/.oat/tracking.json"

# Ensure jq is available
if ! command -v jq &>/dev/null; then
  echo "Error: jq is required but not found in PATH" >&2
  exit 1
fi

detect_default_remote() {
  if git show-ref --verify --quiet "refs/remotes/origin/HEAD"; then
    echo "origin"
    return
  fi

  local first_remote
  first_remote="$(git remote 2>/dev/null | head -1 || true)"
  if [[ -n "$first_remote" ]]; then
    echo "$first_remote"
  fi
}

detect_root_branch() {
  local remote branch
  remote="$(detect_default_remote)"

  if [[ -n "$remote" ]]; then
    branch="$(git symbolic-ref --quiet --short "refs/remotes/${remote}/HEAD" 2>/dev/null || true)"
    if [[ -n "$branch" ]]; then
      echo "${branch#${remote}/}"
      return
    fi
  fi

  for candidate in main master trunk; do
    if [[ -n "$remote" ]] && git show-ref --verify --quiet "refs/remotes/${remote}/${candidate}"; then
      echo "$candidate"
      return
    fi
    if git show-ref --verify --quiet "refs/heads/${candidate}"; then
      echo "$candidate"
      return
    fi
  done

  branch="$(git branch --show-current 2>/dev/null || true)"
  if [[ -n "$branch" ]]; then
    echo "$branch"
    return
  fi

  echo "HEAD"
}

resolve_root_commit_hash() {
  local branch="${1:?Missing branch}"
  local remote
  remote="$(detect_default_remote)"

  if [[ -n "$remote" ]] && git show-ref --verify --quiet "refs/remotes/${remote}/${branch}"; then
    git rev-parse "${remote}/${branch}"
    return
  fi

  if git show-ref --verify --quiet "refs/heads/${branch}"; then
    git rev-parse "${branch}"
    return
  fi

  git rev-parse HEAD
}

cmd_init() {
  mkdir -p "$(dirname "$TRACKING_FILE")"
  if [[ ! -f "$TRACKING_FILE" ]] || ! jq empty "$TRACKING_FILE" 2>/dev/null; then
    echo '{"version":1}' | jq . > "$TRACKING_FILE"
    echo "Initialized $TRACKING_FILE"
  else
    echo "$TRACKING_FILE already exists and is valid JSON"
  fi
}

cmd_read() {
  local operation="${1:?Usage: resolve-tracking.sh read <operation>}"

  if [[ ! -f "$TRACKING_FILE" ]]; then
    echo "{}"
    return 0
  fi

  jq -r --arg op "$operation" '.[$op] // empty' "$TRACKING_FILE"
}

cmd_root() {
  local root_branch root_hash
  root_branch="$(detect_root_branch)"
  root_hash="$(resolve_root_commit_hash "$root_branch")"

  jq -n --arg branch "$root_branch" --arg hash "$root_hash" \
    '{baseBranch: $branch, commitHash: $hash}'
}

cmd_write() {
  local operation="${1:?Usage: resolve-tracking.sh write <operation> <commitHash> <baseBranch> <mode> [--artifact-path <path>] [formats...]}"
  local commit_hash="${2:?Missing commitHash}"
  local base_branch="${3:?Missing baseBranch}"
  local mode="${4:?Missing mode}"
  shift 4

  # Parse optional --artifact-path flag before variadic formats
  local artifact_path=""
  if [[ "${1:-}" == "--artifact-path" ]]; then
    artifact_path="${2:?Missing artifact path value after --artifact-path}"
    shift 2
  fi

  local formats=("$@")

  # Normalize tracking target to root branch tip to keep commitHash resolvable.
  local normalized_branch normalized_hash
  normalized_branch="$(detect_root_branch)"
  normalized_hash="$(resolve_root_commit_hash "$normalized_branch")"

  if [[ "$base_branch" != "$normalized_branch" || "$commit_hash" != "$normalized_hash" ]]; then
    echo "Info: normalizing tracking target to root branch '${normalized_branch}' (${normalized_hash})" >&2
  fi

  base_branch="$normalized_branch"
  commit_hash="$normalized_hash"

  # Build formats JSON array
  local formats_json="[]"
  if [[ ${#formats[@]} -gt 0 ]]; then
    formats_json=$(printf '%s\n' "${formats[@]}" | jq -R . | jq -s .)
  fi

  local timestamp
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  # Read existing or initialize
  local existing
  if [[ -f "$TRACKING_FILE" ]] && jq empty "$TRACKING_FILE" 2>/dev/null; then
    existing="$(cat "$TRACKING_FILE")"
  else
    mkdir -p "$(dirname "$TRACKING_FILE")"
    existing='{"version":1}'
  fi

  # Merge operation entry (include artifactPath only if provided)
  if [[ -n "$artifact_path" ]]; then
    echo "$existing" | jq \
      --arg op "$operation" \
      --arg ts "$timestamp" \
      --arg hash "$commit_hash" \
      --arg branch "$base_branch" \
      --arg mode "$mode" \
      --argjson formats "$formats_json" \
      --arg artifact "$artifact_path" \
      '.[$op] = {
        lastRunAt: $ts,
        commitHash: $hash,
        baseBranch: $branch,
        mode: $mode,
        formats: $formats,
        artifactPath: $artifact
      }' > "$TRACKING_FILE"
  else
    echo "$existing" | jq \
      --arg op "$operation" \
      --arg ts "$timestamp" \
      --arg hash "$commit_hash" \
      --arg branch "$base_branch" \
      --arg mode "$mode" \
      --argjson formats "$formats_json" \
      '.[$op] = {
        lastRunAt: $ts,
        commitHash: $hash,
        baseBranch: $branch,
        mode: $mode,
        formats: $formats
      }' > "$TRACKING_FILE"
  fi

  echo "Updated $TRACKING_FILE [$operation]"
}

# Dispatch subcommand
case "${1:-}" in
  init)
    cmd_init
    ;;
  read)
    shift
    cmd_read "$@"
    ;;
  root)
    cmd_root
    ;;
  write)
    shift
    cmd_write "$@"
    ;;
  *)
    echo "Usage: resolve-tracking.sh {init|read|root|write} [args...]" >&2
    echo "" >&2
    echo "Commands:" >&2
    echo "  init                                              Create tracking.json if missing" >&2
    echo "  read <operation>                                  Read operation entry" >&2
    echo "  root                                              Print root branch + commit as JSON" >&2
    echo "  write <op> <hash> <branch> <mode> [--artifact-path <p>] [fmts]" >&2
    exit 1
    ;;
esac
