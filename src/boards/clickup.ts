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

interface ClickUpStatusDef {
  status: string;
  type?: string;
  orderindex?: number;
}

export class ClickUpBoard implements TaskBoard {
  readonly name = 'clickup';
  private statusesPromise: Promise<ClickUpStatusDef[]> | null = null;

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
    const status = await this.resolveStatusName(
      spec.status.toLowerCase() === 'open'
        ? (this.cfg.openStatus ?? 'open')
        : (this.cfg.pendingStatus ?? 'pending'),
    );

    const res = await this.post(`/list/${this.cfg.listId}/task`, {
      name: spec.title,
      description: spec.description,
      status,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ClickUp createTask failed: ${res.status} — ${body.slice(0, 200)}`);
    }
    const task = normalise(await res.json());

    if (spec.tags.length) await this.addTags(task.id, spec.tags);
    if (spec.milestoneId) await this.postComment(task.id, `Milestone: ${spec.milestoneId}\nReason: ${spec.reason}`);

    return task;
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const resolved = await this.resolveStatusName(status);
    await this.put(`/task/${id}`, { status: resolved });
  }

  async postComment(id: string, text: string): Promise<void> {
    await this.post(`/task/${id}/comment`, { comment_text: text });
  }

  async appendUpdate(id: string, title: string, text: string): Promise<void> {
    const task = await this.fetchTask(id);
    const existing = task?.description ?? '';
    const updateBlock = [
      existing,
      '',
      '---',
      `## Update - ${title}`,
      `_Appended: ${new Date().toISOString()}_`,
      '',
      text,
    ].filter(Boolean).join('\n');

    await this.put(`/task/${id}`, { description: updateBlock });
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

  private async listStatuses(): Promise<ClickUpStatusDef[]> {
    if (!this.statusesPromise) {
      this.statusesPromise = (async () => {
        const res = await this.get(`/list/${this.cfg.listId}`);
        if (!res.ok) return [];
        const payload = await res.json() as { statuses?: unknown[] };
        return Array.isArray(payload.statuses)
          ? payload.statuses.filter(isClickUpStatusDef)
          : [];
      })();
    }

    try {
      return await this.statusesPromise;
    } catch {
      this.statusesPromise = null;
      return [];
    }
  }

  private async resolveStatusName(requested: string): Promise<string> {
    const statuses = await this.listStatuses();
    if (!statuses.length) return requested;

    const exact = findStatusByLabel(statuses, requested);
    if (exact) return exact.status;

    const internal = normaliseInternalStatusName(requested);
    const mapped = pickStatusForInternalName(statuses, internal, this.cfg);
    return mapped?.status ?? requested;
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
    status:      normaliseStatus(raw?.status),
    url:         String(raw?.url ?? ''),
    tags,
    milestoneId: undefined,
  };
}

/**
 * Map ClickUp's custom status labels to internal STATUS constants.
 * ClickUp's `status.type` is the standardised field regardless of display name:
 *   "open"        → any "not started" status (e.g. "to do", "backlog")
 *   "in_progress" → any active status
 *   "done"        → completed
 *   "closed"      → archived/closed
 */
function normaliseStatus(s: any): string {
  const type = String(s?.type ?? '').toLowerCase();
  if (type === 'open')                      return 'open';
  if (type === 'in_progress')               return 'in_progress';
  if (type === 'done' || type === 'closed') return 'done';
  // Fallback: try the raw label mapped to closest internal value
  const label = String(s?.status ?? '').toLowerCase();
  if (label === 'open' || label === 'to do' || label === 'backlog') return 'open';
  if (label === 'in progress' || label === 'in_progress')           return 'in_progress';
  if (label === 'done' || label === 'complete' || label === 'closed') return 'done';
  return 'pending';
}

function isClickUpStatusDef(value: unknown): value is ClickUpStatusDef {
  return typeof (value as ClickUpStatusDef | undefined)?.status === 'string';
}

function normaliseStatusLabel(value: string): string {
  return value.trim().toLowerCase();
}

function findStatusByLabel(statuses: ClickUpStatusDef[], requested: string): ClickUpStatusDef | undefined {
  const wanted = normaliseStatusLabel(requested);
  return statuses.find((status) => normaliseStatusLabel(status.status) === wanted);
}

function normaliseInternalStatusName(requested: string): 'open' | 'pending' | 'in_progress' | 'review' | 'done' {
  const value = normaliseStatusLabel(requested).replace(/-/g, ' ');
  if (value === 'open') return 'open';
  if (value === 'pending') return 'pending';
  if (value === 'review' || value === 'in review') return 'review';
  if (value === 'in progress' || value === 'in_progress') return 'in_progress';
  if (value === 'done' || value === 'closed' || value === 'complete') return 'done';
  return 'pending';
}

function pickStatusForInternalName(
  statuses: ClickUpStatusDef[],
  internal: 'open' | 'pending' | 'in_progress' | 'review' | 'done',
  cfg: ClickUpConfig,
): ClickUpStatusDef | undefined {
  switch (internal) {
    case 'open':
      return findStatusByLabel(statuses, cfg.openStatus ?? 'open')
        ?? findFirstByType(statuses, 'open');
    case 'pending':
      return findStatusByLabel(statuses, cfg.pendingStatus ?? 'pending')
        ?? findByKeywords(statuses, ['pending', 'backlog', 'to do', 'todo'], 'open')
        ?? findFirstByType(statuses, 'open');
    case 'review':
      return findByKeywords(statuses, ['review', 'in review', 'qa'], 'in_progress')
        ?? findFirstByType(statuses, 'in_progress');
    case 'in_progress':
      return findByKeywords(statuses, ['in progress', 'working', 'active', 'doing'], 'in_progress')
        ?? findFirstByType(statuses, 'in_progress');
    case 'done':
      return findByKeywords(statuses, ['done', 'complete', 'completed', 'closed'], 'done')
        ?? findFirstByTypes(statuses, ['done', 'closed']);
  }
}

function findFirstByType(statuses: ClickUpStatusDef[], type: string): ClickUpStatusDef | undefined {
  return statuses.find((status) => normaliseStatusLabel(status.type ?? '') === type);
}

function findFirstByTypes(statuses: ClickUpStatusDef[], types: string[]): ClickUpStatusDef | undefined {
  const wanted = new Set(types.map((type) => normaliseStatusLabel(type)));
  return statuses.find((status) => wanted.has(normaliseStatusLabel(status.type ?? '')));
}

function findByKeywords(
  statuses: ClickUpStatusDef[],
  keywords: string[],
  preferredType?: string,
): ClickUpStatusDef | undefined {
  const loweredKeywords = keywords.map((keyword) => normaliseStatusLabel(keyword));
  const typedStatuses = preferredType
    ? statuses.filter((status) => normaliseStatusLabel(status.type ?? '') === preferredType)
    : statuses;

  for (const status of typedStatuses) {
    const label = normaliseStatusLabel(status.status);
    if (loweredKeywords.some((keyword) => label.includes(keyword))) {
      return status;
    }
  }

  return undefined;
}
