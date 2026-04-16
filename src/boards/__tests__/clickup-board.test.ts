import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ClickUpBoard } from '../clickup.js';
import type { ContinuationSpec } from '../../engine/types.js';

function makeSpec(overrides: Partial<ContinuationSpec> = {}): ContinuationSpec {
  return {
    lane: 'build',
    title: 'Build grocery app',
    description: 'Create the first milestone task.',
    tags: ['start', 'm1'],
    status: 'Open',
    reason: 'board vacuum bootstrap',
    ...overrides,
  };
}

describe('ClickUpBoard', () => {
  const fetchMock = jest.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock;
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  it('creates tasks using a valid list status when the configured status name is absent', async () => {
    const board = new ClickUpBoard({
      apiKey: 'pk_test',
      listId: '123',
      openStatus: 'open',
      pendingStatus: 'pending',
      startTag: 'start',
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        statuses: [
          { status: 'To Do', type: 'open' },
          { status: 'In Progress', type: 'in_progress' },
          { status: 'Done', type: 'done' },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'task-1',
        name: 'Build grocery app',
        description: 'Create the first milestone task.',
        status: { status: 'To Do', type: 'open' },
        url: 'https://app.clickup.com/t/task-1',
        tags: [],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'task-1',
        name: 'Build grocery app',
        description: 'Create the first milestone task.',
        status: { status: 'To Do', type: 'open' },
        url: 'https://app.clickup.com/t/task-1',
        tags: [],
      }), { status: 200 }))
      .mockResolvedValue(new Response('', { status: 200 }));

    const task = await board.createTask(makeSpec());

    expect(task.id).toBe('task-1');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
    });
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain('"status":"To Do"');
  });

  it('maps internal update statuses onto valid ClickUp statuses by type', async () => {
    const board = new ClickUpBoard({
      apiKey: 'pk_test',
      listId: '123',
      openStatus: 'open',
      pendingStatus: 'pending',
      startTag: 'start',
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        statuses: [
          { status: 'Backlog', type: 'open' },
          { status: 'Working', type: 'in_progress' },
          { status: 'Complete', type: 'done' },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'task-1',
        name: 'Build grocery app',
        description: 'Create the first milestone task.',
        status: { status: 'Backlog', type: 'open' },
        url: 'https://app.clickup.com/t/task-1',
        tags: [],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValue(new Response('', { status: 200 }));

    await board.updateStatus('task-1', 'review');
    await board.updateStatus('task-1', 'done');

    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain('"status":"Working"');
    expect(String(fetchMock.mock.calls[2]?.[1]?.body)).toContain('"status":"Complete"');
  });

  it('markStart uses a valid open status instead of the internal default', async () => {
    const board = new ClickUpBoard({
      apiKey: 'pk_test',
      listId: '123',
      openStatus: 'open',
      pendingStatus: 'pending',
      startTag: 'start',
    });

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.endsWith('/list/123')) {
        return new Response(JSON.stringify({
          statuses: [
            { status: 'Backlog', type: 'open' },
            { status: 'Working', type: 'in_progress' },
            { status: 'Complete', type: 'done' },
          ],
        }), { status: 200 });
      }

      if (url.endsWith('/task/task-1') && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify({
          id: 'task-1',
          name: 'Build grocery app',
          description: 'Create the first milestone task.',
          status: { status: 'Backlog', type: 'open' },
          url: 'https://app.clickup.com/t/task-1',
          tags: [],
        }), { status: 200 });
      }

      return new Response('', { status: 200 });
    });

    await board.markStart('task-1');

    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain('"status":"Backlog"');
  });
});
