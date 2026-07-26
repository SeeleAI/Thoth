# Core Design Principles

## Status

1. Date: `2026-06-28`
2. Nature: Thoth's most fundamental high-level goal summary
3. Scope: Records only the most important product design principles; does not expand into engineering architecture, code structure, or implementation paths

## In One Sentence

Thoth's most important design principle is to understand users like a real private secretary, turn their vague intentions into verifiable, recoverable, asynchronously executable, and auditable task loops, and lower the barrier to use as much as possible so that users make only the decisions that genuinely require human judgment.

## 1. Minimize the User's Cognitive Burden and Barrier to Use as Much as Possible

This is Thoth's first objective and the highest judge of every design tradeoff.

Users should not have to manage providers, models, sessions, permission details, context, logs, retries, or acceptance paths. Nor should users have to learn a new set of complex operating procedures before Thoth can work correctly. Users should manage only goals, boundaries, risks, acceptance, and decisions that genuinely require their approval.

Users may explicitly choose a small number of Thoth-level controls beside the input box—for example, whether this is a response, direct handling, or a formal task, as well as the clarification intensity and loop intensity. This does not hand provider complexity to the user; it lets the user express, at very low cost, “how this matter should be treated.” All actual semantic judgments must still be completed through a provider session.

If a feature makes Thoth more powerful but makes the user more tired, it is not part of Thoth's core direction. Thoth's value is not exposing more AI capabilities; it is taking over the burden that, during AI execution, would otherwise require a person to keep watching, remembering, and judging continuously.

We must think here in terms of a real person's character: suppose the user is the CEO of a company with the highest authority, and Thoth is the most important private secretary. A competent private secretary would not require the CEO to restate the context every time, nor would they simply throw every boundary, detail, and execution option back to the CEO. The secretary should remember the project the CEO mentioned yesterday and naturally understand “How is that project we discussed yesterday doing?” The secretary should also understand the CEO's patterns of expression, priorities, risk tolerance, and decision-making style.

Therefore, Thoth's interaction should be neither like a form nor like a command-line tool. Thoth should be like an assistant with a stable personality, reliable memory, and proactive judgment: able to understand ambiguous expressions, remember context across turns, know what it should investigate itself, know what it must ask, and return only the most important decisions to the user.

## 2. Compile Vague Intentions into Clear Tasks

Thoth's most important capability is not execution, but turning the ideas, needs, concerns, and background that users pour out all at once into a clear `Loop` task.

This task must state:

1. What the goal is
2. What will not be done
3. What the constraints are
4. Where the risks lie
5. What the acceptance criteria are
6. Which points are assumptions
7. Which points require the user's decision

Therefore, Thoth's core is not a prompt runner, but a clarification-to-task compiler.

Here too, it must be designed around the real working style of a private secretary. When a user says, “Help me implement ...,” Thoth should not mechanically throw every boundary condition, technical approach, acceptance detail, and exceptional circumstance back to the user to fill in one by one. A truly competent secretary first develops a deep understanding from within the CEO's intent: what the request is genuinely meant to change, who it affects, what risks are most likely to arise, which information can be investigated independently, and which decisions must be approved by the CEO.

Thoth should then ask only the few most important golden questions. Golden questions are not better simply because there are more of them; each question must be capable of materially changing the execution direction, risk boundary, or acceptance criteria. Anything Thoth can infer or verify through context, historical memory, workspace reconnaissance, or existing materials should not become a burden on the user. Only information that cannot be determined and has significant impact needs to be asked of the user.

## 3. Turn Tasks into Recoverable, Auditable, Long-Running Loops

Thoth should not understand a task as a single conversation or a single agent run.

A formal task should naturally be a loop: it can be planned, executed, failed, retried, paused, resumed, reviewed, and reported. After issuing a task, the user can leave while Thoth continues making progress; when the user returns, they can see where the task is, why it is blocked, what the evidence is, and whether the next step requires a decision.

The key to a loop is neither “run it again” nor making a small, tepid incremental fix in every round. Every loop round must push aggressively on the problems left unresolved by the previous round: identify exactly where the previous round failed, why it failed, which assumption was wrong, which evidence was missing, and which implementation path was unworkable, then concentrate effort on resolving that core blocker.

If the previous round was blocked by insufficient acceptance, the next round should prioritize completing the acceptance evidence; if the previous round was blocked by an incorrect direction, the next round should re-plan instead of continuing to pile on small fixes; if the previous round was blocked by implementation quality, the next round should proactively refactor the critical path instead of merely adding unit tests. The value of a loop lies in continuously approaching the goal, not in creating the illusion that “the system is still busy.”

Thus, Thoth's goal is neither to run an agent once nor to repeat tests mechanically, but to maintain an asynchronous task control plane that can identify causes of failure, aggressively correct direction, and continuously drive the work to closure.

### Review Is Judgment and Course Correction, Not a Daemon Form

A powerful Agent Harness should not be treated as an untrusted JSON generator. The daemon needs to save the task id, session handle, phase, round, budget, receipt, hash, manifest, event revision, and recovery cursor; these are prerequisites for system recovery, concurrency safety, and traceability, but they are not the language an agent should use to think about the task.

Review must act like a truly independent technical reviewer who dares to reject the existing path: standing before the user's confirmed goals, constraints, acceptance criteria, and actual work products, it should proactively challenge PlanExec's problem definition, method selection, architectural judgment, and conclusions that appear to pass only locally. Its value lies not in restating the execution report item by item or filling out the acceptance form, but in finding the real crux, requiring abandonment of an incorrect incremental path when necessary, and providing the highest-leverage direction for the next round.

Therefore, evidence should serve as auditable material about reality, rather than as a checklist that Review is forced to obey; the daemon may associate Review's semantic conclusion with task state, but it must not let mechanical recovery fields, budget counters, or schema completeness define the quality of Review.

## 4. Make Success Rest on Acceptance and Evidence

This is the key distinction between Thoth and an ordinary harness.

An executor cannot declare success and have that count as success. Thoth must freeze the acceptance criteria in advance and use an independent Review after execution to check:

1. Whether the goal was actually achieved
2. Whether any constraints were violated
3. Whether evidence exists
4. Whether anything was left untested
5. Whether the scope drifted
6. Whether the result merely appears successful

Thoth should be a validator-first, evidence-first system, not an optimistic agent chat shell.

## 5. Remain Host-Agnostic and Consistent Across Clients

Harnesses will continue to change in the future, and Thoth must not bind its core semantics to any one host.

Thoth itself is not a harness. It does not provide its own model capabilities, call LLM APIs privately, or wrap an ordinary model API as an “internal agent.” All AI capabilities, code execution capabilities, tool-calling capabilities, and agent sessions come from providers configured by the user: ACP adapter, harness runtime, app-server, official harness SDK/control surface, or local harness CLI. Thoth is responsible only for the process, judgment, preset prompts, contracts, acceptance, evidence, and records.

Thoth should achieve the following:

1. The user faces One Thoth
2. Different harnesses may be invoked internally
3. Tasks, acceptance, evidence, state, and memory do not belong to any particular harness
4. The TUI, desktop app, and mobile app see the same truth
5. The UI is a shell; authority resides in Thoth

This goal ensures that Thoth will not become obsolete with the rise and fall of any particular tool.

## 6. Simply Is First: The Final Architecture Must Be Simple, Not the Temporary Implementation

`Simply Is First` is the highest engineering priority for Thoth code development. “Simple” here does not mean writing fewer lines of code, building fewer modules, or first making a shrunken version that can be demonstrated; it means ensuring that the final system has only one primary path, one authority, clear ownership, and composable module boundaries.

Thoth does not accept the approach of first assembling a simplified end-to-end version from A', B', and C', then later changing the whole system into A, B, and C. This approach writes temporary assumptions into the protocol, state, tests, and user experience, ultimately forming compatibility layers, fallbacks, and a second source of truth. The correct sequence is to first implement module A of the final solution, validate it with real interfaces and real milestones; then implement final module B; and continue expanding along the same architecture. Each step may be temporarily incomplete, but every completed part must already be the final system itself, not a substitute intended to be discarded.

Rapid experiments remain important, but the subject of an experiment must be a real architectural risk: whether the final provider adapter can carry the target capability, whether the formal authority boundary can recover, whether the real product API can complete a milestone, and whether the target performance holds. Fixtures may replace external resources and uncertainty, but they must not bypass the formal API, state machine, ownership, or product entry point.

## 7. The Minimal Ontology of Workspace, Task, and Harness

Workspace is the smallest world that Thoth can isolate, schedule, recover, and authorize; Task is the smallest unit of work that a human can confirm, reference, pause, stop, resume, and review. Agent, PlanExec, Review, and ProviderThread are not new sources of task truth; they are merely roles and carriers of cognition or execution occurring around the same Task.

The Provider's native context should remain with the Provider. Thoth stores only the Task Truth that enables humans and Agents to continue understanding the task, together with the Runtime Truth required for the daemon to restore execution order. A Provider's home, authentication, configuration, transcript, cache, and Skill must not be copied into a Thoth session merely to make operation convenient for that Provider; doing so would incorrectly elevate the Provider's accidental form into product architecture.

Every human confirmation becomes part of the history of the Task, rather than overwriting a form field. The frontend Secretary's understanding of the backend Task comes from the Task Blackboard and Human Decision Ledger, not from copying or concatenating another Agent's transcript. `@Task` is an explicit orchestration relationship: it gives the complete semantic world of one Task in the same Workspace to the current partner so that the partner can continue to understand, correct course, and create; it does not glue two provider sessions together.

It is acceptable for the acceptance figures of the real solution to be wrong temporarily; that is an engineering fact that can be seen and addressed. Thoth would rather record the failure, analyze its root cause, and correct the final module than privately lower the target, narrow the semantics, add provider-specific branches, hide a fallback, or treat fake success as a milestone. If the established architecture itself cannot reach the goal, the issue should first be raised explicitly and the canonical architecture decision updated, and only then should a new single path be implemented; the code must not quietly make this decision for the project.
