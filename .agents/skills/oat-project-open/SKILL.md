---
name: oat-project-open
description: Use when switching to or resuming a specific OAT project. Delegates to `oat project open` for validation and activation.
version: 1.0.0
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash, AskUserQuestion
---

# Open Project

Open an OAT project with CLI-native validation.

## Progress Indicators (User-Facing)

When executing this skill, provide lightweight progress feedback so the user can tell what’s happening after they confirm.

- Print a phase banner once at start using horizontal separators, e.g.:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OAT ▸ OPEN PROJECT
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Before multi-step work, print step indicators, e.g.:
  - `[1/3] Resolving project selection…`
  - `[2/3] Running oat project open…`
  - `[3/3] Confirming active project…`

## Process

### Step 1: Resolve Project Selection

If the user provided a project name, use it.
Otherwise ask: "Which project should I open?".

### Step 2: Run CLI Command

```bash
oat project open "{project-name}"
```

### Step 3: Confirm to User

Show user:
- Active project: {project-name}
- State dashboard refreshed by the command
