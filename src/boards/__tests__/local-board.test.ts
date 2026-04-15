import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalBoard } from '../local.js';
import type { ContinuationSpec } from '../../engine/types.js';

function makeSpec(overrides: Partial<ContinuationSpec> = {}): ContinuationSpec {
  return {
    lane: 'qa',
    title: 'Test task',
    description: 'A test task description',
    tags: ['test'],
    status: 'Open',
    reason: 'testing',
    ...overrides,
  };
}

let tmpRoot: string;
let board: LocalBoard;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'aidev-local-board-'));
  board = new LocalBoard(tmpRoot);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('LocalBoard', () => {
  describe('createTask', () => {
    it('returns a task with id, name, and correct status', async () => {
      const task = await board.createTask(makeSpec());
      expect(task.id).toMatch(/^local-/);
      expect(task.name).toBe('Test task');
      expect(task.status).toBe('open');
      expect(task.tags).toContain('test');
    });

    it('creates task with pending status when spec status is not Open', async () => {
      const task = await board.createTask(makeSpec({ status: 'pending' }));
      expect(task.status).toBe('pending');
    });

    it('stores description in the task', async () => {
      const task = await board.createTask(makeSpec({ description: 'My description' }));
      expect(task.description).toContain('My description');
    });

    it('stores milestoneId when provided', async () => {
      const task = await board.createTask(makeSpec({ milestoneId: 'm4' }));
      expect(task.id).toMatch(/^local-/);
    });
  });

  describe('fetchTask', () => {
    it('retrieves a created task by id', async () => {
      const created = await board.createTask(makeSpec({ title: 'Fetch me' }));
      const fetched = await board.fetchTask(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.name).toBe('Fetch me');
    });

    it('returns null for unknown id', async () => {
      const result = await board.fetchTask('nonexistent-id');
      expect(result).toBeNull();
    });

    it('returns the correct status', async () => {
      const created = await board.createTask(makeSpec({ status: 'Open' }));
      const fetched = await board.fetchTask(created.id);
      expect(fetched!.status).toBe('open');
    });
  });

  describe('fetchTasks', () => {
    it('returns empty array when no tasks exist', async () => {
      const tasks = await board.fetchTasks();
      expect(tasks).toHaveLength(0);
    });

    it('returns all created tasks', async () => {
      await board.createTask(makeSpec({ title: 'Task A' }));
      await board.createTask(makeSpec({ title: 'Task B' }));
      const tasks = await board.fetchTasks();
      expect(tasks).toHaveLength(2);
    });
  });

  describe('updateStatus', () => {
    it('moves task to the new status directory', async () => {
      const created = await board.createTask(makeSpec());
      await board.updateStatus(created.id, 'done');
      const fetched = await board.fetchTask(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.status).toBe('done');
    });

    it('moves task to in-progress status', async () => {
      const created = await board.createTask(makeSpec());
      await board.updateStatus(created.id, 'in-progress');
      const fetched = await board.fetchTask(created.id);
      expect(fetched!.status).toBe('in-progress');
    });

    it('is a no-op for unknown id', async () => {
      await expect(board.updateStatus('ghost-id', 'done')).resolves.toBeUndefined();
    });
  });

  describe('markStart', () => {
    it('adds start tag and moves task to open status', async () => {
      const created = await board.createTask(makeSpec({ status: 'pending' }));
      await board.markStart(created.id);
      const fetched = await board.fetchTask(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.status).toBe('open');
      expect(fetched!.tags).toContain('start');
    });

    it('is idempotent — calling twice does not error', async () => {
      const created = await board.createTask(makeSpec());
      await board.markStart(created.id);
      await expect(board.markStart(created.id)).resolves.toBeUndefined();
    });
  });

  describe('appendUpdate', () => {
    it('appends a structured update block into the same task description', async () => {
      const created = await board.createTask(makeSpec({ title: 'History task', description: 'Original body' }));
      await board.appendUpdate(created.id, 'Fix: History task', 'New evidence and follow-up notes');

      const fetched = await board.fetchTask(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.description).toContain('Original body');
      expect(fetched!.description).toContain('## Update - Fix: History task');
      expect(fetched!.description).toContain('New evidence and follow-up notes');
    });
  });

  describe('round-trip', () => {
    it('create → fetch → updateStatus → fetch preserves identity', async () => {
      const created = await board.createTask(makeSpec({ title: 'Round trip' }));
      const before = await board.fetchTask(created.id);
      expect(before!.name).toBe('Round trip');

      await board.updateStatus(created.id, 'review');
      const after = await board.fetchTask(created.id);
      expect(after!.id).toBe(created.id);
      expect(after!.status).toBe('review');
    });
  });
});
