# Thoth High-Level Design

## Status

1. Date: `2026-06-29`
2. Nature: high-level design, goals, and constraints document for the entirely new version of Thoth
3. Scope: records only product philosophy, design goals, principles, constraints, and non-goals
4. Boundary: does not include code design, development design, directory structure, interface details, reference project code paths, or user click flows
5. Original archive: `.agent-os/designs/thoth-migration-architecture-20260625.md`

## 1. Design Background

### 1.1 Current Assessment

1. AI harnesses, coding agents, IDE agents, and mobile agent control surfaces will continue to change rapidly.
2. The capabilities of individual execution agents will continue to improve, and the amount of work that can be completed in a single conversation will continue to grow.
3. Thoth should not stake its long-term value on any particular harness, UI, model capability, or execution command.
4. Thoth's long-term value should come from a more stable layer: turning people's vague intent into a recoverable, verifiable, auditable, and asynchronously executable task control plane.

### 1.2 Why Start Again

1. Thoth will not continue compatibility development around the archived plugin form.
2. Valuable ideas from the old version can be migrated, but the old implementation form no longer determines the new architecture.
3. Thoth's core entry point changes from commands to conversation, from one-off execution to long-running tasks, and from a single-host projection to a host-independent control plane.
4. Thoth's design must be derived from needs that will remain valid over the next several years, rather than from the capabilities of a particular current tool.

### 1.3 The Most Important Questions

1. What users truly need is not more buttons, more agent names, or more provider options.
2. What users truly need is to unload goals, boundaries, risks, acceptance criteria, and progress from their minds.
3. Thoth should take on the burden of decomposition, questioning, recording, dispatching, tracking, reviewing, and reporting on the user's behalf.
4. Users need to intervene only for goals, boundaries, risks, and necessary decisions.

## 2. Capabilities Unlikely to Be Replaced Over the Next 5 Years

### 2.1 Do Not Treat Execution Capability as the Only Moat

1. Execution capability will be continually caught up with by stronger models, stronger local tools, stronger IDEs, and stronger harnesses.
2. If Thoth is merely another executor, it will be replaced by a stronger executor.
3. If Thoth is merely another chat shell, it will be replaced by a better chat shell.
4. If Thoth is merely another log panel, it will be replaced by a better visualization tool.

### 2.2 Long-Term Scarce Capabilities

1. Clarification compilation: turn incomplete, mixed, and ambiguous user input into executable intent.
2. Acceptance compilation: translate “done” into evidence, metrics, status, human confirmation, or a reviewable artifact.
3. Authoritative task-graph capability: preserve goals, constraints, assumptions, decisions, acceptance, execution, and conclusions as recoverable truth over time.
4. Loop control capability: make a task a long-running process that can be paused, resumed, retried, and reviewed, rather than a single turn.
5. Multi-role adversarial capability: prevent the executor from declaring success on its own by requiring independent review.
6. Evidence ledger capability: make every conclusion traceable to original evidence rather than stopping at a natural-language claim.
7. Host-independent capability: keep Thoth from being bound to a particular execution tool.
8. Cross-client consistency: let desktop, mobile, and terminal clients see the same progress and truth.
9. Real-time observability: continuously stream the provider's actual output, tool events, permission requests, and phase progress instead of waiting behind a black box and returning only a result.

### 2.3 Core Judgment

1. Thoth's moat is not “which agent can I call?”
2. Thoth's moat is “how reliably can I compile a user's intent into an executable, verifiable, recoverable, and auditable task control process?”
3. Execution tools can be replaced; the task control plane must not drift.

## 3. Thoth's Positioning

### 3.1 Primary Positioning

1. Thoth is a task control plane.
2. Thoth is One Thoth, not a collection of multiple visible agents.
3. Thoth is a stable coordination layer between users and various execution harnesses.
4. Thoth organizes conversation, clarification, tasks, execution, review, evidence, and reporting into a unified lifecycle.

### 3.2 User Perception

1. Users face one Thoth.
2. Users can say their ideas, requirements, context, and concerns all at once.
3. Based on the user's explicit task mode or a provider-backed Router session, Thoth determines whether this input should be answered directly, handled directly, or registered as a formal task.
4. Thoth proactively asks about goals, boundaries, risks, constraints, and acceptance instead of requiring users to write a perfect prompt first.
5. After a task is complete, Thoth reports conclusions, evidence, risks, and follow-up recommendations instead of throwing users into raw logs.

### 3.3 System Responsibilities

1. Thoth holds task truth.
2. Thoth holds decision truth.
3. Thoth holds acceptance truth.
4. Thoth holds execution evidence.
5. Thoth holds phase conclusions.
6. Thoth coordinates external harnesses without handing task authority to any individual harness.

## 4. What Thoth Is Not

### 4.1 Not Another Coding Agent

1. Thoth does not aim to replace any particular coding agent.
2. Thoth can schedule coding agents, but does not equate its own value with executing code.
3. Thoth's primary boundaries are task control, clarification, acceptance, evidence, and adversarial review.
4. Thoth itself does not provide agent execution capability; execution capability comes from configured providers and harness runtimes.
5. Thoth does not privately call an LLM API to pretend to be an internal coding agent.

### 4.2 Not Another IDE

1. Thoth does not seek to become a full IDE.
2. Thoth does not treat a file editor, terminal emulator, or visual layout as its core value.
3. Thoth may present necessary diffs, logs, and reports, but these are evidence of the task control process, not the center of the product.

### 4.3 Not a Pretty Log Browser

1. Raw logs cannot replace judgment.
2. A timeline cannot replace acceptance.
3. Agent chatter cannot replace a report.
4. Thoth must compress a complex process into information on which users can act.

### 4.4 Not a Single-Host Plugin

1. Thoth is not bound to a single host.
2. Thoth does not treat any host's session, permissions, context, or runtime semantics as global truth.
3. Hosts may change, but Thoth's task, acceptance, evidence, and phase semantics must remain stable.

### 4.5 Not a Manual Prompt Manager

1. Users should not be forced to learn internal prompts.
2. Users should not have to write role instructions by hand to drive the system.
3. Users should not have to maintain task continuity by copying and pasting context.

### 4.6 Not a Hidden LLM API Wrapper

1. Thoth's source code owns only process, routing decisions, preset prompts, task contracts, acceptance, evidence, memory, and session records.
2. Thoth does not directly treat OpenAI, Anthropic, or other model inference APIs as its own execution layer.
3. All AI and agent capabilities must come from the user's configured provider.
4. A provider may be an ACP adapter, harness runtime, app-server, official harness SDK/control surface, or local harness CLI.
5. Thoth may pass prompt contracts, context packages, and acceptance requirements to a provider session, but may not bypass provider semantics to privately initiate model calls.

## 5. First Principle: Minimize the User's Cognitive Burden and Barrier to Use

### 5.1 Things Users Should Not Have to Manage

1. Provider differences.
2. Session resumption.
3. Context-injection details.
4. Tool-permission details.
5. Which logs matter.
6. Which phase should be retried.
7. Whether the executor has self-certified success.
8. Manually synchronizing state across multiple clients.
9. Continuously watching whether a long-running task is still running.
10. Waiting for a heavy agent loop just to say hello, check status, or ask a simple question.
11. Entering a raw harness window just to see what the provider is doing.

### 5.2 Things Users Should Manage

1. Goals.
2. Boundaries.
3. Risks.
4. Acceptance.
5. Necessary decisions.
6. Final satisfaction with the result.

### 5.3 Things Thoth Should Proactively Take On

1. Understand the true intent in mixed input through a provider-backed session.
2. Distinguish `Quick` from `Loop` under the user's explicit mode or a provider-backed judgment.
3. Respond quickly to lightweight input; for example, it should not wait more than `10s` when the user only says `hi`.
4. Ask about missing critical assumptions.
5. Record user decisions.
6. Compile acceptance conditions.
7. Control the execution loop.
8. Detect insufficient evidence.
9. Organize review.
10. Give clear next-step choices when something fails.
11. Give a concise report when something succeeds.

## 6. The Relationship Between Users and Thoth

### 6.1 One Thoth + Private-Secretary-Style Routing

1. Users need to face only one Thoth.
2. The system may contain multiple internal roles, but does not expose them as multiple agents users must choose between.
3. Users can directly ask Thoth to do something, or converse with Thoth in a specific workspace.
4. Thoth should feel like a stable coordinator rather than a temporary one-off tool call.
5. Thoth may internally use private-secretary- or chief-of-staff-style routing judgments, but those judgments must be executed through a provider-backed session and cannot be disguised as local deterministic rules.
6. This internal judgment layer is responsible for understanding intent, selecting context, selecting execution capabilities, aggregating evidence, and determining when the user must make a decision.
7. Claude, Codex, ACP, providers, drivers, and internal roles are all dispatching details, not daily choices for users.

### 6.2 Do Not Expose Unnecessary Complexity

1. Users do not manage provider sessions, internal roles, or provider-native differences in an ordinary chat box.
2. Users can see a small number of Thoth-level controls near the input box: `+`, Provider, Mode, Clarify, and Loop.
3. Task mode is a choice between `Quick` and `Loop`, used to explicitly tell Thoth whether this input enters the formal task lifecycle.
4. Clarify controls how deeply the provider session asks questions before answering, taking action, or entering a formal task; it is not provider-native thinking strength.
5. Loop controls the retry strategy and persistence after a formal task fails; it is not provider-native thinking strength.
6. Users see clear cards only when a decision is needed.
7. The Provider control can pass through provider/model/runtime settings, including model id, thinking strength, permission mode, and fast mode.

### 6.3 Trust Relationship

1. Thoth may advance low-risk, reversible, clearly bounded matters on the user's behalf.
2. Thoth may not decide matters that are high-risk, irreversible, change acceptance, or cross a boundary on the user's behalf.
3. Thoth may not hide uncertainty in order to appear smooth.
4. Thoth may not package unconfirmed critical assumptions as established facts.

### 6.4 Do Not Adopt a Visible Team / Squad Mental Model

1. Thoth should not make users choose agents, squads, leaders, or internal execution modes as if they were managing an agent dashboard.
2. A visible team model like Multica's is suitable for a managed agents platform, but not for Thoth's CEO private-secretary model.
3. Thoth may borrow short-task queues, execution records, and notification mechanisms from such systems.
4. Thoth should not expose these mechanisms as a new organizational structure that users must understand.

### 6.5 Context Resolution Should Resemble a Secretary, Not a Routing Table

1. When users do not explicitly write `@workspace` in global chat, Thoth should not mechanically abandon context understanding.
2. Through a provider-backed session, Thoth should perform confidence-based context resolution using recent conversation, active projects, user habits, workspace state, and historical tasks.
3. If there is only one high-confidence candidate, Thoth should naturally resolve to that context, for example by understanding “How is that project we talked about yesterday doing?”
4. If multiple reasonable candidates exist, Thoth should ask only one golden question that removes the ambiguity.
5. Thoth should not, under low confidence, write a global intent into the wrong workspace on its own.
6. By default, the product trusts high-confidence context judgments backed by the provider; excessive confirmation is itself a cognitive burden.

## 7. Core Philosophy of the Task Control Plane

### 7.1 Not Every Input Should Become a Formal Task

1. `Quick` is for answers, status explanations, conceptual explanations, queries over existing information, and quick actions.
2. `Quick` may read, write, search, organize, or perform simple operations, but does not enter the complete formal task lifecycle.
3. `Loop` is for long-running, uncertain, high-risk work that requires an acceptance loop or continued execution.
4. The MVP composer should provide two explicit task modes, `Quick` and `Loop`, so users can directly choose whether this input enters the formal task lifecycle.
5. Answers and quick actions are result types of `Quick`, not a third user-visible mode.
6. If automatic mode recommendations are added later, the automatic judgment must also come from a provider-backed Router session rather than a local heuristic classifier.

### 7.2 A Formal Task Is Not a Message

1. A formal task is not a single-turn conversation.
2. A formal task must have goals, constraints, acceptance, and risk boundaries.
3. A formal task must be resumable, pausable, reviewable, and reportable.
4. A formal task must be able to explain where it is currently blocked.

### 7.3 Registering a Task Means Registering a Loop

1. Once a task enters a formal state, it is no longer merely “execute once.”
2. A task should be treated as a controlled loop.
3. A loop includes at least planning, execution, review, and necessary retries.
4. A loop must have stopping conditions.
5. A loop must have conditions for escalation to the user.

### 7.4 Truth Must Not Be Scattered Across Chat

1. Chat is the entry point, not the final authority.
2. User decisions must be recorded as part of task truth.
3. Acceptance criteria must be recorded as part of task truth.
4. Execution evidence must be recorded as part of task truth.
5. Reports must be traceable to evidence rather than relying only on natural-language summaries.
6. `Quick` does not need formal task authority, but actions must have a minimal execution record and evidence.

### 7.5 The Provider Process Must Be Visible in Real Time

1. Thoth should not wrap provider sessions as black boxes.
2. Whether for clarification, direct handling, formal execution, or review, all provider output that can be shown should stream back to the user interface in real time.
3. Thoth may add phase labels, evidence labels, and risk labels to the output, but should not hide the visible execution process.
4. This lets users feel that Thoth is making progress and lets long-running tasks be observed, interrupted, and audited remotely.

## 8. Lifecycle Principles

### 8.1 At Least Three Independent Phases

1. Clarification and contract phase.
2. Plan+Exec execution phase.
3. Review, verification, and reflection phase.
4. These phases apply only to formal tasks after registration; they are not imposed on answers or direct handling.
5. `Quick + Don't Bother Me` must preserve a bare provider passthrough experience and must not be slowed down by the formal task lifecycle.

### 8.2 Three Responsibility Boundaries

1. Clarification cannot make high-impact decisions on the user's behalf.
2. Clarification cannot modify workspace files; it can only conduct read-only investigation, research materials online, organize questions, and record decisions.
3. Plan+Exec cannot redefine success; it can only execute according to the frozen contract.
4. Review cannot rewrite acceptance or directly become a second executor.

### 8.3 Phase Independence

1. Clarify is an independent provider session responsible for read-only investigation, user discussion, assumption resolution, decision recording, and a contract draft.
2. Plan+Exec is the same provider session, using the provider's native plan mode to complete the continuous process of planning and execution.
3. Review is an independent provider session responsible for adversarial checking and does not modify files.
4. Phases pass information through a structured handoff packet and do not share the complete chat history by default.
5. Once the contract is frozen, provider clarification questions that arise during Plan+Exec should no longer disturb the user; the system should answer and record them automatically according to the frozen contract or recommended defaults.
6. Once the contract is frozen, permission approvals are still handled according to the permission policy and cannot be bypassed by automatic-answer rules.
7. After failure, the system must return to a controlled loop instead of allowing the executor to drift onward on its own.
8. The daemon's phase, round, budget, receipt, hash, manifest, session handle, and recovery state belong to the task control plane; they must not become the thought context of any Agent Harness session or the template for a Review conclusion.

## 9. Cross-Client Consistency Principles

### 9.1 The UI Is a Shell

1. No UI owns independent business semantics.
2. No UI owns an independent task state machine.
3. The same task is shown on different clients as different presentations of the same truth.
4. A UI may optimize interaction, but may not change the meaning of the task lifecycle.

### 9.2 Multiple Clients Do Not Mean Multiple Truths

1. Desktop, mobile, and terminal clients cannot each maintain their own task state.
2. Cross-client synchronization must follow authoritative history.
3. Live presentation provides immediacy; historical catch-up provides correctness.
4. State must be fillable after a disconnection and reconnection.

### 9.3 Client Responsibilities May Differ

1. The desktop app may provide the global entry point and manage local background services.
2. The mobile app may provide remote viewing, clarification, approval, and report reading.
3. The terminal UI may provide efficient control of the current workspace.
4. The CLI may provide an advanced scripting entry point.
5. Claude, Codex, and ACP host surfaces may provide external operation entry points into the same authority.
6. Relay may provide a remote encrypted synchronization entry point.
7. Different responsibilities do not mean different semantics.
8. Desktop may execute Host-native Browser and open-editor actions, but the semantic request and authority fence
   remain Provider-neutral and Workspace-scoped.
9. Files/Changes may be richly inspectable on App/Desktop while remaining read-only; presentation convenience does
   not turn Thoth into an editor or a second Git authority.

## 10. Host-Independence Principles

### 10.1 Do Not Pretend Hosts Are Identical

1. Different harnesses have different capabilities.
2. Different harnesses have different session, permission, context, tool, and output semantics.
3. Host independence does not mean flattening differences; it means preventing differences from contaminating Thoth's task truth.

### 10.2 Upper-Layer Semantics Must Remain Stable

1. The semantics of creating a task must remain stable.
2. The semantics of asking a clarification question must remain stable.
3. The semantics of execution evidence must remain stable.
4. The semantics of a review conclusion must remain stable.
5. The semantics of failure and success must remain stable.

### 10.3 Hosts Are Merely Sources of Execution Capability

1. A host may be replaced.
2. A host may fail.
3. A host may pause.
4. A host may support only some capabilities.
5. Thoth must understand these differences without exposing them as a daily burden to users.

## 11. Adversarial Review Principles

### 11.1 The Executor Cannot Self-Certify Success

1. The executor may report what it did.
2. The executor may report what evidence it produced.
3. The executor may not unilaterally declare that the task satisfies acceptance.
4. Success must pass independent review.

### 11.2 Reviewer's Responsibilities

1. Independently determine whether the goal was truly achieved rather than accepting the executor's account.
2. Actively challenge whether the current problem definition, technical approach, architectural judgment, and local optimizations remain correct.
3. Check for fundamental contradictions among constraints, acceptance, and real-world evidence.
4. Identify false success, scope drift, insufficient testing, missing artifacts, unreliable conclusions, and situations where “tests are green but the direction is wrong.”
5. When the current path is wrong, clearly require stopping incremental fixes, identify what should be abandoned, clarify what must be understood again, and state what should be advanced most in the next round.
6. When the path is correct, still explain why it withstands independent challenge instead of merely returning pass.
7. Use only the user contract and observable reality as judgment material; do not use the daemon's budget, phase, round, hash, manifest, or form fields as the review framework.

### 11.3 The Reviewer Must Not Be Led by the Executor

1. The PlanExec report is material to be reviewed, not a to-do list for Review.
2. Review may reject PlanExec's risk assessment, verification scope, and next-step recommendations.
3. A failed Review conclusion must produce a directional judgment capable of changing the next round's method, rather than breaking the previous round's work into more local patches.

### 11.4 The Reviewer Does Not Perform Fixes

1. After finding a problem, the reviewer outputs the problem, evidence, and retry recommendation.
2. Fixes must return to the planning and execution phases.
3. This keeps the adversarial boundary clean.

## 12. Acceptance and Evidence Principles

### 12.1 Acceptance Comes Before Success

1. Without acceptance criteria, formal execution should not begin.
2. Without evidence, completion should not be declared.
3. If acceptance is unclear, clarification must continue or the task must be explicitly blocked.
4. Task success must be determined by acceptance and evidence, not by the agent's tone.

### 12.2 Evidence Types

1. It may be automated tests.
2. It may be metrics.
3. It may be a file or artifact.
4. It may be service status.
5. It may be a screenshot or visible result.
6. It may be human acceptance.
7. It may be a combination of multiple forms of evidence.
8. Evidence presents reality to the reviewer; it must not reduce the reviewer to a mechanical checker of receipts, hashes, or an acceptance matrix.

### 12.3 Human Acceptance Cannot Be Replaced by AI Self-Evaluation

1. Some tasks naturally lack a reliable automatic validator.
2. Such tasks may enter formal execution, but the method of human acceptance must be explicitly marked.
3. AI review may provide recommendations and risk judgments, but cannot impersonate the user's final acceptance.

## 13. MVP Constraints

### 13.1 Product-Form Constraints

1. The MVP covers the desktop app, mobile app, TUI, CLI, relay, Claude, Codex, and ACP simultaneously.
2. The desktop app and mobile app may have global entry points.
3. The TUI and CLI are intended for efficient control and scripted operations of the current workspace.
4. Claude, Codex, and ACP are host entry points into the same authority and do not own independent task semantics.
5. Relay provides only remote synchronization and connectivity and does not own task truth.
6. All UI and host surfaces share the same underlying semantics.
7. The MVP scope continues to cover these entry points; the real difficulty is not conventional software development, but the quality of clarify and loop design.

### 13.2 Task-Entry Constraints

1. User input does not need to be structured in advance.
2. Users can explicitly select the input type in the composer: `Quick` or `Loop`.
3. The MVP does not depend on a local auto router to guess user intent.
4. If automatic input-type recommendations are needed, the recommendations must come from a provider-backed Router session.
5. `Quick` is for answers and quick actions and does not enter contract freeze, Plan+Exec, Review, or Loop.
6. `Loop` is for formal tasks and enters Clarify -> Contract Freeze -> Plan+Exec -> Review.
7. Answers and quick actions should not be forcibly registered as formal tasks.

### 13.3 Clarification Constraints

1. Clarify defaults to Auto.
2. A formal task must have contract-freeze confirmation before entering execution.
3. The system may ask fewer questions, but must not pretend critical uncertainty does not exist.
4. Facts that the system can investigate itself should not be pushed to the user.
5. Decisions requiring the user must be asked explicitly.
6. Clarification capability is a core quality gate for the MVP and must not be diluted by ordinary UI or provider-integration work.

Clarify levels:

1. `auto`: the provider-backed session chooses the clarification intensity.
2. `Don't Bother Me`: do not ask proactive follow-up questions; the agent determines and records technical details and assumptions on its own; stop and report when a high-impact fork requires a user decision.
3. `light`: ask little; ask only questions that would clearly change direction, permissions, or acceptance.
4. `Balanced`: balanced mode; ask a small number of golden questions.
5. `deep`: deep clarification, suitable for high-risk, high-cost, or acceptance-complex tasks.
6. The Clarify phase must be read-only; it may read the workspace, inspect git status, search materials, and conduct online research, but may not modify files.
7. The latest Loop 1/2 interpretation is defined by `NTH-CD-033` and `NTH-CD-034`: Clarify does not proactively provide a default recommendation, does not ask goal-downgrade fallback questions, and question cards use a title, 2-4 behavior-tree branch choices, and a note response; `thoth.clarify` rules live in the standard `SKILL.md`, and ordinary packets do not repeat Skill rules.

### 13.4 Loop-Intensity Constraints

1. Loop defaults to `auto`.
2. The Loop control takes effect only when Mode = `Loop`; it is disabled when Mode = `Quick`.
3. `auto`: the provider-backed session determines the loop strategy based on task risk, failure modes, and cost.
4. `One Plan, One Do`: perform one Plan+Exec and one Review; block and report directly after failure.
5. `light`: faster and less expensive; block and report earlier after failure.
6. `balanced`: limited retries while maintaining clear failure reasons and complete evidence.
7. `Run Until Stopped`: a red, high-consumption mode that continues until the user manually stops it.
8. `Run Until Stopped` must still obey permissions, safety hard stops, provider availability, and resource boundaries.
9. Loop intensity is Thoth's task control strategy, not provider-native thinking strength.

### 13.5 Execution Constraints

1. Write execution within the same workspace is serial by default.
2. Users can continue clarifying or view other tasks.
3. Users can terminate a task at any time.
4. When a task is stopped, retain its state, evidence, and reason for incompletion; do not roll it back automatically.
5. High-risk operations require user approval by default.
6. Users can enable full access / trust mode to skip approval cards.
7. Skipping approval does not mean skipping the timeline, evidence, risk record, or final report.
8. Write execution for formal tasks passes through a task branch or task worktree for isolation by default.
9. `git push` does not happen automatically when checks pass; it can only be executed as a high-risk `Quick` action.
10. Whether the loop can push aggressively on the previous round's failure points is a core quality gate for the MVP.
11. Provider output that can be shown from all phases must stream into the timeline in real time.
12. Plan+Exec must make the most of the provider's native plan mode rather than having Thoth reimplement an execution agent.
13. A Workspace Schedule creates a real Task and ExecutionAttempt on every trigger. It uses the same Workspace
    mutation lease by default; a separate worktree Workspace exists only after an explicit user choice.
14. Idle release may free Provider runtime handles, but it must retain Agent, Task, Timeline, Card, HumanDecision,
    Evidence, and the opaque persistence receipt required for honest resume or replacement.
15. The product entry is `Tasks`, with `Tasks` and `Schedules` as views over the same Workspace authority. A
    Schedule run records its owner Workspace, actual execution Workspace, Task and ExecutionAttempt; legacy unknown
    execution Workspace remains unavailable rather than being guessed.
16. Workspace scripts are named Workspace capabilities. CLI, App and eligible Provider execution all call the same
    semantic list/start/stop API; Workspace owns command authorization, ToolGateway owns execution scope, and Host
    runtime persistence owns process, terminal, route and service-port receipts.
17. Physical socket liveness, E2EE frame negotiation and file streaming form one transport boundary. Socket leases
    and queued-byte limits apply to the physical connection; file transfer advertises one fixed size/revision and
    awaits bounded chunks; Relay forwards only opaque ciphertext.
18. Provider quota parsing, model-specific effort metadata and provider-native child ancestry are Driver concerns.
    Daemon consumes normalized capability/usage/residency receipts and never branches on Provider identity.

### 13.6 Reporting Constraints

1. Reports should support user action.
2. Reports should state what was done, whether it passed, where the evidence is, what the risks are, and whether the user needs to take action.
3. Reports should not dump large amounts of raw logs directly on the user.

## 14. Non-Goals

### 14.1 No Compatibility with the Archived Plugin Form

1. Thoth does not aim to be compatible with the archived plugin architecture.
2. Ideas, prompt experience, authority experience, loop experience, and review experience from the old version may be migrated.
3. The old version's command form, in-project storage form, and host projection form do not constrain the new version.

### 14.2 Not a Full IDE

1. The MVP does not pursue heavyweight code editing.
2. The MVP does not pursue a complete terminal workstation.
3. The MVP does not pursue replacing existing development environments.

### 14.3 Not Fully Autonomous Operation

1. Thoth should not bypass the user on high-risk matters.
2. Thoth should not treat user-unapproved assumptions as facts.
3. Thoth should not sacrifice acceptance truth in order to reduce interruptions.

### 14.4 Provider Count Is Not the Success Criterion

1. The primary success criterion is that the complete task lifecycle works.
2. Multi-host capability must serve the task control plane rather than becoming a support-list competition.
3. When integrating more harnesses later, task truth, evidence, and review boundaries must not be broken.
