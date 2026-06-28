# Lessons Learned

## `NTH-EXP-001` Do Not Carry Old Plugin Runtime Forward

Motivation:

The old Thoth plugin implementation accumulated Python runtime, generated Claude/Codex surfaces, dashboard templates, Textual TUI, selftests and release machinery. It was valuable as a historical experiment but no longer matched the New Thoth product direction.

Observed result:

Keeping old runtime code in the active working tree would make future agents treat old plugin compatibility as current truth and would compete with the TypeScript / Node authority runtime design.

Conclusion:

Old plugin source should be recovered from the archive release or archive branch when needed. It should not remain in the active New Thoth skeleton.

Retry condition:

Only revisit old plugin code as reference material for a specific prompt, evidence, privacy, or loop design decision. Do not port it wholesale.

## `NTH-EXP-002` Prompt Assets Should Be Contracts, Not Legacy Code

Motivation:

Old `prompt_specs.py` contained useful hard stops and evidence-first phase lessons, but it was embedded in obsolete Python command projection machinery.

Observed result:

Retaining that file would preserve too much old runtime surface. Deleting it without extraction would lose hard-won prompt lessons.

Conclusion:

Extract prompt value into `.agent-os/designs/new-thoth-prompt-contract-seeds.md` as structured contract seeds.

Retry condition:

When implementing Router, Clarify, Plan, Execute or Review prompts, use the seed document and current product principles instead of importing old Python code.
