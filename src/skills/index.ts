import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SkillsFileSchema } from './types.js';
import type { SkillEntry, NpmSkill, McpSkill, GitSkill } from './types.js';

export * from './types.js';

const SKILLS_FILE = '.aidev/skills.json';

/**
 * Load skills from <projectRoot>/.aidev/skills.json.
 * Returns an empty array when the file is absent — skills are additive.
 */
export async function loadSkills(projectRoot: string): Promise<SkillEntry[]> {
  const filePath = join(projectRoot, SKILLS_FILE);

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse ${filePath}: invalid JSON`);
  }

  const result = SkillsFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid skills.json: ${issues}`);
  }

  return result.data.skills;
}

// ── ensureSkillsInstalled ─────────────────────────────────────────────────────

/** Injectable executor for npm install — allows tests to mock without touching the FS. */
export type NpmInstaller = (pkg: string, version: string | undefined, cwd: string) => void;

function defaultNpmInstaller(pkg: string, version: string | undefined, cwd: string): void {
  const spec = version ? `${pkg}@${version}` : pkg;
  const result = spawnSync('npm', ['install', '--no-save', spec], { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`npm install failed for ${spec} (exit ${result.status})`);
  }
}

const GIT_URL_RE = /^(https?:\/\/|git@|git:\/\/|ssh:\/\/)/;

async function isNpmPackageInstalled(pkg: string, projectRoot: string): Promise<boolean> {
  try {
    await access(join(projectRoot, 'node_modules', pkg));
    return true;
  } catch {
    return false;
  }
}

async function handleNpm(skill: NpmSkill, projectRoot: string, installer: NpmInstaller): Promise<void> {
  const installed = await isNpmPackageInstalled(skill.package, projectRoot);
  if (!installed) {
    installer(skill.package, skill.version, projectRoot);
  }
}

function handleMcp(skill: McpSkill): void {
  if (!skill.server) {
    throw new Error(`MCP skill "${skill.id}" is missing required field: server`);
  }
}

function handleGit(skill: GitSkill): void {
  if (!GIT_URL_RE.test(skill.repo)) {
    throw new Error(`Git skill "${skill.id}" has invalid repo URL: ${skill.repo}`);
  }
}

// ── buildSkillsSection ────────────────────────────────────────────────────────

/**
 * Build the "## Available Skills" section to inject into task prompts.
 * Returns an empty string when the skills array is empty.
 */
export function buildSkillsSection(skills: SkillEntry[]): string {
  if (skills.length === 0) return '';

  const lines: string[] = ['## Available Skills', ''];
  for (const skill of skills) {
    const desc = (skill as any).description ? ` — ${(skill as any).description}` : '';
    switch (skill.source) {
      case 'npm':
        lines.push(`- **${skill.id}** (npm: \`${(skill as NpmSkill).package}\`)${desc}`);
        break;
      case 'mcp':
        lines.push(`- **${skill.id}** (mcp: \`${(skill as McpSkill).server}\`)${desc}`);
        break;
      case 'git':
        lines.push(`- **${skill.id}** (git: \`${(skill as GitSkill).repo}\`)${desc}`);
        break;
    }
  }

  return lines.join('\n');
}

// ── ensureSkillsInstalled ─────────────────────────────────────────────────────

/**
 * Ensure all skills are ready to use:
 * - npm: installs the package if node_modules/<package> is absent
 * - mcp: validates required fields are present
 * - git: validates repo URL format
 *
 * Pass a custom `installer` to override the npm install behaviour (useful in tests).
 */
export async function ensureSkillsInstalled(
  skills: SkillEntry[],
  projectRoot: string,
  installer: NpmInstaller = defaultNpmInstaller,
): Promise<void> {
  for (const skill of skills) {
    switch (skill.source) {
      case 'npm':
        await handleNpm(skill, projectRoot, installer);
        break;
      case 'mcp':
        handleMcp(skill);
        break;
      case 'git':
        handleGit(skill);
        break;
    }
  }
}
