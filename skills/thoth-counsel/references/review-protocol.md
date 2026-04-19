# Review Protocol

Methodology for /thoth:review — first-principles analysis.

## Step 1: Role Identification

Before reviewing, explicitly identify the expert role needed:
- **Systems Architect**: for code architecture, scalability, design patterns
- **ML Researcher**: for model design, training strategy, metrics
- **Security Auditor**: for vulnerability assessment, attack surface
- **UX Designer**: for user experience, interaction design
- **Domain Expert**: for field-specific correctness
- **Devil's Advocate**: for challenging assumptions, finding blind spots

State the role: "To review this, I'll think as a {role} because {reason}."

## Step 2: First Principles Decomposition

Break the review target into axioms:
1. What is this trying to achieve? (goal)
2. What assumptions does it make? (premises)
3. Which assumptions are validated? (evidence)
4. Which assumptions are taken on faith? (risks)
5. What would happen if each assumption were wrong? (failure modes)

## Step 3: Structured Critique

### Strengths
What works well. Why it works. What enables it.

### Weaknesses
What could break. Under what conditions. How likely.

### Risks
What could go wrong at scale, over time, or under stress.
Include second-order effects (if A fails, what else breaks?).

### Blind Spots
What hasn't been considered. What's missing from the analysis.
Things that "everyone knows" but nobody has verified.

## Step 4: Recommendations

Each recommendation:
- **Action**: What specifically to do
- **Why**: What problem it solves
- **Tradeoff**: What you give up
- **Priority**: Must-do vs. should-do vs. nice-to-have

## Step 5: Interactive Discussion

Don't deliver a monologue. After presenting findings:
- Ask the user which points surprise them
- Probe their reasoning on contested points
- Update conclusions based on new information
