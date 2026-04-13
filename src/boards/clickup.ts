/**
 * ClickUpBoard — task board backed by the ClickUp API.
 *
 * Configure via .env.aidev:
 *   CLICKUP_API_KEY=pk_...
 *   CLICKUP_LIST_ID=...
 *   CLICKUP_OPEN_STATUS=open
 *   CLICKUP_PENDING_STATUS=pending
 */

import type { TaskBoard } from './board.js';
import type { AidevTask, ContinuationSpec } from '../engine/types.js';

const API = 'https://api.clickup.com/api/v2';

export interface ClickUpConfig {
  apiKey: string;
  listId: string;
  openStatus?: string;
  pendingStatus?: string;
  startTag?: string;
}

export class ClickUpBoard implements TaskBoard {
  readonly name = 'clickup';

  constructor(private readonly cfg: ClickUpConfig) {}

  static fromEnv(env: Record<string, string | undefined> = process.env as any): ClickUpBoard | null {
    const apiKey = env['CLICKUP_API_KEY'] ?? env['CLICKUP_API'];
    const listId = env['CLICKUP_LIST_ID'];
    if (!apiKey || !listId) return null;
    return new ClickUpBoard({
      apiKey,
      listId,
      openStatus:    env['CLICKUP_OPEN_STATUS']    ?? 'open',
      pendingStatus: env['CLICKUP_PENDING_STATUS'] ?? 'pending',
      startTag:      env['CLICKUP_TAG']            ?? 'start',
    });
  }

  async fetchTasks(): Promise<AidevTask[]> {
    const res = await this.get(`/list/${this.cfg.listId}/task?archived=false&page=0`);
    const payload = await res.json() as { tasks?: unknown[] };
    return Array.isArray(payload.tasks) ? payload.tasks.map(normalise) : [];
  }

  async fetchTask(id: string): Promise<AidevTask | null> {
    const res = await this.get(`/task/${id}`);
    if (!res.ok) return null;
    return normalise(await res.json());
  }

  async createTask(spec: ContinuationSpec): Promise<AidevTask> {
    const status = spec.status.toLowerCase() === 'open'
      ? (this.cfg.openStatus ?? 'open')
      : (this.cfg.pendingStatus ?? 'pending');

    const res = await this.post(`/list/${this.cfg.listId}/task`, {
      name: spec.title,
      description: spec.description,
      status,
    });

    if (!res.ok) throw new Error(`ClickUp createTask failed: ${res.status}`);
    const task = normalise(await res.json());

    if (spec.tags.length) await this.addTags(task.id, spec.tags);
    if (spec.milestoneId) await this.postComment(task.id, `Milestone: ${spec.milestoneId}\nReason: ${spec.reason}`);

    return task;
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.put(`/task/${id}`, { status });
  }

  async postComment(id: string, text: string): Promise<void> {
    await this.post(`/task/${id}/comment`, { comment_text: text });
  }

  async addTags(id: string, tags: string[]): Promise<void> {
    const task = await this.fetchTask(id);
    const existing = new Set((task?.tags ?? []).map((t) => t.toLowerCase()));
    for (const tag of tags) {
      if (!existing.has(tag.toLowerCase())) {
        await this.post(`/task/${id}/tag/${encodeURIComponent(tag)}`, null);
        existing.add(tag.toLowerCase());
      }
    }
  }

  async markStart(id: string): Promise<void> {
    await this.updateStatus(id, this.cfg.openStatus ?? 'open');
    await this.addTags(id, [this.cfg.startTag ?? 'start']);
    await this.postComment(id, 'start');
  }

  // ── HTTP helpers ────────────────────────────────────────────────────────────

  private headers() {
    return { Authorization: this.cfg.apiKey, 'Content-Type': 'application/json' };
  }

  private get(path: string)  { return fetch(`${API}${path}`, { headers: this.headers() }); }
  private post(path: string, body: unknown) {
    return fetch(`${API}${path}`, { method: 'POST', headers: this.headers(), body: body != null ? JSON.stringify(body) : undefined });
  }
  private put(path: string, body: unknown) {
    return fetch(`${API}${path}`, { method: 'PUT', headers: this.headers(), body: JSON.stringify(body) });
  }
}

// ── Normalisation ─────────────────────────────────────────────────────────────

function normalise(raw: any): AidevTask {
  const tags: string[] = Array.isArray(raw?.tags)
    ? raw.tags.map((t: any) => (typeof t === 'string' ? t : t?.name ?? '')).filter(Boolean)
    : [];
  return {
    id:          String(raw?.id ?? ''),
    name:        String(raw?.name ?? ''),
    description: String(raw?.description ?? raw?.text_content ?? ''),
    status:      String(raw?.status?.status ?? raw?.status ?? 'pending'),
    url:         String(raw?.url ?? ''),
    tags,
  };
}
