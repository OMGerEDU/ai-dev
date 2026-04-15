/**
 * goal-cycle.ts — Human-reply-triggered new cycle logic.
 *
 * After suggestNextGoal writes next-goal.md, the human replaces the
 * <!-- AWAITING_APPROVAL --> marker with <!-- APPROVED -->.
 * On the next run, checkAndApplyNextGoal detects this, extracts the
 * goal body (everything before "## Proposal"), writes it to goal.md,
 * clears milestones.json so they will be re-derived, and removes
 * next-goal.md to prevent re-application.
 */

import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

// ── Constants ─────────────────────────────────────────────────────────────────

export const NEXT_GOAL_FILE  = '.aidev/next-goal.md';
export const GOAL_FILE       = '.aidev/goal.md';
export const MILESTONES_FILE = '.aidev/milestones.json';

export const APPROVED_MARKER = '<!-- APPROVED -->';
export const REJECTED_MARKER = '<!-- REJECTED -->';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the goal body from a next-goal.md document.
 *
 * The body is everything before the `---` separator that precedes
 * `## Proposal`. If no such separator exists, the entire content is
 * returned as the goal body.
 *
 * Pure function — no I/O.
 */
export function extractGoalBody(nextGoalContent: string): string {
  // The proposal section is separated by a `---` line followed by a
  // `## Proposal` heading.  We want everything before that separator.
  const separatorMatch = nextGoalContent.match(/\n---\s*\n\s*## Proposal/);
  if (separatorMatch && separatorMatch.index !== undefined) {
    return nextGoalContent.slice(0, separatorMatch.index).trim();
  }
  return nextGoalContent.trim();
}

/**
 * Return true if next-goal.md exists and contains the APPROVED marker
 * (and does NOT contain the AWAITING or REJECTED markers).
 *
 * Pure function — no I/O.
 */
export function isApproved(content: string): boolean {
  return content.includes(APPROVED_MARKER) && !content.includes('<!-- AWAITING_APPROVAL -->');
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface ApplyResult {
  applied: boolean;
  /** The new goal title extracted from the body, if applied */
  newGoalTitle?: string;
}

/**
 * Check `.aidev/next-goal.md` for human approval.
 *
 * If approved:
 *   1. Extract the goal body (strip the ## Proposal section).
 *   2. Overwrite `.aidev/goal.md` with the new goal.
 *   3. Reset `.aidev/milestones.json` to `[]` so milestones are re-derived.
 *   4. Delete `.aidev/next-goal.md` to prevent re-application.
 *
 * If not present, not approved, or rejected: no-op.
 *
 * Returns { applied: true } when a new cycle was started, { applied: false } otherwise.
 */
export async function checkAndApplyNextGoal(
  projectRoot: string,
  log: (...args: unknown[]) => void = (...args) => console.log('[aidev]', ...args),
): Promise<ApplyResult> {
  let content: string;

  try {
    content = await readFile(join(projectRoot, NEXT_GOAL_FILE), 'utf8');
  } catch {
    // File absent — nothing to do
    return { applied: false };
  }

  if (!isApproved(content)) {
    return { applied: false };
  }

  try {
    const goalBody = extractGoalBody(content);

    // Extract title from the goal body for logging (first `# ` heading)
    const titleMatch = goalBody.match(/^#\s+(.+)$/m);
    const newGoalTitle = titleMatch ? titleMatch[1].trim() : undefined;

    // 1. Write the new goal.md
    await writeFile(join(projectRoot, GOAL_FILE), goalBody, 'utf8');
    log(`New goal applied: ${newGoalTitle ?? '(no title)'}`);

    // 2. Reset milestones to empty array — runner will re-derive on next boot
    await writeFile(join(projectRoot, MILESTONES_FILE), '[]', 'utf8');
    log('Milestones reset — will be re-derived from new goal.');

    // 3. Remove next-goal.md so we don't re-apply on subsequent runs
    await unlink(join(projectRoot, NEXT_GOAL_FILE));
    log(`Removed ${NEXT_GOAL_FILE}`);

    return { applied: true, newGoalTitle };
  } catch (err: any) {
    log(`Warning: failed to apply next goal — ${err?.message ?? String(err)}`);
    return { applied: false };
  }
}
