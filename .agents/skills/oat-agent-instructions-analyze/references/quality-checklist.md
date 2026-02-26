# Instruction File Quality Checklist

Per-file evaluation criteria for agent instruction files. Use this checklist to score each instruction file during analysis. The full quality guidance lives in `docs/agent-instruction.md` — this is a distilled, actionable checklist.

## Evaluation Criteria

### 1. Commands Correct and Runnable

- [ ] All referenced commands exist in package.json scripts or are valid shell commands
- [ ] Command sequences match the documented build/test/lint workflow
- [ ] No placeholder commands (`{command}`, `TODO`, etc.) in non-template files
- **Severity if failing:** Medium (stale commands) or Critical (commands that would break builds)

### 2. Non-Negotiables Near Top

- [ ] Security rules, access controls, and data handling requirements appear in the first screenful (~30 lines)
- [ ] Canonical commands (install, dev, build, test, lint) appear before detailed conventions
- [ ] "Definition of Done" or acceptance criteria are present early
- **Severity if failing:** High (security non-negotiables missing) or Medium (ordering issue)

### 3. No Duplication Across Files

- [ ] Root file does not repeat content that scoped files cover
- [ ] Scoped files do not copy-paste root-level sections
- [ ] Cross-file `@import` or reference directives are used where appropriate
- **Severity if failing:** Medium

### 4. Size Within Budget

- [ ] Root files (AGENTS.md, CLAUDE.md): <300 lines (hard max 500)
- [ ] Scoped/package files: 40–150 lines
- [ ] Individual rules files: <80 lines
- [ ] Total across all formats: <32 KiB
- **Severity if failing:** Medium (over budget) or Low (close to limit)

### 5. Scoped Only for Real Divergence

- [ ] Scoped files exist only where the directory has genuinely different stack, workflow, or domain requirements
- [ ] No scoped files that merely repeat root-level guidance
- **Severity if failing:** Low

### 6. Precedence Clear

- [ ] Override semantics are explicit (nearest-wins for AGENTS.md, import directives for CLAUDE.md)
- [ ] No ambiguous or conflicting instructions across scope levels
- **Severity if failing:** Medium

### 7. No Circular Imports

- [ ] File A does not import File B which imports File A
- [ ] Import chains are acyclic
- **Severity if failing:** High

### 8. Definition of Done Present

- [ ] Objective, verifiable criteria for when work is "done"
- [ ] Not vague ("write good code") — concrete checks (tests pass, lint clean, types valid)
- **Severity if failing:** Medium

### 9. Staleness

- [ ] Referenced file paths still exist in the repo
- [ ] Referenced commands still work
- [ ] Technology/framework references match current stack
- [ ] No references to removed features or deprecated patterns
- **Severity if failing:** Medium (stale references) or High (actively misleading)

### 10. Cross-Format Body Consistency

- [ ] Glob-scoped rules targeting the same paths have identical body content across providers
- [ ] Only frontmatter differs between Claude rules, Cursor rules, and Copilot instructions
- [ ] Body divergence is flagged as drift
- **Severity if failing:** Medium

## Scoring

For each file, count passing criteria out of the applicable set (some criteria only apply to certain file types):

- **10/10 applicable passing** → Quality: pass
- **8-9/10** → Quality: minor issues
- **5-7/10** → Quality: significant issues
- **<5/10** → Quality: major issues
