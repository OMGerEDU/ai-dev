export type { TaskBoard, TaskStatus } from './board.js';
export { STATUS } from './board.js';
export { LocalBoard } from './local.js';
export { ClickUpBoard } from './clickup.js';
export type { ClickUpConfig } from './clickup.js';

import type { TaskBoard } from './board.js';
import { ClickUpBoard } from './clickup.js';
import { LocalBoard } from './local.js';

/**
 * Resolve the best available board from environment config.
 * Falls back to LocalBoard when no external board is configured.
 */
export function resolveBoard(projectRoot: string, env: Record<string, string | undefined> = process.env as any): TaskBoard {
  const clickup = ClickUpBoard.fromEnv(env);
  if (clickup) return clickup;
  return new LocalBoard(projectRoot);
}
