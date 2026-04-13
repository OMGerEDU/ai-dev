/**
 * aidev.hooks.mjs — project hooks for aidev-core self-improvement
 *
 * Plain ES module, loaded automatically by `aidev run` without a build step.
 * Extends the engine's DefaultHooks behavior with rules specific to
 * self-modification: safety gates, branch warnings, task caps.
 *
 * @type {import('../dist/hooks/contract.js').HookContract}
 */
export default {

  // ── Task guidance ────────────────────────────────────────────────────────────

  buildTaskGuidance(task, selection) {
    const routing = [
      '### Routing',
      `- Provider: ${selection.provider} (${selection.cli})`,
      `- Model:    ${selection.model} [tier: ${selection.tier}]`,
      `- Reason:   ${selection.reason}`,
    ].join('\n');

    const safety = `
### Self-modification safety rules
- Run \`npm run typecheck\` after EVERY file edit. If it fails, fix it before continuing.
- Never rename or remove exports from \`src/engine/index.ts\` without updating all callers in the same commit.
- \`HookContract\` is a public API — changes must be backward-compatible.
- \`TaskOutputSchema\` fields must not be renamed or removed.
- Add tests alongside source files in \`src/**/__tests__/\`.
- Prefer editing existing files over creating new ones.
- Only set \`milestoneAdvanced: true\` if the milestone's verifyCmd would pass right now.
- Keep \`zod\` as the only runtime dependency — do not add others without explicit approval.`;

    const tags = task.tags ?? [];

    if (tags.includes('research')) {
      return routing + safety + `

### Research guidance
- Write findings to \`.aidev/research/<topic>.md\` — do NOT modify source files.
- Include: current state, gaps found, recommended next action, key references.
- Produce a TaskOutput JSON block at the end with \`milestoneAdvanced: false\` (research doesn't advance milestones).`;
    }

    if (tags.includes('implementation') || tags.includes('qa') || tags.includes('automation')) {
      return routing + safety + `

### Implementation guidance
- Make the smallest change that satisfies the acceptance criteria.
- Run typecheck after each file touched.
- Produce a TaskOutput JSON block at the end of your response:
\`\`\`json
{ "milestoneAdvanced": true|false, "testsResult": "pass|fail|skipped|not-run",
  "confidence": "high|medium|low", "artifactsProduced": [], "commandsRun": [], "blockers": [], "notes": "..." }
\`\`\``;
    }

    return routing + safety;
  },

  // ── Continuation cap ─────────────────────────────────────────────────────────

  filterContinuations(specs, _context) {
    // Cap at 3 continuations per task — prevents runaway task explosion
    // during self-improvement cycles where each milestone is small.
    return specs.slice(0, 3);
  },

  // ── Branch safety warning ─────────────────────────────────────────────────

  beforeTask(context) {
    if (context.branchName === 'main') {
      context = {
        ...context,
        prompt: `⚠  WARNING: You are on the main branch of aidev-core.\n` +
                `For any structural change (new interface, renamed file, new milestone), ` +
                `create a feature branch first: git checkout -b feat/<short-description>\n\n` +
                context.prompt,
      };
    }
    return context;
  },

  // ── After-run summary ────────────────────────────────────────────────────────

  afterRun(context) {
    console.log(`[aidev-core] Run complete — ${context.processed} tasks processed`);
    if (context.processed === 0) {
      console.log('[aidev-core] Tip: run `aidev status` to see milestone state, or check .aidev/tasks/ for open tasks.');
    }
  },
};
