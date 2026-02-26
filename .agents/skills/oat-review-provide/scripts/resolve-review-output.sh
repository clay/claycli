#!/usr/bin/env bash
# resolve-review-output.sh - resolve default output destination for non-project reviews
# Usage:
#   resolve-review-output.sh [--mode auto|local|tracked|inline] [--output <path>]

set -eu

MODE="auto"
OUTPUT=""

usage() {
  cat <<USAGE
Usage: resolve-review-output.sh [--mode auto|local|tracked|inline] [--output <path>]

Resolves output destination for ad-hoc (non-project) review artifacts.

Policy:
- If --output is provided, use it directly.
- If mode=inline, no artifact file is written.
- In auto mode:
  - If .oat/repo/reviews exists and is NOT gitignored, use it (tracked convention).
  - Otherwise, use .oat/projects/local/orphan-reviews (local-only default).
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="$2"
      shift 2
      ;;
    --output)
      OUTPUT="$2"
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

case "$MODE" in
  auto|local|tracked|inline) ;;
  *)
    echo "Invalid --mode: $MODE" >&2
    exit 1
    ;;
esac

if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "Error: Must be run from a git repository" >&2
  exit 1
fi

is_gitignored() {
  local path="$1"
  if git check-ignore -q "$path" 2>/dev/null; then
    echo "true"
  else
    echo "false"
  fi
}

# Resolve explicit output first
if [[ -n "$OUTPUT" ]]; then
  echo "review_mode=file"
  echo "output_dir=$OUTPUT"
  echo "output_kind=custom"
  echo "output_gitignored=$(is_gitignored "$OUTPUT")"
  echo "reason=explicit_output"
  exit 0
fi

if [[ "$MODE" == "inline" ]]; then
  echo "review_mode=inline"
  echo "output_dir="
  echo "output_kind=inline"
  echo "output_gitignored=n/a"
  echo "reason=inline_mode"
  exit 0
fi

TRACKED_DIR=".oat/repo/reviews"
LOCAL_DIR=".oat/projects/local/orphan-reviews"

if [[ "$MODE" == "tracked" ]]; then
  echo "review_mode=file"
  echo "output_dir=$TRACKED_DIR"
  echo "output_kind=tracked"
  echo "output_gitignored=$(is_gitignored "$TRACKED_DIR")"
  echo "reason=forced_tracked"
  exit 0
fi

if [[ "$MODE" == "local" ]]; then
  echo "review_mode=file"
  echo "output_dir=$LOCAL_DIR"
  echo "output_kind=local"
  echo "output_gitignored=$(is_gitignored "$LOCAL_DIR")"
  echo "reason=forced_local"
  exit 0
fi

# auto mode
if [[ -d "$TRACKED_DIR" ]] && [[ "$(is_gitignored "$TRACKED_DIR")" == "false" ]]; then
  echo "review_mode=file"
  echo "output_dir=$TRACKED_DIR"
  echo "output_kind=tracked"
  echo "output_gitignored=false"
  echo "reason=existing_tracked_dir"
  exit 0
fi

echo "review_mode=file"
echo "output_dir=$LOCAL_DIR"
echo "output_kind=local"
echo "output_gitignored=$(is_gitignored "$LOCAL_DIR")"
echo "reason=default_local_only"
