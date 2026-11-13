import type { PatientProfile } from './patient.js';

const pediatricAreas = new Set(['pediatria', 'cirurgia-pediatrica']);

/** Clinical suggestions require patient evidence; catalog queries are handled separately. */
export function eligibleSpecialty(id: string, patient: PatientProfile) {
  return (
    !pediatricAreas.has(id) ||
    (patient.ageYears !== null && patient.ageYears < 18 && !patient.adultReported)
  );
}
