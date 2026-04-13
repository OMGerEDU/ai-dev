#!/usr/bin/env node
/**
 * aidev CLI
 *
 * Commands:
 *   aidev run      Run the autonomous goal loop (pick → build → verify → continue)
 *   aidev status   Print goal progress and milestone states
 *   aidev verify   Run verifyCmd for all unverified milestones
 *   aidev init     Scaffold .aidev/ in the current project
 *   aidev memory   Show what aidev has learned about this project
 */

import { join } from 'node:path';
import { mkdir, copyFile, access } from 'node:fs/promises';
import {
  loadGoal,
  loadMilestones,
  saveMilestones,
  deriveMilestonesFromGoal,
  measureProgress,
  formatMilestoneStatus,
} from '../engine/goal-engine.js';
import { advanceMilestone, persistMilestoneUpdate, FAILURE_ESCALATION_THRESHOLD } from '../engine/milestone-engine.js';
import { Runner } from '../runner/runner.js';
import { ProjectMemory } from '../memory/memory.js';

const TEMPLATES_DIR = new URL('../../templates/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const CWD = process.cwd();

const args = process.argv.slice(2);
const command = args[0] ?? 'status';
const flags = {
  dryRun:   args.includes('--dry-run'),
  maxTasks: Number(args.find((a) => a.startsWith('--max-tasks='))?.split('=')[1] ?? '20'),
};

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdRun(): Promise<void> {
  const config = loadEnvConfig();
  const runner = new Runner({
    projectRoot: CWD,
    config,
    dryRun:   flags.dryRun,
    maxTasks: flags.maxTasks,
  });

  console.log(`[aidev] Starting run — max ${flags.maxTasks} tasks${flags.dryRun ? ' (dry-run)' : ''}`);
  await runner.run();
}

async function cmdStatus(): Promise<void> {
  const goal = await loadGoal(CWD);
  if (!goal) {
    console.error('No .aidev/goal.md found. Run `aidev init` to scaffold one.');
    process.exit(1);
  }

  const milestones = await loadMilestones(CWD);
  if (!milestones.length) {
    console.log('No milestones yet. Run `aidev verify` to generate them from goal.md.');
    return;
  }

  const progress = measureProgress(milestones);

  console.log(`\n── ${goal.title} ──`);
  console.log(`Progress: ${progress.done}/${progress.total} milestones (${progress.percentComplete}%)`);
  if (progress.escalated > 0) console.log(`⚠  ${progress.escalated} escalated — human review needed`);
  console.log('');
  console.log(formatMilestoneStatus(milestones));
  console.log('');

  if (progress.isComplete) {
    console.log('Goal complete.');
  } else if (progress.nextMilestone) {
    console.log(`Next: [${progress.nextMilestone.id}] ${progress.nextMilestone.title}`);
    if (progress.nextMilestone.verifyCmd) console.log(`Verify: ${progress.nextMilestone.verifyCmd}`);
  }
}

async function cmdVerify(): Promise<void> {
  const goal = await loadGoal(CWD);
  if (!goal) { console.error('No .aidev/goal.md. Run `aidev init` first.'); process.exit(1); }

  let milestones = await loadMilestones(CWD);
  if (!milestones.length) {
    console.log('Deriving milestones from goal.md...');
    milestones = deriveMilestonesFromGoal(goal);
    await saveMilestones(CWD, milestones);
    console.log(`Generated ${milestones.length} milestones.`);
  }

  let ran = false;
  for (const m of milestones) {
    if (m.status === 'done' || m.status === 'escalated' || !m.verifyCmd) continue;
    const depsReady = m.dependsOn.every((d) => milestones.find((x) => x.id === d)?.status === 'done');
    if (!depsReady) continue;

    console.log(`Verifying [${m.id}] ${m.title}...`);
    const { result, escalated } = advanceMilestone(m, CWD);
    await persistMilestoneUpdate(m, milestones, CWD);
    ran = true;

    if (escalated)     console.log(`  ✗ ESCALATED after ${FAILURE_ESCALATION_THRESHOLD} failures`);
    else if (result.passed) console.log(`  ✓ passed (${result.durationMs}ms)`);
    else {
      console.log(`  ✗ failed (${result.durationMs}ms)`);
      if (result.error) console.log(`    ${result.error.slice(0, 200)}`);
    }
  }

  if (!ran) console.log('Nothing to verify.');
  await cmdStatus();
}

async function cmdInit(): Promise<void> {
  const aidevDir = join(CWD, '.aidev');
  await mkdir(aidevDir, { recursive: true });

  for (const file of ['goal.md', 'providers.json']) {
    const dest = join(aidevDir, file);
    try {
      await access(dest);
      console.log(`  exists  .aidev/${file}`);
    } catch {
      await copyFile(join(TEMPLATES_DIR, file), dest);
      console.log(`  created .aidev/${file}`);
    }
  }

  console.log('\nDone. Edit .aidev/goal.md then run `aidev run` or `aidev verify`.');
}

async function cmdMemory(): Promise<void> {
  const goal = await loadGoal(CWD);
  const mem  = await ProjectMemory.load(CWD, goal?.title ?? 'unknown');

  const milestones = await loadMilestones(CWD);
  if (!milestones.length) { console.log('No milestones yet.'); return; }

  console.log(`\n── Memory: ${goal?.title ?? CWD} ──\n`);
  for (const m of milestones) {
    const recall = mem.recallMilestone(m.id);
    console.log(`[${m.id}] ${m.title}`);
    console.log(recall.split('\n').map((l) => `  ${l}`).join('\n'));
    console.log('');
  }
}

// ── Env loading ───────────────────────────────────────────────────────────────

function loadEnvConfig(): Record<string, string | undefined> {
  // Merge process.env with .env.aidev if present
  const config: Record<string, string | undefined> = { ...process.env as any };
  try {
    const raw = require('fs').readFileSync(join(CWD, '.env.aidev'), 'utf8') as string;
    for (const line of raw.split('\n')) {
      const [k, ...vParts] = line.split('=');
      if (k && !k.startsWith('#')) config[k.trim()] = vParts.join('=').trim();
    }
  } catch { /* no .env.aidev — use process.env only */ }
  return config;
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

switch (command) {
  case 'run':    await cmdRun();    break;
  case 'status': await cmdStatus(); break;
  case 'verify': await cmdVerify(); break;
  case 'init':   await cmdInit();   break;
  case 'memory': await cmdMemory(); break;
  default:
    console.error(`Unknown command: ${command}\nUsage: aidev [run|status|verify|init|memory] [--dry-run] [--max-tasks=N]`);
    process.exit(1);
}
