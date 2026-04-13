/**
 * project-probe.ts
 *
 * Probes the repository at run-start and produces a ProjectContext that replaces
 * the hardcoded PROJECT_CONTEXT string in aidev.hooks.ts.
 * Designed to be project-agnostic: it reads standard files rather than
 * assuming any specific stack.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProjectContext {
  name: string;
  description: string;
  stack: StackInfo;
  testCommands: TestCommands;
  keyPaths: KeyPaths;
  constraints: string[];
  formatted: string; // ready-to-inject prompt block
}

export interface StackInfo {
  language: string[];
  framework: string[];
  packageManager: string;
  runtime: string;
}

export interface TestCommands {
  unit: string | null;
  e2e: string | null;
  typecheck: string | null;
  lint: string | null;
  all: string | null;
}

export interface KeyPaths {
  sources: string[];
  tests: string[];
  config: string[];
}

// ── Probe entry point ─────────────────────────────────────────────────────────

export async function probeProject(root: string): Promise<ProjectContext> {
  const [pkg, readme, constraints] = await Promise.all([
    readJsonSafe(join(root, 'package.json')),
    readTextSafe(join(root, 'README.md'), 600),
    readAidevConstraints(root),
  ]);

  const stack = inferStack(root, pkg);
  const testCommands = extractTestCommands(pkg);
  const keyPaths = await discoverKeyPaths(root);

  const name: string = pkg?.name ?? inferNameFromDir(root);
  const description: string = pkg?.description ?? extractReadmeSummary(readme);

  const context: Omit<ProjectContext, 'formatted'> = {
    name,
    description,
    stack,
    testCommands,
    keyPaths,
    constraints,
  };

  return { ...context, formatted: formatContext(context) };
}

// ── Stack inference ───────────────────────────────────────────────────────────

function inferStack(root: string, pkg: Record<string, any> | null): StackInfo {
  const deps = {
    ...((pkg?.dependencies as Record<string, string>) ?? {}),
    ...((pkg?.devDependencies as Record<string, string>) ?? {}),
  };

  const language: string[] = [];
  const framework: string[] = [];

  // Languages
  if (pkg !== null) language.push('TypeScript/JavaScript');
  if (hasFile(root, 'pyproject.toml') || hasFile(root, 'setup.py')) language.push('Python');
  if (hasFile(root, 'Cargo.toml')) language.push('Rust');
  if (hasFile(root, 'go.mod')) language.push('Go');
  if (hasFile(root, 'pom.xml') || hasFile(root, 'build.gradle')) language.push('Java/Kotlin');

  // JS frameworks
  if (deps['react']) framework.push('React');
  if (deps['vue']) framework.push('Vue');
  if (deps['svelte']) framework.push('Svelte');
  if (deps['next']) framework.push('Next.js');
  if (deps['electron']) framework.push('Electron');
  if (deps['express'] || deps['fastify'] || deps['koa']) framework.push('Node HTTP server');
  if (deps['vite'] || deps['electron-vite']) framework.push('Vite');

  // Package manager
  let packageManager = 'npm';
  if (hasFile(root, 'pnpm-lock.yaml')) packageManager = 'pnpm';
  else if (hasFile(root, 'yarn.lock')) packageManager = 'yarn';
  else if (hasFile(root, 'bun.lockb')) packageManager = 'bun';

  // Runtime
  let runtime = 'Node.js';
  if (deps['electron']) runtime = 'Electron (Chromium + Node.js)';
  if (hasFile(root, 'Cargo.toml')) runtime = 'Native (Rust)';
  if (hasFile(root, 'go.mod')) runtime = 'Go runtime';

  return { language, framework, packageManager, runtime };
}

// ── Test command extraction ───────────────────────────────────────────────────

function extractTestCommands(pkg: Record<string, any> | null): TestCommands {
  const scripts: Record<string, string> = pkg?.scripts ?? {};
  const pm = detectPackageManagerFromScripts(scripts);

  const run = (name: string) => (scripts[name] ? `${pm} run ${name}` : null);

  // Prefer explicit names, fall back to common conventions
  return {
    unit:      run('test:unit')      ?? run('test')           ?? null,
    e2e:       run('test:e2e')       ?? run('test:playwright') ?? run('test:cypress') ?? null,
    typecheck: run('typecheck')      ?? run('type-check')      ?? run('tsc')          ?? null,
    lint:      run('lint')           ?? run('eslint')          ?? null,
    all:       run('test:all')       ?? run('test')            ?? null,
  };
}

function detectPackageManagerFromScripts(_scripts: Record<string, string>): string {
  if (hasFile(process.cwd(), 'pnpm-lock.yaml')) return 'pnpm';
  if (hasFile(process.cwd(), 'yarn.lock')) return 'yarn';
  if (hasFile(process.cwd(), 'bun.lockb')) return 'bun';
  return 'npm';
}

// ── Key path discovery ────────────────────────────────────────────────────────

async function discoverKeyPaths(root: string): Promise<KeyPaths> {
  const sources: string[] = [];
  const tests: string[] = [];
  const config: string[] = [];

  const topLevel = await safeReaddir(root);

  // Source roots
  for (const candidate of ['src', 'lib', 'app', 'packages', 'core']) {
    if (topLevel.includes(candidate)) sources.push(candidate + '/');
  }

  // Test roots
  for (const candidate of ['tests', 'test', '__tests__', 'spec', 'e2e']) {
    if (topLevel.includes(candidate)) tests.push(candidate + '/');
  }

  // Config files
  for (const candidate of [
    'tsconfig.json', 'vite.config.ts', 'electron.vite.config.ts',
    'jest.config.cjs', 'playwright.config.ts', 'package.json',
    '.env', '.env.aidev',
  ]) {
    if (topLevel.includes(candidate)) config.push(candidate);
  }

  return { sources, tests, config };
}

// ── aidev-specific constraints ────────────────────────────────────────────────

async function readAidevConstraints(root: string): Promise<string[]> {
  const constraintFiles = [
    join(root, '.aidev/playbooks/general-aidev-operations.md'),
  ];

  const constraints: string[] = [];

  for (const file of constraintFiles) {
    const text = await readTextSafe(file, 800);
    if (text) {
      // Extract bullet lines as individual constraints
      const bullets = text
        .split('\n')
        .filter((line) => line.trim().startsWith('-'))
        .map((line) => line.trim().replace(/^-\s*/, ''))
        .filter(Boolean);
      constraints.push(...bullets);
    }
  }

  return constraints;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatContext(ctx: Omit<ProjectContext, 'formatted'>): string {
  const lines: string[] = [
    `## Project: ${ctx.name}`,
    '',
    ctx.description ? ctx.description : '',
    '',
    '### Stack',
    `- Language: ${ctx.stack.language.join(', ') || 'unknown'}`,
    `- Framework: ${ctx.stack.framework.join(', ') || 'none detected'}`,
    `- Runtime: ${ctx.stack.runtime}`,
    `- Package manager: ${ctx.stack.packageManager}`,
    '',
    '### Test commands',
  ];

  const { testCommands: tc } = ctx;
  if (tc.unit)      lines.push(`- Unit:      ${tc.unit}`);
  if (tc.e2e)       lines.push(`- E2E:       ${tc.e2e}`);
  if (tc.typecheck) lines.push(`- Typecheck: ${tc.typecheck}`);
  if (tc.lint)      lines.push(`- Lint:      ${tc.lint}`);
  if (!tc.unit && !tc.e2e) lines.push('- No test commands detected');

  if (ctx.keyPaths.sources.length) {
    lines.push('', '### Source roots', ...ctx.keyPaths.sources.map((p) => `- ${p}`));
  }

  if (ctx.keyPaths.tests.length) {
    lines.push('', '### Test roots', ...ctx.keyPaths.tests.map((p) => `- ${p}`));
  }

  if (ctx.constraints.length) {
    lines.push('', '### Operating constraints', ...ctx.constraints.map((c) => `- ${c}`));
  }

  return lines.filter((l) => l !== undefined).join('\n').trim();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readJsonSafe(path: string): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function readTextSafe(path: string, maxChars = 1000): Promise<string> {
  try {
    const text = await readFile(path, 'utf8');
    return text.slice(0, maxChars);
  } catch {
    return '';
  }
}

function extractReadmeSummary(readme: string): string {
  // Return the first non-heading, non-empty paragraph
  const lines = readme.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('!')) {
      return trimmed.slice(0, 200);
    }
  }
  return '';
}

function inferNameFromDir(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? 'unknown-project';
}

function hasFile(root: string, name: string): boolean {
  // Sync check via try/catch on statSync would require 'fs' — keep it simple
  // by checking a cached top-level listing set when available.
  // For now this is a best-effort heuristic; accuracy improves via discoverKeyPaths.
  try {
    require('fs').accessSync(join(root, name));
    return true;
  } catch {
    return false;
  }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
