"""Compressed prompt authority for Thoth public commands and live phases."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class CommandPromptSpec:
    """Compressed command authority rendered into host-facing prompt surfaces."""

    command_id: str
    route_class: str
    intelligence_tier: str
    packet_authority_mode: str
    objective: str
    hard_stops: tuple[str, ...]
    reply_budget_utf8: int
    result_style: str
    validator_policy: str


@dataclass(frozen=True)
class PhasePromptSpec:
    """Compressed phase authority for validator-centered execution."""

    phase: str
    objective: str
    hard_stops: tuple[str, ...]
    required_fields: tuple[str, ...]
    summary_budget_utf8: int
    validator_policy: str


COMMAND_PROMPT_SPECS: dict[str, CommandPromptSpec] = {
    "run": CommandPromptSpec(
        command_id="run",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="phase_controller",
        objective="Finish the current strict task through the four-phase RuntimeDriver.",
        hard_stops=(
            "Do not invent or compile a new work item when --work-id is missing.",
            "Do not stop after starting the runtime; monitor RuntimeDriver events until terminal.",
            "Do not hand-edit .thoth ledgers.",
        ),
        reply_budget_utf8=36,
        result_style="terminal receipt only",
        validator_policy="plan first, validate decides completion, reflect always summarizes evidence and risk",
    ),
    "loop": CommandPromptSpec(
        command_id="loop",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="phase_controller",
        objective="Advance the current bounded loop through foreground or sleeping RuntimeDriver monitoring.",
        hard_stops=(
            "Do not decide extra iterations outside the recorded loop budget.",
            "Do not skip validator output when judging success.",
            "Do not expand into iteration diaries or runtime narration.",
        ),
        reply_budget_utf8=40,
        result_style="terminal receipt only",
        validator_policy="parent loop budget controls retries; each child runs plan -> execute -> validate -> reflect",
    ),
    "review": CommandPromptSpec(
        command_id="review",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="review_packet",
        objective="Return structured findings only, with exact-match short-circuit when provided.",
        hard_stops=(
            "Do not modify project code.",
            "Do not emit prose outside the structured review result.",
            "If review_expectation or complete_exact exists, follow it exactly.",
        ),
        reply_budget_utf8=32,
        result_style="short summary plus structured findings",
        validator_policy="exact-match route is protocol_fast; open-ended route stays live but still structured",
    ),
    "status": CommandPromptSpec(
        command_id="status",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        objective="Report only abnormal state, blockers, and active run deltas.",
        hard_stops=(
            "Do not restate healthy defaults.",
            "Do not expand into a dashboard walkthrough.",
        ),
        reply_budget_utf8=56,
        result_style="brief receipt",
        validator_policy="runtime truth comes from current authority only",
    ),
    "doctor": CommandPromptSpec(
        command_id="doctor",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        objective="Report only failing, drifting, or missing checks.",
        hard_stops=(
            "Do not pad with passing checks.",
            "Do not claim repo health without checks.",
        ),
        reply_budget_utf8=64,
        result_style="brief defect receipt",
        validator_policy="authority and generated surfaces decide health",
    ),
    "report": CommandPromptSpec(
        command_id="report",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        objective="Compress the current authority state into one short report outcome.",
        hard_stops=(
            "Do not replay the full run log.",
            "Do not invent missing evidence.",
        ),
        reply_budget_utf8=80,
        result_style="brief receipt with output path",
        validator_policy="report must stay authority-derived",
    ),
    "dashboard": CommandPromptSpec(
        command_id="dashboard",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        objective="Report endpoint, failure point, and one notable runtime delta only.",
        hard_stops=(
            "Do not narrate the whole UI.",
            "Do not restate healthy panels.",
        ),
        reply_budget_utf8=56,
        result_style="brief operator receipt",
        validator_policy="dashboard is read-only over .thoth ledgers",
    ),
    "orchestration": CommandPromptSpec(
        command_id="orchestration",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        objective="Create a controller object with dependency batches for ready work items.",
        hard_stops=(
            "Do not execute work while creating the controller.",
            "Do not invent missing work items.",
        ),
        reply_budget_utf8=56,
        result_style="brief controller receipt",
        validator_policy="object graph dependencies define batch order",
    ),
    "auto": CommandPromptSpec(
        command_id="auto",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        objective="Create a linear controller queue over ready work items.",
        hard_stops=(
            "Do not create private queue files.",
            "Do not execute work while creating the controller.",
        ),
        reply_budget_utf8=56,
        result_style="brief queue receipt",
        validator_policy="controller object cursor defines queue state",
    ),
    "init": CommandPromptSpec(
        command_id="init",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        objective="Report audit-first adopt/init outcome, generated artifacts, and blockers only.",
        hard_stops=(
            "Do not assume the repo is blank.",
            "Do not narrate the full migration procedure.",
        ),
        reply_budget_utf8=60,
        result_style="brief outcome receipt",
        validator_policy="preview and generated artifacts define success",
    ),
    "sync": CommandPromptSpec(
        command_id="sync",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        objective="Report whether generated surfaces are in sync and what changed.",
        hard_stops=(
            "Do not narrate unchanged surfaces.",
            "Do not hand-maintain generated semantics.",
        ),
        reply_budget_utf8=60,
        result_style="brief sync receipt",
        validator_policy="canonical renderers define parity",
    ),
    "discuss": CommandPromptSpec(
        command_id="discuss",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="command_packet",
        objective="Make the smallest correct planning-authority update and recompile tasks.",
        hard_stops=(
            "Do not modify source code.",
            "Do not fabricate ready execution tasks from unresolved decisions.",
            "Do not repeat the packet or decision payload verbatim.",
        ),
        reply_budget_utf8=64,
        result_style="brief planning receipt",
        validator_policy="planning authority plus compiler output decide completion",
    ),
    "extend": CommandPromptSpec(
        command_id="extend",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="command_packet",
        objective="Complete the requested repository change while preserving generated-surface parity.",
        hard_stops=(
            "Do not bypass repository test gates.",
            "Do not leave Claude and Codex projections drifting.",
            "Do not expand into changelog-style prose.",
        ),
        reply_budget_utf8=60,
        result_style="brief change receipt",
        validator_policy="repo tests and surface parity decide completion",
    ),
}


PHASE_PROMPT_SPECS: dict[str, PhasePromptSpec] = {
    "plan": PhasePromptSpec(
        phase="plan",
        objective="Produce the concrete execution plan for the frozen strict task without changing the goal or validation contract.",
        hard_stops=(
            "Do not modify project files.",
            "Do not change the work item goal, constraints, or validation entrypoint.",
            "Do not hand-edit .thoth ledgers.",
        ),
        required_fields=("summary", "execution_steps", "files_expected", "commands_expected", "validation_plan", "risk_assessment"),
        summary_budget_utf8=240,
        validator_policy="plan is read-only and may only prepare the concrete execution path",
    ),
    "execute": PhasePromptSpec(
        phase="execute",
        objective="Perform the smallest execution slice needed for the strict task and the approved plan before validation.",
        hard_stops=(
            "Do not hand-edit .thoth ledgers.",
            "Do not terminalize the full run from inside execute.",
            "Do not run destructive delete/reset commands.",
        ),
        required_fields=("summary", "files_touched", "commands_run", "artifacts"),
        summary_budget_utf8=240,
        validator_policy="execute follows the plan artifact; validator remains the acceptance authority",
    ),
    "validate": PhasePromptSpec(
        phase="validate",
        objective="Run the official validator and return a mechanical pass/fail result.",
        hard_stops=(
            "Do not repair code inside validate.",
            "Do not guess pass/fail from intuition.",
            "Do not skip eval_entrypoint.command when it exists.",
        ),
        required_fields=("summary", "passed", "metric_name", "metric_value", "threshold", "checks"),
        summary_budget_utf8=240,
        validator_policy="validator output alone decides whether the run completes or enters reflect",
    ),
    "reflect": PhasePromptSpec(
        phase="reflect",
        objective="Summarize the validation outcome, evidence, residual risks, and the next recommendation.",
        hard_stops=(
            "Do not keep executing.",
            "Do not run extra commands.",
            "Do not change validation verdicts.",
        ),
        required_fields=("summary", "outcome", "residual_risks", "evidence", "next_recommendation"),
        summary_budget_utf8=240,
        validator_policy="reflect always runs after validate and never overrides validate.passed",
    ),
}


def command_prompt_spec(command_id: str) -> CommandPromptSpec:
    return COMMAND_PROMPT_SPECS[command_id]


def phase_prompt_spec(phase: str) -> PhasePromptSpec:
    return PHASE_PROMPT_SPECS[phase]


def command_prompt_authority(command_id: str) -> dict[str, Any]:
    spec = command_prompt_spec(command_id)
    return {
        "route_class": spec.route_class,
        "intelligence_tier": spec.intelligence_tier,
        "packet_authority_mode": spec.packet_authority_mode,
        "objective": spec.objective,
        "hard_stops": list(spec.hard_stops),
        "reply_budget_utf8": spec.reply_budget_utf8,
        "result_style": spec.result_style,
        "validator_policy": spec.validator_policy,
    }


def phase_prompt_authority(phase: str) -> dict[str, Any]:
    spec = phase_prompt_spec(phase)
    return {
        "phase": spec.phase,
        "objective": spec.objective,
        "hard_stops": list(spec.hard_stops),
        "required_fields": list(spec.required_fields),
        "summary_budget_utf8": spec.summary_budget_utf8,
        "validator_policy": spec.validator_policy,
    }


def _render_bullets(items: tuple[str, ...]) -> str:
    return "\n".join(f"- {item}" for item in items)


def render_command_contract_markdown(command_id: str, *, heading_level: int = 2) -> str:
    spec = command_prompt_spec(command_id)
    heading = "#" * max(1, heading_level)
    return f"""{heading} Route

- route_class: `{spec.route_class}`
- intelligence_tier: `{spec.intelligence_tier}`
- packet_authority_mode: `{spec.packet_authority_mode}`

{heading} Objective

{spec.objective}

{heading} Hard Stops

{_render_bullets(spec.hard_stops)}

{heading} Reply Contract

- reply_budget_utf8: `{spec.reply_budget_utf8}`
- result_style: {spec.result_style}
- validator_policy: {spec.validator_policy}
"""


def render_phase_worker_prompt(
    *,
    phase_packet: dict[str, Any],
    run_id: str,
    project_root: Path,
    output_path: Path,
    correction_error: str | None = None,
) -> str:
    phase = str(phase_packet.get("phase") or "")
    authority = phase_packet.get("phase_authority")
    if not isinstance(authority, dict):
        authority = phase_prompt_authority(phase)
    hard_stops = authority.get("hard_stops") if isinstance(authority.get("hard_stops"), list) else []
    required_fields = authority.get("required_fields") if isinstance(authority.get("required_fields"), list) else []
    lines = [
        f"Run id: {run_id}",
        f"Work only inside `{project_root}`.",
        f"Execute exactly one phase: `{phase}`.",
        "Finish with exactly one JSON object and no surrounding prose.",
        "Do not create or edit `.thoth` ledgers by hand.",
        "Do not invoke `$thoth run`, `$thoth loop`, or `$thoth review`.",
        f"Objective: {authority.get('objective')}",
        f"Required fields: {', '.join(str(item) for item in required_fields)}",
        f"Summary budget utf8: {authority.get('summary_budget_utf8')}",
        f"Validator policy: {authority.get('validator_policy')}",
    ]
    if output_path:
        lines.append(f"Runtime driver capture path: `{output_path}`.")
    lines.extend(f"Hard stop: {item}" for item in hard_stops)
    if correction_error:
        lines.append(f"Previous output failed validation: {correction_error}")
        lines.append("Rewrite one shorter, stricter JSON object only.")
    return f"""# Thoth Phase Worker

{chr(10).join(f"- {line}" for line in lines)}

Phase Packet
```json
{json.dumps(phase_packet, ensure_ascii=False, indent=2)}
```
"""


def build_codex_public_command_prompt(
    command_id: str,
    *,
    public_command: str,
    shell_command: str,
    done_token: str,
) -> str:
    spec = command_prompt_spec(command_id)
    lines = [
        "Operate only on this repo.",
        "Use the installed skill named thoth.",
        f"The Codex public surface is `{public_command}`, but in the workspace shell you must execute it literally as `{shell_command}`.",
        "Execute that shell command immediately as your first meaningful action.",
        "Do not explain the command before executing it.",
        "Do not replace execution with prose.",
        "If the literal `thoth` shell command is missing in a fresh plugin-installed environment, report host install drift instead of inventing another entrypoint.",
        f"route_class={spec.route_class}.",
        f"intelligence_tier={spec.intelligence_tier}.",
        f"packet_authority_mode={spec.packet_authority_mode}.",
        f"Objective: {spec.objective}",
    ]
    lines.extend(f"Hard stop: {item}" for item in spec.hard_stops)
    if command_id in {"run", "loop"}:
        lines.extend(
            (
                "If the command streams runtime events, report progress and risks from those events only.",
                "Stay in the same session until the RuntimeDriver reaches terminal state unless --sleep was requested.",
                "Runtime lifecycle is plan -> execute -> validate -> reflect.",
                "Do not hand-edit `.thoth`; let the Thoth runtime driver advance phases.",
            )
        )
    elif command_id == "review":
        lines.extend(
            (
                "If the command returns a review packet, stay inside that review protocol only.",
                "If `packet.review_mode` is `exact_match`, reproduce that exact structured result.",
                "If `packet.protocol_commands.complete_exact` exists, execute that exact completion command.",
            )
        )
    elif command_id in {"discuss", "extend"}:
        lines.extend(
            (
                "If the command returns a command packet, use that packet as the only authority for the follow-up action.",
                "Do not restate packet fields or expand into teaching prose.",
            )
        )
    lines.append(f"Reply with `{done_token}` only after the command path reaches its terminal outcome.")
    return " ".join(lines)


def render_codex_command_micro_prompt(command_id: str) -> str:
    public_command = f"$thoth {command_id}"
    shell_command = f"thoth {command_id}"
    done_token = "THOTH_DONE"
    return f"""# {public_command}

Generated micro prompt for the Thoth Codex dispatcher.

{render_command_contract_markdown(command_id, heading_level=2).strip()}

## Execution String

{build_codex_public_command_prompt(command_id, public_command=public_command, shell_command=shell_command, done_token=done_token)}
"""


def build_codex_selftest_command_probe_prompt(*, public_command: str, shell_command: str, done_token: str) -> str:
    return " ".join(
        (
            "This is a Thoth heavy selftest command probe.",
            "Operate only on this repo.",
            f"The Codex public surface is `{public_command}`, but in the workspace shell you must execute it literally as `{shell_command}`.",
            "Execute that shell command immediately as your first meaningful action.",
            "Do not inspect files, search memories, explain, retry, or execute any second shell command.",
            "Do not manually continue runtime protocol phases and do not substitute a different entrypoint.",
            "If the literal `thoth` shell command is missing, treat that as host install drift.",
            f"After the shell command exits successfully, reply with `{done_token}` only.",
        )
    )


def build_codex_selftest_review_probe_prompt(*, public_command: str, shell_command: str, done_token: str) -> str:
    return " ".join(
        (
            "This is a Thoth heavy selftest review probe.",
            "Operate only on this repo.",
            f"The Codex public surface is `{public_command}`, but in the workspace shell you must execute it literally as `{shell_command}`.",
            "Execute that shell command immediately as your first action.",
            "Do not send commentary, progress updates, plans, explanations, or any non-command message before that command.",
            "After the review packet is prepared, stay inside the Thoth review protocol only.",
            "Inspect only the review target, the prepared packet, and files directly required by the protocol.",
            "Do not inspect CLI help, do not explore unrelated files, and do not execute exploratory commands.",
            "Allowed follow-up commands only: the packet-provided protocol command(s), the strict task eval entrypoint, and the minimum direct file reads needed to perform this review.",
            "Do not run `--help`, `which`, `codex`, `grep`, or any discovery command after the packet is prepared.",
            "Do not modify code, do not add a second finding, and do not emit prose outside the structured review result.",
            "If `packet.strict_task.review_expectation` exists, use that exact object as the final review result.",
            "If `packet.protocol_commands.complete_exact` exists, execute that exact completion command.",
            "Run the strict task eval entrypoint exactly once if the packet requires it, then finish the run via the packet-provided complete command.",
            "For review completion, `--summary` must be a short plain string only; the structured review object belongs only in `--result-json`.",
            "When completing the run, pass the exact review result via `--result-json` and mark the exact-match check as passing via `--checks-json`.",
            f"After the review run terminalizes successfully, reply with `{done_token}` only.",
        )
    )


def build_review_result_shape() -> dict[str, Any]:
    return {
        "summary": "Short summary <= 48 UTF-8 chars.",
        "findings": [
            {
                "severity": "high|medium|low",
                "title": "Short title <= 32 UTF-8 chars.",
                "path": "relative/file/path",
                "line": 1,
                "summary": "Short summary <= 48 UTF-8 chars.",
            }
        ],
    }


__all__ = [
    "COMMAND_PROMPT_SPECS",
    "PHASE_PROMPT_SPECS",
    "CommandPromptSpec",
    "PhasePromptSpec",
    "build_codex_public_command_prompt",
    "build_codex_selftest_command_probe_prompt",
    "build_codex_selftest_review_probe_prompt",
    "build_review_result_shape",
    "command_prompt_authority",
    "command_prompt_spec",
    "phase_prompt_authority",
    "phase_prompt_spec",
    "render_codex_command_micro_prompt",
    "render_command_contract_markdown",
    "render_phase_worker_prompt",
]
