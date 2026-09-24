import { z } from 'zod';

export const specialties = {
  'clinica-medica': 'Clínica médica',
  'medicina-de-familia': 'Medicina de família',
  ortopedia: 'Ortopedia',
  dermatologia: 'Dermatologia',
  neurologia: 'Neurologia',
  gastroenterologia: 'Gastroenterologia',
  otorrinolaringologia: 'Otorrinolaringologia',
  oftalmologia: 'Oftalmologia',
  psicologia: 'Psicologia',
} as const;

export const specialtySchema = z.enum(
  Object.keys(specialties) as [keyof typeof specialties, ...Array<keyof typeof specialties>],
);
export type Specialty = z.infer<typeof specialtySchema>;
export const httpsUrl = z
  .url()
  .refine((url) => new URL(url).protocol === 'https:', 'Use uma URL HTTPS.');
export const chatRequestSchema = z
  .object({
    message: z.string().trim().min(3).max(2000),
    history: z.array(z.string().trim().min(1).max(2000)).max(6).default([]),
    city: z.string().trim().max(80).default(''),
    insurance: z.string().trim().max(80).default(''),
    consent: z.boolean().default(false),
  })
  .strict();
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const clinicSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{3,80}$/),
    name: z.string().trim().min(3).max(120),
    city: z.string().trim().min(2).max(80),
    state: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    neighborhood: z.string().trim().min(2).max(100).nullable(),
    address: z.string().trim().min(5).max(200),
    specialties: z.array(specialtySchema).min(1).max(9),
    insurances: z.array(z.string().trim().min(2).max(80)).max(100),
    professionalName: z.string().trim().min(2).max(200).nullable().optional(),
    provenance: z.enum(['manual', 'public-directory', 'official-website']).optional(),
    phone: z
      .string()
      .regex(/^\+55\d{10,11}$/)
      .nullable(),
    website: httpsUrl.nullable(),
    sourceUrl: httpsUrl.nullable(),
    verifiedAt: z.iso.datetime().nullable(),
    isDemo: z.boolean(),
    active: z.boolean(),
  })
  .strict()
  .superRefine((clinic, ctx) => {
    if (!clinic.isDemo && (!clinic.sourceUrl || !clinic.verifiedAt)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Clínicas reais exigem fonte e data de verificação.',
      });
    }
    if (clinic.verifiedAt && Date.parse(clinic.verifiedAt) > Date.now()) {
      ctx.addIssue({ code: 'custom', message: 'A verificação não pode estar no futuro.' });
    }
  });
export type Clinic = z.infer<typeof clinicSchema>;

export const documentSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{3,80}$/),
    title: z.string().trim().min(5).max(150),
    sourceUrl: httpsUrl,
    publisher: z.string().trim().min(2).max(120),
    content: z.string().trim().min(80).max(20000),
    keywords: z.array(z.string().trim().min(2).max(60)).min(1).max(40),
    specialties: z.array(specialtySchema).min(1).max(4),
    reviewStatus: z.enum(['draft', 'approved']),
    reviewedBy: z.string().trim().min(3).max(120).nullable(),
    reviewedAt: z.iso.datetime().nullable(),
    isDemo: z.boolean(),
    active: z.boolean(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    if (doc.reviewStatus === 'approved' && (!doc.reviewedBy || !doc.reviewedAt || doc.isDemo)) {
      ctx.addIssue({ code: 'custom', message: 'Aprovação exige revisor, data e isDemo=false.' });
    }
    if (doc.reviewedAt && Date.parse(doc.reviewedAt) > Date.now()) {
      ctx.addIssue({ code: 'custom', message: 'A revisão não pode estar no futuro.' });
    }
  });
export type KnowledgeDocument = z.infer<typeof documentSchema>;

export const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: httpsUrl,
  publisher: z.string(),
  excerpt: z.string(),
  reviewStatus: z.enum(['draft', 'approved']),
});
export type Source = z.infer<typeof sourceSchema>;
export const chatResponseSchema = z.object({
  id: z.string(),
  answer: z.string(),
  urgency: z.enum(['emergency', 'prompt', 'routine', 'uncertain']),
  specialtyIds: z.array(specialtySchema),
  questions: z.array(z.string()),
  sources: z.array(sourceSchema),
  clinics: z.array(clinicSchema),
  mode: z.enum(['demo', 'openai', 'ollama', 'safety', 'fallback']),
  notice: z.string(),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

export const clinicFiltersSchema = z
  .object({
    city: z.string().trim().max(80).default(''),
    insurance: z.string().trim().max(80).default(''),
    specialty: z.union([specialtySchema, z.literal('')]).default(''),
    q: z.string().trim().max(100).default(''),
    page: z.coerce.number().int().min(1).max(1000).default(1),
  })
  .strict();
export type ClinicFilters = Omit<z.infer<typeof clinicFiltersSchema>, 'q'> & { q?: string };
export interface CatalogMeta {
  cities: string[];
  insurances: string[];
  specialties: typeof specialties;
  mode: 'demo' | 'openai' | 'ollama';
  chatTimeoutMs?: number;
  demoData: boolean;
  requiresConsent: boolean;
  knowledge: {
    indexedDocuments: number;
    demoDocuments: number;
    needsReindex: boolean;
  };
  directory: {
    total: number;
    realRecords: number;
    sourceCount: number;
    lastVerifiedAt: string | null;
  };
}
export interface ClinicResults {
  items: Clinic[];
  total: number;
  page: number;
  pageSize: number;
}

export const modelAnswerSchema = z.object({
  answer: z.string(),
  urgency: z
    .enum(['emergency', 'prompt', 'routine', 'uncertain'])
    .describe(
      'emergency: relato sugere emergência; prompt: avaliação no mesmo dia; routine: fontes sustentam uma porta de entrada para avaliação, sem excluir urgência; uncertain: faltam evidências para indicar especialidade. Não é diagnóstico nem triagem certificada.',
    ),
  specialtyIds: z.array(specialtySchema),
  questions: z.array(z.string()),
  sourceIds: z.array(z.string()),
});
export type ModelAnswer = z.infer<typeof modelAnswerSchema>;
