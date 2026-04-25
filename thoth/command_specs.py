"""Host-neutral public command specifications for Thoth."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class CommandSpec:
    """Host-neutral public surface definition."""

    command_id: str
    summary: str
    argument_hint: str
    durable: bool = False
    supports_codex_executor: bool = False
    needs_hooks: bool = False
    needs_subagents: bool = False
    acceptance: str = "Script-backed acceptance only."
    allowed_tools: tuple[str, ...] = field(default_factory=tuple)
    scope_can: tuple[str, ...] = field(default_factory=tuple)
    scope_cannot: tuple[str, ...] = field(default_factory=tuple)
    lifecycle: tuple[str, ...] = field(default_factory=tuple)
    interaction_gaps: tuple[str, ...] = field(default_factory=tuple)


COMMAND_SPECS: tuple[CommandSpec, ...] = (
    CommandSpec(
        command_id="init",
        summary="Initialize canonical .thoth authority and render both host projections without taking ownership of repo-root `.codex`.",
        argument_hint="[project-name]",
        acceptance="Authority tree, host projections, Codex hook projection, dashboard, scripts, and tests are generated from one canonical source while repo-root `.codex` remains host-owned.",
        needs_hooks=True,
        scope_can=(
            "Create canonical .thoth project authority files",
            "Generate AGENTS.md and CLAUDE.md from the same renderer",
            "Generate a Codex hooks projection under .thoth/derived for global or repo-local host wiring",
            "Generate dashboard, tests, helper scripts, and config",
        ),
        scope_cannot=(
            "Silently delete existing project files",
            "Treat repo-root .codex as a Thoth-managed authority directory",
            "Treat hooks as correctness-critical runtime dependencies",
        ),
        lifecycle=("preview", "render-authority", "render-projections", "verify"),
        interaction_gaps=("Project description", "Directions/phases", "Dashboard port/theme"),
    ),
    CommandSpec(
        command_id="run",
        summary="Prepare one strict run packet for live in-session execution, or use `--sleep` to hand it to an external worker.",
        argument_hint="[--executor claude|codex] [--host claude|codex] [--sleep] [--attach <run_id>] [--watch <run_id>] [--stop <run_id>] --task-id <task_id>",
        durable=True,
        supports_codex_executor=True,
        acceptance="A durable run ledger plus execution packet exist under .thoth/runs/<run_id>, live mode stays in the current host session, and `--sleep` backgrounds through the same authority shape.",
        needs_subagents=True,
        allowed_tools=("Read", "Glob", "Grep", "Edit", "Write", "Bash", "Task"),
        scope_can=(
            "Prepare a durable run packet for the current host session",
            "Switch to an external worker only with --sleep",
            "Write run/state/events/acceptance/artifacts ledgers through the protocol",
            "Stop or watch an existing run",
        ),
        scope_cannot=(
            "Use host session state as runtime truth",
            "Use detached live execution without --sleep",
        ),
        lifecycle=("prepare", "live-native|external-worker", "protocol-update", "attach/watch/stop", "acceptance"),
        interaction_gaps=("Strict task id",),
    ),
    CommandSpec(
        command_id="loop",
        summary="Prepare one strict loop packet for live in-session iteration, or use `--sleep` to hand it to an external worker.",
        argument_hint="[--executor claude|codex] [--host claude|codex] [--sleep] [--attach <run_id>] [--resume <run_id>] [--watch <run_id>] [--stop <run_id>] --task-id <task_id>",
        durable=True,
        supports_codex_executor=True,
        acceptance="Loop lifecycle is durable and recoverable through attach/resume/watch/stop, live mode stays inside the current host session, and heavy acceptance expects bounded rounds/time rather than unbounded supervisor churn.",
        needs_subagents=True,
        allowed_tools=("Read", "Glob", "Grep", "Edit", "Write", "Bash", "Task"),
        scope_can=(
            "Create or resume a durable loop packet",
            "Attach/watch/stop through the same runtime state machine",
            "Delegate work to Codex without changing authority write shape",
        ),
        scope_cannot=(
            "Use detached live execution without --sleep",
            "Depend on subagents or hooks for correctness",
        ),
        lifecycle=("prepare", "live-native|external-worker", "protocol-update", "attach/resume/watch/stop", "acceptance"),
        interaction_gaps=("Strict task id",),
    ),
    CommandSpec(
        command_id="review",
        summary="Prepare a structured live review packet through the shared Thoth surface.",
        argument_hint="[--executor claude|codex] [--host claude|codex] <target>",
        supports_codex_executor=True,
        acceptance="Findings are reported in structured form through the same authority protocol without mutating source code, while preserving executor parity.",
        needs_subagents=True,
        allowed_tools=("Read", "Glob", "Grep", "Bash", "Task"),
        scope_can=("Read code and documents", "Delegate review to Codex", "Write structured findings through the protocol"), 
        scope_cannot=("Modify project code", "Claim acceptance without evidence"),
        lifecycle=("prepare", "live-native-review", "protocol-update", "report"),
    ),
    CommandSpec(
        command_id="status",
        summary="Show repo status and active durable runs from the shared ledger.",
        argument_hint="[--json]",
        acceptance="Status reports repo health plus active/stale run summaries without replacing attach/watch.",
        scope_can=("Read .thoth authority and machine-local registry",),
        scope_cannot=("Infer runtime state from chat history",),
        lifecycle=("read", "summarize"),
    ),
    CommandSpec(
        command_id="doctor",
        summary="Audit project health, generated surfaces, and runtime shape.",
        argument_hint="[--quick]",
        acceptance="Doctor validates .thoth authority and generated projections without assuming repo-root `.codex` is Thoth-managed.",
        scope_can=("Run health checks", "Verify generated surfaces"), 
        scope_cannot=("Use missing hooks as a correctness failure by themselves",),
        lifecycle=("audit", "report"),
    ),
    CommandSpec(
        command_id="dashboard",
        summary="Start or describe the task-first dashboard backed by .thoth ledgers.",
        argument_hint="[--port <port>]",
        acceptance="Dashboard reads .thoth/runs data only and renders host/executor/runtime distinctions explicitly.",
        scope_can=("Start the dashboard", "Report dashboard endpoints"), 
        scope_cannot=("Read host session state as runtime truth",),
        lifecycle=("serve",),
    ),
    CommandSpec(
        command_id="sync",
        summary="Synchronize generated surfaces and project projections from their canonical sources.",
        argument_hint="",
        acceptance="Generated Claude commands, Codex skill, plugin manifest, and project instructions match the host-neutral source of truth.",
        scope_can=("Regenerate projections", "Run TODO sync"), 
        scope_cannot=("Hand-edit generated public surfaces",),
        lifecycle=("render", "validate"),
    ),
    CommandSpec(
        command_id="report",
        summary="Build a structured report from the current authority state.",
        argument_hint="[--format md|json]",
        acceptance="Report is derived from current ledgers and project docs rather than session memory.",
        scope_can=("Read project authority and ledgers",),
        scope_cannot=("Invent missing evidence",),
        lifecycle=("collect", "render"),
    ),
    CommandSpec(
        command_id="discuss",
        summary="Discuss or record planning decisions without entering implementation execution.",
        argument_hint="<topic>",
        acceptance="Planning output is recorded into the decision/contract authority and recompiled into executable task state without mutating code.",
        scope_can=("Update decisions and contracts", "Trigger the strict task compiler"),
        scope_cannot=("Modify source code", "Create ready execution tasks without a frozen contract"),
        lifecycle=("discuss", "record", "compile"),
    ),
    CommandSpec(
        command_id="extend",
        summary="Evolve Thoth itself under the generated test gates.",
        argument_hint="<change request>",
        acceptance="Extension work respects the generated surface contract and test gates.",
        scope_can=("Modify this repository", "Run repository tests"),
        scope_cannot=("Bypass generated surface parity",),
        lifecycle=("plan", "change", "verify"),
    ),
)


COMMAND_SPECS_BY_ID = {spec.command_id: spec for spec in COMMAND_SPECS}

PUBLIC_CODEX_COMMANDS: tuple[str, ...] = tuple(spec.command_id for spec in COMMAND_SPECS)
