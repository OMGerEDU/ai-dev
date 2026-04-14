# Goal

Give aidev two transformational capabilities: (1) a pluggable skill ecosystem so the engine can acquire new tools — npm packages, MCP servers, git-sourced scripts — without touching core code, and (2) a zero-human-interaction loop that runs fully autonomously and only surfaces once, when everything is done, with a structured report + next-goal proposal that the human can answer to start a new cycle.

## Success criteria

- SkillEntry type and loadSkills() defined — reads .aidev/skills.json, returns typed SkillEntry[]: `npm run typecheck`
- ensureSkillsInstalled() installs missing npm skills and validates MCP/git sources — covered by tests: `npm test -- --testPathPattern=skills`
- Skills injected into task prompts — buildPrompt includes an "## Available Skills" section when skills are loaded: `npm test -- --testPathPattern=skills`
- TaskOutputSchema extended with optional skillsRequested[] — runner installs requested skills before the next task: `npm run typecheck && npm test -- --testPathPattern=task-output`
- RunReport type and buildRunReport() defined — compiles milestones, artifacts, test results, duration into a structured summary: `npm run typecheck && npm test -- --testPathPattern=run-report`
- afterRun hook posts end-of-cycle report — when isComplete, writes report.md and posts ClickUp comment with summary + suggested next steps: `npm run typecheck`
- suggestNextGoal() calls AI to draft a new goal.md — output written to next-goal.md with a structured proposal section: `npm run typecheck`
- Human reply triggers new cycle — runner checks next-goal.md for approved content; if approved, swaps goal.md, resets milestones, and restarts loop: `npm test -- --testPathPattern=goal-cycle`
- All existing exports preserved and tests still pass (no regressions): `npm run typecheck && npm test`

## Constraints

- Never remove or rename symbols exported from `src/engine/index.ts` without updating every caller in the same commit
- `HookContract` is a public API — all changes must be backward-compatible
- `TaskOutputSchema` fields must not be renamed or removed; only additions are allowed
- `SkillEntry` type must support all three source types: npm, mcp, git — do not hard-code one
- Skills are additive — the engine must work identically when `.aidev/skills.json` is absent
- End-of-cycle report is fire-and-forget — it must never block or throw; failures are logged and swallowed
- `suggestNextGoal()` may call AI but must not block the run loop — run it async after afterRun returns
- Human reply parsing is file-based (`.aidev/next-goal.md`) — no polling external services in the core engine
- Do not add runtime dependencies beyond zod without a documented reason in the PR

## Out of scope

- Publishing skills to a public npm registry
- A UI for browsing or installing skills
- Real-time collaboration / multi-agent coordination
- Slack / email / webhook notifications (board comment is sufficient)
- Automatic PR creation from next-cycle milestones
