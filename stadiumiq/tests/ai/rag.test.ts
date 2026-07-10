import { describe, it, expect } from 'vitest';
import { loadKnowledgeBase, retrieve } from '../../lib/ai/rag';

describe('RAG-Lite Knowledge Base', () => {
  // 1. loadKnowledgeBase parses sections
  it('loadKnowledgeBase parses ## sections correctly', () => {
    const kb = loadKnowledgeBase();
    expect(kb.length).toBeGreaterThan(0);

    const sections = kb.map(k => k.section);
    expect(sections).toContain('Prohibited Items');
    expect(sections).toContain('Gate Hours');
    expect(sections).toContain('Bag Policy');
    expect(sections).toContain('Re-entry Policy');
    expect(sections).toContain('Accessibility Services');
    expect(sections).toContain('Lost and Found');
  });

  // 2. retrieve scores and ranks matches, breaks ties by original order
  it('ranks queries correctly and breaks ties by original order', () => {
    // Query with words matching bag policy: "bag size plastic limit"
    const results = retrieve('bag size limit', 2);
    expect(results).toHaveLength(2);
    expect(results[0].section).toBe('Bag Policy');

    // Query matching prohibited items and lost and found: "weapons items lost"
    const res2 = retrieve('weapons items lost', 2);
    expect(res2).toHaveLength(2);
    expect(res2[0].section).toBe('Prohibited Items');
    expect(res2[1].section).toBe('Lost and Found');
  });
});
