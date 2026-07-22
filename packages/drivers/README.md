# @thoth/drivers

Harness driver package for Thoth.

Intended responsibilities:

1. Shared harness driver contract.
2. Claude Code direct provider.
3. Codex app-server provider.
4. ACP provider.
5. Capability detection.
6. Permission request bridging.
7. Provider conformance tests.

Hard boundary:

1. Thoth is not a harness and does not own AI execution.
2. Drivers start, resume and observe provider sessions through ACP, harness runtime, app-server, official harness SDK/control surfaces or local harness CLIs.
3. Drivers must not call raw model inference APIs as a substitute for provider sessions.
4. Provider-native session handles are recorded as resume metadata and evidence, not as task authority.
