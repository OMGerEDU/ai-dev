import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSkills, ensureSkillsInstalled, buildSkillsSection } from '../index.js';
import type { SkillEntry, NpmInstaller } from '../index.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'aidev-skills-'));
  await mkdir(join(tmpRoot, '.aidev'), { recursive: true });
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function writeSkillsFile(skills: unknown[]): Promise<void> {
  await writeFile(join(tmpRoot, '.aidev/skills.json'), JSON.stringify({ skills }), 'utf8');
}

describe('loadSkills', () => {
  it('returns empty array when skills.json is absent', async () => {
    const result = await loadSkills(tmpRoot);
    expect(result).toEqual([]);
  });

  it('parses an npm skill', async () => {
    await writeSkillsFile([{ id: 'prettier', source: 'npm', package: 'prettier', version: '^3.0.0', description: 'Code formatter' }]);
    const skills = await loadSkills(tmpRoot);
    expect(skills).toHaveLength(1);
    const skill = skills[0] as SkillEntry & { source: 'npm' };
    expect(skill.source).toBe('npm');
    expect(skill.package).toBe('prettier');
    expect(skill.version).toBe('^3.0.0');
  });

  it('parses an mcp skill with defaults', async () => {
    await writeSkillsFile([{ id: 'my-mcp', source: 'mcp', server: 'my-server', command: 'npx my-mcp' }]);
    const skills = await loadSkills(tmpRoot);
    expect(skills).toHaveLength(1);
    const skill = skills[0] as SkillEntry & { source: 'mcp' };
    expect(skill.source).toBe('mcp');
    expect(skill.server).toBe('my-server');
    expect(skill.transport).toBe('stdio');
    expect(skill.args).toEqual([]);
  });

  it('parses a git skill with defaults', async () => {
    await writeSkillsFile([{ id: 'scripts', source: 'git', repo: 'https://github.com/org/repo' }]);
    const skills = await loadSkills(tmpRoot);
    expect(skills).toHaveLength(1);
    const skill = skills[0] as SkillEntry & { source: 'git' };
    expect(skill.source).toBe('git');
    expect(skill.repo).toBe('https://github.com/org/repo');
    expect(skill.ref).toBe('main');
  });

  it('parses a mixed list of all three source types', async () => {
    await writeSkillsFile([
      { id: 'npm-skill', source: 'npm', package: 'eslint' },
      { id: 'mcp-skill', source: 'mcp', server: 'srv' },
      { id: 'git-skill', source: 'git', repo: 'https://github.com/a/b' },
    ]);
    const skills = await loadSkills(tmpRoot);
    expect(skills).toHaveLength(3);
    expect(skills.map((s) => s.source)).toEqual(['npm', 'mcp', 'git']);
  });

  it('throws on invalid JSON', async () => {
    await writeFile(join(tmpRoot, '.aidev/skills.json'), 'not-json', 'utf8');
    await expect(loadSkills(tmpRoot)).rejects.toThrow('invalid JSON');
  });

  it('throws when schema validation fails', async () => {
    await writeFile(join(tmpRoot, '.aidev/skills.json'), JSON.stringify({ skills: [{ id: 'bad', source: 'unknown' }] }), 'utf8');
    await expect(loadSkills(tmpRoot)).rejects.toThrow('Invalid skills.json');
  });

  it('throws when skills property is missing', async () => {
    await writeFile(join(tmpRoot, '.aidev/skills.json'), JSON.stringify({}), 'utf8');
    await expect(loadSkills(tmpRoot)).rejects.toThrow('Invalid skills.json');
  });

  it('handles skills with optional description field', async () => {
    await writeSkillsFile([{ id: 'no-desc', source: 'npm', package: 'lodash' }]);
    const skills = await loadSkills(tmpRoot);
    expect((skills[0] as any).description).toBeUndefined();
  });
});

describe('ensureSkillsInstalled', () => {
  it('calls installer for an npm skill that is not installed', async () => {
    const installer = jest.fn<NpmInstaller>();
    const skills = await loadSkills(tmpRoot); // no skills.json yet — empty
    // Write one npm skill and reload
    await writeSkillsFile([{ id: 'prettier', source: 'npm', package: 'prettier', version: '^3.0.0' }]);
    const loaded = await loadSkills(tmpRoot);
    // node_modules/prettier does NOT exist in tmpRoot
    await ensureSkillsInstalled(loaded, tmpRoot, installer);
    expect(installer).toHaveBeenCalledTimes(1);
    expect(installer).toHaveBeenCalledWith('prettier', '^3.0.0', tmpRoot);
  });

  it('skips installer when npm package is already installed', async () => {
    // Create a fake node_modules/my-pkg directory to simulate an installed package
    await mkdir(join(tmpRoot, 'node_modules', 'my-pkg'), { recursive: true });
    await writeSkillsFile([{ id: 'my-pkg', source: 'npm', package: 'my-pkg' }]);
    const installer = jest.fn<NpmInstaller>();
    const skills = await loadSkills(tmpRoot);
    await ensureSkillsInstalled(skills, tmpRoot, installer);
    expect(installer).not.toHaveBeenCalled();
  });

  it('does not call installer for npm packages installed without version', async () => {
    await mkdir(join(tmpRoot, 'node_modules', 'eslint'), { recursive: true });
    await writeSkillsFile([{ id: 'eslint', source: 'npm', package: 'eslint' }]);
    const installer = jest.fn<NpmInstaller>();
    const skills = await loadSkills(tmpRoot);
    await ensureSkillsInstalled(skills, tmpRoot, installer);
    expect(installer).not.toHaveBeenCalled();
  });

  it('does not throw for a valid MCP skill', async () => {
    await writeSkillsFile([{ id: 'my-mcp', source: 'mcp', server: 'my-server', command: 'npx my-mcp' }]);
    const installer = jest.fn<NpmInstaller>();
    const skills = await loadSkills(tmpRoot);
    await expect(ensureSkillsInstalled(skills, tmpRoot, installer)).resolves.toBeUndefined();
  });

  it('does not throw for a valid git skill with https URL', async () => {
    await writeSkillsFile([{ id: 'scripts', source: 'git', repo: 'https://github.com/org/repo' }]);
    const installer = jest.fn<NpmInstaller>();
    const skills = await loadSkills(tmpRoot);
    await expect(ensureSkillsInstalled(skills, tmpRoot, installer)).resolves.toBeUndefined();
  });

  it('does not throw for a valid git skill with ssh URL', async () => {
    await writeSkillsFile([{ id: 'scripts', source: 'git', repo: 'git@github.com:org/repo.git' }]);
    const installer = jest.fn<NpmInstaller>();
    const skills = await loadSkills(tmpRoot);
    await expect(ensureSkillsInstalled(skills, tmpRoot, installer)).resolves.toBeUndefined();
  });

  it('throws for a git skill with an invalid repo URL', async () => {
    // Bypass loadSkills validation by injecting directly
    const skills: SkillEntry[] = [{ id: 'bad-git', source: 'git', repo: 'not-a-url', ref: 'main' }];
    const installer = jest.fn<NpmInstaller>();
    await expect(ensureSkillsInstalled(skills, tmpRoot, installer)).rejects.toThrow('invalid repo URL');
  });

  it('does nothing when skills list is empty', async () => {
    const installer = jest.fn<NpmInstaller>();
    await expect(ensureSkillsInstalled([], tmpRoot, installer)).resolves.toBeUndefined();
    expect(installer).not.toHaveBeenCalled();
  });

  it('handles a mixed list: installs missing npm, validates mcp and git', async () => {
    await writeSkillsFile([
      { id: 'to-install', source: 'npm', package: 'chalk', version: '^5.0.0' },
      { id: 'mcp-skill', source: 'mcp', server: 'srv' },
      { id: 'git-skill', source: 'git', repo: 'https://github.com/a/b' },
    ]);
    const installer = jest.fn<NpmInstaller>();
    const skills = await loadSkills(tmpRoot);
    await ensureSkillsInstalled(skills, tmpRoot, installer);
    // chalk not in node_modules so installer should be called once
    expect(installer).toHaveBeenCalledTimes(1);
    expect(installer).toHaveBeenCalledWith('chalk', '^5.0.0', tmpRoot);
  });
});

describe('buildSkillsSection', () => {
  it('returns empty string for an empty skills array', () => {
    expect(buildSkillsSection([])).toBe('');
  });

  it('includes the ## Available Skills heading', () => {
    const skills: SkillEntry[] = [{ id: 'prettier', source: 'npm', package: 'prettier' }];
    const section = buildSkillsSection(skills);
    expect(section).toContain('## Available Skills');
  });

  it('lists an npm skill with package name', () => {
    const skills: SkillEntry[] = [{ id: 'prettier', source: 'npm', package: 'prettier' }];
    const section = buildSkillsSection(skills);
    expect(section).toContain('prettier');
    expect(section).toContain('npm');
  });

  it('lists an mcp skill with server name', () => {
    const skills: SkillEntry[] = [{ id: 'my-mcp', source: 'mcp', server: 'my-server', transport: 'stdio', args: [] }];
    const section = buildSkillsSection(skills);
    expect(section).toContain('my-mcp');
    expect(section).toContain('my-server');
    expect(section).toContain('mcp');
  });

  it('lists a git skill with repo URL', () => {
    const skills: SkillEntry[] = [{ id: 'scripts', source: 'git', repo: 'https://github.com/org/repo', ref: 'main' }];
    const section = buildSkillsSection(skills);
    expect(section).toContain('scripts');
    expect(section).toContain('https://github.com/org/repo');
    expect(section).toContain('git');
  });

  it('includes description when provided', () => {
    const skills: SkillEntry[] = [{ id: 'prettier', source: 'npm', package: 'prettier', description: 'Code formatter' }];
    const section = buildSkillsSection(skills);
    expect(section).toContain('Code formatter');
  });

  it('lists all three source types in a mixed array', () => {
    const skills: SkillEntry[] = [
      { id: 'npm-skill', source: 'npm', package: 'eslint' },
      { id: 'mcp-skill', source: 'mcp', server: 'srv', transport: 'stdio', args: [] },
      { id: 'git-skill', source: 'git', repo: 'https://github.com/a/b', ref: 'main' },
    ];
    const section = buildSkillsSection(skills);
    expect(section).toContain('npm-skill');
    expect(section).toContain('mcp-skill');
    expect(section).toContain('git-skill');
  });
});
