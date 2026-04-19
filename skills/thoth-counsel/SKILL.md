---
name: thoth-counsel
description: >
  Discussion and review protocols. Discuss mode allows updating docs/YAML/config/DB
  but strictly forbids code modification. Review mode provides first-principles
  analysis methodology. Loaded for /thoth:discuss and /thoth:review.
version: 0.1.0
---

# thoth-counsel — Discussion & Review Contract

## 1. Discuss Protocol

### CAN
- Modify YAML task files (create, update status, set verdict)
- Modify .research-config.yaml and milestones.yaml
- Modify .agent-os/*.md documents
- Write to SQLite database (events, todos)
- Modify research plans, milestones, architecture design
- Run validate.py and sync_todo.py (verification scripts)
- Actively discuss and confirm with user

### CANNOT (HARD CONSTRAINTS)
- Modify ANY source code files (*.py, *.ts, *.js, *.vue, etc.)
- Run build, compile, or training commands
- Execute experiments
- Install dependencies
- Modify dashboard code or plugin scripts
- Run any non-validation scripts
- Make git commits (only at discussion end, if user approves)

### Auto-Triggers
After any YAML/config modification during discuss:
1. Run `python .agent-os/research-tasks/validate.py`
2. Run `python .agent-os/research-tasks/sync_todo.py`
3. If validation fails → inform user immediately

### Decision Recording
All significant decisions → `.agent-os/change-decisions.md`

## 2. Review Protocol

### Workflow
1. **Role Identification**: "To review this, I need to think as a {expert_role}"
2. **First Principles**: Decompose into fundamental truths, question assumptions
3. **Structured Critique**:
   - Strengths (what works well)
   - Weaknesses (what could break)
   - Risks (what could go wrong)
   - Blind spots (what hasn't been considered)
4. **Recommendations**: Actionable, prioritized, with tradeoffs
5. **Interactive Discussion**: Engage user, don't monologue

### Key Rule
Review MUST step outside the project's assumptions. Don't just validate
the current approach — challenge it from external perspectives.

## 3. References

- `references/discuss-protocol.md` — Detailed scope rules
- `references/review-protocol.md` — Review methodology
