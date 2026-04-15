# Mission Dedupe And Fallback Loop Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate active missions by merging continuations into the existing task and stop provider/output failures from spawning infinite retry loops.

**Architecture:** Add a canonical mission identity layer in the runner so `Build:` and `Fix:` variants map to the same active mission. Extend board implementations with an append-update capability so merged continuations preserve history in the same task description, then stop the run on provider invocation or structured-output parsing failures.

**Tech Stack:** TypeScript, Jest, Node child process APIs, local markdown board, ClickUp API, Linear GraphQL API

---

### Task 1: Lock Regression Coverage

**Files:**
- Modify: `src/output/__tests__/task-output.test.ts`
- Modify: `src/runner/__tests__/runner-provider-failover.test.ts`

- [ ] Add a failing extractor test where Codex transcript output contains an invalid example JSON block before the final valid assistant JSON block.
- [ ] Add a failing runner test proving provider/output failures do not create duplicate follow-up tasks.
- [ ] Add a failing runner test proving `Build: X` and `Fix: X` upsert into the same active mission with appended updates.
- [ ] Run: `npm test -- --runInBand --testPathPattern="(runner-provider-failover|task-output)"`
- [ ] Confirm expected failures are from the new regression cases only.

### Task 2: Parse The Right Structured Output

**Files:**
- Modify: `src/output/task-output.ts`
- Test: `src/output/__tests__/task-output.test.ts`

- [ ] Update JSON extraction to prefer the last valid fenced JSON block instead of the first one.
- [ ] Add a balanced raw-object scan fallback so echoed transcript content does not poison parsing.
- [ ] Run the task-output test subset again and confirm extractor regressions pass.

### Task 3: Add Mission Identity + Upsert In Runner

**Files:**
- Modify: `src/runner/runner.ts`
- Modify: `src/engine/types.ts`
- Test: `src/runner/__tests__/runner-provider-failover.test.ts`

- [ ] Add canonical mission-key helpers that normalize prefixes like `Build:` and `Fix:` to the same mission identity.
- [ ] Deduplicate continuation specs in-memory before posting them to the board.
- [ ] Replace direct continuation creation with “find active mission or create” logic across normal continuations and board-vacuum creation.
- [ ] On match, append an update block, merge tags, and move the existing task to the relevant state.
- [ ] On provider invocation failure or invalid structured output, move the current task to review, append evidence, and stop the run without creating a continuation.
- [ ] Run the runner regression subset and confirm the loop/duplicate tests pass.

### Task 4: Extend Board APIs To Preserve History

**Files:**
- Modify: `src/boards/board.ts`
- Modify: `src/boards/local.ts`
- Modify: `src/boards/clickup.ts`
- Modify: `src/boards/linear.ts`
- Test: `src/boards/__tests__/local-board.test.ts`
- Test: `src/runner/__tests__/runner-provider-failover.test.ts`

- [ ] Add a board method for appending a structured update block into the task description/history.
- [ ] Implement local-board description append by rewriting the markdown body with a timestamped update section.
- [ ] Implement ClickUp and Linear update append by fetching the current description and writing back the appended history block, plus a comment when useful.
- [ ] Add/adjust tests to verify the same task id is preserved while updates are appended.

### Task 5: Verify, Commit, And Repoint Install

**Files:**
- Modify: `docs/superpowers/plans/2026-04-16-mission-dedupe-and-fallback-loop-fix.md`

- [ ] Run: `npm test -- --runInBand --testPathPattern="(runner-provider-failover|task-output|local-board)"`
- [ ] Run: `npm run typecheck`
- [ ] Run: `npm run build`
- [ ] Review `git diff --stat` to confirm the change stays focused on mission dedupe + fallback loop handling.
- [ ] Commit with a focused message.
- [ ] Rebuild/relink the global install if needed after verification.
