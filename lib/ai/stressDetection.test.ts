import { describe, it, expect } from 'vitest';
import { detectStressHeuristic } from './stressDetection';

describe('Stress Detection Heuristic', () => {
  it('detects neutral messages as false', () => {
    const res = detectStressHeuristic("where's the nearest restroom");
    expect(res.isStress).toBe(false);
  });

  it('rejects help-only normal requests as false positives', () => {
    const res1 = detectStressHeuristic("help me find my seat");
    expect(res1.isStress).toBe(false);

    const res2 = detectStressHeuristic("can you help me find gate B");
    expect(res2.isStress).toBe(false);
  });

  it('triggers stress on standalone panic/fear keywords', () => {
    const res1 = detectStressHeuristic("I am scared");
    expect(res1.isStress).toBe(true);
    expect(res1.matchedSignals).toContain('low-keyword:scared');
    expect(res1.confidence).toBe('low');

    const res2 = detectStressHeuristic("there is a panic here");
    expect(res2.isStress).toBe(true);
    expect(res2.matchedSignals).toContain('low-keyword:panic');
  });

  it('triggers stress on co-occurring help signals', () => {
    const res1 = detectStressHeuristic("help I'm scared");
    expect(res1.isStress).toBe(true);
    expect(res1.matchedSignals).toContain('low-keyword:scared');
    expect(res1.matchedSignals).toContain('help-combination');

    const res2 = detectStressHeuristic("HELP!!");
    expect(res2.isStress).toBe(true);
    expect(res2.matchedSignals).toContain('exclamation');
    expect(res2.matchedSignals).toContain('help-combination');
  });

  it('triggers high-severity and high confidence for critical keywords', () => {
    const res = detectStressHeuristic("I cant breathe in this section");
    expect(res.isStress).toBe(true);
    expect(res.confidence).toBe('high');
    expect(res.matchedSignals).toContain("high-keyword:cant breathe");
  });

  it('triggers stress on excessive punctuation and all-caps shouting', () => {
    const res1 = detectStressHeuristic("Where are you??");
    expect(res1.isStress).toBe(true);
    expect(res1.matchedSignals).toContain('question-panic');

    const res2 = detectStressHeuristic("FIRE IN SECTOR PLEASE EVACUATE");
    expect(res2.isStress).toBe(true);
    expect(res2.matchedSignals).toContain('all-caps');
  });
});
