import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Goal, Milestone, MilestoneStatus, TaskLane } from './types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const MILESTONES_FILE = '.aidev/milestones.json';
const GOAL_FILE = '.aidev/goal.md';

// ── Goal parsing ──────────────────────────────────────────────────────────────

/**
 * Parse goal.md into a structured Goal object.
 * Sections detected: ## Success criteria, ## Constraints, ## Out of scope
 */
export function parseGoalMd(text: string): Goal {
  const lines = text.split('\n');

  let title = '';
  let description = '';
  const successCriteria: string[] = [];
  const constraints: string[] = [];
  const outOfScope: string[] = [];

  type Section = 'none' | 'desc' | 'criteria' | 'constraints' | 'oos';
  let section: Section = 'none';
  const descLines: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith('# ')) {
      title = line.replace(/^#\s*/, '');
      section = 'desc';
      continue;
    }

    if (/^##\s*success criteria/i.test(line)) { section = 'criteria'; continue; }
    if (/^##\s*constraints/i.test(line))       { section = 'constraints'; continue; }
    if (/^##\s*out of scope/i.test(line))       { section = 'oos'; continue; }
    if (/^##/.test(line))                       { section = 'none'; continue; }

    if (!line || line.startsWith('<!--')) continue;

    const bullet = line.replace(/^[-*]\s*/, '');

    switch (section) {
      case 'desc':        descLines.push(line); break;
      case 'criteria':    if (line.startsWith('-') || line.startsWith('*')) successCriteria.push(bullet); break;
      case 'constraints': if (line.startsWith('-') || line.startsWith('*')) constraints.push(bullet); break;
      case 'oos':         if (line.startsWith('-') || line.startsWith('*')) outOfScope.push(bullet); break;
    }
  }

  description = descLines.join(' ').trim().slice(0, 400);

  return {
    title: title || 'Unnamed goal',
    description,
    successCriteria,
    constraints,
    outOfScope,
    status: 'in-progress',
  };
}

export async function loadGoal(projectRoot: string): Promise<Goal | null> {
  try {
    const text = await readFile(join(projectRoot, GOAL_FILE), 'utf8');
    return parseGoalMd(text);
  } catch {
    return null;
  }
}

// ── Milestone persistence ─────────────────────────────────────────────────────

export async function loadMilestones(projectRoot: string): Promise<Milestone[]> {
  try {
    const text = await readFile(join(projectRoot, MILESTONES_FILE), 'utf8');
    return JSON.parse(text) as Milestone[];
  } catch {
    return [];
  }
}

export async function saveMilestones(
  projectRoot: string,
  milestones: Milestone[],
): Promise<void> {
  await writeFile(
    join(projectRoot, MILESTONES_FILE),
    JSON.stringify(milestones, null, 2),
    'utf8',
  );
}

// ── Milestone derivation from goal ───────────────────────────────────────────

/**
 * Derive an initial milestone list from a Goal's success criteria.
 * Each criterion becomes one milestone with a best-guess verifyCmd
 * extracted from backtick code spans in the criterion text.
 *
 * In production this would be replaced by an LLM call that produces
 * a richer breakdown. For now it gives us a runnable starting point.
 */
export function deriveMilestonesFromGoal(goal: Goal): Milestone[] {
  return goal.successCriteria.map((criterion, i) => {
    const id = `m${i + 1}`;
    const verifyCmd = extractCmd(criterion) ?? undefined;
    const lane = inferLane(criterion);

    return {
      id,
      title: criterion.replace(/`[^`]+`/g, '').trim(),
      acceptanceCriteria: [criterion],
      verifyCmd,
      status: 'pending' as MilestoneStatus,
      lane,
      dependsOn: i === 0 ? [] : [`m${i}`],
      failureCount: 0,
    };
  });
}

function extractCmd(text: string): string | null {
  const match = text.match(/`([^`]+)`/);
  return match ? match[1] : null;
}

function inferLane(criterion: string): TaskLane {
  const lower = criterion.toLowerCase();
  if (lower.includes('test') || lower.includes('pass') || lower.includes('verify')) return 'qa';
  if (lower.includes('research') || lower.includes('document')) return 'research';
  if (lower.includes('plan') || lower.includes('design')) return 'planning';
  return 'build';
}

// ── Progress report ───────────────────────────────────────────────────────────

export interface GoalProgress {
  total: number;
  done: number;
  inProgress: number;
  blocked: number;
  escalated: number;
  percentComplete: number;
  currentMilestone: Milestone | null;
  nextMilestone: Milestone | null;
  isComplete: boolean;
}

export function measureProgress(milestones: Milestone[]): GoalProgress {
  const done      = milestones.filter((m) => m.status === 'done').length;
  const inProgress = milestones.filter((m) => m.status === 'in-progress').length;
  const blocked   = milestones.filter((m) => m.status === 'blocked').length;
  const escalated = milestones.filter((m) => m.status === 'escalated').length;
  const total     = milestones.length;

  const currentMilestone =
    milestones.find((m) => m.status === 'in-progress') ??
    milestones.find((m) => m.status === 'blocked') ??
    null;

  const nextMilestone = milestones.find((m) => {
    if (m.status !== 'pending') return false;
    return m.dependsOn.every((dep) =>
      milestones.find((x) => x.id === dep)?.status === 'done'
    );
  }) ?? null;

  return {
    total,
    done,
    inProgress,
    blocked,
    escalated,
    percentComplete: total ? Math.round((done / total) * 100) : 0,
    currentMilestone,
    nextMilestone,
    isComplete: total > 0 && done === total,
  };
}

/**
 * Find the next unblocked milestone whose dependencies are all done.
 * Returns null if everything is done or everything is blocked/escalated.
 */
export function getActiveMilestone(milestones: Milestone[]): Milestone | null {
  // Prefer in-progress first
  const active = milestones.find((m) => m.status === 'in-progress');
  if (active) return active;

  // Then first pending with all deps done
  return milestones.find((m) => {
    if (m.status !== 'pending') return false;
    return m.dependsOn.every(
      (dep) => milestones.find((x) => x.id === dep)?.status === 'done'
    );
  }) ?? null;
}
