/**
 * AI-driven project goal discovery.
 *
 * Flow:
 *   1. Ask 5 focused questions via readline
 *   2. Use the available AI CLI to synthesize answers into goal.md content
 *   3. Show a preview and ask for confirmation
 *   4. Return the final goal.md text (caller writes the file)
 *
 * Falls back to a template-based synthesis if no AI CLI is available.
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawnSync } from 'node:child_process';

// ── Questions ─────────────────────────────────────────────────────────────────

const QUESTIONS: Array<{ label: string; prompt: string; hint: string }> = [
  {
    label: 'project',
    prompt: 'What are you building?',
    hint: '  One or two sentences — the core idea.',
  },
  {
    label: 'stack',
    prompt: 'What is the tech stack?',
    hint: '  Languages, frameworks, runtime, databases.',
  },
  {
    label: 'current',
    prompt: 'What already exists?',
    hint: '  Existing code, services, or progress. Type "nothing" if starting fresh.',
  },
  {
    label: 'done',
    prompt: 'What does version 1 look like?',
    hint: '  The first thing you\'d ship, demo, or run. Be specific.',
  },
  {
    label: 'constraints',
    prompt: 'Any hard constraints or things that must never change?',
    hint: '  E.g. "must not break the public API", "no new dependencies". Type "none" if none.',
  },
];

// ── AI synthesis ──────────────────────────────────────────────────────────────

function detectAiCli(): string | null {
  for (const cli of ['claude', 'codex', 'antigravity']) {
    try {
      const r = spawnSync(cli, ['--version'], { encoding: 'utf8', shell: true, timeout: 5_000 });
      if (r.status === 0) return cli;
    } catch {
      // not found — try next
    }
  }
  return null;
}

function synthesizeWithAi(cli: string, answers: Record<string, string>): string {
  const prompt = `
You are helping set up an AI autonomous delivery system called aidev.
The user answered 5 questions about their project.

Project: ${answers['project']}
Tech stack: ${answers['stack']}
Current state: ${answers['current']}
Version 1 goal: ${answers['done']}
Constraints: ${answers['constraints']}

IMPORTANT: Output ONLY the raw file content as plain text. Do NOT use any tools.
Do NOT write files. Do NOT call any functions. Just print the text directly.

Use this exact format — nothing else, no preamble, no explanation:

# <concise title>

<one-sentence description>

## Success criteria

- <specific, testable outcome>
- <specific, testable outcome>
- <include a shell command in backticks if applicable, e.g. \`npm test\`>

## Constraints

- <constraint from user, or "None stated" if none>

## Out of scope

- <anything clearly not part of v1>
- <distribution, packaging, and accounts (unless stated)>
`.trim();

  const result = spawnSync(cli, ['-p', '--allowedTools', ''], {
    input: prompt,
    encoding: 'utf8',
    timeout: 60_000,
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const raw = ((result.stdout ?? '') + (result.stderr ?? '')).trim();
  // Reject if Claude returned a tool-request or empty
  if (!raw || result.status !== 0 || raw.startsWith('Please approve')) return '';
  // Strip any leading prose before the first # heading
  const headingStart = raw.indexOf('\n#');
  const text = headingStart > 0 ? raw.slice(headingStart + 1) : raw;
  return text.startsWith('#') ? text : '';
}

function synthesizeFallback(answers: Record<string, string>): string {
  const title = answers['project']?.split('.')[0] ?? 'Project Goal';
  const constraints = answers['constraints']?.toLowerCase() === 'none'
    ? '- None stated'
    : `- ${answers['constraints']}`;

  return `# ${title}

${answers['project']}

## Success criteria

- ${answers['done']}
- TypeScript compiles: \`npm run typecheck\`
- All tests pass: \`npm test\`

## Constraints

${constraints}

## Out of scope

- Distribution / packaging / signing
- Authentication, accounts, or telemetry (unless stated above)
`.trim();
}

// ── Readline helpers ──────────────────────────────────────────────────────────

function hr(char = '─', width = 60): string {
  return char.repeat(width);
}

async function ask(rl: readline.Interface, question: string, hint: string): Promise<string> {
  console.log(`\n${question}`);
  if (hint) console.log(`\x1b[2m${hint}\x1b[0m`);
  const answer = await rl.question('  → ');
  return answer.trim() || '(not specified)';
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface QuestionnaireResult {
  goalMd: string;
  answers: Record<string, string>;
}

export async function runQuestionnaire(): Promise<QuestionnaireResult> {
  const rl = readline.createInterface({ input, output, terminal: true });

  console.log('\n' + hr('═'));
  console.log('  Tell me about your project');
  console.log(hr('═'));
  console.log('  I\'ll ask 5 questions, then use AI to write your goal.md.');
  console.log(hr());

  const answers: Record<string, string> = {};
  for (const q of QUESTIONS) {
    answers[q.label] = await ask(rl, q.prompt, q.hint);
  }

  rl.close();

  // Synthesize
  console.log('\n' + hr());
  const cli = detectAiCli();
  let goalMd: string;

  if (cli) {
    console.log(`  Synthesizing goal.md with ${cli}…`);
    goalMd = synthesizeWithAi(cli, answers);
    if (!goalMd) {
      console.log('  (AI synthesis failed — using template)');
      goalMd = synthesizeFallback(answers);
    }
  } else {
    console.log('  (No AI CLI found — using template synthesis)');
    goalMd = synthesizeFallback(answers);
  }

  // Preview
  console.log('\n' + hr('═'));
  console.log('  Your goal.md');
  console.log(hr('═'));
  console.log(goalMd.split('\n').map((l) => `  ${l}`).join('\n'));
  console.log(hr('═'));

  // Confirm
  const rl2 = readline.createInterface({ input, output, terminal: true });
  const confirm = await rl2.question('\n  Looks good? [y / edit / quit]  → ');
  rl2.close();

  const choice = confirm.trim().toLowerCase();

  if (choice === 'quit' || choice === 'q') {
    console.log('\n  Aborted. Run `aidev init` again when ready.');
    process.exit(0);
  }

  if (choice === 'edit' || choice === 'e') {
    console.log('\n  Paste your goal.md content below.');
    console.log('  Type a line with just "EOF" when done:\n');

    const rl3 = readline.createInterface({ input, output, terminal: true });
    const lines: string[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const line = await rl3.question('');
      if (line.trim() === 'EOF') break;
      lines.push(line);
    }
    rl3.close();
    goalMd = lines.join('\n').trim();
  }

  return { goalMd, answers };
}
