import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AIProvider } from '../server/ai/provider.js';
import { demoProvider } from '../server/ai/demo.js';
import { patientProfile } from '../server/domain/patient.js';
import { positiveEvidenceText } from '../server/domain/negated-evidence.js';
import { routeComplaint } from '../server/domain/specialty-routing.js';
import { isSupportedReferral, modelCandidateIds, supportedReferralIds } from '../server/domain/referral-validation.js';
import { readConfig } from '../server/config.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { loadPublicCatalog } from '../server/services/public-catalog.js';
import { CatalogRepository } from '../server/db/catalog.js';
import { SpecialtyRepository } from '../server/db/specialties.js';
import { SpecialtyResolver } from '../server/services/specialty-resolver.js';
import { Retriever } from '../server/rag/retrieve.js';
import { ChatService } from '../server/services/chat.js';
import { chatRequestSchema } from '../shared/contracts.js';

const cases = [
  ['Minha esposa de 40 anos está com nariz congestionado, febre leve e indisposição.', 'ortopedia', 'otorrinolaringologia'],
  ['Meu olho está vermelho e coçando.', 'ortopedia', 'oftalmologia'],
  ['Estou com dor no pé depois de correr.', 'pneumologia', 'ortopedia'],
  ['Tenho dor no tríceps após a academia.', 'cardiologia', 'ortopedia'],
  ['Meu filho de 8 anos tem dor nas amígdalas.', 'ortopedia', 'pediatria'],
  ['Estou com disenteria e fezes líquidas.', 'ortopedia', 'gastroenterologia'],
  ['Tenho ardência ao urinar.', 'dermatologia', 'urologia'],
  ['Tenho palpitações e coração acelerado.', 'otorrinolaringologia', 'cardiologia'],
  ['Tenho manchas na pele e coceira.', 'gastroenterologia', 'dermatologia'],
  ['Tenho refluxo e azia.', 'ortopedia', 'gastroenterologia'],
  ['Tenho enxaqueca.', 'otorrinolaringologia', 'neurologia'],
  ['Tenho chiado no peito e tosse persistente.', 'ortopedia', 'pneumologia'],
  ['Tenho corrimento vaginal.', 'oftalmologia', 'ginecologia'],
  ['Minha mãe de 78 anos apresenta fragilidade e quedas frequentes.', 'ortopedia', 'geriatria'],
] as const;

describe('Validação independente de especialidade por evidência do relato', () => {
  it.each(cases)('nunca transforma %s em %s; considera %s plausível', (message, invalid, plausible) => {
    const patient = patientProfile([message]);
    const routing = routeComplaint([message], patient);
    expect(routing.healthComplaint).toBe(true);
    expect(isSupportedReferral(invalid, routing, patient)).toBe(false);
    expect(isSupportedReferral(plausible, routing, patient)).toBe(true);
    expect(modelCandidateIds(routing, patient)).not.toContain(invalid);
  });

  it('mantém duas alternativas justificadas em quadros de apresentação ambígua', () => {
    const message = 'Minha esposa de 40 anos está com nariz congestionado, febre leve e indisposição.';
    const patient = patientProfile([message]);
    const routing = routeComplaint([message], patient);
    // Referral support matters; scoring confidence may change as the casebook grows.
    expect(routing.healthComplaint).toBe(true);
    expect(supportedReferralIds(routing, patient)).toEqual(expect.arrayContaining([
      'clinica-medica', 'otorrinolaringologia',
    ]));
  });

  it.each([
    ['Tenho congestão nasal e febre, sem dor no pé.', 'ortopedia', 'otorrinolaringologia'],
    ['Tenho febre, mas não tenho tosse.', 'pneumologia', 'clinica-medica'],
    ['Não tenho dor nas costas, mas sinto tontura.', 'ortopedia', 'neurologia'],
    ['Dor nas costas desde ontem, sem febre e sem dormência.', 'pneumologia', 'ortopedia'],
  ] as const)('não transforma sintomas negados em encaminhamento: %s', (message, invalid, valid) => {
    const patient = patientProfile([message]);
    const routing = routeComplaint([message], patient);
    expect(isSupportedReferral(invalid, routing, patient)).toBe(false);
    expect(isSupportedReferral(valid, routing, patient)).toBe(true);
  });

  it('negativas eliminam só evidências ausentes, sem apagar o relato positivo', () => {
    expect(positiveEvidenceText('Tenho nariz congestionado, sem dor no pé.')).toContain('nariz congestionado');
    expect(positiveEvidenceText('Tenho nariz congestionado, sem dor no pé.')).not.toContain('dor no pe');
    expect(positiveEvidenceText('Não consigo urinar.')).toContain('nao consigo urinar');
  });

  it('não promove especialidade específica sem qualquer evidência independente', () => {
    const message = 'Estou com um problema raro chamado xzqly, preciso de orientação.';
    const patient = patientProfile([message]);
    const routing = routeComplaint([message], patient);
    expect(routing.candidates).toEqual([]);
    expect(modelCandidateIds(routing, patient)).toBeNull();
    expect(isSupportedReferral('neurocirurgia', routing, patient)).toBe(false);
    expect(isSupportedReferral('clinica-medica', routing, patient)).toBe(true);
  });

  it('não herda Pediatria para pessoa adulta e mantém porta de entrada pediátrica se criança', () => {
    const adult = ['Minha esposa de 40 anos está com nariz entupido.'];
    const child = ['Meu filho de 8 anos está com coriza.'];
    expect(isSupportedReferral('pediatria', routeComplaint(adult, patientProfile(adult)), patientProfile(adult))).toBe(false);
    expect(isSupportedReferral('pediatria', routeComplaint(child, patientProfile(child)), patientProfile(child))).toBe(true);
  });

  it('aceita mais de uma hipótese inicial plausível quando há evidência independente', () => {
    const messages = ['Estou com tontura desde ontem.'];
    const patient = patientProfile(messages);
    const routing = routeComplaint(messages, patient);
    expect(isSupportedReferral('neurologia', routing, patient)).toBe(true);
    expect(isSupportedReferral('otorrinolaringologia', routing, patient)).toBe(true);
    expect(isSupportedReferral('dermatologia', routing, patient)).toBe(false);
  });
});

// Full backend integration: an existing specialty ID is NOT sufficient to
// display its clinics when the language model ignored the current symptoms.
describe('Conversa real: modelo errado não cria catálogo especializado incorreto', () => {
  let db: Database;
  let service: ChatService;
  const generate = vi.fn<AIProvider['generate']>();
  const provider: AIProvider = { ...demoProvider, mode: 'ollama', generate };
  beforeAll(async () => {
    db = await connectDatabase(readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://' }));
    await migrate(db);
    await loadPublicCatalog(db);
    service = new ChatService(
      new Retriever(db, provider, false), provider,
      new CatalogRepository(db, false),
      new SpecialtyResolver(new SpecialtyRepository(db)),
    );
  });
  afterAll(async () => db?.close());

  it('reproduz esposa, congestão, febre leve e indisposição: Ortopedia é recusada', async () => {
    generate.mockReset().mockImplementation(async ({ specialties }) => {
      expect(specialties?.some((specialty) => specialty.id === 'ortopedia')).toBe(false);
      expect(specialties?.some((specialty) => specialty.id === 'otorrinolaringologia')).toBe(true);
      expect(specialties?.some((specialty) => specialty.id === 'clinica-medica')).toBe(true);
      return { urgency: 'routine', specialty: { name: 'Ortopedia e Traumatologia' }, questions: [] };
    });
    const response = await service.answer(chatRequestSchema.parse({
      message: 'Ela tem 40 anos e está dormindo mal.',
      history: [
        'Obrigado, agora é minha esposa. Ela está com nariz congestionado, febre leve e indisposição.',
        'Começou ontem à noite e manteve pela manhã.',
      ],
    }));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(response.specialty?.id).toBe('clinica-medica');
    expect(response.clinics.every((clinic) => clinic.specialties.includes('clinica-medica'))).toBe(true);
    expect(response.clinics.some((clinic) => clinic.id === 'public-cti')).toBe(false);
  });

  it('cobre toda a taxonomia ativa: nenhuma área sem suporte para nariz/febre é aceita', async () => {
    const messages = ['Minha esposa de 40 anos está com nariz congestionado, febre leve e indisposição.'];
    const patient = patientProfile(messages);
    const routing = routeComplaint(messages, patient);
    const permitted = new Set(supportedReferralIds(routing, patient));
    const active = await new SpecialtyRepository(db).list();
    expect(active.length).toBeGreaterThan(30);
    for (const entry of active) {
      expect(isSupportedReferral(entry.id, routing, patient)).toBe(permitted.has(entry.id));
    }
    expect(permitted).toEqual(new Set(['clinica-medica', 'otorrinolaringologia']));
  });

  it('mantém especialista pertinente quando a LLM escolhe dentro das evidências', async () => {
    generate.mockReset().mockResolvedValue({
      urgency: 'routine', specialty: { name: 'Otorrinolaringologia' }, questions: [],
    });
    const response = await service.answer(chatRequestSchema.parse({
      message: 'Minha esposa de 40 anos está com congestão nasal e indisposição desde ontem, sem outros sintomas.',
    }));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(response.specialty?.id).toBe('otorrinolaringologia');
    expect(response.clinics.every((clinic) => clinic.specialties.includes('otorrinolaringologia'))).toBe(true);
  });

  it.each([
    ['Meu olho está vermelho e coçando desde ontem.', 'Ortopedia e Traumatologia'],
    ['Tenho dor no tríceps desde ontem após corrida, sem outros sintomas.', 'Cardiologia'],
    ['Estou com ardência ao urinar desde ontem, sem febre.', 'Dermatologia'],
    ['Minha mãe de 78 anos tem fragilidade e quedas frequentes desde ontem.', 'Pneumologia'],
  ])('não mostra clínica sem relação para %s (modelo escolheu %s)', async (message, wrong) => {
    generate.mockReset().mockResolvedValue({
      urgency: 'routine', specialty: { name: wrong }, questions: [],
    });
    const response = await service.answer(chatRequestSchema.parse({ message }));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(response.specialty?.id).not.toBe(
      wrong === 'Ortopedia e Traumatologia' ? 'ortopedia'
        : wrong === 'Cardiologia' ? 'cardiologia'
        : wrong === 'Dermatologia' ? 'dermatologia' : 'pneumologia',
    );
    if (response.specialty) {
      expect(response.clinics.every((clinic) => clinic.specialties.includes(response.specialty!.id))).toBe(true);
    } else {
      expect(response.clinics).toEqual([]);
    }
  });
});
