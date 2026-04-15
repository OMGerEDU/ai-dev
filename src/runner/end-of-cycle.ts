/**
 * End-of-cycle report — writes report.md and posts a board comment when
 * all milestones are complete.
 *
 * All public functions are fire-and-forget: they catch and log every
 * error internally and never throw to the caller.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskBoard } from '../boards/board.js';
import type { Milestone } from '../engine/types.js';
import type { GoalProgress } from '../engine/goal-engine.js';
import { buildRunReport, type RunReport } from './run-report.js';
import { suggestNextGoal } from './suggest-next-goal.js';

// ── Report path ───────────────────────────────────────────────────────────────

export const REPORT_FILE = '.aidev/report.md';

// ── Markdown formatter ────────────────────────────────────────────────────────

/**
 * Convert a RunReport to a human-readable Markdown document.
 * Pure function — no I/O.
 */
export function formatReportMarkdown(report: RunReport): string {
  const status = report.progress.isComplete ? '✓ Complete' : `In progress (${report.progress.percentComplete}%)`;
  const durationSec = (report.durationMs / 1000).toFixed(1);

  const lines: string[] = [
    '# aidev Run Report',
    '',
    `**Status:** ${status}`,
    `**Tasks processed:** ${report.tasksProcessed}`,
    `**Tests:** ${report.testsResult}`,
    `**Duration:** ${durationSec}s`,
    `**Started:** ${report.startedAt}`,
    `**Finished:** ${report.finishedAt}`,
    '',
    '## Milestones',
    '',
  ];

  for (const m of report.milestones) {
    const icon = m.status === 'done' ? '✓' : m.status === 'in-progress' ? '→' : '○';
    lines.push(`- ${icon} [${m.id}] ${m.title}${m.notes ? ` — ${m.notes}` : ''}`);
  }

  if (report.artifacts.length) {
    lines.push('', '## Artifacts', '');
    for (const a of report.artifacts) {
      lines.push(`- \`${a}\``);
    }
  }

  lines.push('', '## Next Steps', '');
  if (report.progress.isComplete) {
    lines.push('All milestones complete. Run `aidev next-goal` to propose the next goal.');
  } else {
    const remaining = report.progress.total - report.progress.done;
    lines.push(`${remaining} milestone(s) remaining. Continue with \`aidev run\`.`);
  }

  return lines.join('\n');
}

/**
 * Produce a short board-comment-friendly summary (≤ 500 chars).
 */
export function formatReportComment(report: RunReport): string {
  const lines: string[] = [
    `## Run complete — ${report.progress.done}/${report.progress.total} milestones done`,
    `Tests: ${report.testsResult} | Tasks: ${report.tasksProcessed} | Duration: ${(report.durationMs / 1000).toFixed(1)}s`,
    '',
  ];

  if (report.progress.isComplete) {
    lines.push('All milestones complete. Suggested next step: propose a follow-up goal.');
  } else {
    const done = report.milestones.filter((m) => m.status === 'done').map((m) => m.id).join(', ');
    if (done) lines.push(`Completed: ${done}`);
  }

  return lines.join('\n').slice(0, 500);
}

// ── Core action ───────────────────────────────────────────────────────────────

export interface PostEndOfCycleReportParams {
  projectRoot: string;
  milestones: Milestone[];
  progress: GoalProgress;
  artifacts: string[];
  taskTestResults: Array<'pass' | 'fail' | 'skipped' | 'not-run'>;
  tasksProcessed: number;
  startedAt: Date;
  finishedAt: Date;
  /** Board to post the comment on (optional — skipped when absent) */
  board?: TaskBoard;
  /** Task ID to attach the board comment to (optional) */
  lastTaskId?: string;
  /** Title of the just-completed goal, forwarded to suggestNextGoal (optional) */
  currentGoalTitle?: string;
  /** AI CLI binary forwarded to suggestNextGoal — defaults to 'claude' */
  aiCli?: string;
  /** Logger — defaults to console.log */
  log?: (...args: unknown[]) => void;
}

/**
 * Build the run report, write it to .aidev/report.md, and optionally post
 * a summary comment to the board.
 *
 * Fire-and-forget: all errors are caught and logged; this function never throws.
 */
export async function postEndOfCycleReport(params: PostEndOfCycleReportParams): Promise<void> {
  const logger = params.log ?? ((...args: unknown[]) => console.log('[aidev]', ...args));

  try {
    const report = buildRunReport({
      startedAt:       params.startedAt,
      finishedAt:      params.finishedAt,
      milestones:      params.milestones,
      progress:        params.progress,
      artifacts:       params.artifacts,
      taskTestResults: params.taskTestResults,
      tasksProcessed:  params.tasksProcessed,
    });

    // 1. Write report.md (fire-and-forget internally — we still await but outer try/catch handles failures)
    const markdown = formatReportMarkdown(report);
    const reportPath = join(params.projectRoot, REPORT_FILE);
    await writeFile(reportPath, markdown, 'utf8');
    logger(`End-of-cycle report written to ${REPORT_FILE}`);

    // 2. Post board comment if we have a board and a task to comment on
    if (params.board && params.lastTaskId) {
      const comment = formatReportComment(report);
      await params.board.postComment(params.lastTaskId, comment);
      logger('End-of-cycle report posted to board.');
    }

    // 3. Fire-and-forget: propose next goal (async, never blocks)
    suggestNextGoal({
      projectRoot:      params.projectRoot,
      report,
      currentGoalTitle: params.currentGoalTitle,
      aiCli:            params.aiCli,
      log:              logger,
    }).catch((err: unknown) => {
      logger(`Warning: suggestNextGoal error — ${(err as Error)?.message ?? String(err)}`);
    });
  } catch (err: any) {
    // Intentionally swallowed — report posting must never block the run
    logger(`Warning: end-of-cycle report failed — ${err?.message ?? String(err)}`);
  }
}
