import { clinicSchema, type Clinic, type ModelAnswer } from '../shared/contracts.js';
export const suggestion = (name = 'Urologia'): ModelAnswer => ({
  answer: `Uma avaliação em ${name} pode ajudar a orientar o próximo passo.`,
  urgency: 'routine',
  specialty: { name, reason: 'Uma área possível para avaliação profissional.' },
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
