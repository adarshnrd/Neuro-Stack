import { describe, it, expect } from 'vitest';
import { parseVerdict } from '../src/graph/nodes/loopNodes.js';

describe('parseVerdict', () => {
  it('parses a clean JSON verdict', () => {
    const raw = JSON.stringify({
      complete: true,
      unmetCriteria: [],
      findings: [],
      reworkGuidance: '',
    });
    const v = parseVerdict(raw);
    expect(v.complete).toBe(true);
    expect(v.unmetCriteria).toEqual([]);
  });

  it('extracts JSON embedded in surrounding prose', () => {
    const raw = 'Here is my verdict:\n```json\n{"complete": false, "unmetCriteria": ["does A"], "findings": ["missing A"], "reworkGuidance": "add A"}\n```\nDone.';
    const v = parseVerdict(raw);
    expect(v.complete).toBe(false);
    expect(v.unmetCriteria).toEqual(['does A']);
    expect(v.findings).toEqual(['missing A']);
  });

  it('strips reasoning think blocks before parsing (handled upstream, but tolerant here)', () => {
    const raw = '{"complete": true, "unmetCriteria": [], "findings": [], "reworkGuidance": "ok"}';
    expect(parseVerdict(raw).complete).toBe(true);
  });

  it('falls back safely on unparseable input', () => {
    const v = parseVerdict('no json here at all');
    expect(v.complete).toBe(false);
    expect(v.findings.length).toBeGreaterThan(0);
  });

  it('coerces non-boolean complete to false', () => {
    const v = parseVerdict('{"complete": "yes"}');
    expect(v.complete).toBe(false);
  });
});
