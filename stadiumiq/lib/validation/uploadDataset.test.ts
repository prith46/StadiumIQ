import { describe, it, expect } from 'vitest';
import { validateUploadDataset } from './uploadDataset';

describe('Judge Data-Upload Validator', () => {
  it('validates a correct sample dataset matching MetLife venue parameters', () => {
    const validPayload = JSON.stringify({
      density: {
        'sec-101': 0.45,
        'gate-a': 0.90,
      },
      gateStatus: {
        'gate-a': 'congested',
        'gate-d': 'closed',
      },
      incidents: [
        {
          id: 'inc-1001',
          type: 'medical',
          zoneId: 'sec-105',
          note: 'Fan experiencing heat stroke.',
          status: 'pending',
          createdAt: 300,
        },
      ],
    });

    const res = validateUploadDataset(validPayload);
    expect(res.valid).toBe(true);
    expect(res.errors.length).toBe(0);
    expect(res.data?.density?.['sec-101']).toBe(0.45);
  });

  it('rejects unknown top-level keys with specific errors', () => {
    const invalidPayload = JSON.stringify({
      density: { 'sec-101': 0.5 },
      hackedField: 'malicious payload',
    });

    const res = validateUploadDataset(invalidPayload);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Unknown top-level property "hackedField" found.');
  });

  it('rejects density values outside of [0, 1] range', () => {
    const invalidPayload = JSON.stringify({
      density: { 'sec-101': 1.5, 'sec-102': -0.1 },
    });

    const res = validateUploadDataset(invalidPayload);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain("density['sec-101']: value must be a number between 0 and 1.");
    expect(res.errors).toContain("density['sec-102']: value must be a number between 0 and 1.");
  });

  it('rejects density/gateStatus keys referencing nonexistent zones or gates', () => {
    const invalidPayload = JSON.stringify({
      density: { 'sec-999': 0.5 },
      gateStatus: { 'sec-101': 'closed' }, // sec-101 is not a gate
    });

    const res = validateUploadDataset(invalidPayload);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain("density['sec-999']: zone ID does not exist in venue metadata.");
    expect(res.errors).toContain("gateStatus['sec-101']: gate ID does not exist or zone is not a gate.");
  });

  it('rejects malformed incident objects with descriptive errors', () => {
    const invalidPayload = JSON.stringify({
      incidents: [
        {
          id: '',
          type: 'hacked_type',
          zoneId: 'sec-999',
          note: '',
          status: 'unknown_status',
          createdAt: -5,
        },
      ],
    });

    const res = validateUploadDataset(invalidPayload);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('incidents[0].id: must be a non-empty string.');
    expect(res.errors).toContain('incidents[0].type: must be one of crowd|medical|assistance|security|evacuation.');
    expect(res.errors).toContain('incidents[0].zoneId: zone ID does not exist in venue metadata.');
    expect(res.errors).toContain('incidents[0].note: must be a non-empty string.');
    expect(res.errors).toContain('incidents[0].status: must be one of pending|dispatched|resolved.');
    expect(res.errors).toContain('incidents[0].createdAt: must be a non-negative number.');
  });

  it('rejects oversized payloads before parsing', () => {
    const hugePayload = 'a'.repeat(200001);
    const res = validateUploadDataset(hugePayload);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('Payload size exceeds limit');
  });
});
