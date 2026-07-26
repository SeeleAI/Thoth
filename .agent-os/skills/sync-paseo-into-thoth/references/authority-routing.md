# Authority Routing

Use this reference during Stage 1 to recover only the authority needed by the affected Paseo
change. Never infer Thoth product architecture from the current source tree or from Paseo defaults.

## Always Read

1. `AGENTS.md`
2. `.agent-os/project-index.md`
3. The top-next-action entry in `.agent-os/todo.md`
4. The latest relevant entry in `.agent-os/run-log.md`
5. `.agent-os/upstream-transplant.md`
6. The current Git branch, HEAD, status, and relevant remote refs

## Read by Change Type

| Change type                                              | Required authority and handbook                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Product or user journey                                  | `designs/core-design-principles.md`, `thoth-high-level-design.md`, `thoth-mvp-user-journey.md`       |
| App, Composer, Timeline, Card, Quick, Loop               | `designs/thoth-app-runtime-contract.md`, `designs/thoth-engineering-architecture.md`                 |
| Runtime instructions or semantic tools                   | `designs/thoth-prompt-contract-seeds.md`, runtime contract, affected RuntimeBundle sources           |
| Package ownership or main-chain change                   | `designs/thoth-engineering-architecture.md`, `change-decisions.md` for current `NTH-CD-*` boundaries |
| Development or dependency work                           | `docs/development.md` and affected package `AGENTS.md`                                               |
| Tests, gates, fixtures, or real Provider evidence        | `docs/testing.md`                                                                                    |
| Desktop, server CLI, AppImage, Android, or iOS packaging | `docs/packaging.md`                                                                                  |
| Commit, push, tag, Release, workflow, or public assets   | `docs/release.md` and current Release evidence                                                       |
| External official material                               | `.agent-os/official-sources/platform-index.md` and the relevant official-source note                 |

Read the canonical design documents in the order prescribed by `AGENTS.md` when product goals or
ownership must be reconstructed. Package-local contracts may tighten the root contract but cannot
rewrite global authority.

## Stable Ownership Map

| Thoth area          | Owns                                                             | Must not own                                        |
| ------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| Protocol            | Wire schemas, RPC Registry, Timeline and binary codecs           | Daemon implementation or Provider calls             |
| Client              | Semantic daemon SDK and direct/Relay transports                  | SQLite or Task authority                            |
| Core                | Pure deterministic authority transitions                         | IO, Provider SDKs, or UI                            |
| Daemon              | Application use cases, Workspace stores, scheduling, ToolGateway | Provider cognition or hidden model calls            |
| Drivers             | HarnessAdapter and Provider transport translation                | Task truth or product branching                     |
| App/Desktop/TUI/CLI | Presentation and control surfaces                                | Durable authority or direct Provider/storage access |
| Relay               | Zero-knowledge E2EE byte transport                               | Plaintext, offline queue, or cloud task truth       |

Paseo's production-grade App, transport, Desktop, and Provider engineering may inform these areas,
but all accepted changes must terminate in this ownership model.
