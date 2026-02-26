# Directory Assessment Criteria

When does a directory need its own instruction file? Use these criteria to identify coverage gaps during analysis. The full guidance lives in `docs/agent-instruction.md` — this is a distilled, actionable checklist.

## Primary Indicators (any one = likely needs instructions)

### 1. Has Own Build Configuration

- Contains `package.json`, `tsconfig.json`, `Cargo.toml`, `go.mod`, or similar
- Has its own build/test/lint commands distinct from the root
- **Signal strength:** Strong — this is a semi-independent unit with its own workflow

### 2. Different Tech Stack from Parent

- Uses a different language, framework, or runtime than the parent directory
- Example: root is TypeScript/Node but this directory is Python or Rust
- **Signal strength:** Strong — agents need different conventions and commands

### 3. Public API Surface

- Exposes APIs consumed by external callers (REST endpoints, library exports, CLI commands)
- Has consumers outside the repo or outside the directory
- **Signal strength:** Strong — API contracts and conventions must be explicit

### 4. Distinct Domain Boundary

- Represents a bounded context or module with domain-specific business logic
- Has its own data models, terminology, or invariants
- Example: `packages/billing/`, `services/auth/`, `lib/search-engine/`
- **Signal strength:** Moderate — depends on complexity

### 5. Significant Codebase (>10 source files)

- Contains more than ~10 source files with specialized conventions
- Has patterns or conventions that differ from the rest of the repo
- **Signal strength:** Moderate — larger directories benefit more from explicit guidance

## Secondary Indicators (strengthen the case but not sufficient alone)

### 6. Has Specialized Testing Patterns

- Uses different test frameworks or patterns than the root
- Has integration tests, E2E tests, or performance tests with specific setup requirements

### 7. Has Deployment or Infrastructure Concerns

- Contains IaC, deployment configs, or CI/CD pipelines
- Has environment-specific configuration

### 8. Multiple Contributors with Different Conventions

- Directory is a common source of style inconsistencies or review feedback
- Has implicit conventions that are not documented anywhere

## Assessment Output

For each directory meeting 1+ primary indicators:

| Directory | Indicators | Severity | Recommendation |
|-----------|-----------|----------|----------------|
| `{path/}` | {which criteria} | High/Medium | Create scoped AGENTS.md / Create rules for {topic} |

**Severity mapping:**
- **High:** Primary indicators 1-3 (own build, different stack, public API) — these are clear gaps
- **Medium:** Primary indicators 4-5 (domain boundary, large codebase) — beneficial but not urgent

## Exclusions

Do NOT flag these as needing instructions:
- `node_modules/`, `dist/`, `build/`, `.git/` — generated/external
- Directories with <5 source files and no build config — too small to warrant overhead
- Test directories that follow the same patterns as their parent — covered by parent instructions
- Directories already covered by a parent's scoped rules (e.g., Cursor rule with `globs: packages/cli/**`)
