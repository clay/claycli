---
name: oat-repo-knowledge-index
version: 1.0.0
description: Use when onboarding OAT to a repository or when knowledge artifacts are stale. Generates or refreshes the codebase knowledge index using parallel mapper agents.
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash(git:*), Glob, Grep, AskUserQuestion, Task
---

# Knowledge Base Generation

Generate a comprehensive analysis of the codebase using parallel mapper agents.

## Progress Indicators (User-Facing)

When executing this skill, provide lightweight progress feedback so the user can tell what’s happening after they confirm.

- Print a phase banner once at start using horizontal separators, e.g.:

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   OAT ▸ CREATE REPO KNOWLEDGE INDEX
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Before multi-step work (thin index generation, spawning mappers, writing outputs), print 2–5 short step indicators, e.g.:
  - `[1/4] Checking existing knowledge…`
  - `[2/4] Generating thin index…`
  - `[3/4] Spawning mappers…`
  - `[4/4] Writing knowledge files…`
- For long-running operations (subagent runs, synthesis, large repo scans), print a start line and a completion line (duration optional).
- Keep it concise; don’t print a line for every shell command.

## Process

### Step 1: Check Existing Knowledge

```bash
# Check for actual knowledge files (not just .gitkeep)
EXISTING_MD=$(find .oat/repo/knowledge -name "*.md" -type f 2>/dev/null | head -1)
```

**If `$EXISTING_MD` is non-empty (actual content exists):**
- List current files: `ls -la .oat/repo/knowledge/*.md 2>/dev/null`
- Ask: "Refresh (delete + regenerate) or Skip?"
- If Refresh: `rm -rf .oat/repo/knowledge/*.md && mkdir -p .oat/repo/knowledge`
- If Skip: Exit

**If `$EXISTING_MD` is empty (no content or only .gitkeep):**
- Continue to Step 2

### Step 2: Create Knowledge Directory

```bash
mkdir -p .oat/repo/knowledge
```

### Step 3: Get Git SHAs for Frontmatter

```bash
# Get current HEAD SHA
HEAD_SHA=$(git rev-parse HEAD)

# Get merge base with origin/main (fallback to HEAD if not available)
MERGE_BASE_SHA=$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD)
```

Store as `HEAD_SHA` and `MERGE_BASE_SHA` for frontmatter.

### Step 4: Generate Thin Project Index

**Purpose:** Create a fast, lightweight index immediately so other skills can load it without waiting for full analysis.

```bash
oat index init --head-sha "$HEAD_SHA" --merge-base-sha "$MERGE_BASE_SHA"
```

This script:
- Detects repo name from package.json or directory
- Extracts package manager, scripts, entry points, and config files
- Generates `.oat/repo/knowledge/project-index.md` with thin metadata

**Why thin first:**
- Other skills can immediately load project-index.md for orientation
- Mappers can run in parallel without blocking on index generation
- Index gets enriched with full details after mappers complete

### Step 4b: Pre-flight Check - Test Background Write Permission

Test if the runtime allows Write tool in background agents.

```bash
# Create test directory
mkdir -p .oat/repo/knowledge/.preflight
```

Spawn a test agent to check Write permission (must use the same subagent type as the mapper agents):

```
subagent_type: "oat-codebase-mapper"
model: "haiku"
run_in_background: true
description: "Test write permissions"
prompt: |
  Test if Write tool works in background mode.

  Try to write a test file:
  - File: .oat/repo/knowledge/.preflight/test.txt
  - Content: "test"

  If Write succeeds, return: "WRITE_OK"
  If Write fails or is blocked, return: "WRITE_BLOCKED"
```

**Check result:**
```bash
if [ -f .oat/repo/knowledge/.preflight/test.txt ]; then
  echo "✓ Write works in background agents - using direct-write approach"
  WRITE_MODE="direct"
  rm -rf .oat/repo/knowledge/.preflight
else
  echo "⚠ Write blocked in background agents - using read-only fallback"
  WRITE_MODE="readonly"
fi
```

Store `$WRITE_MODE` for use in Step 5.

### Step 5: Spawn Parallel Mapper Agents

Use the approach determined by Step 4b pre-flight check.

**If `$WRITE_MODE="direct"` (Write works in background):**
- Use Step 5a - Direct Write Approach (recommended)

**If `$WRITE_MODE="readonly"` (Write blocked in background):**
- Use Step 5b - Read-Only Fallback Approach

---

### Step 5a: Direct Write Approach

Use Task tool with `subagent_type="oat-codebase-mapper"` and `run_in_background=true`.

**Approach:**
- Mapper agents write documents directly to `.oat/repo/knowledge/` using the Write tool
- Each agent returns only a brief confirmation (not document contents)
- This reduces context transfer and improves performance

**Agent 1: Tech Focus**

```
subagent_type: "oat-codebase-mapper"
model: "haiku"
run_in_background: true
description: "Map codebase tech stack"
```

Prompt:
```
Focus: tech

Analyze this codebase for technology stack and external integrations.

Produce these documents:
- stack.md - Languages, runtime, frameworks, dependencies, configuration
- integrations.md - External APIs, databases, auth providers, webhooks

Use templates from .agents/skills/oat-repo-knowledge-index/references/templates/

Include frontmatter:
---
oat_generated: true
oat_generated_at: {today}
oat_source_head_sha: {HEAD_SHA}
oat_source_main_merge_base_sha: {MERGE_BASE_SHA}
oat_warning: "GENERATED FILE - Do not edit manually. Regenerate with oat-repo-knowledge-index"
---

Instructions:
- Write documents directly to `.oat/repo/knowledge/` using the Write tool
- Follow the oat-codebase-mapper agent instructions for exploration and writing
- Use templates from .agents/skills/oat-repo-knowledge-index/references/templates/
- Include frontmatter with both SHA fields in every document
- Return only a brief confirmation when done (do NOT return document contents)
```

**Agent 2: Architecture Focus**

```
subagent_type: "oat-codebase-mapper"
model: "haiku"
run_in_background: true
description: "Map codebase architecture"
```

Prompt:
```
Focus: arch

Analyze this codebase architecture and directory structure.

Produce these documents:
- architecture.md - Pattern, layers, data flow, abstractions, entry points
- structure.md - Directory layout, key locations, naming conventions

Use templates from .agents/skills/oat-repo-knowledge-index/references/templates/

Include frontmatter:
---
oat_generated: true
oat_generated_at: {today}
oat_source_head_sha: {HEAD_SHA}
oat_source_main_merge_base_sha: {MERGE_BASE_SHA}
oat_warning: "GENERATED FILE - Do not edit manually. Regenerate with oat-repo-knowledge-index"
---

Instructions:
- Write documents directly to `.oat/repo/knowledge/` using the Write tool
- Follow the oat-codebase-mapper agent instructions for exploration and writing
- Use templates from .agents/skills/oat-repo-knowledge-index/references/templates/
- Include frontmatter with both SHA fields in every document
- Return only a brief confirmation when done (do NOT return document contents)
```

**Agent 3: Quality Focus**

```
subagent_type: "oat-codebase-mapper"
model: "haiku"
run_in_background: true
description: "Map codebase conventions"
```

Prompt:
```
Focus: quality

Analyze this codebase for coding conventions and testing patterns.

Produce these documents:
- conventions.md - Code style, naming, patterns, error handling
- testing.md - Framework, structure, mocking, coverage

Use templates from .agents/skills/oat-repo-knowledge-index/references/templates/

Include frontmatter:
---
oat_generated: true
oat_generated_at: {today}
oat_source_head_sha: {HEAD_SHA}
oat_source_main_merge_base_sha: {MERGE_BASE_SHA}
oat_warning: "GENERATED FILE - Do not edit manually. Regenerate with oat-repo-knowledge-index"
---

Instructions:
- Write documents directly to `.oat/repo/knowledge/` using the Write tool
- Follow the oat-codebase-mapper agent instructions for exploration and writing
- Use templates from .agents/skills/oat-repo-knowledge-index/references/templates/
- Include frontmatter with both SHA fields in every document
- Return only a brief confirmation when done (do NOT return document contents)
```

**Agent 4: Concerns Focus**

```
subagent_type: "oat-codebase-mapper"
model: "haiku"
run_in_background: true
description: "Map codebase concerns"
```

Prompt:
```
Focus: concerns

Analyze this codebase for technical debt, known issues, and areas of concern.

Produce this document:
- concerns.md - Tech debt, bugs, security, performance, fragile areas

Use template from .agents/skills/oat-repo-knowledge-index/references/templates/

Include frontmatter:
---
oat_generated: true
oat_generated_at: {today}
oat_source_head_sha: {HEAD_SHA}
oat_source_main_merge_base_sha: {MERGE_BASE_SHA}
oat_warning: "GENERATED FILE - Do not edit manually. Regenerate with oat-repo-knowledge-index"
---

Instructions:
- Write documents directly to `.oat/repo/knowledge/` using the Write tool
- Follow the oat-codebase-mapper agent instructions for exploration and writing
- Use templates from .agents/skills/oat-repo-knowledge-index/references/templates/
- Include frontmatter with both SHA fields in every document
- Return only a brief confirmation when done (do NOT return document contents)
```

---

### Step 5b: Read-Only Fallback Approach

Use Task tool with `subagent_type="Explore"` and `run_in_background=true`.

**Approach:**
- Agents do NOT use Write or Bash tools
- Agents return complete markdown contents in their response
- Orchestrator extracts markdown and writes files
- More compatible but larger context transfer

**Agent 1: Tech Focus**

```
subagent_type: "Explore"
model: "haiku"
run_in_background: true
description: "Map codebase tech stack"

Prompt:
Focus: tech

Analyze this codebase for technology stack and external integrations.

Produce these documents:
- stack.md - Languages, runtime, frameworks, dependencies, configuration
- integrations.md - External APIs, databases, auth providers, webhooks

Use templates from .agents/skills/oat-repo-knowledge-index/references/templates/

Include frontmatter:
---
oat_generated: true
oat_generated_at: {today}
oat_source_head_sha: {HEAD_SHA}
oat_source_main_merge_base_sha: {MERGE_BASE_SHA}
oat_warning: "GENERATED FILE - Do not edit manually. Regenerate with oat-repo-knowledge-index"
---

Constraints:
- Do NOT use Write or Bash tools.
- Return the complete markdown contents in your final response.
- Format as:

--- stack.md ---
```markdown
<content here>
```

--- integrations.md ---
```markdown
<content here>
```
```

**Agent 2: Architecture Focus**

```
subagent_type: "Explore"
model: "haiku"
run_in_background: true
description: "Map codebase architecture"

Prompt:
Focus: arch

Analyze this codebase architecture and directory structure.

Produce these documents:
- architecture.md - Pattern, layers, data flow, abstractions, entry points
- structure.md - Directory layout, key locations, naming conventions

Use templates from .agents/skills/oat-repo-knowledge-index/references/templates/

Include frontmatter:
---
oat_generated: true
oat_generated_at: {today}
oat_source_head_sha: {HEAD_SHA}
oat_source_main_merge_base_sha: {MERGE_BASE_SHA}
oat_warning: "GENERATED FILE - Do not edit manually. Regenerate with oat-repo-knowledge-index"
---

Constraints:
- Do NOT use Write or Bash tools.
- Return the complete markdown contents in your final response.
- Format as:

--- architecture.md ---
```markdown
<content here>
```

--- structure.md ---
```markdown
<content here>
```
```

**Agent 3: Quality Focus**

```
subagent_type: "Explore"
model: "haiku"
run_in_background: true
description: "Map codebase conventions"

Prompt:
Focus: quality

Analyze this codebase for coding conventions and testing patterns.

Produce these documents:
- conventions.md - Code style, naming, patterns, error handling
- testing.md - Framework, structure, mocking, coverage

Use templates from .agents/skills/oat-repo-knowledge-index/references/templates/

Include frontmatter:
---
oat_generated: true
oat_generated_at: {today}
oat_source_head_sha: {HEAD_SHA}
oat_source_main_merge_base_sha: {MERGE_BASE_SHA}
oat_warning: "GENERATED FILE - Do not edit manually. Regenerate with oat-repo-knowledge-index"
---

Constraints:
- Do NOT use Write or Bash tools.
- Return the complete markdown contents in your final response.
- Format as:

--- conventions.md ---
```markdown
<content here>
```

--- testing.md ---
```markdown
<content here>
```
```

**Agent 4: Concerns Focus**

```
subagent_type: "Explore"
model: "haiku"
run_in_background: true
description: "Map codebase concerns"

Prompt:
Focus: concerns

Analyze this codebase for technical debt, known issues, and areas of concern.

Produce this document:
- concerns.md - Tech debt, bugs, security, performance, fragile areas

Use template from .agents/skills/oat-repo-knowledge-index/references/templates/

Include frontmatter:
---
oat_generated: true
oat_generated_at: {today}
oat_source_head_sha: {HEAD_SHA}
oat_source_main_merge_base_sha: {MERGE_BASE_SHA}
oat_warning: "GENERATED FILE - Do not edit manually. Regenerate with oat-repo-knowledge-index"
---

Constraints:
- Do NOT use Write or Bash tools.
- Return the complete markdown contents in your final response.
- Format as:

--- concerns.md ---
```markdown
<content here>
```
```

---

### Step 6: Wait for Agent Completion

**If using Step 5a (direct write):**
- Wait for all 4 mapper agents to complete
- Each agent writes documents directly to `.oat/repo/knowledge/` and returns a brief confirmation
- Expected confirmations should indicate which documents were written
- Proceed to Step 7

**If using Step 5b (read-only):**
- Wait for all 4 mapper agents to complete
- Each agent returns markdown content in their response
- Proceed to Step 6b to extract and write files

### Step 6b: Extract and Write Files (Read-Only Mode Only)

If using read-only mode, extract markdown from agent outputs and write to files.

Use Python to extract markdown blocks:

```python
import json
import re

agents = [
    {'id': 'AGENT_ID_1', 'files': ['stack.md', 'integrations.md']},
    {'id': 'AGENT_ID_2', 'files': ['architecture.md', 'structure.md']},
    {'id': 'AGENT_ID_3', 'files': ['conventions.md', 'testing.md']},
    {'id': 'AGENT_ID_4', 'files': ['concerns.md']}
]

for agent in agents:
    output_path = f"/private/tmp/claude-502/-Users-thomas-stang-Code-open-agent-toolkit/tasks/{agent['id']}.output"

    with open(output_path, 'r') as f:
        lines = f.readlines()

    # Find the last JSON message with agent response
    for line in reversed(lines):
        if line.strip().startswith('{') and '"message"' in line:
            data = json.loads(line)
            if 'message' in data and 'content' in data['message']:
                content = data['message']['content']
                if isinstance(content, list) and len(content) > 0:
                    text = content[0].get('text', '')

                    # Extract markdown blocks - handle both formats
                    # Standard: --- filename.md ---
                    pattern = r'---\s+(\w+\.md)\s+---\s*\n\s*```markdown\n(.*?)\n```'
                    matches = re.findall(pattern, text, re.DOTALL)

                    # Alternative: ## filename.md (fallback)
                    if not matches:
                        alt_pattern = r'##\s+(\w+\.md)\s*\n\s*```markdown\n(.*?)\n```'
                        matches = re.findall(alt_pattern, text, re.DOTALL)

                    for filename, markdown in matches:
                        with open(f'.oat/repo/knowledge/{filename}', 'w') as out:
                            out.write(markdown)
                        print(f"✓ Wrote {filename}")

                    break
```

This extracts markdown and writes all 7 knowledge files.

### Step 7: Verify All Documents Created

```bash
ls -la .oat/repo/knowledge/
wc -l .oat/repo/knowledge/*.md
```

**Checklist:**
- All 7 documents exist
- No empty documents (each >20 lines)
- All have frontmatter with oat_generated: true

### Step 8: Enrich Project Index

Now that all 7 detailed knowledge files exist, enrich the thin project-index.md with full details.

Read all 7 knowledge files to extract key information:
- `stack.md` - Technologies, runtime, key dependencies
- `architecture.md` - Overall pattern, key abstractions
- `structure.md` - Directory layout, file organization
- `integrations.md` - External services, APIs
- `testing.md` - Test framework, approach
- `conventions.md` - Code style, patterns
- `concerns.md` - Technical debt, issues

**Enrichment approach:**

Read existing `.oat/repo/knowledge/project-index.md` (thin version from Step 4).

Replace placeholder sections with full details:

1. **Overview**: 2-3 sentences capturing what this codebase does (from architecture.md + stack.md)
2. **Purpose**: Why it exists, problems it solves (from architecture.md intro)
3. **Technology Stack**: High-level summary (primary language, framework, key tools from stack.md)
4. **Architecture**: Brief pattern description (from architecture.md "Pattern Overview")
5. **Key Features**: 3-5 main capabilities (from architecture.md layers + integrations.md)
6. **Project Structure**: Brief directory overview (from structure.md top-level dirs)
7. **Getting Started**: Quick start from stack.md (runtime, package manager, build commands)
8. **Development Workflow**: Common commands (from stack.md + conventions.md)
9. **Testing**: Testing approach summary (from testing.md framework + run commands)
10. **Known Issues**: Link to concerns.md with 1-2 line summary

Update frontmatter:
- Change `oat_index_type: thin` → `oat_index_type: full`
- Keep same SHAs (already set in Step 4)
- Update warning: "GENERATED FILE - Do not edit manually. Regenerate with oat-repo-knowledge-index"

Update links at bottom to show files are available (not "pending"):
```markdown
**Generated Knowledge Base Files:**
- [stack.md](stack.md) - Technologies and dependencies
- [architecture.md](architecture.md) - System design and patterns
- [structure.md](structure.md) - Directory layout
- [integrations.md](integrations.md) - External services
- [testing.md](testing.md) - Test structure and practices
- [conventions.md](conventions.md) - Code style and patterns
- [concerns.md](concerns.md) - Technical debt and issues
```

### Step 9: Verify Project Index

```bash
cat .oat/repo/knowledge/project-index.md | head -50
```

Expected: Complete overview with frontmatter and links

### Step 10: Commit Knowledge Base

```bash
git add .oat/repo/knowledge/
git commit -m "docs: generate knowledge base

- project-index.md - High-level codebase overview
- stack.md - Technologies and dependencies
- architecture.md - System design and patterns
- structure.md - Directory layout
- conventions.md - Code style and patterns
- testing.md - Test structure and practices
- integrations.md - External services and APIs
- concerns.md - Technical debt and issues

Generated from commit: {MERGE_BASE_SHA}"
```

### Step 10b: Update Tracking Manifest

Record the knowledge index run in the shared tracking manifest:

```bash
ROOT_TARGET=$(bash .agents/skills/oat-agent-instructions-analyze/scripts/resolve-tracking.sh root)
ROOT_HASH=$(echo "$ROOT_TARGET" | jq -r '.commitHash')
ROOT_BRANCH=$(echo "$ROOT_TARGET" | jq -r '.baseBranch')

bash .agents/skills/oat-agent-instructions-analyze/scripts/resolve-tracking.sh \
  write knowledgeIndex "$ROOT_HASH" "$ROOT_BRANCH" full \
  --artifact-path ".oat/repo/knowledge/"
```

This enables delta mode for future runs — other OAT operations can check when the knowledge index was last generated.

### Step 11: Output Summary

```
Knowledge base generated in .oat/repo/knowledge/

Files created:
- project-index.md ({N} lines) - High-level overview
- stack.md ({N} lines) - Technologies and dependencies
- architecture.md ({N} lines) - System design and patterns
- structure.md ({N} lines) - Directory layout
- conventions.md ({N} lines) - Code style and patterns
- testing.md ({N} lines) - Test structure and practices
- integrations.md ({N} lines) - External services and APIs
- concerns.md ({N} lines) - Technical debt and issues

---

Next: Start a project with oat-project-new or explore knowledge files
```

### Step 12: Regenerate Dashboard

After knowledge base generation, regenerate the repo state dashboard:

```bash
oat state refresh
```

This ensures the dashboard reflects fresh knowledge status immediately.

## Success Criteria

- .oat/repo/knowledge/ directory with 8 files (7 analysis + 1 index)
- All files have frontmatter with both head_sha and merge_base_sha
- Commit created with conventional format
- User presented with clear summary and next steps
