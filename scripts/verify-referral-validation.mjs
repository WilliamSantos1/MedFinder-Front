/**
 * End-to-end backend guard smoke test without Vitest or real Ollama.
 * Run from the MedFinder-Front root after `npm run build`:
 *    node scripts/verify-referral-validation.mjs
 * Uses an isolated in-memory database, never the user's installed database.
 */
import { readConfig } from '../build/server/config.js';
import { connectDatabase } from '../build/server/db/database.js';
import { migrate } from '../build/server/db/migrations.js';
import { loadPublicCatalog } from '../build/server/services/public-catalog.js';
import { CatalogRepository } from '../build/server/db/catalog.js';
import { SpecialtyRepository } from '../build/server/db/specialties.js';
import { SpecialtyResolver } from '../build/server/services/specialty-resolver.js';
import { Retriever } from '../build/server/rag/retrieve.js';
import { ChatService } from '../build/server/services/chat.js';
import { demoProvider } from '../build/server/ai/demo.js';
import { chatRequestSchema } from '../build/shared/contracts.js';
import { patientProfile } from '../build/server/domain/patient.js';
import { routeComplaint } from '../build/server/domain/specialty-routing.js';
import { isSupportedReferral, supportedReferralIds } from '../build/server/domain/referral-validation.js';

let count = 0;
function check(condition, name) {
  if (!condition) throw new Error(`FALHOU: ${name}`);
  count += 1;
}

const checks = [
  ['Minha esposa de 40 anos está com nariz congestionado, febre leve e indisposição.', 'otorrinolaringologia', 'ortopedia'],
  ['Meu olho está vermelho e coçando.', 'oftalmologia', 'ortopedia'],
  ['Tenho dor no tríceps após academia.', 'ortopedia', 'cardiologia'],
  ['Estou com disenteria e fezes líquidas.', 'gastroenterologia', 'pneumologia'],
  ['Tenho dor nas amígdalas.', 'otorrinolaringologia', 'ortopedia'],
  ['Tenho ardência ao urinar.', 'urologia', 'dermatologia'],
  ['Tenho refluxo.', 'gastroenterologia', 'ortopedia'],
  ['Tenho palpitações.', 'cardiologia', 'otorrinolaringologia'],
  ['Tenho coceira na pele.', 'dermatologia', 'neurologia'],
  ['Tenho enxaqueca.', 'neurologia', 'gastroenterologia'],
  ['Tenho chiado no peito.', 'pneumologia', 'ortopedia'],
  ['Tenho corrimento vaginal.', 'ginecologia', 'cardiologia'],
  ['Meu filho de 8 anos tem dor nas amígdalas.', 'pediatria', 'ortopedia'],
  ['Minha mãe de 78 anos apresenta fragilidade e quedas frequentes.', 'geriatria', 'pneumologia'],
  ['Tenho febre, mas não tenho tosse.', 'clinica-medica', 'pneumologia'],
  ['Tenho nariz congestionado, sem dor no pé.', 'otorrinolaringologia', 'ortopedia'],
];
for (const [message, plausible, incoherent] of checks) {
  const messages = [message];
  const patient = patientProfile(messages);
  const route = routeComplaint(messages, patient);
  check(isSupportedReferral(plausible, route, patient), `${message}: área coerente`);
  check(!isSupportedReferral(incoherent, route, patient), `${message}: bloqueio área incoerente`);
}

const db = await connectDatabase(readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://' }));
try {
  await migrate(db);
  await loadPublicCatalog(db);
  const names = (await new SpecialtyRepository(db).list()).map((specialty) => specialty.id);
  const nose = ['Minha esposa de 40 anos está com nariz congestionado, febre leve e indisposição.'];
  const patient = patientProfile(nose);
  const supported = new Set(supportedReferralIds(routeComplaint(nose, patient), patient));
  check(names.length > 30, 'catálogo ativo com taxonomia disponível');
  check(names.filter((id) => supported.has(id)).every((id) => id === 'clinica-medica' || id === 'otorrinolaringologia'), 'todas as áreas ativas conferidas');

  let mock = 'Ortopedia e Traumatologia';
  let supplied = [];
  const provider = {
    ...demoProvider,
    mode: 'ollama',
    async generate(input) {
      supplied = (input.specialties ?? []).map((specialty) => specialty.id);
      return { urgency: 'routine', specialty: { name: mock }, questions: [] };
    },
  };
  const service = new ChatService(
    new Retriever(db, provider, false), provider,
    new CatalogRepository(db, false),
    new SpecialtyResolver(new SpecialtyRepository(db)),
  );
  const answer = (payload) => service.answer(chatRequestSchema.parse(payload));
  const wife = {
    message: 'Ela tem 40 anos e está dormindo mal.',
    history: [
      'Obrigado, agora é minha esposa. Ela está com nariz congestionado, febre leve e indisposição.',
      'Começou ontem à noite e manteve pela manhã.',
    ],
  };
  const wrong = await answer(wife);
  check(!supplied.includes('ortopedia'), 'modelo não recebe Ortopedia para queixa nasal');
  check(wrong.specialty?.id === 'clinica-medica', 'retorno seguro quando modelo insiste em Ortopedia');
  check(wrong.clinics.every((clinic) => clinic.specialties.includes('clinica-medica')), 'clínicas correspondem ao encaminhamento validado');

  mock = 'Otorrinolaringologia';
  const valid = await answer({
    message: 'Minha esposa de 40 anos está com congestão nasal e indisposição desde ontem, sem outros sintomas.',
  });
  check(valid.specialty?.id === 'otorrinolaringologia', 'modelo escolhe área justificada');
  check(valid.clinics.every((clinic) => clinic.specialties.includes('otorrinolaringologia')), 'catálogo condiz com Otorrino');

  console.log(`APROVADO: ${count}/${count} verificações de consistência de especialidades.`);
  console.log('Obs.: LLM simulada. Execute também Check, E2E e testes manuais com seu Ollama.');
} finally {
  await db.close();
}
