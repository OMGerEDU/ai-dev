/**
 * Runner — the aidev orchestrator.
 *
 * Loop:
 *   1. Pick next open task from board (filtered by start tag)
 *   2. Build prompt = project context + milestone state + memory + task guidance
 *   3. Call AI provider via CLI
 *   4. Validate structured output (Zod ACI schema)
 *   5. Run milestone verifyCmd → update milestone state
 *   6. Generate gap-driven continuations → post to board
 *   7. Record outcome in memory
 *   8. Repeat until no tasks remain or goal is complete
 */

import { execSync, spawnSync } from 'node:child_process';
import type { HookContract, RunContext, TaskContext, TaskResultContext } from '../hooks/contract.js';
import { DefaultHooks } from '../hooks/defaults.js';
import type { TaskBoard } from '../boards/board.js';
import { STATUS } from '../boards/board.js';
import type { AidevTask, ContinuationSpec, Milestone } from '../engine/types.js';
import { loadGoal, loadMilestones, saveMilestones, deriveMilestonesFromGoal, measureProgress, getActiveMilestone } from '../engine/goal-engine.js';
import { advanceMilestone, buildGapContinuations, persistMilestoneUpdate } from '../engine/milestone-engine.js';
import { loadProviderRegistry, selectProvider } from '../engine/provider-registry.js';
import { extractJsonFromAgentText, validateTaskOutput, isGenuinelyDone, summariseOutput } from '../output/task-output.js';
import { ProjectMemory } from '../memory/memory.js';

// ── Config ────────────────────────────────────────────────────────────────────

export interface RunnerConfig {
  projectRoot: string;
  config: Record<string, string | undefined>;
  hooks?: Partial<HookContract>;
  dryRun?: boolean;          // log prompts but don't call AI
  maxTasks?: number;         // safety cap per run
  startTag?: string;         // tag that marks a task as ready to run
}

const DEFAULT_MAX_TASKS = 20;
const DEFAULT_START_TAG = 'start';

// ── Runner ────────────────────────────────────────────────────────────────────

export class Runner {
  private readonly hooks: HookContract;
  private board!: TaskBoard;
  private memory!: ProjectMemory;

  constructor(private readonly cfg: RunnerConfig) {
    // Merge project hooks over defaults.
    // Object spread on a class instance loses prototype methods, so we
    // explicitly delegate each method: project override first, then default.
    const d = new DefaultHooks();
    const p = cfg.hooks ?? {};
    this.hooks = {
      createBoard:            (p.createBoard            ?? d.createBoard.bind(d)),
      buildProjectContext:    (p.buildProjectContext    ?? d.buildProjectContext.bind(d)),
      buildTaskGuidance:      (p.buildTaskGuidance      ?? d.buildTaskGuidance.bind(d)),
      filterContinuations:    (p.filterContinuations    ?? d.filterContinuations.bind(d)),
      beforeRun:              (p.beforeRun              ?? d.beforeRun.bind(d)),
      beforeTask:             (p.beforeTask             ?? d.beforeTask.bind(d)),
      afterTask:              (p.afterTask              ?? d.afterTask.bind(d)),
      afterRun:               (p.afterRun               ?? d.afterRun.bind(d)),
      beforeResolveConflicts: (p.beforeResolveConflicts ?? d.beforeResolveConflicts.bind(d)),
    };
  }

  async run(): Promise<void> {
    const { projectRoot, config } = this.cfg;
    const maxTasks  = this.cfg.maxTasks  ?? DEFAULT_MAX_TASKS;
    const startTag  = this.cfg.startTag  ?? config['AIDEV_TRIGGER_WORD'] ?? DEFAULT_START_TAG;

    // ── Boot ──────────────────────────────────────────────────────────────────
    const runCtx: RunContext = { projectRoot, config, taskCount: 0 };
    this.board  = await this.hooks.createBoard(runCtx);
    this.memory = await ProjectMemory.load(projectRoot);

    const registry = await loadProviderRegistry(projectRoot, config['AGENTS']).catch(() => {
      throw new Error('Could not load provider registry. Run `aidev init` first.');
    });

    // Ensure milestones exist
    let milestones = await loadMilestones(projectRoot);
    if (!milestones.length) {
      const goal = await loadGoal(projectRoot);
      if (goal) {
        milestones = deriveMilestonesFromGoal(goal);
        await saveMilestones(projectRoot, milestones);
        log(`Generated ${milestones.length} milestones from goal.md`);
      }
    }

    await this.hooks.beforeRun({ ...runCtx, taskCount: 0 });

    // ── Main loop ─────────────────────────────────────────────────────────────
    let processed = 0;
    let skipped   = 0;

    while (processed < maxTasks) {
      const tasks = await this.board.fetchTasks();
      const task  = pickNextTask(tasks, startTag);

      if (!task) {
        log('No runnable tasks found. Checking for board vacuum...');
        const filled = await this.handleBoardVacuum(milestones);
        if (!filled) break;   // no milestone left — truly done
        continue;             // retry loop with the newly created task
      }

      // Check goal completion
      milestones = await loadMilestones(projectRoot);
      const progress = measureProgress(milestones);
      if (progress.isComplete) {
        log(`Goal complete — all ${progress.total} milestones done.`);
        break;
      }

      log(`Running task: "${task.name}" [${task.tags.join(', ')}]`);
      await this.board.updateStatus(task.id, STATUS.IN_PROGRESS);

      const selection = selectProvider(task, registry);

      const projectCtx = await this.hooks.buildProjectContext(runCtx);
      const taskGuidance = await this.hooks.buildTaskGuidance(task, selection);
      const activeMilestone = getActiveMilestone(milestones);
      const memCtx = this.memory.contextForTask(activeMilestone?.id, task.tags);

      let taskCtx: TaskContext = {
        task,
        projectRoot,
        config,
        branchName: currentBranch(projectRoot),
        prompt: buildPrompt(task, projectCtx, taskGuidance, memCtx),
        providerSelection: selection,
      };

      taskCtx = await this.hooks.beforeTask(taskCtx);

      // ── Call AI ───────────────────────────────────────────────────────────
      let rawOutput = '';
      let success   = false;

      if (this.cfg.dryRun) {
        log('[dry-run] Would invoke:', selection.cli, 'with model', selection.model);
        rawOutput = JSON.stringify({ milestoneAdvanced: true, testsResult: 'not-run', confidence: 'medium', blockers: [] });
        success = true;
      } else {
        const result = callAI(selection.cli, taskCtx.prompt);
        rawOutput = result.output;
        success   = result.exitCode === 0;
      }

      // ── Validate output ───────────────────────────────────────────────────
      const extracted  = extractJsonFromAgentText(rawOutput);
      const validation = extracted ? validateTaskOutput(extracted) : { valid: false, output: null, errors: ['No structured output found'] };

      const genuinelyDone = validation.valid && validation.output ? isGenuinelyDone(validation.output) : false;
      const outputSummary = validation.output ? summariseOutput(validation.output) : rawOutput.slice(0, 300);

      // ── Milestone advancement ─────────────────────────────────────────────
      let continuations: ContinuationSpec[] = [];

      if (activeMilestone && genuinelyDone) {
        const { result: verifyResult, escalated } = advanceMilestone(activeMilestone, projectRoot);
        await persistMilestoneUpdate(activeMilestone, milestones, projectRoot);

        milestones = await loadMilestones(projectRoot); // reload after update
        continuations = buildGapContinuations({
          milestone: activeMilestone,
          success: genuinelyDone,
          verifyResult,
          escalated,
          allMilestones: milestones,
        });

        if (escalated) {
          await this.board.updateStatus(task.id, STATUS.REVIEW);
          await this.board.postComment(task.id, `Milestone escalated: ${activeMilestone.title}\n${outputSummary}`);
          this.memory.record({ kind: 'milestone-escalated', milestoneId: activeMilestone.id, notes: outputSummary });
        } else if (verifyResult.passed) {
          await this.board.updateStatus(task.id, STATUS.DONE);
          await this.board.postComment(task.id, `Milestone ${activeMilestone.id} verified ✓\n${outputSummary}`);
          this.memory.record({ kind: 'milestone-verified', milestoneId: activeMilestone.id, notes: outputSummary });
        } else {
          await this.board.updateStatus(task.id, STATUS.REVIEW);
        }
      } else if (!genuinelyDone) {
        await this.board.updateStatus(task.id, STATUS.REVIEW);
        await this.board.postComment(task.id, `Task incomplete or low confidence.\n${outputSummary}`);
        if (activeMilestone) {
          continuations = buildGapContinuations({
            milestone: activeMilestone,
            success: false,
            verifyResult: { passed: false, output: rawOutput.slice(0, 500), durationMs: 0 },
            escalated: false,
            allMilestones: milestones,
          });
        }
      }

      // ── Record in memory ──────────────────────────────────────────────────
      this.memory.recordTaskOutcome({
        taskName:        task.name,
        milestoneId:     activeMilestone?.id,
        success:         genuinelyDone,
        provider:        selection.provider,
        model:           selection.model,
        tags:            task.tags,
        notes:           outputSummary,
        evidence:        rawOutput.slice(0, 500),
        blockers:        validation.output?.blockers,
        approachSummary: task.name,
      });

      // ── Post continuations ────────────────────────────────────────────────
      const resultCtx: TaskResultContext = { ...taskCtx, success: genuinelyDone, rawOutput };
      const filteredContinuations = await this.hooks.filterContinuations(continuations, resultCtx);

      for (const spec of filteredContinuations) {
        const created = await this.board.createTask(spec);
        if (spec.status === 'Open') await this.board.markStart(created.id);
        log(`  → Created continuation: "${spec.title}" [${spec.lane}]`);
      }

      await this.hooks.afterTask(resultCtx);
      await this.memory.save();

      processed++;
    }

    await this.hooks.afterRun({ ...runCtx, taskCount: processed, processed, skipped });
    log(`Run complete — ${processed} processed, ${skipped} skipped`);
  }

  // ── Board vacuum prevention ───────────────────────────────────────────────

  private async handleBoardVacuum(_milestones: Milestone[]): Promise<boolean> {
    const all  = await loadMilestones(this.cfg.projectRoot);
    // Prefer the active in-progress milestone; then first pending whose deps are all done
    const next = all.find((m) => m.status === 'in-progress')
      ?? all.find((m) => m.status === 'pending'
        && m.dependsOn.every((dep) => all.find((x) => x.id === dep)?.status === 'done'));

    if (!next) return false;

    const spec: ContinuationSpec = {
      lane: next.lane,
      title: `${capitalize(next.lane)}: ${next.title}`,
      description: `Auto-opened by board vacuum prevention.\n\n${next.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`,
      tags: [next.lane, next.id, 'aidev'],
      status: 'Open',
      reason: 'No runnable tasks found — next milestone task auto-created.',
      milestoneId: next.id,
    };

    const created = await this.board.createTask(spec);
    await this.board.markStart(created.id);
    log(`Board vacuum: created "${spec.title}"`);
    return true;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickNextTask(tasks: AidevTask[], startTag: string): AidevTask | null {
  return tasks.find((t) => {
    const status = t.status.toLowerCase();
    const isOpen = status === STATUS.OPEN || status === STATUS.IN_PROGRESS;
    return isOpen && t.tags.some((tag) => tag.toLowerCase() === startTag.toLowerCase());
  }) ?? null;
}

function buildPrompt(task: AidevTask, projectCtx: string, taskGuidance: string, memCtx: string): string {
  const parts = [
    projectCtx,
    memCtx && `\n---\n${memCtx}`,
    `\n---\n\n## Task: ${task.name}`,
    task.description && `\n${task.description}`,
    `\n\n${taskGuidance}`,
    `\n\n---\n\nWhen done, respond with a JSON block:\n\`\`\`json\n{ "milestoneAdvanced": true|false, "testsResult": "pass|fail|skipped|not-run", "confidence": "high|medium|low", "artifactsProduced": [], "commandsRun": [], "blockers": [], "notes": "..." }\n\`\`\``,
  ].filter(Boolean);

  return parts.join('\n');
}

function callAI(cli: string, prompt: string): { exitCode: number; output: string } {
  try {
    // Pass prompt via stdin to avoid Windows CLI arg length limits (32 767 chars).
    // claude uses `-p` (--print) flag for non-interactive mode; prompt on stdin.
    const result = spawnSync(cli, ['-p', '--allowedTools', 'Bash,Edit,Write,Read,Glob,Grep'], {
      input:    prompt,
      encoding: 'utf8',
      timeout:  300_000,   // 5 min max per task
      stdio:    ['pipe', 'pipe', 'pipe'],
      shell:    true,       // required on Windows to resolve CLI from PATH
    });
    return {
      exitCode: result.status ?? 1,
      output:   (result.stdout ?? '') + (result.stderr ?? ''),
    };
  } catch (err: any) {
    return { exitCode: 1, output: err.message ?? 'spawn failed' };
  }
}

function currentBranch(root: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function log(...args: unknown[]): void {
  console.log('[aidev]', ...args);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
