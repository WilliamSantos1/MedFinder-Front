import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoProvider } from '../server/ai/demo.js';
import { readConfig } from '../server/config.js';
import { CatalogRepository } from '../server/db/catalog.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { SpecialtyRepository } from '../server/db/specialties.js';
import { hasUnrecognizedInsurance, resolveInsurances } from '../server/domain/insurance.js';
import { Retriever } from '../server/rag/retrieve.js';
import { ChatService } from '../server/services/chat.js';
import { loadPublicCatalog, readPublicCatalog } from '../server/services/public-catalog.js';
import { SpecialtyResolver } from '../server/services/specialty-resolver.js';
import { chatRequestSchema, chatResponseSchema, type ChatContext } from '../shared/contracts.js';

const publicClinics = await readPublicCatalog();
const plans = [...new Set(publicClinics.flatMap((clinic) => clinic.insurances))];
const pairs = publicClinics.flatMap((clinic) =>
  clinic.insurances.map((plan) => ({ clinic, plan })),
);
const generate = vi.fn(demoProvider.generate);
const embed = vi.fn(demoProvider.embed);
let db: Database;
let catalog: CatalogRepository;
let service: ChatService;
const selected: ChatContext = {
  specialtyId: 'ortopedia',
  clinicIds: ['public-cti', 'public-multiclinica-fortaleza'],
  city: '',
  insurance: '',
};
const filters = { city: '', insurance: '', specialty: '', page: 1 };
async function chat(message: string, extra: Record<string, unknown> = {}) {
  return chatResponseSchema.parse(
    await service.answer(chatRequestSchema.parse({ message, ...extra })),
  );
}

beforeAll(async () => {
  db = await connectDatabase(readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://' }));
  await migrate(db);
  await loadPublicCatalog(db);
  catalog = new CatalogRepository(db, false);
  const provider = { ...demoProvider, generate, embed };
  service = new ChatService(
    new Retriever(db, provider, false),
    provider,
    catalog,
    new SpecialtyResolver(new SpecialtyRepository(db)),
  );
});
beforeEach(() => {
  generate.mockClear();
  embed.mockClear();
});
afterAll(async () => {
  await db?.close();
});

describe('Todos os vínculos de convênio do catálogo passam pelo mesmo mecanismo', () => {
  it.each(plans)('verifica presença e ausência de %s nas 50 unidades', async (plan) => {
    for (let start = 0; start < publicClinics.length; start += 3) {
      const group = publicClinics.slice(start, start + 3);
      const result = await chat(`Dessas clínicas, quais aceitam ${plan}?`, {
        context: {
          specialtyId: null,
          clinicIds: group.map((clinic) => clinic.id),
          city: '',
          insurance: '',
        },
      });
      const expected = group
        .filter((clinic) => clinic.insurances.includes(plan))
        .map((clinic) => clinic.id)
        .sort();
      expect(result.clinics.map((clinic) => clinic.id).sort()).toEqual(expected);
      expect(result.status).toBe(expected.length ? 'ok' : 'no_matching_clinics');
    }
  });
  it.each(plans)('consulta global de %s equivale ao filtro SQL', async (plan) => {
    const expected = await catalog.search({ ...filters, insurance: plan });
    const result = await chat(`Quais clínicas aceitam o convênio ${plan}?`);
    expect(result.status).toBe('ok');
    expect(result.context?.insurance).toBe(plan);
    expect(result.clinics.map((clinic) => clinic.id)).toEqual(
      expected.items.slice(0, 3).map((clinic) => clinic.id),
    );
    expect(result.clinics.every((clinic) => clinic.insurances.includes(plan))).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });
  it.each(pairs)(
    '$clinic.id aceita $plan no contexto sem escapar para outras unidades',
    async ({ clinic, plan }) => {
      const result = await chat(`Dessas clínicas, qual aceita o convênio ${plan}?`, {
        context: { specialtyId: null, clinicIds: [clinic.id], city: '', insurance: '' },
      });
      expect(result.status).toBe('ok');
      expect(result.clinics.map((item) => item.id)).toEqual([clinic.id]);
      expect(result.context?.insurance).toBe(plan);
      expect(generate).not.toHaveBeenCalled();
      expect(embed).not.toHaveBeenCalled();
    },
  );
});

describe('Interpretação, esclarecimento e continuidade de convênios', () => {
  it.each(['Aceita CAFAZ?', 'E pelo plano CAFAZ?', 'Meu convênio é CAFAZ'])(
    'continuação sem repetir a palavra clínica: %s',
    async (message) => {
      const result = await chat(message, { context: selected });
      expect(result.context?.catalog?.scope).toBe('selection');
      expect(result.clinics.map((clinic) => clinic.id)).toEqual(['public-cti']);
    },
  );
  it('agradecimento preserva a comparação e as opções de contexto', async () => {
    const thanks = await chat('Obrigado!', { context: selected });
    expect(thanks.context?.clinicIds).toEqual(selected.clinicIds);
    expect(thanks.clinics).toEqual([]);
    const result = await chat('E a CAFAZ?', { context: thanks.context });
    expect(result.clinics.map((clinic) => clinic.id)).toEqual(['public-cti']);
  });
  it('compara planos sucessivos sem reduzir a seleção original após um resultado único ou vazio', async () => {
    const original = ['public-cti', 'public-multiclinica-fortaleza', 'public-multiclinic'];
    const first = await chat('Quais destas clínicas atendem CAFAZ?', {
      context: { ...selected, clinicIds: original },
    });
    expect(first.clinics.map((clinic) => clinic.id)).toEqual(['public-cti']);
    expect(first.context?.catalog?.selectionIds).toEqual(original);
    expect(first.context?.catalog?.resultIds).toEqual(['public-cti']);

    const second = await chat('E pela Unimed?', { context: first.context });
    expect(second.clinics.map((clinic) => clinic.id)).toEqual([
      'public-cti', 'public-multiclinic',
    ]);
    expect(second.context?.catalog?.selectionIds).toEqual(original);
    expect(second.context?.catalog?.resultIds).toEqual(['public-cti', 'public-multiclinic']);

    const none = await chat('E a FUSEX?', { context: second.context });
    expect(none.status).toBe('no_matching_clinics');
    expect(none.clinics).toEqual([]);
    expect(none.context?.catalog?.selectionIds).toEqual(original);
    expect(none.context?.catalog?.resultIds).toEqual([]);

    const again = await chat('E a Unimed?', { context: none.context });
    expect(again.clinics.map((clinic) => clinic.id)).toEqual([
      'public-cti', 'public-multiclinic',
    ]);

    const cleared = await chat('Dessas clínicas, pesquise sem filtro de convênio', {
      context: again.context,
    });
    expect(cleared.context?.insurance).toBe('');
    expect(cleared.clinics.map((clinic) => clinic.id)).toEqual(original.sort((a, b) => {
      const an = publicClinics.find((clinic) => clinic.id === a)!.name;
      const bn = publicClinics.find((clinic) => clinic.id === b)!.name;
      return an.localeCompare(bn, 'pt-BR');
    }));
  });

  it('uma busca global nova estabelece escopo global, mas "dessas" usa só os resultados visíveis', async () => {
    const selectedFirst = await chat('Qual dessas clínicas aceita CAFAZ?', { context: selected });
    const global = await chat('Pesquise em todas as clínicas que aceitam Unimed', {
      context: selectedFirst.context,
    });
    expect(global.context?.catalog?.scope).toBe('all');
    expect(global.context?.catalog?.selectionIds).toEqual(global.clinics.map((clinic) => clinic.id));
    const narrowed = await chat('Quais dessas clínicas aceitam CAFAZ?', {
      context: global.context,
    });
    expect(narrowed.context?.catalog?.scope).toBe('selection');
    expect(narrowed.clinics.every((clinic) =>
      global.clinics.some((previous) => previous.id === clinic.id) &&
      clinic.insurances.includes('CAFAZ'))).toBe(true);
    expect(narrowed.context?.catalog?.selectionIds).toEqual(global.clinics.map((clinic) => clinic.id));
  });

  it('um plano desconhecido sem a palavra plano não é substituído pelo filtro ativo', async () => {
    const result = await chat('Quais dessas clínicas aceitam Inventado?', {
      context: selected,
      insurance: 'Unimed',
    });
    expect(result.status).toBe('needs_information');
    expect(result.clinics).toEqual([]);
  });
  it.each(['Inventado', 'Unimed ou CAFAZ'])(
    'esclarece %s junto do sintoma e depois retoma a navegação',
    async (plan) => {
      const message = `Tenho dor no joelho e meu plano é ${plan}.`;
      const first = await chat(message);
      expect(first.status).toBe('needs_information');
      const second = await chat('CAFAZ', { history: [message], context: first.context });
      expect(second.intent).toBe('care_navigation');
      // Resolving a plan is not enough to choose a medical specialty: ask for
      // additional clinical details before consulting the clinic catalog.
      expect(second.status).toBe('needs_information');
      expect(second.context?.insurance).toBe('CAFAZ');
      const third = await chat('Começou ontem após correr, sem outros sintomas.', {
        history: [message, 'CAFAZ'],
        context: second.context,
      });
      expect(third.specialty?.id).toBe('ortopedia');
      expect(third.clinics.map((clinic) => clinic.id)).toEqual(['public-cti']);
    },
  );
  it('o plano escrito substitui o filtro anterior', async () => {
    const result = await chat('Qual dessas clínicas aceita CAFAZ?', {
      context: selected,
      insurance: 'Unimed',
    });
    expect(result.context?.insurance).toBe('CAFAZ');
    expect(result.clinics.map((clinic) => clinic.id)).toEqual(['public-cti']);
  });
  it('uma cidade explícita substitui o filtro anterior', async () => {
    const result = await chat('Quais clínicas de oftalmologia em Eusébio?', { city: 'Fortaleza' });
    expect(result.clinics.length).toBeGreaterThan(0);
    expect(result.clinics.every((clinic) => clinic.city === 'Eusébio')).toBe(true);
  });
  it('plano desconhecido não herda nem o filtro nem a cobertura anterior', async () => {
    const result = await chat('Qual dessas clínicas aceita o plano Inventado?', {
      context: selected,
      insurance: 'Unimed',
    });
    expect(result.status).toBe('needs_information');
    expect(result.clinics).toEqual([]);
    expect(result.context?.catalog?.clinicIds).toEqual(selected.clinicIds);
    const corrected = await chat('CAFAZ', { context: result.context });
    expect(corrected.clinics.map((clinic) => clinic.id)).toEqual(['public-cti']);
    expect(corrected.specialty?.id).toBe('ortopedia');
  });
  it('pedir o nome do plano preserva as três clínicas para a resposta curta', async () => {
    const question = await chat('Qual dessas aceita meu plano?', { context: selected });
    expect(question.status).toBe('needs_information');
    const answer = await chat('Unimed', { context: question.context });
    expect(answer.clinics.map((clinic) => clinic.id)).toEqual(['public-cti']);
    expect(answer.context?.catalog?.scope).toBe('selection');
  });
  it('resultado vazio preserva a comparação e permite testar outro plano', async () => {
    const empty = await chat('Qual dessas clínicas aceita FUSEX?', { context: selected });
    expect(empty.status).toBe('no_matching_clinics');
    expect(empty.clinics).toEqual([]);
    expect(empty.answer).toMatch(/ausência.*não confirma/i);
    const alternative = await chat('E a Unimed?', { context: empty.context });
    expect(alternative.clinics.map((clinic) => clinic.id)).toEqual(['public-cti']);
  });
  it('ampliar para toda a base remove o grupo e a especialidade herdados', async () => {
    const result = await chat('Pesquise em todas as clínicas que aceitam CAFAZ', {
      context: selected,
    });
    const expected = await catalog.search({ ...filters, insurance: 'CAFAZ' });
    expect(result.context?.catalog?.scope).toBe('all');
    expect(result.specialty).toBeNull();
    expect(result.clinics.map((clinic) => clinic.id)).toEqual(
      expected.items.slice(0, 3).map((clinic) => clinic.id),
    );
  });
  it('pergunta genérica sobre clínicas pesquisa toda a base', async () => {
    const result = await chat('Quais clínicas aceitam Unimed?', { context: selected });
    expect(result.context?.catalog?.scope).toBe('all');
    expect(result.specialty).toBeNull();
  });
  it('troca de plano após uma consulta global continua global', async () => {
    const first = await chat('Quais clínicas aceitam CAFAZ?');
    const second = await chat('E a Unimed?', { context: first.context });
    const expected = await catalog.search({ ...filters, insurance: 'Unimed' });
    expect(second.context?.catalog?.scope).toBe('all');
    expect(second.clinics.map((clinic) => clinic.id)).toEqual(
      expected.items.slice(0, 3).map((clinic) => clinic.id),
    );
  });
  it('listagem de todos os planos das unidades não elimina as sem convênio informado', async () => {
    const result = await chat('Quais convênios essas clínicas aceitam?', {
      context: selected,
      insurance: 'Unimed',
    });
    expect(result.clinics.map((clinic) => clinic.id).sort()).toEqual(
      [...selected.clinicIds].sort(),
    );
    expect(result.answer).toContain('convênios não informados');
    expect(result.context?.insurance).toBe('');
  });
  it('referência ordinal consulta a posição mostrada, sem reordenar antes de escolher', async () => {
    const result = await chat('A segunda aceita CAFAZ?', { context: selected });
    expect(result.status).toBe('no_matching_clinics');
    expect(result.context?.catalog?.clinicIds).toEqual(['public-multiclinica-fortaleza']);
  });
  it('não transforma ausência de cadastro em negativa de cobertura', async () => {
    const result = await chat('Quais dessas não aceitam Unimed?', { context: selected });
    expect(result.status).toBe('needs_information');
    expect(result.clinics).toEqual([]);
    expect(result.answer).toMatch(/ausência.*não confirma/i);
  });
  it('múltiplos planos exigem escolha e preservam a seleção', async () => {
    const question = await chat('Dessas clínicas, quais aceitam Unimed ou CAFAZ?', {
      context: selected,
    });
    expect(question.status).toBe('needs_information');
    const result = await chat('CAFAZ', { context: question.context });
    expect(result.clinics.map((clinic) => clinic.id)).toEqual(['public-cti']);
  });
  it('convênio na mesma frase é preservado durante a entrevista antes da busca', async () => {
    const message = 'Tenho dor no joelho depois de correr e meu plano é CAFAZ.';
    const first = await chat(message);
    expect(first.intent).toBe('care_navigation');
    expect(first.status).toBe('needs_information');
    expect(first.context?.insurance).toBe('CAFAZ');
    const result = await chat('Começou ontem e não tenho outros sintomas.', {
      history: [message], context: first.context,
    });
    expect(result.specialty?.id).toBe('ortopedia');
    expect(result.context?.insurance).toBe('CAFAZ');
    expect(result.clinics.map((clinic) => clinic.id)).toEqual(['public-cti']);
  });
  it('pergunta clínica com especialidade e plano não vira listagem geral', async () => {
    const result = await chat('Tenho refluxo e meu plano é Unimed. Qual especialidade procuro?');
    expect(result.intent).toBe('care_navigation');
    expect(result.specialty?.id).toBe('gastroenterologia');
    expect(result.context?.insurance).toBe('Unimed');
  });
  it('um plano durante a entrevista não interrompe a pergunta de idade', async () => {
    const message = 'Minha filha está com febre e cansaço desde ontem.';
    const first = await chat(message);
    const second = await chat('Unimed', { history: [message], context: first.context });
    expect(second.status).toBe('needs_information');
    expect(second.clinics).toEqual([]);
    expect(second.context?.insurance).toBe('Unimed');
    expect(second.questions.join(' ')).toMatch(/idade/);
  });
  it('remove filtro de convênio por pedido explícito', async () => {
    const result = await chat('Dessas clínicas, pesquise sem filtro de convênio', {
      context: selected,
      insurance: 'Unimed',
    });
    expect(result.context?.insurance).toBe('');
    expect(result.clinics).toHaveLength(2);
  });
  it('nome de clínica desconhecido não apresenta outras unidades como resposta', async () => {
    const result = await chat('A clínica Inexistente atende Unimed?');
    expect(result.status).toBe('needs_information');
    expect(result.clinics).toEqual([]);
  });
  it('uma referência a clínicas ausentes nunca abre busca geral', async () => {
    const result = await chat('Qual dessas aceita CAFAZ?');
    expect(result.status).toBe('needs_information');
    expect(result.clinics).toEqual([]);
  });
  it('novo plano importado funciona sem modificar nenhuma regra', async () => {
    const original = publicClinics.find((clinic) => clinic.id === 'public-cti')!;
    await catalog.import([
      {
        ...original,
        id: 'public-horizonte-teste',
        name: 'Clínica Horizonte Vital',
        insurances: ['Horizonte Vital'],
      },
    ]);
    try {
      const result = await chat('Quais clínicas aceitam Horizonte Vital?');
      expect(result.context?.insurance).toBe('Horizonte Vital');
      expect(result.clinics.map((clinic) => clinic.id)).toEqual(['public-horizonte-teste']);
      const information = await chat('Onde fica a Clínica Horizonte Vital?');
      expect(information.intent).toBe('clinic_information');
      expect(information.context?.insurance).toBe('');
      expect(information.clinics.map((clinic) => clinic.id)).toEqual(['public-horizonte-teste']);
    } finally {
      await db.query('DELETE FROM clinics WHERE id=$1', ['public-horizonte-teste']);
    }
  });
  it('dados desativados ou adulterados no contexto não vazam para resultados', async () => {
    const result = await chat('Qual dessas aceita Unimed?', {
      context: { ...selected, clinicIds: ['public-inexistente'] },
    });
    expect(result.clinics).toEqual([]);
  });
  it('marca com muitas unidades pede identificação sem exceder o contrato de contexto', async () => {
    const original = publicClinics[0];
    const units = Array.from({ length: 7 }, (_, index) => ({
      ...original,
      id: `public-marca-repetida-${index}`,
      name: `Clínica Horizonte Azul — Unidade ${index + 1}`,
    }));
    await catalog.import(units);
    try {
      const result = await chat('Onde fica a Clínica Horizonte Azul?');
      expect(result.status).toBe('needs_information');
      expect(result.clinics).toEqual([]);
      expect(result.context?.catalog?.clinicIds.length).toBeLessThanOrEqual(6);
    } finally {
      await db.query('DELETE FROM clinics WHERE id=ANY($1::text[])', [
        units.map((unit) => unit.id),
      ]);
    }
  });
});

describe('Nomes e aliases sem lista fixa de operadoras', () => {
  it.each([
    ['Bradesco', 'Bradesco Saúde'],
    ['sul america', 'SulAmérica'],
    ['plan assiste', 'Plan-Assiste'],
    ['c.a.f.a.z.', 'CAFAZ'],
  ])('%s resolve %s', (text, expected) => {
    expect(resolveInsurances(text, plans).matches).toEqual([expected]);
  });
  it('rede genérica não corresponde a um plano chamado Rede Saúde', () => {
    expect(resolveInsurances('Faz parte da rede Unimed?', plans).matches).toEqual(['Unimed']);
  });
  it('alias ambíguo pede identificação, sem escolher uma marca ao acaso', () => {
    expect(
      resolveInsurances('Quais aceitam Horizonte?', [
        'Horizonte Saúde',
        'Horizonte Assistência Médica',
      ]),
    ).toMatchObject({ ambiguous: true });
  });
  it('plano inventado é identificado mesmo quando outro filtro está ativo', () => {
    expect(hasUnrecognizedInsurance('Aceita o plano Inventado?', plans)).toBe(true);
    expect(hasUnrecognizedInsurance('Qual dessas aceita meu plano?', plans)).toBe(false);
  });
});

describe('Guardrails nos turnos de continuação', () => {
  it.each(['E se eu tomar metade?', 'Isso resolve?', 'Posso usar esse?'])(
    'intercepta medicamento omitido em %s',
    async (message) => {
      const result = await chat(message, { history: ['Posso tomar ibuprofeno?'] });
      expect(result.mode).toBe('safety');
      expect(result.specialty).toBeNull();
      expect(result.clinics).toEqual([]);
      expect(generate).not.toHaveBeenCalled();
      expect(embed).not.toHaveBeenCalled();
    },
  );
  it('sinais de urgência prevalecem sobre consulta de plano', async () => {
    const result = await chat('Qual dessas aceita CAFAZ? Estou com dor forte no peito.', {
      context: selected,
    });
    expect(result.mode).toBe('safety');
    expect(result.urgency).toBe('emergency');
    expect(result.clinics).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });
  it('novo sintoma não herda a pergunta sobre medicamento', async () => {
    const result = await chat('Tenho refluxo quase todo dia.', {
      history: ['Posso tomar ibuprofeno para dor no joelho?'],
      context: selected,
    });
    expect(result.mode).not.toBe('safety');
    expect(result.specialty?.id).toBe('gastroenterologia');
  });
});
