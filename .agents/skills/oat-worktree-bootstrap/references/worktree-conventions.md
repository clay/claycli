# Worktree Conventions

## Root Selection Priority

If bootstrapping an existing worktree (`--existing`), use the current directory as the target worktree and treat its parent as informational root only.

For creation mode:
1. Explicit `--path <root>` argument
2. `OAT_WORKTREES_ROOT` environment variable
3. `.oat/config.json` -> `worktrees.root`
4. Existing roots (`.worktrees`, `worktrees`, `../<repo>-worktrees`)
5. Fallback default (`../<repo>-worktrees`)

For relative paths, resolve from repository root.

## Safety Rules

- Validate branch names before creation.
- Never create nested worktrees inside tracked source directories.
- For repo-local roots (`.worktrees`, `worktrees`), ensure the root is ignored by git.
- Default base reference for new branches is `origin/main`.
- If `git worktree add` fails, stop and present remediation rather than retrying silently.

## Baseline Readiness

Run baseline commands before reporting ready:

```bash
pnpm run worktree:init
oat status --scope project
pnpm test
git status --porcelain
```

If checks fail, stop and report exact remediation.

If baseline tests fail, require explicit user override before proceeding.

If user proceeds with failing baseline tests:
- Prefer appending a note to active project `implementation.md` when a valid active project is set.
- If no valid active project exists yet, print the same note to console output only (non-blocking fallback).

Include:
- timestamp
- failing command
- short failure summary
- explicit statement that failures were pre-existing at worktree bootstrap time

## Typical Paths

- Local hidden root: `.worktrees/<branch>`
- Local visible root: `worktrees/<branch>`
- Sibling root: `../<repo>-worktrees/<branch>`
- Global root (explicit): `~/.oat/worktrees/<repo>/<branch>`
- Tool-managed existing worktree: `~/.codex/worktrees/<id>/<repo>`
