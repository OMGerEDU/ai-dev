import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  extractGoalBody,
  isApproved,
  checkAndApplyNextGoal,
  NEXT_GOAL_FILE,
  GOAL_FILE,
  MILESTONES_FILE,
  APPROVED_MARKER,
  REJECTED_MARKER,
} from '../goal-cycle.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function noop() {}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// ── extractGoalBody ───────────────────────────────────────────────────────────

describe('extractGoalBody', () => {
  it('returns everything before the --- separator preceding ## Proposal', () => {
    const input = `# My Goal\n\nDo the thing.\n\n---\n\n## Proposal\n\nSome proposal text.`;
    expect(extractGoalBody(input)).toBe('# My Goal\n\nDo the thing.');
  });

  it('handles --- separator with surrounding whitespace', () => {
    const input = `# Title\n\nBody text.\n\n---  \n\n## Proposal\nproposal`;
    expect(extractGoalBody(input)).toBe('# Title\n\nBody text.');
  });

  it('returns the entire content when there is no --- ## Proposal separator', () => {
    const input = `# Goal\n\nJust a goal, no proposal.`;
    expect(extractGoalBody(input)).toBe('# Goal\n\nJust a goal, no proposal.');
  });

  it('trims leading/trailing whitespace from the result', () => {
    const input = `\n# Goal\n\n---\n\n## Proposal\nstuff`;
    expect(extractGoalBody(input)).toBe('# Goal');
  });
});

// ── isApproved ────────────────────────────────────────────────────────────────

describe('isApproved', () => {
  it('returns true when APPROVED marker is present and no AWAITING marker', () => {
    expect(isApproved(`${APPROVED_MARKER}\n# Goal`)).toBe(true);
  });

  it('returns false when AWAITING_APPROVAL marker is still present', () => {
    const content = `<!-- AWAITING_APPROVAL -->\n${APPROVED_MARKER}`;
    expect(isApproved(content)).toBe(false);
  });

  it('returns false when only REJECTED marker is present', () => {
    expect(isApproved(`${REJECTED_MARKER}\n# Goal`)).toBe(false);
  });

  it('returns false when neither APPROVED nor AWAITING is present', () => {
    expect(isApproved(`# Just a goal`)).toBe(false);
  });
});

// ── checkAndApplyNextGoal ─────────────────────────────────────────────────────

describe('checkAndApplyNextGoal', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'aidev-goal-cycle-test-'));
    await mkdir(join(tmpDir, '.aidev'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const nextGoalPath = (root: string) => join(root, NEXT_GOAL_FILE);
  const goalPath     = (root: string) => join(root, GOAL_FILE);
  const milestonesPath = (root: string) => join(root, MILESTONES_FILE);

  it('returns { applied: false } when next-goal.md does not exist', async () => {
    const result = await checkAndApplyNextGoal(tmpDir, noop);
    expect(result).toEqual({ applied: false });
  });

  it('returns { applied: false } when file has AWAITING_APPROVAL marker', async () => {
    await writeFile(nextGoalPath(tmpDir), '<!-- AWAITING_APPROVAL -->\n# Goal', 'utf8');
    const result = await checkAndApplyNextGoal(tmpDir, noop);
    expect(result).toEqual({ applied: false });
  });

  it('returns { applied: false } when file has REJECTED marker', async () => {
    await writeFile(nextGoalPath(tmpDir), `${REJECTED_MARKER}\n# Goal`, 'utf8');
    const result = await checkAndApplyNextGoal(tmpDir, noop);
    expect(result).toEqual({ applied: false });
  });

  it('applies approved next-goal: writes goal.md', async () => {
    const content = [
      APPROVED_MARKER,
      '# New Goal',
      '',
      'Do the new thing.',
      '',
      '---',
      '',
      '## Proposal',
      'AI suggested this.',
    ].join('\n');

    await writeFile(nextGoalPath(tmpDir), content, 'utf8');
    await writeFile(milestonesPath(tmpDir), '[{"id":"m1","status":"done"}]', 'utf8');

    const result = await checkAndApplyNextGoal(tmpDir, noop);

    expect(result.applied).toBe(true);
    expect(result.newGoalTitle).toBe('New Goal');

    const goalContent = await readFile(goalPath(tmpDir), 'utf8');
    expect(goalContent).toContain('# New Goal');
    expect(goalContent).not.toContain('## Proposal');
  });

  it('resets milestones.json to [] when applying', async () => {
    await writeFile(nextGoalPath(tmpDir), `${APPROVED_MARKER}\n# Goal`, 'utf8');
    await writeFile(milestonesPath(tmpDir), '[{"id":"m1","status":"done"}]', 'utf8');

    await checkAndApplyNextGoal(tmpDir, noop);

    const milestonesContent = await readFile(milestonesPath(tmpDir), 'utf8');
    expect(milestonesContent).toBe('[]');
  });

  it('removes next-goal.md after applying', async () => {
    await writeFile(nextGoalPath(tmpDir), `${APPROVED_MARKER}\n# Goal`, 'utf8');

    await checkAndApplyNextGoal(tmpDir, noop);

    expect(await fileExists(nextGoalPath(tmpDir))).toBe(false);
  });

  it('extracts newGoalTitle from the first # heading', async () => {
    await writeFile(nextGoalPath(tmpDir), `${APPROVED_MARKER}\n# My Awesome Goal\n\nDescription.`, 'utf8');
    const result = await checkAndApplyNextGoal(tmpDir, noop);
    expect(result.applied).toBe(true);
    expect(result.newGoalTitle).toBe('My Awesome Goal');
  });

  it('sets newGoalTitle to undefined when no # heading in body', async () => {
    await writeFile(nextGoalPath(tmpDir), `${APPROVED_MARKER}\nJust some text without a heading.`, 'utf8');
    const result = await checkAndApplyNextGoal(tmpDir, noop);
    expect(result.applied).toBe(true);
    expect(result.newGoalTitle).toBeUndefined();
  });

  it('returns { applied: false } and logs a warning when I/O fails', async () => {
    // Write next-goal.md but make goal.md a directory so writeFile fails
    await writeFile(nextGoalPath(tmpDir), `${APPROVED_MARKER}\n# Goal`, 'utf8');
    await mkdir(goalPath(tmpDir), { recursive: true });

    const logs: unknown[][] = [];
    const result = await checkAndApplyNextGoal(tmpDir, (...args) => logs.push(args));

    expect(result.applied).toBe(false);
    const logStr = logs.map((l) => l.join(' ')).join('\n').toLowerCase();
    expect(logStr).toMatch(/warning|failed/);
  });
});
