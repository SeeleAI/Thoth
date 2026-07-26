# Change Classification

Use this reference during Stage 2. Classify coherent capabilities rather than entire commits when a
commit mixes acceptable and prohibited work.

## Dispositions

| Disposition | Use when                                                                                        | Required record                                                 |
| ----------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `adopt`     | The change is architecture-neutral and can land with naming, dependency, and test adaptation    | Final module, interface, state owner, acceptance                |
| `adapt`     | The capability is valuable but Paseo's ownership or product semantics cannot be copied          | Final module, interface, state owner, replaced path, acceptance |
| `reject`    | The change conflicts with locked goals, authority, security, licensing, or explicit non-goals   | Concrete reason                                                 |
| `defer`     | The change may be useful but is outside the current slice or lacks a required decision/resource | Concrete reason and retry condition                             |

## Common Routing

| Paseo change                                                     | Default disposition  | Thoth landing or boundary                                          |
| ---------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| AgentTimeline rendering, virtualization, or bottom anchoring     | `adopt` or `adapt`   | App read-only canonical Timeline rendering                         |
| Composer interaction or responsive layout                        | `adapt`              | Preserve Provider/Clarify/Mode and Agent-scoped Provider Features  |
| Attachment, file-link, terminal, browser, file-pane behavior     | `adopt` or `adapt`   | Protocol/Client/Daemon formal APIs plus App presentation           |
| Provider-native events, tools, approval, Plan, or resume support | `adapt`              | Drivers HarnessAdapter, normalized Protocol/Daemon receipts        |
| WebSocket, binary codec, reconnect, or catch-up improvement      | `adapt`              | Protocol Registry/codec, Client transport, Daemon authority        |
| Electron window, startup, or packaging improvement               | `adopt` or `adapt`   | Desktop shell without desktop-only Task truth                      |
| Relay cryptography or transport improvement                      | `adapt`              | Ciphertext-only Relay with daemon-owned replay truth               |
| AgentManager or Provider-session product authority               | `reject` or redesign | Workspace/Task authority remains in Core/Daemon                    |
| File-backed Agent JSON as durable truth                          | `reject`             | Workspace SQLite shards remain canonical                           |
| Provider-name business branch outside Drivers                    | `reject`             | Capability-based HarnessAdapter contract                           |
| Hidden general-purpose model API call                            | `reject`             | Intelligence must come from configured Provider Harness sessions   |
| Voice, speech, dictation, or audio                               | `reject`             | Explicit current non-goal                                          |
| Runtime use of `127.0.0.1:6767`                                  | `reject`             | Reserved independent Paseo service; fixtures/isolation guards only |
| Paseo website or marketing application                           | `defer` or `reject`  | Outside the current ten-package production chain                   |
| Test, workflow, or release engineering                           | `adopt` or `adapt`   | Root scripts and current Thoth Release contract                    |

## Classification JSON

Store working classification files under ignored `.agent-os/artifacts/paseo-sync/`. Use this shape:

```json
{
  "schema_version": 1,
  "paseo_base_sha": "<40-hex-sha>",
  "paseo_target_sha": "<40-hex-sha>",
  "thoth_base_sha": "<40-hex-sha>",
  "release_intent": "integrate",
  "changes": [
    {
      "id": "timeline-virtualization",
      "upstream_commits": ["<40-hex-sha>"],
      "upstream_paths": ["packages/app/src/agent-stream/view.tsx"],
      "disposition": "adapt",
      "reason": "Retain the rendering improvement behind the daemon-owned canonical Timeline.",
      "thoth_modules": ["packages/app"],
      "formal_interface": "AuthorityProjectionStore -> AgentTimeline view registry",
      "state_owner": "Daemon Workspace authority",
      "replaced_paths": [],
      "acceptance": ["Focused renderer behavior test", "Complete App suite"]
    }
  ],
  "ignored_commits": [
    {
      "sha": "<40-hex-sha>",
      "reason": "Documentation-only website change outside the Thoth product chain."
    }
  ]
}
```

Allowed `release_intent` values are `analyze`, `integrate`, `release-ready`, and `publish`.

Every manifest commit must appear in at least one `upstream_commits` array or in
`ignored_commits`. Every `adopt` or `adapt` item requires non-empty `thoth_modules`,
`formal_interface`, `state_owner`, and `acceptance`. Every item requires a reason and at least one
upstream path.

## Architecture Questions

Before changing source, answer:

1. Which final Thoth module owns the capability?
2. Which formal interface carries it?
3. Which component owns durable state, if any?
4. What existing path is replaced?
5. Which independent behavioral evidence proves the result?

If the answers require a second authority or compatibility path, the classification is not ready
for implementation.
