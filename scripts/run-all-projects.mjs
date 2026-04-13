#!/usr/bin/env node
/**
 * run-all-projects.mjs
 *
 * Runs aidev on every configured project in sequence.
 * Triggered hourly by the Claude Code durable cron.
 *
 * Projects:
 *   1. aidev-core       — self-improvement (new @aidev/core runner)
 *   2. aidev (epilepsy) — EpiHelper browser (legacy @qelos/aidev@0.4.0 runner)
 *
 * Each project gets its own env, its own ClickUp list, and its own memory.
 * Failures in one project do not abort the others.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const PROJECTS = [
  {
    name:    'aidev-core (self-improvement)',
    root:    'c:/Programming/aidev-core',
    cmd:     'node',
    // Use compiled CLI directly — avoids installing globally and overriding @qelos/aidev
    args:    ['c:/Programming/aidev-core/dist/cli/index.js', 'run', '--max-tasks=10'],
  },
  {
    name:    'EpiHelper browser',
    root:    'c:/Programming/aidev',
    cmd:     'aidev',
    args:    ['run', '--max-tasks=10'],
  },
];

const WIDTH = 72;
const line  = (char = '─') => char.repeat(WIDTH);

function header(title) {
  const pad = Math.max(0, WIDTH - title.length - 4);
  console.log(`\n${line()}\n  ${title}  ${' '.repeat(pad)}\n${line()}`);
}

function runProject({ name, root, cmd, args }) {
  header(`▶  ${name}`);

  if (!existsSync(root)) {
    console.log(`  ✗ skipped — root does not exist: ${root}`);
    return { name, success: false, skipped: true };
  }

  const started = Date.now();
  console.log(`  cwd:     ${root}`);
  console.log(`  command: ${cmd} ${args.join(' ')}`);
  console.log(`  time:    ${new Date().toLocaleTimeString()}\n`);

  const result = spawnSync(cmd, args, {
    cwd:      root,
    encoding: 'utf8',
    timeout:  20 * 60 * 1000,   // 20 min hard cap per project
    stdio:    ['ignore', 'inherit', 'inherit'],
    shell:    true,
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const success = result.status === 0;

  console.log(`\n  ${success ? '✓' : '✗'} ${name} — ${elapsed}s (exit ${result.status ?? 'timeout'})`);
  if (result.error) console.log(`  error: ${result.error.message}`);

  return { name, success, elapsedSec: elapsed };
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(WIDTH)}`);
console.log(`  aidev multi-project run — ${new Date().toLocaleString()}`);
console.log(`  projects: ${PROJECTS.length}`);
console.log(`${'═'.repeat(WIDTH)}`);

const results = [];
for (const project of PROJECTS) {
  results.push(runProject(project));
}

// ── Summary ───────────────────────────────────────────────────────────────────

header('Run summary');
for (const r of results) {
  const status = r.skipped ? '⊘ skipped' : r.success ? '✓ ok' : '✗ failed';
  console.log(`  ${status.padEnd(12)} ${r.name}${r.elapsedSec ? ` (${r.elapsedSec}s)` : ''}`);
}

const failed = results.filter((r) => !r.success && !r.skipped);
if (failed.length) {
  console.log(`\n  ${failed.length} project(s) need attention: ${failed.map((r) => r.name).join(', ')}`);
  process.exit(1);
}

console.log(`\n  All projects complete.\n`);
