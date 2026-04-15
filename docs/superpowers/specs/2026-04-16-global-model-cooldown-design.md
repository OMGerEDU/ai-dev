# Global Model Cooldown Design

## Goal

Make provider/model selection smarter so aidev avoids models that recently hit usage limits, prefers the next eligible model automatically, and stops with clear operator guidance when no eligible models remain.

## Problem

Today aidev only reacts after a selected provider fails. That means:

- a limited model can still be chosen repeatedly at the start of many runs
- the engine wastes attempts and time on providers already known to be unavailable
- fallback selection is reactive instead of proactive
- when every configured model is effectively unavailable, the runner does not give a strong operational message about what to do next

This is especially painful overnight or during quota windows where the user already knows a model is unavailable for hours.

## User Requirements

- cooldowns are global across all projects, not per-project
- cooldowns apply to all models/providers
- default cooldown duration is 2 hours
- if a model is known to be cooled down, aidev should skip it before selection
- if all configured models are cooled down or unavailable, aidev should stop completely
- stop message should explain how to add more models/providers

## Design

### 1. Global cooldown registry

Store global cooldown state in the user profile, outside any project, for example:

`%USERPROFILE%/.aidev/model-cooldowns.json`

Each entry is keyed by provider+model and contains:

- `provider`
- `model`
- `cooldownUntil`
- `reason`
- `lastSeenAt`

Example:

```json
{
  "entries": [
    {
      "provider": "claude",
      "model": "claude-sonnet-4-6",
      "cooldownUntil": "2026-04-16T02:40:00.000Z",
      "reason": "rate_limit",
      "lastSeenAt": "2026-04-16T00:40:11.000Z"
    }
  ]
}
```

Expired entries are ignored and should be cleaned opportunistically on load/save.

### 2. Selection filtering

Provider ranking should happen in two stages:

1. rank configured and available providers as today
2. filter out candidates whose `provider+model` are still under cooldown

This means a cooled-down model is never selected in the first place.

If multiple models remain, aidev uses the next ranked candidate automatically.

### 3. Cooldown recording

When aidev detects a retryable usage failure such as quota/rate limit/too many requests, it should:

- record a global cooldown for the exact selected `provider+model`
- set `cooldownUntil = now + 2 hours`
- continue selection/fallback against remaining non-cooled candidates

This turns one observed failure into future avoided waste across all projects.

### 4. Exhaustion behavior

If, after applying availability rules and cooldown filtering, no candidates remain:

- do not run the task
- stop the run cleanly
- print a clear operational message explaining:
  - all configured models are currently unavailable or cooled down
  - where cooldown state is stored
  - how to add or enable more providers via `.env.aidev` / `.aidev/providers.json`
  - example: `AGENTS=claude,codex,antigravity`

This should be a scheduler stop, not a task failure continuation.

### 5. Logging

Each run should emit short, operator-friendly skip lines for cooled candidates, for example:

`[aidev] Skipping claude/claude-sonnet-4-6 until 2026-04-16 02:40 (cooldown active).`

This keeps model choice explainable.

## Scope Boundaries

In scope:

- global cooldown persistence
- selection-time filtering
- cooldown creation on retryable provider-limit failures
- graceful hard stop when nothing remains
- tests for filtering, cooldown recording, and exhaustion message

Out of scope:

- parsing provider-specific reset timestamps
- configurable cooldown durations
- UI/dashboard cooldown management
- automatic removal of providers from project config

## Architecture Changes

### `src/engine/provider-registry.ts`

- extend ranking/selection to accept cooldown state
- add helper for “rank eligible providers”
- distinguish “configured but cooled down” from “configured but unavailable”

### `src/runner/runner.ts`

- load cooldown registry before provider selection
- build provider chain from eligible candidates only
- record cooldowns when retryable limit failures happen
- stop with a clear message if no eligible providers exist

### New module

`src/runner/model-cooldowns.ts`

Responsibilities:

- load/save global cooldown file
- normalize key by `provider+model`
- test whether a selection is cooled down
- record default 2-hour cooldown
- prune expired entries

## Testing Strategy

- unit tests for cooldown load/save/prune behavior
- provider-registry tests proving cooled candidates are skipped
- runner tests proving:
  - a rate-limited provider enters cooldown
  - the next eligible provider is selected
  - all-cooled/all-unavailable state stops with guidance

## Expected Outcome

After this change, aidev should stop “bouncing” into obviously unavailable models. If Claude hits a quota wall at 00:40, aidev should globally remember that and move directly to the next eligible model until the 2-hour cooldown expires. If nothing is left, the run should stop immediately with a useful operator message rather than wasting attempts.
