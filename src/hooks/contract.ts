/**
 * HookContract — the interface every .aidev/aidev.hooks.ts must implement.
 *
 * Projects only need to override what they care about.
 * Every method has a default in DefaultHooks.
 *
 * Design principle: hooks inject project-specific knowledge.
 *   The engine handles everything else.
 */

import type { AidevTask, ContinuationSpec } from '../engine/types.js';
import type { TaskBoard } from '../boards/board.js';
import type { ProviderSelection } from '../engine/provider-registry.js';

// ── Context types passed to hooks ─────────────────────────────────────────────

export interface RunContext {
  projectRoot: string;
  config: Record<string, string | undefined>;
  taskCount: number;
}

export interface TaskContext {
  task: AidevTask;
  projectRoot: string;
  config: Record<string, string | undefined>;
  branchName: string;
  prompt: string;
  providerSelection: ProviderSelection;
}

export interface TaskResultContext extends TaskContext {
  success: boolean;
  rawOutput?: string;        // raw text the AI produced
}

export interface ConflictContext {
  task: AidevTask;
  projectRoot: string;
  config: Record<string, string | undefined>;
  branchName: string;
  conflictFiles: string[];
  prompt: string;
}

// ── The contract ──────────────────────────────────────────────────────────────

export interface HookContract {
  /**
   * Return the board to use for this project.
   * Default: resolveBoard() — ClickUp if API key present, LocalBoard otherwise.
   */
  createBoard(context: RunContext): TaskBoard | Promise<TaskBoard>;

  /**
   * Inject project-specific context into the prompt before each task.
   * Receives the base context already built by the engine (project probe, milestone state).
   * Return the full context string to prepend to the prompt.
   */
  buildProjectContext(context: RunContext): string | Promise<string>;

  /**
   * Inject domain-specific guidance for a particular task.
   * Called after provider selection. Add constraints, warnings, style notes.
   * Return extra lines to append to the task guidance block.
   */
  buildTaskGuidance(task: AidevTask, selection: ProviderSelection): string | Promise<string>;

  /**
   * Override or augment continuation specs before they are posted to the board.
   * Return the modified array — remove, add, or reorder as needed.
   */
  filterContinuations(
    specs: ContinuationSpec[],
    context: TaskResultContext,
  ): ContinuationSpec[] | Promise<ContinuationSpec[]>;

  /**
   * Called at the very start of a run, before any tasks are processed.
   * Good place for health checks, environment validation, or logging.
   */
  beforeRun(context: RunContext): void | Promise<void>;

  /**
   * Called after the prompt is built but before the AI is invoked.
   * Can mutate context.prompt to inject last-minute content.
   */
  beforeTask(context: TaskContext): TaskContext | Promise<TaskContext>;

  /**
   * Called after the task result is known and output validated.
   * The engine has already updated milestones and generated continuations by this point.
   * Good place for notifications, custom status updates, or post-task logging.
   */
  afterTask(context: TaskResultContext): void | Promise<void>;

  /**
   * Called at the end of a run after all tasks are processed.
   */
  afterRun(context: RunContext & { processed: number; skipped: number }): void | Promise<void>;

  /**
   * Called before merge conflict resolution.
   * Return the context with an augmented prompt if needed.
   */
  beforeResolveConflicts(context: ConflictContext): ConflictContext | Promise<ConflictContext>;
}
