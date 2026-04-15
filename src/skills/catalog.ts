/**
 * Built-in skills catalog.
 *
 * Pre-defined entries sourced from community research. Users add any skill to
 * their project with `aidev skills add <id>` — this writes the entry into
 * .aidev/skills.json so the runner injects it into every task prompt.
 *
 * Categories:
 *   memory      — cross-session context and knowledge retention
 *   workflow    — task automation and integration
 *   design      — UI/UX and design system tooling
 *   voice       — audio interfaces
 *   patterns    — skill and workflow pattern libraries
 *   knowledge   — RAG and document understanding
 *   agents      — multi-agent orchestration
 */

import type { SkillEntry } from './types.js';

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  homepage: string;
  skill: SkillEntry;
}

export const CATALOG: CatalogEntry[] = [
  // ── Memory ─────────────────────────────────────────────────────────────────

  {
    id: 'claude-mem',
    name: 'claude-mem',
    description: 'Persistent cross-session memory for Claude. Hybrid semantic + keyword search via Chroma vector DB and SQLite FTS5. Captures context automatically on session start/end.',
    category: 'memory',
    homepage: 'https://github.com/thedotmack/claude-mem',
    skill: {
      id: 'claude-mem',
      source: 'npm',
      package: 'claude-mem',
      description: 'Persistent cross-session memory with semantic search (Chroma + SQLite)',
    },
  },

  {
    id: 'lightrag',
    name: 'LightRAG',
    description: 'Knowledge graph + RAG engine. Dual-level retrieval combining entity/relationship-level and chunk-level RAG. Outperforms baseline RAG by 50-85% on comprehension tasks. Multi-backend: PostgreSQL, Neo4j, MongoDB.',
    category: 'knowledge',
    homepage: 'https://github.com/HKUDS/LightRAG',
    skill: {
      id: 'lightrag',
      source: 'git',
      repo: 'https://github.com/HKUDS/LightRAG',
      ref: 'main',
      description: 'Knowledge graph RAG — entity/relationship-level retrieval for large doc corpora',
    },
  },

  // ── Workflow & Integration ─────────────────────────────────────────────────

  {
    id: 'n8n-mcp',
    name: 'n8n MCP',
    description: 'Bridges AI assistants to n8n automation platform. Access 1,396+ nodes, 2,709 workflow templates, and REST API to create/validate/deploy workflows directly from Claude.',
    category: 'workflow',
    homepage: 'https://github.com/czlonkowski/n8n-mcp',
    skill: {
      id: 'n8n-mcp',
      source: 'mcp',
      server: 'n8n-mcp',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'n8n-mcp'],
      description: '1,396+ n8n automation nodes — create and deploy workflows via MCP',
    },
  },

  // ── Voice ─────────────────────────────────────────────────────────────────

  {
    id: 'voicemode',
    name: 'Voice Mode',
    description: 'Two-way natural voice conversations with Claude Code. Offline-capable via Whisper.cpp STT and Kokoro TTS. Smart silence detection, privacy-focused local execution.',
    category: 'voice',
    homepage: 'https://github.com/mbailey/voicemode',
    skill: {
      id: 'voicemode',
      source: 'mcp',
      server: 'voicemode',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@mbailey/voicemode'],
      description: 'Voice interaction — hands-free dev with local STT/TTS',
    },
  },

  // ── Design ────────────────────────────────────────────────────────────────

  {
    id: 'ui-ux-pro',
    name: 'UI/UX Pro Max Skill',
    description: 'Auto-generates professional design systems. 67 UI styles, 161 industry-specific rules, 161 color palettes, 57 font pairings, 25 chart recommendations. Supports React, Vue, Next.js, Swift, Flutter.',
    category: 'design',
    homepage: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    skill: {
      id: 'ui-ux-pro',
      source: 'git',
      repo: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
      ref: 'main',
      description: 'Domain-aware design system generator — 67 styles, 161 industry palettes',
    },
  },

  // ── Patterns & Orchestration ──────────────────────────────────────────────

  {
    id: 'superpowers',
    name: 'Superpowers',
    description: 'Composable skill framework with structured development pipeline: Brainstorming → Planning → Subagent Dev → TDD → Review. Git worktree isolation, mandatory verification stages, two-stage reviews.',
    category: 'patterns',
    homepage: 'https://github.com/obra/superpowers',
    skill: {
      id: 'superpowers',
      source: 'git',
      repo: 'https://github.com/obra/superpowers',
      ref: 'main',
      description: 'Structured pipeline skills — brainstorm → plan → TDD → review with worktree isolation',
    },
  },

  {
    id: 'antigravity-skills',
    name: 'Antigravity Awesome Skills',
    description: '1,410+ installable skills covering development, testing, security, infrastructure, product, and marketing. NPM-based installer with role-based bundles (Full-Stack, Security Engineer, etc.).',
    category: 'patterns',
    homepage: 'https://github.com/sickn33/antigravity-awesome-skills',
    skill: {
      id: 'antigravity-skills',
      source: 'npm',
      package: '@antigravity/skills',
      description: '1,410+ pre-built agent skill patterns — role bundles for full-stack, security, infra, etc.',
    },
  },

  {
    id: 'everything-claude',
    name: 'Everything Claude Code',
    description: '48 specialized agents, 183 reusable skills, 79 command shims, 34+ language rules, 20+ hooks, 14 pre-integrated MCP servers. Token optimization, model routing, cross-harness compatibility.',
    category: 'agents',
    homepage: 'https://github.com/affaan-m/everything-claude-code',
    skill: {
      id: 'everything-claude',
      source: 'git',
      repo: 'https://github.com/affaan-m/everything-claude-code',
      ref: 'main',
      description: '48 specialized agents + 183 skills — production multi-agent orchestration framework',
    },
  },

  {
    id: 'claude-blueprints',
    name: 'Claude Agent Blueprints',
    description: '75+ domain-specific agent workspaces (systems admin, legal, health, business planning). 350+ slash commands, MCP integration guides, multi-agent coordination. Agent Workspace Model pattern.',
    category: 'agents',
    homepage: 'https://github.com/danielrosehill/Claude-Agent-Blueprints',
    skill: {
      id: 'claude-blueprints',
      source: 'git',
      repo: 'https://github.com/danielrosehill/Claude-Agent-Blueprints',
      ref: 'main',
      description: '75+ domain workspaces + 350 slash commands — multi-agent scaffolding',
    },
  },

  {
    id: 'composio-plugins',
    name: 'Composio Claude Plugins',
    description: 'Production-ready extensions: 500+ service integrations, frontend/design tools, git utilities, code quality, DevOps automation. Modular architecture with plugin standards.',
    category: 'workflow',
    homepage: 'https://github.com/ComposioHQ/awesome-claude-plugins',
    skill: {
      id: 'composio-plugins',
      source: 'npm',
      package: '@composio/claude-plugins',
      description: '500+ service integrations — git, DevOps, code quality via modular plugin system',
    },
  },
];

// ── Lookup helpers ────────────────────────────────────────────────────────────

export function findCatalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.id === id);
}

export function searchCatalog(query: string): CatalogEntry[] {
  const q = query.toLowerCase();
  return CATALOG.filter(
    (e) =>
      e.id.includes(q) ||
      e.name.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q),
  );
}

export function catalogByCategory(): Map<string, CatalogEntry[]> {
  const map = new Map<string, CatalogEntry[]>();
  for (const entry of CATALOG) {
    const list = map.get(entry.category) ?? [];
    list.push(entry);
    map.set(entry.category, list);
  }
  return map;
}
