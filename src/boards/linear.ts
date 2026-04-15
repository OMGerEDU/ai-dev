/**
 * LinearBoard — task board backed by the Linear GraphQL API.
 *
 * Configure via .env.aidev:
 *   LINEAR_API_KEY=lin_api_...
 *   LINEAR_TEAM_ID=...
 *   LINEAR_STATUS_OPEN=Todo
 *   LINEAR_STATUS_PENDING=Backlog
 */

import type { TaskBoard } from './board.js';
import type { AidevTask, ContinuationSpec } from '../engine/types.js';

const GQL_URL = 'https://api.linear.app/graphql';

export interface LinearConfig {
  apiKey: string;
  teamId: string;
  statusOpen?: string;
  statusPending?: string;
  startLabel?: string;
}

export class LinearBoard implements TaskBoard {
  readonly name = 'linear';

  constructor(private readonly cfg: LinearConfig) {}

  static fromEnv(env: Record<string, string | undefined> = process.env as any): LinearBoard | null {
    const apiKey = env['LINEAR_API_KEY'];
    const teamId = env['LINEAR_TEAM_ID'];
    if (!apiKey || !teamId) return null;
    return new LinearBoard({
      apiKey,
      teamId,
      statusOpen:    env['LINEAR_STATUS_OPEN']    ?? 'Todo',
      statusPending: env['LINEAR_STATUS_PENDING'] ?? 'Backlog',
      startLabel:    env['LINEAR_TAG']            ?? 'start',
    });
  }

  async fetchTasks(): Promise<AidevTask[]> {
    const query = `
      query($teamId: String!) {
        issues(filter: { team: { id: { eq: $teamId } } }) {
          nodes {
            id title description url
            state { name type }
            labels { nodes { name } }
          }
        }
      }
    `;
    const data = await this.gql<{ issues: { nodes: unknown[] } }>(query, { teamId: this.cfg.teamId });
    return (data.issues.nodes ?? []).map(normalise);
  }

  async fetchTask(id: string): Promise<AidevTask | null> {
    const query = `
      query($id: String!) {
        issue(id: $id) {
          id title description url
          state { name type }
          labels { nodes { name } }
        }
      }
    `;
    try {
      const data = await this.gql<{ issue: unknown }>(query, { id });
      return normalise(data.issue);
    } catch {
      return null;
    }
  }

  async createTask(spec: ContinuationSpec): Promise<AidevTask> {
    const statusName = spec.status.toLowerCase() === 'open'
      ? (this.cfg.statusOpen ?? 'Todo')
      : (this.cfg.statusPending ?? 'Backlog');

    const stateId = await this.resolveStateId(statusName);

    const mutation = `
      mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id title description url
            state { name type }
            labels { nodes { name } }
          }
        }
      }
    `;
    const input: Record<string, unknown> = {
      teamId: this.cfg.teamId,
      title: spec.title,
      description: spec.description,
    };
    if (stateId) input['stateId'] = stateId;

    const data = await this.gql<{ issueCreate: { success: boolean; issue: unknown } }>(mutation, { input });
    if (!data.issueCreate.success) throw new Error('LinearBoard: issueCreate returned success=false');

    const task = normalise(data.issueCreate.issue);
    if (spec.tags.length) await this.addTags(task.id, spec.tags);
    if (spec.milestoneId) await this.postComment(task.id, `Milestone: ${spec.milestoneId}\nReason: ${spec.reason}`);

    return task;
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const stateId = await this.resolveStateId(status);
    if (!stateId) return;

    const mutation = `
      mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success }
      }
    `;
    await this.gql(mutation, { id, input: { stateId } });
  }

  async postComment(id: string, text: string): Promise<void> {
    const mutation = `
      mutation($input: CommentCreateInput!) {
        commentCreate(input: $input) { success }
      }
    `;
    await this.gql(mutation, { input: { issueId: id, body: text } });
  }

  async addTags(id: string, tags: string[]): Promise<void> {
    const issue = await this.fetchTask(id);
    const existingTags = new Set(issue?.tags ?? []);
    const allTags = [...existingTags, ...tags.filter((t) => !existingTags.has(t))];

    const labelIds = (
      await Promise.all(allTags.map((l) => this.resolveOrCreateLabel(l)))
    ).filter((lid): lid is string => lid !== null);

    const mutation = `
      mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success }
      }
    `;
    await this.gql(mutation, { id, input: { labelIds } });
  }

  async markStart(id: string): Promise<void> {
    await this.updateStatus(id, this.cfg.statusOpen ?? 'Todo');
    await this.addTags(id, [this.cfg.startLabel ?? 'start']);
    await this.postComment(id, 'start');
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private async resolveStateId(name: string): Promise<string | null> {
    const query = `
      query($teamId: String!) {
        workflowStates(filter: { team: { id: { eq: $teamId } } }) {
          nodes { id name }
        }
      }
    `;
    const data = await this.gql<{ workflowStates: { nodes: Array<{ id: string; name: string }> } }>(
      query, { teamId: this.cfg.teamId }
    );
    const state = data.workflowStates.nodes.find(
      (s) => s.name.toLowerCase() === name.toLowerCase()
    );
    return state?.id ?? null;
  }

  private async resolveOrCreateLabel(name: string): Promise<string | null> {
    const query = `
      query($teamId: String!) {
        issueLabels(filter: { team: { id: { eq: $teamId } } }) {
          nodes { id name }
        }
      }
    `;
    const data = await this.gql<{ issueLabels: { nodes: Array<{ id: string; name: string }> } }>(
      query, { teamId: this.cfg.teamId }
    );
    const existing = data.issueLabels.nodes.find(
      (l) => l.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) return existing.id;

    const mutation = `
      mutation($input: IssueLabelCreateInput!) {
        issueLabelCreate(input: $input) {
          success
          issueLabel { id name }
        }
      }
    `;
    try {
      const created = await this.gql<{
        issueLabelCreate: { success: boolean; issueLabel: { id: string; name: string } };
      }>(mutation, { input: { teamId: this.cfg.teamId, name } });
      return created.issueLabelCreate.issueLabel?.id ?? null;
    } catch {
      return null;
    }
  }

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(GQL_URL, {
      method: 'POST',
      headers: {
        Authorization: this.cfg.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Linear API ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = await res.json() as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) {
      throw new Error(`Linear GraphQL: ${json.errors.map((e) => e.message).join(', ')}`);
    }
    return json.data as T;
  }
}

// ── Normalisation ─────────────────────────────────────────────────────────────

function normalise(raw: any): AidevTask {
  const tags: string[] = Array.isArray(raw?.labels?.nodes)
    ? raw.labels.nodes
        .map((l: any) => (typeof l === 'string' ? l : String(l?.name ?? '')))
        .filter(Boolean)
    : [];

  return {
    id:          String(raw?.id ?? ''),
    name:        String(raw?.title ?? ''),
    description: String(raw?.description ?? ''),
    status:      normaliseStatus(raw?.state),
    url:         String(raw?.url ?? ''),
    tags,
  };
}

function normaliseStatus(state: any): string {
  const type = String(state?.type ?? '').toLowerCase();
  if (type === 'backlog')    return 'pending';
  if (type === 'unstarted')  return 'open';
  if (type === 'started')    return 'in_progress';
  if (type === 'completed')  return 'done';
  if (type === 'cancelled')  return 'done';
  const name = String(state?.name ?? '').toLowerCase();
  if (name === 'todo')        return 'open';
  if (name === 'backlog')     return 'pending';
  if (name === 'in progress') return 'in_progress';
  if (name === 'done')        return 'done';
  return 'pending';
}
