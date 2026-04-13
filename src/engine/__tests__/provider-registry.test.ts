import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  selectProvider,
  resetRegistryCache,
} from '../provider-registry.js';
import type { ProviderRegistry, TaskLike } from '../provider-registry.js';

const REGISTRY: ProviderRegistry = {
  providers: {
    claude: {
      cli: 'claude',
      available: true,
      models: { high: 'claude-opus-4-6', medium: 'claude-sonnet-4-6', low: 'claude-haiku-4-5-20251001' },
      strengths: ['code-gen', 'reasoning', 'long-context'],
      weaknesses: ['math'],
      costTier: 'high',
      contextWindow: 200_000,
    },
    codex: {
      cli: 'codex',
      available: false,
      models: { high: 'codex-high', medium: 'codex-medium', low: 'codex-low' },
      strengths: ['code-gen'],
      weaknesses: ['reasoning'],
      costTier: 'low',
      contextWindow: 8_000,
    },
  },
  taskStrengthMap: {
    refactor: ['code-gen', 'reasoning'],
    review: ['reasoning'],
    'read-only': [],
  },
  tierForTask: {
    architect: 'high',
    qa: 'medium',
    'read-only': 'low',
  },
  readOnlyTasks: ['read-only'],
};

beforeEach(() => resetRegistryCache());

describe('selectProvider', () => {
  it('selects the only available provider', () => {
    const task: TaskLike = { name: 'test', tags: ['refactor'], status: 'Open' };
    const sel = selectProvider(task, REGISTRY);
    expect(sel.provider).toBe('claude');
  });

  it('uses explicit provider tag as strongest signal', () => {
    const task: TaskLike = { name: 'test', tags: ['claude'], status: 'Open' };
    const sel = selectProvider(task, REGISTRY);
    expect(sel.provider).toBe('claude');
    expect(sel.score).toBeGreaterThanOrEqual(50);
  });

  it('derives medium tier by default', () => {
    const task: TaskLike = { name: 'test', tags: ['qa'], status: 'Open' };
    const sel = selectProvider(task, REGISTRY);
    expect(sel.tier).toBe('medium');
  });

  it('derives high tier for architect tag', () => {
    const task: TaskLike = { name: 'test', tags: ['architect'], status: 'Open' };
    const sel = selectProvider(task, REGISTRY);
    expect(sel.tier).toBe('high');
  });

  it('downtiers read-only tasks to low', () => {
    const task: TaskLike = { name: 'test', tags: ['read-only'], status: 'Open' };
    const sel = selectProvider(task, REGISTRY);
    expect(sel.tier).toBe('low');
  });

  it('throws when no providers available', () => {
    const noAvail: ProviderRegistry = {
      ...REGISTRY,
      providers: {
        codex: { ...REGISTRY.providers.codex, available: false },
      },
    };
    const task: TaskLike = { name: 'test', tags: [], status: 'Open' };
    expect(() => selectProvider(task, noAvail)).toThrow('No available AI providers');
  });

  it('skips unavailable providers (score -1)', () => {
    const task: TaskLike = { name: 'test', tags: ['codex'], status: 'Open' };
    const sel = selectProvider(task, REGISTRY);
    // codex is unavailable, falls back to claude
    expect(sel.provider).toBe('claude');
  });
});
