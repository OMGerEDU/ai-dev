/**
 * Episodic memory — per-project learning store.
 *
 * Persisted to .aidev/memory.json.
 * Answers questions like:
 *   "What did we try for milestone m2?"
 *   "Which provider succeeded on research tasks in this repo?"
 *   "What failure patterns keep repeating?"
 *
 * Design: append-only event log + indexed summary.
 * Raw events are kept for debugging; summaries are what the engine reads.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// ── Event types ───────────────────────────────────────────────────────────────

export type MemoryEventKind =
  | 'task-success'
  | 'task-failure'
  | 'milestone-verified'
  | 'milestone-failed'
  | 'milestone-escalated'
  | 'provider-selected'
  | 'approach-tried'
  | 'blocker-hit';

export interface MemoryEvent {
  kind: MemoryEventKind;
  timestamp: string;
  milestoneId?: string;
  taskName?: string;
  provider?: string;
  model?: string;
  tags?: string[];
  notes?: string;
  evidence?: string;      // test output, error message, etc.
}

// ── Summary (indexed, fast to read) ──────────────────────────────────────────

export interface ProviderStats {
  successes: number;
  failures: number;
  avgTier: string;
}

export interface MilestoneMemory {
  id: string;
  attemptCount: number;
  lastStatus: 'success' | 'failure' | 'escalated';
  approachesTried: string[];
  blockers: string[];
  lastNote?: string;
}

export interface MemoryStore {
  projectName: string;
  lastUpdated: string;
  providerStats: Record<string, ProviderStats>;    // provider → stats
  milestones: Record<string, MilestoneMemory>;     // milestoneId → memory
  repeatingFailures: string[];                     // patterns that keep reappearing
  events: MemoryEvent[];                           // full append-only log
}

// ── Memory class ──────────────────────────────────────────────────────────────

const MEMORY_FILE = '.aidev/memory.json';
const MAX_EVENTS  = 500;  // trim oldest when exceeded

export class ProjectMemory {
  private store: MemoryStore;
  private dirty = false;

  constructor(private readonly projectRoot: string, projectName: string) {
    this.store = emptyStore(projectName);
  }

  static async load(projectRoot: string, projectName = 'unknown'): Promise<ProjectMemory> {
    const mem = new ProjectMemory(projectRoot, projectName);
    await mem.loadFromDisk();
    return mem;
  }

  // ── Write API ──────────────────────────────────────────────────────────────

  record(event: Omit<MemoryEvent, 'timestamp'>): void {
    const full: MemoryEvent = { ...event, timestamp: new Date().toISOString() };
    this.store.events.push(full);
    this.indexEvent(full);
    this.dirty = true;

    if (this.store.events.length > MAX_EVENTS) {
      this.store.events = this.store.events.slice(-MAX_EVENTS);
    }
  }

  recordTaskOutcome(opts: {
    taskName: string;
    milestoneId?: string;
    success: boolean;
    provider: string;
    model: string;
    tags: string[];
    notes?: string;
    evidence?: string;
    blockers?: string[];
    approachSummary?: string;
  }): void {
    this.record({
      kind: opts.success ? 'task-success' : 'task-failure',
      milestoneId: opts.milestoneId,
      taskName: opts.taskName,
      provider: opts.provider,
      model: opts.model,
      tags: opts.tags,
      notes: opts.notes,
      evidence: opts.evidence,
    });

    // Update provider stats
    const stats = this.store.providerStats[opts.provider] ?? { successes: 0, failures: 0, avgTier: opts.model };
    if (opts.success) stats.successes++; else stats.failures++;
    this.store.providerStats[opts.provider] = stats;

    // Update milestone memory
    if (opts.milestoneId) {
      const mem = this.store.milestones[opts.milestoneId] ?? {
        id: opts.milestoneId, attemptCount: 0,
        lastStatus: 'failure', approachesTried: [], blockers: [],
      };
      mem.attemptCount++;
      mem.lastStatus = opts.success ? 'success' : 'failure';
      if (opts.approachSummary) mem.approachesTried.push(opts.approachSummary);
      if (opts.blockers) mem.blockers.push(...opts.blockers);
      if (opts.notes) mem.lastNote = opts.notes;
      this.store.milestones[opts.milestoneId] = mem;
    }
  }

  // ── Read API ───────────────────────────────────────────────────────────────

  /** Return a natural-language summary of what was tried for a milestone */
  recallMilestone(milestoneId: string): string {
    const mem = this.store.milestones[milestoneId];
    if (!mem) return `No prior attempts recorded for milestone ${milestoneId}.`;

    const lines = [
      `Milestone ${milestoneId}: ${mem.attemptCount} attempt(s), last status: ${mem.lastStatus}.`,
    ];
    if (mem.approachesTried.length) {
      lines.push(`Approaches tried: ${mem.approachesTried.slice(-3).join('; ')}`);
    }
    if (mem.blockers.length) {
      lines.push(`Known blockers: ${[...new Set(mem.blockers)].slice(-3).join('; ')}`);
    }
    if (mem.lastNote) {
      lines.push(`Last note: ${mem.lastNote}`);
    }
    return lines.join('\n');
  }

  /** Return which provider has the best success rate for given tags */
  recommendProvider(tags: string[]): string | null {
    const entries = Object.entries(this.store.providerStats);
    if (!entries.length) return null;

    const ranked = entries
      .map(([provider, stats]) => ({
        provider,
        rate: stats.successes / Math.max(1, stats.successes + stats.failures),
      }))
      .sort((a, b) => b.rate - a.rate);

    return ranked[0]?.provider ?? null;
  }

  /** Compact summary for injecting into task prompts */
  contextForTask(milestoneId?: string, tags?: string[]): string {
    const lines: string[] = [];

    if (milestoneId) {
      const recall = this.recallMilestone(milestoneId);
      if (recall) lines.push(`### Prior work on this milestone\n${recall}`);
    }

    const recommended = tags ? this.recommendProvider(tags) : null;
    if (recommended) {
      lines.push(`### Learned routing: ${recommended} has the best track record for this task type in this project`);
    }

    return lines.join('\n\n');
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async save(): Promise<void> {
    if (!this.dirty) return;
    this.store.lastUpdated = new Date().toISOString();
    const path = join(this.projectRoot, MEMORY_FILE);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(this.store, null, 2), 'utf8');
    this.dirty = false;
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const text = await readFile(join(this.projectRoot, MEMORY_FILE), 'utf8');
      this.store = JSON.parse(text) as MemoryStore;
    } catch {
      // Fresh store — keep the empty default
    }
  }

  private indexEvent(event: MemoryEvent): void {
    if (event.kind === 'milestone-escalated' && event.milestoneId) {
      const msg = `Milestone ${event.milestoneId} escalated: ${event.notes ?? ''}`;
      if (!this.store.repeatingFailures.includes(msg)) {
        this.store.repeatingFailures.push(msg);
      }
    }
  }
}

function emptyStore(projectName: string): MemoryStore {
  return {
    projectName,
    lastUpdated: new Date().toISOString(),
    providerStats: {},
    milestones: {},
    repeatingFailures: [],
    events: [],
  };
}
