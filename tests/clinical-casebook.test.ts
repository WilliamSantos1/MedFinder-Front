import { describe, expect, it } from 'vitest';
import { patientProfile } from '../server/domain/patient.js';
import { routeComplaint } from '../server/domain/specialty-routing.js';
import { detectUrgency } from '../server/domain/safety.js';
import { isSupportedReferral, supportedReferralIds } from '../server/domain/referral-validation.js';
import { CASEBOOK_COUNT, CASEBOOK_REFERENCES, matchClinicalCases } from '../server/domain/clinical-casebook.js';
import { careInput } from '../server/ai/prompt.js';

describe('Base de cenários clínicos de navegação, com fontes e sem diagnóstico', () => {
  it('mantém conjunto versionado e fontes para auditoria', () => {
    expect(CASEBOOK_COUNT).toBeGreaterThanOrEqual(70);
    expect(Object.values(CASEBOOK_REFERENCES).every((url) => url.startsWith('https://'))).toBe(true);
  });

  it.each([
    ['Unha do indicador imprensada na cama com dor e inchaço.', 'ortopedia', 'dermatologia'],
    ['Bati a unha do polegar no móvel e agora dói.', 'cirurgia-mao', 'dermatologia'],
    ['Unha amarelada e grossa há meses, sem batida.', 'dermatologia', 'cardiologia'],
    ['Dor no tríceps depois da academia.', 'ortopedia', 'pneumologia'],
    ['Coriza, febre leve e ardência nos olhos.', 'clinica-medica', 'oftalmologia'],
    ['Nariz entupido, febre leve e indisposição.', 'otorrinolaringologia', 'ortopedia'],
    ['Disenteria persistente há semanas.', 'gastroenterologia', 'dermatologia'],
    ['Meu pai de 75 anos com diarreia iniciada hoje e febre.', 'clinica-medica', 'ortopedia'],
    ['Dores nas articulações, rigidez matinal recorrente.', 'reumatologia', 'otorrinolaringologia'],
    ['Meu filho de 8 anos está com dor nas amígdalas.', 'pediatria', 'ortopedia'],
    ['Minha avó de 78 anos com quedas e esquecimento frequente.', 'geriatria', 'pneumologia'],
    ['Dor na pelve depois de uma corrida.', 'ortopedia', 'dermatologia'],
    ['Urina com sangue.', 'urologia', 'oftalmologia'],
    ['Dor no testículo e inchaço.', 'urologia', 'gastroenterologia'],
    ['Minha esposa tem sangramento vaginal e dor na pelve.', 'ginecologia', 'ortopedia'],
    ['Sinto palpitações e coração acelerado.', 'cardiologia', 'dermatologia'],
    ['Meu olho está vermelho e coçando.', 'oftalmologia', 'ortopedia'],
  ] as const)('analisa %s: aceita %s, rejeita %s', (message, valid, invalid) => {
    const patient = patientProfile([message]);
    const routing = routeComplaint([message], patient);
    expect(isSupportedReferral(valid, routing, patient)).toBe(true);
    expect(isSupportedReferral(invalid, routing, patient)).toBe(false);
  });

  it('relato com trauma não pode ser reduzido a Dermatologia pela palavra unha', () => {
    const transcript = [
      'Meu pai sentiu dor na unha do dedo indicador.',
      'Foi depois de um imprensamento na cama, está inchado e vermelho.',
    ];
    const patient = patientProfile(transcript);
    const routing = routeComplaint(transcript, patient);
    expect(routing.candidates[0]?.id).toBe('ortopedia');
    expect(supportedReferralIds(routing, patient)).toContain('cirurgia-mao');
    expect(supportedReferralIds(routing, patient)).not.toContain('dermatologia');
  });

  it.each([
    [['Meu pai esmagou a unha do indicador.', 'Tem dor, inchaço e dificuldade de movimentar.'], 'prompt'],
    [['Joelho inchado, quente, vermelho e com febre.'], 'prompt'],
    [['Perdi a audição de repente ontem.'], 'prompt'],
    [['Dor súbita e intensa no testículo.'], 'emergency'],
    [['Diarreia importante e não consigo beber água.'], 'prompt'],
    [['Tenho febre, dor lombar e ardência ao urinar.'], 'prompt'],
    [['Não tenho dificuldade de mexer o dedo, apenas dor leve após a batida.'], null],
  ] as const)('analisa urgência com contexto: %j', (messages, expected) => {
    expect(detectUrgency([...messages])).toBe(expected);
  });

  it('Qwen recebe pistas resumidas de cenário com fonte, sem diagnosticar', () => {
    const message = 'Unha do dedo indicador imprensada na cama e dolorida.';
    const input = JSON.parse(careInput({
      message,
      history: [],
      specialties: [{ id: 'ortopedia', name: 'Ortopedia e Traumatologia' }],
    }));
    expect(input.clinicalCasebookHints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        possibleSpecialties: expect.arrayContaining(['ortopedia']),
        reference: expect.stringContaining('https://'),
      }),
    ]));
    expect(JSON.stringify(input)).not.toContain('diagnóstico confirmado');
  });

  it('registro de cenário não é usado para inferir diagnóstico, medicação ou doença', () => {
    const cases = matchClinicalCases('Dor na pelve após corrida.', patientProfile(['Dor na pelve após corrida.']));
    expect(cases.some((item) => item.referrals.some((ref) => ref.id === 'ortopedia'))).toBe(true);
    expect(cases.every((item) => !/prescrev|dose|diagnosticou/i.test(item.reason))).toBe(true);
  });
});
