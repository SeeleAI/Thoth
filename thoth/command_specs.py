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
    scope_can: tuple[str, ...] = field(default_factory=tuple)
    scope_cannot: tuple[str, ...] = field(default_factory=tuple)
    lifecycle: tuple[str, ...] = field(default_factory=tuple)
    interaction_gaps: tuple[str, ...] = field(default_factory=tuple)


COMMAND_SPECS: tuple[CommandSpec, ...] = (
    CommandSpec(
        command_id="init",
        summary="Initialize canonical .thoth authority and render both Claude/Codex project layers.",
        argument_hint="[project-name]",
        acceptance="Authority tree, host projections, Codex project layer, dashboard, scripts, and tests are generated from one canonical source.",
        needs_hooks=True,
        scope_can=(
            "Create canonical .thoth project authority files",
            "Generate AGENTS.md and CLAUDE.md from the same renderer",
            "Generate .codex local environment, setup script, and hooks config",
            "Generate dashboard, tests, helper scripts, and config",
        ),
        scope_cannot=(
            "Silently delete existing project files",
            "Treat hooks as correctness-critical runtime dependencies",
        ),
        lifecycle=("preview", "render-authority", "render-projections", "verify"),
        interaction_gaps=("Project description", "Directions/phases", "Dashboard port/theme"),
    ),
    CommandSpec(
        command_id="run",
        summary="Create one durable run under the shared runtime and attach in the foreground by default.",
        argument_hint="[--executor claude|codex] [--host claude|codex] [--detach] [--attach <run_id>] [--watch <run_id>] [--stop <run_id>] --task-id <task_id>",
        durable=True,
        supports_codex_executor=True,
        acceptance="A durable run ledger exists under .thoth/runs/<run_id>, and execution only starts from a compiler-generated strict task.",
        needs_subagents=True,
        scope_can=(
            "Create a durable run and attach to it",
            "Delegate execution to Codex through the shared runtime path",
            "Write run/state/events/acceptance/artifacts ledgers",
            "Stop or watch an existing run",
        ),
        scope_cannot=(
            "Use host session state as runtime truth",
            "Create a non-durable foreground-only pseudo run",
        ),
        lifecycle=("create", "lease", "supervise", "attach/watch/stop", "acceptance"),
        interaction_gaps=("Strict task id",),
    ),
    CommandSpec(
        command_id="loop",
        summary="Create one durable autonomous loop under the shared runtime and attach in the foreground by default.",
        argument_hint="[--executor claude|codex] [--host claude|codex] [--detach] [--attach <run_id>] [--resume <run_id>] [--watch <run_id>] [--stop <run_id>] --task-id <task_id>",
        durable=True,
        supports_codex_executor=True,
        acceptance="Loop lifecycle is durable and recoverable through attach/resume/watch/stop, and loop creation only starts from a compiler-generated strict task.",
        needs_subagents=True,
        scope_can=(
            "Create or resume a durable loop run",
            "Attach/watch/stop through the same runtime state machine",
            "Delegate work to Codex without changing authority write shape",
        ),
        scope_cannot=(
            "Run as a best-effort background loop without supervisor state",
            "Depend on subagents or hooks for correctness",
        ),
        lifecycle=("create", "lease", "supervise", "attach/resume/watch/stop", "acceptance"),
        interaction_gaps=("Strict task id",),
    ),
    CommandSpec(
        command_id="review",
        summary="Review code or plans through the shared Thoth surface.",
        argument_hint="[--executor claude|codex] [--host claude|codex] <target>",
        supports_codex_executor=True,
        acceptance="Findings are reported without mutating source code, while preserving executor parity.",
        needs_subagents=True,
        scope_can=("Read code and documents", "Delegate review to Codex"), 
        scope_cannot=("Modify project code", "Claim acceptance without evidence"),
        lifecycle=("analyze", "report"),
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
        acceptance="Doctor validates .thoth authority, generated projections, and project layer consistency.",
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
