import { readFile } from 'node:fs/promises';
import { clinicDocumentSchema, clinicSchema } from '../shared/contracts.js';

const clinicsRaw = JSON.parse(await readFile('data/clinics.public.json', 'utf8')) as unknown[];
const docsRaw = JSON.parse(await readFile('data/clinic-documents.public.json', 'utf8')) as unknown[];
const clinics = clinicsRaw.map((item) => clinicSchema.parse(item));
const docs = docsRaw.map((item) => clinicDocumentSchema.parse(item));

const unique = <T>(values: T[]) => new Set(values).size;
const clinicIds = clinics.map((clinic) => clinic.id);
const docClinicIds = docs.map((doc) => doc.clinicId);
if (unique(clinicIds) !== clinics.length) throw new Error('IDs de clínica duplicados.');
if (unique(docs.map((doc) => doc.id)) !== docs.length) throw new Error('IDs de documento RAG duplicados.');
if (docs.some((doc) => !clinicIds.includes(doc.clinicId)))
  throw new Error('Há documento RAG associado a clínica inexistente.');
if (new Set(docClinicIds).size !== clinics.length)
  throw new Error('Cada clínica pública deve possuir pelo menos um documento RAG próprio.');

const professionals = clinics.flatMap((clinic) => clinic.professionals);
const report = {
  clinics: clinics.length,
  cities: unique(clinics.map((clinic) => clinic.city)),
  clinicSpecialties: unique(clinics.flatMap((clinic) => clinic.specialties)),
  insuranceNames: unique(clinics.flatMap((clinic) => clinic.insurances)),
  professionalEntries: professionals.length,
  uniqueProfessionals: unique(professionals.map((professional) => professional.name)),
  verifiedCoordinates: clinics.filter(
    (clinic) => clinic.latitude !== null && clinic.longitude !== null,
  ).length,
  ragDocuments: docs.length,
  uniqueSourceUrls: unique(clinics.map((clinic) => clinic.sourceUrl).filter(Boolean)),
};

console.log(JSON.stringify(report, null, 2));
