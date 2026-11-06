import { clinicSchema, type Clinic, type ModelAnswer } from '../shared/contracts.js';

export const suggestion = (name = 'Urologia'): ModelAnswer => ({
  urgency: 'routine',
  specialty: { name },
  questions: [],
});

export const clinic = (fields: Partial<Clinic> = {}): Clinic =>
  clinicSchema.parse({
    id: 'demo-fixture',
    name: 'Clínica fictícia de teste',
    city: 'Fortaleza',
    state: 'CE',
    neighborhood: null,
    address: 'Endereço fictício para teste',
    specialties: ['urologia'],
    insurances: ['Plano Exemplo A'],
    phone: null,
    website: null,
    sourceUrl: null,
    verifiedAt: null,
    isDemo: true,
    active: true,
    ...fields,
  });
