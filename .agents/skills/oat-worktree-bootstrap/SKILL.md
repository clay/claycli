---
name: oat-worktree-bootstrap
version: 1.0.0
description: Use when creating or resuming a git worktree for OAT implementation. Creates or validates a worktree and runs OAT bootstrap checks.
argument-hint: "<branch-name> [--base <ref>] [--path <root>] [--existing]"
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion
---

# Worktree Bootstrap

Create or resume a git worktree and prepare it for OAT development.

## Prerequisites

- Git repository is clean enough to create/switch worktrees.
- Node.js and pnpm are available in the target environment.
- OAT project files exist (`.oat/`, `.agents/`).

## Mode Assertion

**OAT MODE: Worktree Bootstrap**

**Purpose:** Establish an isolated workspace and run standard OAT readiness checks before implementation work.

**BLOCKED Activities:**
- No implementation code changes unrelated to worktree setup.
- No destructive rewrite of existing project artifacts.

**ALLOWED Activities:**
- Create/reuse worktree paths.
- Run bootstrap and readiness checks.
- Update related state/docs for workspace readiness.

## Progress Indicators (User-Facing)

- Print a phase banner once at start:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OAT ▸ WORKTREE BOOTSTRAP
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Before multi-step operations, print step indicators, e.g.:
  - `[1/4] Resolving worktree target…`
  - `[2/4] Creating/validating worktree…`
  - `[3/4] Running OAT bootstrap checks…`
  - `[4/4] Reporting ready state…`

## Inputs

- Required for creation mode: `<branch-name>`
- Optional:
  - `--base <ref>` (default: `origin/main`)
  - `--path <root>` (explicit worktree root override)
  - `--existing` (bootstrap/validate existing worktree instead of creating one)

## Process

### Step 0: Resolve Repository Context

```bash
REPO_ROOT=$(git rev-parse --show-toplevel)
REPO_NAME=$(basename "$REPO_ROOT")
```

### Step 0.5: Validate Active Project Config

Resolve active project from local config:

```bash
ACTIVE_PROJECT=$(oat config get activeProject 2>/dev/null || true)
```

If `ACTIVE_PROJECT` is set:
- verify the pointed path exists and contains `state.md`
- if invalid, do **not** silently rewrite it
- prompt user to run one of:
  - `oat-project-clear-active`
  - `oat-project-open`
- require explicit confirmation before continuing with worktree bootstrap

If `ACTIVE_PROJECT` is missing:
- continue (active project is optional for worktree bootstrap)
- use console-only baseline-failure logging in Step 3 if needed

### Step 1: Resolve Target Worktree Context

If `--existing`:
- validate the current directory appears in `git worktree list --porcelain`
- set `TARGET_WORKTREE` to the current directory
- set `WORKTREE_ROOT` to the parent directory of `TARGET_WORKTREE` (informational)
- skip root-path convention checks; externally managed paths are allowed (for example Codex-managed worktrees under `~/.codex/worktrees/...`)

Otherwise, resolve `WORKTREE_ROOT` using this strict precedence (stop at the **first match**):

1. Explicit `--path <root>` (CLI flag — highest priority)
2. `OAT_WORKTREES_ROOT` (environment variable)
3. `.oat/config.json` -> `worktrees.root` (persisted project config)
4. First existing directory in this order (check each, use the first that exists):
   a. `${REPO_ROOT}/.worktrees`
   b. `${REPO_ROOT}/worktrees`
   c. `../${REPO_NAME}-worktrees`
5. Fallback default (nothing matched above): `../${REPO_NAME}-worktrees`

**IMPORTANT:** Precedence level 4 is an ordered list, not a set. Check `.worktrees` first. If it exists, use it — do NOT continue scanning for `../<repo>-worktrees` even if that also exists. Only fall through to the next candidate if the current one does not exist.

For repo-relative values (levels 3–4a–4b), resolve from `REPO_ROOT`.
Treat `.oat/config.json` as phase-A non-sync settings ownership (do not mix with `.oat/sync/config.json`).

If the resolved root is project-local (`.worktrees` or `worktrees`), verify it is ignored by git before creating a new worktree.
Set `TARGET_WORKTREE` to `{WORKTREE_ROOT}/{branch-name}`.

### Step 2: Create or Reuse Worktree

- If `--existing`, validate the current directory is a git worktree and continue.
- Otherwise:
  - validate branch name format (`^[a-zA-Z0-9._/-]+$`)
  - resolve target path as `TARGET_WORKTREE`
  - if branch already exists locally:
    - `git worktree add "{TARGET_WORKTREE}" "{branch-name}"`
  - if branch does not exist:
    - `git worktree add "{TARGET_WORKTREE}" -b "{branch-name}" "{base-ref}"`

`{base-ref}` defaults to `origin/main` unless `--base` is provided.

If worktree creation fails, stop and report the exact git error with remediation guidance.

### Step 2.5: Propagate Local-Only Config

After the worktree is created (or validated with `--existing`), copy gitignored local-only context files from the source repo into the new worktree so downstream skills (e.g., `oat-project-implement`) can resolve context without re-prompting.

Files to propagate (if they exist in the source repo):
- `.oat/config.local.json`
- `.oat/active-idea`

```bash
for LOCAL_FILE in config.local.json active-idea; do
  SRC="$REPO_ROOT/.oat/$LOCAL_FILE"
  DST="{target-path}/.oat/$LOCAL_FILE"
  if [[ -f "$SRC" && ! -f "$DST" ]]; then
    cp "$SRC" "$DST"
  fi
done
```

Rules:
- Only copy if the source file exists **and** the destination does not (never overwrite).
- `config.local.json` uses repo-relative paths, so copied values remain valid across sibling worktrees.
- After copying, validate `activeProject` (if present in `config.local.json`) resolves to a real project path in the worktree. If not, print a warning but do not block bootstrap.
- This is a pragmatic subset of the broader worktree artifact sync policy (see backlog P1 item).

### Step 3: Run OAT Bootstrap

Run bootstrap and readiness checks in the target worktree:

```bash
pnpm run worktree:init
oat status --scope project
pnpm test
git status --porcelain
```

Required behavior:
- Stop immediately if `worktree:init` or `status` fails.
- If `pnpm test` fails:
  - show a concise failure summary
  - ask the user whether to `abort` or `proceed anyway`
  - if user proceeds:
    - when a valid active project with `implementation.md` exists, append a timestamped baseline-failure note there
    - otherwise print the same note to console output only (do not create a fallback file)
- If `git status --porcelain` is not clean after bootstrap/tests, stop and require cleanup before reporting ready.

### Step 4: Output Ready State

Report:
- resolved worktree path
- active branch
- bootstrap/verification status
- next command: `oat-project-implement`

## References

- `references/worktree-conventions.md`

## Success Criteria

- ✅ Worktree exists (or existing worktree validated).
- ✅ OAT bootstrap completed without blocking errors.
- ✅ User receives a clear next action for implementation.
