// Public engine API — everything a hooks file or CLI needs

export * from './types.js';
export * from './goal-engine.js';
export * from './milestone-engine.js';
export * from './provider-registry.js';
export { validateTaskOutput, extractJsonFromAgentText, isGenuinelyDone, summariseOutput, TaskOutputSchema } from '../output/task-output.js';
export type { TaskOutput, ValidationResult } from '../output/task-output.js';
