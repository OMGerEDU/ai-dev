/**
 * suggestNextGoal() — calls AI to draft a follow-up goal proposal.
 *
 * After a run cycle completes this function asks the configured AI CLI to
 * read the completed milestones and produce a structured next-goal.md
 * proposal. The output is written to .aidev/next-goal.md.
 *
 * Fire-and-forget contract: errors are caught and logged; never throws.
 */

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunReport } from './run-report.js';

// ── Constants ─────────────────────────────────────────────────────────────────

export const NEXT_GOAL_FILE = '.aidev/next-goal.md';

/** Marker placed in next-goal.md while awaiting human decision */
export const APPROVAL_MARKER = '<!-- AWAITING_APPROVAL -->';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SuggestNextGoalParams {
  projectRoot: string;
  report: RunReport;
  /** Title of the goal that just completed (read from goal.md by caller if known) */
  currentGoalTitle?: string;
  /** AI CLI binary — defaults to 'claude' */
  aiCli?: string;
  /** Logger — defaults to console.log */
  log?: (...args: unknown[]) => void;
}

// ── Prompt builder ────────────────────────────────────────────────────────────

/**
 * Build the system prompt sent to the AI when requesting a next-goal proposal.
 * Pure function — no I/O.
 */
export function buildNextGoalPrompt(report: RunReport, currentGoalTitle?: string): string {
  const completedMilestones = report.milestones
    .filter((m) => m.status === 'done')
    .map((m) => `- ${m.title}`)
    .join('\n');

  const goalLine = currentGoalTitle
    ? `**Completed goal:** ${currentGoalTitle}`
    : '**Completed goal:** (title not available)';

  return [
    'You are an AI project planning assistant. An autonomous AI delivery engine just',
    'completed a development goal. Based on the work done, propose a concrete next goal.',
    '',
    goalLine,
    `**Milestones completed (${report.progress.done}/${report.progress.total}):**`,
    completedMilestones || '(none listed)',
    `**Tasks processed:** ${report.tasksProcessed}`,
    `**Duration:** ${(report.durationMs / 1000).toFixed(1)}s`,
    '',
    'Write your response in this EXACT format — it will be saved directly as next-goal.md:',
    '',
    '---',
    '# <Concise goal title>',
    '',
    '<2-3 sentence description of what this goal achieves and why it matters now.>',
    '',
    '## Success criteria',
    '- <Specific measurable criterion, include a verify command in backticks when applicable>',
    '- <Another criterion>',
    '',
    '## Constraints',
    '- <Important guardrail or hard limit>',
    '',
    '## Out of scope',
    '- <What this goal explicitly does NOT cover>',
    '',
    '---',
    '',
    '## Proposal',
    `<!-- AWAITING_APPROVAL -->`,
    '',
    '**Proposed by:** aidev (automated)',
    `**Based on:** completed run — ${report.progress.done}/${report.progress.total} milestones`,
    '',
    'To approve and start the next cycle replace the marker above with:',
    '`<!-- APPROVED -->`',
    '',
    'To reject and write your own goal instead replace it with:',
    '`<!-- REJECTED -->`',
  ].join('\n');
}

/**
 * Build a fallback next-goal.md template when the AI call fails.
 * Pure function — no I/O.
 */
export function buildNextGoalTemplate(report: RunReport, currentGoalTitle?: string): string {
  const completedList = report.milestones
    .filter((m) => m.status === 'done')
    .map((m) => `- ${m.title}`)
    .join('\n');

  return [
    '# Next Goal',
    '',
    '<!-- Fill in the goal description here -->',
    '',
    `<!-- Previous goal: ${currentGoalTitle ?? 'unknown'} -->`,
    `<!-- Completed milestones:\n${completedList || '(none)'}\n-->`,
    '',
    '## Success criteria',
    '- <!-- criterion 1 -->',
    '',
    '## Constraints',
    '- <!-- constraint 1 -->',
    '',
    '## Out of scope',
    '- <!-- out of scope item -->',
    '',
    '---',
    '',
    '## Proposal',
    `<!-- AWAITING_APPROVAL -->`,
    '',
    '**Proposed by:** aidev (template — AI suggestion unavailable)',
    `**Based on:** completed run — ${report.progress.done}/${report.progress.total} milestones`,
    '',
    'Fill in the goal above, then replace the marker with `<!-- APPROVED -->` to start the next cycle.',
  ].join('\n');
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Call AI to propose a next goal, then write .aidev/next-goal.md.
 *
 * Fire-and-forget: all errors are caught and logged; never throws.
 */
export async function suggestNextGoal(params: SuggestNextGoalParams): Promise<void> {
  const logger = params.log ?? ((...args: unknown[]) => console.log('[aidev]', ...args));
  const cli = params.aiCli ?? 'claude';

  try {
    const prompt = buildNextGoalPrompt(params.report, params.currentGoalTitle);

    logger('Requesting next-goal proposal from AI…');

    const stdout = await new Promise<string>((resolve, reject) => {
      const proc = spawn(cli, ['-p'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });

      let out = '';
      let err = '';
      proc.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      proc.stderr?.on('data', (chunk: Buffer) => { err += chunk.toString(); });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`AI CLI timed out after 60s`));
      }, 60_000);
      timer.unref();

      proc.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (code === 0 && out.trim()) {
          resolve(out.trim());
        } else {
          reject(new Error(`exit ${code ?? 'null'}${err ? ` — ${err.slice(0, 200)}` : ''}`));
        }
      });

      proc.on('error', (e: Error) => {
        clearTimeout(timer);
        reject(e);
      });

      proc.stdin?.end(prompt);
    }).catch((e: Error) => {
      logger(`Warning: AI next-goal suggestion failed (${e.message}). Writing template.`);
      return null;
    });

    let content: string;

    if (stdout) {
      content = stdout;
    } else {
      content = buildNextGoalTemplate(params.report, params.currentGoalTitle);
    }

    const destPath = join(params.projectRoot, NEXT_GOAL_FILE);
    await writeFile(destPath, content, 'utf8');
    logger(`Next-goal proposal written to ${NEXT_GOAL_FILE}`);
  } catch (err: any) {
    logger(`Warning: suggestNextGoal failed — ${err?.message ?? String(err)}`);
  }
}
