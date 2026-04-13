import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProviderName = string; // open-ended: 'claude' | 'codex' | 'antigravity' | any future CLI
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
  taskStrengthMap: Record<string, string[]>;   // tag → required strengths
  tierForTask: Record<string, ModelTier>;       // tag → default model tier
  readOnlyTasks: string[];                      // tags that get auto-downtiered
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

// ── Scoring ───────────────────────────────────────────────────────────────────

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

  // Explicit provider tag is the strongest signal
  if (hasTag(task, name)) score += 50;

  // Match each task tag against this provider's strengths via strength map
  for (const tag of task.tags ?? []) {
    const requiredStrengths = registry.taskStrengthMap[tag.toLowerCase()] ?? [];
    for (const strength of requiredStrengths) {
      if (def.strengths.includes(strength)) score += 10;
    }
    if (def.weaknesses.some((w) => requiredStrengths.includes(w))) score -= 8;
  }

  // Large-context bonus
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
  // Read-only tasks are auto-downtiered to save cost (OpenHands insight)
  const isReadOnly = (task.tags ?? []).some((t) =>
    registry.readOnlyTasks.includes(t.toLowerCase())
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

/**
 * Select the best available provider and model for a task.
 * Score-based — handles mixed-tag tasks gracefully.
 * Falls back through available providers by score order.
 */
export function selectProvider(
  task: TaskLike,
  registry: ProviderRegistry,
): ProviderSelection {
  const candidates = (
    Object.entries(registry.providers) as [ProviderName, ProviderDef][]
  )
    .map(([name, def]) => ({ name, def, score: scoreProvider(name, def, task, registry) }))
    .filter((c) => c.score >= 0)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    // Absolute fallback — first available provider at medium tier
    const fallback = (
      Object.entries(registry.providers) as [ProviderName, ProviderDef][]
    ).find(([, def]) => def.available);
    if (!fallback) throw new Error('No available AI providers in registry');
    const [name, def] = fallback;
    return { provider: name, cli: def.cli, model: def.models.medium, tier: 'medium', score: 0, reason: 'fallback-only-available' };
  }

  const best = candidates[0];
  const tier = deriveTier(task, registry);
  const model = best.def.models[tier] ?? best.def.models.medium;

  return {
    provider: best.name,
    cli: best.def.cli,
    model,
    tier,
    score: best.score,
    reason: `score:${best.score} tier:${tier} tags:[${(task.tags ?? []).join(',')}]`,
  };
}

// ── Registry loader ───────────────────────────────────────────────────────────

let _cached: ProviderRegistry | null = null;

export async function loadProviderRegistry(
  projectRoot: string,
  agentsEnv?: string,
): Promise<ProviderRegistry> {
  if (_cached) return _cached;

  // Project-local providers.json takes precedence; fall back to bundled template
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

  // Override availability from AGENTS= env var
  const activeSet = new Set(
    (agentsEnv ?? process.env['AGENTS'] ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  if (activeSet.size > 0) {
    for (const [name, def] of Object.entries(raw.providers)) {
      def.available = activeSet.has(name.toLowerCase());
    }
  }

  _cached = raw;
  return raw;
}

export function resetRegistryCache(): void {
  _cached = null;
}
