import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AIProvider } from '../server/ai/provider.js';
import { demoProvider } from '../server/ai/demo.js';
import { patientProfile } from '../server/domain/patient.js';
import { routeComplaint } from '../server/domain/specialty-routing.js';
import { supportedReferralIds } from '../server/domain/referral-validation.js';
import { currentReferralEvidence, symptomLedgerFromMessages, updateSymptomLedger } from '../server/domain/symptom-ledger.js';
import { careInput } from '../server/ai/prompt.js';
import { readConfig } from '../server/config.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { loadPublicCatalog } from '../server/services/public-catalog.js';
import { SpecialtyRepository } from '../server/db/specialties.js';
import { CatalogRepository } from '../server/db/catalog.js';
import { SpecialtyResolver } from '../server/services/specialty-resolver.js';
import { Retriever } from '../server/rag/retrieve.js';
import { ChatService } from '../server/services/chat.js';
import { chatRequestSchema } from '../shared/contracts.js';

const message = 'Boa noite, estou com coriza, ardência nos olhos e febre leve.';
const started = 'Começou ontem à noite.';
const changed = 'A ardência nos olhos passou, agora só coriza.';

describe('Prioridade clínica considera TODO o quadro atual', () => {
  it('coriza, febre e ardência leve: Clínica Médica primeiro, ENT plausível, olhos não dominam', () => {
    const patient = patientProfile([message]);
    const routing = routeComplaint([message], patient);
    const allowed = supportedReferralIds(routing, patient);
    expect(routing.candidates[0]?.id).toBe('clinica-medica');
    expect(allowed).toContain('otorrinolaringologia');
    expect(allowed).not.toContain('oftalmologia');
    expect(allowed).not.toContain('ortopedia');
  });

  it('depois da melhora, coriza fica ativa e ardência/febre anteriores deixam de determinar a especialidade', () => {
    const history = [message, started];
    let facts = symptomLedgerFromMessages(history);
    facts = updateSymptomLedger(facts, changed);
    expect(facts).toContainEqual({ key: 'irritacao-ocular', status: 'resolved' });
    expect(facts).toContainEqual({ key: 'coriza', status: 'active' });
    expect(facts).toContainEqual({ key: 'febre', status: 'resolved' });
    const messages = [...history, changed, 'Está incomodando um pouco.'];
    const routing = routeComplaint(messages, patientProfile(messages), currentReferralEvidence(messages, facts));
    expect(supportedReferralIds(routing, patientProfile(messages))).not.toContain('oftalmologia');
    expect(supportedReferralIds(routing, patientProfile(messages))).toEqual(
      expect.arrayContaining(['clinica-medica', 'otorrinolaringologia']),
    );
  });

  it('melhorou não significa que desapareceu; passou e não sinto mais significam resolução', () => {
    const prior = symptomLedgerFromMessages(['Estou com coriza e irritação ocular.']);
    expect(updateSymptomLedger(prior, 'A irritação ocular melhorou.'))
      .toContainEqual({ key: 'irritacao-ocular', status: 'active' });
    expect(updateSymptomLedger(prior, 'Passou a irritação ocular.'))
      .toContainEqual({ key: 'irritacao-ocular', status: 'resolved' });
    expect(updateSymptomLedger(prior, 'Não sinto mais irritação ocular.'))
      .toContainEqual({ key: 'irritacao-ocular', status: 'resolved' });
  });

  it('preserva Oftalmologia quando o problema é ocular, e Ortopedia para dor localizada após esforço', () => {
    const eye = ['Meu olho está vermelho e coçando.'];
    const foot = ['Estou com dor no pé depois da corrida.'];
    expect(routeComplaint(eye, patientProfile(eye)).candidates[0]?.id).toBe('oftalmologia');
    expect(routeComplaint(foot, patientProfile(foot)).candidates[0]?.id).toBe('ortopedia');
  });

  it('não reduz alerta ocular importante a quadro respiratório', () => {
    const severe = ['Coriza, febre, dor forte no olho e visão embaçada.'];
    const routing = routeComplaint(severe, patientProfile(severe));
    expect(routing.candidates.find((candidate) => candidate.id === 'oftalmologia')).toBeDefined();
  });

  it('LLM recebe os estados dos sintomas e pistas do quadro ativo, sem diagnóstico', () => {
    const input = JSON.parse(careInput({
      message: changed,
      history: [message, started],
      specialties: [{ id: 'clinica-medica', name: 'Clínica Médica' }],
    }));
    expect(input.symptomStatesForThisEpisode).toContainEqual({ key: 'irritacao-ocular', status: 'resolved' });
    expect(input.symptomStatesForThisEpisode).toContainEqual({ key: 'coriza', status: 'active' });
    expect(input.vocabularyHints.some((hint: { specialtyId: string }) => hint.specialtyId === 'oftalmologia')).toBe(false);
  });
});

describe('Integração do chat: mudança dos sintomas altera encaminhamento e clínicas', () => {
  let db: Database;
  let chat: ChatService;
  const generate = vi.fn<AIProvider['generate']>();
  const provider: AIProvider = { ...demoProvider, mode: 'ollama', generate };
  beforeAll(async () => {
    db = await connectDatabase(readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://' }));
    await migrate(db);
    await loadPublicCatalog(db);
    chat = new ChatService(
      new Retriever(db, provider, false), provider,
      new CatalogRepository(db, false),
      new SpecialtyResolver(new SpecialtyRepository(db)),
    );
  });
  afterAll(async () => db?.close());
  const send = (text: string, history: string[] = [], context?: Awaited<ReturnType<ChatService['answer']>>['context']) =>
    chat.answer(chatRequestSchema.parse({ message: text, history, ...(context ? { context } : {}) }));

  it('bloqueia Oftalmologia quando a coriza e a febre são o quadro predominante', async () => {
    generate.mockReset().mockResolvedValue({
      urgency: 'routine', specialty: { name: 'Oftalmologia' }, questions: [],
    });
    const result = await send(message);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.specialty?.id).toBe('clinica-medica');
    expect(result.clinics.every((clinic) => clinic.specialties.includes('clinica-medica'))).toBe(true);
  });

  it('reavalia quando a ardência desaparece; ENT é aceita sem prender a Oftalmologia', async () => {
    generate.mockReset().mockResolvedValue({
      urgency: 'routine', specialty: { name: 'Otorrinolaringologia' }, questions: [],
    });
    const first = await send(message);
    const second = await send(changed, [message], first.context);
    expect(second.specialty?.id).toBe('otorrinolaringologia');
    expect(second.context?.symptomState).toContainEqual({ key: 'irritacao-ocular', status: 'resolved' });
    expect(second.clinics.every((clinic) => clinic.specialties.includes('otorrinolaringologia'))).toBe(true);
  });

  it('um novo paciente não herda sintomas resolvidos nem especialidade antiga', async () => {
    generate.mockReset().mockResolvedValue({
      urgency: 'routine', specialty: { name: 'Ortopedia e Traumatologia' }, questions: [],
    });
    const first = await send(message);
    const next = await send('Agora meu pai está com dor no pé.', [message], first.context);
    expect(next.context?.symptomState?.find((fact) => fact.key === 'coriza')).toBeUndefined();
  });
});
