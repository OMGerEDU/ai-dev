/**
 * RunReport — structured summary of a completed aidev run cycle.
 *
 * Built at end-of-cycle and used by m6 (afterRun hook) to write report.md
 * and post a ClickUp comment. Kept as a plain data type so it can be
 * serialised to JSON without transformation.
 */

import type { Milestone } from '../engine/types.js';
import type { GoalProgress } from '../engine/goal-engine.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MilestoneSummary {
  id: string;
  title: string;
  status: Milestone['status'];
  notes?: string;
}

export interface RunReport {
  /** ISO timestamp when the run started */
  startedAt: string;
  /** ISO timestamp when the run ended */
  finishedAt: string;
  /** Duration in milliseconds */
  durationMs: number;

  /** Snapshot of milestone progress */
  progress: {
    total: number;
    done: number;
    percentComplete: number;
    isComplete: boolean;
  };

  /** Per-milestone status summary */
  milestones: MilestoneSummary[];

  /** All file paths produced across all tasks in this run */
  artifacts: string[];

  /** Combined test result across all tasks ('pass' if all pass, 'fail' if any fail) */
  testsResult: 'pass' | 'fail' | 'skipped' | 'not-run';

  /** Number of tasks processed */
  tasksProcessed: number;
}

// ── Builder ───────────────────────────────────────────────────────────────────

export interface BuildRunReportInput {
  startedAt: Date;
  finishedAt: Date;
  milestones: Milestone[];
  progress: GoalProgress;
  artifacts: string[];
  /** Individual per-task test results collected during the run */
  taskTestResults: Array<'pass' | 'fail' | 'skipped' | 'not-run'>;
  tasksProcessed: number;
}

/**
 * Compile a structured RunReport from the pieces collected during a run.
 * This is a pure function — no I/O, no side effects, easy to test.
 */
export function buildRunReport(input: BuildRunReportInput): RunReport {
  const {
    startedAt,
    finishedAt,
    milestones,
    progress,
    artifacts,
    taskTestResults,
    tasksProcessed,
  } = input;

  const durationMs = finishedAt.getTime() - startedAt.getTime();

  const milestoneSummaries: MilestoneSummary[] = milestones.map((m) => ({
    id: m.id,
    title: m.title,
    status: m.status,
    notes: m.notes,
  }));

  // Deduplicate artifacts while preserving order
  const uniqueArtifacts = [...new Set(artifacts)];

  const testsResult = aggregateTestResults(taskTestResults);

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    progress: {
      total: progress.total,
      done: progress.done,
      percentComplete: progress.percentComplete,
      isComplete: progress.isComplete,
    },
    milestones: milestoneSummaries,
    artifacts: uniqueArtifacts,
    testsResult,
    tasksProcessed,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Aggregate individual task test results into a single run-level result.
 * - Any 'fail'    → 'fail'
 * - Any 'pass'    → 'pass'  (when no failures)
 * - Any 'skipped' → 'skipped' (when no pass or fail)
 * - Otherwise     → 'not-run'
 */
function aggregateTestResults(
  results: Array<'pass' | 'fail' | 'skipped' | 'not-run'>,
): 'pass' | 'fail' | 'skipped' | 'not-run' {
  if (results.some((r) => r === 'fail'))    return 'fail';
  if (results.some((r) => r === 'pass'))    return 'pass';
  if (results.some((r) => r === 'skipped')) return 'skipped';
  return 'not-run';
}
