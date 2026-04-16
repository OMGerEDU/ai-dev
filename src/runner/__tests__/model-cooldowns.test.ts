import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getCooldownRegistryPath,
  loadCooldownRegistry,
  recordCooldown,
  isSelectionCooledDown,
  pruneExpiredEntries,
} from '../model-cooldowns.js';

describe('model-cooldowns', () => {
  let root: string;
  let path: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'aidev-cooldowns-'));
    path = getCooldownRegistryPath(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('saves and loads a cooldown entry', async () => {
    const entry = await recordCooldown(
      { provider: 'claude', model: 'claude-sonnet-4-6' },
      'rate_limit',
      { path, now: new Date('2026-04-16T00:40:00.000Z') },
    );

    const registry = await loadCooldownRegistry(path, new Date('2026-04-16T00:41:00.000Z'));
    expect(registry.entries).toHaveLength(1);
    expect(registry.entries[0]).toEqual(entry);
  });

  it('ignores expired entries on load', async () => {
    await recordCooldown(
      { provider: 'claude', model: 'claude-sonnet-4-6' },
      'rate_limit',
      {
        path,
        now: new Date('2026-04-16T00:40:00.000Z'),
        durationMs: 60_000,
      },
    );

    const registry = await loadCooldownRegistry(path, new Date('2026-04-16T00:42:00.000Z'));
    expect(registry.entries).toHaveLength(0);
  });

  it('detects whether a selection is still cooled down', async () => {
    await recordCooldown(
      { provider: 'codex', model: 'o4-mini' },
      'quota',
      { path, now: new Date('2026-04-16T01:00:00.000Z') },
    );

    const now = new Date('2026-04-16T01:30:00.000Z');
    const registry = await loadCooldownRegistry(path, now);
    expect(isSelectionCooledDown({ provider: 'codex', model: 'o4-mini' }, registry, now)).not.toBeNull();
    expect(isSelectionCooledDown({ provider: 'claude', model: 'claude-sonnet-4-6' }, registry, now)).toBeNull();
  });

  it('prunes expired entries from a raw list', () => {
    const pruned = pruneExpiredEntries([
      {
        provider: 'claude',
        model: 'claude-sonnet-4-6',
        cooldownUntil: '2026-04-16T02:00:00.000Z',
        reason: 'rate_limit',
        lastSeenAt: '2026-04-16T00:00:00.000Z',
      },
      {
        provider: 'codex',
        model: 'o4-mini',
        cooldownUntil: '2026-04-16T00:30:00.000Z',
        reason: 'quota',
        lastSeenAt: '2026-04-16T00:00:00.000Z',
      },
    ], new Date('2026-04-16T01:00:00.000Z'));

    expect(pruned).toHaveLength(1);
    expect(pruned[0]?.provider).toBe('claude');
  });
});
