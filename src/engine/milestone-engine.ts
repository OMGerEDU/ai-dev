import { execSync } from 'node:child_process';
import type { Milestone, MilestoneStatus, ContinuationSpec, EscalationEvent, TaskLane } from './types.js';
import { saveMilestones } from './goal-engine.js';

// ── Configuration ─────────────────────────────────────────────────────────────

/** Consecutive verifyCmd failures before a milestone is escalated to human */
export const FAILURE_ESCALATION_THRESHOLD = 3;

/** Max ms to allow a verifyCmd to run */
const VERIFY_TIMEOUT_MS = 120_000;

// ── Verification ──────────────────────────────────────────────────────────────

export interface VerifyResult {
  passed: boolean;
  output: string;
  durationMs: number;
  error?: string;
}

/**
 * Run a milestone's verifyCmd.
 * Returns passed:true if the command exits 0.
 * Captures stdout+stderr for evidence.
 */
export function runVerifyCmd(
  cmd: string,
  projectRoot: string,
): VerifyResult {
  const start = Date.now();
  try {
    const output = execSync(cmd, {
      cwd: projectRoot,
      timeout: VERIFY_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { passed: true, output: output.slice(0, 4000), durationMs: Date.now() - start };
  } catch (err: any) {
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').slice(0, 4000);
    return {
      passed: false,
      output,
      durationMs: Date.now() - start,
      error: err.message?.slice(0, 500),
    };
  }
}

// ── Milestone state transitions ───────────────────────────────────────────────

/**
 * Advance a milestone after a successful task run.
 * Runs verifyCmd; updates status + failureCount accordingly.
 * Mutates the milestone in place; caller must persist via saveMilestones.
 */
export function advanceMilestone(
  milestone: Milestone,
  projectRoot: string,
): { result: VerifyResult; escalated: boolean } {
  milestone.status = 'in-progress';
  milestone.lastVerified = new Date().toISOString();

  if (!milestone.verifyCmd) {
    // No verify command — mark done optimistically (manual milestone)
    milestone.status = 'done';
    milestone.failureCount = 0;
    return {
      result: { passed: true, output: 'No verifyCmd — marked done manually.', durationMs: 0 },
      escalated: false,
    };
  }

  const result = runVerifyCmd(milestone.verifyCmd, projectRoot);

  if (result.passed) {
    milestone.status = 'done';
    milestone.failureCount = 0;
    milestone.notes = `Verified at ${milestone.lastVerified}. Output: ${result.output.slice(0, 200)}`;
  } else {
    milestone.failureCount += 1;
    milestone.notes = `Failure #${milestone.failureCount}: ${result.error ?? result.output.slice(0, 300)}`;

    if (milestone.failureCount >= FAILURE_ESCALATION_THRESHOLD) {
      milestone.status = 'escalated';
      return { result, escalated: true };
    }

    milestone.status = 'in-progress';
  }

  return { result, escalated: false };
}

// ── Continuation specs from gap analysis ─────────────────────────────────────

/**
 * Given the current milestone state and a task outcome,
 * produce continuation specs that close the gap to the next verified milestone.
 *
 * This replaces the old lane-cycling buildContinuationSpecs.
 * Every continuation is anchored to a specific milestone.
 */
export function buildGapContinuations(options: {
  milestone: Milestone;
  success: boolean;
  verifyResult?: VerifyResult;
  escalated: boolean;
  allMilestones: Milestone[];
}): ContinuationSpec[] {
  const { milestone, success, verifyResult, escalated, allMilestones } = options;
  const specs: ContinuationSpec[] = [];

  // ── Escalation: hand off to human ────────────────────────────────────────
  if (escalated) {
    specs.push({
      lane: 'planning',
      title: `[ESCALATED] Human review required: ${milestone.title}`,
      description: [
        `Milestone "${milestone.title}" (${milestone.id}) failed ${milestone.failureCount} times consecutively.`,
        `Last error: ${milestone.notes ?? 'see task history'}`,
        `verifyCmd: ${milestone.verifyCmd ?? 'none'}`,
        'Action required: a human must review and unblock this milestone.',
        'Once resolved, reset failureCount to 0 and set status to pending.',
      ].join('\n'),
      tags: ['needs-human', 'escalated', 'planning'],
      status: 'Open',
      reason: `Confidence governor triggered after ${milestone.failureCount} failures.`,
      milestoneId: milestone.id,
    });
    return specs;
  }

  // ── Task failed, verifyCmd also failed → targeted fix task ───────────────
  if (!success || (verifyResult && !verifyResult.passed)) {
    const evidence = verifyResult?.output?.slice(0, 500) ?? 'No output captured';
    specs.push({
      lane: milestone.lane,
      title: `Fix: ${milestone.title}`,
      description: [
        `Task failed while advancing milestone "${milestone.title}" (${milestone.id}).`,
        `Failure evidence:\n${evidence}`,
        `verifyCmd: ${milestone.verifyCmd ?? 'none'}`,
        'Narrow the fix to the specific failure above. Do not change unrelated code.',
      ].join('\n\n'),
      tags: ['fix', milestone.lane, milestone.id],
      status: 'Open',
      reason: 'verifyCmd failed — targeted fix required before progression.',
      milestoneId: milestone.id,
    });
    return specs;
  }

  // ── Milestone done → open the next unlocked milestone's first task ────────
  if (milestone.status === 'done') {
    const next = allMilestones.find((m) => {
      if (m.status !== 'pending') return false;
      return m.dependsOn.every(
        (dep) => allMilestones.find((x) => x.id === dep)?.status === 'done'
      );
    });

    if (next) {
      specs.push({
        lane: next.lane,
        title: `${capitalize(next.lane)}: ${next.title}`,
        description: [
          `Advance milestone "${next.title}" (${next.id}).`,
          '',
          'Acceptance criteria:',
          ...next.acceptanceCriteria.map((c) => `- ${c}`),
          next.verifyCmd ? `\nVerification command: \`${next.verifyCmd}\`` : '',
        ].join('\n'),
        tags: [next.lane, next.id, 'aidev'],
        status: 'Open',
        reason: `Milestone ${milestone.id} is done — ${next.id} is now unblocked.`,
        milestoneId: next.id,
      });
    }

    return specs;
  }

  // ── Milestone still in-progress → QA verification task ───────────────────
  specs.push({
    lane: 'qa',
    title: `QA: Verify ${milestone.title}`,
    description: [
      `Run verification for milestone "${milestone.title}" (${milestone.id}).`,
      milestone.verifyCmd ? `Command: \`${milestone.verifyCmd}\`` : 'No automated command — manual verification required.',
      '',
      'Acceptance criteria:',
      ...milestone.acceptanceCriteria.map((c) => `- ${c}`),
    ].join('\n'),
    tags: ['qa', milestone.id, 'aidev'],
    status: 'Open',
    reason: 'Implementation task succeeded — QA must confirm the milestone criteria.',
    milestoneId: milestone.id,
  });

  return specs;
}

// ── Progress summary string ───────────────────────────────────────────────────

export function formatMilestoneStatus(milestones: Milestone[]): string {
  const icons: Record<MilestoneStatus, string> = {
    'done':        '✓',
    'in-progress': '→',
    'pending':     '○',
    'blocked':     '✗',
    'escalated':   '!',
  };

  return milestones
    .map((m) => `${icons[m.status]} [${m.id}] ${m.title}${m.failureCount > 0 ? ` (failures: ${m.failureCount})` : ''}`)
    .join('\n');
}

export async function persistMilestoneUpdate(
  milestone: Milestone,
  allMilestones: Milestone[],
  projectRoot: string,
): Promise<void> {
  const updated = allMilestones.map((m) => (m.id === milestone.id ? milestone : m));
  await saveMilestones(projectRoot, updated);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
