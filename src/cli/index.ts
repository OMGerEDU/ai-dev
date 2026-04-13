#!/usr/bin/env node
/**
 * aidev CLI
 *
 * Usage:
 *   aidev status          Print goal progress and milestone states
 *   aidev verify          Run verifyCmd for all pending milestones
 *   aidev init            Scaffold .aidev/ in the current project
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

const TEMPLATES_DIR = new URL('../../templates/', import.meta.url).pathname;
const CWD = process.cwd();

const [, , command = 'status'] = process.argv;

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
  if (progress.escalated > 0) {
    console.log(`⚠  ${progress.escalated} milestone(s) escalated — human review needed`);
  }
  console.log('');
  console.log(formatMilestoneStatus(milestones));
  console.log('');

  if (progress.isComplete) {
    console.log('Goal complete.');
  } else if (progress.nextMilestone) {
    console.log(`Next: [${progress.nextMilestone.id}] ${progress.nextMilestone.title}`);
    if (progress.nextMilestone.verifyCmd) {
      console.log(`Verify with: ${progress.nextMilestone.verifyCmd}`);
    }
  }
}

async function cmdVerify(): Promise<void> {
  const goal = await loadGoal(CWD);
  if (!goal) {
    console.error('No .aidev/goal.md found. Run `aidev init` first.');
    process.exit(1);
  }

  let milestones = await loadMilestones(CWD);

  if (!milestones.length) {
    console.log('Deriving milestones from goal.md...');
    milestones = deriveMilestonesFromGoal(goal);
    await saveMilestones(CWD, milestones);
    console.log(`Generated ${milestones.length} milestones.`);
  }

  let updated = false;

  for (const milestone of milestones) {
    if (milestone.status === 'done' || milestone.status === 'escalated') continue;
    if (!milestone.verifyCmd) continue;

    // Skip if dependencies not done
    const depsReady = milestone.dependsOn.every(
      (dep) => milestones.find((m) => m.id === dep)?.status === 'done'
    );
    if (!depsReady) continue;

    console.log(`Verifying [${milestone.id}] ${milestone.title}...`);
    const { result, escalated } = advanceMilestone(milestone, CWD);

    if (escalated) {
      console.error(`  ✗ ESCALATED after ${FAILURE_ESCALATION_THRESHOLD} failures — needs human review`);
    } else if (result.passed) {
      console.log(`  ✓ passed (${result.durationMs}ms)`);
    } else {
      console.log(`  ✗ failed (${result.durationMs}ms)`);
      if (result.error) console.log(`    ${result.error}`);
    }

    await persistMilestoneUpdate(milestone, milestones, CWD);
    updated = true;
  }

  if (!updated) {
    console.log('Nothing to verify (no pending milestones with verifyCmd and satisfied deps).');
  }

  await cmdStatus();
}

async function cmdInit(): Promise<void> {
  const aidevDir = join(CWD, '.aidev');

  try {
    await mkdir(aidevDir, { recursive: true });
  } catch { /* already exists */ }

  const files = ['goal.md', 'providers.json'];

  for (const file of files) {
    const dest = join(aidevDir, file);
    try {
      await access(dest);
      console.log(`  exists  .aidev/${file}`);
    } catch {
      await copyFile(join(TEMPLATES_DIR, file), dest);
      console.log(`  created .aidev/${file}`);
    }
  }

  console.log('\nDone. Edit .aidev/goal.md to describe your goal, then run `aidev verify`.');
}

switch (command) {
  case 'status': await cmdStatus(); break;
  case 'verify': await cmdVerify(); break;
  case 'init':   await cmdInit();   break;
  default:
    console.error(`Unknown command: ${command}\nUsage: aidev [status|verify|init]`);
    process.exit(1);
}
