export type { TaskBoard, TaskStatus } from './board.js';
export { STATUS } from './board.js';
export { LocalBoard } from './local.js';
export { ClickUpBoard } from './clickup.js';
export type { ClickUpConfig } from './clickup.js';
export { LinearBoard } from './linear.js';
export type { LinearConfig } from './linear.js';

import type { TaskBoard } from './board.js';
import { ClickUpBoard } from './clickup.js';
import { LinearBoard } from './linear.js';
import { LocalBoard } from './local.js';

/**
 * Resolve the best available board from environment config.
 * Priority: ClickUp → Linear → LocalBoard (default).
 */
export function resolveBoard(projectRoot: string, env: Record<string, string | undefined> = process.env as any): TaskBoard {
  const clickup = ClickUpBoard.fromEnv(env);
  if (clickup) return clickup;
  const linear = LinearBoard.fromEnv(env);
  if (linear) return linear;
  return new LocalBoard(projectRoot);
}
