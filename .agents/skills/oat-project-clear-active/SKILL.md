---
name: oat-project-clear-active
description: Use when switching context or cleaning up project state. Clears the active OAT project.
version: 1.0.0
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash, AskUserQuestion
---

# Clear Active Project

Clear the active OAT project.

## Progress Indicators (User-Facing)

When executing this skill, provide lightweight progress feedback so the user can tell what’s happening after they confirm.

- Print a phase banner once at start using horizontal separators, e.g.:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OAT ▸ CLEAR ACTIVE PROJECT
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Before multi-step work, print step indicators, e.g.:
  - `[1/3] Checking current active project…`
  - `[2/3] Pausing active project…`
  - `[3/3] Confirming state update…`

## Process

### Step 1: Check Current State

```bash
current=$(oat config get activeProject 2>/dev/null || true)
if [[ -z "$current" ]]; then
  echo "No active project is currently set."
  exit 0
fi
echo "Current active project: $current"
```

### Step 2: Pause Project

```bash
oat project pause
```

### Step 3: Confirm to User

Show user: "Active project cleared via `oat project pause`."
