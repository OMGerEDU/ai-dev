import { z } from 'zod';

// ── SkillEntry — discriminated union by source type ───────────────────────────

export const NpmSkillSchema = z.object({
  id: z.string(),
  source: z.literal('npm'),
  package: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
});

export const McpSkillSchema = z.object({
  id: z.string(),
  source: z.literal('mcp'),
  server: z.string(),
  transport: z.enum(['stdio', 'http']).default('stdio'),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  description: z.string().optional(),
});

export const GitSkillSchema = z.object({
  id: z.string(),
  source: z.literal('git'),
  repo: z.string(),
  ref: z.string().default('main'),
  path: z.string().optional(),
  description: z.string().optional(),
});

export const SkillEntrySchema = z.discriminatedUnion('source', [
  NpmSkillSchema,
  McpSkillSchema,
  GitSkillSchema,
]);

export type NpmSkill = z.infer<typeof NpmSkillSchema>;
export type McpSkill = z.infer<typeof McpSkillSchema>;
export type GitSkill = z.infer<typeof GitSkillSchema>;
export type SkillEntry = z.infer<typeof SkillEntrySchema>;

export const SkillsFileSchema = z.object({
  skills: z.array(SkillEntrySchema),
});
