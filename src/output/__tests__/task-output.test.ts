import {
  TaskOutputSchema,
  validateTaskOutput,
  extractJsonFromAgentText,
  isGenuinelyDone,
  summariseOutput,
  type TaskOutput,
} from '../task-output.js';

// ── TaskOutputSchema ──────────────────────────────────────────────────────────

describe('TaskOutputSchema', () => {
  const base = {
    milestoneAdvanced: true,
    confidence: 'high' as const,
    testsResult: 'pass' as const,
  };

  it('parses minimal valid output', () => {
    const result = TaskOutputSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.artifactsProduced).toEqual([]);
      expect(result.data.commandsRun).toEqual([]);
      expect(result.data.blockers).toEqual([]);
    }
  });

  it('defaults skillsRequested to undefined when absent', () => {
    const result = TaskOutputSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skillsRequested).toBeUndefined();
    }
  });

  it('accepts skillsRequested as an array of strings', () => {
    const result = TaskOutputSchema.safeParse({
      ...base,
      skillsRequested: ['my-skill', 'another-skill'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skillsRequested).toEqual(['my-skill', 'another-skill']);
    }
  });

  it('accepts empty skillsRequested array', () => {
    const result = TaskOutputSchema.safeParse({ ...base, skillsRequested: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skillsRequested).toEqual([]);
    }
  });

  it('rejects skillsRequested that is not an array', () => {
    const result = TaskOutputSchema.safeParse({ ...base, skillsRequested: 'bad' });
    expect(result.success).toBe(false);
  });

  it('normalises string commandsRun entries to objects', () => {
    const result = TaskOutputSchema.safeParse({ ...base, commandsRun: ['npm test'] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.commandsRun[0]).toEqual({ cmd: 'npm test', exitCode: 0, passed: true });
    }
  });
});

// ── validateTaskOutput ────────────────────────────────────────────────────────

describe('validateTaskOutput', () => {
  it('returns valid=true for a correct payload', () => {
    const r = validateTaskOutput({ milestoneAdvanced: false, confidence: 'low', testsResult: 'fail' });
    expect(r.valid).toBe(true);
    expect(r.output).not.toBeNull();
    expect(r.errors).toHaveLength(0);
  });

  it('returns valid=false and errors for missing required fields', () => {
    const r = validateTaskOutput({ milestoneAdvanced: true });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('includes skillsRequested in validated output when provided', () => {
    const r = validateTaskOutput({
      milestoneAdvanced: true,
      confidence: 'medium',
      testsResult: 'pass',
      skillsRequested: ['tool-x'],
    });
    expect(r.valid).toBe(true);
    expect(r.output?.skillsRequested).toEqual(['tool-x']);
  });
});

// ── extractJsonFromAgentText ──────────────────────────────────────────────────

describe('extractJsonFromAgentText', () => {
  it('extracts from fenced json block', () => {
    const text = 'Some preamble\n```json\n{"milestoneAdvanced":true}\n```\npostamble';
    expect(extractJsonFromAgentText(text)).toEqual({ milestoneAdvanced: true });
  });

  it('prefers the last valid fenced json block when earlier transcript content includes an invalid sample', () => {
    const text = [
      'OpenAI Codex v0.118.0',
      '--------',
      'user',
      'When done, respond with a JSON block:',
      '```json',
      '{ "milestoneAdvanced": true|false, "testsResult": "pass|fail|skipped|not-run" }',
      '```',
      'assistant',
      '```json',
      '{"milestoneAdvanced":true,"confidence":"high","testsResult":"pass","artifactsProduced":[],"commandsRun":[],"blockers":[],"notes":"done"}',
      '```',
    ].join('\n');

    expect(extractJsonFromAgentText(text)).toEqual({
      milestoneAdvanced: true,
      confidence: 'high',
      testsResult: 'pass',
      artifactsProduced: [],
      commandsRun: [],
      blockers: [],
      notes: 'done',
    });
  });

  it('extracts raw JSON object when no fence', () => {
    const text = 'Result: {"milestoneAdvanced":false}';
    expect(extractJsonFromAgentText(text)).toEqual({ milestoneAdvanced: false });
  });

  it('returns null when no JSON found', () => {
    expect(extractJsonFromAgentText('No JSON here at all')).toBeNull();
  });

  it('extracts JSON containing skillsRequested', () => {
    const payload = { milestoneAdvanced: true, confidence: 'high', testsResult: 'pass', skillsRequested: ['s1'] };
    const text = `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
    expect(extractJsonFromAgentText(text)).toEqual(payload);
  });
});

// ── isGenuinelyDone ───────────────────────────────────────────────────────────

describe('isGenuinelyDone', () => {
  const done: TaskOutput = {
    milestoneAdvanced: true,
    confidence: 'high',
    testsResult: 'pass',
    artifactsProduced: [],
    commandsRun: [],
    blockers: [],
  };

  it('returns true when all signals are positive', () => {
    expect(isGenuinelyDone(done)).toBe(true);
  });

  it('returns false when confidence is low', () => {
    expect(isGenuinelyDone({ ...done, confidence: 'low' })).toBe(false);
  });

  it('returns false when blockers are present', () => {
    expect(isGenuinelyDone({ ...done, blockers: ['some blocker'] })).toBe(false);
  });

  it('returns false when testsResult is fail', () => {
    expect(isGenuinelyDone({ ...done, testsResult: 'fail' })).toBe(false);
  });

  it('returns false when milestoneAdvanced is false', () => {
    expect(isGenuinelyDone({ ...done, milestoneAdvanced: false })).toBe(false);
  });

  it('returns true when skillsRequested is present (does not affect done-ness)', () => {
    expect(isGenuinelyDone({ ...done, skillsRequested: ['some-skill'] })).toBe(true);
  });
});

// ── summariseOutput ───────────────────────────────────────────────────────────

describe('summariseOutput', () => {
  const base: TaskOutput = {
    milestoneAdvanced: true,
    confidence: 'high',
    testsResult: 'pass',
    artifactsProduced: ['src/foo.ts'],
    commandsRun: [],
    blockers: [],
    notes: 'all good',
  };

  it('includes confidence, tests, and milestone advanced', () => {
    const s = summariseOutput(base);
    expect(s).toContain('Confidence: high');
    expect(s).toContain('Tests: pass');
    expect(s).toContain('Milestone advanced: yes');
  });

  it('lists artifacts when present', () => {
    expect(summariseOutput(base)).toContain('Artifacts: src/foo.ts');
  });

  it('lists blockers when present', () => {
    const s = summariseOutput({ ...base, blockers: ['missing dep'] });
    expect(s).toContain('Blockers: missing dep');
  });
});
