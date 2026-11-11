import { describe, expect, it } from 'vitest';
import { assessAnatomicalDifferential } from '../server/domain/anatomical-differential.js';
import { routeComplaint } from '../server/domain/specialty-routing.js';
import { patientProfile } from '../server/domain/patient.js';
import { detectUrgency } from '../server/domain/safety.js';
import { matchClinicalCases, CASEBOOK_COUNT } from '../server/domain/clinical-casebook.js';
import { isSupportedReferral } from '../server/domain/referral-validation.js';
import { careInput } from '../server/ai/prompt.js';

function route(message: string) {
  const patient = patientProfile([message]);
  return { patient, routing: routeComplaint([message], patient) };
}

describe('Auditoria de localização anatômica sem presunção de órgão', () => {
  it.each([
    'Tenho dor no púbis.',
    'Dor na região pubiana desde ontem.',
    'Sinto dor suprapúbica.',
    'Dor no pé da barriga.',
    'Tenho dor na virilha.',
    'Minha mãe tem desconforto na pelve.',
    'Dor na região inguinal.',
    'A axila está dolorida.',
    'Tenho dor no flanco.',
    'Dor no maxilar.',
    'Dor na mandíbula.',
  ])('%s: localização sozinha não determina uma especialidade específica', (message) => {
    const { patient, routing } = route(message);
    expect(assessAnatomicalDifferential(message).unresolved).toBe(true);
    expect(routing.needsClarification).toBe(true);
    expect(routing.deterministicId).toBeNull();
    expect(routing.candidates[0]?.id).toBe(routing.fallbackId);
    for (const unjustified of ['urologia', 'ortopedia', 'dermatologia', 'ginecologia']) {
      expect(isSupportedReferral(unjustified, routing, patient)).toBe(false);
    }
  });

  it.each([
    ['Tenho dor no púbis e ardência ao urinar desde ontem.', 'urologia'],
    ['Dor na região púbica depois de corrida.', 'ortopedia'],
    ['Dor na virilha com abaulamento.', 'cirurgia-geral'],
    ['Dor no baixo ventre com sangramento vaginal.', 'ginecologia'],
    ['Dor na pelve e diarreia desde ontem.', 'clinica-medica'],
    ['Bolinhas avermelhadas e coceira na axila.', 'dermatologia'],
    ['Dor na axila depois de esforço na academia.', 'ortopedia'],
    ['Um caroço na axila que incomoda.', 'clinica-medica'],
    ['Dor no flanco com sangue na urina.', 'clinica-medica'],
    ['Dor no flanco após exercício na academia.', 'ortopedia'],
    ['Bolinhas avermelhadas na glande.', 'dermatologia'],
    ['Meu pai tem dor na clavícula depois de levantar peso.', 'ortopedia'],
    ['Estou com coriza e febre leve e ardência ocular.', 'clinica-medica'],
    ['Meu filho de 8 anos tem dor nas amígdalas.', 'pediatria'],
  ])('%s: usa mecanismo e sintomas associados (%s)', (message, expected) => {
    expect(route(message).routing.candidates[0]?.id).toBe(expected);
  });

  it.each([
    ['Meu pai está com dor forte no púbis desde ontem.', 'emergency'],
    ['É uma dor muito forte no púbis, começou ontem.', 'emergency'],
    ['Dor na virilha, apareceu abaulamento e estou vomitando.', 'emergency'],
    ['Dor na pelve com febre alta.', 'prompt'],
    ['Estou grávida e com dor na pelve.', 'prompt'],
    ['Pálpebras vermelhas, inchadas e doloridas.', 'prompt'],
    ['Dor forte no olho com visão embaçada.', 'prompt'],
    ['Dor na panturrilha e uma perna inchada de um lado.', 'prompt'],
    ['Dor forte no peito.', 'emergency'],
  ] as const)('%s: o alerta prevalece sobre encaminhamento eletivo', (message, expected) => {
    expect(detectUrgency([message])).toBe(expected);
  });

  it.each([
    'Tenho dor leve no púbis, sem outros sintomas.',
    'Não tenho dor forte no púbis, apenas desconforto.',
    'Estou com dor na virilha, mas sem inchaço nem febre.',
    'Dor no flanco sem febre.',
  ])('%s: não transforma negação em alerta', (message) => {
    expect(detectUrgency([message])).toBeNull();
  });

  it('combina informações de um único episódio em mensagens diferentes', () => {
    expect(detectUrgency([
      'Meu pai está com dor no púbis.',
      'É uma dor forte, constante desde ontem.',
    ])).toBe('emergency');
  });

  it('o Qwen recebe o diferencial anatômico em vez de presumir Urologia', () => {
    const input = JSON.parse(careInput({
      message: 'Meu pai sente dor no púbis.', history: [], specialties: [],
    })) as {
      anatomicalDifferentialHint: Array<{
        region: string; possibleSpecialties: string[]; distinguishBy: string;
      }>;
    };
    expect(input.anatomicalDifferentialHint[0]?.region).toContain('púbis');
    expect(input.anatomicalDifferentialHint[0]?.possibleSpecialties).toContain('ortopedia');
    expect(input.anatomicalDifferentialHint[0]?.possibleSpecialties).toContain('urologia');
    expect(input.anatomicalDifferentialHint[0]?.distinguishBy).toMatch(/urin/);
  });

  it('mantém os cenários referenciados e exige evidência de vias urinárias', () => {
    const message = 'Dor no púbis com ardência para urinar.';
    expect(CASEBOOK_COUNT).toBeGreaterThanOrEqual(85);
    expect(matchClinicalCases(message, patientProfile([message]))
      .some((item) => item.id === 'pubic-urinary-symptoms')).toBe(true);
    expect(matchClinicalCases('Dor no púbis.', patientProfile(['Dor no púbis.']))
      .some((item) => item.id === 'pubic-urinary-symptoms')).toBe(false);
  });
});
