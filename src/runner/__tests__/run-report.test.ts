import { buildRunReport, type BuildRunReportInput } from '../run-report.js';
import type { Milestone } from '../../engine/types.js';
import type { GoalProgress } from '../../engine/goal-engine.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm1',
    title: 'Test milestone',
    acceptanceCriteria: ['it works'],
    status: 'done',
    lane: 'build',
    dependsOn: [],
    failureCount: 0,
    ...overrides,
  };
}

function makeProgress(overrides: Partial<GoalProgress> = {}): GoalProgress {
  return {
    total: 3,
    done: 2,
    inProgress: 1,
    blocked: 0,
    escalated: 0,
    percentComplete: 67,
    currentMilestone: null,
    nextMilestone: null,
    isComplete: false,
    ...overrides,
  };
}

function makeInput(overrides: Partial<BuildRunReportInput> = {}): BuildRunReportInput {
  const startedAt = new Date('2026-01-01T10:00:00Z');
  const finishedAt = new Date('2026-01-01T10:05:00Z');
  return {
    startedAt,
    finishedAt,
    milestones: [makeMilestone()],
    progress: makeProgress(),
    artifacts: [],
    taskTestResults: [],
    tasksProcessed: 1,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildRunReport', () => {
  it('computes durationMs from start and finish dates', () => {
    const report = buildRunReport(makeInput());
    expect(report.durationMs).toBe(5 * 60 * 1000); // 5 minutes
  });

  it('sets startedAt and finishedAt as ISO strings', () => {
    const report = buildRunReport(makeInput());
    expect(report.startedAt).toBe('2026-01-01T10:00:00.000Z');
    expect(report.finishedAt).toBe('2026-01-01T10:05:00.000Z');
  });

  it('maps progress fields correctly', () => {
    const report = buildRunReport(makeInput());
    expect(report.progress.total).toBe(3);
    expect(report.progress.done).toBe(2);
    expect(report.progress.percentComplete).toBe(67);
    expect(report.progress.isComplete).toBe(false);
  });

  it('marks isComplete true when all milestones done', () => {
    const input = makeInput({
      progress: makeProgress({ total: 2, done: 2, percentComplete: 100, isComplete: true }),
    });
    const report = buildRunReport(input);
    expect(report.progress.isComplete).toBe(true);
  });

  it('summarises milestones with id, title, status, notes', () => {
    const m = makeMilestone({ id: 'm2', title: 'Second', status: 'pending', notes: 'some note' });
    const report = buildRunReport(makeInput({ milestones: [m] }));
    expect(report.milestones).toHaveLength(1);
    expect(report.milestones[0]).toEqual({ id: 'm2', title: 'Second', status: 'pending', notes: 'some note' });
  });

  it('omits notes key when milestone has no notes', () => {
    const m = makeMilestone({ notes: undefined });
    const report = buildRunReport(makeInput({ milestones: [m] }));
    expect(report.milestones[0].notes).toBeUndefined();
  });

  it('deduplicates artifacts', () => {
    const report = buildRunReport(makeInput({
      artifacts: ['src/a.ts', 'src/b.ts', 'src/a.ts'],
    }));
    expect(report.artifacts).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('preserves order of artifacts after dedup', () => {
    const report = buildRunReport(makeInput({
      artifacts: ['z.ts', 'a.ts', 'z.ts', 'm.ts'],
    }));
    expect(report.artifacts).toEqual(['z.ts', 'a.ts', 'm.ts']);
  });

  it('sets tasksProcessed', () => {
    const report = buildRunReport(makeInput({ tasksProcessed: 7 }));
    expect(report.tasksProcessed).toBe(7);
  });

  // ── aggregateTestResults ───────────────────────────────────────────────────

  it('testsResult is not-run when no task results', () => {
    const report = buildRunReport(makeInput({ taskTestResults: [] }));
    expect(report.testsResult).toBe('not-run');
  });

  it('testsResult is pass when all tasks pass', () => {
    const report = buildRunReport(makeInput({ taskTestResults: ['pass', 'pass'] }));
    expect(report.testsResult).toBe('pass');
  });

  it('testsResult is fail when any task fails', () => {
    const report = buildRunReport(makeInput({ taskTestResults: ['pass', 'fail'] }));
    expect(report.testsResult).toBe('fail');
  });

  it('testsResult is fail even if others pass', () => {
    const report = buildRunReport(makeInput({ taskTestResults: ['pass', 'fail', 'pass'] }));
    expect(report.testsResult).toBe('fail');
  });

  it('testsResult is skipped when no pass/fail but some skipped', () => {
    const report = buildRunReport(makeInput({ taskTestResults: ['skipped', 'not-run'] }));
    expect(report.testsResult).toBe('skipped');
  });

  it('testsResult is not-run when all are not-run', () => {
    const report = buildRunReport(makeInput({ taskTestResults: ['not-run', 'not-run'] }));
    expect(report.testsResult).toBe('not-run');
  });
});
