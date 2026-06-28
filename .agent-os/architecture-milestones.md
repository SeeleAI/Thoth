# Architecture Milestones

## Current Architecture State

Current state is a skeleton, not an implementation.

1. Root package manager: `npm workspaces`.
2. Runtime language direction: TypeScript / Node.
3. Package namespace: `@thoth/*`.
4. License: `GPL-3.0-only`.
5. Active package layout:
   - `packages/protocol`
   - `packages/client`
   - `packages/core`
   - `packages/daemon`
   - `packages/drivers`
   - `packages/tui`
   - `packages/app`
   - `packages/desktop`
   - `packages/relay`
   - `packages/cli`
6. No package currently contains business implementation.

## Workstreams

1. `NTH-WS-001`: Product authority and decision preservation.
2. `NTH-WS-002`: Monorepo skeleton and metadata.
3. `NTH-WS-003`: Clarify, Router, task contract and loop runtime design.
4. `NTH-WS-004`: Harness, ACP, relay and multi-device implementation research.

## Milestones

### `NTH-MS-001` Repo Reset

State: `done`

Goal: Remove old plugin runtime from the active working tree and establish the New Thoth skeleton.

Acceptance:

1. Old Python/plugin/runtime paths are gone.
2. `packages/` contains exactly the 10 approved packages.
3. Root metadata reflects `npm workspaces` and `GPL-3.0-only`.
4. Recovery docs explain current truth.

### `NTH-MS-002` Authority And Router Slice

State: `ready`

Goal: Design and implement the first real New Thoth slice: local authority store, Router fast path, workspace registry and formal task draft creation.

Acceptance:

1. `answer`, `direct_action` and `formal_task` routing exists as a real protocol.
2. `hi`-level input stays on a fast path.
3. High-confidence workspace context can resolve without defensive confirmation.
4. Low-confidence workspace writes are blocked by one golden question.

### `NTH-MS-003` Clarify-To-Contract Slice

State: `backlog`

Goal: Implement the private-secretary clarify flow and contract freeze model.

Acceptance:

1. Clarify asks only material golden questions.
2. Agent-discoverable facts are not pushed back to the user.
3. Formal task readiness requires goal, constraints, risk and acceptance.

### `NTH-MS-004` Attempt Loop Slice

State: `backlog`

Goal: Implement Plan -> Execute -> Review attempts with aggressive retry policy.

Acceptance:

1. Review cannot modify files.
2. Failed review produces a non-repeating next attempt focus.
3. Default max failed attempts is 3.
4. Success requires evidence tied to frozen acceptance.

### `NTH-MS-005` Multi-Surface Skeleton Activation

State: `backlog`

Goal: Add first runnable TUI, desktop/mobile client and relay paths after authority loop semantics are stable.

Acceptance:

1. UI shells use the same protocol and authority.
2. TUI uses OpenTUI.
3. Mobile remains read-only when offline.
4. Relay remains zero-knowledge E2EE transport only.
