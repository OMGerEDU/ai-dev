// Shared domain types used across the engine

export type TaskLane = 'build' | 'qa' | 'research' | 'planning' | 'review';
export type MilestoneStatus = 'pending' | 'in-progress' | 'done' | 'blocked' | 'escalated';
export type GoalStatus = 'not-started' | 'in-progress' | 'done';

// ── Milestone ─────────────────────────────────────────────────────────────────

export interface Milestone {
  id: string;
  title: string;
  acceptanceCriteria: string[];
  verifyCmd?: string;       // exits 0 → milestone met
  status: MilestoneStatus;
  lane: TaskLane;
  dependsOn: string[];      // milestone IDs that must be 'done' first
  lastVerified?: string;    // ISO timestamp
  failureCount: number;     // consecutive verifyCmd failures
  notes?: string;           // last agent run findings
}

// ── Goal ──────────────────────────────────────────────────────────────────────

export interface Goal {
  title: string;
  description: string;
  successCriteria: string[];
  constraints: string[];
  outOfScope: string[];
  status: GoalStatus;
}

// ── Task (as aidev sees it) ───────────────────────────────────────────────────

export interface AidevTask {
  id: string;
  name: string;
  description: string;
  status: string;
  url: string;
  tags: string[];
}

// ── Continuation spec (what the engine generates) ────────────────────────────

export interface ContinuationSpec {
  lane: TaskLane;
  title: string;
  description: string;
  tags: string[];
  status: 'Open' | 'pending';
  reason: string;
  milestoneId?: string;     // which milestone this task advances
}

// ── Escalation ────────────────────────────────────────────────────────────────

export interface EscalationEvent {
  milestoneId: string;
  milestoneTitle: string;
  failureCount: number;
  lastError?: string;
  timestamp: string;
}
