---
name: thoth:review
description: First-principles review — step outside the project and critique from expert perspective
argument-hint: "[--executor claude|codex] [--model <model>] [--effort <level>] <what to review: code, idea, architecture, approach>"
---

# /thoth:review — 审判

## Scope Guard

**CAN:**
- Read any file in the project
- Analyze code, architecture, ideas, approaches
- Discuss with user interactively
- Record conclusions in .agent-os/ docs

**CANNOT:**
- Modify source code
- Make git commits
- Run experiments or builds
- Update YAML task state (use /thoth:discuss for that)

## Workflow

### Step 1: Parse Review Target
From `$ARGUMENTS`: what to review (code path, idea, design decision, approach).

Optional executor flags:
- `--executor claude|codex` (default: `claude`)
- `--model <model>` and `--effort <level>` when `--executor codex`

### Step 2: Role Identification
"To properly review this, I need to think as a {expert_role}."
Example roles: systems architect, ML researcher, security auditor, UX designer.

If `--executor codex`, delegate the review request to the internal
`codex-worker` agent after framing the target and required context.

### Step 3: First Principles Decomposition
Break the review target into fundamental truths:
- What are the core assumptions?
- Which assumptions are validated vs. assumed?
- What would change if each assumption were wrong?

### Step 4: Structured Critique
Present findings in this order:
1. **Strengths**: What works well and why
2. **Weaknesses**: What could break and how
3. **Risks**: What could go wrong under stress/scale/time
4. **Blind Spots**: What hasn't been considered

### Step 5: Recommendations
Actionable, prioritized recommendations with tradeoffs.
Each recommendation: what to do, why, what you give up.

### Step 6: Interactive Discussion
Engage user in Q&A. Don't monologue.

### Step 7: Record (if significant)
If the review produced significant insights:
- Update relevant .agent-os/ docs
- Note in change-decisions.md if decisions were made
