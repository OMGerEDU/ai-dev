import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { formatReportMarkdown, formatReportComment, postEndOfCycleReport } from '../end-of-cycle.js';
import type { RunReport } from '../run-report.js';
import type { TaskBoard } from '../../boards/board.js';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<RunReport> = {}): RunReport {
  return {
    startedAt: '2026-01-01T10:00:00.000Z',
    finishedAt: '2026-01-01T10:05:00.000Z',
    durationMs: 300_000,
    progress: {
      total: 3,
      done: 3,
      percentComplete: 100,
      isComplete: true,
    },
    milestones: [
      { id: 'm1', title: 'First',  status: 'done' },
      { id: 'm2', title: 'Second', status: 'done' },
    ],
    artifacts: ['src/a.ts', 'src/b.ts'],
    testsResult: 'pass',
    tasksProcessed: 5,
    ...overrides,
  };
}

function makeMockBoard() {
  const postComment = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const board: TaskBoard = {
    fetchTasks:   () => Promise.resolve([]),
    fetchTask:    () => Promise.resolve(null),
    createTask:   () => Promise.resolve({ id: 't1', name: '', tags: [], status: 'open', description: '', url: '' }),
    updateStatus: () => Promise.resolve(),
    postComment,
    appendUpdate: () => Promise.resolve(),
    addTags:      () => Promise.resolve(),
    markStart:    () => Promise.resolve(),
    name: 'MockBoard',
  };
  return { board, postComment };
}

// ── formatReportMarkdown ──────────────────────────────────────────────────────

describe('formatReportMarkdown', () => {
  it('includes a heading', () => {
    const md = formatReportMarkdown(makeReport());
    expect(md).toContain('# aidev Run Report');
  });

  it('shows Complete status when isComplete', () => {
    const md = formatReportMarkdown(makeReport({ progress: { total: 2, done: 2, percentComplete: 100, isComplete: true } }));
    expect(md).toContain('✓ Complete');
  });

  it('shows percentage when not complete', () => {
    const md = formatReportMarkdown(makeReport({ progress: { total: 4, done: 2, percentComplete: 50, isComplete: false } }));
    expect(md).toContain('50%');
  });

  it('lists milestone ids with icons', () => {
    const md = formatReportMarkdown(makeReport());
    expect(md).toContain('[m1]');
    expect(md).toContain('[m2]');
    expect(md).toContain('✓');
  });

  it('lists artifacts when present', () => {
    const md = formatReportMarkdown(makeReport());
    expect(md).toContain('src/a.ts');
    expect(md).toContain('src/b.ts');
  });

  it('omits artifacts section when none', () => {
    const md = formatReportMarkdown(makeReport({ artifacts: [] }));
    expect(md).not.toContain('## Artifacts');
  });

  it('includes duration in seconds', () => {
    const md = formatReportMarkdown(makeReport({ durationMs: 90_000 }));
    expect(md).toContain('90.0s');
  });

  it('includes next-goal hint when complete', () => {
    const md = formatReportMarkdown(makeReport());
    expect(md).toContain('next-goal');
  });

  it('includes continue hint when not complete', () => {
    const md = formatReportMarkdown(makeReport({
      progress: { total: 4, done: 2, percentComplete: 50, isComplete: false },
    }));
    expect(md).toContain('aidev run');
  });

  it('includes milestone notes when present', () => {
    const report = makeReport({
      milestones: [{ id: 'm1', title: 'First', status: 'done', notes: 'deployed to prod' }],
    });
    const md = formatReportMarkdown(report);
    expect(md).toContain('deployed to prod');
  });
});

// ── formatReportComment ───────────────────────────────────────────────────────

describe('formatReportComment', () => {
  it('includes milestone counts', () => {
    const comment = formatReportComment(makeReport());
    expect(comment).toContain('3/3');
  });

  it('is at most 500 characters', () => {
    const report = makeReport({
      milestones: Array.from({ length: 50 }, (_, i) => ({
        id: `m${i}`, title: `Milestone ${i}`, status: 'done' as const,
      })),
    });
    const comment = formatReportComment(report);
    expect(comment.length).toBeLessThanOrEqual(500);
  });

  it('mentions next step when complete', () => {
    const comment = formatReportComment(makeReport());
    expect(comment).toContain('next');
  });
});

// ── postEndOfCycleReport ──────────────────────────────────────────────────────

describe('postEndOfCycleReport', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'aidev-eoc-test-'));
    await mkdir(join(tmpDir, '.aidev'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeParams(overrides: Partial<Parameters<typeof postEndOfCycleReport>[0]> = {}) {
    return {
      projectRoot:     tmpDir,
      milestones:      [{ id: 'm1', title: 'T', status: 'done' as const, acceptanceCriteria: [], lane: 'build' as const, dependsOn: [], failureCount: 0 }],
      progress:        { total: 1, done: 1, percentComplete: 100, isComplete: true, inProgress: 0, blocked: 0, escalated: 0, currentMilestone: null, nextMilestone: null },
      artifacts:       [],
      taskTestResults: [] as Array<'pass' | 'fail' | 'skipped' | 'not-run'>,
      tasksProcessed:  1,
      startedAt:       new Date('2026-01-01T10:00:00Z'),
      finishedAt:      new Date('2026-01-01T10:01:00Z'),
      log:             jest.fn<(...args: unknown[]) => void>(),
      ...overrides,
    };
  }

  it('writes report.md to .aidev/report.md', async () => {
    await postEndOfCycleReport(makeParams());
    const content = await readFile(join(tmpDir, '.aidev', 'report.md'), 'utf8');
    expect(content).toContain('# aidev Run Report');
  });

  it('posts comment to board when board and lastTaskId provided', async () => {
    const { board, postComment } = makeMockBoard();
    await postEndOfCycleReport(makeParams({ board, lastTaskId: 'task-42' }));
    expect(postComment).toHaveBeenCalledWith('task-42', expect.stringContaining('Run complete'));
  });

  it('skips board comment when no lastTaskId', async () => {
    const { board, postComment } = makeMockBoard();
    await postEndOfCycleReport(makeParams({ board, lastTaskId: undefined }));
    expect(postComment).not.toHaveBeenCalled();
  });

  it('skips board comment when no board', async () => {
    // no board provided — should not throw
    await expect(postEndOfCycleReport(makeParams({ board: undefined }))).resolves.toBeUndefined();
  });

  it('never throws when writeFile fails', async () => {
    // Use a projectRoot that does not have .aidev — writeFile will fail
    const badRoot = join(tmpDir, 'nonexistent');
    const logFn = jest.fn<(...args: unknown[]) => void>();
    await expect(
      postEndOfCycleReport(makeParams({ projectRoot: badRoot, log: logFn }))
    ).resolves.toBeUndefined();
    expect(logFn).toHaveBeenCalledWith(expect.stringContaining('Warning'));
  });

  it('never throws when board.postComment fails', async () => {
    const { board, postComment } = makeMockBoard();
    postComment.mockRejectedValue(new Error('network error'));
    await expect(
      postEndOfCycleReport(makeParams({ board, lastTaskId: 'task-1' }))
    ).resolves.toBeUndefined();
  });
});
