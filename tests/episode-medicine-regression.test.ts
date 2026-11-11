import { describe, expect, it } from 'vitest';
import { medicationAdviceRequest } from '../server/domain/guardrails.js';
import { careConversation, assessDetail } from '../server/domain/clarification.js';
import { explicitPatientSubject } from '../server/domain/patient.js';
import { clearlyChangedPatient } from '../src/features/chat/patient-transition.js';
import { chatRequestSchema } from '../shared/contracts.js';
import { positiveEvidenceText } from '../server/domain/negated-evidence.js';
import { routeComplaint } from '../server/domain/specialty-routing.js';
import { patientProfile } from '../server/domain/patient.js';

describe('Não confundir especialidade com medicamento', () => {
  it.each([
    'não seria mais indicado ortopedia?',
    'não seria mais indicado dermatologia?',
    'seria melhor ortopedia?',
    'qual especialidade você recomenda?',
    'poderia indicar um ortopedista?',
  ])('não dá alerta de remédio para %s', (message) => {
    expect(medicationAdviceRequest(message)).toBe(false);
  });

  it.each([
    'posso tomar dipirona para a dor?',
    'qual dose de ibuprofeno devo usar?',
    'pode administrar paracetamol para ela?',
    'Rivotril ajudaria?',
  ])('preserva proteção de medicamentos: %s', (message) => {
    expect(medicationAdviceRequest(message)).toBe(true);
  });

  it('não bloqueia perguntas sobre especialidades após um histórico sem remédios', () => {
    expect(medicationAdviceRequest('não seria mais indicado ortopedia?', [
      'Meu professor sente dor no ombro direito.',
    ])).toBe(false);
  });
});

describe('Mudança de pessoa e aproveitamento de respostas', () => {
  it('reconhece professor como outro paciente mesmo quando a queixa anterior também era osteomuscular', () => {
    expect(explicitPatientSubject('meu professor está com dor no ombro direito')).toBe('teacher');
    const request = chatRequestSchema.parse({
      message: 'meu professor está sentindo dor no ombro direito.',
      history: [
        'Meu avô está com dor na perna.',
        'Começou ontem à noite e não há inchaço.',
        'Ele está dormindo bem.',
      ],
      context: {
        specialtyId: 'clinica-medica',
        clinicIds: [],
        city: '',
        insurance: '',
        care: {
          round: 3,
          questions: [],
          askedTopics: ['onset_duration', 'associated_symptoms', 'impact'],
        },
      },
    });
    const result = careConversation(request);
    expect(result.newPerson).toBe(true);
    expect(result.newEpisode).toBe(true);
    expect(result.history).toEqual([]);
    expect(result.care).toBeUndefined();
  });

  it('também reconhece troca de pessoa no frontend', () => {
    expect(clearlyChangedPatient('Meu professor está com dor no ombro.', [
      'Meu avô está com dor na perna.',
    ])).toBe(true);
  });

  it('reconhece a negativa associada à informação de início em mensagens separadas', () => {
    const known = assessDetail([
      'Meu pai está com dor na clavícula.',
      'Começou hoje. Não.',
      'Ele foi levantar uma televisão e sentiu a dor.',
    ]).known;
    expect(known.has('onset_duration')).toBe(true);
    expect(known.has('trigger')).toBe(true);
  });

  it('reconhece ausência de dificuldade e constância de dor no membro', () => {
    const known = assessDetail([
      'Meu avô está com dor na perna.',
      'Não piora, fica da mesma forma. Sem dificuldade maior aparente, apenas a dor.',
    ]).known;
    expect(known.has('pattern')).toBe(true);
    expect(known.has('associated_symptoms')).toBe(true);
  });
});


describe('Mecanismo de lesão e negativas', () => {
  it('não transforma sintomas negados em sinais positivos', () => {
    expect(positiveEvidenceText('Dor no ombro, não há inchaço ou dormência.')).not.toContain('dormencia');
  });

  it('reconhece dor de clavícula após levantar televisão como queixa osteomuscular', () => {
    const msg = 'Meu pai está com dor na clavícula. Começou hoje. Não há inchaço. Ele foi levantar uma televisão e sentiu a dor.';
    const route = routeComplaint([msg], patientProfile([msg]));
    expect(route.candidates[0]?.id).toBe('ortopedia');
  });
});
