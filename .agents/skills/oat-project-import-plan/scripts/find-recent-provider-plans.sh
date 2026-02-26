#!/usr/bin/env bash
# find-recent-provider-plans.sh - list recent provider plan files in reverse chronology
# Usage: find-recent-provider-plans.sh [--hours N] [--limit N]

set -eu

HOURS=24
LIMIT=25

usage() {
  cat <<USAGE
Usage: find-recent-provider-plans.sh [--hours N] [--limit N]

Searches common provider plan directories and prints recent markdown files
sorted by modified time (newest first).

Options:
  --hours N   Lookback window in hours (default: 24)
  --limit N   Maximum number of results to print (default: 25)
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hours)
      HOURS="$2"
      shift 2
      ;;
    --limit)
      LIMIT="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$HOURS" in
  ''|*[!0-9]*)
    echo "--hours must be a non-negative integer" >&2
    exit 1
    ;;
esac

case "$LIMIT" in
  ''|*[!0-9]*)
    echo "--limit must be a non-negative integer" >&2
    exit 1
    ;;
esac

now_epoch=$(date +%s)
window_seconds=$((HOURS * 3600))

mtime_epoch() {
  local path="$1"
  if stat -f %m "$path" >/dev/null 2>&1; then
    stat -f %m "$path"
  else
    stat -c %Y "$path"
  fi
}

format_epoch() {
  local epoch="$1"
  if date -r "$epoch" "+%Y-%m-%d %H:%M:%S %Z" >/dev/null 2>&1; then
    date -r "$epoch" "+%Y-%m-%d %H:%M:%S %Z"
  else
    date -d "@$epoch" "+%Y-%m-%d %H:%M:%S %Z"
  fi
}

provider_from_path() {
  local path="$1"
  case "$path" in
    *"/.claude/"*) echo "claude" ;;
    *"/.cursor/"*) echo "cursor" ;;
    *"/.codex/"*) echo "codex" ;;
    *"/.oat/repo/reference/external-plans/"*) echo "external" ;;
    *) echo "unknown" ;;
  esac
}

recent_rows=""
add_dir() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0

  while IFS= read -r -d '' file_path; do
    local epoch age provider
    epoch=$(mtime_epoch "$file_path" 2>/dev/null || echo "")
    [[ -n "$epoch" ]] || continue

    age=$((now_epoch - epoch))
    (( age <= window_seconds )) || continue

    provider=$(provider_from_path "$file_path")
    recent_rows+="${epoch}"$'\t'"${provider}"$'\t'"${file_path}"$'\n'
  done < <(find "$dir" -type f \( -name "*.md" -o -name "*.markdown" \) -print0 2>/dev/null)
}

# Common provider directories plus local repo external-plan directory.
# Add extra directories with OAT_PROVIDER_PLAN_DIRS (colon-separated).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
SEARCH_DIRS=(
  "$HOME/.claude/plans"
  "$HOME/.codex/plans"
  "$HOME/.cursor/plans"
  "$REPO_ROOT/.oat/repo/reference/external-plans"
)

if [[ -n "${OAT_PROVIDER_PLAN_DIRS:-}" ]]; then
  OLDIFS="$IFS"
  IFS=':'
  # shellcheck disable=SC2206
  EXTRA_DIRS=(${OAT_PROVIDER_PLAN_DIRS})
  IFS="$OLDIFS"
  SEARCH_DIRS+=("${EXTRA_DIRS[@]}")
fi

for search_dir in "${SEARCH_DIRS[@]}"; do
  add_dir "$search_dir"
done

if [[ -z "$recent_rows" ]]; then
  echo "No recent provider plan files found in the last ${HOURS}h."
  exit 0
fi

echo "Recent provider plans (last ${HOURS}h, newest first):"

index=0
# sort by epoch descending and print up to LIMIT rows
while IFS=$'\t' read -r epoch provider path; do
  (( index += 1 ))
  if (( LIMIT > 0 && index > LIMIT )); then
    break
  fi

  printf "%2d) [%s] (%s) %s\n" "$index" "$(format_epoch "$epoch")" "$provider" "$path"
done < <(printf "%s" "$recent_rows" | sort -rn -k1,1)
