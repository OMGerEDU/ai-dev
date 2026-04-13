/**
 * DefaultHooks — a complete, working implementation of HookContract.
 *
 * Projects extend this class and override only what they need.
 * This is intentionally everything a project without any custom hooks gets.
 */

import { resolveBoard } from '../boards/index.js';
import { probeProject } from '../engine/project-probe.js';
import { loadGoal, loadMilestones, measureProgress } from '../engine/goal-engine.js';
import { formatMilestoneStatus } from '../engine/milestone-engine.js';
import type { HookContract, RunContext, TaskContext, TaskResultContext, ConflictContext } from './contract.js';
import type { TaskBoard } from '../boards/board.js';
import type { AidevTask, ContinuationSpec } from '../engine/types.js';
import type { ProviderSelection } from '../engine/provider-registry.js';

export class DefaultHooks implements HookContract {

  // ── Board ──────────────────────────────────────────────────────────────────

  createBoard(context: RunContext): TaskBoard {
    return resolveBoard(context.projectRoot, context.config);
  }

  // ── Context building ───────────────────────────────────────────────────────

  async buildProjectContext(context: RunContext): Promise<string> {
    const [probed, goal, milestones] = await Promise.all([
      probeProject(context.projectRoot).catch(() => null),
      loadGoal(context.projectRoot),
      loadMilestones(context.projectRoot),
    ]);

    const lines: string[] = [];

    if (probed) {
      lines.push(probed.formatted);
    }

    if (goal) {
      lines.push('', `## Current goal: ${goal.title}`, goal.description);
      if (goal.constraints.length) {
        lines.push('', '### Constraints', ...goal.constraints.map((c) => `- ${c}`));
      }
    }

    if (milestones.length) {
      const progress = measureProgress(milestones);
      lines.push(
        '',
        `## Milestone progress: ${progress.done}/${progress.total} (${progress.percentComplete}%)`,
        formatMilestoneStatus(milestones),
      );
      if (progress.nextMilestone) {
        lines.push('', `**Next milestone:** [${progress.nextMilestone.id}] ${progress.nextMilestone.title}`);
      }
    }

    return lines.join('\n').trim();
  }

  buildTaskGuidance(_task: AidevTask, selection: ProviderSelection): string {
    return [
      '### Routing',
      `- Provider: ${selection.provider} (${selection.cli})`,
      `- Model: ${selection.model} [${selection.tier}]`,
      `- Reason: ${selection.reason}`,
    ].join('\n');
  }

  // ── Continuations ──────────────────────────────────────────────────────────

  filterContinuations(specs: ContinuationSpec[], _context: TaskResultContext): ContinuationSpec[] {
    // Default: pass through unchanged
    return specs;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  beforeRun(_context: RunContext): void {
    // No-op by default
  }

  beforeTask(context: TaskContext): TaskContext {
    return context;
  }

  afterTask(_context: TaskResultContext): void {
    // No-op by default
  }

  afterRun(_context: RunContext & { processed: number; skipped: number }): void {
    // No-op by default
  }

  beforeResolveConflicts(context: ConflictContext): ConflictContext {
    return context;
  }
}
