# Thoth Execution Contract

These rules govern `run` and `loop`.

## Atomicity

- Make one logical change per iteration.
- If a proposed step spans unrelated edits, split it.

## Commit Discipline

Use focused staging:

```bash
git add <specific-files>
git commit -m "experiment(<scope>): <description>"
```

Do not use blanket staging commands.

## Loop Decisions

- Keep improvements that pass verification and guard checks.
- Rework limited times when an improvement regresses a guard.
- Revert or discard failed experiments instead of letting drift accumulate.
