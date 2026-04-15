/**
 * LocalBoard — zero-dependency task board backed by .aidev/tasks/ markdown files.
 *
 * Default board when no external service is configured.
 * Each task is a markdown file with YAML frontmatter.
 * Status is tracked by which subdirectory it lives in.
 */

import { mkdir, readdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { TaskBoard } from './board.js';
import type { AidevTask, ContinuationSpec } from '../engine/types.js';

const TASK_DIRS = ['open', 'pending', 'in-progress', 'review', 'done'] as const;

export class LocalBoard implements TaskBoard {
  readonly name = 'local';

  constructor(private readonly root: string) {}

  private get tasksDir() {
    return join(this.root, '.aidev', 'tasks');
  }

  async fetchTasks(): Promise<AidevTask[]> {
    const tasks: AidevTask[] = [];
    for (const dir of TASK_DIRS) {
      const dirPath = join(this.tasksDir, dir);
      let files: string[] = [];
      try { files = await readdir(dirPath); } catch { continue; }
      for (const file of files.filter((f) => f.endsWith('.md'))) {
        const task = await this.readTaskFile(join(dirPath, file), dir);
        if (task) tasks.push(task);
      }
    }
    return tasks;
  }

  async fetchTask(id: string): Promise<AidevTask | null> {
    const tasks = await this.fetchTasks();
    return tasks.find((t) => t.id === id) ?? null;
  }

  async createTask(spec: ContinuationSpec): Promise<AidevTask> {
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const status = spec.status.toLowerCase() === 'open' ? 'open' : 'pending';
    const dir = join(this.tasksDir, status);
    await mkdir(dir, { recursive: true });

    const filename = `${slugify(spec.title)}.md`;
    const content = buildTaskMarkdown(id, spec);
    await writeFile(join(dir, filename), content, 'utf8');

    return {
      id,
      name: spec.title,
      description: spec.description,
      status,
      url: join(dir, filename),
      tags: spec.tags,
      milestoneId: spec.milestoneId,
    };
  }

  async updateStatus(id: string, newStatus: string): Promise<void> {
    const tasks = await this.fetchTasks();
    const task = tasks.find((t) => t.id === id);
    if (!task || !task.url) return;

    const targetDir = join(this.tasksDir, normaliseStatus(newStatus));
    await mkdir(targetDir, { recursive: true });
    const dest = join(targetDir, basename(task.url));
    await rename(task.url, dest);
  }

  async postComment(id: string, text: string): Promise<void> {
    const tasks = await this.fetchTasks();
    const task = tasks.find((t) => t.id === id);
    if (!task?.url) return;

    const existing = await readFile(task.url, 'utf8').catch(() => '');
    const comment = `\n\n<!-- comment: ${new Date().toISOString()} -->\n${text}`;
    await writeFile(task.url, existing + comment, 'utf8');
  }

  async appendUpdate(id: string, title: string, text: string): Promise<void> {
    const tasks = await this.fetchTasks();
    const task = tasks.find((t) => t.id === id);
    if (!task?.url) return;

    const existing = await readFile(task.url, 'utf8').catch(() => '');
    const updateBlock = [
      '',
      '---',
      `## Update - ${title}`,
      `_Appended: ${new Date().toISOString()}_`,
      '',
      text,
    ].join('\n');
    await writeFile(task.url, existing + updateBlock, 'utf8');
  }

  async addTags(id: string, tags: string[]): Promise<void> {
    const tasks = await this.fetchTasks();
    const task = tasks.find((t) => t.id === id);
    if (!task?.url) return;

    let content = await readFile(task.url, 'utf8').catch(() => '');
    for (const tag of tags) {
      if (!task.tags.includes(tag)) {
        content = content.replace(/^tags: (.*)$/m, (_, existing) => `tags: ${existing}, ${tag}`);
      }
    }
    await writeFile(task.url, content, 'utf8');
  }

  async markStart(id: string): Promise<void> {
    await this.addTags(id, ['start']);
    await this.updateStatus(id, 'open');
  }

  private async readTaskFile(filepath: string, status: string): Promise<AidevTask | null> {
    try {
      const text = await readFile(filepath, 'utf8');
      const id    = extractFrontmatter(text, 'id') ?? basename(filepath, '.md');
      const name  = extractFrontmatter(text, 'title') ?? id;
      const tagsRaw = extractFrontmatter(text, 'tags') ?? '';
      const milestoneId = extractFrontmatter(text, 'milestone') ?? undefined;
      const tags  = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
      const desc  = extractBody(text);

      return { id, name, description: desc, status, url: filepath, tags, milestoneId };
    } catch {
      return null;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildTaskMarkdown(id: string, spec: ContinuationSpec): string {
  return [
    '---',
    `id: ${id}`,
    `title: ${spec.title}`,
    `tags: ${spec.tags.join(', ')}`,
    `status: ${spec.status.toLowerCase()}`,
    `lane: ${spec.lane}`,
    `created: ${new Date().toISOString()}`,
    spec.milestoneId ? `milestone: ${spec.milestoneId}` : '',
    '---',
    '',
    spec.description,
    '',
    `> Reason: ${spec.reason}`,
  ].filter((l) => l !== undefined).join('\n');
}

function extractFrontmatter(text: string, key: string): string | null {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

function extractBody(text: string): string {
  const parts = text.split(/^---\s*$/m);
  return parts.length >= 3 ? parts.slice(2).join('---').trim().slice(0, 600) : '';
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'task';
}

function normaliseStatus(s: string): string {
  const map: Record<string, string> = {
    'open': 'open', 'pending': 'pending',
    'in progress': 'in-progress', 'in-progress': 'in-progress',
    'review': 'review', 'done': 'done',
  };
  return map[s.toLowerCase()] ?? 'pending';
}
