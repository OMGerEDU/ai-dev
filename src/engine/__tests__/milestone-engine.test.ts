import { describe, it, expect } from '@jest/globals';
import {
  FAILURE_ESCALATION_THRESHOLD,
  advanceMilestone,
  buildGapContinuations,
  formatMilestoneStatus,
} from '../milestone-engine.js';
import type { Milestone } from '../types.js';

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm1',
    title: 'Test milestone',
    lane: 'qa',
    status: 'pending',
    failureCount: 0,
    dependsOn: [],
    acceptanceCriteria: ['it works'],
    ...overrides,
  };
}

describe('FAILURE_ESCALATION_THRESHOLD', () => {
  it('is a positive integer', () => {
    expect(FAILURE_ESCALATION_THRESHOLD).toBeGreaterThan(0);
    expect(Number.isInteger(FAILURE_ESCALATION_THRESHOLD)).toBe(true);
  });
});

describe('advanceMilestone', () => {
  it('marks done when no verifyCmd', () => {
    const m = makeMilestone();
    const { result, escalated } = advanceMilestone(m, '/tmp');
    expect(m.status).toBe('done');
    expect(result.passed).toBe(true);
    expect(escalated).toBe(false);
  });

  it('marks done when verifyCmd exits 0', () => {
    const m = makeMilestone({ verifyCmd: 'node --version' });
    const { result, escalated } = advanceMilestone(m, process.cwd());
    expect(m.status).toBe('done');
    expect(result.passed).toBe(true);
    expect(escalated).toBe(false);
  });

  it('increments failureCount when verifyCmd exits non-zero', () => {
    const m = makeMilestone({ verifyCmd: 'node -e "process.exit(1)"' });
    advanceMilestone(m, process.cwd());
    expect(m.failureCount).toBe(1);
    expect(m.status).toBe('in-progress');
  });

  it('escalates after FAILURE_ESCALATION_THRESHOLD failures', () => {
    const m = makeMilestone({
      verifyCmd: 'node -e "process.exit(1)"',
      failureCount: FAILURE_ESCALATION_THRESHOLD - 1,
    });
    const { escalated } = advanceMilestone(m, process.cwd());
    expect(escalated).toBe(true);
    expect(m.status).toBe('escalated');
  });
});

describe('buildGapContinuations', () => {
  it('returns escalation spec when escalated=true', () => {
    const m = makeMilestone({ failureCount: FAILURE_ESCALATION_THRESHOLD });
    const specs = buildGapContinuations({
      milestone: m,
      success: false,
      escalated: true,
      allMilestones: [m],
    });
    expect(specs).toHaveLength(1);
    expect(specs[0].tags).toContain('needs-human');
  });

  it('returns fix spec when task failed', () => {
    const m = makeMilestone();
    const specs = buildGapContinuations({
      milestone: m,
      success: false,
      escalated: false,
      verifyResult: { passed: false, output: 'error', durationMs: 10 },
      allMilestones: [m],
    });
    expect(specs).toHaveLength(1);
    expect(specs[0].title).toMatch(/Fix:/);
  });

  it('returns next-milestone spec when current is done', () => {
    const m1 = makeMilestone({ id: 'm1', status: 'done' });
    const m2 = makeMilestone({ id: 'm2', status: 'pending', dependsOn: ['m1'] });
    const specs = buildGapContinuations({
      milestone: m1,
      success: true,
      escalated: false,
      allMilestones: [m1, m2],
    });
    expect(specs).toHaveLength(1);
    expect(specs[0].milestoneId).toBe('m2');
  });
});

describe('formatMilestoneStatus', () => {
  it('renders a status string for each milestone', () => {
    const milestones = [
      makeMilestone({ id: 'm1', title: 'Alpha', status: 'done' }),
      makeMilestone({ id: 'm2', title: 'Beta', status: 'pending' }),
    ];
    const output = formatMilestoneStatus(milestones);
    expect(output).toContain('Alpha');
    expect(output).toContain('Beta');
    expect(output).toContain('✓');
    expect(output).toContain('○');
  });
});
