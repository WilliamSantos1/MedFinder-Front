import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { demoProvider } from '../server/ai/demo.js';
import type { AIProvider } from '../server/ai/provider.js';
import { readConfig } from '../server/config.js';
import { CatalogRepository } from '../server/db/catalog.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { SpecialtyRepository } from '../server/db/specialties.js';
import { Retriever } from '../server/rag/retrieve.js';
import { loadPublicCatalog } from '../server/services/public-catalog.js';
import { ChatService } from '../server/services/chat.js';
import { SpecialtyResolver } from '../server/services/specialty-resolver.js';
import { chatRequestSchema, type ChatContext } from '../shared/contracts.js';

let db: Database;
let service: ChatService;
const generate = vi.fn<AIProvider['generate']>();
const provider: AIProvider = {
  ...demoProvider,
  mode: 'ollama',
  generate,
};
const reply = (message: string, extra: Record<string, unknown> = {}) =>
  service.answer(chatRequestSchema.parse({ message, ...extra }));

beforeAll(async () => {
  db = await connectDatabase(readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://' }));
  await migrate(db);
  await loadPublicCatalog(db);
  service = new ChatService(
    new Retriever(db, provider, false),
    provider,
    new CatalogRepository(db, false),
    new SpecialtyResolver(new SpecialtyRepository(db)),
  );
});
afterAll(async () => db?.close());

describe('LLM desde a primeira queixa, sem diagnóstico nem atalhos precipitados', () => {
  it('dor pélvica aciona a IA e pergunta sem pedir novamente a região já informada', async () => {
    generate.mockReset().mockResolvedValue({
      urgency: 'uncertain', specialty: null, questions: ['onset_duration', 'associated_symptoms'],
    });
    const text = 'Bom dia, estou com dor na pelve. O que fazer?';
    const first = await reply(text);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ status: 'needs_information', mode: 'ollama', specialty: null, clinics: [] });
    expect(first.questions.join(' ')).not.toMatch(/Em qual parte do corpo/i);
    const second = await reply('Na pelve, próximo à virilha.', { history: [text], context: first.context });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(second).toMatchObject({ status: 'needs_information', mode: 'ollama', specialty: null, clinics: [] });
    expect(second.questions.join(' ')).toMatch(/Há quanto tempo|outro sintoma/i);
  });

  it('dor nas costas recebe entrevista mesmo quando a LLM já escolheu uma especialidade', async () => {
    generate.mockReset().mockResolvedValue({
      urgency: 'routine', specialty: { name: 'Ortopedia e Traumatologia' }, questions: [],
    });
    const response = await reply('Estou com dor nas costas');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(response.status).toBe('needs_information');
    expect(response.specialty).toBeNull();
  });

  it('respeita a pergunta adicional escolhida pela LLM mesmo quando já existe especialidade candidata', async () => {
    generate.mockReset().mockResolvedValue({
      urgency: 'routine', specialty: { name: 'Oftalmologia' }, questions: ['onset_duration'],
    });
    const response = await reply('Meu olho está vermelho e coçando');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(response.status).toBe('needs_information');
    expect(response.questions.join(' ')).toMatch(/Há quanto tempo/i);
  });

  it('não inventa Pediatria sem a idade do paciente', async () => {
    generate.mockReset().mockImplementation(async (input) => {
      expect(input.specialties?.some((specialty) => specialty.id === 'pediatria')).toBe(false);
      return { urgency: 'uncertain', specialty: { name: 'Pediatria' }, questions: [] };
    });
    const response = await reply('Estou com dor no ombro');
    expect(response.specialty?.id).not.toBe('pediatria');
  });

  it('idade desconhecida do filho é perguntada sem herdar a idade de outro paciente', async () => {
    generate.mockReset().mockResolvedValue({
      urgency: 'routine', specialty: { name: 'Pediatria' }, questions: [],
    });
    const response = await reply('Meu filho está com coriza', {
      context: {
        specialtyId: 'geriatria', clinicIds: [], city: '', insurance: '',
      },
      history: ['Meu avô tem 79 anos e sente tontura'],
    });
    expect(response.status).toBe('needs_information');
    expect(response.questions.join(' ')).toMatch(/idade do seu filho/i);
    expect(response.context?.insurance).toBe('');
  });

  it('falha da IA não vira especialidade específica inventada', async () => {
    generate.mockReset().mockRejectedValue(new Error('Ollama indisponível'));
    const response = await reply('Estou com dor na virilha');
    expect(response.status).toBe('llm_unavailable');
    expect(response.specialty).toBeNull();
    expect(response.clinics).toEqual([]);
  });
});

describe('Planos, clínicas e mudança de paciente', () => {
  const prior: ChatContext = {
    specialtyId: 'ortopedia', clinicIds: ['public-cti', 'public-multiclinica-fortaleza'],
    city: '', insurance: '',
  };

  it('pesquisa CAFAZ apenas nas clínicas exibidas quando diz "destas"', async () => {
    generate.mockReset();
    const response = await reply('Quais destas clínicas atendem pelo CAFAZ?', { context: prior });
    expect(response.mode).toBe('catalog');
    expect(response.clinics.map((clinic) => clinic.id)).toEqual(['public-cti']);
    expect(generate).not.toHaveBeenCalled();
  });

  it('consulta geral de plano pesquisa o catálogo sem herdar a seleção', async () => {
    generate.mockReset();
    const response = await reply('Quais clínicas em geral aceitam CAFAZ?', { context: prior });
    expect(response.mode).toBe('catalog');
    expect(response.clinics.every((clinic) => clinic.insurances.includes('CAFAZ'))).toBe(true);
  });

  it('retira o filtro por mensagem e amplia a busca para a mesma especialidade', async () => {
    generate.mockReset();
    const response = await reply('Não precisa ser atendida pela Unimed, era da pessoa anterior', {
      insurance: 'Unimed',
      context: {
        specialtyId: 'pediatria', clinicIds: ['public-unimed-espaco-saude'],
        city: '', insurance: 'Unimed',
        catalog: { scope: 'selection', clinicIds: ['public-unimed-espaco-saude'], awaitingInsurance: false },
      },
    });
    expect(response.mode).toBe('catalog');
    expect(response.context?.insurance).toBe('');
    expect(response.specialty?.id).toBe('pediatria');
    expect(response.clinics.length).toBeGreaterThan(1);
    expect(generate).not.toHaveBeenCalled();
  });
});
