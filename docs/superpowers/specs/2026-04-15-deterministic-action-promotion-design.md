# Deterministic Action Promotion Design

## Goal

Reduce token waste in `aidev-core` by moving safe, repeatable, deterministic work out of the model loop and into engine-owned actions, while keeping risky write operations behind explicit policy gates.

## Summary

`aidev-core` already owns some deterministic work such as milestone verification, board updates, report writing, and skill installation. It does not yet own common repetitive git workflows or a mechanism for identifying and reusing deterministic task patterns across runs and across projects.

This design adds a deterministic execution layer that sits between the runner and the model. The runner will first attempt to map a task to a built-in deterministic action or a globally promoted validated action. If a match exists and policy allows it, the engine executes the action directly and records the result without sending the task to Claude, Codex, or another model. If not, the task proceeds through the normal model path. The model may still suggest new deterministic candidates, but those candidates must be validated and promoted by the engine before they can be reused.

The chosen policy model is:

- balanced rollout
- hybrid sourcing: built-in actions first, model-suggested candidates second
- policy-gated git write actions
- global shared deterministic action library

## Non-Goals

- auto-promoting arbitrary shell snippets directly from model output
- full PR creation/comment automation in the first iteration
- replacing all model work with engine work
- a UI for managing deterministic actions in the first iteration

## Requirements

### Functional requirements

1. The runner must check for deterministic action matches before invoking a model.
2. `aidev-core` must ship built-in deterministic actions for:
   - `git.status`
   - `git.add`
   - `git.commit`
   - `git.push`
   - board status/comment/update operations already owned by code
3. Git write actions must be policy-gated per project.
4. The model may propose deterministic candidates, but the engine must validate them before reuse.
5. Promoted actions must be reusable across projects through a global registry.
6. The runner must record whether a task was handled by a model or by a deterministic action.
7. Policy-denied actions must never execute and must produce structured audit information.

### Safety requirements

1. The engine must never execute raw promoted shell text.
2. All deterministic actions must use typed inputs and action-specific executors.
3. Git write actions must check preconditions before side effects.
4. Repeatedly failing promoted actions must be demoted or disabled automatically.
5. A project must be able to disable deterministic actions entirely.

## Architecture

The feature introduces a deterministic execution subsystem with five units.

### 1. Deterministic catalog

This module defines built-in engine actions and their schemas.

Examples:

- `git.status`
- `git.add`
- `git.commit`
- `git.push`
- `board.post_comment`
- `board.update_status`

Each action definition includes:

- stable `actionId`
- `riskClass`
- typed input schema
- precondition check function
- executor function
- reusable match metadata

The catalog is the first source of truth. If a task can be satisfied by a built-in action, the engine should prefer that path over model invocation.

### 2. Deterministic policy

This module decides whether an action is allowed in the current project.

Policy evaluation uses:

- project config
- action risk class
- current execution mode
- global engine flag

Initial project policy levels:

- `off`: disable deterministic execution except internal read-only engine behavior already present
- `safe`: allow read-only deterministic actions only
- `git-write`: allow `git.status`, `git.add`, `git.commit`, and `git.push`

Recommended initial project configuration:

```json
{
  "deterministicActions": {
    "mode": "safe",
    "allowGitWrite": false,
    "allowPromotion": false,
    "allowGlobalPromotedActions": true
  }
}
```

A project must explicitly opt in before `git.add`, `git.commit`, or `git.push` can run.

### 3. Deterministic candidate registry

This module stores model-suggested deterministic action candidates in a global registry, outside any one project.

Candidate lifecycle:

- `proposed`
- `validated`
- `promoted`
- `rejected`
- `disabled`

Candidates are not raw shell strings. They are normalized action intents with typed payloads and a reference to a trusted executor family.

Examples:

- `git.commit` with `{ messageTemplate: "feat: {summary}" }`
- `git.push` with `{ remote: "origin", branchStrategy: "current" }`

The registry also stores:

- first seen timestamp
- source provider
- success count
- failure count
- last failure reason
- promotion decision timestamp

### 4. Deterministic executor

This module runs typed actions directly.

Responsibilities:

- validate typed inputs
- run precondition checks
- execute action-specific logic
- capture stdout/stderr summaries
- return structured success/failure objects
- avoid repeated blind retries

Example structured result:

```json
{
  "handledBy": "deterministic",
  "actionId": "git.commit",
  "success": true,
  "commandsRun": [
    { "cmd": "git commit -m \"feat: add X\"", "exitCode": 0, "passed": true }
  ],
  "notes": "Committed tracked changes on current branch"
}
```

### 5. Runner integration

The runner flow becomes:

1. Load task
2. Attempt deterministic match against built-in catalog
3. Attempt deterministic match against promoted global actions
4. Apply policy evaluation
5. If allowed and matched, execute deterministically
6. Otherwise call model as normal
7. If model returns a deterministic candidate, validate and record it for future promotion

This keeps the model as the fallback, not the default, for known deterministic work.

## Matching Model

Deterministic reuse must be based on normalized intent, not prompt wording.

The first iteration should use explicit matching only:

- task tags
- task lane
- exact built-in action tags
- structured model-suggested candidate payloads

Examples:

- a task tagged `git-status` maps to `git.status`
- a task tagged `publish-branch` may map to `git.push` if policy allows
- a model can propose:

```json
{
  "deterministicCandidate": {
    "actionId": "git.commit",
    "inputs": {
      "message": "feat: {taskTitle}"
    }
  }
}
```

The engine validates that:

- `git.commit` is a known trusted action family
- inputs match schema
- action risk is allowed by project policy
- candidate has enough evidence to remain stored

Later iterations can add richer intent matching, but the first version should stay explicit and typed.

## Git Action Behavior

### `git.status`

- always read-only
- safe to run in `safe` mode
- returns concise structured repo status

### `git.add`

Allowed only when:

- project policy enables git write actions
- target path set is explicit or well-defined
- no precondition failure exists

### `git.commit`

Allowed only when:

- git write policy enabled
- repo has staged changes
- commit message is non-empty and schema-valid

The executor should never invent a commit message itself. It may accept a typed message payload or a message template supplied by a deterministic candidate or task metadata.

### `git.push`

Allowed only when:

- git write policy enabled
- current branch is known
- remote exists
- working tree is in an acceptable state
- the previous git step did not fail

`git.push` should not implicitly create PRs in the first iteration.

## Candidate Promotion Rules

Promotion should be intentionally strict.

### Built-in actions

- available immediately
- do not require promotion

### Model-suggested candidates

1. candidate is proposed by model in structured output
2. engine validates that candidate refers to a trusted action family
3. candidate is stored as `proposed`
4. candidate is eligible for promotion only after:
   - schema validation passes
   - at least one successful execution is recorded
   - failure rate remains below threshold
5. engine upgrades state to `promoted`
6. future matching may reuse the promoted candidate directly

### Demotion and disablement

If a promoted candidate fails repeatedly:

- first failures move it back to `validated`
- repeated failures move it to `disabled`
- the engine logs demotion reason and stops auto-using it

## Persistence

Global deterministic actions should live in a dedicated global file, separate from project memory.

Recommended path:

- `%USERPROFILE%\\.aidev\\deterministic-actions.json` on Windows

Project policy should live in the project's `.aidev/` configuration area.

Recommended file:

- `.aidev/deterministic-actions.json`

This project file stores:

- mode
- git-write opt-in
- promotion enablement
- project-level allow/deny overrides

## Reporting and Observability

The engine must make token savings and routing behavior visible.

Add structured fields to task outcomes and run reports:

- `handledBy: "deterministic" | "model"`
- `actionId`
- `actionSource: "built-in" | "promoted"`
- `policyDecision: "allowed" | "denied" | "not-matched"`
- `providerSkipped`

Later, `aidev` can add a rough estimated `tokensSaved` field, but that is optional in the first version.

## Error Handling

### Policy denial

- do not execute the action
- log structured denial
- either fall back to the model or mark review depending on action type

### Precondition failure

- do not execute side effects
- return structured failure
- fall back to model only if the failure is resolvable by non-deterministic reasoning

### Execution failure

- capture concise stdout/stderr evidence
- avoid repeated blind retries
- increment candidate failure counters if action came from promoted registry

## Rollout Plan

### Phase 1

- deterministic action framework
- built-in actions only
- policy engine
- git read/write built-ins
- runner short-circuit before model call

### Phase 2

- structured model-suggested deterministic candidates
- global candidate registry
- observe-and-validate mode

### Phase 3

- promotion/demotion flow
- auto-reuse of promoted actions
- run report attribution for deterministic execution

## Testing Strategy

### Unit tests

- action schema validation
- policy gating
- git precondition checks
- git arg building
- candidate lifecycle transitions
- demotion/disablement thresholds

### Integration tests

- built-in deterministic action bypasses model call
- policy-denied git action does not execute
- proposed candidate is recorded but not promoted immediately
- promoted action is reused on a later task
- deterministic result is recorded in memory and reporting

## Open Questions Resolved

- policy stance: balanced
- deterministic source: hybrid
- git writes allowed after explicit project opt-in
- storage location: global shared registry

## Recommendation

Implement the feature in this order:

1. built-in deterministic action framework
2. policy-gated git built-ins
3. runner short-circuit path
4. structured candidate capture
5. promotion/demotion and global reuse

This order delivers token savings early while keeping the risky parts behind validation and policy controls.
