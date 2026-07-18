import { describe, it, expect } from 'vitest';
import { parseLlmJson, stripCodeFences } from './parseLlmJson';

describe('stripCodeFences', () => {
  it('returns unfenced text trimmed but otherwise untouched', () => {
    expect(stripCodeFences('  {"a": 1}  ')).toBe('{"a": 1}');
  });

  it('strips a ```json fence', () => {
    expect(stripCodeFences('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it('strips a bare ``` fence with no language tag', () => {
    expect(stripCodeFences('```\n{"a": 1}\n```')).toBe('{"a": 1}');
  });
});

describe('parseLlmJson', () => {
  it('parses plain JSON', () => {
    expect(parseLlmJson('{"report": "ok"}')).toEqual({ report: 'ok' });
  });

  it('parses fenced JSON', () => {
    expect(parseLlmJson('```json\n{"report": "ok"}\n```')).toEqual({ report: 'ok' });
  });

  it('throws on non-JSON text (call sites decide how to degrade)', () => {
    expect(() => parseLlmJson('sorry, I cannot do that')).toThrow();
  });

  it('throws on null/empty input rather than returning a bogus value', () => {
    expect(() => parseLlmJson(null)).toThrow();
    expect(() => parseLlmJson('')).toThrow();
  });
});
