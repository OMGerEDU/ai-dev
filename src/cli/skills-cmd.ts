/**
 * `aidev skills` sub-commands.
 *
 *   aidev skills list              — show full catalog grouped by category
 *   aidev skills search <query>    — filter catalog by keyword
 *   aidev skills add <id>          — add a skill to .aidev/skills.json
 *   aidev skills remove <id>       — remove a skill from .aidev/skills.json
 *   aidev skills installed         — show skills active in this project
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { CATALOG, searchCatalog, catalogByCategory, findCatalogEntry } from '../skills/catalog.js';
import { loadSkills } from '../skills/index.js';
import type { SkillEntry } from '../skills/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function bold(s: string): string  { return `\x1b[1m${s}\x1b[0m`; }
function dim(s: string): string   { return `\x1b[2m${s}\x1b[0m`; }
function green(s: string): string { return `\x1b[32m${s}\x1b[0m`; }
function yellow(s: string): string { return `\x1b[33m${s}\x1b[0m`; }
function cyan(s: string): string  { return `\x1b[36m${s}\x1b[0m`; }

function hr(char = '─', width = 60): string { return char.repeat(width); }

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

const SKILLS_FILE = '.aidev/skills.json';

async function readSkillsFile(projectRoot: string): Promise<SkillEntry[]> {
  const p = join(projectRoot, SKILLS_FILE);
  if (!(await fileExists(p))) return [];
  try {
    const raw = JSON.parse(await readFile(p, 'utf8')) as { skills?: SkillEntry[] };
    return raw.skills ?? [];
  } catch {
    return [];
  }
}

async function writeSkillsFile(projectRoot: string, skills: SkillEntry[]): Promise<void> {
  const p = join(projectRoot, SKILLS_FILE);
  await writeFile(p, JSON.stringify({ skills }, null, 2) + '\n', 'utf8');
}

// ── Sub-commands ──────────────────────────────────────────────────────────────

function cmdList(): void {
  console.log(`\n${bold('Available skills')}  (${CATALOG.length} total)\n`);
  const byCategory = catalogByCategory();

  for (const [cat, entries] of byCategory) {
    console.log(dim(`  ${cat.toUpperCase()}`));
    for (const e of entries) {
      const shortDesc = e.description.split('.')[0];
      console.log(`  ${cyan(e.id.padEnd(24))} ${shortDesc}`);
    }
    console.log('');
  }

  console.log(dim(`  Add a skill: aidev skills add <id>`));
  console.log(dim(`  Details:     aidev skills search <name>\n`));
}

function cmdSearch(query: string): void {
  if (!query) {
    console.error('Usage: aidev skills search <query>');
    process.exit(1);
  }

  const results = searchCatalog(query);
  if (!results.length) {
    console.log(`No skills matching "${query}".`);
    return;
  }

  console.log(`\n${bold(`Skills matching "${query}"`)} (${results.length} result${results.length > 1 ? 's' : ''})\n`);

  for (const e of results) {
    console.log(`${hr()}`);
    console.log(`${bold(e.id)}  ${dim(`[${e.category}]`)}`);
    console.log(`  ${e.name}`);
    console.log(`  ${e.description}`);
    console.log(`  ${dim(e.homepage)}`);
    console.log(`  Source: ${e.skill.source}`);
    if (e.skill.source === 'npm')  console.log(`  Package: ${(e.skill as any).package}`);
    if (e.skill.source === 'mcp')  console.log(`  Server:  ${(e.skill as any).server}`);
    if (e.skill.source === 'git')  console.log(`  Repo:    ${(e.skill as any).repo}`);
    console.log('');
  }

  console.log(dim(`  Add: aidev skills add ${results[0].id}\n`));
}

async function cmdAdd(projectRoot: string, id: string): Promise<void> {
  if (!id) {
    console.error('Usage: aidev skills add <id>');
    process.exit(1);
  }

  const entry = findCatalogEntry(id);
  if (!entry) {
    console.error(`Unknown skill "${id}". Run \`aidev skills list\` to see available skills.`);
    process.exit(1);
  }

  const existing = await readSkillsFile(projectRoot);
  if (existing.some((s) => s.id === id)) {
    console.log(`${yellow('!')} Skill "${id}" is already in .aidev/skills.json.`);
    return;
  }

  const updated = [...existing, entry.skill];
  await writeSkillsFile(projectRoot, updated);

  console.log(`${green('✓')} Added "${id}" to .aidev/skills.json`);
  console.log(`  ${entry.name} — ${entry.description.split('.')[0]}`);

  // Print install hint if npm
  if (entry.skill.source === 'npm') {
    console.log(dim(`\n  To install now: npm install ${(entry.skill as any).package}`));
  }
  if (entry.skill.source === 'mcp') {
    const cmd = (entry.skill as any).command;
    const args = ((entry.skill as any).args ?? []).join(' ');
    if (cmd) console.log(dim(`\n  MCP command: ${cmd} ${args}`));
  }
}

async function cmdRemove(projectRoot: string, id: string): Promise<void> {
  if (!id) {
    console.error('Usage: aidev skills remove <id>');
    process.exit(1);
  }

  const existing = await readSkillsFile(projectRoot);
  const filtered = existing.filter((s) => s.id !== id);

  if (filtered.length === existing.length) {
    console.log(`${yellow('!')} Skill "${id}" not found in .aidev/skills.json.`);
    return;
  }

  await writeSkillsFile(projectRoot, filtered);
  console.log(`${green('✓')} Removed "${id}" from .aidev/skills.json`);
}

async function cmdInstalled(projectRoot: string): Promise<void> {
  const skills = await loadSkills(projectRoot);

  if (!skills.length) {
    console.log('No skills installed in this project.');
    console.log(dim('  Add one: aidev skills add <id>'));
    return;
  }

  console.log(`\n${bold('Installed skills')} (${skills.length})\n`);
  for (const s of skills) {
    const catalogEntry = findCatalogEntry(s.id);
    const label = catalogEntry?.name ?? s.id;
    const desc = (s as any).description ?? catalogEntry?.description.split('.')[0] ?? '';
    const src = s.source === 'npm'  ? `npm:${(s as any).package}`
               : s.source === 'mcp' ? `mcp:${(s as any).server}`
               : `git:${(s as any).repo}`;
    console.log(`  ${cyan(s.id.padEnd(24))} ${label}`);
    if (desc) console.log(`  ${' '.repeat(24)} ${dim(desc)}`);
    console.log(`  ${' '.repeat(24)} ${dim(src)}`);
    console.log('');
  }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export async function runSkillsCommand(
  sub: string | undefined,
  args: string[],
  projectRoot: string,
): Promise<void> {
  switch (sub) {
    case 'list':
    case undefined:
      cmdList();
      break;

    case 'search':
      cmdSearch(args[0] ?? '');
      break;

    case 'add':
    case 'pull':   // alias
      await cmdAdd(projectRoot, args[0] ?? '');
      break;

    case 'remove':
    case 'rm':     // alias
      await cmdRemove(projectRoot, args[0] ?? '');
      break;

    case 'installed':
      await cmdInstalled(projectRoot);
      break;

    default:
      console.error(`Unknown skills sub-command: ${sub}`);
      console.error('Usage: aidev skills [list|search|add|remove|installed]');
      process.exit(1);
  }
}
