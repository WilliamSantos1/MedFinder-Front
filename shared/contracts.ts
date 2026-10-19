import { z } from 'zod';

export const idSchema = z.string().regex(/^[a-z0-9-]{3,80}$/);
export const httpsUrl = z
  .url()
  .refine((url) => new URL(url).protocol === 'https:', 'Use uma URL HTTPS.');
export const specialtySchema = z
  .object({ id: idSchema, name: z.string().trim().min(2).max(120) })
  .strict();
export type Specialty = z.infer<typeof specialtySchema>;
export const specialtyImportSchema = specialtySchema.extend({
  aliases: z.array(z.string().trim().min(2).max(120)).max(30).default([]),
  active: z.boolean().default(true),
});
export const locationSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();
export type Location = z.infer<typeof locationSchema>;
export const clarificationTopicSchema = z.enum([
  'location',
  'onset_duration',
  'pattern',
  'associated_symptoms',
  'trigger',
  'impact',
  'age_group',
]);
export type ClarificationTopic = z.infer<typeof clarificationTopicSchema>;
export const careContextSchema = z
  .object({
    questions: z.array(clarificationTopicSchema).max(2),
    askedTopics: z.array(clarificationTopicSchema).max(7),
    round: z.number().int().min(1).max(3),
  })
  .strict();
export const chatContextSchema = z
  .object({
    specialtyId: idSchema.nullable(),
    clinicIds: z.array(idSchema).max(6),
    city: z.string().trim().max(80),
    insurance: z.string().trim().max(80),
    care: careContextSchema.optional(),
  })
  .strict();
export type ChatContext = z.infer<typeof chatContextSchema>;
export const intentSchema = z.enum(['care_navigation', 'clinic_search', 'clinic_information']);
export const chatRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    history: z.array(z.string().trim().min(1).max(2000)).max(6).default([]),
    city: z.string().trim().max(80).default(''),
    insurance: z.string().trim().max(80).default(''),
    consent: z.boolean().default(false),
    location: locationSchema.optional(),
    context: chatContextSchema.optional(),
  })
  .strict();
export type ChatRequest = z.infer<typeof chatRequestSchema>;

const clinicFields = z
  .object({
    id: idSchema,
    name: z.string().trim().min(3).max(120),
    city: z.string().trim().min(2).max(80),
    state: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    neighborhood: z.string().trim().min(2).max(100).nullable(),
    address: z.string().trim().min(5).max(200),
    specialties: z.array(idSchema).min(1).max(100),
    insurances: z.array(z.string().trim().min(2).max(80)).max(100),
    accessNote: z.string().trim().min(10).max(300).nullable().default(null),
    professionalName: z.string().trim().min(2).max(200).nullable().optional(),
    provenance: z.enum(['manual', 'public-directory', 'official-website']).optional(),
    phone: z
      .string()
      .regex(/^\+55\d{10,11}$/)
      .nullable(),
    website: httpsUrl.nullable(),
    sourceUrl: httpsUrl.nullable(),
    verifiedAt: z.iso.datetime().nullable(),
    latitude: locationSchema.shape.latitude.nullable().default(null),
    longitude: locationSchema.shape.longitude.nullable().default(null),
    coordinatesVerifiedAt: z.iso.datetime().nullable().default(null),
    coordinatesSourceUrl: httpsUrl.nullable().default(null),
    isDemo: z.boolean(),
    active: z.boolean(),
  })
  .strict();
export const clinicSchema = clinicFields.superRefine((clinic, ctx) => {
  if (!clinic.isDemo && (!clinic.sourceUrl || !clinic.verifiedAt))
    ctx.addIssue({ code: 'custom', message: 'Clínicas reais exigem fonte e data de verificação.' });
  if ((clinic.latitude === null) !== (clinic.longitude === null))
    ctx.addIssue({ code: 'custom', message: 'Informe ambas as coordenadas ou nenhuma.' });
  if (
    !clinic.isDemo &&
    clinic.latitude !== null &&
    (!clinic.coordinatesVerifiedAt || !clinic.coordinatesSourceUrl)
  )
    ctx.addIssue({
      code: 'custom',
      message: 'Coordenadas reais exigem fonte e verificação próprias.',
    });
  if (
    [clinic.verifiedAt, clinic.coordinatesVerifiedAt].some(
      (date) => date && Date.parse(date) > Date.now(),
    )
  )
    ctx.addIssue({ code: 'custom', message: 'A verificação não pode estar no futuro.' });
});
export type Clinic = z.infer<typeof clinicSchema>;
// Read DTO: distances belong to the request and are never written to clinics.
export const clinicResultSchema = clinicFields.extend({
  specialtyDetails: z.array(specialtySchema),
  distanceKm: z.number().finite().nonnegative().nullable(),
});
export type ClinicResult = z.infer<typeof clinicResultSchema>;
export const clinicDocumentSchema = z
  .object({
    id: idSchema,
    clinicId: idSchema,
    title: z.string().trim().min(5).max(150),
    content: z.string().trim().min(40).max(20000),
    sourceUrl: httpsUrl.nullable(),
    verifiedAt: z.iso.datetime().nullable(),
    isDemo: z.boolean(),
    active: z.boolean(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    if (!doc.isDemo && (!doc.sourceUrl || !doc.verifiedAt))
      ctx.addIssue({
        code: 'custom',
        message: 'Texto real exige fonte oficial e data de verificação.',
      });
    if (doc.verifiedAt && Date.parse(doc.verifiedAt) > Date.now())
      ctx.addIssue({ code: 'custom', message: 'A verificação não pode estar no futuro.' });
  });
export type ClinicDocument = z.infer<typeof clinicDocumentSchema>;
export const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: httpsUrl.nullable(),
  publisher: z.string(),
  excerpt: z.string(),
  clinicId: idSchema.optional(),
  isDemo: z.boolean().default(false),
});
export type Source = z.infer<typeof sourceSchema>;
const urgencySchema = z.enum(['emergency', 'prompt', 'routine', 'uncertain']);
// Providers get one candidate only; the backend resolves it against the active database taxonomy.
export const modelAnswerFormat = z
  .object({
    answer: z.string().min(1).max(1800),
    urgency: urgencySchema,
    specialty: z
      .object({
        name: z.string().min(2).max(120),
        reason: z.string().min(1).max(240),
      })
      .strict()
      .nullable(),
    // The model selects topics; only backend-owned questions reach the interface.
    questions: z.array(clarificationTopicSchema).max(2),
  })
  .strict();
export const modelAnswerSchema = modelAnswerFormat.superRefine((value, ctx) => {
  if (
    !value.answer.trim() ||
    (value.specialty && (!value.specialty.name.trim() || !value.specialty.reason.trim()))
  )
    ctx.addIssue({ code: 'custom', message: 'Campos de texto não podem ser vazios.' });
});
export type ModelAnswer = z.infer<typeof modelAnswerSchema>;

export const feedbackReasonSchema = z.enum([
  'incorrect_specialty',
  'unclear_answer',
  'not_helpful',
  'clinic_problem',
  'location_problem',
  'insurance_problem',
  'too_slow',
  'other',
]);
export type FeedbackReason = z.infer<typeof feedbackReasonSchema>;
export const feedbackRequestSchema = z
  .object({
    responseId: z.uuid(),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    rating: z.enum(['positive', 'negative']),
    reason: feedbackReasonSchema.optional(),
    comment: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.rating === 'negative' && !value.reason)
      ctx.addIssue({ code: 'custom', message: 'Escolha o motivo do feedback negativo.' });
    if (value.rating === 'positive' && (value.reason || value.comment))
      ctx.addIssue({
        code: 'custom',
        message: 'Feedback positivo não inclui motivo ou comentário.',
      });
  });
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;
export const responseModeSchema = z.enum([
  'demo',
  'openai',
  'ollama',
  'safety',
  'fallback',
  'catalog',
]);
export const chatResponseSchema = z
  .object({
    id: z.uuid(),
    answer: z.string(),
    urgency: urgencySchema,
    specialty: specialtySchema.extend({ reason: z.string().optional() }).nullable(),
    intent: intentSchema,
    context: chatContextSchema.nullable(),
    status: z.enum([
      'ok',
      'llm_unavailable',
      'invalid_output',
      'needs_information',
      'specialty_unrecognized',
      'specialty_not_registered',
      'no_matching_clinics',
    ]),
    questions: z.array(z.string()),
    sources: z.array(sourceSchema),
    clinics: z.array(clinicResultSchema),
    ragStatus: z.enum(['skipped', 'not_indexed', 'available', 'no_matches', 'unavailable']),
    locationUsed: z.boolean(),
    mode: responseModeSchema,
    notice: z.string(),
    feedback: z.object({ token: z.string(), reasons: z.array(feedbackReasonSchema) }).nullable(),
  })
  .strict();
export type ChatResponse = z.infer<typeof chatResponseSchema>;
export const clinicFiltersSchema = z
  .object({
    city: z.string().trim().max(80).default(''),
    insurance: z.string().trim().max(80).default(''),
    specialty: z.union([idSchema, z.literal('')]).default(''),
    q: z.string().trim().max(100).default(''),
    page: z.coerce.number().int().min(1).max(1000).default(1),
  })
  .strict();
export const clinicSearchSchema = clinicFiltersSchema.extend({
  location: locationSchema.optional(),
});
export type ClinicFilters = Omit<z.infer<typeof clinicSearchSchema>, 'q'> & { q?: string };
export interface CatalogMeta {
  cities: string[];
  insurances: string[];
  specialties: Specialty[];
  mode: 'demo' | 'openai' | 'ollama';
  chatTimeoutMs?: number;
  demoData: boolean;
  requiresConsent: boolean;
  knowledge: { indexedDocuments: number; demoDocuments: number; needsReindex: boolean };
  directory: {
    total: number;
    realRecords: number;
    sourceCount: number;
    lastVerifiedAt: string | null;
  };
}
export const clinicResultsSchema = z.object({
  items: z.array(clinicResultSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  order: z.enum(['name', 'proximity']),
});
export type ClinicResults = z.infer<typeof clinicResultsSchema>;

export const visitFeedbackRequestSchema = z
  .object({
    responseId: z.uuid(),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    clinicId: idSchema,
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(500).optional(),
  })
  .strict();
export type VisitFeedbackRequest = z.infer<typeof visitFeedbackRequestSchema>;
