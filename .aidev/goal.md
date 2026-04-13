# Goal

Make aidev a provably correct, extensible engine: full test coverage on the confidence governor and provider scorer, a LinearBoard implementation, and a pluggable memory adapter interface — so the engine self-validates and can be extended without touching core code.

## Success criteria

- Test infrastructure wired: `npm test`
- Milestone engine covered — confidence governor, verifyCmd runner, escalation path: `npm test -- --testPathPattern=milestone-engine`
- Provider registry covered — scoring algorithm, tier derivation, read-only downtiering, explicit tag override: `npm test -- --testPathPattern=provider-registry`
- LocalBoard covered — create/fetch/updateStatus/markStart round-trip: `npm test -- --testPathPattern=local-board`
- LinearBoard implemented and registered in resolveBoard: `npm run typecheck`
- Memory adapter interface extracted — MemoryAdapter interface, LocalMemory satisfies it: `npm run typecheck && npm test`
- All existing exports preserved (no breaking changes): `npm run typecheck`

## Constraints

- Never remove or rename symbols exported from `src/engine/index.ts` without updating every caller in the same commit
- `HookContract` is a public API — all changes must be backward-compatible with existing implementors
- `TaskOutputSchema` fields must not be renamed or removed (existing validators break)
- Every milestone's verifyCmd must pass before setting `milestoneAdvanced: true`
- Structural changes (new interfaces, renamed files) go on a feature branch, not main
- Do not add runtime dependencies without explicit approval — keep the engine dependency-light (zod is the only one)

## Out of scope

- Publishing to npm registry
- Multi-repo orchestration
- UI dashboard / web interface
- Direct LangGraph or Mem0 runtime integration (research and design only this cycle)
- ClickUp hook changes (different project)
