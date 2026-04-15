import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type ProviderName = string;
export type ModelTier = 'high' | 'medium' | 'low';

export interface ProviderDef {
  cli: string;
  available: boolean;
  models: Record<ModelTier, string>;
  strengths: string[];
  weaknesses: string[];
  costTier: 'high' | 'medium' | 'low';
  contextWindow: number;
}

export interface ProviderRegistry {
  providers: Record<ProviderName, ProviderDef>;
  taskStrengthMap: Record<string, string[]>;
  tierForTask: Record<string, ModelTier>;
  readOnlyTasks: string[];
}

export interface ProviderSelection {
  provider: ProviderName;
  cli: string;
  model: string;
  tier: ModelTier;
  score: number;
  reason: string;
}

export interface TaskLike {
  name: string;
  tags: string[];
  status: string;
}

export type ProviderEligibilityFn = (selection: ProviderSelection) => boolean;

function hasTag(task: TaskLike, tag: string): boolean {
  return (task.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase());
}

function scoreProvider(
  name: ProviderName,
  def: ProviderDef,
  task: TaskLike,
  registry: ProviderRegistry,
): number {
  if (!def.available) return -1;

  let score = 0;

  if (hasTag(task, name)) score += 50;

  for (const tag of task.tags ?? []) {
    const requiredStrengths = registry.taskStrengthMap[tag.toLowerCase()] ?? [];
    for (const strength of requiredStrengths) {
      if (def.strengths.includes(strength)) score += 10;
    }
    if (def.weaknesses.some((w) => requiredStrengths.includes(w))) score -= 8;
  }

  if (
    hasTag(task, 'long-doc') ||
    hasTag(task, 'codebase-survey') ||
    hasTag(task, 'multi-modal')
  ) {
    if (def.contextWindow >= 500_000) score += 20;
  }

  return score;
}

function deriveTier(task: TaskLike, registry: ProviderRegistry): ModelTier {
  const readOnlyTasks = registry.readOnlyTasks ?? [];
  const isReadOnly = (task.tags ?? []).some((t) =>
    readOnlyTasks.includes(t.toLowerCase())
  );
  if (isReadOnly) return 'low';

  let tier: ModelTier = 'medium';
  for (const tag of task.tags ?? []) {
    const mapped = registry.tierForTask[tag.toLowerCase()];
    if (mapped === 'high') return 'high';
    if (mapped === 'low') tier = 'low';
  }
  return tier;
}

export function selectProvider(
  task: TaskLike,
  registry: ProviderRegistry,
): ProviderSelection {
  const candidates = rankProviders(task, registry);
  return candidates[0];
}

export function rankProviders(
  task: TaskLike,
  registry: ProviderRegistry,
): ProviderSelection[] {
  const candidates = (
    Object.entries(registry.providers) as [ProviderName, ProviderDef][]
  )
    .map(([name, def]) => ({ name, def, score: scoreProvider(name, def, task, registry) }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    throw new Error('No available AI providers in registry');
  }

  const tier = deriveTier(task, registry);
  return candidates.map((candidate) => ({
    provider: candidate.name,
    cli: candidate.def.cli,
    model: candidate.def.models[tier] ?? candidate.def.models.medium,
    tier,
    score: candidate.score,
    reason: `score:${candidate.score} tier:${tier} tags:[${(task.tags ?? []).join(',')}]`,
  }));
}

export function rankEligibleProviders(
  task: TaskLike,
  registry: ProviderRegistry,
  isEligible: ProviderEligibilityFn,
): ProviderSelection[] {
  const ranked = rankProviders(task, registry);
  const eligible = ranked.filter((selection) => isEligible(selection));

  if (!eligible.length) {
    throw new Error('No eligible AI providers in registry');
  }

  return eligible;
}

let registryCache: ProviderRegistry | null = null;

export async function loadProviderRegistry(
  projectRoot: string,
  agentsEnv?: string,
): Promise<ProviderRegistry> {
  if (registryCache) return registryCache;

  let raw: ProviderRegistry;
  try {
    const text = await readFile(join(projectRoot, '.aidev/providers.json'), 'utf8');
    raw = JSON.parse(text) as ProviderRegistry;
  } catch {
    const text = await readFile(
      join(import.meta.url.replace('file:///', '').replace('src/engine/provider-registry.js', ''), 'templates/providers.json'),
      'utf8',
    );
    raw = JSON.parse(text) as ProviderRegistry;
  }

  const activeSet = new Set(
    (agentsEnv ?? process.env['AGENTS'] ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  if (activeSet.size > 0) {
    for (const [name, def] of Object.entries(raw.providers)) {
      def.available = activeSet.has(name.toLowerCase());
    }
  }

  registryCache = raw;
  return raw;
}

export function resetRegistryCache(): void {
  registryCache = null;
}
