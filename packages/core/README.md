# @thoth/core

Pure domain package for Thoth.

Intended responsibilities:

1. Task lifecycle model.
2. Provider-backed router decision model.
3. Contract freeze model.
4. Loop policy model.
5. Review verdict and evidence model.
6. Permission risk model.

The package is the functional core of Workspace authority. `transitionAuthority` is the only
domain-state transition entry: callers supply validated projections, a command, a timestamp and
all required IDs. The result is a normalized mutation for a Repository/Unit of Work to commit.

The package has no database, process, UI or Provider runtime dependency.
