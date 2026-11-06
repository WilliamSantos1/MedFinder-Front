import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { patientProfile } from '../server/domain/patient.js';
import { routeComplaint } from '../server/domain/specialty-routing.js';

type RegressionCase = {
  message: string;
  type: 'deterministic' | 'candidate' | 'clarification' | 'semantic-fallback';
  expected?: string;
  expectedAny?: string[];
  expectedTopics?: string[];
  expectedFallback?: string;
};

const cases = JSON.parse(
  await readFile('data/routing-regression-cases.json', 'utf8'),
) as RegressionCase[];

describe('Corpus sintético auditável de navegação', () => {
  it.each(cases)('$type: $message', (item) => {
    const result = routeComplaint([item.message], patientProfile([item.message]));
    expect(result.healthComplaint).toBe(true);

    if (item.type === 'deterministic') {
      expect(result.deterministicId).toBe(item.expected);
      return;
    }

    if (item.type === 'candidate') {
      expect(result.deterministicId).toBeNull();
      const ids = result.candidates.map((candidate) => candidate.id);
      for (const id of item.expectedAny ?? []) expect(ids).toContain(id);
      return;
    }

    if (item.type === 'clarification') {
      expect(result.deterministicId).toBeNull();
      for (const topic of item.expectedTopics ?? [])
        expect(result.clarificationTopics).toContain(topic);
      return;
    }

    expect(result.deterministicId).toBeNull();
    expect(result.fallbackId).toBe(item.expectedFallback);
  });
});
