---
name: oat-project-new
version: 1.0.0
description: Use when starting a spec-driven OAT project from scratch. Scaffolds a new project under PROJECTS_ROOT and sets it active.
argument-hint: "<project-name> [--force]"
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash(pnpm:*), Glob, Grep, AskUserQuestion
---

# New OAT Project

Create a new OAT project directory, scaffold standard artifacts from `.oat/templates/`, and set `activeProject` in local config.

## Progress Indicators (User-Facing)

- Print a phase banner once at start using horizontal separators, e.g.:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OAT ▸ NEW PROJECT
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Before multi-step work, print step indicators, e.g.:
  - `[1/3] Validating project name…`
  - `[2/3] Scaffolding project artifacts…`
  - `[3/3] Refreshing dashboard…`

## Process

### Step 0: Resolve Projects Root

Resolve `{PROJECTS_ROOT}` (same order as other OAT skills):

```bash
PROJECTS_ROOT="${OAT_PROJECTS_ROOT:-$(oat config get projects.root 2>/dev/null || echo \".oat/projects/shared\")}"
PROJECTS_ROOT="${PROJECTS_ROOT%/}"
```

### Step 1: Get Project Name

If not provided in `$ARGUMENTS`, ask the user for `{project-name}` (slug format: alphanumeric/dash/underscore only).

### Step 2: Scaffold Project (Deterministic)

Use the CLI scaffolder:

```bash
oat project new "{project-name}" --mode spec-driven
```

Optional flags:
- `--force` (non-destructive; only fills missing files/dirs, does not overwrite)
- `--no-set-active`
- `--no-dashboard`

### Step 3: Confirm + Next Step

Confirm to the user:
- Project path created: `{PROJECTS_ROOT}/{project-name}`
- Active project set in local config: `.oat/config.local.json` (`activeProject`)
- Repo State Dashboard refreshed: `.oat/state.md` (if enabled)

Then explicitly instruct the user to run discovery next:
- Next command: `oat-project-discover`

## Success Criteria

- ✅ `{PROJECTS_ROOT}/{project-name}/` exists
- ✅ Standard artifacts exist in the project dir (copied from `.oat/templates/*.md`)
- ✅ `activeProject` in `.oat/config.local.json` points at the project path
- ✅ `.oat/state.md` is refreshed (unless disabled)
