import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ProviderSelection } from '../engine/provider-registry.js';

export interface ModelCooldownEntry {
  provider: string;
  model: string;
  cooldownUntil: string;
  reason: string;
  lastSeenAt: string;
}

export interface ModelCooldownRegistry {
  entries: ModelCooldownEntry[];
}

const DEFAULT_COOLDOWN_MS = 2 * 60 * 60 * 1000;

export function getCooldownRegistryPath(homeDir: string = homedir()): string {
  return join(homeDir, '.aidev', 'model-cooldowns.json');
}

export function cooldownKey(provider: string, model: string): string {
  return `${provider.toLowerCase()}::${model}`;
}

export function pruneExpiredEntries(
  entries: ModelCooldownEntry[],
  now: Date = new Date(),
): ModelCooldownEntry[] {
  const nowMs = now.getTime();
  return entries.filter((entry) => Date.parse(entry.cooldownUntil) > nowMs);
}

export async function loadCooldownRegistry(
  path: string = getCooldownRegistryPath(),
  now: Date = new Date(),
): Promise<ModelCooldownRegistry> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as ModelCooldownRegistry;
    return { entries: pruneExpiredEntries(raw.entries ?? [], now) };
  } catch {
    return { entries: [] };
  }
}

export async function saveCooldownRegistry(
  registry: ModelCooldownRegistry,
  path: string = getCooldownRegistryPath(),
  now: Date = new Date(),
): Promise<void> {
  const cleaned = { entries: pruneExpiredEntries(registry.entries, now) };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cleaned, null, 2) + '\n', 'utf8');
}

export function isSelectionCooledDown(
  selection: Pick<ProviderSelection, 'provider' | 'model'>,
  registry: ModelCooldownRegistry,
  now: Date = new Date(),
): ModelCooldownEntry | null {
  const key = cooldownKey(selection.provider, selection.model);
  const nowMs = now.getTime();
  return registry.entries.find((entry) =>
    cooldownKey(entry.provider, entry.model) === key
    && Date.parse(entry.cooldownUntil) > nowMs,
  ) ?? null;
}

export async function recordCooldown(
  selection: Pick<ProviderSelection, 'provider' | 'model'>,
  reason: string,
  options: {
    path?: string;
    now?: Date;
    durationMs?: number;
  } = {},
): Promise<ModelCooldownEntry> {
  const now = options.now ?? new Date();
  const durationMs = options.durationMs ?? DEFAULT_COOLDOWN_MS;
  const path = options.path ?? getCooldownRegistryPath();
  const registry = await loadCooldownRegistry(path, now);
  const key = cooldownKey(selection.provider, selection.model);

  const entry: ModelCooldownEntry = {
    provider: selection.provider,
    model: selection.model,
    cooldownUntil: new Date(now.getTime() + durationMs).toISOString(),
    reason,
    lastSeenAt: now.toISOString(),
  };

  const others = registry.entries.filter((item) => cooldownKey(item.provider, item.model) !== key);
  await saveCooldownRegistry({ entries: [...others, entry] }, path, now);
  return entry;
}
