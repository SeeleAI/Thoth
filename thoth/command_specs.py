"""Host-neutral public command specifications for Thoth."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class CommandSpec:
    """Host-neutral public surface definition."""

    command_id: str
    summary: str
    argument_hint: str
    route_class: str = "mechanical_fast"
    intelligence_tier: str = "none"
    packet_authority_mode: str = "none"
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
    internal_routes: tuple[str, ...] = field(default_factory=tuple)


COMMAND_SPECS: tuple[CommandSpec, ...] = (
    CommandSpec(
        command_id="init",
        summary="Initialize canonical .thoth authority and render both host projections without taking ownership of repo-root `.codex`.",
        argument_hint="[project-name]",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
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
        summary="Start one validator-centered strict run bound to `work_id@revision`, or use `--sleep` to hand the same controller to an external worker.",
        argument_hint="[--executor claude|codex] [--host claude|codex] [--sleep] [--attach <run_id>] [--watch <run_id>] [--stop <run_id>] --work-id <work_id>",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="phase_controller",
        durable=True,
        supports_codex_executor=True,
        acceptance="A durable run object and ledger with validator-centered phase_result artifacts exists under .thoth/objects and .thoth/runs/<run_id>; live and sleep share the same result shape.",
        needs_subagents=True,
        allowed_tools=("Read", "Glob", "Grep", "Edit", "Write", "Bash", "Task"),
        scope_can=(
            "Drive execute -> validate, and reflect only after validator failure",
            "Switch to an external worker only with --sleep",
            "Write fixed phase artifacts and terminal results through the shared authority",
            "Stop or watch an existing run",
        ),
        scope_cannot=(
            "Use host session state as runtime truth",
            "Use detached live execution without --sleep",
        ),
        lifecycle=("prepare", "execute", "validate", "reflect-on-failure", "attach/watch/stop", "acceptance"),
        interaction_gaps=("Ready runnable work id",),
    ),
    CommandSpec(
        command_id="loop",
        summary="Start one bounded controller service whose parent creates validator-centered child runs.",
        argument_hint="[--executor claude|codex] [--host claude|codex] [--sleep] [--attach <run_id>] [--resume <run_id>] [--watch <run_id>] [--stop <run_id>] --work-id <work_id>",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="phase_controller",
        durable=True,
        supports_codex_executor=True,
        acceptance="The parent loop run enforces child iteration count and wall-clock budget mechanically, records child run lineage, and stops immediately on the first validated child run.",
        needs_subagents=True,
        allowed_tools=("Read", "Glob", "Grep", "Edit", "Write", "Bash", "Task"),
        scope_can=(
            "Create or resume a durable bounded loop orchestrator",
            "Attach/watch/stop through the same runtime state machine",
            "Delegate work to Codex without changing authority write shape",
        ),
        scope_cannot=(
            "Use detached live execution without --sleep",
            "Depend on subagents or hooks for correctness",
        ),
        lifecycle=("prepare", "loop-parent", "child-execute", "child-validate", "reflect-on-failure", "attach/resume/watch/stop", "acceptance"),
        interaction_gaps=("Ready runnable work id",),
    ),
    CommandSpec(
        command_id="review",
        summary="Prepare a structured live review packet through the shared Thoth surface.",
        argument_hint="[--executor claude|codex] [--host claude|codex] [--work-id <work_id>] <target>",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="review_packet",
        supports_codex_executor=True,
        acceptance="Findings are reported in structured form through the same authority protocol without mutating source code, while preserving executor parity.",
        needs_subagents=True,
        allowed_tools=("Read", "Glob", "Grep", "Bash", "Task"),
        scope_can=("Read code and documents", "Delegate review to Codex", "Write structured findings through the protocol"), 
        scope_cannot=("Modify project code", "Claim acceptance without evidence"),
        lifecycle=("prepare", "live-native-review", "protocol-update", "report"),
        internal_routes=("exact_match=protocol_fast", "open_ended=live_intelligent"),
    ),
    CommandSpec(
        command_id="orchestration",
        summary="Create a controller object that schedules ready work items by object-graph dependencies.",
        argument_hint="--work-id <work_id> [--work-id <work_id> ...]",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        durable=True,
        acceptance="A controller object records frozen work_id@revision refs and DAG batches derived from depends_on links.",
        scope_can=("Create orchestration controller objects", "Read work_item dependency links"),
        scope_cannot=("Execute free-form text", "Modify active work items"),
        lifecycle=("read-work", "build-dag", "write-controller"),
    ),
    CommandSpec(
        command_id="auto",
        summary="Create a linear controller queue for multiple ready work items.",
        argument_hint="--mode run|loop --work-id <work_id> [--work-id <work_id> ...]",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        durable=True,
        acceptance="A controller object records an ordered queue of frozen work_id@revision refs and a cursor.",
        scope_can=("Create auto queue controller objects", "Configure each item to use run or loop"),
        scope_cannot=("Create private queue formats", "Modify active work items"),
        lifecycle=("read-work", "write-queue", "advance-cursor"),
    ),
    CommandSpec(
        command_id="status",
        summary="Show repo status and active durable runs from the shared ledger.",
        argument_hint="[--json]",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        acceptance="Status reports repo health plus active/stale run summaries without replacing attach/watch.",
        scope_can=("Read .thoth authority and machine-local registry",),
        scope_cannot=("Infer runtime state from chat history",),
        lifecycle=("read", "summarize"),
    ),
    CommandSpec(
        command_id="doctor",
        summary="Audit project health, generated surfaces, and runtime shape.",
        argument_hint="[--quick]",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        acceptance="Doctor validates .thoth authority and generated projections without assuming repo-root `.codex` is Thoth-managed.",
        scope_can=("Run health checks", "Verify generated surfaces"), 
        scope_cannot=("Use missing hooks as a correctness failure by themselves",),
        lifecycle=("audit", "report"),
    ),
    CommandSpec(
        command_id="dashboard",
        summary="Start or describe the task-first dashboard backed by .thoth ledgers.",
        argument_hint="[--port <port>]",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        acceptance="Dashboard reads .thoth/runs data only and renders host/executor/runtime distinctions explicitly.",
        scope_can=("Start the dashboard", "Report dashboard endpoints"), 
        scope_cannot=("Read host session state as runtime truth",),
        lifecycle=("serve",),
    ),
    CommandSpec(
        command_id="sync",
        summary="Synchronize generated surfaces and project projections from their canonical sources.",
        argument_hint="",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        acceptance="Generated Claude commands, Codex skill, plugin manifest, and project instructions match the host-neutral source of truth.",
        scope_can=("Regenerate projections", "Run TODO sync"), 
        scope_cannot=("Hand-edit generated public surfaces",),
        lifecycle=("render", "validate"),
    ),
    CommandSpec(
        command_id="report",
        summary="Build a structured report from the current authority state.",
        argument_hint="[--format md|json]",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        acceptance="Report is derived from current ledgers and project docs rather than session memory.",
        scope_can=("Read project authority and ledgers",),
        scope_cannot=("Invent missing evidence",),
        lifecycle=("collect", "render"),
    ),
    CommandSpec(
        command_id="discuss",
        summary="Discuss or record planning decisions without entering implementation execution.",
        argument_hint="<topic>",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="command_packet",
        acceptance="Closed planning output is recorded into discussion, decision, and work_item objects and may produce at most one work subtree without mutating code.",
        scope_can=("Update discussions, decisions, and work items", "Generate a complete work subtree"),
        scope_cannot=("Modify source code", "Create ready runnable work while questions remain", "Modify work locked by active execution"),
        lifecycle=("inquire", "close", "write-object-subtree", "generate-doc-view"),
    ),
    CommandSpec(
        command_id="extend",
        summary="Evolve Thoth itself under the generated test gates.",
        argument_hint="<change request>",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="command_packet",
        acceptance="Extension work respects the generated surface contract and test gates.",
        scope_can=("Modify this repository", "Run repository tests"),
        scope_cannot=("Bypass generated surface parity",),
        lifecycle=("plan", "change", "verify"),
    ),
)


COMMAND_SPECS_BY_ID = {spec.command_id: spec for spec in COMMAND_SPECS}

PUBLIC_CODEX_COMMANDS: tuple[str, ...] = tuple(spec.command_id for spec in COMMAND_SPECS)
