import { describe, expect, it } from 'vitest';
import { patientProfile } from '../server/domain/patient.js';
import { routeComplaint } from '../server/domain/specialty-routing.js';
import { assessDetail, careConversation, questionText } from '../server/domain/clarification.js';
import { adaptiveIntakeTopics } from '../server/domain/adaptive-interview.js';
import { careInput } from '../server/ai/prompt.js';
import { hasVocabularyHealthTerm, vocabularyMatches } from '../server/domain/clinical-vocabulary.js';

function route(message: string) {
  return routeComplaint([message], patientProfile([message]));
}

// These are routing associations, NOT diagnoses or unconditional referrals.
const vocabularyCases: ReadonlyArray<readonly [string, string]> = [
  ['Dor no tríceps após a academia', 'ortopedia'],
  ['Dor no bíceps após exercício', 'ortopedia'],
  ['Dor na parte posterior do braço', 'ortopedia'],
  ['Dor no deltoide', 'ortopedia'],
  ['Dor na escápula', 'ortopedia'],
  ['Dor no glúteo', 'ortopedia'],
  ['Dor na patela', 'ortopedia'],
  ['Dor na coxa', 'ortopedia'],
  ['Dor no fêmur', 'ortopedia'],
  ['Dor no tendão de Aquiles', 'ortopedia'],
  ['Dor na sola do pé', 'ortopedia'],
  ['Dor no cóccix', 'ortopedia'],
  ['Dor na costela', 'ortopedia'],
  ['Dor na clavícula', 'ortopedia'],
  ['Dor nas amígdalas', 'otorrinolaringologia'],
  ['Dor na faringe', 'otorrinolaringologia'],
  ['Dor na epiglote', 'otorrinolaringologia'],
  ['Problema na tuba auditiva', 'otorrinolaringologia'],
  ['Dor no canal auditivo', 'otorrinolaringologia'],
  ['Dor no esôfago', 'gastroenterologia'],
  ['Tenho fezes líquidas', 'gastroenterologia'],
  ['Meu avô está com disenteria', 'gastroenterologia'],
  ['Meu avô está com desinteria', 'gastroenterologia'],
  ['Meu avô está com disinteria', 'gastroenterologia'],
  ['Meu avô está com dissenteria', 'gastroenterologia'],
  ['Dor no duodeno', 'gastroenterologia'],
  ['Cólica intestinal', 'gastroenterologia'],
  ['Ferida que não cicatriza na pele', 'dermatologia'],
  ['Tenho tremedeira', 'neurologia'],
  ['Dor no nervo ciático', 'neurologia'],
  ['Dor na uretra', 'urologia'],
  ['Ardor para urinar', 'urologia'],
  ['Problema no endométrio', 'ginecologia'],
  ['Corrimento vaginal', 'ginecologia'],
  ['Dor no miocárdio', 'cardiologia'],
  ['Chiado no peito', 'pneumologia'],
  ['Minha mãe de 77 anos tem quedas recorrentes', 'geriatria'],
];

describe('Vocabulário anatômico e sintomas em português brasileiro', () => {
  it.each(vocabularyCases)('reconhece %s como candidata de %s', (message, expected) => {
    const result = route(message);
    expect(result.healthComplaint).toBe(true);
    expect(result.candidates[0]?.id).toBe(expected);
  });

  it('não reduz queixa pélvica inespecífica automaticamente a uma especialidade de órgão', () => {
    const result = route('Estou com dor na região pélvica.');
    expect(result.deterministicId).toBeNull();
    expect(result.fallbackId).toBe('clinica-medica');
  });

  it('mantém diarreia isolada como candidata gastrointestinal, sem indicação rápida irrevogável', () => {
    const result = route('Tenho diarreia.');
    expect(result.candidates[0]?.id).toBe('gastroenterologia');
    expect(result.deterministicId).toBeNull();
  });

  it('não cria concorrência com a especialidade de mão no túnel do carpo', () => {
    expect(route('Tenho síndrome do túnel do carpo').deterministicId).toBe('cirurgia-mao');
  });

  it('inclui Pediatria como porta de entrada para sintomas comuns aos 8 anos', () => {
    expect(route('Meu filho de 8 anos está com dor nas amígdalas').candidates[0]?.id).toBe('pediatria');
    expect(route('Minha filha de 7 anos está com diarreia').candidates[0]?.id).toBe('pediatria');
  });

  it('reconhece Geriatria em fragilidade e quedas, mas não por idade isolada', () => {
    expect(route('Minha mãe de 72 anos tem quedas recorrentes').candidates[0]?.id).toBe('geriatria');
    const digestive = route('Meu avô de 75 anos está com disenteria');
    expect(digestive.candidates[0]?.id).toBe('gastroenterologia');
  });

  it('entende tríceps e amígdalas como localização já respondida', () => {
    expect(assessDetail(['Meu pai sente dor no tríceps']).known.has('location')).toBe(true);
    expect(assessDetail(['Minha filha tem dor nas amígdalas']).known.has('location')).toBe(true);
    expect(assessDetail(['Meu avô está com disenteria']).known.has('location')).toBe(true);
  });

  it('pergunta sobre sinais relevantes quando o relato sugere alteração intestinal', () => {
    const topics = adaptiveIntakeTopics(['Meu avô está com desinteria']);
    expect(topics).toContain('associated_symptoms');
    const question = questionText('associated_symptoms', 'Meu avô está com disenteria');
    expect(question).toMatch(/sangue nas fezes/i);
    expect(question).toMatch(/desidratação/i);
  });

  it('preserva a mesma pessoa quando uma resposta esclarece o termo anterior', () => {
    const initial = 'Meu pai está com dor no tríceps';
    const conversation = careConversation({
      message: 'Tríceps, parte traseira do bíceps',
      history: [initial],
      city: '', insurance: '', consent: false,
      context: {
        specialtyId: null, clinicIds: [], city: '', insurance: '',
        care: { questions: ['location'], askedTopics: ['location'], round: 1 },
      },
    });
    expect(conversation.newPerson).toBe(false);
    expect(conversation.newEpisode).toBe(false);
    expect(conversation.history).toEqual([initial]);
  });

  it('oferece pistas semânticas para o Qwen sem restringir a taxonomia', () => {
    const input = JSON.parse(careInput({
      message: 'Meu pai sentiu uma dor no tríceps depois do treino',
      history: [], specialties: [],
    })) as { vocabularyHints: Array<{ specialtyId: string }> };
    expect(input.vocabularyHints.some((candidate) => candidate.specialtyId === 'ortopedia')).toBe(true);
    expect(hasVocabularyHealthTerm('desinteria')).toBe(true);
    expect(vocabularyMatches('dor nas amígdalas').some((candidate) => candidate.specialtyId === 'otorrinolaringologia')).toBe(true);
  });
});
