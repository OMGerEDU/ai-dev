import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMemory } from '../memory.js';
import type { MemoryAdapter } from '../memory.js';

let tmpRoot: string;
let mem: LocalMemory;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'aidev-memory-'));
  mem = await LocalMemory.load(tmpRoot, 'test-project');
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('MemoryAdapter interface', () => {
  it('LocalMemory satisfies MemoryAdapter', () => {
    // Type-level assertion — if this compiles, the interface is satisfied.
    const adapter: MemoryAdapter = mem;
    expect(adapter).toBeDefined();
  });
});

describe('LocalMemory.record', () => {
  it('stores a raw event', () => {
    mem.record({ kind: 'task-success', taskName: 'test-task', provider: 'claude', model: 'sonnet', tags: [] });
    const ctx = mem.contextForTask();
    // No milestone context, just shouldn't throw
    expect(typeof ctx).toBe('string');
  });
});

describe('LocalMemory.recordTaskOutcome', () => {
  it('updates provider stats on success', () => {
    mem.recordTaskOutcome({ taskName: 't1', success: true, provider: 'claude', model: 'sonnet', tags: [] });
    const recommended = mem.recommendProvider([]);
    expect(recommended).toBe('claude');
  });

  it('updates milestone memory', () => {
    mem.recordTaskOutcome({
      taskName: 't1', milestoneId: 'm1', success: false,
      provider: 'claude', model: 'sonnet', tags: [],
      notes: 'typecheck failed', blockers: ['missing type'],
    });
    const recall = mem.recallMilestone('m1');
    expect(recall).toContain('m1');
    expect(recall).toContain('1 attempt');
    expect(recall).toContain('failure');
  });

  it('accumulates attempt counts across multiple outcomes', () => {
    mem.recordTaskOutcome({ taskName: 't1', milestoneId: 'm2', success: false, provider: 'p', model: 'm', tags: [] });
    mem.recordTaskOutcome({ taskName: 't2', milestoneId: 'm2', success: true,  provider: 'p', model: 'm', tags: [] });
    const recall = mem.recallMilestone('m2');
    expect(recall).toContain('2 attempt');
  });
});

describe('LocalMemory.recallMilestone', () => {
  it('returns default message for unknown milestones', () => {
    const result = mem.recallMilestone('nonexistent');
    expect(result).toContain('No prior attempts');
  });

  it('includes approaches tried when provided', () => {
    mem.recordTaskOutcome({
      taskName: 't1', milestoneId: 'm3', success: false,
      provider: 'claude', model: 'sonnet', tags: [],
      approachSummary: 'tried extracting interface',
    });
    const recall = mem.recallMilestone('m3');
    expect(recall).toContain('tried extracting interface');
  });
});

describe('LocalMemory.recommendProvider', () => {
  it('returns null when no stats exist', () => {
    expect(mem.recommendProvider([])).toBeNull();
  });

  it('prefers the provider with higher success rate', () => {
    mem.recordTaskOutcome({ taskName: 't1', success: true,  provider: 'claude', model: 'a', tags: [] });
    mem.recordTaskOutcome({ taskName: 't2', success: false, provider: 'gpt',    model: 'b', tags: [] });
    expect(mem.recommendProvider([])).toBe('claude');
  });
});

describe('LocalMemory.contextForTask', () => {
  it('returns empty string when no history exists', () => {
    expect(mem.contextForTask()).toBe('');
  });

  it('includes milestone recall when milestoneId is given', () => {
    mem.recordTaskOutcome({ taskName: 't', milestoneId: 'm4', success: true, provider: 'p', model: 'm', tags: [] });
    const ctx = mem.contextForTask('m4');
    expect(ctx).toContain('m4');
  });

  it('includes learned routing section when history exists', () => {
    mem.recordTaskOutcome({ taskName: 't', success: true, provider: 'claude', model: 'm', tags: ['qa'] });
    const ctx = mem.contextForTask(undefined, ['qa']);
    expect(ctx).toContain('claude');
  });
});

describe('LocalMemory persistence', () => {
  it('round-trips data through save and load', async () => {
    mem.recordTaskOutcome({ taskName: 'persisted', milestoneId: 'm5', success: true, provider: 'claude', model: 'sonnet', tags: [] });
    await mem.save();

    const reloaded = await LocalMemory.load(tmpRoot, 'test-project');
    const recall = reloaded.recallMilestone('m5');
    expect(recall).toContain('m5');
    expect(recall).toContain('success');
  });

  it('save is idempotent when nothing changed', async () => {
    await expect(mem.save()).resolves.toBeUndefined();
  });
});
