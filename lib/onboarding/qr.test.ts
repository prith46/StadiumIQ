import { describe, it, expect, vi } from 'vitest';
import { parseQrPayload, generateDemoQrPayload } from './qr';
import { ZONES } from '../venue/venue';

describe('QR Onboarding Payload Parsing & Validation', () => {
  it('successfully validates a correct payload and returns the zoneId', () => {
    const raw = generateDemoQrPayload('sec-214');
    const result = parseQrPayload(raw);
    expect(result).toEqual({ zoneId: 'sec-214' });
  });

  it('returns null for malformed JSON', () => {
    const raw = '{"v": 1, "type": "seat-block", "zoneId": "sec-214"'; // missing closing brace
    const result = parseQrPayload(raw);
    expect(result).toBeNull();
  });

  it('returns null for incorrect v version', () => {
    const raw = JSON.stringify({ v: 2, type: 'seat-block', zoneId: 'sec-214' });
    const result = parseQrPayload(raw);
    expect(result).toBeNull();
  });

  it('returns null for incorrect type field', () => {
    const raw = JSON.stringify({ v: 1, type: 'gate-entry', zoneId: 'sec-214' });
    const result = parseQrPayload(raw);
    expect(result).toBeNull();
  });

  it('returns null for non-existent zoneId', () => {
    const raw = JSON.stringify({ v: 1, type: 'seat-block', zoneId: 'sec-999' });
    const result = parseQrPayload(raw);
    expect(result).toBeNull();
  });

  it('returns null for a zoneId that is not a section', () => {
    // 'gate-a' exists in ZONES but is not a 'section'
    const gateZone = ZONES.find(z => z.type === 'gate');
    expect(gateZone).toBeDefined();
    
    const raw = JSON.stringify({ v: 1, type: 'seat-block', zoneId: gateZone!.id });
    const result = parseQrPayload(raw);
    expect(result).toBeNull();
  });

  it('returns null for payloads exceeding 500 bytes and does not attempt JSON.parse', () => {
    const spy = vi.spyOn(JSON, 'parse');
    
    // Create a payload of 501 characters
    const longString = 'A'.repeat(501);
    const result = parseQrPayload(longString);
    
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    
    spy.mockRestore();
  });
});
