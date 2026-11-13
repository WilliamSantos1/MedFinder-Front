import { expect, test, type Page } from '@playwright/test';
import type { ChatResponse } from '../shared/contracts';

async function send(page: Page, message: string): Promise<ChatResponse> {
  const input = page.getByLabel('Descreva o que você está sentindo');
  const pending = page.waitForResponse((response) => response.url().endsWith('/api/chat'));
  await input.fill(message);
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Enviar mensagem' })).toBeVisible();
  return response.json();
}

test('pergunta contextual, filtro visível e busca geral usam os mesmos convênios', async ({
  page,
}) => {
  await page.goto('/');
  const first = await send(page, 'Quais clínicas de ortopedia?');
  expect(first.clinics).toHaveLength(3);
  const previousIds = first.clinics.map((clinic) => clinic.id);
  const second = await send(page, 'Quais dessas três clínicas aceitam Unimed?');
  expect(second.context?.catalog?.scope).toBe('selection');
  expect(
    second.clinics.every(
      (clinic) => previousIds.includes(clinic.id) && clinic.insurances.includes('Unimed'),
    ),
  ).toBe(true);
  await expect(page.locator('.chat-panel').getByLabel('Convênio', { exact: true })).toHaveValue(
    'Unimed',
  );
  const third = await send(page, 'Agora pesquise em todas as clínicas que aceitam CAFAZ');
  expect(third.context?.catalog?.scope).toBe('all');
  expect(third.specialty).toBeNull();
  expect(third.clinics.length).toBeGreaterThan(0);
  expect(third.clinics.every((clinic) => clinic.insurances.includes('CAFAZ'))).toBe(true);
  await expect(page.locator('.chat-panel').getByLabel('Convênio', { exact: true })).toHaveValue(
    'CAFAZ',
  );
  await page.getByRole('button', { name: 'Encontrar clínicas', exact: true }).click();
  await expect(page.locator('.directory').getByLabel('Convênio', { exact: true })).toHaveValue(
    'CAFAZ',
  );
});

test('plano escrito prevalece sobre seletor antigo e o esclarecimento mantém a seleção', async ({
  page,
}) => {
  await page.goto('/');
  const first = await send(page, 'Quais clínicas de ortopedia?');
  const previousIds = first.clinics.map((clinic) => clinic.id);
  await page.locator('.chat-panel').getByLabel('Convênio', { exact: true }).selectOption('Unimed');
  const second = await send(page, 'Dessas clínicas, qual aceita CAFAZ?');
  expect(second.context?.insurance).toBe('CAFAZ');
  await expect(page.locator('.chat-panel').getByLabel('Convênio', { exact: true })).toHaveValue(
    'CAFAZ',
  );
  const invalid = await send(page, 'Dessas clínicas, qual aceita o plano Inventado?');
  expect(invalid.status).toBe('needs_information');
  expect(invalid.clinics).toEqual([]);
  const corrected = await send(page, 'Unimed');
  expect(corrected.context?.catalog?.scope).toBe('selection');
  expect(
    corrected.clinics.every(
      (clinic) => previousIds.includes(clinic.id) && clinic.insurances.includes('Unimed'),
    ),
  ).toBe(true);
});

test('comparação sucessiva usa as mesmas clínicas, inclusive após nenhuma corresponder', async ({ page }) => {
  await page.goto('/');
  const first = await send(page, 'Quais clínicas de ortopedia?');
  const initialIds = first.clinics.map((clinic) => clinic.id);
  const cafaz = await send(page, 'Dessas clínicas, quais atendem CAFAZ?');
  expect(cafaz.context?.catalog?.scope).toBe('selection');
  expect(cafaz.context?.catalog?.selectionIds).toEqual(initialIds);
  const unimed = await send(page, 'E a Unimed?');
  expect(unimed.context?.catalog?.selectionIds).toEqual(initialIds);
  expect(unimed.clinics.every((clinic) =>
    initialIds.includes(clinic.id) && clinic.insurances.includes('Unimed'))).toBe(true);
  const none = await send(page, 'E a FUSEX?');
  expect(none.context?.catalog?.selectionIds).toEqual(initialIds);
  expect(none.clinics).toEqual([]);
  const repeated = await send(page, 'E a Unimed?');
  expect(repeated.clinics.map((clinic) => clinic.id)).toEqual(unimed.clinics.map((clinic) => clinic.id));
});

test('sintoma com convênio recebe especialidade e permite mudar para um novo sintoma', async ({
  page,
}) => {
  await page.goto('/');
  const first = await send(page, 'Tenho dor no joelho depois de correr e meu plano é CAFAZ.');
  expect(first.intent).toBe('care_navigation');
  expect(first.status).toBe('needs_information');
  expect(first.context?.insurance).toBe('CAFAZ');
  const detailed = await send(page, 'Começou ontem e não tenho outros sintomas.');
  expect(detailed.specialty?.id).toBe('ortopedia');
  expect(detailed.context?.insurance).toBe('CAFAZ');
  await expect(page.locator('.chat-panel').getByLabel('Convênio', { exact: true })).toHaveValue(
    'CAFAZ',
  );
  const second = await send(page, 'Tenho refluxo quase todo dia.');
  expect(second.intent).toBe('care_navigation');
  expect(second.specialty?.id).toBe('gastroenterologia');
  expect(second.context?.insurance).toBe('CAFAZ');
});

test('plano escolhido no chat não passa para um novo paciente', async ({ page }) => {
  await page.goto('/');
  const first = await send(page, 'Quais clínicas aceitam Unimed?');
  expect(first.context?.insurance).toBe('Unimed');
  await expect(page.locator('.chat-panel').getByLabel('Convênio', { exact: true })).toHaveValue('Unimed');
  const next = await send(page, 'Meu filho de 8 anos está com coriza. Qual especialidade procurar?');
  expect(next.intent).toBe('care_navigation');
  expect(next.context?.insurance).toBe('');
  await expect(page.locator('.chat-panel').getByLabel('Convênio', { exact: true })).toHaveValue('');
});

test('filtro selecionado manualmente continua ativo ao mudar de paciente', async ({ page }) => {
  await page.goto('/');
  const selector = page.locator('.chat-panel').getByLabel('Convênio', { exact: true });
  await selector.selectOption('CAFAZ');
  const first = await send(page, 'Quais clínicas aceitam CAFAZ?');
  expect(first.context?.insurance).toBe('CAFAZ');
  const next = await send(page, 'Meu filho de 8 anos está com coriza. Qual especialidade procurar?');
  expect(next.intent).toBe('care_navigation');
  expect(next.context?.insurance).toBe('CAFAZ');
  await expect(selector).toHaveValue('CAFAZ');
});

test('continuação de medicamento continua protegida sem perder a seleção anterior', async ({
  page,
}) => {
  await page.goto('/');
  await send(page, 'Quais clínicas de ortopedia?');
  const first = await send(page, 'Posso tomar ibuprofeno?');
  expect(first.mode).toBe('safety');
  const second = await send(page, 'E se eu tomar metade?');
  expect(second.mode).toBe('safety');
  expect(second.clinics).toEqual([]);
  await expect(page.locator('.assistant-message').last()).toContainText(
    /não recomenda.*confirma.*prescreve/i,
  );
});
