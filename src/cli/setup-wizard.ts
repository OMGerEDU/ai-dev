/**
 * aidev setup wizard — `aidev init` interactive flow.
 *
 * Steps:
 *   1. Detect installed AI CLIs
 *   2. Choose task board (Local / Linear / ClickUp)
 *   3. Write .env.aidev with board credentials
 *   4. Run AI questionnaire → write .aidev/goal.md
 *   5. Optionally add skills from the catalog
 *   6. Print "Run `aidev run` to start"
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runQuestionnaire } from './questionnaire.js';
import { CATALOG, catalogByCategory } from '../skills/catalog.js';
import type { CatalogEntry } from '../skills/catalog.js';
import type { SkillEntry } from '../skills/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hr(char = '─', width = 60): string {
  return char.repeat(width);
}

function bold(s: string): string {
  return `\x1b[1m${s}\x1b[0m`;
}

function dim(s: string): string {
  return `\x1b[2m${s}\x1b[0m`;
}

function green(s: string): string {
  return `\x1b[32m${s}\x1b[0m`;
}

function yellow(s: string): string {
  return `\x1b[33m${s}\x1b[0m`;
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

// ── AI CLI detection ──────────────────────────────────────────────────────────

interface CliInfo { name: string; found: boolean }

function detectClis(): CliInfo[] {
  return ['claude', 'codex', 'antigravity'].map((name) => {
    try {
      const r = spawnSync(name, ['--version'], { encoding: 'utf8', shell: true, timeout: 4_000 });
      return { name, found: r.status === 0 };
    } catch {
      return { name, found: false };
    }
  });
}

// ── Board config ──────────────────────────────────────────────────────────────

type BoardChoice = 'local' | 'linear' | 'clickup';

async function chooseBoardConfig(
  rl: readline.Interface,
): Promise<{ choice: BoardChoice; envLines: string[] }> {
  console.log('\n' + hr('═'));
  console.log(bold('  Step 1 — Task Board'));
  console.log(hr('═'));
  console.log('  Where should aidev track tasks?\n');
  console.log('  1. Local files  (no account needed — tasks live in .aidev/tasks/)');
  console.log('  2. Linear       (requires LINEAR_API_KEY)');
  console.log('  3. ClickUp      (requires CLICKUP_API_KEY + CLICKUP_LIST_ID)');

  const raw = await rl.question('\n  Choice [1/2/3, default 1]:  → ');
  const choice = (['', '1'].includes(raw.trim()) ? 'local'
    : raw.trim() === '2' ? 'linear'
    : raw.trim() === '3' ? 'clickup'
    : 'local') as BoardChoice;

  const envLines: string[] = [];

  if (choice === 'linear') {
    const apiKey = await rl.question('\n  Linear API key:  → ');
    const teamId = await rl.question('  Linear Team ID (optional):  → ');
    envLines.push(`LINEAR_API_KEY=${apiKey.trim()}`);
    if (teamId.trim()) envLines.push(`LINEAR_TEAM_ID=${teamId.trim()}`);
  }

  if (choice === 'clickup') {
    const apiKey  = await rl.question('\n  ClickUp API key:  → ');
    const listId  = await rl.question('  ClickUp List ID:  → ');
    envLines.push(`CLICKUP_API_KEY=${apiKey.trim()}`);
    envLines.push(`CLICKUP_LIST_ID=${listId.trim()}`);
  }

  return { choice, envLines };
}

// ── Skills picker ─────────────────────────────────────────────────────────────

async function pickSkills(rl: readline.Interface): Promise<CatalogEntry[]> {
  console.log('\n' + hr('═'));
  console.log(bold('  Step 3 — Skills'));
  console.log(hr('═'));
  console.log('  Skills are pre-built capabilities the AI agent can use.');
  console.log('  You can add more anytime with `aidev skills add <id>`.\n');

  const byCategory = catalogByCategory();
  const indexed: CatalogEntry[] = [];
  let idx = 1;

  for (const [cat, entries] of byCategory) {
    console.log(`  ${dim(cat.toUpperCase())}`);
    for (const e of entries) {
      const shortDesc = e.description.split('.')[0];
      console.log(`  ${String(idx).padStart(2)}) ${bold(e.id.padEnd(22))} ${dim(shortDesc)}`);
      indexed.push(e);
      idx++;
    }
    console.log('');
  }

  const raw = await rl.question('  Add skills (numbers or IDs, comma-separated; Enter to skip):  → ');
  if (!raw.trim()) return [];

  const tokens = raw.split(',').map((t) => t.trim()).filter(Boolean);
  const selected: CatalogEntry[] = [];

  for (const token of tokens) {
    const num = parseInt(token, 10);
    if (!isNaN(num) && num >= 1 && num <= indexed.length) {
      selected.push(indexed[num - 1]);
    } else {
      const found = CATALOG.find((e) => e.id === token);
      if (found) selected.push(found);
      else console.log(`  ${yellow('!')} Unknown skill "${token}" — skipped`);
    }
  }

  return selected;
}

// ── File writers ──────────────────────────────────────────────────────────────

async function writeEnvFile(projectRoot: string, envLines: string[], agentsLine: string): Promise<void> {
  const envPath = join(projectRoot, '.env.aidev');
  const existing = await fileExists(envPath)
    ? await readFile(envPath, 'utf8')
    : '';

  const newLines = [
    agentsLine,
    ...envLines,
  ].filter(Boolean);

  // Merge: don't duplicate keys
  const existingKeys = new Set(
    existing.split('\n')
      .filter((l) => l.includes('='))
      .map((l) => l.split('=')[0].trim()),
  );

  const toAppend = newLines.filter((l) => {
    const key = l.split('=')[0].trim();
    return !existingKeys.has(key);
  });

  if (!toAppend.length) return;

  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  await writeFile(envPath, existing + separator + toAppend.join('\n') + '\n', 'utf8');
}

async function writeSkillsFile(projectRoot: string, entries: CatalogEntry[]): Promise<void> {
  if (!entries.length) return;

  const skillsPath = join(projectRoot, '.aidev', 'skills.json');
  let existing: SkillEntry[] = [];

  if (await fileExists(skillsPath)) {
    try {
      const raw = JSON.parse(await readFile(skillsPath, 'utf8')) as { skills: SkillEntry[] };
      existing = raw.skills ?? [];
    } catch { /* malformed — overwrite */ }
  }

  const existingIds = new Set(existing.map((s) => s.id));
  const newSkills = entries
    .filter((e) => !existingIds.has(e.skill.id))
    .map((e) => e.skill);

  const merged = [...existing, ...newSkills];
  await writeFile(skillsPath, JSON.stringify({ skills: merged }, null, 2) + '\n', 'utf8');
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export async function runSetupWizard(
  projectRoot: string,
  templateDir: string,
): Promise<void> {
  console.log('\n' + hr('═', 60));
  console.log(bold('  aidev — autonomous AI delivery engine'));
  console.log(hr('═', 60));

  // Detect CLIs
  const clis = detectClis();
  const found = clis.filter((c) => c.found);
  if (found.length) {
    console.log(`\n  ${green('✓')} Found AI CLI: ${found.map((c) => c.name).join(', ')}`);
  } else {
    console.log(`\n  ${yellow('!')} No AI CLI found on PATH.`);
    console.log('    Install one: https://claude.ai/code  |  https://github.com/openai/codex');
  }

  const rl = readline.createInterface({ input, output, terminal: true });

  // ── Step 1: Board ──────────────────────────────────────────────────────────
  const { choice: boardChoice, envLines } = await chooseBoardConfig(rl);

  // ── Step 2: Goal questionnaire ─────────────────────────────────────────────
  rl.close();

  console.log('\n' + hr('═'));
  console.log(bold('  Step 2 — Project Goal'));
  console.log(hr('═'));

  const { goalMd } = await runQuestionnaire();

  // ── Step 3: Skills ─────────────────────────────────────────────────────────
  const rl2 = readline.createInterface({ input, output, terminal: true });
  const selectedSkills = await pickSkills(rl2);
  rl2.close();

  // ── Write files ────────────────────────────────────────────────────────────
  const aidevDir = join(projectRoot, '.aidev');
  const tasksOpenDir = join(aidevDir, 'tasks', 'open');
  const tasksPendingDir = join(aidevDir, 'tasks', 'pending');

  await mkdir(tasksOpenDir,    { recursive: true });
  await mkdir(tasksPendingDir, { recursive: true });

  // goal.md
  const goalPath = join(aidevDir, 'goal.md');
  if (!(await fileExists(goalPath))) {
    await writeFile(goalPath, goalMd + '\n', 'utf8');
  } else {
    const overwrite = await (async () => {
      const rl3 = readline.createInterface({ input, output, terminal: true });
      const ans = await rl3.question('\n  .aidev/goal.md already exists. Overwrite? [y/N]  → ');
      rl3.close();
      return ans.trim().toLowerCase() === 'y';
    })();
    if (overwrite) await writeFile(goalPath, goalMd + '\n', 'utf8');
  }

  // providers.json (copy template if absent)
  const providersPath = join(aidevDir, 'providers.json');
  if (!(await fileExists(providersPath))) {
    await writeFile(
      providersPath,
      await readFile(join(templateDir, 'providers.json'), 'utf8'),
      'utf8',
    );
  }

  // .env.aidev
  const agentsLine = found.length ? `AGENTS=${found.map((c) => c.name).join(',')}` : '';
  await writeEnvFile(projectRoot, envLines, agentsLine);

  // skills.json
  await writeSkillsFile(projectRoot, selectedSkills);

  // ── Done ───────────────────────────────────────────────────────────────────
  console.log('\n' + hr('═'));
  console.log(bold('  Done!'));
  console.log(hr('═'));

  const written: string[] = ['.aidev/goal.md', '.aidev/providers.json'];
  if (envLines.length || agentsLine) written.push('.env.aidev');
  if (selectedSkills.length) written.push(`.aidev/skills.json (${selectedSkills.length} skill${selectedSkills.length > 1 ? 's' : ''})`);

  for (const f of written) {
    console.log(`  ${green('✓')} ${f}`);
  }

  console.log(`\n  Board: ${bold(boardChoice)}`);
  if (selectedSkills.length) {
    console.log(`  Skills: ${selectedSkills.map((s) => s.id).join(', ')}`);
  }

  console.log(`\n  Next: ${bold('aidev run')}\n`);
}
