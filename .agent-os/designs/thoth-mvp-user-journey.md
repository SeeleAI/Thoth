# Thoth MVP User Journey

## Status

1. Date: `2026-06-29`
2. Nature: User-perspective usage document for the entirely new version of Thoth's MVP
3. Scope: Describes only what users see, enter, click, and receive in the desktop app, mobile app, TUI, CLI, relay, Claude, Codex, and ACP entry points
4. Boundary: Does not explain architectural reasons, and does not describe code, engineering interfaces, directories, data structures, object types, adapter layers, or reference-project file paths
5. Original archive: `.agent-os/designs/thoth-migration-architecture-20260625.md`

## 1. Opening the desktop app for the first time

1. The user opens the desktop app for the first time.
2. The app displays a concise global home.
3. The global home shows:
   - the current local Thoth service status
   - the list of added workspaces
   - a global chat input box
   - the provider configuration status
   - the number of cards awaiting user action
4. If the local Thoth service is not running, the desktop app automatically detects and starts it.
5. If no provider has been configured, the app enters the setup wizard.
6. The setup wizard asks the user to complete only the necessary configuration and does not expose internal provider differences.
7. After setup is complete, the user returns to the global home.

## 2. Adding a workspace

1. The user clicks Add workspace.
2. The app opens a folder picker.
3. The user selects a local project directory.
4. Thoth displays a confirmation card containing:
   - the workspace name
   - the local path
   - the current git branch
   - whether there are uncommitted changes
   - the default policy to be used for task execution
5. After the user confirms, the directory appears in the workspace list.
6. If the directory already has uncommitted changes, Thoth does not prevent it from being added, but marks the workspace as having dirty state.
7. After the workspace is added, the user can enter its workspace page.

## 3. The desktop app's global home / global chat

1. The global home is the cross-workspace entry point.
2. The user can communicate with Thoth in global chat.
3. Global chat can be used to:
   - ask about overall status
   - ask about progress across multiple workspaces
   - record cross-project ideas
   - ask a direct question and receive an answer
   - dispatch a task to a specific workspace through an explicit `@workspace`
   - naturally resolve to the workspace discussed most recently when provider-backed context makes that judgment with high confidence
4. Global chat does not require the user to explicitly enter `@workspace` every time.
5. Based on recent conversation, active projects, user habits, workspace status, and historical tasks, Thoth uses the configured provider to determine which workspace the user may be referring to.
6. If there is only one high-confidence candidate, Thoth can naturally bind the conversation to that workspace.
7. If there are multiple candidates or confidence is insufficient, Thoth uses a short card to let the user choose.
8. When confidence is low, Thoth does not arbitrarily write the global intent into a workspace.

## 4. Explicitly or naturally binding a workspace

1. The user can explicitly enter:

   ```text
   @my-app Help me check whether the recent changes to the login flow have broken the mobile experience.
   ```

2. Thoth recognizes `@my-app` as the target workspace.
3. Thoth binds this input to that workspace.
4. The user can also say:

   ```text
   How is that login project we discussed yesterday going?
   ```

5. If provider-backed context can confidently resolve this to a unique workspace, Thoth answers directly or displays that workspace's status.
6. If provider-backed context cannot determine the workspace, Thoth asks:
   - Do you mean `my-app` or `admin-console`?
7. After the workspace is bound, the user selects `Quick` or `Loop` in the composer.
8. If the user selects `Loop`, Thoth creates a task draft and enters the clarification and contract-freezing process.
9. The user can also continue completing clarification cards and confirmation cards for the task in global chat.
10. After the task enters execution, it appears in the task list of the corresponding workspace and is also shown in the global home aggregation.

## 5. Global conversation behavior when the workspace is uncertain

1. The user says directly in global chat:

   ```text
   Help me organize these recent ideas into a plan for what to do next.
   ```

2. If it is itself unclear whether a workspace needs to be bound, Thoth handles the situation through provider-backed context judgment.
3. If the provider-backed judgment determines that this is only global idea organization, Thoth handles it as a global discussion directly.
4. If the provider-backed judgment determines that it must land in a workspace but there is no high-confidence candidate, Thoth asks only one key question:
   - Which workspace should this plan be applied to?
5. No formal workspace task is created until the user makes an explicit selection or Thoth reaches a high-confidence resolution.
6. This preserves secretary-like contextual understanding while avoiding dispatching a global idea to the wrong project.

## 6. Workspace page

1. The user clicks a workspace.
2. The page displays the workspace view for that workspace.
3. The default areas include:
   - workspace chat
   - the current task queue
   - running tasks
   - cards awaiting confirmation
   - recent reports
   - provider health status
4. Input in workspace chat is naturally bound to the current workspace.
5. When entering a request in workspace chat, the user does not need to enter `@workspace` again.
6. The workspace page does not display details of other global projects unless the user returns to the global home.

## 7. The user enters a natural-language request

1. The user can enter the context, goal, concerns, constraints, and expectations all at once.
2. Example:

   ```text
   I want to reorganize the account security area on the settings page.
   The current entry points are too scattered, and it is difficult for users to find where to change their password and configure two-factor authentication.
   But do not overhaul the entire settings page; ideally, change only the security-related area.
   Afterward, confirm that nothing breaks at desktop and mobile widths.
   ```

3. The user does not need to write the request in a fixed template in advance.
4. The user does not need to specify internal roles.
5. The user does not need to choose a model or execution harness.
6. The user sees five composer controls near the input box:
   - `+`
   - Provider
   - Mode
   - Clarify
   - Loop
7. In the MVP, `+` supports only adding images and uploading files; each individual attachment must be smaller than `10MB`.
8. There is no separate Scope button; the user expresses scope through `@workspace`, `@file`, or other `@` references.
9. The Provider control opens provider/runtime settings, including provider, model id, thinking strength, permission mode, and fast mode.
10. There are only two Modes:

- `Quick`: Answers and quick actions; does not enter contract freeze, Plan+Exec, Review, or Loop.
- `Loop`: Formal tasks; enters clarification, contract freeze, asynchronous execution, review, and the loop.

11. Clarify controls clarification intensity and applies to both `Quick` and `Loop`.
12. Loop controls loop intensity and applies only when Mode = `Loop`; it is grayed out and unavailable when Mode = `Quick`.
13. If the user is unsure which mode to choose, a Recommended Mode capability may be provided later; the recommendation must come from a provider session, not from guesses based on local rules.

## 8. Experience of the two task modes

1. `Quick`:
   - Includes questions and answers and quick actions.
   - Does not enter contract freeze, Plan+Exec, or Review.
   - Does not enter the formal task loop.
   - Does not display a contract-freeze card.
   - Can answer `hi`, explain status, summarize reports, generate a commit message, perform git commit/git push, make a small-scope edit, or perform a one-time search.
   - If a write operation or high-risk operation is needed, permissions are governed by the Provider's permission mode and permission cards.
   - For lightweight input such as `hi`, perceived user wait should not exceed `10s`.
   - If Clarify is set to `Don't Bother Me`, the experience should be as close as possible to a bare provider harness runtime.
2. `Loop`:
   - Is used for formal tasks.
   - Creates a task draft.
   - Enters Clarify -> Contract Freeze -> Plan+Exec -> Review.
   - After Review fails, enters the next round according to Loop intensity.
   - Is suitable for implementing features from scratch, broad refactoring, multi-stage development, high-risk changes, and tasks requiring acceptance evidence.
3. Semantic judgment must occur within the provider session.
4. Local Thoth only respects the user's explicit selection, maintains state, performs permission checks, and records evidence.
5. Local Thoth does not secretly classify input into task modes using natural-language heuristic rules.
6. If the mode selected by the user is clearly inconsistent with the provider's judgment, Thoth uses a card to suggest switching modes and explains why.

## 9. Typical `Quick` experience

1. The user sets Mode to `Quick`, sets Clarify to `Don't Bother Me`, and then enters:

   ```text
   hi
   ```

2. Thoth passes the input directly to the provider harness runtime.
3. The user sees the provider's output appear in real-time streaming.
4. Thoth does not create a task, display a clarification card, display a contract-freeze card, or enter Review.
5. This path should feel essentially the same as a Paseo-style bare provider session.
6. The user enters:

   ```text
   Help me organize this week's weekly report.
   ```

7. If Clarify is not `Don't Bother Me`, Thoth may first use a Clarify provider session to ask one key question.
8. If Thoth can find sufficient sources, it directly organizes and outputs the weekly report, sources, and uncovered items.
9. If a key source is missing, it asks only one question, such as “Which workspace should be the primary basis for this week's report?”
10. The user enters:

```text
Please search online for the latest news about a certain technical direction.
```

11. Thoth searches directly, cites sources, indicates dates, and provides a summary and uncertainties without creating a formal task.
12. The user enters:

```text
Please run git push for me.
```

13. Thoth first checks the current workspace, branch, remote, dirty state, commits awaiting push, and target remote.
14. If the mode is not full access / trusted mode, Thoth displays a permission card requesting approval.
15. If the mode is full access / trusted mode, Thoth executes directly while still recording the check results and push evidence.
16. The user enters:

```text
Please smooth out the wording of this small piece of copy.
```

17. Thoth can make a small-scope edit and display a diff or modification summary without entering the formal task loop.
18. If the cause of a short action's failure becomes complicated, Thoth does not pretend that it is still working; it suggests switching to `Loop`.

## 10. Default clarification experience

1. The default Clarify setting is `auto`.
2. Thoth does not dump every possible question on the user at once.
3. Thoth first organizes on its own:
   - the goal
   - what not to do
   - constraints
   - the acceptance method
   - risks
   - points requiring the user's decision
4. It then displays one or more clarification cards.
5. Each card contains only a small number of key questions.
6. Questions must concern matters that affect execution or acceptance.
7. Thoth does not ask the user for information it can investigate from the workspace on its own.
8. The user can make selections item by item, enter additional information, or ask Thoth to explain why a question is needed.
9. `Quick` does not enter the contract-freeze process, but Clarify still affects whether it first asks one necessary question.
10. The goal of clarification cards is not to enumerate every boundary, but to have Thoth ask a small number of golden questions that truly affect direction, risk, or acceptance.
11. Clarify options:

- `auto`: A provider-backed session selects the clarification intensity based on the input, workspace, risk, and the user's historical preferences.
- `Don't Bother Me`: Do not ask follow-up questions proactively; the agent determines technical details independently and records assumptions; when it encounters a high-impact fork that must be decided by the user, it must stop and report.
- `light`: Ask few questions, limited to those that would clearly change direction, permissions, or acceptance.
- `Balanced`: A balanced mode that asks a small number of golden questions.
- `deep`: In-depth clarification, suitable for high-cost, high-risk, acceptance-complex, or design-first tasks.

12. Clarify applies to both `Quick` and `Loop`.
13. Clarify affects only how Thoth organizes the provider session, not model or thinking-strength selection.
14. The Clarify provider session has read-only permissions.
15. Clarify can read files, inspect git status, search code, inspect logs, browse online for information, and organize information.
16. Clarify cannot modify files, install dependencies, commit code, delete files, or start actions that would change the workspace.
17. User discussion during Clarify, key answers, agent assumptions, and user decision points are all recorded.
18. The latest Loop 1/2 definition is in `NTH-CD-033` and `NTH-CD-034`: Clarify does not proactively provide a default recommendation or ask goal-degrading fallback questions; question cards use a title, 2-4 behavior-tree branch choices, and a note response; the `thoth.clarify` rules live in the standard `SKILL.md`, and ordinary packets do not repeat the Skill rules.
19. For `Loop`, these records are organized into an execution-preparation handoff packet, which Plan+Exec reads once afterward.

## 11. Contract-freeze card

1. When the Clarify provider session produces a sufficiently clear task-contract draft, Thoth displays a contract-freeze card.
2. The contract-freeze card is a mandatory confirmation before a formal task enters execution.
3. The contract-freeze card does not require the user to complete a full form.
4. It confirms only the goal, boundaries, acceptance, risks, and key default policies.
5. The card contains:
   - the goal as understood by Thoth
   - what is explicitly not to be done
   - key constraints
   - the acceptance method
   - major risks
   - the handling approach Thoth will use by default
   - whether human acceptance is involved
6. The user can click Confirm.
7. The user can also click Edit to have Thoth return to clarification.
8. After the user confirms, the task draft becomes a ready task.
9. The ready task enters the queue and waits for execution.
10. After the user confirms the contract, Thoth no longer repeatedly pushes ordinary clarification questions to the user.
11. If the provider later raises another clarification-type question during Plan+Exec, Thoth answers it automatically by default according to the contract and recommended preferences, and marks this in the task record.
12. If the provider later requests high-risk permission, Thoth still displays a permission card and cannot bypass it with an automatic answer.

## 12. The task enters asynchronous execution

1. After confirming the contract-freeze card, the user does not need to watch the task.
2. Thoth places the task in the execution queue for that workspace.
3. If no execution task is currently writing to the workspace, Thoth starts execution.
4. If a write execution task is already running, the new task waits in the queue.
5. Once execution begins, the user can see the provider's output, tool events, plan progress, execution progress, and permission requests in real time.
6. Plan and Execute appear to the user as one continuous execution process.
7. If the provider supports native plan mode, the user sees the provider's own plan-mode flow rather than a planner fabricated by Thoth.
8. The user can close the window.
9. The user can check progress on the mobile app.
10. The user can continue clarifying the next task in the same workspace.
11. The user can open task details at any time to view the current status.
12. Loop intensity applies only when Mode = `Loop`; when Mode = `Quick`, it is displayed as grayed out and unavailable.
13. Loop options:

- `auto`: A provider-backed session determines the loop strategy based on task risk, failure mode, and cost.
- `One Plan, One Do`: Perform only one Plan+Exec and one Review; block and report directly if it fails.
- `light`: Make a small amount of automatic progress, block and report sooner, and reduce automatic consumption.
- `balanced`: The default limited-retry mode; each round must address the issues left unresolved by the previous round.
- `Run Until Stopped`: A red, high-consumption mode that continues progressing until the user manually stops it.

14. `Run Until Stopped` is not unlimited authorization; it remains controlled by provider availability, permission policy, safety hard stops, resource limits, and manual user termination.
15. Regardless of loop intensity, every loop round must explain what the previous round did not resolve and how the current round is advancing specifically against that issue.

## 13. Task list and queue

1. Each workspace has its own task list.
2. Task status is displayed in plain language, for example:
   - Awaiting your confirmation
   - Queued
   - Processing
   - Checking
   - Your approval is needed
   - Not passed; awaiting a decision
   - Completed
3. The default view displays a summary:
   - task title
   - current status
   - next step
   - whether user action is needed
   - most recent update time
4. The user can expand task details.
5. After expansion, the user can see:
   - phase progress
   - key evidence
   - diff summary
   - acceptance result
   - log entry point
   - final report
6. The user can manually adjust the queue order.

## 14. Write execution is serialized within a workspace; other stages can run in parallel

1. At any given time, only one execution task that can write project files may run in the same workspace.
2. This avoids conflicts caused by multiple tasks modifying the same project simultaneously.
3. The user can still simultaneously:
   - continue clarifying other task drafts
   - view existing task status
   - read reports
   - answer permission cards
   - ask about status in global chat
4. If another task is queued, the user can adjust its priority.
5. If the user opens another git worktree as an independent directory, Thoth treats it as another workspace.

## 15. Permission / approval cards

1. Low-risk, in-workspace, clearly bounded reads, edits, and verification can proceed automatically.
2. High-risk operations must interrupt and ask the user to confirm.
3. Operations requiring confirmation include:
   - writing outside the workspace
   - deleting or overwriting important files
   - moving files at large scale
   - installing dependencies
   - publishing online
   - reading or writing secrets
   - git push
   - long-running or high-cost tasks
4. A permission card must explain:
   - what Thoth wants to do
   - why it is needed
   - the scope of impact
   - what will happen if it is not approved
5. In the default mode, the user decides only on the current risk point each time.
6. The MVP does not remember “always allow.”
7. The user can enable full access / trusted mode in the App or CLI.
8. In full access / trusted mode, high-risk operations do not display approval cards.
9. Even when approval is skipped, Thoth still records the operation, scope, evidence, and result.
10. If the user turns off full access, subsequent high-risk operations return to displaying approval cards.

## 16. Automatic commit after checks pass

1. After execution finishes, Thoth enters the checking stage.
2. After checks pass, Thoth automatically commits by default.
3. The commit contains only the diff generated by Thoth for that task.
4. Write execution for formal tasks takes place by default in a Thoth-created branch or worktree.
5. The commit occurs in the task branch or task worktree.
6. Thoth does not push automatically.
7. git push is a high-risk operation that requires approval or full access / trusted mode.
8. If the workspace already had the user's uncommitted changes before the task began, Thoth records the baseline.
9. If the diff generated by Thoth does not conflict with the user's original changes, Thoth commits only the portion it generated.
10. If a same-file or same-hunk conflict occurs, Thoth pauses and displays a card asking the user to decide how to handle it.
11. After completion, the task report displays the commit summary and acceptance result.

## 17. Limited automatic correction after Review failure and final blocking report

1. When checks find a problem, the reviewer does not modify the code directly.
2. Independent Review does not merely check “whether it passed”; it also proactively challenges whether this round of execution is solving the right problem.
3. If the current route is making local progress but is fundamentally wrong, Review requires the next round to abandon that route, replan, or return to Clarify when necessary; it does not continue piling on small fixes merely to preserve continuity.
4. Thoth organizes Review's directional judgment into the working direction for the next Plan+Exec: the true crux, actions that should stop, understandings that should change, and the next highest-leverage step.
5. The user sees this understandable review conclusion and next step, without needing to manage phases, rounds, failure counts, budgets, receipts, or manifests.
6. The daemon decides in the background whether another round is still allowed; its loop intensity and resource boundaries do not change Review's judgment and do not require Review to relax its conclusion to save a round.
7. If the next round has no new direction or methodological change, Thoth does not retry mechanically.
8. If Review determines that the evidence is insufficient, the next round first obtains real-world evidence capable of changing the conclusion; if it determines that the direction is wrong, the next round re-understands the problem instead of continuing to pile on small fixes; if it determines that implementation quality is the core obstacle, the next round focuses on changing the critical path.
9. When the daemon's control boundary does not allow continuation, or a genuine external blocker exists, the task enters a blocked/waiting state.
10. Thoth reports to the user:

- whether the goal was partially completed
- the specific reason it did not pass
- the retained diff and evidence
- the recommended next step
- whether the user needs to grant further authorization

## 18. Manual acceptance experience when there is no automatic acceptance checker

1. Some tasks cannot be fully judged as successful using automatic commands.
2. Examples include product copy, visual experience, strategy design, and user-perception tasks.
3. These tasks can still be registered as formal tasks.
4. The contract-freeze card explicitly marks manual acceptance items.
5. The checking stage checks:
   - whether the agreed artifact was completed
   - whether the constraints were followed
   - whether sufficient explanation and risks were provided
   - whether final user confirmation is needed
6. A task is not automatically declared to have passed manual acceptance merely because the AI considers itself satisfied.
7. The user sees a manual acceptance card.
8. The user can choose to pass it, request changes, or terminate it.

## 19. Single-workspace TUI experience

1. The user starts the TUI in a project directory.
2. The TUI is limited to the current workspace.
3. The TUI has no global home.
4. If the current directory is not yet a Thoth workspace, the TUI displays a confirmation card containing:
   - whether to add the current directory as a workspace
   - the current path
   - the current git status
5. After confirmation, the user enters the workspace console.
6. The TUI supports:
   - workspace chat
   - starting `Quick`
   - creating a `Loop` task
   - answering clarification cards
   - confirming contract-freeze cards
   - viewing the task queue
   - viewing execution progress
   - approving permission cards
   - reading reports
   - viewing provider health status
7. The TUI's state is consistent with the state of the same workspace in the desktop app.
8. The user does not need to care about other global workspaces in the TUI.

## 20. Remote synchronization experience in the mobile app

1. The user opens the pairing entry point in the desktop app.
2. The desktop app displays a QR code.
3. The user scans the code with the mobile app.
4. After pairing succeeds, the mobile side displays the connected local Thoth service.
5. The mobile side can display:
   - the workspace list
   - the task list
   - current status
   - cards awaiting confirmation
   - recent reports
6. The mobile side can start `Quick` or `Loop` for an existing workspace.
7. The mobile side can answer clarification questions.
8. The mobile side can approve permissions and decision cards.
9. The mobile side can view the final report.
10. The mobile side does not provide the ability to select a local folder directly.
11. The mobile side does not perform heavy code-diff editing.
12. The mobile side does not provide a full IDE experience.

## 21. Offline state

1. If the mobile side cannot connect to the local Thoth service, it displays an offline marker.
2. While offline, the mobile side displays the most recently cached read-only state.
3. While offline, the user cannot send new tasks.
4. While offline, the user cannot approve permission cards.
5. While offline, the user cannot confirm contract-freeze cards.
6. After reconnecting, the mobile side automatically fills in the history.
7. After synchronization, the user sees the latest task status and pending cards.

## 22. CLI, Claude, Codex, and ACP entry points

1. The CLI is an advanced entry point for the current workspace's status, `Quick`, `Loop`, and diagnostics.
2. The Claude entry point can pass user messages to the same Thoth authority.
3. The Codex entry point can pass user messages to the same Thoth authority.
4. The ACP entry point supports ACP-compatible harnesses.
5. These entry points do not own independent task semantics.
6. The same `Quick` or `Loop` has the same state in these entry points, the desktop app, the mobile app, and the TUI.
7. Relay is responsible only for remote encrypted connections and synchronization; it does not change the task lifecycle.

## 23. Minimal Quick usage path

1. The user opens the desktop app, mobile app, TUI, CLI, Claude, Codex, or ACP entry point.
2. The user enters a clear short action, for example:

   ```text
   Please run git commit for me.
   ```

3. The user selects `Quick` in the composer; from a non-desktop entry point, the equivalent parameter is `quick`.
4. If Clarify is `Don't Bother Me`, Thoth enters provider harness runtime passthrough directly.
5. If Clarify is not `Don't Bother Me`, Thoth first uses a read-only Clarify provider session to handle necessary context.
6. Thoth performs workspace and git preflight.
7. If approval is needed and full access / trusted mode is not enabled, Thoth displays a permission card.
8. After the user approves, Thoth performs the operation.
9. If full access / trusted mode is enabled, Thoth performs the operation directly.
10. The user sees the provider output displayed in real-time streaming.
11. Thoth records the timeline, evidence, and final result.
12. The user sees the same result from any entry point.

## 24. Minimal Loop usage path

1. The user opens the desktop app.
2. The user completes provider setup.
3. The user adds a workspace.
4. The user enters the workspace page.
5. The user sets the task mode to `Loop` and enters a natural-language request.
6. Thoth handles the input through the formal task path.
7. Thoth creates a task draft.
8. Thoth uses balanced clarification cards to ask key questions.
9. The user answers.
10. Thoth displays a contract-freeze card.
11. The user confirms.
12. The task enters the queue.
13. Thoth creates a Plan+Exec provider session and feeds it the frozen contract and clarification handoff packet once.
14. The Provider completes planning and execution using its own plan mode, with output displayed in real-time streaming.
15. If an ordinary clarification question occurs during Plan+Exec, Thoth answers and records it automatically according to the contract or recommended preferences.
16. If Plan+Exec encounters a high-risk permission request, Thoth requests approval.
17. The user approves it on the desktop or mobile side.
18. After Thoth completes Plan+Exec, it starts an independent Review session.
19. Review independently challenges the current route; it passes only after confirming that the goal has genuinely been completed, and gives the next highest-leverage direction if it finds a direction problem.
20. Thoth automatically commits the diff generated by the current task in the task branch or task worktree.
21. Thoth outputs the final report.
22. The user sees the same task completed in the desktop app, mobile app, or TUI.
