import { describe, expect, it } from 'vitest';
import { patientProfile } from '../server/domain/patient.js';
import { routeComplaint } from '../server/domain/specialty-routing.js';

function route(message: string) {
  return routeComplaint([message], patientProfile([message]));
}

const directCases: Array<[string, string]> = [
  ['meu olho está avermelhado e coçando', 'oftalmologia'],
  ['estou com zumbido no ouvido', 'otorrinolaringologia'],
  ['tenho alergia alimentar', 'alergologia-imunologia'],
  ['tenho acne no rosto', 'dermatologia'],
  ['estou com dor no joelho depois de correr', 'ortopedia'],
  ['tenho enxaqueca', 'neurologia'],
  ['estou com palpitações', 'cardiologia'],
  ['tenho asma', 'pneumologia'],
  ['tenho refluxo e azia', 'gastroenterologia'],
  ['tenho hemorroida', 'coloproctologia'],
  ['tenho problema de próstata', 'urologia'],
  ['tenho doença renal', 'nefrologia'],
  ['meu exame de tireoide veio alterado', 'endocrinologia'],
  ['preciso de nutrólogo', 'nutrologia'],
  ['tenho endometriose', 'ginecologia'],
  ['tenho um nódulo na mama', 'mastologia'],
  ['tenho anemia', 'hematologia'],
  ['tenho lúpus', 'reumatologia'],
  ['preciso de infectologista por HIV', 'infectologia'],
  ['tenho câncer e preciso de oncologista', 'oncologia-clinica'],
  ['tenho transtorno bipolar', 'psiquiatria'],
  ['preciso de geriatra', 'geriatria'],
  ['tenho varizes', 'cirurgia-vascular'],
  ['tenho uma hérnia', 'cirurgia-geral'],
  ['preciso de aconselhamento genético', 'genetica-medica'],
  ['preciso de fisiatra para reabilitação', 'medicina-fisica-reabilitacao'],
  ['preciso de avaliação esportiva', 'medicina-esportiva'],
  ['tenho um caroço no pescoço', 'cirurgia-cabeca-pescoco'],
  ['tenho síndrome do túnel do carpo', 'cirurgia-mao'],
  ['preciso de cirurgia cardiovascular', 'cirurgia-cardiovascular'],
  ['preciso de cirurgia bariátrica', 'cirurgia-aparelho-digestivo'],
  ['preciso de cirurgia oncológica', 'cirurgia-oncologica'],
  ['preciso de cirurgia pediátrica', 'cirurgia-pediatrica'],
  ['preciso de cirurgia plástica reconstrutiva', 'cirurgia-plastica'],
  ['preciso de cirurgia torácica', 'cirurgia-toracica'],
  ['preciso de angiologista', 'angiologia'],
  ['preciso fazer endoscopia', 'endoscopia'],
  ['preciso de avaliação pré-anestésica', 'anestesiologia'],
  ['preciso de exame admissional', 'medicina-trabalho'],
  ['preciso renovar CNH com médico do tráfego', 'medicina-trafego'],
  ['preciso de perícia médica', 'medicina-legal-pericia'],
  ['preciso de cintilografia', 'medicina-nuclear'],
  ['preciso de ressonância magnética', 'radiologia'],
  ['preciso de radioterapia', 'radioterapia'],
  ['preciso de patologista clínico', 'patologia-clinica'],
  ['preciso de patologista', 'patologia'],
  ['preciso de neurocirurgião', 'neurocirurgia'],
  ['quero consulta com pediatra', 'pediatria'],
  ['quero fazer psicoterapia', 'psicologia'],
  ['quero consulta com acupuntura', 'acupuntura'],
  ['quero tratamento homeopático', 'homeopatia'],
  ['procuro médico emergencista', 'medicina-emergencia'],
  ['preciso de médico intensivista', 'medicina-intensiva'],
  ['procuro medicina preventiva e social', 'medicina-preventiva-social'],
  ['quero consulta com clínico geral', 'clinica-medica'],
];

describe('Roteador híbrido de queixas → especialidade', () => {
  it.each(directCases)('%s → %s', (message, expected) => {
    const result = route(message);
    expect(result.healthComplaint).toBe(true);
    expect(result.candidates[0]?.id).toBe(expected);
    expect(result.deterministicId).toBe(expected);
  });

  it('caso real do olho é fast-path e nunca cai no antigo dead-end', () => {
    const result = route('bom dia, meu olho esta avermelhado e coçando.');
    expect(result).toMatchObject({
      deterministicId: 'oftalmologia',
      confidence: 'high',
      needsClarification: false,
      healthComplaint: true,
    });
  });

  it('criança com sintomas gerais usa Pediatria sem herdar a queixa anterior', () => {
    const message = 'meu filho de 8 anos está com coriza desde ontem à noite';
    const result = route(message);
    expect(result.deterministicId).toBe('pediatria');
  });

  it.each([
    ['estou com rinite', ['otorrinolaringologia', 'alergologia-imunologia']],
    ['estou com tontura', ['neurologia', 'otorrinolaringologia']],
    ['coceira no joelho', ['dermatologia', 'ortopedia']],
  ])('mantém ambiguidade útil para %s', (message, expected) => {
    const result = route(message);
    expect(result.deterministicId).toBeNull();
    expect(result.fallbackId).toBe('clinica-medica');
    for (const id of expected) expect(result.candidates.map((candidate) => candidate.id)).toContain(id);
  });

  it('caroço no pescoço não é confundido com dor cervical/Ortopedia', () => {
    const result = route('tenho um caroço no pescoço');
    expect(result.deterministicId).toBe('cirurgia-cabeca-pescoco');
    expect(result.candidates[0]?.id).not.toBe('ortopedia');
  });

  it('dor genérica pede somente localização antes de escolher área', () => {
    const result = route('estou com dor');
    expect(result).toMatchObject({
      deterministicId: null,
      needsClarification: true,
      clarificationTopics: ['location'],
    });
  });

  it('saudação isolada não é convertida em doença', () => {
    const result = route('bom dia');
    expect(result.socialOnly).toBe(true);
    expect(result.healthComplaint).toBe(false);
    expect(result.deterministicId).toBeNull();
  });

  it('problema de saúde reconhecível mas raro conserva fallback clínico amplo', () => {
    const result = route('tenho uma síndrome rara e preciso saber qual médico procurar');
    expect(result.healthComplaint).toBe(true);
    expect(result.deterministicId).toBeNull();
    expect(result.fallbackId).toBe('clinica-medica');
  });
});
