import type { AidevTask, ContinuationSpec } from '../engine/types.js';

/**
 * TaskBoard — the only interface aidev-core uses to read and write tasks.
 *
 * Implementations: LocalBoard (default), ClickUpBoard, and any future board.
 * A project's aidev.hooks.ts selects which board to use by returning one
 * from createBoard().
 */
export interface TaskBoard {
  /** Return all tasks visible to the scheduler */
  fetchTasks(): Promise<AidevTask[]>;

  /** Return a single task by id, or null if not found */
  fetchTask(id: string): Promise<AidevTask | null>;

  /** Create a new task from a continuation spec. Returns the created task. */
  createTask(spec: ContinuationSpec): Promise<AidevTask>;

  /** Move a task to a new status string */
  updateStatus(id: string, status: string): Promise<void>;

  /** Append a comment / note to a task */
  postComment(id: string, text: string): Promise<void>;

  /** Append a structured update block to the task description/history */
  appendUpdate(id: string, title: string, text: string): Promise<void>;

  /** Add tags to a task (idempotent) */
  addTags(id: string, tags: string[]): Promise<void>;

  /** Mark a task as the active "start" task */
  markStart(id: string): Promise<void>;

  /** Return the board name for logging */
  readonly name: string;
}

// ── Status constants ──────────────────────────────────────────────────────────

export const STATUS = {
  PENDING:     'pending',
  OPEN:        'open',
  IN_PROGRESS: 'in progress',
  REVIEW:      'review',
  DONE:        'done',
} as const;

export type TaskStatus = typeof STATUS[keyof typeof STATUS];
