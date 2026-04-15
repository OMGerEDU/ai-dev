# aidev

**Goal-based autonomous AI delivery engine.**

Drop a `.aidev/` folder into any project, describe what done looks like, and run `aidev run`. The engine picks tasks, calls your AI agent (Claude, Codex, Gemini), verifies results, generates follow-up work, and keeps going until the goal is met or it needs you.

---

## How it works

```
goal.md  →  milestones  →  tasks  →  AI call  →  verify  →  continuations  →  repeat
```

1. You write `.aidev/goal.md` — one sentence goal + testable success criteria
2. `aidev verify` derives milestones from the goal and runs their verify commands
3. `aidev run` picks the next open task, builds a prompt, calls the AI provider CLI, validates output, re-runs verification, generates gap-driven continuations, and loops
4. When the goal is complete, it stops

Each cycle is: **Pick → Build prompt → Call AI → Verify → Continue**

---

## Deploy in 2 minutes

### Prerequisites

- Node.js 18+
- At least one AI agent CLI on PATH:
  - [Claude Code](https://claude.ai/code) — `claude`
  - [OpenAI Codex CLI](https://github.com/openai/codex) — `codex`
  - [Antigravity](https://github.com/sickn33/antigravity) — `antigravity` *(optional)*

### 1. Install

```bash
# From npm (once published)
npm install -g @aidev/core

# Or from source
git clone https://github.com/OMGerEDU/ai-dev.git
cd ai-dev
npm install && npm run build
npm link        # makes `aidev` available globally
```

### 2. Run the setup wizard

```bash
cd your-project
aidev init
```

The wizard walks you through three steps:

```
══════════════════════════════════════════════════════════
  aidev — autonomous AI delivery engine
══════════════════════════════════════════════════════════

  ✓ Found AI CLI: claude, codex

Step 1 — Task Board
  Where should aidev track tasks?
  1. Local files  (no account needed)
  2. Linear
  3. ClickUp
  Choice [1/2/3]: 1

Step 2 — Project Goal
  What are you building?
  → A REST API for user management with JWT auth

  What is the tech stack?
  → Node.js, Express, TypeScript, PostgreSQL

  What already exists?
  → Empty repo with package.json

  What does version 1 look like?
  → CRUD endpoints for users, tests passing, deployed to staging

  Any hard constraints?
  → Do not change the DB schema without review

  Synthesizing goal.md with claude…

  ══════════════════════════════════
  Your goal.md
  ══════════════════════════════════
  # Build a user management REST API
  ...
  ══════════════════════════════════

  Looks good? [y / edit / quit] → y

Step 3 — Skills
  memory
   1) claude-mem          Persistent cross-session memory (Chroma + SQLite)
  workflow
   2) n8n-mcp             1,396+ n8n automation nodes
  ...

  Add skills (numbers or IDs): 1

  ══════════════════════════════════
  Done!
  ══════════════════════════════════
  ✓ .aidev/goal.md
  ✓ .aidev/providers.json
  ✓ .env.aidev
  ✓ .aidev/skills.json (1 skill)

  Next: aidev run
```

### 3. Run

```bash
aidev run
```

### 4. Configure providers

Edit `.aidev/providers.json` (or use the default). Set which AI agents you have available:

```json
{
  "providers": {
    "claude": { "cli": "claude", "available": true },
    "codex":  { "cli": "codex",  "available": true }
  }
}
```

Or override at runtime:

```bash
AGENTS=claude,codex aidev run
```

### 5. Create your first task

Create `.aidev/tasks/open/my-first-task.md`:

```markdown
---
id: task-001
title: Scaffold the Express app
type: implementation
milestone: m1
tags: [start]
---

Set up a basic Express app with TypeScript, health check endpoint, and Jest config.
```

Tasks tagged `start` are picked up automatically.

### 6. Run

```bash
aidev run
```

Watch it go. Check progress any time:

```bash
aidev status
```

---

## CLI reference

| Command | Description |
|---------|-------------|
| `aidev init` | Interactive setup wizard — board, goal, skills |
| `aidev run` | Run the autonomous goal loop |
| `aidev status` | Print goal progress and milestone states |
| `aidev verify` | Run verifyCmd for all unverified milestones |
| `aidev memory` | Show what aidev has learned about this project |
| `aidev skills` | Manage skills (see below) |

Flags for `aidev run`:

| Flag | Default | Description |
|------|---------|-------------|
| `--dry-run` | off | Log prompts without calling AI |
| `--max-tasks=N` | 20 | Safety cap on tasks per run |

---

---

## Skills

Skills are pre-built capabilities the AI agent can reference in every task prompt. They're stored in `.aidev/skills.json` and installed automatically at run time.

### Built-in catalog (10 skills)

| ID | Category | Description |
|----|----------|-------------|
| `claude-mem` | memory | Persistent cross-session memory — Chroma vector DB + SQLite FTS5 |
| `lightrag` | knowledge | Knowledge graph RAG — entity/relationship retrieval, 50-85% better comprehension |
| `n8n-mcp` | workflow | 1,396+ n8n automation nodes via MCP |
| `voicemode` | voice | Hands-free voice interaction — local Whisper STT + Kokoro TTS |
| `ui-ux-pro` | design | Design system generator — 67 styles, 161 industry palettes |
| `superpowers` | patterns | Structured pipeline: brainstorm → plan → TDD → review |
| `antigravity-skills` | patterns | 1,410+ installable skill patterns via npm |
| `everything-claude` | agents | 48 specialized agents + 183 skills framework |
| `claude-blueprints` | agents | 75+ domain workspaces + 350 slash commands |
| `composio-plugins` | workflow | 500+ service integrations — git, DevOps, code quality |

### Skill commands

```bash
aidev skills list                 # show full catalog
aidev skills search memory        # filter by keyword
aidev skills add claude-mem       # add to .aidev/skills.json
aidev skills pull claude-mem      # alias for add
aidev skills remove claude-mem    # remove
aidev skills installed            # what's active in this project
```

### Manual entry

Add any skill by editing `.aidev/skills.json` directly:

```json
{
  "skills": [
    {
      "id": "my-skill",
      "source": "npm",
      "package": "my-skill-package",
      "description": "What this skill does"
    }
  ]
}
```

Supported sources: `npm`, `mcp`, `git`.

---

## Project structure

```
your-project/
├── .aidev/
│   ├── goal.md              ← describe done here
│   ├── providers.json       ← AI provider routing
│   ├── aidev.hooks.mjs      ← optional: project-specific hooks
│   ├── milestones.json      ← auto-generated, tracked by git
│   ├── memory.json          ← auto-generated, gitignored
│   └── tasks/
│       ├── open/            ← tasks ready to work
│       └── pending/         ← tasks not yet unblocked
└── .env.aidev               ← API keys and config (gitignored)
```

---

## Environment variables

Create `.env.aidev` in your project root (gitignored):

```bash
# Which agents are available (overrides providers.json)
AGENTS=claude,codex

# API keys (passed through to the AI CLI tools)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Load a second env file (e.g. shared secrets)
AIDEV_ENV_EXTEND=/path/to/shared.env
```

---

## Multi-agent routing

aidev routes tasks to the best available agent based on task type and agent strengths:

| Task type | Best agent |
|-----------|-----------|
| `research`, `planning`, `qa` | Claude (reasoning-heavy) |
| `implementation`, `refactor`, `debugging` | Codex (mechanical edits) |
| `long-doc`, `codebase-survey` | Gemini/Antigravity (large context) |

The routing table lives in `.aidev/providers.json` and is fully configurable.

---

## Hooks

Extend aidev behavior without modifying the engine. Create `.aidev/aidev.hooks.mjs`:

```javascript
export default {
  // Called before every AI invocation — add project context
  buildProjectContext: async (ctx) => {
    return `My project uses React 18 and PostgreSQL 15.\n` +
           `Always write tests alongside implementation.\n`;
  },

  // Called after each task completes — post to Slack, update tickets, etc.
  onTaskDone: async (ctx) => {
    console.log(`[done] ${ctx.task.title}`);
  },
};
```

Available hooks: `createBoard`, `buildProjectContext`, `buildTaskGuidance`, `onTaskStart`, `onTaskDone`, `onTaskFail`, `onRunComplete`.

See [src/hooks/contract.ts](src/hooks/contract.ts) for the full hook interface.

---

## Task format

Tasks are Markdown files with YAML frontmatter:

```markdown
---
id: task-abc
title: Human-readable title
type: implementation   # implementation | research | qa | refactor | debugging
milestone: m2          # which milestone this advances
dependsOn: [task-xyz]  # optional: blocks until listed tasks complete
tags: [start]          # 'start' = ready to run immediately
---

Detailed description of what the agent should do.
Include acceptance criteria, relevant file paths, and any constraints.
```

---

## Recommended extensions

These tools pair well with aidev:

| Tool | What it adds |
|------|-------------|
| [claude-mem](https://github.com/thedotmack/claude-mem) | Persistent cross-session memory for Claude |
| [superpowers](https://github.com/obra/superpowers) | Structured dev pipeline with mandatory verification |
| [n8n-mcp](https://github.com/czlonkowski/n8n-mcp) | Workflow automation integration |
| [voicemode](https://github.com/mbailey/voicemode) | Voice-driven developer interaction |
| [antigravity skills](https://github.com/sickn33/antigravity-awesome-skills) | 1400+ pre-built agent skill patterns |
| [LightRAG](https://github.com/HKUDS/LightRAG) | Knowledge graph RAG for large doc corpora |

---

## Contributing

1. Fork the repo
2. `npm install && npm run build`
3. `npm test` — all tests must pass
4. Open a PR

---

## License

MIT
