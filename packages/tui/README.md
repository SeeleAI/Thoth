# @thoth/tui

Terminal UI package for New Thoth.

Fixed decision:

1. The TUI must use OpenTUI.
2. The TUI is a single-workspace control surface.
3. The TUI must use the shared client/protocol path and must not write authority directly.

Deferred decision:

1. Node FFI vs Bun runtime remains intentionally undecided until the first OpenTUI spike.

Current status: skeleton only. No implementation exists in this package yet.
