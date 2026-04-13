import { z } from 'zod';

/**
 * ACI-style structured output schema for every agent task completion.
 *
 * Inspired by SWE-agent's Agent-Computer Interface insight:
 * structured, typed outputs cut hallucinated "done" claims dramatically.
 *
 * Every task must produce a valid TaskOutput or it stays open.
 */

// ── Core schema ───────────────────────────────────────────────────────────────

export const TaskOutputSchema = z.object({
  /** Files written or meaningfully modified */
  artifactsProduced: z.array(z.string()).default([]),

  /** Shell commands the agent ran and their exit status */
  commandsRun: z.array(z.object({
    cmd: z.string(),
    exitCode: z.number(),
    passed: z.boolean(),
  })).default([]),

  /** Result of the milestone's verifyCmd if it was run */
  testsResult: z.enum(['pass', 'fail', 'skipped', 'not-run']).default('not-run'),

  /** Whether the agent believes this task advanced the milestone */
  milestoneAdvanced: z.boolean(),

  /**
   * Agent's confidence in its own output.
   * low → do not auto-advance milestone; create a QA task first.
   */
  confidence: z.enum(['high', 'medium', 'low']),

  /** Blockers the agent hit that it could not resolve */
  blockers: z.array(z.string()).default([]),

  /** Free-form notes for the next agent (what was tried, what worked, what didn't) */
  notes: z.string().optional(),

  /** Which milestone ID this output corresponds to */
  milestoneId: z.string().optional(),
});

export type TaskOutput = z.infer<typeof TaskOutputSchema>;

// ── Validation ────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  output: TaskOutput | null;
  errors: string[];
}

/**
 * Parse and validate raw agent output (typically a JSON block extracted
 * from the agent's response text).
 */
export function validateTaskOutput(raw: unknown): ValidationResult {
  const result = TaskOutputSchema.safeParse(raw);

  if (result.success) {
    return { valid: true, output: result.data, errors: [] };
  }

  const errors = result.error.issues.map(
    (issue) => `${issue.path.join('.')}: ${issue.message}`
  );
  return { valid: false, output: null, errors };
}

/**
 * Extract a JSON block from free-form agent text.
 * Looks for ```json ... ``` or a raw top-level object.
 */
export function extractJsonFromAgentText(text: string): unknown | null {
  // Try fenced code block first
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch { /* fall through */ }
  }

  // Try raw JSON object
  const rawMatch = text.match(/\{[\s\S]*\}/);
  if (rawMatch) {
    try { return JSON.parse(rawMatch[0]); } catch { /* fall through */ }
  }

  return null;
}

// ── Derived signals ───────────────────────────────────────────────────────────

/**
 * Determine whether a task output represents genuine completion.
 * A task is "really done" only when:
 *  - tests passed (or were skipped with high confidence)
 *  - no unresolved blockers
 *  - confidence is not low
 */
export function isGenuinelyDone(output: TaskOutput): boolean {
  if (output.confidence === 'low') return false;
  if (output.blockers.length > 0) return false;
  if (output.testsResult === 'fail') return false;
  if (!output.milestoneAdvanced) return false;
  return true;
}

/**
 * Produce a human-readable summary of a task output for ClickUp comments
 * or local task notes.
 */
export function summariseOutput(output: TaskOutput): string {
  const lines: string[] = [
    `Confidence: ${output.confidence}`,
    `Tests: ${output.testsResult}`,
    `Milestone advanced: ${output.milestoneAdvanced ? 'yes' : 'no'}`,
  ];

  if (output.artifactsProduced.length) {
    lines.push(`Artifacts: ${output.artifactsProduced.join(', ')}`);
  }
  if (output.blockers.length) {
    lines.push(`Blockers: ${output.blockers.join('; ')}`);
  }
  if (output.notes) {
    lines.push(`Notes: ${output.notes}`);
  }

  return lines.join('\n');
}
