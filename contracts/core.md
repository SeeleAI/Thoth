# Thoth Core Contract

These rules govern every public Thoth command.

## Scope Guard

- Each public command owns a bounded surface.
- If a user request falls outside that surface, stop and route to the correct command.
- Do not silently perform actions that belong to a different command.

## Session Awareness

- For every command except `init`, require `.thoth/project/project.json` in the current working directory.
- Read project identity and dashboard/runtime settings from canonical `.thoth` authority before producing user-facing output.

## Error Routing

- Report precondition failures explicitly.
- Report validation failures explicitly.
- Do not silently skip checks or fall back to weaker behavior.

## Plan Discipline

- `extend` always requires an explicit plan before mutation.
- Other commands may plan first when the request is ambiguous or high-risk.
- If execution discovers a new blocker that would change the approved action, stop and surface it.
