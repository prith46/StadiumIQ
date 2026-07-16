import { describe, it, expect } from 'vitest';
import { sensoryToRouteFilters } from './sensoryFilters';

describe('sensoryToRouteFilters', () => {
  it('maps quiet: true to avoidEnclosed: true and maxNoise: low', () => {
    const filters = sensoryToRouteFilters({ quiet: true });
    expect(filters.avoidEnclosed).toBe(true);
    expect(filters.maxNoise).toBe('low');
  });

  it('maps openAir: true to avoidEnclosed: true (no maxNoise implication)', () => {
    const filters = sensoryToRouteFilters({ openAir: true });
    expect(filters.avoidEnclosed).toBe(true);
    expect(filters.maxNoise).toBeUndefined();
  });

  it('quiet and openAir both false/undefined leaves all filters undefined', () => {
    const filters = sensoryToRouteFilters({ quiet: false, openAir: false });
    expect(filters.avoidEnclosed).toBeUndefined();
    expect(filters.maxNoise).toBeUndefined();
    expect(filters.avoidAffiliation).toBeUndefined();
  });

  it('avoidAffiliation passes through directly', () => {
    expect(sensoryToRouteFilters({ avoidAffiliation: 'home' }).avoidAffiliation).toBe('home');
    expect(sensoryToRouteFilters({ avoidAffiliation: 'away' }).avoidAffiliation).toBe('away');
  });

  it('undefined fanContext.sensory produces an empty filters object (regression-safety)', () => {
    const filters = sensoryToRouteFilters(undefined);
    expect(filters).toEqual({
      avoidEnclosed: undefined,
      maxNoise: undefined,
      avoidAffiliation: undefined,
    });
  });

  it('quiet OR openAir both true still yields a single avoidEnclosed: true (no conflict)', () => {
    const filters = sensoryToRouteFilters({ quiet: true, openAir: true });
    expect(filters.avoidEnclosed).toBe(true);
    expect(filters.maxNoise).toBe('low');
  });
});
