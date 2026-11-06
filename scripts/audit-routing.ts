import { readFile } from 'node:fs/promises';
import { patientProfile } from '../server/domain/patient.js';
import { routeComplaint } from '../server/domain/specialty-routing.js';

type Case = {
  message: string;
  type: 'deterministic' | 'candidate' | 'clarification' | 'semantic-fallback';
  expected?: string;
  expectedAny?: string[];
  expectedTopics?: string[];
  expectedFallback?: string;
};

const cases = JSON.parse(
  await readFile('data/routing-regression-cases.json', 'utf8'),
) as Case[];

const failures: Array<{
  message: string;
  expected: unknown;
  actual: unknown;
}> = [];

for (const item of cases) {
  const result = routeComplaint(
    [item.message],
    patientProfile([item.message]),
  );

  let expected: unknown;

  const passed =
    item.type === 'deterministic'
      ? ((expected = item.expected),
        result.deterministicId === item.expected)
      : item.type === 'candidate'
        ? ((expected = item.expectedAny),
          result.deterministicId === null &&
            (item.expectedAny ?? []).every((id) =>
              result.candidates.some(
                (candidate) => candidate.id === id,
              ),
            ))
        : item.type === 'clarification'
          ? ((expected = item.expectedTopics),
            result.deterministicId === null &&
              (item.expectedTopics ?? []).every((topic) =>
                result.clarificationTopics.includes(
                  topic as never,
                ),
              ))
          : ((expected = item.expectedFallback),
            result.deterministicId === null &&
              result.fallbackId === item.expectedFallback);

  if (!passed) {
    failures.push({
      message: item.message,
      expected,
      actual: {
        deterministicId: result.deterministicId,
        fallbackId: result.fallbackId,
        clarificationTopics:
          result.clarificationTopics,
        candidates: result.candidates.map(
          ({ id, score }) => ({
            id,
            score,
          }),
        ),
      },
    });
  }
}

console.log(
  JSON.stringify(
    {
      cases: cases.length,
      passed: cases.length - failures.length,
      failed: failures.length,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length) {
  process.exitCode = 1;
}