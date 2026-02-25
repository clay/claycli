---
name: oat-project-complete
version: 1.0.0
description: Use when all implementation work is finished and the project is ready to close. Marks the OAT project lifecycle as complete.
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash, AskUserQuestion
---

# Complete Project

Mark the active OAT project lifecycle as complete.

## Progress Indicators (User-Facing)

When executing this skill, provide lightweight progress feedback so the user can tell what’s happening after they confirm.

- Print a phase banner once at start using horizontal separators, e.g.:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OAT ▸ COMPLETE PROJECT
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Before multi-step work, print step indicators, e.g.:
  - `[1/4] Checking completion gates…`
  - `[2/4] Marking lifecycle complete…`
  - `[3/4] Archiving project (if approved)…`
  - `[4/4] Refreshing dashboard + committing bookkeeping…`

## Process

### Step 1: Resolve Active Project

```bash
PROJECT_PATH=$(oat config get activeProject 2>/dev/null || true)

if [[ -z "$PROJECT_PATH" ]]; then
  echo "Error: No active project set. Use the oat-project-open skill first." >&2
  exit 1
fi

PROJECT_NAME=$(basename "$PROJECT_PATH")
```

### Step 2: Confirm with User

Ask user: "Are you sure you want to mark **{PROJECT_NAME}** as complete?"

If user declines, exit gracefully.

### Step 3: Check for Final Review (Warning + Confirmation)

```bash
PLAN_FILE="${PROJECT_PATH}/plan.md"

if [[ -f "$PLAN_FILE" ]]; then
  final_row=$(grep -E "^\|\s*final\s*\|" "$PLAN_FILE" | head -1 || true)
  if [[ -z "$final_row" ]]; then
    echo "Warning: No final review row found in plan.md."
  elif ! echo "$final_row" | grep -qE "\|\s*passed\s*\|"; then
    echo "Warning: Final code review is not marked passed."
    echo "Recommendation: run the oat-project-review-provide skill with code final and oat-project-review-receive before completing."
  fi
else
  echo "Warning: plan.md not found, unable to verify final review status."
fi
```

### Step 3.5: Check Deferred Medium Findings (Warning + Confirmation)

```bash
IMPL_FILE="${PROJECT_PATH}/implementation.md"

if [[ -f "$IMPL_FILE" ]]; then
  medium_items=$(awk '
    BEGIN { in_medium = 0 }
    /^\*\*Deferred Findings \(Medium\):\*\*/ { in_medium = 1; next }
    /^\*\*Deferred Findings \(Medium\/Minor\):\*\*/ { in_medium = 1; next }
    in_medium && /^\*\*/ { in_medium = 0; next }
    in_medium && /^[[:space:]]*-[[:space:]]+/ { print }
  ' "$IMPL_FILE")

  has_unresolved_medium="false"
  while IFS= read -r line; do
    item=$(echo "$line" | sed -E 's/^[[:space:]]*-[[:space:]]+//')
    if ! echo "$item" | grep -qiE '^none([[:space:]]|[[:punct:]]|$)'; then
      has_unresolved_medium="true"
      break
    fi
  done <<< "$medium_items"

  if [[ "$has_unresolved_medium" == "true" ]]; then
    echo "Warning: Deferred Medium findings are recorded in implementation.md."
    echo "Recommendation: resurface via final review and explicitly disposition before completion."
  fi
fi
```

After Step 3 and 3.5 warnings:
- Ask user for explicit confirmation to continue if final review is not `passed` OR unresolved deferred Medium findings are present.
- Suggested prompt: "Completion gates are not fully satisfied. Continue marking lifecycle complete anyway?"

### Step 4: Check for PR Description (Warning Only)

```bash
PR_LEGACY="${PROJECT_PATH}/pr-description.md"
PR_FINAL=$(ls -1 "${PROJECT_PATH}"/pr/project-pr-*.md 2>/dev/null | head -1 || true)

if [[ ! -f "$PR_LEGACY" && -z "$PR_FINAL" ]]; then
  echo "Warning: No PR description artifact found (checked pr-description.md and pr/project-pr-*.md)."
  echo "Recommendation: run the oat-project-pr-final skill before completing."
fi
```

### Step 5: Set Lifecycle Complete

Update state.md frontmatter to add/update `oat_lifecycle: complete`:

```bash
STATE_FILE="${PROJECT_PATH}/state.md"

# Check if oat_lifecycle already exists
if grep -q "^oat_lifecycle:" "$STATE_FILE"; then
  # Update existing (portable approach using temp file)
  sed 's/^oat_lifecycle:.*/oat_lifecycle: complete/' "$STATE_FILE" > "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
else
  # Add after oat_phase_status line using awk (more portable for multi-line inserts)
  awk '/^oat_phase_status:/ {print; print "oat_lifecycle: complete"; next} 1' "$STATE_FILE" > "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
fi
```

### Step 6: Offer Archive for Shared Projects

Detect whether the active project is under shared projects root:

```bash
PROJECTS_ROOT="${OAT_PROJECTS_ROOT:-$(oat config get projects.root 2>/dev/null || echo ".oat/projects/shared")}"
PROJECTS_ROOT="${PROJECTS_ROOT%/}"
ARCHIVED_ROOT=".oat/projects/archived"
IS_SHARED_PROJECT="false"

case "$PROJECT_PATH" in
  "${PROJECTS_ROOT}/"*) IS_SHARED_PROJECT="true" ;;
esac
```

If `IS_SHARED_PROJECT` is `true`, ask user:

"This is a shared project. Archive it now?"

If user approves:

```bash
MAIN_WORKTREE_PATH=$(git worktree list --porcelain 2>/dev/null | awk '
  /^worktree / { wt=$2 }
  /^branch refs\\/heads\\/main$/ { print wt; exit }
')
MAIN_REPO_ARCHIVE=""
if [[ -n "$MAIN_WORKTREE_PATH" ]]; then
  MAIN_REPO_ARCHIVE="${MAIN_WORKTREE_PATH}/.oat/projects/archived"
fi
LOCAL_ARCHIVED_ROOT=".oat/projects/archived"
USE_MAIN_REPO_ARCHIVE="false"

# Heuristic: if this checkout is a worktree and the main repo archive parent exists,
# use the main repo archive as the canonical archive destination.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null || true)
  GIT_DIR=$(git rev-parse --git-dir 2>/dev/null || true)
  if [[ -n "$GIT_COMMON_DIR" && -n "$GIT_DIR" && "$GIT_COMMON_DIR" != "$GIT_DIR" ]]; then
    if [[ -d "$(dirname "$MAIN_REPO_ARCHIVE")" ]]; then
      USE_MAIN_REPO_ARCHIVE="true"
      ARCHIVED_ROOT="$MAIN_REPO_ARCHIVE"
    else
      echo "Warning: Running in a worktree, but main repo archive path is unavailable: $MAIN_REPO_ARCHIVE"
      echo "A worktree-local archive may be deleted when the worktree is removed and is not a durable archive."
      echo "Require explicit confirmation before proceeding with local-only archive."
    fi
  fi
fi

if [[ "$USE_MAIN_REPO_ARCHIVE" != "true" ]]; then
  ARCHIVED_ROOT="$LOCAL_ARCHIVED_ROOT"
fi

mkdir -p "$ARCHIVED_ROOT"
ARCHIVE_PATH="${ARCHIVED_ROOT}/${PROJECT_NAME}"

if [[ -e "$ARCHIVE_PATH" ]]; then
  ARCHIVE_PATH="${ARCHIVED_ROOT}/${PROJECT_NAME}-$(date +%Y%m%d-%H%M%S)"
fi

mv "$PROJECT_PATH" "$ARCHIVE_PATH"
PROJECT_PATH="$ARCHIVE_PATH"
echo "Project archived to $ARCHIVE_PATH"
```

**Worktree durability guard (required):**

- If running in a worktree and `MAIN_REPO_ARCHIVE` is unavailable, do not silently continue with a local-only archive.
- Ask the user explicitly: "Main repo archive path is unavailable, so this archive may be lost when the worktree is deleted. Continue with local-only archive anyway?"
- If the user declines, skip archiving and continue the completion flow without archive.
- If your repository does not use `main` as the default branch, use `git worktree list --porcelain` to identify the primary worktree path by another stable rule (for example the non-ephemeral root checkout), then append `/.oat/projects/archived`.

**Git handling after archive:**

If the archived directory is gitignored (check with `git check-ignore -q "$ARCHIVE_PATH"`), the move looks like a deletion to git — the original tracked files disappear and the archived copy is local-only. To commit:

```bash
git add -A "$PROJECTS_ROOT/$PROJECT_NAME" 2>/dev/null || true
```

This stages the deletions from the shared directory. The archived copy is preserved locally but not tracked by git.

**Worktree archive target (required when available):**

If running from a git worktree, the primary repo archive directory is the canonical/durable archive destination.

Reference path:

```bash
MAIN_WORKTREE_PATH=$(git worktree list --porcelain | awk '
  /^worktree / { wt=$2 }
  /^branch refs\\/heads\\/main$/ { print wt; exit }
')
MAIN_REPO_ARCHIVE="${MAIN_WORKTREE_PATH}/.oat/projects/archived"
```

Guidance:
- In a worktree, prefer moving directly to `MAIN_REPO_ARCHIVE` instead of archiving locally and copying later.
- Do not treat the worktree-local archive as durable.
- If forced to use a local-only archive, warn and require explicit user confirmation.
- Do not hardcode user-specific absolute paths.

### Step 7: Offer to Clear Active Project

Ask user: "Would you like to clear the active project pointer?"

If yes:
```bash
oat config set activeProject ""
echo "Active project cleared."
```

### Step 8: Regenerate Dashboard

```bash
oat state refresh
```

### Step 9: Commit + Push Bookkeeping (Required)

Completion is not done until bookkeeping changes are committed and pushed. This prevents local-only `state.md` updates that leave project status stale for later sessions/reviews.

Expected changes may include:
- `{PROJECT_PATH}/state.md`
- `{PROJECT_PATH}/implementation.md` (if touched earlier in the lifecycle closeout)
- `{PROJECT_PATH}/plan.md` (if review receive just ran)
- `.oat/config.local.json` (if `activeProject` cleared)
- Shared-project deletions under `{PROJECTS_ROOT}/{PROJECT_NAME}` (if archived)

Run:

```bash
git status --short
git add -A
git commit -m "chore(oat): complete project lifecycle for ${PROJECT_NAME}"
git push
```

Rules:
- If there are unrelated unstaged/staged changes, stage and commit only the completion/bookkeeping files (do not sweep unrelated work into this commit).
- If there is nothing to commit, state that explicitly and verify whether the completion bookkeeping was already committed in a prior commit.
- If push fails, report the failure and do not claim completion is fully recorded.

### Step 10: Confirm to User

Show user:
- "Project **{PROJECT_NAME}** marked as complete."
- If archived: "Archived location: **{PROJECT_PATH}**"
- Include commit hash and push result for the bookkeeping changes.
