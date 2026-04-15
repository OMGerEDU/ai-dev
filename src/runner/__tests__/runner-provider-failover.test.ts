import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TaskBoard } from '../../boards/board.js';
import type { AidevTask, ContinuationSpec } from '../../engine/types.js';
import { loadCooldownRegistry, recordCooldown } from '../model-cooldowns.js';

const spawnSyncMock = jest.fn();
const execSyncMock = jest.fn(() => 'main\n');
const postEndOfCycleReportMock = jest.fn(async () => undefined);

jest.unstable_mockModule('node:child_process', () => ({
  execSync: execSyncMock,
  spawnSync: spawnSyncMock,
}));

jest.unstable_mockModule('../end-of-cycle.js', () => ({
  postEndOfCycleReport: postEndOfCycleReportMock,
}));

const { Runner } = await import('../runner.js');

class MemoryBoard implements TaskBoard {
  readonly name = 'memory-board';

  constructor(private readonly tasks: AidevTask[]) {}

  async fetchTasks(): Promise<AidevTask[]> {
    return this.tasks;
  }

  async fetchTask(id: string): Promise<AidevTask | null> {
    return this.tasks.find((task) => task.id === id) ?? null;
  }

  async createTask(spec: ContinuationSpec): Promise<AidevTask> {
    const created: AidevTask = {
      id: `task-${this.tasks.length + 1}`,
      name: spec.title,
      description: spec.description,
      status: spec.status.toLowerCase(),
      url: '',
      tags: spec.tags,
    };
    this.tasks.push(created);
    return created;
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const task = this.tasks.find((item) => item.id === id);
    if (task) task.status = status;
  }

  async postComment(): Promise<void> {}

  async appendUpdate(id: string, title: string, text: string): Promise<void> {
    const task = this.tasks.find((item) => item.id === id);
    if (!task) return;
    task.description = [task.description, '---', `## Update - ${title}`, text].join('\n');
  }

  async addTags(id: string, tags: string[]): Promise<void> {
    const task = this.tasks.find((item) => item.id === id);
    if (!task) return;
    for (const tag of tags) {
      if (!task.tags.includes(tag)) task.tags.push(tag);
    }
  }

  async markStart(id: string): Promise<void> {
    await this.addTags(id, ['start']);
    await this.updateStatus(id, 'open');
  }
}

describe('Runner provider failover', () => {
  let projectRoot: string;
  let cooldownPath: string;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'aidev-runner-failover-'));
    cooldownPath = join(projectRoot, '.tmp', 'model-cooldowns.json');
    await mkdir(join(projectRoot, '.aidev'), { recursive: true });

    await writeFile(join(projectRoot, '.aidev', 'goal.md'), [
      '# Failover Goal',
      '',
      'Verify runtime provider fallback.',
      '',
      '## Success criteria',
      '',
      '- Planning task succeeds after provider failover',
      '',
      '## Constraints',
      '',
      '- Keep behavior deterministic',
      '',
      '## Out of scope',
      '',
      '- Anything unrelated',
    ].join('\n'), 'utf8');

    await writeFile(join(projectRoot, '.aidev', 'milestones.json'), JSON.stringify([
      {
        id: 'm1',
        title: 'Planning task succeeds after provider failover',
        acceptanceCriteria: ['Planning task succeeds after provider failover'],
        status: 'pending',
        lane: 'planning',
        dependsOn: [],
        failureCount: 0,
      },
    ], null, 2), 'utf8');

    await writeFile(join(projectRoot, '.aidev', 'providers.json'), JSON.stringify({
      providers: {
        claude: {
          cli: 'claude',
          available: true,
          models: { high: 'claude-opus', medium: 'claude-sonnet', low: 'claude-haiku' },
          strengths: ['planning', 'reasoning'],
          weaknesses: [],
          costTier: 'high',
          contextWindow: 200000,
        },
        codex: {
          cli: 'codex',
          available: true,
          models: { high: 'o3', medium: 'o4-mini', low: 'gpt-4o-mini' },
          strengths: ['implementation'],
          weaknesses: [],
          costTier: 'medium',
          contextWindow: 128000,
        },
      },
      taskStrengthMap: {
        planning: ['planning'],
      },
      readOnlyTasks: [],
      tierForTask: {
        planning: 'medium',
      },
    }, null, 2), 'utf8');

    spawnSyncMock.mockReset();
    execSyncMock.mockClear();
    postEndOfCycleReportMock.mockClear();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('retries the task with codex when claude exits with a rate-limit failure', async () => {
    spawnSyncMock.mockImplementation((cli: unknown) => {
      const command = String(cli);
      if (command === 'claude') {
        return {
          status: 1,
          stdout: '',
          stderr: '429 rate limit exceeded for claude',
        };
      }

      if (command === 'codex') {
        return {
          status: 0,
          stdout: [
            '```json',
            '{"milestoneAdvanced":true,"testsResult":"pass","confidence":"high","blockers":[],"notes":"used codex fallback"}',
            '```',
          ].join('\n'),
          stderr: '',
        };
      }

      throw new Error(`Unexpected CLI: ${command}`);
    });

    const board = new MemoryBoard([
      {
        id: 'task-1',
        name: 'Plan the failover fix',
        description: 'Retry with codex when claude is unavailable.',
        status: 'open',
        url: '',
        tags: ['start', 'planning'],
      },
    ]);

    const runner = new Runner({
      projectRoot,
      config: {
        AGENTS: 'claude,codex',
        AIDEV_COOLDOWN_REGISTRY_PATH: cooldownPath,
      },
      hooks: {
        createBoard: () => board,
        buildProjectContext: () => '',
        buildTaskGuidance: () => '',
      },
      maxTasks: 1,
    });

    await runner.run();

    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
    expect(spawnSyncMock.mock.calls[0]?.[0]).toBe('claude');
    expect(spawnSyncMock.mock.calls[1]?.[0]).toBe('codex');
    expect(spawnSyncMock.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['-p', '--model', 'claude-sonnet']));
    expect(spawnSyncMock.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(['exec', '--model', 'o4-mini', '-']));

    const milestones = JSON.parse(await readFile(join(projectRoot, '.aidev', 'milestones.json'), 'utf8')) as Array<{ status: string }>;
    expect(milestones[0]?.status).toBe('done');

    const task = await board.fetchTask('task-1');
    expect(task?.status).toBe('done');
  });

  it('halts the run without creating duplicate continuations when fallback output is not structured', async () => {
    spawnSyncMock.mockImplementation((cli: unknown) => {
      const command = String(cli);
      if (command === 'claude') {
        return {
          status: 1,
          stdout: '',
          stderr: '429 rate limit exceeded for claude',
        };
      }

      if (command === 'codex') {
        return {
          status: 0,
          stdout: [
            'OpenAI Codex v0.118.0 (research preview)',
            '--------',
            'user',
            '## Project: Test',
            '',
            'No final JSON was produced.',
          ].join('\n'),
          stderr: '',
        };
      }

      throw new Error(`Unexpected CLI: ${command}`);
    });

    const board = new MemoryBoard([
      {
        id: 'task-1',
        name: 'Plan the failover fix',
        description: 'Retry with codex when claude is unavailable.',
        status: 'open',
        url: '',
        tags: ['start', 'planning'],
      },
    ]);

    const runner = new Runner({
      projectRoot,
      config: {
        AGENTS: 'claude,codex',
        AIDEV_COOLDOWN_REGISTRY_PATH: cooldownPath,
      },
      hooks: {
        createBoard: () => board,
        buildProjectContext: () => '',
        buildTaskGuidance: () => '',
      },
      maxTasks: 3,
    });

    await runner.run();

    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
    expect((await board.fetchTasks()).map((task) => task.name)).toEqual(['Plan the failover fix']);
    expect((await board.fetchTask('task-1'))?.status).toBe('review');

    const milestones = JSON.parse(
      await readFile(join(projectRoot, '.aidev', 'milestones.json'), 'utf8'),
    ) as Array<{ status: string }>;
    expect(milestones[0]?.status).toBe('pending');
  });

  it('merges matching build and fix continuations into the same mission', async () => {
    spawnSyncMock.mockImplementation((cli: unknown) => {
      const command = String(cli);
      if (command === 'claude') {
        return {
          status: 0,
          stdout: [
            '```json',
            '{"milestoneAdvanced":false,"testsResult":"not-run","confidence":"medium","blockers":[],"notes":"needs another pass"}',
            '```',
          ].join('\n'),
          stderr: '',
        };
      }

      throw new Error(`Unexpected CLI: ${command}`);
    });

    const board = new MemoryBoard([
      {
        id: 'task-1',
        name: 'Build: Planning task succeeds after provider failover',
        description: 'Initial mission description',
        status: 'open',
        url: '',
        tags: ['start', 'planning', 'm1'],
        milestoneId: 'm1',
      },
    ]);

    const runner = new Runner({
      projectRoot,
      config: {
        AGENTS: 'claude',
        AIDEV_COOLDOWN_REGISTRY_PATH: cooldownPath,
      },
      hooks: {
        createBoard: () => board,
        buildProjectContext: () => '',
        buildTaskGuidance: () => '',
      },
      maxTasks: 1,
    });

    await runner.run();

    const tasks = await board.fetchTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe('task-1');
    expect(tasks[0]?.description).toContain('Initial mission description');
  });

  it('records a cooldown for a rate-limited provider and skips it on the next run', async () => {
    spawnSyncMock.mockImplementation((cli: unknown) => {
      const command = String(cli);
      if (command === 'claude') {
        return {
          status: 1,
          stdout: '',
          stderr: '429 rate limit exceeded for claude',
        };
      }

      if (command === 'codex') {
        return {
          status: 0,
          stdout: [
            '```json',
            '{"milestoneAdvanced":true,"testsResult":"pass","confidence":"high","blockers":[],"notes":"used codex fallback"}',
            '```',
          ].join('\n'),
          stderr: '',
        };
      }

      throw new Error(`Unexpected CLI: ${command}`);
    });

    const firstBoard = new MemoryBoard([
      {
        id: 'task-1',
        name: 'Plan the failover fix',
        description: 'Retry with codex when claude is unavailable.',
        status: 'open',
        url: '',
        tags: ['start', 'planning'],
      },
    ]);

    const firstRunner = new Runner({
      projectRoot,
      config: {
        AGENTS: 'claude,codex',
        AIDEV_COOLDOWN_REGISTRY_PATH: cooldownPath,
      },
      hooks: {
        createBoard: () => firstBoard,
        buildProjectContext: () => '',
        buildTaskGuidance: () => '',
      },
      maxTasks: 1,
    });

    await firstRunner.run();

    const cooldowns = await loadCooldownRegistry(cooldownPath);
    expect(cooldowns.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'claude',
        model: 'claude-sonnet',
        reason: expect.stringContaining('rate limit'),
      }),
    ]));

    spawnSyncMock.mockReset();
    spawnSyncMock.mockImplementation((cli: unknown) => {
      const command = String(cli);
      if (command === 'codex') {
        return {
          status: 0,
          stdout: [
            '```json',
            '{"milestoneAdvanced":true,"testsResult":"pass","confidence":"high","blockers":[],"notes":"codex directly selected"}',
            '```',
          ].join('\n'),
          stderr: '',
        };
      }

      throw new Error(`Unexpected CLI: ${command}`);
    });

    await writeFile(join(projectRoot, '.aidev', 'milestones.json'), JSON.stringify([
      {
        id: 'm1',
        title: 'Planning task succeeds after provider failover',
        acceptanceCriteria: ['Planning task succeeds after provider failover'],
        status: 'pending',
        lane: 'planning',
        dependsOn: [],
        failureCount: 0,
      },
    ], null, 2), 'utf8');

    const secondBoard = new MemoryBoard([
      {
        id: 'task-2',
        name: 'Plan another failover fix',
        description: 'Claude should be skipped during cooldown.',
        status: 'open',
        url: '',
        tags: ['start', 'planning'],
      },
    ]);

    const secondRunner = new Runner({
      projectRoot,
      config: {
        AGENTS: 'claude,codex',
        AIDEV_COOLDOWN_REGISTRY_PATH: cooldownPath,
      },
      hooks: {
        createBoard: () => secondBoard,
        buildProjectContext: () => '',
        buildTaskGuidance: () => '',
      },
      maxTasks: 1,
    });

    await secondRunner.run();

    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock.mock.calls[0]?.[0]).toBe('codex');
  });

  it('stops cleanly with guidance when all configured models are cooling down', async () => {
    await recordCooldown(
      { provider: 'claude', model: 'claude-sonnet' },
      '429 rate limit exceeded for claude',
      {
        path: cooldownPath,
        now: new Date('2026-04-16T00:40:00.000Z'),
      },
    );
    await recordCooldown(
      { provider: 'codex', model: 'o4-mini' },
      'quota exceeded for codex',
      {
        path: cooldownPath,
        now: new Date('2026-04-16T00:40:00.000Z'),
      },
    );

    const board = new MemoryBoard([
      {
        id: 'task-1',
        name: 'Plan the failover fix',
        description: 'Retry with codex when claude is unavailable.',
        status: 'open',
        url: '',
        tags: ['start', 'planning'],
      },
    ]);

    const runner = new Runner({
      projectRoot,
      config: {
        AGENTS: 'claude,codex',
        AIDEV_COOLDOWN_REGISTRY_PATH: cooldownPath,
      },
      hooks: {
        createBoard: () => board,
        buildProjectContext: () => '',
        buildTaskGuidance: () => '',
      },
      maxTasks: 1,
    });

    await runner.run();

    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect((await board.fetchTask('task-1'))?.status).toBe('open');
    expect(consoleLogSpy.mock.calls.flat().join('\n')).toContain('All configured providers are cooling down');
  });
});
