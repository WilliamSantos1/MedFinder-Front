import { describe, expect, it } from 'vitest';
import { patientProfile } from '../server/domain/patient.js';
import { routeComplaint } from '../server/domain/specialty-routing.js';
import { detectUrgency } from '../server/domain/safety.js';
import { positiveEvidenceText } from '../server/domain/negated-evidence.js';
import { assessDetail } from '../server/domain/clarification.js';
import { selectEvidenceBackedReferral } from '../server/domain/referral-decision.js';
import { careInput } from '../server/ai/prompt.js';

const samples = [
  ['Pálpebras inchadas e vermelhas desde ontem.', 'oftalmologia'],
  ['Nariz entupido, febre leve e indisposição desde ontem.', 'clinica-medica'],
  ['Coriza, febre e ardência nos olhos.', 'clinica-medica'],
  ['Dor forte no olho e visão embaçada, coriza e febre.', 'oftalmologia'],
  ['Meu pai machucou a unha do indicador numa pancada.', 'ortopedia'],
  ['Unhas engrossadas e amareladas há meses.', 'dermatologia'],
  ['Meu professor sentiu dor no ombro após carregar peso.', 'ortopedia'],
  ['Minha filha de 8 anos tem dor nas amígdalas.', 'pediatria'],
  ['Tenho manchas na pele e coceira.', 'dermatologia'],
  ['Tenho diarreia persistente há semanas.', 'gastroenterologia'],
  ['Minha mãe de 78 anos tem fragilidade e quedas recorrentes.', 'geriatria'],
  ['Tenho ardência ao urinar.', 'urologia'],
  ['Tenho palpitações e coração acelerado.', 'cardiologia'],
  ['Tenho chiado recorrente no peito há meses.', 'pneumologia'],
  ['Tenho caroço na mama.', 'mastologia'],
] as const;

describe('Revisão de encaminhamentos por quadro completo', () => {
  it.each(samples)('%s prioriza %s', (message, specialtyId) => {
    const patient = patientProfile([message]);
    const routing = routeComplaint([message], patient);
    expect(routing.candidates[0]?.id).toBe(specialtyId);
  });

  it('não perde o esforço que foi informado depois de uma resposta negativa', () => {
    const history = [
      'Meu pai sentiu dor na clavícula.',
      'Começou hoje. Não tem outros sintomas.',
      'Ele sentiu essa dor após erguer uma televisão.',
    ];
    expect(routeComplaint(history, patientProfile(history)).candidates[0]?.id)
      .toBe('ortopedia');
    expect(positiveEvidenceText(history.join('\n'))).toContain('erguer uma televisao');
  });

  it('recupera indicação específica bem justificada mesmo se o modelo escolhe a porta de entrada geral', () => {
    const history = [
      'Meu pai está com dor na clavícula.',
      'Começou ontem. Não tem outros sintomas.',
      'Sentiu após levantar uma televisão.',
    ];
    const patient = patientProfile(history);
    expect(selectEvidenceBackedReferral(
      routeComplaint(history, patient), patient, 'clinica-medica', assessDetail(history).known,
    ).specialtyId).toBe('ortopedia');
  });

  it('não inventa especialidade quando os sinais não são discriminatórios', () => {
    const history = ['Dor pélvica desde ontem, sem outros detalhes.'];
    const patient = patientProfile(history);
    const result = selectEvidenceBackedReferral(
      routeComplaint(history, patient), patient, 'neurocirurgia', assessDetail(history).known,
    );
    expect(result.specialtyId).toBe('clinica-medica');
  });

  it('envia evidência resumida ao modelo sem apresentar pontuação como probabilidade', () => {
    const value = JSON.parse(careInput({
      message: 'Dor na clavícula após levantar uma televisão.',
      history: [],
      navigationHints: [{
        specialtyId: 'ortopedia',
        reason: 'dor após esforço',
        relativePriority: 'primary',
      }],
    })) as { navigationHints: Array<{ specialtyId: string; reason: string }> };
    expect(value.navigationHints).toEqual([{
      specialtyId: 'ortopedia', reason: 'dor após esforço', relativePriority: 'primary',
    }]);
  });
});

describe('Sinais prioritários não entram no catálogo eletivo', () => {
  it.each([
    ['Pálpebras inchadas e vermelhas, às vezes dói.', 'prompt'],
    ['Dor forte no olho com visão embaçada e coriza.', 'prompt'],
    ['Sinto dor na perna e ela está inchada só de um lado.', 'prompt'],
    ['Prendi o dedo na cama e não consigo movimentar, está inchado.', 'prompt'],
  ] as const)('%s → %s', (message, urgency) => {
    expect(detectUrgency([message])).toBe(urgency);
  });

  it.each([
    'Pálpebras inchadas e avermelhadas, mas não dói.',
    'Dor na perna, mas sem inchaço.',
    'Tenho nariz entupido e febre leve.',
  ])('não cria sinal urgente por negativa ou sintoma leve: %s', (message) => {
    expect(detectUrgency([message])).toBeNull();
  });
});
