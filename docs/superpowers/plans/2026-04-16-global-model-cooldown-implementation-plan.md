# Global Model Cooldown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist global provider/model cooldowns for 2 hours after retryable limit failures, skip cooled candidates during selection, and stop with operator guidance when no eligible models remain.

**Architecture:** Add a new global cooldown registry module under the runner, filter provider ranking through that registry before selection/fallback, and surface a clear stop condition when all configured models are cooled down or unavailable.

**Tech Stack:** TypeScript, Jest, Node fs/promises, existing provider-registry and runner logic

---

### Task 1: Add failing cooldown tests

**Files:**
- Create: `src/runner/__tests__/model-cooldowns.test.ts`
- Modify: `src/engine/__tests__/provider-registry.test.ts`
- Modify: `src/runner/__tests__/runner-provider-failover.test.ts`

- [ ] Add a test for saving/loading a global cooldown entry.
- [ ] Add a test proving expired cooldowns are ignored/pruned.
- [ ] Add a provider-registry test proving cooled candidates are skipped before selection.
- [ ] Add a runner test proving a retryable limit failure records a cooldown and falls through to the next candidate.
- [ ] Add a runner test proving “no eligible providers remain” stops the run with a clear message.

### Task 2: Implement cooldown registry

**Files:**
- Create: `src/runner/model-cooldowns.ts`
- Test: `src/runner/__tests__/model-cooldowns.test.ts`

- [ ] Implement a global registry path under the user profile.
- [ ] Implement load/save/prune helpers.
- [ ] Implement `isSelectionCooledDown()` and `recordCooldown()` using a default 2-hour duration.

### Task 3: Filter provider selection

**Files:**
- Modify: `src/engine/provider-registry.ts`
- Test: `src/engine/__tests__/provider-registry.test.ts`

- [ ] Extend ranking helpers to support excluding cooled-down `provider+model` pairs.
- [ ] Add a selection API that returns eligible ranked candidates after cooldown filtering.
- [ ] Preserve existing scoring behavior for non-cooled candidates.

### Task 4: Wire cooldown behavior into runner

**Files:**
- Modify: `src/runner/runner.ts`
- Test: `src/runner/__tests__/runner-provider-failover.test.ts`

- [ ] Load the global cooldown registry at run start.
- [ ] Log skip messages for cooled-down candidates.
- [ ] Build the provider chain only from eligible candidates.
- [ ] On retryable limit failure, record cooldown for the exact failed `provider+model`.
- [ ] If no eligible candidates remain, stop with guidance for adding more providers/models.

### Task 5: Verify and ship

**Files:**
- Modify: `docs/superpowers/plans/2026-04-16-global-model-cooldown-implementation-plan.md`

- [ ] Run: `npm test -- --runInBand --testPathPattern="(model-cooldowns|provider-registry|runner-provider-failover)"`
- [ ] Run: `npm run typecheck`
- [ ] Run: `npm run build`
- [ ] Commit with a focused message.
- [ ] Relink the global install if verification passes.
