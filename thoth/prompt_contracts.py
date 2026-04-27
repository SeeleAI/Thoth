"""Canonical prompt contracts and runtime output budgets for Thoth."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class CommandPromptSpec:
    """Command-specific prompt delta rendered into public host surfaces."""

    command_id: str
    role: str
    objective: str
    decision_priority: tuple[str, ...]
    hard_constraints: tuple[str, ...]
    output_contract: tuple[str, ...]
    positive_example: str
    anti_patterns: tuple[str, ...]
    reply_budget_utf8: int


@dataclass(frozen=True)
class PhasePromptSpec:
    """Phase-specific prompt contract for strict run execution."""

    phase: str
    role: str
    objective: str
    decision_priority: tuple[str, ...]
    hard_constraints: tuple[str, ...]
    output_contract: tuple[str, ...]
    positive_example: str
    anti_patterns: tuple[str, ...]
    thinking_order: tuple[str, ...]
    summary_budget_utf8: int


COMMAND_PROMPT_SPECS: dict[str, CommandPromptSpec] = {
    "run": CommandPromptSpec(
        command_id="run",
        role="Thoth strict task finisher",
        objective="Complete the current strict task. Do not explain the runtime or restate the packet.",
        decision_priority=(
            "Follow the phase controller first.",
            "Then follow the strict task authority exactly.",
            "Then minimize output.",
        ),
        hard_constraints=(
            "Do not invent or compile new tasks when `--task-id` is missing.",
            "Do not leave a live packet before the controller terminalizes.",
            "Do not hand-edit `.thoth` ledgers.",
        ),
        output_contract=(
            "Final host reply is terminal result only.",
            "Default final reply budget: 16-36 UTF-8 chars.",
            "No markdown explanation or packet restatement.",
        ),
        positive_example="done: validator passed",
        anti_patterns=(
            "Long runtime explanation.",
            "Repeating packet fields.",
            "Stopping after plan only.",
        ),
        reply_budget_utf8=36,
    ),
    "loop": CommandPromptSpec(
        command_id="loop",
        role="Thoth bounded loop operator",
        objective="Advance the child run under the parent loop controller. Do not decide loop termination by yourself.",
        decision_priority=(
            "Respect runtime budget first.",
            "Then consume the child run result exactly.",
            "Then apply the latest reflect hint.",
        ),
        hard_constraints=(
            "Do not bypass the parent loop controller.",
            "Do not free-run extra iterations outside controller budget.",
            "Do not expand historical narration.",
        ),
        output_contract=(
            "Final host reply is loop outcome only.",
            "Default final reply budget: 16-40 UTF-8 chars.",
            "No markdown explanation or iteration diary.",
        ),
        positive_example="failed: max_iterations hit",
        anti_patterns=(
            "Choosing extra retries yourself.",
            "Explaining every child run.",
            "Returning review prose.",
        ),
        reply_budget_utf8=40,
    ),
    "review": CommandPromptSpec(
        command_id="review",
        role="Thoth structured reviewer",
        objective="Return compressed structured findings. Do not drift into explanatory prose.",
        decision_priority=(
            "Merge duplicates first.",
            "Keep required finding fields second.",
            "Compress prose last.",
        ),
        hard_constraints=(
            "Do not modify project code.",
            "Do not claim acceptance without evidence.",
            "Do not emit free-form review essays outside the findings object.",
        ),
        output_contract=(
            "Top summary budget: 16-32 UTF-8 chars.",
            "Findings are the primary body.",
            "No prose outside the structured review object.",
        ),
        positive_example='{"summary":"2 issues","findings":[...]}',
        anti_patterns=(
            "Narrative code review paragraphs.",
            "Duplicate findings for one location.",
            "Missing severity or title.",
        ),
        reply_budget_utf8=32,
    ),
    "status": CommandPromptSpec(
        command_id="status",
        role="Thoth status briefer",
        objective="Report only deltas, blockers, abnormalities, and active runs. Do not restate normal state.",
        decision_priority=(
            "Abnormal state first.",
            "Then active run deltas.",
            "Then blocking items only.",
        ),
        hard_constraints=(
            "Do not restate healthy defaults.",
            "Do not expand into a dashboard walkthrough.",
        ),
        output_contract=(
            "Human-readable brief only.",
            "Default reply budget: 24-56 UTF-8 chars.",
        ),
        positive_example="1 active run, no blockers",
        anti_patterns=(
            "Repeating every healthy check.",
            "Dumping full task tables.",
        ),
        reply_budget_utf8=56,
    ),
    "doctor": CommandPromptSpec(
        command_id="doctor",
        role="Thoth drift auditor",
        objective="Report only failing, drifting, or missing checks.",
        decision_priority=(
            "Failing checks first.",
            "Then drifted generated surfaces.",
            "Then missing authority artifacts.",
        ),
        hard_constraints=(
            "Do not pad with passing checks.",
            "Do not claim repo health without checks.",
        ),
        output_contract=(
            "Short defect-oriented brief only.",
            "Default reply budget: 24-64 UTF-8 chars.",
        ),
        positive_example="compiler-state missing",
        anti_patterns=(
            "Full green check list.",
            "Narrative health essay.",
        ),
        reply_budget_utf8=64,
    ),
    "report": CommandPromptSpec(
        command_id="report",
        role="Thoth report compressor",
        objective="Compress current authority into a structured conclusion without replaying raw run logs.",
        decision_priority=(
            "Use authority-derived conclusions first.",
            "Then include the output path.",
            "Then compress wording.",
        ),
        hard_constraints=(
            "Do not replay the entire run log.",
            "Do not invent missing evidence.",
        ),
        output_contract=(
            "Short structured conclusion only.",
            "Default reply budget: 32-80 UTF-8 chars.",
        ),
        positive_example="report ready: reports/2026-04-27-report.md",
        anti_patterns=(
            "Verbose timeline recap.",
            "Copying raw markdown report content.",
        ),
        reply_budget_utf8=80,
    ),
    "dashboard": CommandPromptSpec(
        command_id="dashboard",
        role="Thoth dashboard operator",
        objective="Report only key runtime read-model state, abnormal panels, endpoint, or failure point.",
        decision_priority=(
            "Endpoint or failure first.",
            "Then active runtime anomalies.",
            "Then one next action.",
        ),
        hard_constraints=(
            "Do not narrate the whole UI.",
            "Do not restate healthy panels.",
        ),
        output_contract=(
            "Short operator brief only.",
            "Default reply budget: 24-56 UTF-8 chars.",
        ),
        positive_example="dashboard live on :8501",
        anti_patterns=(
            "Explaining every dashboard section.",
            "Repeating unchanged runtime state.",
        ),
        reply_budget_utf8=56,
    ),
    "init": CommandPromptSpec(
        command_id="init",
        role="Thoth adopt/init reporter",
        objective="Report adopt/init result, concrete generated artifacts, and blockers only.",
        decision_priority=(
            "Adopt or init outcome first.",
            "Then generated artifacts.",
            "Then blockers if any.",
        ),
        hard_constraints=(
            "Do not claim blank-repo assumptions.",
            "Do not narrate the whole migration procedure.",
        ),
        output_contract=(
            "Short outcome brief only.",
            "Default reply budget: 24-60 UTF-8 chars.",
        ),
        positive_example="init rendered .thoth and surfaces",
        anti_patterns=(
            "Long bootstrap explanation.",
            "Repeating file trees.",
        ),
        reply_budget_utf8=60,
    ),
    "sync": CommandPromptSpec(
        command_id="sync",
        role="Thoth projection synchronizer",
        objective="Report whether generated surfaces are in sync, what changed, and whether anything failed.",
        decision_priority=(
            "Sync status first.",
            "Then changed surfaces.",
            "Then failure detail if present.",
        ),
        hard_constraints=(
            "Do not hand-maintain generated prompt semantics.",
            "Do not narrate unchanged surfaces.",
        ),
        output_contract=(
            "Short sync brief only.",
            "Default reply budget: 24-60 UTF-8 chars.",
        ),
        positive_example="sync updated commands and skill",
        anti_patterns=(
            "Full generated file dump.",
            "Explaining renderer internals.",
        ),
        reply_budget_utf8=60,
    ),
    "discuss": CommandPromptSpec(
        command_id="discuss",
        role="Thoth planning authority editor",
        objective="Write planning authority only. Do not enter execution semantics or implementation explanation.",
        decision_priority=(
            "Decision and contract authority first.",
            "Then task compiler consequences.",
            "Then unresolved gaps only.",
        ),
        hard_constraints=(
            "Do not modify source code.",
            "Do not fabricate ready execution tasks from open decisions.",
        ),
        output_contract=(
            "Short planning brief only.",
            "Default reply budget: 24-64 UTF-8 chars.",
        ),
        positive_example="decision recorded, tasks recompiled",
        anti_patterns=(
            "Implementation walkthrough.",
            "Executing repo changes.",
        ),
        reply_budget_utf8=64,
    ),
    "extend": CommandPromptSpec(
        command_id="extend",
        role="Thoth repository extender",
        objective="Finish repository changes and report only the key result.",
        decision_priority=(
            "Preserve generated surface parity first.",
            "Then complete repository change.",
            "Then report validation outcome.",
        ),
        hard_constraints=(
            "Do not bypass test gates.",
            "Do not leave host projections drifting.",
        ),
        output_contract=(
            "Short change result only.",
            "Default reply budget: 24-60 UTF-8 chars.",
        ),
        positive_example="surface parity restored, tests pass",
        anti_patterns=(
            "Changelog-style essay.",
            "Ignoring projection drift.",
        ),
        reply_budget_utf8=60,
    ),
}


PHASE_PROMPT_SPECS: dict[str, PhasePromptSpec] = {
    "plan": PhasePromptSpec(
        phase="plan",
        role="Strict phase planner",
        objective="Produce the smallest execution plan for the current strict task phase packet.",
        decision_priority=(
            "Read the packet first.",
            "List only the minimum edits and commands.",
            "Keep the phase output compressed.",
        ),
        hard_constraints=(
            "Do not run commands.",
            "Do not modify code.",
            "Do not judge final success.",
        ),
        output_contract=(
            "One JSON object only.",
            "summary <= 24 UTF-8 chars.",
            "Each edits[] item <= 24 UTF-8 chars.",
            "Each commands[] item <= 40 UTF-8 chars.",
        ),
        positive_example='{"summary":"plan ready","edits":["touch api"],"commands":["pytest -q"],"checks":[{"name":"shape","ok":true}]}',
        anti_patterns=(
            "Running validators.",
            "Writing markdown plans.",
            "Restating the full packet.",
        ),
        thinking_order=(
            "Read packet.",
            "Choose minimum edits.",
            "Choose minimum commands.",
            "Write one short JSON object.",
        ),
        summary_budget_utf8=24,
    ),
    "exec": PhasePromptSpec(
        phase="exec",
        role="Strict phase executor",
        objective="Execute the approved strict task work and record only this phase result.",
        decision_priority=(
            "Follow the plan artifact and task recipe.",
            "Perform only execution work.",
            "Keep the result compact.",
        ),
        hard_constraints=(
            "Do not re-plan the task.",
            "Do not terminalize the whole run.",
            "Do not expand into retrospective prose.",
        ),
        output_contract=(
            "One JSON object only.",
            "summary <= 24 UTF-8 chars.",
            "Each commands_run[] item <= 40 UTF-8 chars.",
        ),
        positive_example='{"summary":"exec done","files_touched":["src/app.py"],"commands_run":["pytest -q"],"artifacts":[]}',
        anti_patterns=(
            "Writing a new plan.",
            "Declaring pass/fail without validation.",
            "Explaining why the edit was needed.",
        ),
        thinking_order=(
            "Read plan and task packet.",
            "Do the minimum edits.",
            "Run only execution-stage commands.",
            "Write one short JSON object.",
        ),
        summary_budget_utf8=24,
    ),
    "validate": PhasePromptSpec(
        phase="validate",
        role="Strict phase validator",
        objective="Run the official validator and return a mechanical pass/fail verdict with metric output.",
        decision_priority=(
            "Run eval_entrypoint.command exactly.",
            "Use actual validator result only.",
            "Compress the verdict.",
        ),
        hard_constraints=(
            "Do not repair code.",
            "Do not implement new changes.",
            "Do not guess pass/fail from intuition.",
        ),
        output_contract=(
            "One JSON object only.",
            "summary <= 20 UTF-8 chars.",
            "checks[] string fields <= 24 UTF-8 chars.",
            "Return pass/fail plus metric fields only.",
        ),
        positive_example='{"summary":"pass","passed":true,"metric_name":"checks","metric_value":1,"threshold":1,"checks":[{"name":"checks","ok":true}]}',
        anti_patterns=(
            "Skipping eval_entrypoint.command.",
            "Fixing code inside validate.",
            "Returning discussion instead of verdict.",
        ),
        thinking_order=(
            "Read eval entrypoint.",
            "Run validator.",
            "Extract pass/fail and metric.",
            "Write one short JSON object.",
        ),
        summary_budget_utf8=20,
    ),
    "reflect": PhasePromptSpec(
        phase="reflect",
        role="Strict phase reflector",
        objective="Compress the failed validation root cause and emit one next-round hint.",
        decision_priority=(
            "Use validator evidence first.",
            "Compress one root cause second.",
            "Emit one next plan hint last.",
        ),
        hard_constraints=(
            "Do not run more commands.",
            "Do not keep executing.",
            "Do not expand into new solution branches.",
        ),
        output_contract=(
            "One JSON object only.",
            "summary <= 32 UTF-8 chars.",
            "next_plan_hint <= 40 UTF-8 chars.",
            "Return root cause plus next hint only.",
        ),
        positive_example='{"summary":"reflect done","failure_class":"validator_failed","root_cause":"api route missing guard","next_plan_hint":"add guard before retry"}',
        anti_patterns=(
            "Continuing execution.",
            "Large redesign proposal.",
            "Multiple competing next steps.",
        ),
        thinking_order=(
            "Read validator artifact.",
            "Name one failure class.",
            "Compress one root cause.",
            "Write one next hint JSON object.",
        ),
        summary_budget_utf8=32,
    ),
}


PHASE_REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    "plan": ("summary", "edits", "commands", "checks"),
    "exec": ("summary", "files_touched", "commands_run", "artifacts"),
    "validate": ("summary", "passed", "metric_name", "metric_value", "threshold", "checks"),
    "reflect": ("summary", "failure_class", "root_cause", "next_plan_hint"),
}


REVIEW_SUMMARY_LIMIT = 48
REVIEW_TITLE_LIMIT = 32
LIST_SHORT_ITEM_LIMIT = 24
COMMAND_ITEM_LIMIT = 40
NEXT_HINT_LIMIT = 40
ROOT_CAUSE_LIMIT = 80
FAILURE_CLASS_LIMIT = 32
METRIC_NAME_LIMIT = 24


def utf8_len(text: str) -> int:
    return len(text.encode("utf-8"))


def command_prompt_spec(command_id: str) -> CommandPromptSpec:
    return COMMAND_PROMPT_SPECS[command_id]


def phase_prompt_spec(phase: str) -> PhasePromptSpec:
    return PHASE_PROMPT_SPECS[phase]


def _render_bullets(items: tuple[str, ...]) -> str:
    return "\n".join(f"- {item}" for item in items)


def render_command_contract_markdown(command_id: str, *, heading_level: int = 2) -> str:
    spec = command_prompt_spec(command_id)
    heading = "#" * max(1, heading_level)
    return f"""{heading} Role

{spec.role}

{heading} Objective

{spec.objective}

{heading} Decision Priority

{_render_bullets(spec.decision_priority)}

{heading} Hard Constraints

{_render_bullets(spec.hard_constraints)}

{heading} Output Contract

{_render_bullets(spec.output_contract)}

{heading} Positive Example

`{spec.positive_example}`

{heading} Anti-Patterns

{_render_bullets(spec.anti_patterns)}
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
    spec = phase_prompt_spec(phase)
    rules = [
        f"Work only inside `{project_root}`.",
        "Do not create or edit `.thoth` ledgers by hand.",
        "Do not invoke `$thoth run`, `$thoth loop`, or `$thoth review`.",
        f"Execute exactly one phase: `{phase}`.",
        f"Write exactly one JSON object to `{output_path}`.",
    ]
    if correction_error:
        rules.append(f"Previous output failed validation: {correction_error}")
        rules.append("Rewrite a shorter, stricter JSON object. Do not explain the error.")
    return f"""# Thoth Phase Worker

Short Rule Header:
{_render_bullets(tuple(rules))}

Role
{spec.role}

Objective
{spec.objective}

Decision Priority
{_render_bullets(spec.decision_priority)}

Hard Constraints
{_render_bullets(spec.hard_constraints)}

Output Contract
{_render_bullets(spec.output_contract)}

Positive Example
`{spec.positive_example}`

Anti-Patterns
{_render_bullets(spec.anti_patterns)}

Thinking Order
{_render_bullets(spec.thinking_order)}

Phase Packet
```json
{json.dumps(phase_packet, ensure_ascii=False, indent=2)}
```
"""


def build_codex_public_command_prompt(command_id: str, *, public_command: str, shell_command: str, done_token: str) -> str:
    spec = command_prompt_spec(command_id)
    lines = [
        "Operate only on this repo.",
        "Use the installed skill named thoth.",
        f"The Codex public surface is `{public_command}`, but in the workspace shell you must execute it literally as `{shell_command}`.",
        "Execute that shell command immediately as your first meaningful action.",
        "Do not search memories, inspect unrelated files, or explain the command before executing it.",
        "Do not replace execution with prose, and do not rely on a stale global thoth binary if it differs from the repo-local implementation.",
        f"Role: {spec.role}.",
        f"Objective: {spec.objective}",
    ]
    lines.extend(f"Decision priority: {item}" for item in spec.decision_priority)
    lines.extend(f"Hard constraint: {item}" for item in spec.hard_constraints)
    lines.extend(f"Output contract: {item}" for item in spec.output_contract)
    if command_id in {"run", "loop", "review"}:
        lines.extend(
            (
                "If the command returns a Thoth execution packet with `dispatch_mode=live_native`, the work is not finished yet.",
                "Continue in this same Codex session and obey the packet plus the phase-specific controller outputs only.",
                "Do not hand-edit `.thoth`; advance only through the provided protocol commands.",
                "Reply with the done token only after the controller reaches terminal state, or after an external-worker packet has been handed off successfully.",
            )
        )
    else:
        lines.append("After the command completes, reply with the done token only.")
    lines.append(f"Done token: {done_token}.")
    return " ".join(lines)


def build_review_result_shape() -> dict[str, Any]:
    return {
        "summary": f"Short summary <= {REVIEW_SUMMARY_LIMIT} UTF-8 chars.",
        "findings": [
            {
                "severity": "high|medium|low",
                "title": f"Short title <= {REVIEW_TITLE_LIMIT} UTF-8 chars.",
                "path": "relative/file/path",
                "line": 1,
                "summary": f"Short summary <= {REVIEW_SUMMARY_LIMIT} UTF-8 chars.",
            }
        ],
    }


def _contains_markdown(text: str) -> bool:
    stripped = text.strip()
    if "\n" in stripped or "\r" in stripped:
        return True
    return bool(
        re.search(r"(^[#>*-]\s)|(```)|(\[[^\]]+\]\()|(^\d+\.\s)", stripped, flags=re.MULTILINE)
    )


def _require_short_text(field: str, value: Any, limit: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    text = value.strip()
    if not text:
        raise ValueError(f"{field} must not be empty")
    if _contains_markdown(text):
        raise ValueError(f"{field} must be plain single-line text")
    if utf8_len(text) > limit:
        raise ValueError(f"{field} exceeds {limit} UTF-8 chars")
    return text


def _require_string_list(field: str, value: Any, limit: int) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    rows: list[str] = []
    for index, item in enumerate(value):
        rows.append(_require_short_text(f"{field}[{index}]", item, limit))
    return rows


def _require_check_list(field: str, value: Any, *, limit: int) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    rows: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ValueError(f"{field}[{index}] must be an object")
        normalized: dict[str, Any] = {}
        name = item.get("name")
        ok = item.get("ok")
        if name is not None:
            normalized["name"] = _require_short_text(f"{field}[{index}].name", name, limit)
        if ok is not None:
            if not isinstance(ok, bool):
                raise ValueError(f"{field}[{index}].ok must be a boolean")
            normalized["ok"] = ok
        for key in ("detail", "summary"):
            if key in item and item.get(key) is not None:
                normalized[key] = _require_short_text(f"{field}[{index}].{key}", item.get(key), limit)
        for key, raw in item.items():
            if key in {"name", "ok", "detail", "summary"}:
                continue
            normalized[key] = raw
        rows.append(normalized)
    return rows


def validate_phase_output(
    phase: str,
    payload: dict[str, Any],
    *,
    validate_schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError(f"{phase} output must be an object")
    required = PHASE_REQUIRED_FIELDS[phase]
    missing = [field for field in required if field not in payload]
    if missing:
        raise ValueError(f"{phase} output missing required fields: {', '.join(missing)}")
    normalized = dict(payload)
    summary_limit = phase_prompt_spec(phase).summary_budget_utf8
    normalized["summary"] = _require_short_text(f"{phase}.summary", payload.get("summary"), summary_limit)
    if phase == "plan":
        normalized["edits"] = _require_string_list("plan.edits", payload.get("edits"), LIST_SHORT_ITEM_LIMIT)
        normalized["commands"] = _require_string_list("plan.commands", payload.get("commands"), COMMAND_ITEM_LIMIT)
        normalized["checks"] = _require_check_list("plan.checks", payload.get("checks"), limit=LIST_SHORT_ITEM_LIMIT)
        return normalized
    if phase == "exec":
        if not isinstance(payload.get("files_touched"), list):
            raise ValueError("exec.files_touched must be a list")
        if not isinstance(payload.get("artifacts"), list):
            raise ValueError("exec.artifacts must be a list")
        normalized["commands_run"] = _require_string_list("exec.commands_run", payload.get("commands_run"), COMMAND_ITEM_LIMIT)
        normalized["files_touched"] = payload.get("files_touched")
        normalized["artifacts"] = payload.get("artifacts")
        return normalized
    if phase == "validate":
        if not isinstance(payload.get("passed"), bool):
            raise ValueError("validate.passed must be a boolean")
        normalized["metric_name"] = _require_short_text("validate.metric_name", payload.get("metric_name"), METRIC_NAME_LIMIT)
        normalized["checks"] = _require_check_list("validate.checks", payload.get("checks"), limit=LIST_SHORT_ITEM_LIMIT)
        if validate_schema and validate_schema.get("type") == "object":
            required_fields = validate_schema.get("required")
            if isinstance(required_fields, list):
                missing_schema_fields = [field for field in required_fields if field not in normalized]
                if missing_schema_fields:
                    raise ValueError(
                        "validate output missing schema-required fields: "
                        + ", ".join(str(field) for field in missing_schema_fields)
                    )
        return normalized
    if phase == "reflect":
        normalized["failure_class"] = _require_short_text("reflect.failure_class", payload.get("failure_class"), FAILURE_CLASS_LIMIT)
        normalized["root_cause"] = _require_short_text("reflect.root_cause", payload.get("root_cause"), ROOT_CAUSE_LIMIT)
        normalized["next_plan_hint"] = _require_short_text("reflect.next_plan_hint", payload.get("next_plan_hint"), NEXT_HINT_LIMIT)
        return normalized
    raise ValueError(f"unsupported phase: {phase}")


def _dedupe_review_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, int | None, str, str, str]] = set()
    for finding in findings:
        path = str(finding.get("path") or "").strip()
        line = finding.get("line")
        title = str(finding.get("title") or "").strip().lower()
        summary = str(finding.get("summary") or "").strip().lower()
        severity = str(finding.get("severity") or "").strip().lower()
        key = (path, line if isinstance(line, int) else None, title, summary, severity)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(finding)
    return deduped


def validate_review_result_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("review result payload must be an object")
    normalized = dict(payload)
    normalized["summary"] = _require_short_text("review.summary", payload.get("summary"), REVIEW_SUMMARY_LIMIT)
    findings = payload.get("findings")
    if not isinstance(findings, list):
        raise ValueError("review.findings must be a list")
    normalized_findings: list[dict[str, Any]] = []
    for index, item in enumerate(findings):
        if not isinstance(item, dict):
            raise ValueError(f"review.findings[{index}] must be an object")
        severity = str(item.get("severity") or "").strip().lower()
        if severity not in {"high", "medium", "low"}:
            raise ValueError(f"review.findings[{index}].severity must be high|medium|low")
        title = _require_short_text(f"review.findings[{index}].title", item.get("title"), REVIEW_TITLE_LIMIT)
        summary = _require_short_text(f"review.findings[{index}].summary", item.get("summary"), REVIEW_SUMMARY_LIMIT)
        path = item.get("path")
        if not isinstance(path, str) or not path.strip():
            raise ValueError(f"review.findings[{index}].path must be a non-empty string")
        finding: dict[str, Any] = {
            "severity": severity,
            "title": title,
            "path": path.strip(),
            "summary": summary,
        }
        if "line" in item and item.get("line") is not None:
            if not isinstance(item.get("line"), int):
                raise ValueError(f"review.findings[{index}].line must be an integer")
            finding["line"] = int(item.get("line"))
        normalized_findings.append(finding)
    normalized["findings"] = _dedupe_review_findings(normalized_findings)
    return normalized
